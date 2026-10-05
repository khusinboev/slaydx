import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Ops sprint P-OPS (docs/ops/O3-robustness-ops.md §2, §4, §6; owner decisions D3, D6 in
 * docs/ops/PLAN.md): hourly ledger dump, GFS Drive retention in backup.sh, restore drill
 * alerting/timing/pinned image, slaydx-only image cleanup, the GitHub uptime probe and
 * migration 036. Every external command (docker, rclone, curl, gh, sleep) is a stub on PATH;
 * the ledger dump and migration 036 additionally run against a real throwaway database.
 * Nothing talks to Docker, Telegram, Google Drive or GitHub.
 */

const ROOT = process.cwd();
const FAKE_TOKEN = "999000:FAKE-ops-test-token";

function stubDir(t: TestContext, stubs: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-ops-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  const stub = path.join(dir, "stub");
  mkdirSync(bin);
  mkdirSync(stub);
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const envFile = path.join(dir, "backup.env");
  writeFileSync(envFile, `TELEGRAM_BOT_TOKEN=${FAKE_TOKEN}\nBACKUP_TG_CHAT=12345\n`, { mode: 0o600 });
  const env = (extra: Record<string, string> = {}) => ({
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    LANG: "C.UTF-8",
    STUB_DIR: stub,
    BACKUP_ENV_FILE: envFile,
    ...extra,
  });
  const read = (f: string) => (existsSync(path.join(stub, f)) ? readFileSync(path.join(stub, f), "utf8") : "");
  const tg = () => read("tg.log").split("\x1e").filter(Boolean);
  return { dir, bin, stub, env, read, tg };
}

/** curl stub: records argv and the -K config; Telegram texts go to tg.log (0x1e-separated). */
const STUB_CURL = `#!/usr/bin/env bash
S="$STUB_DIR"
printf '%s\\n' "$*" >>"$S/curl-argv.log"
for a in "$@"; do
  if [ "$a" = -K ]; then
    cfg=$(cat)
    printf '%s\\n' "$cfg" >>"$S/curl-config.log"
    text="" prev=""
    for b in "$@"; do
      if [ "$prev" = --data-urlencode ]; then case "$b" in text=*) text=\${b#text=} ;; esac; fi
      prev=$b
    done
    printf '%s\\x1e' "$text" >>"$S/tg.log"
    exit 0
  fi
done
code=$(cat "$S/health-code" 2>/dev/null || echo 200)
printf '%s' "$code"
[ "$code" = 000 ] && exit 7
exit 0
`;

for (const f of ["backup-ledger.sh", "docker-cleanup.sh", "restore-check.sh", "backup.sh", "watchdog.sh"]) {
  test(`${f}: bash -n sintaksis xato bermaydi`, () => {
    execFileSync("bash", ["-n", path.join(ROOT, "scripts", f)], { stdio: "pipe" });
  });
}

/** No script may put the bot token on a command line (visible in `ps` to every user). */
test("ops skriptlari: Telegram tokeni argv'da emas (faqat curl -K - orqali)", () => {
  for (const f of ["backup.sh", "backup-ledger.sh", "restore-check.sh", "watchdog.sh"]) {
    const src = readFileSync(path.join(ROOT, "scripts", f), "utf8");
    const lines = src.split("\n").filter((l) => l.includes("TELEGRAM_BOT_TOKEN") && l.includes("api.telegram.org"));
    assert.ok(lines.length > 0, `${f}: Telegram URL topilmadi`);
    for (const l of lines) assert.match(l, /printf 'url = "https:\/\/api\.telegram\.org\/bot%s\/sendMessage"\\n' "\$TELEGRAM_BOT_TOKEN"/, `${f}: ${l.trim()}`);
  }
});

// ─────────────────────────────── backup-ledger.sh ───────────────────────────────

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("opsscripts") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

/**
 * `docker exec … pg_dump/pg_restore` are forwarded to the host's pg tools against the test
 * database, so the ledger table list is checked against the real migrated schema (--strict-names
 * fails on a missing table).
 */
