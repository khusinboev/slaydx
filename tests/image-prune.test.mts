import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `deploy/ops/slaydx-image-prune.sh`: the daily cron that removes old slaydx-web/worker image tags (one pair per
 * deploy, ~2.8 GB, piled up to 60+ versions on the server). Runs for real (bash) against a stub `docker` first on PATH.
 *
 * Mutations (each turned a test red, then restored): the history.log keep loop removed -> «keeps the last N deployed»;
 * the `used` check removed -> «an image a container uses is kept»; `rmi -f` instead of `rmi` -> «never forces»;
 * the flock check removed -> «skips while a deploy holds the lock».
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "deploy/ops/slaydx-image-prune.sh");
const REG = "ghcr.io/khusinboev";
const sha = (n: number) => String(n).repeat(40).slice(0, 40);

const STUB_DOCKER = String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_LOG"
case "$1" in
  images) cat "$STUB_IMAGES" ;;
  ps) cat "$STUB_PS" ;;
  rmi) grep -qxF "$2" "$STUB_RMI_REFUSE" 2>/dev/null && exit 1; exit 0 ;;
esac
`;

function sandbox(t: { after(fn: () => void): void }, images: string[], ps: string[], history: string[], current: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-prune-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  const state = path.join(dir, "state");
  mkdirSync(bin);
  mkdirSync(state);
  writeFileSync(path.join(bin, "docker"), STUB_DOCKER);
  chmodSync(path.join(bin, "docker"), 0o755);
  writeFileSync(path.join(dir, "images"), images.join("\n") + "\n");
  writeFileSync(path.join(dir, "ps"), ps.join("\n") + "\n");
  writeFileSync(path.join(dir, "refuse"), "");
  writeFileSync(path.join(state, "current"), `${current}\n`);
  writeFileSync(path.join(state, "history.log"), history.join("\n") + "\n");
  const log = path.join(dir, "calls.log");
  writeFileSync(log, "");
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: dir,
    STUB_LOG: log,
    STUB_IMAGES: path.join(dir, "images"),
    STUB_PS: path.join(dir, "ps"),
    STUB_RMI_REFUSE: path.join(dir, "refuse"),
    SLAYDX_STATE_DIR: state,
    SLAYDX_LOCK_FILE: path.join(dir, "deploy.lock"),
  };
  const run = (args: string[] = [], extra: Record<string, string> = {}) =>
    spawnSync("bash", [SCRIPT, ...args], { env: { ...env, ...extra }, encoding: "utf8", timeout: 20_000 });
  const removed = () =>
    readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("rmi ")).map((l) => l.slice(4));
  return { dir, run, removed, refuse: (ref: string) => writeFileSync(path.join(dir, "refuse"), `${ref}\n`) };
}

const hist = (...shas: string[]) => shas.map((s, i) => `2026-10-2${i}T10:00:00+02:00 ${s} ok 60s prev=x`);
const pair = (tag: string) => [`${REG}/slaydx-web:${tag}`, `${REG}/slaydx-worker:${tag}`];

test("image-prune: bash -n is clean and the file is executable", () => {
  assert.equal(spawnSync("bash", ["-n", SCRIPT]).status, 0);
});

test("image-prune: keeps :rollback and the last 3 deployed shas (the current one included); removes the rest; never touches other projects", (t) => {
  const s = [1, 2, 3, 4, 5, 6].map(sha);
  const images = [
    ...s.flatMap(pair),
    ...pair("rollback"),
    "call-tizim-api:latest",
    "postgres:16-alpine",
    `${REG}/slaydx-web:<none>`,
  ];
  const sb = sandbox(t, images, [`${REG}/slaydx-web:${s[5]}`], hist(s[0], s[1], s[2], s[3], s[4], s[5]), s[5]);
  const r = sb.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(sb.removed().sort(), [...pair(s[0]), ...pair(s[1]), ...pair(s[2])].sort(), r.stdout);
  for (const kept of [s[3], s[4], s[5], "rollback"]) {
    for (const ref of pair(kept)) assert.ok(!sb.removed().includes(ref), `${ref} must be kept`);
  }
  assert.ok(!sb.removed().some((ref) => ref.startsWith("call-tizim") || ref.startsWith("postgres")));
  assert.match(r.stdout, /removed 6 tag\(s\), refused 0/);
});

test("image-prune: an image a container uses is kept even if it is old", (t) => {
  const s = [1, 2, 3, 4, 5].map(sha);
  const sb = sandbox(t, s.flatMap(pair), [`${REG}/slaydx-worker:${s[0]}`], hist(s[2], s[3], s[4]), s[4]);
  sb.run([], { SLAYDX_IMAGE_KEEP: "1" });
  assert.ok(sb.removed().includes(`${REG}/slaydx-web:${s[0]}`));
  assert.ok(!sb.removed().includes(`${REG}/slaydx-worker:${s[0]}`), "the worker image in use survives");
});

test("image-prune: never forces — a tag Docker refuses is counted, not forced", (t) => {
  const s = [1, 2, 3].map(sha);
  const sb = sandbox(t, s.flatMap(pair), [], hist(s[2]), s[2]);
  sb.refuse(`${REG}/slaydx-web:${s[0]}`);
  const r = sb.run([], { SLAYDX_IMAGE_KEEP: "1" });
  assert.equal(r.status, 0);
  assert.ok(!readFileSync(path.join(sb.dir, "calls.log"), "utf8").includes("rmi -f"));
  assert.match(r.stdout, /refused 1/);
});

test("image-prune: --dry-run removes nothing", (t) => {
  const s = [1, 2, 3, 4, 5].map(sha);
  const sb = sandbox(t, s.flatMap(pair), [], hist(s[4]), s[4]);
  const r = sb.run(["--dry-run"], { SLAYDX_IMAGE_KEEP: "1" });
  assert.equal(r.status, 0);
  assert.deepEqual(sb.removed(), []);
  assert.match(r.stdout, /dry run: 8 tag\(s\) would be removed/);
});

test("image-prune: skips while a deploy holds the lock", (t) => {
  const s = [1, 2, 3].map(sha);
  const sb = sandbox(t, s.flatMap(pair), [], hist(s[2]), s[2]);
  const lock = path.join(sb.dir, "deploy.lock");
  const r = spawnSync("flock", [lock, "bash", SCRIPT], {
    env: { PATH: `${path.join(sb.dir, "bin")}:/usr/bin:/bin`, STUB_LOG: path.join(sb.dir, "calls.log"), STUB_IMAGES: path.join(sb.dir, "images"), STUB_PS: path.join(sb.dir, "ps"), SLAYDX_STATE_DIR: path.join(sb.dir, "state"), SLAYDX_LOCK_FILE: lock },
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /a deploy is running — skipped/);
  assert.deepEqual(sb.removed(), []);
});

test("image-prune: a bad SLAYDX_IMAGE_KEEP does nothing", (t) => {
  const s = [1, 2].map(sha);
  const sb = sandbox(t, s.flatMap(pair), [], hist(s[1]), s[1]);
  const r = sb.run([], { SLAYDX_IMAGE_KEEP: "0" });
  assert.equal(r.status, 0);
  assert.deepEqual(sb.removed(), []);
});

test("install-ops.sh --dry-run: the prune cron runs daily as root from the root-owned copy, with its log rotated", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-prune-ops-"));
  try {
    const app = path.join(dir, "app");
    const bin = path.join(dir, "bin");
    mkdirSync(path.join(app, "scripts"), { recursive: true });
    mkdirSync(bin);
    for (const f of ["watchdog.sh", "backup-ledger.sh", "restore-check.sh"]) writeFileSync(path.join(app, "scripts", f), "");
    for (const b of ["slaydx-backup", "slaydx-auto-deploy"]) {
      writeFileSync(path.join(bin, b), "#!/bin/sh\n");
      chmodSync(path.join(bin, b), 0o755);
    }
    const r = spawnSync("bash", [path.join(ROOT, "deploy/install-ops.sh"), "--dry-run"], {
      env: { PATH: "/usr/bin:/bin", SLAYDX_APP_DIR: app, SLAYDX_BIN_DIR: bin, SLAYDX_CRON_DIR: path.join(dir, "cron"), SLAYDX_LOGROTATE_DIR: path.join(dir, "lr") },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`=== ${dir}/cron/slaydx-image-prune\\n[\\s\\S]*\\n20 4 \\* \\* \\* root umask 077; ${bin}/slaydx-image-prune >> /var/log/slaydx-image-prune.log 2>&1`));
    assert.match(r.stdout, /\/var\/log\/slaydx-image-prune\.log \{/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
