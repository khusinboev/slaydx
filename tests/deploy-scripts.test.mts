import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Ops sprint P-DEP (docs/ops/PLAN.md §3/§4, docs/ops/O1-deploy-pipeline.md §3.6): the pull
 * deploy `deploy/deploy-pull.sh` (installed as `slaydx-deploy`), the fallback
 * `deploy/deploy-build.sh` and `deploy/install-deploy.sh`.
 *
 * The scripts run for real (bash) against stub `docker`, `git`, `curl` and `slaydx-backup`
 * executables first on PATH; every stub call is recorded as
 * `tool \t SLAYDX_TAG \t DOCKER_CONFIG \t args`, so the tests assert what would have happened on
 * the server: refusal paths, step order, the tag each compose call used, the automatic rollback.
 * `flock` is the real one, so the concurrency test holds a real lock. Nothing here talks to a
 * docker daemon, git remote or network.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const PULL = path.join(ROOT, "deploy/deploy-pull.sh");
const BUILD = path.join(ROOT, "deploy/deploy-build.sh");
const INSTALL = path.join(ROOT, "deploy/install-deploy.sh");
const REG = "ghcr.io/khusinboev";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const PREV = "fedcba9876543210fedcba9876543210fedcba98";

const STUB_DOCKER = String.raw`#!/usr/bin/env bash
printf '%s\t%s\t%s\t%s\n' docker "${"$"}{SLAYDX_TAG:--}" "${"$"}{DOCKER_CONFIG:--}" "$*" >> "$STUB_LOG"
args="$*"
case "$args" in
  "compose version") exit "${"$"}{STUB_COMPOSE_VERSION_RC:-0}" ;;
  "manifest inspect "*)
    ref=${"$"}{args#manifest inspect }
    if [ -n "${"$"}{STUB_MISSING_MANIFEST:-}" ] && [[ "$ref" == *"$STUB_MISSING_MANIFEST"* ]]; then
      echo "no such manifest" >&2; exit 1
    fi
    echo '{}' ;;
  "compose -p slaydx ps -q web") [ -n "${"$"}{STUB_NO_RUNNING:-}" ] || echo cid-web ;;
  "compose -p slaydx ps -q worker")
    [ -n "${"$"}{STUB_NO_RUNNING:-}" ] || printf 'cid-worker1\ncid-worker2\n'
    [ -z "${"$"}{STUB_BIG_OUTPUT:-}" ] || seq 1 200000 ;;
  "inspect -f {{.Image}} cid-web") echo sha256:oldweb ;;
  "inspect -f {{.Image}} cid-worker1") echo sha256:oldworker ;;
  "compose -p slaydx run "*) exit "${"$"}{STUB_MIGRATE_RC:-0}" ;;
  "compose -p slaydx pull "*) exit "${"$"}{STUB_PULL_RC:-0}" ;;
  "image inspect -f "*) printf '%s\n' "${"$"}{STUB_REVISION-$STUB_SHA}" ;;
  "image inspect "*) [ -z "${"$"}{STUB_IMAGE_ABSENT:-}" ] ;;
  "ps -aq --filter label=com.docker.compose.project=slaydx --filter label=com.docker.compose.oneoff=True --filter status=exited")
    [ -z "${"$"}{STUB_STALE_ONEOFF:-}" ] || printf '%s\n' $STUB_STALE_ONEOFF ;;
  "compose -p slaydx build"*) exit "${"$"}{STUB_BUILD_RC:-0}" ;;
  "compose -p slaydx ps -a --format "*)
    tag=${"$"}{SLAYDX_TAG:-local}; shown=$tag; st=running; h=healthy
    [ "${"$"}{STUB_UNHEALTHY_TAG:-}" = "$tag" ] && h=unhealthy
    [ "${"$"}{STUB_CRASH_TAG:-}" = "$tag" ] && { st=restarting; h=starting; }
    [ "${"$"}{STUB_STALE_TAG:-}" = "$tag" ] && shown=old
    echo "slaydx-web-1|web|${REG}/slaydx-web:$shown|$st|$h"
    echo "slaydx-worker-1|worker|${REG}/slaydx-worker:$tag|running|healthy"
    echo "slaydx-worker-2|worker|${REG}/slaydx-worker:$tag|running|healthy"
    [ -z "${"$"}{STUB_ONEOFF_EXITED:-}" ] || echo "slaydx-worker-run-0a1b2c3d4e5f|worker|${REG}/slaydx-worker:$tag|exited|" ;;
  *) exit 0 ;;
esac
`;

const STUB_GIT = String.raw`#!/usr/bin/env bash
printf '%s\t%s\t%s\t%s\n' git "${"$"}{SLAYDX_TAG:--}" - "$*" >> "$STUB_LOG"
case "$1" in
  rev-parse)
    if [ "$2" = HEAD ]; then echo "$STUB_HEAD"; exit 0; fi
    ref=${"$"}{4%"^{commit}"}
    if [ "$ref" = origin/main ] || [[ "$STUB_SHA" == "$ref"* ]]; then echo "$STUB_SHA"; exit 0; fi
    exit 1 ;;
  merge-base) [ "${"$"}{STUB_ON_MAIN:-1}" = 1 ] ;;
  diff) printf '%s' "${"$"}{STUB_MIGRATION_DIFF:-}" ;;
  *) exit 0 ;;
esac
`;

