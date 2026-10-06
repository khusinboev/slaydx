import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * deploy/auto-deploy.sh (pull-based auto-deploy, cron every minute). Every decision rule is exercised with stubbed
 * `git`, `docker`, `slaydx-deploy` and `curl` on PATH — nothing touches a real repo, registry or server.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "deploy/auto-deploy.sh");
const CUR = "a".repeat(40);
const TIP = "b".repeat(40);

const STUB_GIT = `#!/bin/bash
echo "git $*" >> "$STUB_LOG"
case "$1" in
  fetch) exit "\${STUB_FETCH_RC:-0}" ;;
  rev-parse) echo "\${STUB_TIP}" ;;
  merge-base) exit "\${STUB_ANCESTOR_RC:-0}" ;;
  diff) if [ -n "\${STUB_FILES_FILE:-}" ]; then tr '\\n' '\\0' < "$STUB_FILES_FILE"; else printf '%s\\0' \${STUB_FILES}; fi ;;
  log) case "$3" in --format=%B) printf '%s\\n' "\${STUB_MSG:-feat: change}" ;; --format=%ct) echo "\${STUB_CT:-$(date +%s)}" ;; *) printf '%s\\n' "\${STUB_SUBJECT:-feat: change}" ;; esac ;;
  reset) exit 0 ;;
esac
`;
const STUB_DOCKER = `#!/bin/bash
echo "docker $*" >> "$STUB_LOG"
case "$1 $2" in
  "manifest inspect") case "$3" in *slaydx-web:*) exit "\${STUB_WEB_RC:-0}" ;; *) exit "\${STUB_WORKER_RC:-0}" ;; esac ;;
esac
`;
const STUB_DEPLOY = `#!/bin/bash
echo "slaydx-deploy $*" >> "$STUB_LOG"
if [ -e /proc/self/fd/8 ]; then echo "deploy-fd8: open" >> "$STUB_LOG"; else echo "deploy-fd8: closed" >> "$STUB_LOG"; fi
[ -n "\${STUB_DEPLOY_OUT:-}" ] && echo "$STUB_DEPLOY_OUT"
exit "\${STUB_DEPLOY_RC:-0}"
`;
const STUB_CURL = `#!/bin/bash
cfg=$(cat)
text=""
while [ $# -gt 0 ]; do [ "$1" = "--data-urlencode" ] && case "$2" in text=*) text="\${2#text=}";; esac; shift; done
echo "curl-text: $text" >> "$STUB_LOG"
echo "curl-has-token-in-argv: no" >> "$STUB_LOG"
`;

interface Sb {
  dir: string;
  state: string;
  env: NodeJS.ProcessEnv;
  run(extra?: Record<string, string>): { code: number; out: string };
  log(): string[];
}

function sandbox(t: { after(fn: () => void): void }, extra: Record<string, string> = {}): Sb {
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-auto-deploy-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  const app = path.join(dir, "app");
  const state = path.join(dir, "state");
  for (const d of [bin, app, state]) mkdirSync(d, { recursive: true });
  for (const [n, body] of Object.entries({ git: STUB_GIT, docker: STUB_DOCKER, "slaydx-deploy": STUB_DEPLOY, curl: STUB_CURL })) {
    writeFileSync(path.join(bin, n), body);
    chmodSync(path.join(bin, n), 0o755);
  }
  const envFile = path.join(dir, "backup.env");
  writeFileSync(envFile, "TELEGRAM_BOT_TOKEN=000000:test-token-not-real\nBACKUP_TG_CHAT=42\n", { mode: 0o600 });
  writeFileSync(path.join(state, "current.env"), `sha=${CUR}\ntag=${CUR}\nmode=pull\n`);
  const log = path.join(dir, "calls.log");
  writeFileSync(log, "");
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: dir,
    STUB_LOG: log,
    STUB_TIP: TIP,
    STUB_FILES: "lib/server/x.ts",
    SLAYDX_APP_DIR: app,
    SLAYDX_STATE_DIR: state,
    SLAYDX_DEPLOY_CMD: path.join(bin, "slaydx-deploy"),
    SLAYDX_AUTO_ENV: envFile,
    SLAYDX_AUTO_ENV_OWNER: String(process.getuid?.() ?? 0),
    SLAYDX_AUTO_LOCK: path.join(dir, "auto.lock"),
    SLAYDX_LOCK_FILE: path.join(dir, "deploy.lock"),
    SLAYDX_AUTO_DISABLE: path.join(dir, "disabled"),
    SLAYDX_DOCKER_CONFIG: path.join(dir, "docker"),
    ...extra,
  };
  return {
    dir,
    state,
    env,
    run: (more = {}) => {
      const r = spawnSync("bash", [SCRIPT], { env: { ...env, ...more }, encoding: "utf8", timeout: 20_000 });
      return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
    },
    log: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
  };
}

