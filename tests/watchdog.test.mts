import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `scripts/watchdog.sh` (ops sprint P-OPS, docs/ops/O3-robustness-ops.md §1A, owner decision D3).
 *
 * The script runs for real against a throwaway Postgres database (every migration applied —
 * 036 included), with `docker`, `curl` and `df` replaced by stubs on PATH:
 *   - `docker exec … psql …` forwards the watchdog's own SQL to the test database, so the
 *     queue/failure/error/refund/housekeeping queries are checked against the real schema;
 *   - `docker inspect` answers from fixture files; `docker compose` is only logged;
 *   - `curl` answers the health probe from a fixture and records Telegram messages (the token
 *     must arrive on stdin via `-K -`, never in argv);
 *   - `df` prints a fixture disk usage. /proc/meminfo, the cgroup tree and the TLS certificate
 *     are fixture files too.
 * Nothing here talks to Telegram, Docker or the network.
 */

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts/watchdog.sh");
const FAKE_TOKEN = "999000:FAKE-watchdog-test-token";

test("watchdog.sh: bash -n sintaksis xato bermaydi", () => {
  execFileSync("bash", ["-n", SCRIPT], { stdio: "pipe" });
});

/**
 * The REFUND_FAILED check matches the worker's log text. If the worker message changes, the
 * watchdog would silently stop seeing refund failures — this keeps the two in sync.
 * Mutation: change the marker in watchdog.sh (or the worker text) — red.
 */
test("watchdog.sh: REFUND_FAILED belgisi worker.ts dagi xabar bilan bir xil", () => {
  const wd = readFileSync(SCRIPT, "utf8");
  const marker = wd.match(/^REFUND_MARKER="([^"]+)"$/m)?.[1];
  assert.ok(marker, "REFUND_MARKER topilmadi");
  const worker = readFileSync(path.join(ROOT, "lib/server/worker.ts"), "utf8");
  const line = worker.split("\n").find((l) => l.includes('alert: "REFUND_FAILED"'));
  assert.ok(line, 'worker.ts da alert: "REFUND_FAILED" qatori topilmadi');
  assert.ok(line!.includes(marker!), `worker.ts REFUND_FAILED xabari "${marker}" ni o'z ichiga olmaydi`);
});

/** Auto-restart is opt-in (D3: alert-only for the first week). Mutation: default 1 — red. */
test("watchdog.sh: WATCHDOG_AUTO_RESTART standarti 0", () => {
  assert.match(readFileSync(SCRIPT, "utf8"), /^AUTO_RESTART="\$\{WATCHDOG_AUTO_RESTART:-0\}"$/m);
});

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("watchdog") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const STUB_DOCKER = `#!/usr/bin/env bash
set -u
S="$STUB_DIR"
printf '%s\\n' "$*" >>"$S/docker.log"
case "$1" in
  inspect)
    name="\${@: -1}"
    if [ -f "$S/inspect-$name" ]; then cat "$S/inspect-$name"; exit 0; fi
    echo "Error: No such object: $name" >&2
    exit 1 ;;
  exec)
    shift
    while [ "\${1:-}" = -i ]; do shift; done
    shift
    if [ "\${1:-}" = psql ]; then
      shift
      [ -f "$S/psql-fail" ] && { echo "psql: connection refused" >&2; exit 2; }
      args=()
      while [ $# -gt 0 ]; do
        case "$1" in -U|-d) shift 2 ;; *) args+=("$1"); shift ;; esac
      done
      exec psql "$STUB_DB_URL" "\${args[@]}"
    fi
    exit 0 ;;
  compose)
    [ -f "$S/compose-fail" ] && exit 1
    exit 0 ;;
  *) exit 0 ;;
esac
`;