const STUB_CURL = String.raw`#!/usr/bin/env bash
state=absent; [ -f "$SLAYDX_STATE_DIR/current" ] && state=present
printf '%s\t%s\t%s\tstate=%s %s\n' curl "${"$"}{SLAYDX_TAG:--}" - "$state" "$*" >> "$STUB_LOG"
[ -z "${"$"}{STUB_CURL_SLEEP:-}" ] || sleep "$STUB_CURL_SLEEP"
[ -n "${"$"}{STUB_CURL_FAIL:-}" ] && exit 22
echo '{"status":"ok"}'
[ -z "${"$"}{STUB_BIG_OUTPUT:-}" ] || seq 1 200000
`;

const STUB_BACKUP = String.raw`#!/usr/bin/env bash
printf '%s\t%s\t%s\t%s\n' slaydx-backup "${"$"}{SLAYDX_TAG:--}" - "$*" >> "$STUB_LOG"
printf '%s\n' "${"$"}{SLAYDX_BACKUP_LOCAL_ONLY:-unset}" >> "$STUB_LOG.backup-mode"
exit "${"$"}{STUB_BACKUP_RC:-0}"
`;

type Call = { tool: string; tag: string; dockerConfig: string; args: string };

interface Sandbox {
  dir: string;
  app: string;
  state: string;
  backups: string;
  lock: string;
  log: string;
  env: NodeJS.ProcessEnv;
  calls(): Call[];
}

function sandbox(t: { after(fn: () => void): void }, extra: Record<string, string> = {}): Sandbox {
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-deploy-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  const app = path.join(dir, "app");
  const state = path.join(dir, "state");
  const backups = path.join(dir, "backups");
  for (const d of [bin, app]) mkdirSync(d, { recursive: true });
  const stubs: Record<string, string> = {
    docker: STUB_DOCKER,
    git: STUB_GIT,
    curl: STUB_CURL,
    "slaydx-backup": STUB_BACKUP,
  };
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(path.join(app, ".env"), "SESSION_SECRET=test-only\nPOSTGRES_PASSWORD=test-only\n");
  const log = path.join(dir, "calls.log");
  writeFileSync(log, "");
  const lock = path.join(dir, "deploy.lock");
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: dir,
    LANG: "C.UTF-8",
    STUB_LOG: log,
    STUB_SHA: SHA,
    STUB_HEAD: PREV,
    SLAYDX_APP_DIR: app,
    SLAYDX_STATE_DIR: state,
    SLAYDX_BACKUP_DIR: backups,
    SLAYDX_BACKUP_CMD: path.join(bin, "slaydx-backup"),
    SLAYDX_LOCK_FILE: lock,
    SLAYDX_DOCKER_CONFIG: path.join(dir, "docker-auth"),
    SLAYDX_HEALTH_TRIES: "3",
    SLAYDX_HEALTH_INTERVAL: "0",
    SLAYDX_MIN_FREE_GB: "0",
    SLAYDX_FOLLOW_INTERVAL: "0.05",
    ...extra,
  };
  return {
    dir,
    app,
    state,
    backups,
    lock,
    log,
    env,
    calls: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [tool, tag, dockerConfig, ...rest] = line.split("\t");
          return { tool, tag, dockerConfig, args: rest.join("\t") };
        }),
  };
}

function run(script: string, args: string[], sb: Sandbox) {
  const r = spawnSync("bash", [script, ...args], { env: sb.env, encoding: "utf8", timeout: 30_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const idx = (calls: Call[], pred: (c: Call) => boolean) => calls.findIndex(pred);
const lastIdx = (calls: Call[], pred: (c: Call) => boolean) => {
  for (let i = calls.length - 1; i >= 0; i--) if (pred(calls[i])) return i;
  return -1;
};
const isCompose = (c: Call, sub: string) => c.tool === "docker" && c.args.startsWith(`compose -p slaydx ${sub}`);

test("deploy-pull: invalid arguments exit 2 before touching anything", (t) => {
  const sb = sandbox(t);
  for (const args of [[], ["main"], ["xyz1234"], ["abc12"], ["--help"], [SHA, SHA], [`${SHA}0`], ["0123456;id"], ["--allow-destructive"], [SHA, "--force"]]) {
    const r = run(PULL, args, sb);
    assert.equal(r.code, 2, `args ${JSON.stringify(args)}: ${r.out}`);
    assert.match(r.out, /usage: slaydx-deploy <sha>/);
  }
  assert.deepEqual(sb.calls(), []);
  assert.ok(!existsSync(sb.lock), "no lock file is created for a usage error");
});

test("deploy-pull: a sha that is not on origin/main is refused before backup/pull", (t) => {
  const sb = sandbox(t, { STUB_ON_MAIN: "0" });
  const r = run(PULL, [SHA], sb);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /not on origin\/main — refusing/);
  const calls = sb.calls();
  assert.ok(calls.some((c) => c.tool === "git" && c.args === `merge-base --is-ancestor ${SHA} origin/main`));
  assert.equal(idx(calls, (c) => c.tool === "slaydx-backup"), -1);
  assert.equal(idx(calls, (c) => c.tool === "docker" && /manifest|pull|up|run/.test(c.args)), -1);
  assert.equal(idx(calls, (c) => c.tool === "git" && c.args.startsWith("reset")), -1);
});

test("deploy-pull: an unknown commit is refused", (t) => {
  const sb = sandbox(t);
  const r = run(PULL, ["deadbee"], sb);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /commit not found: deadbee/);
  assert.equal(idx(sb.calls(), (c) => c.tool === "slaydx-backup"), -1);
});

test("deploy-pull: a sha whose promoted image tag is missing is refused (both images checked)", (t) => {
  for (const missing of ["slaydx-web:", "slaydx-worker:"]) {
    const sb = sandbox(t, { STUB_MISSING_MANIFEST: missing });
    const r = run(PULL, [SHA], sb);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`${missing}${SHA} not in the registry`));
    const calls = sb.calls();
    assert.equal(idx(calls, (c) => c.tool === "slaydx-backup"), -1, "no backup for a refused deploy");
    assert.equal(idx(calls, (c) => isCompose(c, "pull") || isCompose(c, "up")), -1);
  }
});