const deployCalls = (sb: Sb) => sb.log().filter((l) => l.startsWith("slaydx-deploy "));
const texts = (sb: Sb) => sb.log().filter((l) => l.startsWith("curl-text:"));

test("auto-deploy: bash -n", () => {
  assert.equal(spawnSync("bash", ["-n", SCRIPT]).status, 0);
});

test("auto-deploy: a promoted newer commit is deployed, announced, and recorded as seen", (t) => {
  const sb = sandbox(t);
  const r = sb.run();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(deployCalls(sb), [`slaydx-deploy ${TIP}`]);
  assert.equal(readFileSync(path.join(sb.state, "auto-seen"), "utf8").trim(), TIP);
  assert.ok(!existsSync(path.join(sb.state, "auto-failed")));
  const t1 = texts(sb);
  assert.equal(t1.length, 2, t1.join("\n"));
  assert.match(t1[0], /boshlandi: bbbbbbb/);
  assert.match(t1[1], /yangilandi: bbbbbbb/);
  assert.ok(sb.log().every((l) => !l.includes("test-token-not-real")), "the token never reaches an argv/log line");
  // The next run (same tip) does nothing.
  const before = sb.log().length;
  assert.equal(sb.run().code, 0);
  assert.equal(deployCalls(sb).length, 1);
  assert.ok(sb.log().length >= before);
});

test("auto-deploy: nothing to do when origin/main is the deployed commit", (t) => {
  const sb = sandbox(t, { STUB_TIP: CUR });
  assert.equal(sb.run().code, 0);
  assert.equal(deployCalls(sb).length, 0);
});

test("auto-deploy: images not promoted yet (CI running/failed) → no deploy, retried on the next run", (t) => {
  for (const key of ["STUB_WEB_RC", "STUB_WORKER_RC"]) {
    const sb = sandbox(t, { [key]: "1" });
    assert.equal(sb.run().code, 0);
    assert.equal(deployCalls(sb).length, 0, key);
    assert.ok(!existsSync(path.join(sb.state, "auto-seen")), "not marked seen — it must be retried");
  }
});

test("auto-deploy: docs/tests/CI/deploy-only changes are not deployed (checkout updated, marked seen)", (t) => {
  const sb = sandbox(t, { STUB_FILES: "docs/ops/PLAN.md tests/a.test.mts .github/workflows/ci.yml deploy/auto-deploy.sh README.md" });
  assert.equal(sb.run().code, 0);
  assert.equal(deployCalls(sb).length, 0);
  assert.ok(sb.log().includes(`git reset -q --hard ${TIP}`));
  assert.equal(readFileSync(path.join(sb.state, "auto-seen"), "utf8").trim(), TIP);
  // One runtime file among them → deploy.
  const sb2 = sandbox(t, { STUB_FILES: "docs/a.md lib/server/db.ts" });
  assert.equal(sb2.run().code, 0);
  assert.equal(deployCalls(sb2).length, 1);
});

test("auto-deploy: [skip deploy] in the commit message skips it", (t) => {
  const sb = sandbox(t, { STUB_MSG: "feat: wip [skip deploy]" });
  assert.equal(sb.run().code, 0);
  assert.equal(deployCalls(sb).length, 0);
  assert.equal(readFileSync(path.join(sb.state, "auto-seen"), "utf8").trim(), TIP);
});