const STUB_DOCKER_PG = `#!/usr/bin/env bash
S="$STUB_DIR"
printf '%s\\n' "$*" >>"$S/docker.log"
[ "$1" = exec ] || exit 0
shift
while [ "\${1:-}" = -i ]; do shift; done
shift
cmd=$1; shift
[ -f "$S/$cmd-fail" ] && { echo "$cmd: simulated failure" >&2; exit 1; }
args=()
while [ $# -gt 0 ]; do
  case "$1" in -U) shift 2 ;; *) args+=("$1"); shift ;; esac
done
case "$cmd" in
  pg_dump) db_last=\${#args[@]}; unset "args[$((db_last - 1))]"; exec pg_dump -d "$STUB_DB_URL" "\${args[@]}" ;;
  pg_restore) exec pg_restore "\${args[@]}" ;;
esac
exit 0
`;

test("migratsiya 036 + backup-ledger.sh (haqiqiy Postgres)", { skip }, async (t) => {
  const { query, queryOne, migrate, pool, transaction } = await import("../lib/server/db.ts");
  t.after(async () => {
    await pool().end().catch(() => {});
    await iso.drop();
  });
  await migrate({ lockRetryDelayMs: 50 });

  /**
   * 036 on a fresh database: the extension exists; the file is idempotent; its ROLLBACK block
   * drops it and a re-migrate restores it. Mutation: an empty DO block (no CREATE EXTENSION) — red.
   */
  await t.test("036: pg_stat_statements yaratiladi, qayta ishlatish xavfsiz, ROLLBACK ishlaydi", async () => {
    const ext = async () => (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'pg_stat_statements'`))!.n;
    assert.equal(await ext(), 1, "pg_stat_statements kengaytmasi yaratilmagan");
    const sql = readFileSync(path.join(ROOT, "lib/server/migrations/036_pg_stat_statements.sql"), "utf8");
    await transaction(async (c) => void (await c.query(sql)));
    await transaction(async (c) => void (await c.query(sql)));
    assert.equal(await ext(), 1);
    // The commented block right after `-- ROLLBACK` (same convention as tests/admin-migrations).
    const lines = sql.split("\n");
    const start = lines.findIndex((l) => /^-- ROLLBACK\b/.test(l));
    assert.ok(start >= 0, "-- ROLLBACK bloki yo'q");
    const rbLines: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i].startsWith("--"); i++) {
      if (lines[i].startsWith("--   ")) rbLines.push(lines[i].slice(5));
    }
    const rollback = rbLines.join("\n");
    assert.match(rollback, /DELETE FROM schema_migrations WHERE name = '036_pg_stat_statements\.sql';\s*$/);
    assert.match(rollback, /DROP EXTENSION IF EXISTS pg_stat_statements;/);
    await transaction(async (c) => void (await c.query(rollback)));
    assert.equal(await ext(), 0);
    await migrate({ lockRetryDelayMs: 50 });
    assert.equal(await ext(), 1, "qayta migrate kengaytmani tiklamadi");
    const applied = await query<{ name: string }>(`SELECT name FROM schema_migrations WHERE name = '036_pg_stat_statements.sql'`);
    assert.equal(applied.length, 1);
  });

  const s = stubDir(t, { docker: STUB_DOCKER_PG, curl: STUB_CURL });
  const backups = path.join(s.dir, "backups");
  const ledger = path.join(backups, "ledger");
  const env = (extra: Record<string, string> = {}) =>
    s.env({ STUB_DB_URL: process.env.DATABASE_URL!, BACKUP_DIR: backups, ...extra });
  const run = (extra: Record<string, string> = {}) =>
    spawnSync("bash", [path.join(ROOT, "scripts/backup-ledger.sh")], { env: env(extra), encoding: "utf8", timeout: 60_000 });
  await query(`INSERT INTO users (name, balance) VALUES ('Ledger test', 4200)`);

  /**
   * Mutations: drop `--strict-names` or a table from the default list — the pg_dump argv / restored
   * table list assertions turn red; prune by `-mmin +(48*60)` changed to `+(1*60)` — the 47 h file
   * disappears (red).
   */
  await t.test("ledger: 5 jadval, tasdiqlangan dump, 48 soatdan eski fayllar o'chadi, bir soatda bitta fayl", async () => {
    mkdirSync(ledger, { recursive: true });
    const old = path.join(ledger, "ledger-20200101-00.dump");
    const keep = path.join(ledger, "ledger-20200101-01.dump");
    for (const [f, h] of [[old, 49], [keep, 47]] as const) {
      writeFileSync(f, "x");
      const t0 = new Date(Date.now() - h * 3600_000);
      utimesSync(f, t0, t0);
    }
    let r = run();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const dumpArgs = s.read("docker.log").split("\n").find((l) => l.includes("pg_dump"))!;
    assert.match(dumpArgs, /pg_dump -U slaydx -Fc --strict-names -t public\.users -t public\.transactions -t public\.payment_orders -t public\.payment_events -t public\.payment_refunds slaydx$/);
    const files = () => readdirSync(ledger).filter((f) => f.endsWith(".dump")).sort();
    const now = new Date();
    const hourName = `ledger-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}.dump`;
    assert.deepEqual(files(), ["ledger-20200101-01.dump", hourName].sort(), "49 soatlik o'chishi, 47 soatlik qolishi kerak");
    const list = execFileSync("pg_restore", ["--list", path.join(ledger, hourName)], { encoding: "utf8" });
    for (const tbl of ["users", "transactions", "payment_orders", "payment_events", "payment_refunds"]) {
      assert.match(list, new RegExp(`TABLE DATA public ${tbl} `), `${tbl} ma'lumoti dumpda yo'q`);
    }
    assert.doesNotMatch(list, /TABLE DATA public generation_files /, "bytea jadvallar ledger'ga kirmasligi kerak");
    assert.match(readFileSync(path.join(ledger, "ledger.log"), "utf8"), /"status":"ok"/);
    r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(files(), ["ledger-20200101-01.dump", hourName].sort(), "xuddi shu soatda qayta ishga tushirish fayl qo'shmaydi");
    assert.deepEqual(readdirSync(ledger).filter((f) => f.endsWith(".tmp")), []);
  });

  /** Mutation: remove `--strict-names` — a missing table no longer fails (red). */
  await t.test("ledger: yo'q jadval (--strict-names) va pg_dump xatosi Telegram alert beradi, .tmp qolmaydi", async () => {
    rmSync(path.join(s.stub, "tg.log"), { force: true });
    let r = run({ LEDGER_TABLES: "users no_such_table" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /pg_dump muvaffaqiyatsiz/);
    let msgs = s.tg();
    assert.equal(msgs.length, 1);
    assert.match(msgs[0], /^SlaydX ledger zaxirasi MUVAFFAQIYATSIZ: pg_dump muvaffaqiyatsiz/);

    rmSync(path.join(s.stub, "tg.log"), { force: true });
    r = run({ LEDGER_TABLES: "users; DROP TABLE users" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /noto'g'ri jadval nomi/);

    rmSync(path.join(s.stub, "tg.log"), { force: true });
    writeFileSync(path.join(s.stub, "pg_restore-fail"), "");
    r = run();
    rmSync(path.join(s.stub, "pg_restore-fail"));
    assert.notEqual(r.status, 0);
    msgs = s.tg();
    assert.equal(msgs.length, 1);
    assert.match(msgs[0], /pg_restore --list dumpni o'qiy olmadi/);
    assert.deepEqual(readdirSync(ledger).filter((f) => f.endsWith(".tmp")), [], ".tmp qolmasligi kerak");
    assert.ok(!s.read("curl-argv.log").includes(FAKE_TOKEN), "token curl argv'ida");
    assert.ok(s.read("curl-config.log").includes(`bot${FAKE_TOKEN}/sendMessage`));
  });
});

// ─────────────────────────────── backup.sh GFS ───────────────────────────────

const STUB_DOCKER_BACKUP = `#!/usr/bin/env bash
S="$STUB_DIR"
printf '%s\\n' "$*" >>"$S/docker.log"
case "$1 $3" in
  "exec pg_dump") head -c 4096 /dev/zero | tr '\\0' 'x'; exit 0 ;;
esac
exit 0
`;

const STUB_RCLONE = `#!/usr/bin/env bash
S="$STUB_DIR"
printf '%s\\n' "$*" >>"$S/rclone.log"
case "$1" in
  copy) [ -f "$S/copy-fail" ] && exit 1; exit 0 ;;
  check) exit 0 ;;
  lsf) cat "$S/remote-list"; exit 0 ;;
  delete)
    prev=""
    for a in "$@"; do
      [ "$prev" = --files-from-raw ] && cat "$a" >>"$S/deleted"
      prev=$a
    done
    exit 0 ;;