test("deploy-pull: success path runs backup → pull → migrate → up → health → state file, all on the new tag", (t) => {
  const sb = sandbox(t);
  const r = run(PULL, [SHA.slice(0, 7)], sb);
  assert.equal(r.code, 0, r.out);
  const calls = sb.calls();

  const manifest = idx(calls, (c) => c.args === `manifest inspect ${REG}/slaydx-worker:${SHA}`);
  const backup = idx(calls, (c) => c.tool === "slaydx-backup");
  const tagRollback = idx(calls, (c) => c.args === `tag sha256:oldweb ${REG}/slaydx-web:rollback`);
  const pull = idx(calls, (c) => isCompose(c, "pull web worker"));
  const checkout = idx(calls, (c) => c.tool === "git" && c.args === `reset --quiet --hard ${SHA}`);
  const migrate = idx(calls, (c) => isCompose(c, "run --rm --no-deps -T worker") && c.args.includes("scripts/migrate.ts"));
  const up = idx(calls, (c) => isCompose(c, "up -d --no-build"));
  const health = idx(calls, (c) => isCompose(c, "ps -a --format"));
  const curl = idx(calls, (c) => c.tool === "curl");
  const order = { manifest, backup, tagRollback, checkout, pull, migrate, up, health, curl };
  for (const [k, v] of Object.entries(order)) assert.ok(v >= 0, `${k} missing:\n${r.out}`);
  assert.ok(
    manifest < backup && backup < tagRollback && tagRollback < checkout && checkout < pull &&
      pull < migrate && migrate < up && up < health && health < curl,
    `order ${JSON.stringify(order)}`,
  );
  assert.ok(calls.some((c) => c.args === `tag sha256:oldworker ${REG}/slaydx-worker:rollback`));

  // Pull, migrate, up and health ran with the NEW tag; the state file appeared only after health.
  for (const i of [pull, migrate, up, health]) assert.equal(calls[i].tag, SHA, calls[i].args);
  assert.match(calls[curl].args, /^state=absent /);
  assert.equal(readFileSync(path.join(sb.state, "current"), "utf8"), `${SHA}\n`);
  assert.match(readFileSync(path.join(sb.state, "current.env"), "utf8"), new RegExp(`^sha=${SHA}\ntag=${SHA}\nmode=pull\n`));
  assert.match(readFileSync(path.join(sb.state, "history.log"), "utf8"), new RegExp(` ${SHA} ok \\d+s prev=${PREV}\n$`));

  // `.env` now pins the tag for manual compose commands; the other lines are untouched.
  assert.equal(
    readFileSync(path.join(sb.app, ".env"), "utf8"),
    `SESSION_SECRET=test-only\nPOSTGRES_PASSWORD=test-only\n\n# Managed by slaydx-deploy / deploy-build.sh: image tag compose runs.\nSLAYDX_TAG=${SHA}\n`,
  );
  // ROLLBACK.txt: line 1 = previous sha (manual procedure), then tag + exact image ids.
  assert.equal(
    readFileSync(path.join(sb.backups, "ROLLBACK.txt"), "utf8").split("\n").slice(0, 4).join("\n"),
    `${PREV}\ntag=local\nweb_image=sha256:oldweb\nworker_image=sha256:oldworker`,
  );

  // Registry access only through the slaydx DOCKER_CONFIG; every compose call is `-p slaydx`.
  for (const c of calls.filter((x) => x.tool === "docker")) {
    assert.equal(c.dockerConfig, path.join(sb.dir, "docker-auth"), c.args);
    if (c.args.startsWith("compose") && c.args !== "compose version") assert.match(c.args, /^compose -p slaydx /);
    assert.doesNotMatch(c.args, /prune|^(rm|rmi|stop|kill)\b|^compose -p slaydx (down|rm|stop|kill)\b/);
  }
  assert.match(r.out, /deployed 0123456 in \d+s — validate=\d+s backup=\d+s rollback-point=\d+s pull=\d+s migrate=\d+s up=\d+s health=\d+s/);
});

test("deploy-pull: an existing SLAYDX_TAG line in .env is replaced, not duplicated", (t) => {
  const sb = sandbox(t);
  writeFileSync(path.join(sb.app, ".env"), `A=1\nSLAYDX_TAG=${PREV}\nB=2\n`);
  mkdirSync(sb.state, { recursive: true });
  writeFileSync(path.join(sb.state, "current.env"), `sha=${PREV}\ntag=${PREV}\nmode=pull\n`);
  const r = run(PULL, [SHA], sb);
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(path.join(sb.app, ".env"), "utf8"), `A=1\nSLAYDX_TAG=${SHA}\nB=2\n`);
  assert.match(readFileSync(path.join(sb.backups, "ROLLBACK.txt"), "utf8"), new RegExp(`^${PREV}\ntag=${PREV}\n`));
});