test("auto-deploy: a failed deploy is announced and never retried for the same commit; a newer commit is tried", (t) => {
  const sb = sandbox(t, { STUB_DEPLOY_RC: "1" });
  assert.equal(sb.run().code, 0);
  assert.equal(deployCalls(sb).length, 1);
  assert.equal(readFileSync(path.join(sb.state, "auto-failed"), "utf8").trim(), TIP);
  assert.match(texts(sb).at(-1)!, /muvaffaqiyatsiz: bbbbbbb \(kod 1\)/);
  assert.equal(sb.run().code, 0);
  assert.equal(deployCalls(sb).length, 1, "no automatic retry of the same sha");
  const newer = "c".repeat(40);
  assert.equal(sb.run({ STUB_TIP: newer, STUB_DEPLOY_RC: "0" }).code, 0);
  assert.deepEqual(deployCalls(sb), [`slaydx-deploy ${TIP}`, `slaydx-deploy ${newer}`]);
});

test("auto-deploy: not a fast-forward of the deployed commit → no deploy, one warning", (t) => {
  const sb = sandbox(t, { STUB_ANCESTOR_RC: "1" });
  assert.equal(sb.run().code, 0);
  assert.equal(deployCalls(sb).length, 0);
  assert.match(texts(sb)[0], /davomi emas/);
  assert.equal(sb.run().code, 0);
  assert.equal(texts(sb).length, 1, "warned once");
});

test("auto-deploy: kill switch, missing baseline, failing fetch and a held deploy lock all leave it alone", async (t) => {
  const off = sandbox(t);
  writeFileSync(off.env.SLAYDX_AUTO_DISABLE!, "");
  assert.equal(off.run().code, 0);
  assert.equal(deployCalls(off).length, 0);
  assert.equal(off.log().length, 0, "the kill switch exits before touching git/docker");

  const nobase = sandbox(t);
  rmSync(path.join(nobase.state, "current.env"));
  assert.equal(nobase.run().code, 0);
  assert.equal(deployCalls(nobase).length, 0);

  const nofetch = sandbox(t, { STUB_FETCH_RC: "1" });
  assert.equal(nofetch.run().code, 0);
  assert.equal(deployCalls(nofetch).length, 0);

  const busy = sandbox(t);
  const holder = spawn("bash", ["-c", `exec 9>"${busy.env.SLAYDX_LOCK_FILE}"; flock 9; sleep 5`]);
  t.after(() => holder.kill());
  const start = Date.now();
  while (Date.now() - start < 3000 && spawnSync("bash", ["-c", `flock -n "${busy.env.SLAYDX_LOCK_FILE}" true`]).status === 0) {
    spawnSync("sleep", ["0.1"]);
  }
  assert.equal(busy.run().code, 0);
  assert.equal(deployCalls(busy).length, 0, "a deploy in progress is never raced");
});

test("auto-deploy: at most MAX_PER_HOUR automatic deploys per hour", (t) => {
  const sb = sandbox(t, { SLAYDX_AUTO_MAX_PER_HOUR: "2" });
  const shas = ["1", "2", "3"].map((c) => c.repeat(40));
  for (const sha of shas) sb.run({ STUB_TIP: sha });
  assert.deepEqual(deployCalls(sb), [`slaydx-deploy ${shas[0]}`, `slaydx-deploy ${shas[1]}`]);
});

test("auto-deploy: a changed-file list over the 64 KiB pipe buffer is classified correctly (no SIGPIPE mis-read as docs-only)", (t) => {
  const names = ["lib/server/x.ts"];
  for (let i = 0; i < 6000; i++) names.push(`docs/archive/some-long-directory-name-for-padding/document-number-${i}.md`);
  const file = path.join(tmpdir(), `slaydx-auto-files-${process.pid}.txt`);
  writeFileSync(file, `${names.join("\n")}\n`);
  t.after(() => rmSync(file, { force: true }));
  assert.ok(readFileSync(file).length > 300_000);
  const sb = sandbox(t, { STUB_FILES_FILE: file });
  assert.equal(sb.run().code, 0);
  assert.deepEqual(deployCalls(sb), [`slaydx-deploy ${TIP}`], "a runtime path first in a huge list must still deploy");
  // The same size of docs-only names is skipped (checkout updated, no deploy).
  writeFileSync(file, `${names.slice(1).join("\n")}\n`);
  const sb2 = sandbox(t, { STUB_FILES_FILE: file });
  assert.equal(sb2.run().code, 0);
  assert.equal(deployCalls(sb2).length, 0);
  assert.ok(sb2.log().includes(`git reset -q --hard ${TIP}`));
});