esac
exit 0
`;

/** `slaydx-YYYYMMDD-013000.dump` for every day in [from, to]. */
function dailyNames(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    out.push(`slaydx-${d.toISOString().slice(0, 10).replace(/-/g, "")}-013000.dump`);
  }
  return out;
}

test("backup.sh: GFS (7 kunlik + 4 haftalik + 6 oylik) box tashqarisida, yangi nusxalarga tegmaydi", async (t) => {
  const s = stubDir(t, { docker: STUB_DOCKER_BACKUP, rclone: STUB_RCLONE, curl: STUB_CURL });
  const backups = path.join(s.dir, "backups");
  mkdirSync(backups);
  const all = [
    ...dailyNames("2026-03-01", "2026-10-05"),
    "slaydx-20260915-120000.dump", // a second (manual) dump on an old day
    "slaydx-20261003-120000.dump", // a second dump inside the 7-day window
    "slaydx-predeploy-20260101.dump", // not the daily naming — never touched
    "notes.txt",
  ];
  writeFileSync(path.join(s.stub, "remote-list"), all.join("\n") + "\n");
  const env = (extra: Record<string, string> = {}) =>
    s.env({
      BACKUP_DIR: backups,
      BACKUP_MIN_SIZE_BYTES: "10",
      BACKUP_REMOTE: "slaydx-gdrive:slaydx-backups",
      BACKUP_GFS_TODAY: "20261005",
      ...extra,
    });
  const run = (extra: Record<string, string> = {}) =>
    spawnSync("bash", [path.join(ROOT, "scripts/backup.sh")], { env: env(extra), encoding: "utf8", timeout: 60_000 });

  // 2026-10-05 is a Monday (ISO week 41). Kept: the 7 days 09-29..10-05 (both 10-03 dumps), the
  // newest of the latest 4 ISO weeks (10-05, 10-04, 09-27, 09-20) and of the latest 6 months
  // (10-05, 09-30, 08-31, 07-31, 06-30, 05-31). 09-28 is exactly 7 days old and not a week's
  // newest — it goes.
  const kept = new Set([
    ...dailyNames("2026-09-29", "2026-10-05"),
    "slaydx-20261003-120000.dump",
    "slaydx-20260927-013000.dump",
    "slaydx-20260920-013000.dump",
    "slaydx-20260831-013000.dump",
    "slaydx-20260731-013000.dump",
    "slaydx-20260630-013000.dump",
    "slaydx-20260531-013000.dump",
    "slaydx-predeploy-20260101.dump",
    "notes.txt",
  ]);
  const expectedDeleted = all.filter((n) => !kept.has(n)).sort();

  // Local pre-deploy dumps share the local retention; other files stay.
  const oldSql = path.join(backups, "slaydx-20200101000000.sql");
  const newSql = path.join(backups, "slaydx-20261004000000.sql");
  const rollback = path.join(backups, "ROLLBACK.txt");
  for (const [f, days] of [[oldSql, 10], [newSql, 1], [rollback, 30]] as const) {
    writeFileSync(f, "x");
    const t0 = new Date(Date.now() - days * 86_400_000);
    utimesSync(f, t0, t0);
  }

  /**
   * Mutations: drop the `cutoff` protection, the weekly or the monthly branch, or `--min-age` —
   * the exact delete list / argv assertion turns red.
   */
  const r = run();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const deleted = s.read("deleted").split("\n").filter(Boolean).sort();
  assert.deepEqual(deleted, expectedDeleted);
  assert.equal(all.length - deleted.length, 16, "14 ta zaxira (7 kunlik + 2 haftalik + 4 oylik + 1 qo'shimcha) va 2 ta begona fayl qolishi kerak");
  const del = s.read("rclone.log").split("\n").find((l) => l.startsWith("delete "))!;
  assert.match(del, /^delete slaydx-gdrive:slaydx-backups --files-from-raw \S+ --min-age 7d --max-depth 1$/);
  assert.match(r.stdout, new RegExp(`GFS — box tashqarisidagi ${expectedDeleted.length} ta eskirgan nusxa o'chirildi`));
  const logLine = readFileSync(path.join(backups, "backup.log"), "utf8").trim().split("\n").at(-1)!;
  assert.match(logLine, new RegExp(`"remote":"ok","retention":"ok","pruned":${expectedDeleted.length}`));
  assert.ok(existsSync(path.join(backups, ".last-ok")), ".last-ok belgisi yozilmadi");
  assert.ok(!existsSync(oldSql), "10 kunlik pre-deploy .sql o'chishi kerak");
  assert.ok(existsSync(newSql), "yangi pre-deploy .sql qolishi kerak");
  assert.ok(existsSync(rollback), "ROLLBACK.txt tegilmasligi kerak");

  /** Mutation: ignore BACKUP_REMOTE_RETENTION — a delete happens with `off` (red). */
  await t.test("BACKUP_REMOTE_RETENTION=off: hech narsa o'chirilmaydi", () => {
    rmSync(path.join(s.stub, "rclone.log"));
    rmSync(path.join(s.stub, "deleted"));
    const r2 = run({ BACKUP_REMOTE_RETENTION: "off" });
    assert.equal(r2.status, 0, r2.stderr);
    assert.doesNotMatch(s.read("rclone.log"), /^(delete|lsf) /m);
  });

  /** Mutation: run retention before/regardless of the verified copy — red. */
  await t.test("box tashqarisiga nusxa muvaffaqiyatsiz: GFS ishlamaydi, .last-ok yangilanmaydi, alert", () => {
    rmSync(path.join(s.stub, "rclone.log"));
    rmSync(path.join(backups, ".last-ok"));
    writeFileSync(path.join(s.stub, "copy-fail"), "");
    const r3 = run();
    rmSync(path.join(s.stub, "copy-fail"));
    assert.notEqual(r3.status, 0);
    assert.doesNotMatch(s.read("rclone.log"), /^(delete|lsf) /m);
    assert.ok(!existsSync(path.join(backups, ".last-ok")), "muvaffaqiyatsiz run .last-ok yozmasligi kerak");
    const msgs = s.tg();
    assert.equal(msgs.length, 1);
    assert.match(msgs[0], /^SlaydX backup MUVAFFAQIYATSIZ: box tashqarisiga nusxalash muvaffaqiyatsiz/);
    assert.ok(!s.read("curl-argv.log").includes(FAKE_TOKEN), "token curl argv'ida");
  });

  await t.test("noto'g'ri sozlama (BACKUP_REMOTE_RETENTION=all) dump olishdan oldin to'xtaydi", () => {
    const r4 = run({ BACKUP_REMOTE_RETENTION: "all" });
    assert.notEqual(r4.status, 0);
    assert.match(r4.stderr, /BACKUP_REMOTE_RETENTION faqat gfs yoki off/);
  });
});