test("deploy-pull: health failure rolls back to the previous images automatically and exits 1", (t) => {
  const sb = sandbox(t, { STUB_UNHEALTHY_TAG: SHA });
  writeFileSync(path.join(sb.app, ".env"), `SLAYDX_TAG=${PREV}\n`);
  mkdirSync(sb.state, { recursive: true });
  writeFileSync(path.join(sb.state, "current"), `${PREV}\n`);
  writeFileSync(path.join(sb.state, "current.env"), `sha=${PREV}\ntag=${PREV}\nmode=pull\n`);
  const r = run(PULL, [SHA], sb);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /health check failed/);
  assert.match(r.out, /rolled back: previous images are serving again/);
  const calls = sb.calls();
  const upNew = idx(calls, (c) => isCompose(c, "up -d --no-build") && c.tag === SHA);
  const logs = idx(calls, (c) => isCompose(c, "logs --tail=60 web worker"));
  const resetBack = lastIdx(calls, (c) => c.tool === "git" && c.args === `reset --quiet --hard ${PREV}`);
  const upOld = idx(calls, (c) => isCompose(c, "up -d --no-build") && c.tag === "rollback");
  assert.ok(upNew >= 0 && logs > upNew && resetBack > logs && upOld > resetBack, JSON.stringify({ upNew, logs, resetBack, upOld }));
  // New version polled exactly HEALTH_TRIES times, then the rollback was health-checked too.
  assert.equal(calls.filter((c) => isCompose(c, "ps -a --format") && c.tag === SHA).length, 3);
  assert.ok(calls.some((c) => isCompose(c, "ps -a --format") && c.tag === "rollback"));
  // Nothing claims the failed version: state, .env tag unchanged; history records the failure.
  assert.equal(readFileSync(path.join(sb.state, "current"), "utf8"), `${PREV}\n`);
  assert.equal(readFileSync(path.join(sb.app, ".env"), "utf8"), `SLAYDX_TAG=${PREV}\n`);
  assert.match(readFileSync(path.join(sb.state, "history.log"), "utf8"), new RegExp(`${SHA} FAILED rolled_back_to=${PREV}`));
});

test("deploy-pull: health requires the containers to run the NEW image and fails fast on a crash loop", (t) => {
  const stale = sandbox(t, { STUB_STALE_TAG: SHA });
  const r1 = run(PULL, [SHA], stale);
  assert.equal(r1.code, 1, r1.out);
  assert.ok(stale.calls().some((c) => isCompose(c, "up -d --no-build") && c.tag === "rollback"));

  const crash = sandbox(t, { STUB_CRASH_TAG: SHA, SLAYDX_HEALTH_TRIES: "5" });
  const r2 = run(PULL, [SHA], crash);
  assert.equal(r2.code, 1, r2.out);
  assert.match(r2.out, /restarting\/exited/);
  assert.equal(crash.calls().filter((c) => isCompose(c, "ps -a --format") && c.tag === SHA).length, 1);
  assert.ok(crash.calls().some((c) => isCompose(c, "up -d --no-build") && c.tag === "rollback"));
});

test("deploy-pull: /api/health failing (containers healthy) also rolls back", (t) => {
  const sb = sandbox(t, { STUB_CURL_FAIL: "1" });
  const r = run(PULL, [SHA], sb);
  assert.equal(r.code, 1, r.out);
  assert.ok(sb.calls().some((c) => isCompose(c, "up -d --no-build") && c.tag === "rollback"));
  assert.ok(!existsSync(path.join(sb.state, "current")));
});

test("deploy-pull: a failing migration aborts before the swap and restores the checkout", (t) => {
  const sb = sandbox(t, { STUB_MIGRATE_RC: "1" });
  const r = run(PULL, [SHA], sb);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /migration failed — old version keeps serving/);
  const calls = sb.calls();
  assert.equal(idx(calls, (c) => isCompose(c, "up")), -1, "containers were not touched");
  const fwd = idx(calls, (c) => c.tool === "git" && c.args === `reset --quiet --hard ${SHA}`);
  const back = idx(calls, (c) => c.tool === "git" && c.args === `reset --quiet --hard ${PREV}`);
  assert.ok(fwd >= 0 && back > fwd);
  assert.ok(!existsSync(path.join(sb.state, "current")));
});

test("deploy-pull: a failed pull (or an image still absent after it) aborts before the swap and restores the checkout", (t) => {
  for (const [extra, msg] of [
    [{ STUB_PULL_RC: "1" }, /pull failed/],
    [{ STUB_IMAGE_ABSENT: "1" }, new RegExp(`slaydx-web:${SHA} missing after pull`)],
  ] as const) {
    const sb = sandbox(t, extra);
    const r = run(PULL, [SHA], sb);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, msg);
    assert.match(r.out, /aborted before the swap/);
    const calls = sb.calls();
    assert.equal(idx(calls, (c) => isCompose(c, "run") || isCompose(c, "up")), -1);
    const fwd = idx(calls, (c) => c.tool === "git" && c.args === `reset --quiet --hard ${SHA}`);
    const back = idx(calls, (c) => c.tool === "git" && c.args === `reset --quiet --hard ${PREV}`);
    assert.ok(fwd >= 0 && back > fwd, JSON.stringify({ fwd, back }));
  }
});

test("deploy-pull: a failing backup stops the deploy before pull", (t) => {
  const sb = sandbox(t, { STUB_BACKUP_RC: "3" });
  const r = run(PULL, [SHA], sb);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /backup failed/);
  assert.equal(idx(sb.calls(), (c) => isCompose(c, "pull") || isCompose(c, "run") || isCompose(c, "up")), -1);
});

test("deploy-pull: without running containers it deploys but reports that no rollback is possible", (t) => {
  const sb = sandbox(t, { STUB_NO_RUNNING: "1", STUB_UNHEALTHY_TAG: SHA });
  const r = run(PULL, [SHA], sb);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no automatic rollback possible/);
  assert.match(r.out, /nothing to roll back to/);
  assert.equal(idx(sb.calls(), (c) => c.tag === "rollback"), -1);
});