test("auto-deploy: the detached deploy does not inherit the auto lock (fd 8 closed)", (t) => {
  const sb = sandbox(t);
  assert.equal(sb.run().code, 0);
  assert.ok(sb.log().includes("deploy-fd8: closed"), sb.log().join("\n"));
});

test("auto-deploy: 'another deploy is running' from slaydx-deploy is transient — not marked seen/failed, retried next run", (t) => {
  const sb = sandbox(t, { STUB_DEPLOY_RC: "1", STUB_DEPLOY_OUT: "ERROR: another deploy is running (lock /run/lock/slaydx-deploy.lock)" });
  assert.equal(sb.run().code, 0);
  assert.ok(!existsSync(path.join(sb.state, "auto-seen")));
  assert.ok(!existsSync(path.join(sb.state, "auto-failed")));
  assert.ok(!texts(sb).some((x) => /muvaffaqiyatsiz/.test(x)), "no false failure notice");
  assert.equal(sb.run({ STUB_DEPLOY_RC: "0", STUB_DEPLOY_OUT: "" }).code, 0);
  assert.equal(deployCalls(sb).length, 2, "retried and deployed");
});

test("auto-deploy: a deploy that has held its lock for > 30 min is reported once", async (t) => {
  const sb = sandbox(t);
  writeFileSync(path.join(sb.state, "auto-started"), `${Math.floor(Date.now() / 1000) - 4000}\n`);
  const holder = spawn("bash", ["-c", `exec 9>"${sb.env.SLAYDX_LOCK_FILE}"; flock 9; sleep 6`]);
  t.after(() => holder.kill());
  const start = Date.now();
  while (Date.now() - start < 3000 && spawnSync("bash", ["-c", `flock -n "${sb.env.SLAYDX_LOCK_FILE}" true`]).status === 0) spawnSync("sleep", ["0.1"]);
  assert.equal(sb.run().code, 0);
  assert.equal(sb.run().code, 0);
  const stale = texts(sb).filter((x) => /30 daqiqadan beri/.test(x));
  assert.equal(stale.length, 1, "reported exactly once");
  assert.equal(deployCalls(sb).length, 0);
});

test("auto-deploy: an env file not owned by root (or group/world writable) is refused", (t) => {
  const wrongOwner = sandbox(t, { SLAYDX_AUTO_ENV_OWNER: "99999" });
  assert.equal(wrongOwner.run().code, 0);
  assert.equal(deployCalls(wrongOwner).length, 0);
  const writable = sandbox(t);
  chmodSync(writable.env.SLAYDX_AUTO_ENV!, 0o666);
  assert.equal(writable.run().code, 0);
  assert.equal(deployCalls(writable).length, 0);
});

test("auto-deploy: images still not promoted after 45 min → one alert, quiet log; deploy/ script changes → one install notice", (t) => {
  const old = String(Math.floor(Date.now() / 1000) - 3000);
  const sb = sandbox(t, { STUB_WEB_RC: "1", STUB_CT: old });
  const first = sb.run();
  const second = sb.run();
  assert.equal(texts(sb).filter((x) => /45 daqiqadan beri/.test(x)).length, 1, "alerted once");
  assert.equal((first.out.match(/not promoted yet/g) ?? []).length + (second.out.match(/not promoted yet/g) ?? []).length, 1, "log line written once");
  assert.equal(deployCalls(sb).length, 0);
  const sb2 = sandbox(t, { STUB_FILES: "deploy/auto-deploy.sh docs/a.md" });
  assert.equal(sb2.run().code, 0);
  assert.equal(deployCalls(sb2).length, 0);
  assert.ok(texts(sb2).some((x) => /install-deploy\.sh/.test(x)), "owner told to re-run the installers");
});