// ─────────────────────────────── restore-check.sh ───────────────────────────────

const STUB_DOCKER_RESTORE = `#!/usr/bin/env bash
S="$STUB_DIR"
printf '%s\\n' "$*" >>"$S/docker.log"
case "$1" in
  run) echo cafe; exit 0 ;;
  cp|rm) exit 0 ;;
  exec)
    case "$3" in
      pg_isready) exit 0 ;;
      pg_restore) [ -f "$S/restore-fail" ] && exit 1; exit 0 ;;
      psql)
        sql="\${@: -1}"
        case "$sql" in
          "SELECT 1") echo 1 ;;
          *mismatched*) cat "$S/mismatches" ;;
          *) printf 'users=2\\ngenerations=5\\ntransactions=3\\n' ;;
        esac
        exit 0 ;;
    esac ;;
esac
exit 0
`;

test("restore-check.sh: compose'dagi postgres image, vaqt o'lchovi, belgi; har xatoda Telegram alert", async (t) => {
  const s = stubDir(t, { docker: STUB_DOCKER_RESTORE, curl: STUB_CURL });
  const backups = path.join(s.dir, "backups");
  mkdirSync(backups);
  writeFileSync(path.join(backups, "slaydx-20261004-013000.dump"), "x");
  writeFileSync(path.join(s.stub, "mismatches"), "0\n");
  const run = (extra: Record<string, string> = {}) =>
    spawnSync("bash", [path.join(ROOT, "scripts/restore-check.sh")], {
      env: s.env({ BACKUP_DIR: backups, ...extra }),
      encoding: "utf8",
      timeout: 60_000,
    });
  const composeImage = /^\s*image:\s*(postgres:\S+)/m.exec(readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8"))![1];
  assert.match(composeImage, /^postgres:\d+\.\d+-alpine\d/, "compose postgres image aniq versiyaga qulflangan bo'lishi kerak");

  /** Mutation: an unpinned default (`postgres:16-alpine`) instead of the compose image — red. */
  let r = run();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const runLine = s.read("docker.log").split("\n").find((l) => l.startsWith("run "))!;
  assert.ok(runLine.endsWith(` ${composeImage}`), `image ${composeImage} bo'lishi kerak: ${runLine}`);
  assert.match(r.stdout, /restore-check: OK — .*\(jami \d+ s, pg_restore \d+ s\)/);
  assert.ok(existsSync(path.join(backups, ".restore-check-ok")), ".restore-check-ok yozilmadi");
  assert.match(readFileSync(path.join(backups, "backup.log"), "utf8"), /"kind":"restore-check","status":"ok","durationSec":\d+,"restoreSec":\d+/);
  assert.deepEqual(s.tg(), []);

  rmSync(path.join(s.stub, "docker.log"));
  r = run({ RESTORE_CHECK_IMAGE: "postgres:16.99-test" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(s.read("docker.log").split("\n").find((l) => l.startsWith("run "))!.endsWith(" postgres:16.99-test"));

  /** Mutations: drop notify_failure from the EXIT trap, or touch the marker before the checks — red. */
  const failCase = (setup: () => void, extra: Record<string, string>, re: RegExp) => {
    rmSync(path.join(s.stub, "tg.log"), { force: true });
    rmSync(path.join(backups, ".restore-check-ok"), { force: true });
    setup();
    const rf = run(extra);
    assert.notEqual(rf.status, 0);
    const msgs = s.tg();
    assert.equal(msgs.length, 1, msgs.join(" | "));
    assert.match(msgs[0], re);
    assert.ok(!existsSync(path.join(backups, ".restore-check-ok")), "xatoda belgi yozilmasligi kerak");
  };
  failCase(() => writeFileSync(path.join(s.stub, "restore-fail"), ""), {}, /^SlaydX tiklash sinovi MUVAFFAQIYATSIZ: pg_restore muvaffaqiyatsiz tugadi \(slaydx-20261004-013000\.dump\)$/);
  rmSync(path.join(s.stub, "restore-fail"));
  failCase(() => writeFileSync(path.join(s.stub, "mismatches"), "3\n"), {}, /3 foydalanuvchida balans jurnal \(transactions\) bilan mos emas/);
  writeFileSync(path.join(s.stub, "mismatches"), "0\n");
  failCase(() => {}, { BACKUP_DIR: path.join(s.dir, "empty") }, /tiklash uchun dump topilmadi/);
  failCase(() => {}, { RESTORE_CHECK_COMPOSE_FILE: path.join(s.dir, "missing.yml") }, /Postgres image'ini .* aniqlab bo'lmadi/);
  assert.match(readFileSync(path.join(backups, "backup.log"), "utf8"), /"kind":"restore-check","status":"error".*"error":"3 foydalanuvchida/);
  assert.ok(!s.read("curl-argv.log").includes(FAKE_TOKEN), "token curl argv'ida");
  assert.ok(s.read("docker.log").includes("rm -f slaydx-restore-check-"), "vaqtinchalik konteyner o'chirilmadi");
});

// ─────────────────────────────── docker-cleanup.sh ───────────────────────────────

const STUB_DOCKER_IMAGES = `#!/usr/bin/env bash
S="$STUB_DIR"
printf '%s\\n' "$*" >>"$S/docker.log"
case "$1" in
  ps) printf 'c1\\nc2\\nc3\\nc4\\n' ;;
  inspect) printf 'sha256:web3\\nsha256:wk3\\nsha256:other\\nsha256:pg\\n' ;;
  images)
    if [ "$2" = -q ]; then printf 'sha256:dang\\n'; exit 0; fi
    printf '%s\\n' \\
      $'slaydx-web\\tlatest\\tsha256:web3' \\
      $'slaydx-web\\tpre-hotfix1\\tsha256:web2' \\
      $'slaydx-web\\tpre-audit25\\tsha256:web1' \\
      $'slaydx-web\\tpre-old\\tsha256:web0' \\
      $'ghcr.io/owner/slaydx-worker\\tmain\\tsha256:wk3' \\
      $'ghcr.io/owner/slaydx-worker\\taaa333\\tsha256:wk3' \\
      $'ghcr.io/owner/slaydx-worker\\taaa222\\tsha256:wk2' \\
      $'ghcr.io/owner/slaydx-worker\\taaa111\\tsha256:wk1' \\
      $'ghcr.io/owner/slaydx-worker\\taaa000\\tsha256:wk0' \\
      $'other-app\\tlatest\\tsha256:other' \\
      $'other-app\\told\\tsha256:other0' \\
      $'other-app\\told2\\tsha256:other1' \\
      $'other-app\\told3\\tsha256:other2' \\
      $'postgres\\t16.15-alpine3.24\\tsha256:pg' \\
      $'<none>\\t<none>\\tsha256:dang' ;;
  image)
    if [ "$2" = inspect ]; then
      case "\${@: -1}" in
        sha256:web3|sha256:wk3) echo 2026-10-05T10:00:00.000000000Z ;;
        sha256:web2|sha256:wk2) echo 2026-10-04T10:00:00.000000000Z ;;
        sha256:web1|sha256:wk1) echo 2026-09-25T10:00:00.000000000Z ;;
        *) echo 2026-09-01T10:00:00.000000000Z ;;
      esac
    fi ;;
  rmi) [ -f "$S/rmi-fail" ] && exit 1 ;;
esac
exit 0
`;

test("docker-cleanup.sh: faqat slaydx-*, ishlatilayotgan va oxirgi 2 ta rollback image qoladi, global prune yo'q", async (t) => {
  const s = stubDir(t, { docker: STUB_DOCKER_IMAGES });
  const run = (args: string[]) =>
    spawnSync("bash", [path.join(ROOT, "scripts/docker-cleanup.sh"), ...args], { env: s.env(), encoding: "utf8", timeout: 30_000 });
  const calls = () => s.read("docker.log").split("\n").filter(Boolean);

  /** Mutation: default to apply — rmi calls appear in the dry run (red). */
  let r = run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would remove slaydx-web:pre-old/);
  assert.match(r.stdout, /would remove ghcr\.io\/owner\/slaydx-worker:aaa000/);
  assert.ok(!calls().some((c) => c.startsWith("rmi") || c.includes("prune")), "dry-run hech narsani o'chirmaydi");

  /**
   * Mutations: KEEP ignored (keep 0), in-use check removed, repository filter removed, or a
   * global `docker image prune -a` / `system prune` — the exact rmi/prune list turns red.
   */
  rmSync(path.join(s.stub, "docker.log"));
  r = run(["--apply"]);
  assert.equal(r.status, 0, r.stderr);
  const rmi = calls().filter((c) => c.startsWith("rmi")).sort();
  assert.deepEqual(rmi, ["rmi ghcr.io/owner/slaydx-worker:aaa000", "rmi slaydx-web:pre-old"]);
  const prunes = calls().filter((c) => c.includes("prune"));
  assert.deepEqual(prunes, ["image prune -f --filter label=com.docker.compose.project=slaydx"]);
  assert.ok(!calls().some((c) => /system prune|builder prune|prune -a|rmi -f|other-app/.test(c)));

  rmSync(path.join(s.stub, "docker.log"));
  r = run(["--apply", "--keep", "1"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls().filter((c) => c.startsWith("rmi")).sort(), [
    "rmi ghcr.io/owner/slaydx-worker:aaa000",
    "rmi ghcr.io/owner/slaydx-worker:aaa111",
    "rmi slaydx-web:pre-audit25",
    "rmi slaydx-web:pre-old",
  ]);

  writeFileSync(path.join(s.stub, "rmi-fail"), "");
  r = run(["--apply"]);
  assert.notEqual(r.status, 0, "rmi xatosi exit kodida ko'rinishi kerak");
  assert.match(r.stderr, /FAILED slaydx-web:pre-old \(left in place\)/);

  assert.notEqual(run(["--keep", "0"]).status, 0, "--keep 0 rad etilishi kerak");
});

// ─────────────────────────────── .github/workflows/uptime.yml ───────────────────────────────

const WORKFLOW = path.join(ROOT, ".github/workflows/uptime.yml");

/** The `run: |` block of the single step, de-indented. */
function runBlock(yml: string): string {
  const lines = yml.split("\n");
  const i = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  assert.ok(i >= 0, "run: | bloki topilmadi");
  const keyIndent = lines[i].search(/\S/);
  const body: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() !== "" && l.search(/\S/) <= keyIndent) break;
    body.push(l);
  }
  const ind = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(ind)).join("\n");
}

test("uptime.yml: har 10 daqiqa, minimal ruxsat, sirlar faqat env orqali, IP yo'q, uchinchi tomon action yo'q", () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  assert.match(yml, /^\s+- cron: "\*\/10 \* \* \* \*"$/m);
  assert.match(yml, /^permissions:\n {2}actions: read\n\n/m, "faqat actions: read ruxsati bo'lishi kerak");
  assert.doesNotMatch(yml, /^\s*uses:/m, "uchinchi tomon action ishlatilmasin");
  assert.doesNotMatch(yml, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, "IP manzil workflow'da bo'lmasin");
  assert.match(yml, /UPTIME_URL: https:\/\/slaydxx\.uz\/api\/health/);
  assert.match(yml, /TG_TOKEN: \$\{\{ secrets\.UPTIME_TG_TOKEN \}\}/);
  assert.match(yml, /TG_CHAT: \$\{\{ secrets\.UPTIME_TG_CHAT \}\}/);
  assert.doesNotMatch(runBlock(yml), /\$\{\{/, "run skripti ichida ${{ }} interpolyatsiyasi bo'lmasin (faqat env)");
  assert.match(yml, /cancel-in-progress: false/);
});

const STUB_GH = `#!/usr/bin/env bash
[ -f "$STUB_DIR/gh-fail" ] && exit 1
cat "$STUB_DIR/history" 2>/dev/null
exit 0
`;
const STUB_SLEEP = `#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/sleep.log"
`;

test("uptime.yml run bloki: 3 urinish, birinchi DOWN, soatda takror, tiklanganda OK, token argv'da emas", async (t) => {
  const s = stubDir(t, { curl: STUB_CURL, gh: STUB_GH, sleep: STUB_SLEEP });
  const script = path.join(s.dir, "probe.sh");
  writeFileSync(script, runBlock(readFileSync(WORKFLOW, "utf8")));
  const probe = (code: string, history: string[], extra: Record<string, string> = {}) => {
    writeFileSync(path.join(s.stub, "health-code"), code);
    writeFileSync(path.join(s.stub, "history"), history.join("\n") + (history.length ? "\n" : ""));
    rmSync(path.join(s.stub, "tg.log"), { force: true });
    rmSync(path.join(s.stub, "sleep.log"), { force: true });
    const r = spawnSync("bash", ["-e", script], {
      env: s.env({ UPTIME_URL: "https://slaydxx.uz/api/health", TG_TOKEN: FAKE_TOKEN, TG_CHAT: "12345", GH_TOKEN: "x", GH_REPO: "o/r", ...extra }),
      encoding: "utf8",
      timeout: 30_000,
    });
    return { status: r.status, out: r.stdout + r.stderr, tg: s.tg(), sleeps: s.read("sleep.log").split("\n").filter(Boolean).length };
  };

  let r = probe("200", ["success", "success"]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.tg, []);
  assert.equal(r.sleeps, 0);

  /** Mutations: alert without the streak rule, or no retries — red. */
  r = probe("502", ["success", "failure"]);
  assert.equal(r.status, 1, r.out);
  assert.equal(r.sleeps, 2, "3 urinish orasida 2 kutish");
  assert.deepEqual(r.tg, ["[DOWN] slaydxx.uz /api/health -> 502 (3 urinish, GitHub probe)"]);

  r = probe("000", ["failure", "failure", "failure", "success"]);
  assert.equal(r.status, 1);
  assert.deepEqual(r.tg, [], "ketma-ket 4-xato — soatlik takrordan oldin jim");
  r = probe("503", Array(6).fill("failure"));
  assert.deepEqual(r.tg, ["[DOWN] slaydxx.uz /api/health -> 503 (3 urinish, GitHub probe)"], "~1 soatdan keyin takror");

  r = probe("200", ["failure", "failure", "success"]);
  assert.equal(r.status, 0);
  assert.deepEqual(r.tg, ["[OK] slaydxx.uz yana ishlayapti (/api/health 200, GitHub probe)"]);
  r = probe("200", ["cancelled", "failure"]);
  assert.deepEqual(r.tg, [], "oldingi run muvaffaqiyatsiz bo'lmasa OK yuborilmaydi");

  writeFileSync(path.join(s.stub, "gh-fail"), "");
  r = probe("502", []);
  rmSync(path.join(s.stub, "gh-fail"));
  assert.equal(r.tg.length, 1, "tarix o'qilmasa ham DOWN yuboriladi (fail-open)");

  r = probe("502", [], { TG_TOKEN: "", TG_CHAT: "" });
  assert.equal(r.status, 1);
  assert.deepEqual(r.tg, []);
  assert.match(r.out, /Telegram secrets are not set/);

  assert.ok(!s.read("curl-argv.log").includes(FAKE_TOKEN), "token curl argv'ida");
  assert.ok(s.read("curl-config.log").includes(`bot${FAKE_TOKEN}/sendMessage`));
});