test("deploy-pull and deploy-build: long command output never SIGPIPEs the script under pipefail", (t) => {
  // `cmd | head -n 1` / `curl | grep -q` exit early and kill the writer with SIGPIPE (exit 141
  // under pipefail) — seen once with 2 worker ids; a long output makes it deterministic.
  for (const script of [PULL, BUILD]) {
    const sb = sandbox(t, { STUB_BIG_OUTPUT: "1" });
    const r = run(script, [SHA], sb);
    assert.equal(r.code, 0, `${path.basename(script)}: ${r.out}`);
    assert.match(readFileSync(path.join(sb.backups, "ROLLBACK.txt"), "utf8"), /\nworker_image=sha256:oldworker\n/);
    assert.equal(readFileSync(path.join(sb.state, "current"), "utf8"), `${SHA}\n`);
  }
});

function deployLog(sb: Sandbox): string {
  const names = existsSync(sb.backups) ? readdirSync(sb.backups).filter((n) => /^deploy-.*\.log$/.test(n)) : [];
  assert.equal(names.length, 1, `one deploy log expected, got ${JSON.stringify(names)}`);
  return path.join(sb.backups, names[0]);
}

async function waitFor(what: string, cond: () => boolean, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

test("deploy-pull: runs detached — log file under the backup dir, exit code in last-run.env, swap leaves postgres alone", (t) => {
  const sb = sandbox(t);
  const r = run(PULL, [SHA], sb);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /deploy started detached \(run [0-9-]+\); log: .*\/backups\/deploy-[0-9-]+-0123456\.log/);
  const logText = readFileSync(deployLog(sb), "utf8");
  assert.match(logText, /deployed 0123456 in \d+s/);
  assert.ok(r.out.includes("deployed 0123456"), "the launcher relays the log");
  assert.match(readFileSync(path.join(sb.state, "last-run.env"), "utf8"), new RegExp(`^run=[0-9-]+\nsha=${SHA}\nrc=0\nlog=.*deploy-`));
  assert.deepEqual(readdirSync(path.join(sb.state, "runs")), [], "the per-run status file is consumed");
  const ups = sb.calls().filter((c) => isCompose(c, "up"));
  assert.deepEqual(ups.map((c) => c.args), ["compose -p slaydx up -d --no-build --no-deps web worker"]);
});

test("deploy-pull: the deploy survives the operator's session dying after the swap and still rolls back", async (t) => {
  // = an SSH drop: the launcher (the process attached to the session) is killed mid-health-check.
  const sb = sandbox(t, { STUB_UNHEALTHY_TAG: SHA, SLAYDX_HEALTH_TRIES: "6", SLAYDX_HEALTH_INTERVAL: "0.3" });
  // `detached: true` puts the launcher in its own process group, standing in for the SSH session;
  // the whole group is then killed, as a session teardown would.
  const launcher = spawn("bash", [PULL, SHA], { env: sb.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  launcher.stdout.resume();
  launcher.stderr.resume();
  await waitFor("the swap", () => sb.calls().some((c) => isCompose(c, "up") && c.tag === SHA));
  assert.ok(!sb.calls().some((c) => c.tag === "rollback" && isCompose(c, "up")), "killed before the rollback");
  process.kill(-launcher.pid!, "SIGHUP");
  process.kill(-launcher.pid!, "SIGKILL");
  await waitFor("the detached deploy to finish", () => existsSync(path.join(sb.state, "last-run.env")));
  assert.match(readFileSync(path.join(sb.state, "last-run.env"), "utf8"), /\nrc=1\n/);
  assert.ok(sb.calls().some((c) => c.tag === "rollback" && c.args === "compose -p slaydx up -d --no-build --no-deps web worker"));
  assert.match(readFileSync(path.join(sb.state, "history.log"), "utf8"), new RegExp(`${SHA} FAILED rolled_back_to=${PREV}`));
  assert.match(readFileSync(deployLog(sb), "utf8"), /rolled back: previous images are serving again/);
});

test("deploy-pull: with its own stdout closed mid-deploy (no detach) the script still rolls back instead of dying of SIGPIPE", async (t) => {
  const sb = sandbox(t, { STUB_UNHEALTHY_TAG: SHA, SLAYDX_DEPLOY_DETACHED: "1" });
  const child = spawn("bash", [PULL, SHA], { env: sb.env, stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise<void>((res) => {
    child.stdout.once("data", () => {
      child.stdout.destroy();
      child.stderr.destroy();
      res();
    });
  });
  const code = await new Promise<number | null>((res) => child.on("exit", (c) => res(c)));
  await closed;
  assert.equal(code, 1, "rolled back and exited 1 (141 = killed by SIGPIPE)");
  assert.ok(sb.calls().some((c) => c.tag === "rollback" && isCompose(c, "up")));
  assert.match(readFileSync(path.join(sb.state, "history.log"), "utf8"), /FAILED rolled_back_to=/);
});

test("deploy-pull: exited one-off containers neither fail the health check nor survive the next migration", (t) => {
  const sb = sandbox(t, { STUB_ONEOFF_EXITED: "1", STUB_STALE_ONEOFF: "0a1b2c3d4e5f 9f8e7d6c5b4a" });
  const r = run(PULL, [SHA], sb);
  assert.equal(r.code, 0, r.out);
  const calls = sb.calls();
  const rm = idx(calls, (c) => c.args === "rm 0a1b2c3d4e5f 9f8e7d6c5b4a");
  const migrate = idx(calls, (c) => isCompose(c, "run --rm"));
  assert.ok(rm >= 0 && rm < migrate, JSON.stringify({ rm, migrate }));
  assert.equal(idx(calls, (c) => c.tag === "rollback" && isCompose(c, "up")), -1);
  // Nothing stale → nothing removed.
  const clean = sandbox(t);
  assert.equal(run(PULL, [SHA], clean).code, 0);
  assert.equal(idx(clean.calls(), (c) => c.args.startsWith("rm ")), -1);
});

test("deploy-pull: destructive migration statements are refused unless --allow-destructive", (t) => {
  const drop = "diff --git a/x b/x\n+++ b/lib/server/migrations/040_x.sql\n+-- comment: DROP is fine here\n+ALTER TABLE users DROP COLUMN legacy;\n";
  const refused = sandbox(t, { STUB_MIGRATION_DIFF: drop });
  const r = run(PULL, [SHA], refused);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ALTER TABLE USERS DROP COLUMN LEGACY;/);
  assert.match(r.out, /refusing: an automatic rollback would run the old code on this schema/);
  assert.ok(refused.calls().some((c) => c.tool === "git" && c.args === `diff ${PREV} ${SHA} -- lib/server/migrations`));
  assert.equal(idx(refused.calls(), (c) => c.tool === "slaydx-backup"), -1);

  for (const sql of ["+alter table x alter column y type bigint;\n", "+ALTER TABLE x RENAME TO y;\n", "+truncate t;\n", "+ALTER TABLE x ALTER COLUMN y SET NOT NULL;\n"]) {
    const sb = sandbox(t, { STUB_MIGRATION_DIFF: sql });
    assert.equal(run(PULL, [SHA], sb).code, 1, sql);
  }

  const allowed = sandbox(t, { STUB_MIGRATION_DIFF: drop });
  const ok = run(PULL, [SHA, "--allow-destructive"], allowed);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /--allow-destructive given: continuing/);

  // Additive changes and comment-only mentions pass; removed lines (`-`) do not count.
  const additive = sandbox(t, {
    STUB_MIGRATION_DIFF: "+++ b/lib/server/migrations/040_x.sql\n+-- we never DROP here\n+CREATE TABLE dropbox_links (id int);\n-DROP TABLE old;\n",
  });
  const r3 = run(PULL, [SHA], additive);
  assert.equal(r3.code, 0, r3.out);
});

test("deploy-pull: the pulled images must carry this commit's revision label (missing label = warning)", (t) => {
  const wrong = sandbox(t, { STUB_REVISION: PREV });
  const r = run(PULL, [SHA], wrong);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`slaydx-web:${SHA} is labelled revision=${PREV}, expected ${SHA}`));
  assert.equal(idx(wrong.calls(), (c) => isCompose(c, "run") || isCompose(c, "up")), -1);

  const missing = sandbox(t, { STUB_REVISION: "" });
  const r2 = run(PULL, [SHA], missing);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /WARNING: .*slaydx-worker:\w+ has no revision label/);
});