const STUB_CURL = `#!/usr/bin/env bash
S="$STUB_DIR"
printf '%s\\n' "$*" >>"$S/curl-argv.log"
for a in "$@"; do
  if [ "$a" = -K ]; then
    cfg=$(cat)
    printf '%s\\n' "$cfg" >>"$S/curl-config.log"
    case "$cfg" in *api.telegram.org*) ;; *) exit 3 ;; esac
    [ -f "$S/tg-fail" ] && exit 22
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

const STUB_DF = `#!/usr/bin/env bash
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
echo "/dev/sda1 1000 500 500 $(cat "$STUB_DIR/disk-pct")% /"
`;

const CONTAINERS: Record<string, { svc: string; id: string }> = {
  "slaydx-web-1": { svc: "web", id: "a".repeat(64) },
  "slaydx-worker-1": { svc: "worker", id: "b".repeat(64) },
  "slaydx-worker-2": { svc: "worker", id: "c".repeat(64) },
  "slaydx-postgres-1": { svc: "postgres", id: "d".repeat(64) },
};

test("watchdog.sh (haqiqiy Postgres + stub docker/curl/df)", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  await migrate({ lockRetryDelayMs: 50 });
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-watchdog-test-"));
  t.after(async () => {
    rmSync(dir, { recursive: true, force: true });
    await pool().end().catch(() => {});
    await iso.drop();
  });

  const bin = path.join(dir, "bin");
  const stub = path.join(dir, "stub");
  const state = path.join(dir, "state");
  const backups = path.join(dir, "backups");
  const cgroup = path.join(dir, "cgroup");
  const composeDir = path.join(dir, "compose");
  for (const d of [bin, stub, backups, path.join(backups, "ledger"), cgroup, composeDir]) mkdirSync(d, { recursive: true });
  for (const [name, body] of [["docker", STUB_DOCKER], ["curl", STUB_CURL], ["df", STUB_DF]] as const) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const envFile = path.join(dir, "backup.env");
  writeFileSync(envFile, `TELEGRAM_BOT_TOKEN=${FAKE_TOKEN}\nBACKUP_TG_CHAT=12345\n`, { mode: 0o600 });
  const meminfo = path.join(dir, "meminfo");
  const certOk = path.join(dir, "cert-ok.pem");
  const certSoon = path.join(dir, "cert-soon.pem");
  for (const [file, days] of [[certOk, "365"], [certSoon, "5"]] as const) {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", days, "-subj", "/CN=watchdog-test",
      "-keyout", path.join(dir, "key.pem"), "-out", file,
    ], { stdio: "ignore" });
  }

  const baseEnv: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    LANG: "C.UTF-8",
    STUB_DIR: stub,
    STUB_DB_URL: process.env.DATABASE_URL!,
    WATCHDOG_ENV_FILE: envFile,
    WATCHDOG_STATE_DIR: state,
    WATCHDOG_MEMINFO: meminfo,
    WATCHDOG_CGROUP_ROOT: cgroup,
    WATCHDOG_COMPOSE_DIR: composeDir,
    WATCHDOG_CERT_FILE: certOk,
    BACKUP_DIR: backups,
  };

  const inspect = (name: string, status = "running", health = "healthy", oom = "false", restarts = 0, project = "slaydx") => {
    const c = CONTAINERS[name];
    writeFileSync(path.join(stub, `inspect-${name}`), `${status}|${health}|${oom}|${restarts}|2026-10-05T10:00:00Z|${c.id}|${project}|${c.svc}\n`);
  };
  const oomEvents = (name: string, kills: number) => {
    const d = path.join(cgroup, "system.slice", `docker-${CONTAINERS[name].id}.scope`);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "memory.events"), `low 0\nhigh 0\nmax 3\noom 1\noom_kill ${kills}\n`);
  };
  const mem = (availMb: number, swapUsedMb: number) =>
    writeFileSync(meminfo, `MemTotal: 8000000 kB\nMemAvailable: ${availMb * 1024} kB\nSwapTotal: 8388608 kB\nSwapFree: ${8388608 - swapUsedMb * 1024} kB\n`);
  const ageFile = (file: string, minutes: number) => {
    writeFileSync(file, "x");
    const t0 = new Date(Date.now() - minutes * 60_000);
    utimesSync(file, t0, t0);
  };

  /** Healthy box, empty state, clean tables. */
  const reset = async () => {
    rmSync(state, { recursive: true, force: true });
    for (const f of readdirSync(stub)) rmSync(path.join(stub, f), { force: true });
    rmSync(path.join(cgroup, "system.slice"), { recursive: true, force: true });
    writeFileSync(path.join(stub, "health-code"), "200");
    writeFileSync(path.join(stub, "disk-pct"), "50");
    for (const name of Object.keys(CONTAINERS)) inspect(name);
    mem(4000, 300);
    ageFile(path.join(backups, ".last-ok"), 60);
    for (const f of readdirSync(path.join(backups, "ledger"))) rmSync(path.join(backups, "ledger", f));
    ageFile(path.join(backups, "ledger", "ledger-20261005-10.dump"), 20);
    rmSync(path.join(backups, ".restore-check-ok"), { force: true });
    await query("DELETE FROM generations");
    await query("DELETE FROM error_log");
    await query("DELETE FROM housekeeping_status");
  };

  type Run = { code: number | null; stdout: string; stderr: string; tg: string[] };
  const run = (env: Record<string, string> = {}, args: string[] = []): Run => {
    rmSync(path.join(stub, "tg.log"), { force: true });
    const r = spawnSync("bash", [SCRIPT, ...args], { env: { ...baseEnv, ...env } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 });
    const log = path.join(stub, "tg.log");
    const tg = existsSync(log) ? readFileSync(log, "utf8").split("\x1e").filter(Boolean) : [];
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, tg };
  };
  const alerts = (r: Run, re: RegExp) => r.tg.filter((m) => re.test(m));

  const uid = (await query<{ id: string }>(`INSERT INTO users (name) VALUES ('Watchdog test') RETURNING id::text AS id`))[0].id;
  const gen = (status: string, opts: { runAfterMin?: number; createdMin?: number; finishedMin?: number } = {}) =>
    query(
      `INSERT INTO generations (id, user_id, tool_id, status, created_at, run_after, finished_at)
       VALUES ($1, $2, 'slide', $3, now() - make_interval(mins => $4), now() - make_interval(mins => $5),
               CASE WHEN $6::int IS NULL THEN NULL ELSE now() - make_interval(mins => $6::int) END)`,
      [randomUUID(), uid, status, opts.createdMin ?? 0, opts.runAfterMin ?? 0, opts.finishedMin ?? null],
    );
  const errorRow = (message: string, level = "error", count = 1) =>
    query(`INSERT INTO error_log (fingerprint, level, scope, message, count) VALUES ($1, $2, 'worker', $3, $4)`, [
      randomUUID(),
      level,
      message,
      count,
    ]);

  await t.test("sog'lom box: xabar yo'q, exit 0, 'ok'; token argv'da emas", async () => {
    await reset();
    const r = run();
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.tg, [], `kutilmagan xabar: ${r.tg.join(" | ")}`);
    assert.match(r.stdout, /watchdog: \S+ ok$/m, r.stdout + r.stderr);
  });

  /**
   * De-dup + cooldown + recovery. Mutations: `need` 2 → 1 (first failure pages), dropping the
   * REPEAT_S comparison (alerts every run), removing the "[OK]" branch — red.
   */
  await t.test("health: 2 ketma-ket xatodan keyin alert, soatda bir takror, tiklanganda [OK]", async () => {
    await reset();
    writeFileSync(path.join(stub, "health-code"), "502");
    assert.deepEqual(run().tg, [], "birinchi xato (deploy almashuvi bo'lishi mumkin) alert bermasligi kerak");
    let r = run();
    assert.equal(alerts(r, /^\[ALERT\] SlaydX: \/api\/health -> 502/).length, 1, r.tg.join(" | "));
    r = run();
    assert.deepEqual(r.tg, [], "cooldown ichida takrorlanmasligi kerak");
    assert.match(r.stdout, /failing: health/);
    const old = new Date(Date.now() - 2 * 3600_000);
    utimesSync(path.join(state, "alert-health"), old, old);
    r = run();
    assert.equal(alerts(r, /^\[ALERT\] SlaydX: \/api\/health -> 502/).length, 1, "1 soatdan keyin takrorlanishi kerak");
    writeFileSync(path.join(stub, "health-code"), "200");
    r = run();
    assert.equal(alerts(r, /^\[OK\] SlaydX: \/api\/health/).length, 1, r.tg.join(" | "));
    assert.ok(!existsSync(path.join(state, "alert-health")), "tiklangandan keyin alert holati o'chishi kerak");
    assert.deepEqual(run().tg, [], "[OK] faqat bir marta");
  });

  await t.test("Telegram yuborilmasa holat yozilmaydi — keyingi run qayta urinadi", async () => {
    await reset();
    writeFileSync(path.join(stub, "disk-pct"), "91");
    writeFileSync(path.join(stub, "tg-fail"), "");
    let r = run();
    assert.match(r.stderr, /Telegram send failed/);
    assert.ok(!existsSync(path.join(state, "alert-disk")), "yuborilmagan alert 'yuborildi' deb belgilanmasligi kerak");
    rmSync(path.join(stub, "tg-fail"));
    r = run();
    assert.equal(alerts(r, /^\[ALERT\] SlaydX: disk 91% to'lgan/).length, 1, r.tg.join(" | "));
  });

  /** Mutation: compare against the wrong field (`$avail -ge` swapped) or drop the swap test — red. */
  await t.test("disk va xotira chegaralari", async () => {
    await reset();
    writeFileSync(path.join(stub, "disk-pct"), "84");
    assert.deepEqual(run().tg, [], "84% < 85% chegara");
    writeFileSync(path.join(stub, "disk-pct"), "85");
    assert.equal(alerts(run(), /disk 85% to'lgan/).length, 1);

    await reset();
    mem(350, 300);
    assert.equal(alerts(run(), /RAM bo'sh 350 MB/).length, 1, "MemAvailable < 400 MB");
    await reset();
    mem(4000, 7000);
    assert.equal(alerts(run(), /swap 7000 MB/).length, 1, "swap > 6 GB");
  });

  /**
   * The queue age counts from run_after (when the job became runnable): a retry waiting for its
   * back-off is not stuck. Mutation: `min(created_at)` instead of run_after, or dropping
   * `run_after <= now()` — the back-off case turns red.
   */
  await t.test("navbat: tayyor QUEUED 10 daqiqadan oshsa alert, back-off kutayotgani alert emas", async () => {
    await reset();
    await gen("QUEUED", { createdMin: 120, runAfterMin: -5 }); // retry: runnable in 5 min
    await gen("QUEUED", { createdMin: 3, runAfterMin: 3 });
    assert.deepEqual(run().tg, [], "back-off'dagi ish 'tiqilgan' emas");
    await gen("QUEUED", { createdMin: 25, runAfterMin: 12 });
    const r = run();
    const m = alerts(r, /navbatdagi eng eski ish (\d+) s kutmoqda \(navbatda 3 ta\)/);
    assert.equal(m.length, 1, r.tg.join(" | "));
    const age = Number(/(\d+) s kutmoqda/.exec(m[0])![1]);
    assert.ok(age >= 700 && age < 800, `yosh ~720 s bo'lishi kerak, keldi ${age}`);
  });

  /** Mutation: drop the FAIL_MIN floor or the ratio — one of the two cases turns red. */
  await t.test("FAILED ulushi: >= 3 va >= 50% bo'lsa alert; oz yoki past ulush alert emas", async () => {
    await reset();
    for (let i = 0; i < 3; i++) await gen("FAILED", { finishedMin: 2 });
    for (let i = 0; i < 10; i++) await gen("COMPLETED", { finishedMin: 2 });
    for (let i = 0; i < 5; i++) await gen("FAILED", { finishedMin: 40 }); // outside the 15 min window
    assert.deepEqual(run().tg, [], "3/13 — me'yorda");
    await query("DELETE FROM generations");
    for (let i = 0; i < 2; i++) await gen("FAILED", { finishedMin: 1 });
    assert.deepEqual(run().tg, [], "2/2 — juda oz (FAIL_MIN 3)");
    for (let i = 0; i < 2; i++) await gen("FAILED", { finishedMin: 1 });
    await gen("COMPLETED", { finishedMin: 1 });
    const r = run();
    assert.equal(alerts(r, /4\/5 ish FAILED/).length, 1, r.tg.join(" | "));
  });

  /**
   * First run = baseline (existing rows never page); then each new error row is reported once
   * with a sample; warn rows are ignored. Mutations: alert on the first run, `level` filter
   * removed, errid not advanced (repeats every run) — red.
   */
  await t.test("yangi xato turlari: birinchi run baza chizig'i, keyin bir marta xabar, warn e'tiborsiz", async () => {
    await reset();
    await errorRow("[worker] eski xato");
    assert.deepEqual(run().tg, [], "mavjud xatolar birinchi runda xabar bermaydi");
    await errorRow("[images] Gemini 503: overloaded");
    await errorRow("[web] sekin so'rov", "warn");
    let r = run();
    const m = alerts(r, /^\[ERROR\] SlaydX: 1 ta yangi xato turi\nworker: \[images\] Gemini 503: overloaded$/);
    assert.equal(m.length, 1, r.tg.join(" | "));
    r = run();
    assert.deepEqual(r.tg, [], "bir xil xato qayta xabar bermaydi");
  });

  /**
   * REFUND_FAILED: one error_log row per fingerprint, so repeats only bump `count` — the watchdog
   * follows the summed count. Mutation: compare row counts instead of sum(count) — the second
   * alert disappears (red).
   */
  await t.test("REFUND_FAILED: yangi holat va count oshishi alert beradi", async () => {
    await reset();
    run(); // baseline
    await errorRow(`[worker] job ${randomUUID()}: pul qaytarilmadi: connection reset`);
    let r = run();
    assert.equal(alerts(r, /REFUND_FAILED — 1 ta ishda pul qaytarilmadi/).length, 1, r.tg.join(" | "));
    await query(`UPDATE error_log SET count = count + 2 WHERE message LIKE '%pul qaytarilmadi%'`);
    r = run();
    assert.equal(alerts(r, /REFUND_FAILED — 2 ta ishda pul qaytarilmadi/).length, 1, r.tg.join(" | "));
    assert.deepEqual(run().tg, []);
  });

  /** Mutation: `last_error_at > last_ok_at` without the coalesce (NULL last_ok_at) — red. */
  await t.test("housekeeping: oxirgi xato oxirgi muvaffaqiyatdan yangi bo'lsa alert", async () => {
    await reset();
    await query(`INSERT INTO housekeeping_status (step, last_run_at, last_ok_at, last_error_at) VALUES
      ('purge', now(), now(), now() - interval '1 hour'),
      ('reaper', now(), NULL, now() - interval '2 minutes'),
      ('refunds', now(), now() - interval '1 hour', now())`);
    const r = run();
    assert.equal(alerts(r, /2 ta housekeeping qadami xato bermoqda: reaper,refunds/).length, 1, r.tg.join(" | "));
  });

  await t.test("SQL ishlamasa 2 runda 'db' alert", async () => {
    await reset();
    writeFileSync(path.join(stub, "psql-fail"), "");
    assert.deepEqual(run().tg, []);
    const r = run();
    assert.equal(alerts(r, /watchdog SQL so'rovi ishlamadi/).length, 1, r.tg.join(" | "));
  });

  /**
   * Containers: unhealthy pages after 2 runs; with auto-restart off nothing is restarted; with it
   * on the compose service is restarted after 3 runs, once per cooldown, and never for a container
   * outside the slaydx project. Mutations: default AUTO_RESTART 1, cooldown check removed, project
   * guard removed — red.
   */
  await t.test("konteyner: unhealthy alert; avto-restart o'chiq bo'lsa restart yo'q", async () => {
    await reset();
    inspect("slaydx-worker-2", "running", "unhealthy");
    for (let i = 0; i < 4; i++) run();
    const docker = readFileSync(path.join(stub, "docker.log"), "utf8");
    assert.doesNotMatch(docker, /^compose /m, "WATCHDOG_AUTO_RESTART=0 da restart bo'lmasligi kerak");
    await reset();
    inspect("slaydx-worker-2", "running", "unhealthy");
    run();
    const r = run();
    assert.equal(alerts(r, /^\[ALERT\] SlaydX: slaydx-worker-2 holati: running\/unhealthy \(avto-restart o'chiq\)/).length, 1, r.tg.join(" | "));
  });

  await t.test("konteyner: WATCHDOG_AUTO_RESTART=1 — 3-runda compose restart, cooldown, begona loyiha yo'q", async () => {
    await reset();
    inspect("slaydx-worker-2", "running", "unhealthy");
    const on = { WATCHDOG_AUTO_RESTART: "1" };
    run(on);
    run(on);
    assert.ok(!existsSync(path.join(stub, "docker.log")) || !/^compose /m.test(readFileSync(path.join(stub, "docker.log"), "utf8")));
    let r = run(on);
    const composeCalls = () => readFileSync(path.join(stub, "docker.log"), "utf8").split("\n").filter((l) => l.startsWith("compose "));
    assert.deepEqual(composeCalls(), ["compose -p slaydx restart worker"]);
    assert.equal(alerts(r, /^\[ACTION\] SlaydX: slaydx-worker-2 sog'lom emas edi — 'worker' xizmati qayta ishga tushirildi/).length, 1, r.tg.join(" | "));
    for (let i = 0; i < 3; i++) r = run(on);
    assert.equal(composeCalls().length, 1, "cooldown (30 daqiqa) ichida qayta restart yo'q");
    const old = new Date(Date.now() - 31 * 60_000);
    utimesSync(path.join(state, "restarted-worker"), old, old);
    run(on);
    assert.equal(composeCalls().length, 2, "cooldown tugagach yana restart");

    await reset();
    inspect("slaydx-web-1", "running", "unhealthy", "false", 0, "other-project");
    for (let i = 0; i < 4; i++) run(on);
    assert.doesNotMatch(readFileSync(path.join(stub, "docker.log"), "utf8"), /^compose /m, "slaydx loyihasiga tegishli bo'lmagan konteyner restart qilinmaydi");
  });

  await t.test("konteyner: yo'qolgan, restart soni oshgan, OOMKilled va cgroup oom_kill — har biri bir marta", async () => {
    await reset();
    oomEvents("slaydx-worker-1", 0);
    run();
    rmSync(path.join(stub, "inspect-slaydx-web-1"));
    inspect("slaydx-worker-1", "running", "healthy", "false", 2);
    inspect("slaydx-postgres-1", "restarting", "unhealthy", "true", 1);
    oomEvents("slaydx-worker-1", 3);
    let r = run();
    assert.equal(alerts(r, /slaydx-worker-1 qayta ishga tushdi \(restartlar 0 -> 2\)/).length, 1, r.tg.join(" | "));
    assert.equal(alerts(r, /slaydx-postgres-1 xotira chegarasiga urilib o'ldirildi \(OOMKilled\)/).length, 1, r.tg.join(" | "));
    assert.equal(alerts(r, /slaydx-worker-1 ichida jarayon xotira yetmay o'ldirildi \(oom_kill 0 -> 3\)/).length, 1, r.tg.join(" | "));
    r = run();
    assert.equal(alerts(r, /slaydx-web-1 konteyneri topilmadi/).length, 1, "yo'qolgan konteyner 2-runda");
    assert.equal(alerts(r, /qayta ishga tushdi|OOMKilled|oom_kill/).length, 0, "bir martalik hodisalar takrorlanmaydi");
  });

  /** Mutation: drop the `.last-ok` lookup (fallback dump only) or the ledger check — red. */
  await t.test("zaxiralar: to'liq zaxira 26 soatdan, ledger 150 daqiqadan, tiklash sinovi 8 kundan eski bo'lsa alert", async () => {
    await reset();
    ageFile(path.join(backups, ".last-ok"), 27 * 60);
    ageFile(path.join(backups, "slaydx-20261005-013000.dump"), 10); // a fresh dump whose off-box copy failed
    ageFile(path.join(backups, "ledger", "ledger-20261005-10.dump"), 151);
    ageFile(path.join(backups, ".restore-check-ok"), 9 * 24 * 60);
    const r = run();
    assert.equal(alerts(r, /oxirgi muvaffaqiyatli to'liq zaxira 27 soat oldin/).length, 1, r.tg.join(" | "));
    assert.equal(alerts(r, /oxirgi soatlik ledger zaxirasi 2 soat oldin/).length, 1, r.tg.join(" | "));
    assert.equal(alerts(r, /oxirgi muvaffaqiyatli tiklash sinovi 216 soat oldin/).length, 1, r.tg.join(" | "));
    rmSync(path.join(backups, "slaydx-20261005-013000.dump"));
  });

  await t.test("TLS sertifikat 14 kundan kam qolsa alert", async () => {
    await reset();
    const r = run({ WATCHDOG_CERT_FILE: certSoon });
    assert.equal(alerts(r, /TLS sertifikati 14 kundan kam qoldi/).length, 1, r.tg.join(" | "));
  });

  /** --dry-run: prints, never sends, never writes state, never restarts. */
  await t.test("--dry-run: chop etadi, yubormaydi, holat yozmaydi, restart qilmaydi", async () => {
    await reset();
    writeFileSync(path.join(stub, "disk-pct"), "95");
    inspect("slaydx-worker-2", "running", "unhealthy");
    let r: Run = run();
    r = run({ WATCHDOG_AUTO_RESTART: "1", WATCHDOG_RESTART_AFTER: "1" }, ["--dry-run"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.tg, [], "dry-run Telegram'ga yubormaydi");
    assert.match(r.stdout, /\[dry-run\] would run: docker compose -p slaydx restart worker/);
    assert.doesNotMatch(readFileSync(path.join(stub, "docker.log"), "utf8"), /^compose /m);
    // Names and contents (failure counters, restart counts, error ids) must stay byte-identical.
    const snapshot = () =>
      readdirSync(state)
        .sort()
        .map((f) => `${f}=${readFileSync(path.join(state, f), "utf8")}`);
    const before = snapshot();
    assert.ok(before.some((l) => l.startsWith("fail-disk=")), "holat fayllari kutilgan edi");
    run({}, ["--dry-run"]);
    assert.deepEqual(snapshot(), before, "dry-run holat fayllarini o'zgartirmaydi");
  });

  await t.test("--digest: bitta xulosa xabari", async () => {
    await reset();
    await gen("COMPLETED", { finishedMin: 60 });
    await gen("FAILED", { finishedMin: 60 });
    await gen("QUEUED");
    const r = run({}, ["--digest"]);
    assert.equal(r.tg.length, 1, r.tg.join(" | "));
    assert.match(r.tg[0], /^\[DIGEST\] SlaydX, 24 soat:\nishlar: 1 tayyor, 1 FAILED, navbatda 1/);
    assert.match(r.tg[0], /disk: 50%/);
  });

  /** The bot token must never reach argv (visible in `ps`) or the script's own output. */
  await t.test("token hech qachon argv'da yoki chiqishda yo'q", async () => {
    await reset();
    writeFileSync(path.join(stub, "disk-pct"), "99");
    const r = run();
    assert.equal(r.tg.length, 1);
    assert.ok(!readFileSync(path.join(stub, "curl-argv.log"), "utf8").includes(FAKE_TOKEN), "token curl argv'ida");
    assert.ok(readFileSync(path.join(stub, "curl-config.log"), "utf8").includes(`bot${FAKE_TOKEN}/sendMessage`), "token stdin orqali bormadi");
    assert.ok(!r.stdout.includes(FAKE_TOKEN) && !r.stderr.includes(FAKE_TOKEN), "token chiqishda");
  });
});