test("install-deploy: refuses to copy a compose plugin that is not owned by root", (t) => {
  const sb = sandbox(t, { STUB_COMPOSE_VERSION_RC: "1" });
  const plugin = path.join(sb.dir, ".docker/cli-plugins/docker-compose");
  mkdirSync(path.dirname(plugin), { recursive: true });
  writeFileSync(plugin, "#!/bin/sh\n");
  chmodSync(plugin, 0o755);
  const r = spawnSync("bash", [INSTALL], { env: { ...sb.env, SLAYDX_BIN_DIR: path.join(sb.dir, "bin2") }, encoding: "utf8" });
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /is not owned by root — refusing/);
  assert.ok(!existsSync(path.join(sb.dir, "docker-auth/cli-plugins/docker-compose")));
});

async function holdLock(lock: string): Promise<ChildProcess> {
  const holder = spawn("flock", [lock, "sleep", "30"], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    const probe = spawnSync("flock", ["-n", lock, "true"]);
    if (probe.status !== 0) return holder;
    await new Promise((res) => setTimeout(res, 50));
  }
  holder.kill();
  throw new Error("could not take the test lock");
}

test("deploy-pull and deploy-build: a concurrent deploy is refused (shared lock)", async (t) => {
  const sb = sandbox(t);
  const holder = await holdLock(sb.lock);
  t.after(() => holder.kill());
  for (const script of [PULL, BUILD]) {
    const r = run(script, [SHA], sb);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /another deploy is running/);
  }
  // The detached deploy re-checks the lock itself (the launcher's check is only a fast path).
  const direct = run(PULL, [SHA], { ...sb, env: { ...sb.env, SLAYDX_DEPLOY_DETACHED: "1" } });
  assert.equal(direct.code, 1, direct.out);
  assert.match(direct.out, /another deploy is running/);
  assert.deepEqual(sb.calls(), []);
});

test("deploy-build: fallback builds :local after backup, then up + health; refuses non-main", (t) => {
  const sb = sandbox(t);
  const r = run(BUILD, [], sb);
  assert.equal(r.code, 0, r.out);
  const calls = sb.calls();
  const backup = idx(calls, (c) => c.tool === "slaydx-backup");
  const reset = idx(calls, (c) => c.tool === "git" && c.args === `reset --quiet --hard ${SHA}`);
  const build = idx(calls, (c) => isCompose(c, "build"));
  const up = idx(calls, (c) => isCompose(c, "up -d"));
  const curl = idx(calls, (c) => c.tool === "curl");
  assert.ok(backup >= 0 && backup < reset && reset < build && build < up && up < curl, JSON.stringify({ backup, reset, build, up, curl }));
  assert.equal(calls[build].tag, "local");
  assert.equal(calls[up].tag, "local");
  assert.equal(readFileSync(path.join(sb.state, "current"), "utf8"), `${SHA}\n`);
  assert.match(readFileSync(path.join(sb.state, "current.env"), "utf8"), /^sha=\w+\ntag=local\nmode=build\n/);
  assert.match(readFileSync(path.join(sb.app, ".env"), "utf8"), /\nSLAYDX_TAG=local\n$/);
  assert.match(readFileSync(path.join(sb.backups, "ROLLBACK.txt"), "utf8"), new RegExp(`^${PREV}\ntag=local\nweb_image=sha256:oldweb\n`));
  for (const c of calls) assert.doesNotMatch(c.args, /prune/);

  const off = sandbox(t, { STUB_ON_MAIN: "0" });
  const r2 = run(BUILD, [SHA], off);
  assert.equal(r2.code, 1, r2.out);
  assert.match(r2.out, /not on origin\/main/);
  assert.equal(idx(off.calls(), (c) => c.tool === "slaydx-backup" || isCompose(c, "build")), -1);

  const bad = run(BUILD, ["not-a-sha"], off);
  assert.equal(bad.code, 2, bad.out);
});

test("deploy-build: a failed health check exits 1 with the manual rollback command and keeps .env", (t) => {
  const sb = sandbox(t, { STUB_CURL_FAIL: "1" });
  const r = run(BUILD, [SHA], sb);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SLAYDX_TAG=rollback docker compose -p slaydx up -d --no-build/);
  assert.equal(readFileSync(path.join(sb.app, ".env"), "utf8"), "SESSION_SECRET=test-only\nPOSTGRES_PASSWORD=test-only\n");
  assert.ok(!existsSync(path.join(sb.state, "current")));
});

test("install-deploy: installs root-only copies (not symlinks) of both scripts", (t) => {
  const sb = sandbox(t);
  const binDir = path.join(sb.dir, "usr-local-bin");
  const r = spawnSync("bash", [INSTALL], {
    env: { ...sb.env, SLAYDX_BIN_DIR: binDir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  for (const [name, src] of [["slaydx-deploy", PULL], ["slaydx-deploy-build", BUILD]] as const) {
    const dest = path.join(binDir, name);
    const st = statSync(dest);
    assert.ok(st.isFile(), `${name} is a regular file`);
    assert.equal(st.mode & 0o777, 0o750);
    assert.equal(readFileSync(dest, "utf8"), readFileSync(src, "utf8"));
  }
  assert.equal(statSync(path.join(sb.dir, "docker-auth")).mode & 0o777, 0o700);
  assert.match(r.stdout, /docker login ghcr.io -u <github-user> --password-stdin/);
});

test("deploy scripts: bash -n, no daemon-global prune, every compose call scoped to -p slaydx", () => {
  for (const f of [PULL, BUILD, INSTALL]) {
    execFileSync("bash", ["-n", f], { stdio: "pipe" });
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /system prune|volume prune|builder prune|image prune/);
    for (const m of src.matchAll(/docker compose (\S+)/g)) {
      assert.ok(m[1] === "-p" || m[1] === "version", `unscoped compose call: ${m[0]}`);
    }
  }
});

test("deploy scripts: shellcheck clean (when shellcheck is installed — CI runners have it)", (t) => {
  const has = spawnSync("shellcheck", ["--version"]).status === 0;
  if (!has) {
    t.skip("shellcheck not installed");
    return;
  }
  const r = spawnSync("shellcheck", ["-S", "style", PULL, BUILD, INSTALL], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
});

test("docker-compose: web/worker run the tagged GHCR image, keep build: for the fallback; postgres planner flags", () => {
  const yaml = readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
  for (const [svc, target] of [["web", "runner"], ["worker", "worker"]] as const) {
    const start = yaml.indexOf(`\n  ${svc}:\n`);
    assert.ok(start >= 0, svc);
    const rest = yaml.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z]/);
    const own = next >= 0 ? rest.slice(0, next + 1) : rest;
    assert.match(own, new RegExp(`\\n    image: ${REG.replace(/\./g, "\\.")}/slaydx-${svc}:\\$\\{SLAYDX_TAG:-local\\}\\n`));
    assert.match(own, new RegExp(`\\n    build:\\n      context: \\.\\n[\\s\\S]*?      target: ${target}\\n`));
  }
  for (const flag of ["effective_cache_size=640MB", "random_page_cost=1.1", "log_autovacuum_min_duration=5s"]) {
    assert.match(yaml, new RegExp(`\\n      - -c\\n      - ${flag.replace(/\./g, "\\.")}\\n`));
  }
});

test("deploy-pull and deploy-build: the pre-deploy backup runs LOCAL-ONLY (the deploy must not wait for the Drive upload)", (t) => {
  for (const script of [PULL, BUILD]) {
    const sb = sandbox(t);
    const r = run(script, script === PULL ? [SHA.slice(0, 7)] : [], sb);
    assert.equal(r.code, 0, `${path.basename(script)}: ${r.out}`);
    const modes = readFileSync(`${sb.log}.backup-mode`, "utf8").split("\n").filter(Boolean);
    assert.deepEqual(modes, ["1"], `${path.basename(script)} must call slaydx-backup with SLAYDX_BACKUP_LOCAL_ONLY=1`);
  }
});

test("deploy/slaydx-backup: local-only is forwarded to backup.sh as BACKUP_LOCAL_ONLY; the nightly call is not local-only; overlapping runs are skipped", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-backup-wrapper-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, "backup.env");
  writeFileSync(envFile, "BACKUP_REMOTE=stub:remote\nBACKUP_TG_CHAT=1\n", { mode: 0o600 });
  const out = path.join(dir, "seen.txt");
  const fake = path.join(dir, "backup.sh");
  writeFileSync(fake, `#!/bin/bash\nprintf '%s|%s\\n' "\${BACKUP_LOCAL_ONLY:-unset}" "\${BACKUP_REMOTE:-}" >> "${out}"\n`);
  chmodSync(fake, 0o755);
  const base = {
    PATH: "/usr/bin:/bin",
    SLAYDX_BACKUP_ENV: envFile,
    SLAYDX_BACKUP_SCRIPT: fake,
    SLAYDX_BACKUP_LOCK: path.join(dir, "lock"),
  };
  const wrapper = path.join(ROOT, "deploy/slaydx-backup");
  assert.equal(spawnSync("bash", [wrapper], { env: base }).status, 0);
  assert.equal(spawnSync("bash", [wrapper], { env: { ...base, SLAYDX_BACKUP_LOCAL_ONLY: "1" } }).status, 0);
  assert.deepEqual(readFileSync(out, "utf8").split("\n").filter(Boolean), ["unset|stub:remote", "1|stub:remote"]);
  // The old "delete remote copies older than N days" step must stay gone (it deletes the GFS monthly copies).
  assert.ok(!/rclone delete/.test(readFileSync(wrapper, "utf8")), "wrapper must not prune the remote itself");
  // A second run while the lock is held is skipped, not run twice.
  const holder = spawn("bash", ["-c", `exec 9>"${path.join(dir, "lock")}"; flock 9; sleep 3`]);
  t.after(() => holder.kill());
  const start = Date.now();
  while (Date.now() - start < 2000 && !spawnSync("bash", ["-c", `flock -n "${path.join(dir, "lock")}" true`]).status) {
    spawnSync("sleep", ["0.1"]);
  }
  const r = spawnSync("bash", [wrapper], { env: base, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /another backup is running/);
  assert.equal(readFileSync(out, "utf8").split("\n").filter(Boolean).length, 2, "the locked run must not execute backup.sh");
});

test("deploy/install-ops.sh: installs backup + watchdog cron and logrotate into the given dirs, idempotently, alert-only", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-install-ops-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, "app");
  const bin = path.join(dir, "bin");
  mkdirSync(path.join(app, "scripts"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  for (const s of ["watchdog.sh", "backup-ledger.sh", "restore-check.sh"]) writeFileSync(path.join(app, "scripts", s), "#!/bin/bash\n");
  writeFileSync(path.join(bin, "slaydx-backup"), "#!/bin/bash\n");
  chmodSync(path.join(bin, "slaydx-backup"), 0o755);
  const env = {
    PATH: "/usr/bin:/bin",
    SLAYDX_APP_DIR: app,
    SLAYDX_BIN_DIR: bin,
    SLAYDX_CRON_DIR: path.join(dir, "cron.d"),
    SLAYDX_LOGROTATE_DIR: path.join(dir, "logrotate.d"),
  };
  const script = path.join(ROOT, "deploy/install-ops.sh");
  const first = spawnSync("bash", [script], { env, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const backup = readFileSync(path.join(dir, "cron.d/slaydx-backup"), "utf8");
  const watchdog = readFileSync(path.join(dir, "cron.d/slaydx-watchdog"), "utf8");
  assert.match(backup, new RegExp(`^30 1 \\* \\* \\* root umask 077; ${bin}/slaydx-backup >> /var/log/slaydx-backup\\.log 2>&1$`, "m"));
  assert.match(backup, new RegExp(`^5 \\* \\* \\* \\* root umask 077; ${app}/scripts/backup-ledger\\.sh `, "m"));
  assert.match(backup, new RegExp(`^0 5 \\* \\* 0 root umask 077; ${app}/scripts/restore-check\\.sh `, "m"));
  assert.match(watchdog, new RegExp(`^\\*/3 \\* \\* \\* \\* root umask 077; ${app}/scripts/watchdog\\.sh `, "m"));
  assert.match(watchdog, new RegExp(`^0 6 \\* \\* \\* root umask 077; ${app}/scripts/watchdog\\.sh --digest `, "m"));
  const jobs = watchdog.split("\n").filter((l) => l && !l.startsWith("#"));
  assert.equal(jobs.length, 2, "exactly the check and the digest job");
  assert.ok(jobs.every((l) => !/AUTO_RESTART/.test(l)), "auto-restart stays off (alert-only for the first week)");
  assert.match(readFileSync(path.join(dir, "logrotate.d/slaydx-ops"), "utf8"), /create 0600 root root/);
  // Idempotent: a second run rewrites the same content.
  assert.equal(spawnSync("bash", [script], { env, encoding: "utf8" }).status, 0);
  assert.equal(readFileSync(path.join(dir, "cron.d/slaydx-backup"), "utf8"), backup);
  // --dry-run writes nothing.
  const dry = mkdtempSync(path.join(tmpdir(), "slaydx-install-ops-dry-"));
  t.after(() => rmSync(dry, { recursive: true, force: true }));
  const r = spawnSync("bash", [script, "--dry-run"], { env: { ...env, SLAYDX_CRON_DIR: path.join(dry, "c"), SLAYDX_LOGROTATE_DIR: path.join(dry, "l") }, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /watchdog\.sh --digest/);
  assert.ok(!existsSync(path.join(dry, "c")), "dry-run must not create anything");
  // A missing script (not deployed yet) is refused instead of installing cron lines that fail every run.
  rmSync(path.join(app, "scripts/watchdog.sh"));
  const miss = spawnSync("bash", [script], { env, encoding: "utf8" });
  assert.equal(miss.status, 1);
  assert.match(miss.stderr, /watchdog\.sh not found/);
});
