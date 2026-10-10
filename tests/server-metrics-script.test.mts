import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `deploy/ops/slaydx-metrics.sh` (docs/ops/METRICS.md): the root host cron that writes one
 * `server_metrics` row of kind 'host' every 5 minutes.
 *
 * `/proc`, the nginx log and the disk are fixtures; `docker` is a stub on PATH that answers `ps`,
 * `stats` and `inspect` from fixtures and forwards `exec … psql` (SQL on stdin) to a throwaway
 * Postgres database with every migration applied. Nothing here talks to Docker or the network.
 */

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "deploy/ops/slaydx-metrics.sh");
const FAKE_PG_PASSWORD = "FAKE-pg-password-for-the-secret-check";
const NOW = 1_760_100_000; // epoch seconds used as METRICS_NOW

type HostJson = {
  v: number; cpus: number; load1: number; load5: number; load15: number;
  mem_total_mb: number; mem_used_mb: number; mem_avail_mb: number; swap_total_mb: number; swap_used_mb: number; disk_pct: number;
  containers: Array<{ name: string; id: string; status: string; restarts: number; oom: boolean; cpu_pct: number; mem_mb: number; mem_limit_mb: number }>;
  nginx: { window_s: number; requests: number; s2xx: number; s3xx: number; s4xx: number; s5xx: number; p50_ms: number | null; p95_ms: number | null } | null;
};

test("slaydx-metrics.sh: bash -n sintaksis xato bermaydi, bajariladigan", () => {
  execFileSync("bash", ["-n", SCRIPT], { stdio: "pipe" });
  const help = spawnSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--print/);
});

test("install-ops.sh --dry-run: the metrics cron runs every 5 minutes as root from the root-owned copy, with its log rotated", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-install-test-"));
  try {
    const app = path.join(dir, "app");
    const bin = path.join(dir, "bin");
    mkdirSync(path.join(app, "scripts"), { recursive: true });
    mkdirSync(bin);
    for (const f of ["watchdog.sh", "backup-ledger.sh", "restore-check.sh"]) writeFileSync(path.join(app, "scripts", f), "");
    for (const f of ["slaydx-backup", "slaydx-auto-deploy"]) {
      writeFileSync(path.join(bin, f), "");
      chmodSync(path.join(bin, f), 0o755);
    }
    const r = spawnSync("bash", [path.join(ROOT, "deploy/install-ops.sh"), "--dry-run"], {
      env: { PATH: process.env.PATH ?? "", SLAYDX_APP_DIR: app, SLAYDX_BIN_DIR: bin },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /=== \S*\/slaydx-metrics\n/);
    assert.ok(r.stdout.includes(`*/5 * * * * root umask 077; ${bin}/slaydx-metrics >> /var/log/slaydx-metrics.log 2>&1`), r.stdout);
    assert.match(r.stdout, /\/var\/log\/slaydx-metrics\.log \{/, "logrotate covers the metrics log");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const STUB_DOCKER = `#!/usr/bin/env bash
S="$STUB_DIR"
printf '%s\\n' "$*" >>"$S/docker.log"
[ -f "$S/docker-fail" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
case "$1" in
  ps) cat "$S/ps.txt" ;;
  # stats / inspect answer only for the container names that were ASKED for (like the real docker)
  stats)
    for a in "$@"; do case "$a" in -*|*"{{"*|stats) continue ;; esac; grep -E "^$a\\|" "$S/stats.txt"; done ;;
  inspect)
    for a in "$@"; do case "$a" in -*|*"{{"*|inspect) continue ;; esac; grep -E "^/$a\\|" "$S/inspect.txt"; done ;;
  exec)
    shift
    while [ "\${1:-}" = -i ]; do shift; done
    shift # container name
    # sh -c 'exec psql ... -U "$POSTGRES_USER" -d "$POSTGRES_DB"' : run the SAME psql against the test DB
    case "$*" in *'-U "$POSTGRES_USER" -d "$POSTGRES_DB"'*) ;; *) echo "unexpected exec: $*" >&2; exit 3 ;; esac
    exec psql "$STUB_DB_URL" -X -q -v ON_ERROR_STOP=1 ;;
esac
exit 0
`;
const STUB_DF = `#!/usr/bin/env bash
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
echo "/dev/sda1 1000 500 500 63% /"
`;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("metrics_sh") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

test("slaydx-metrics.sh (fixture /proc + stub docker + haqiqiy Postgres)", { skip }, async (t) => {
  const { migrate, pool, query } = await import("../lib/server/db.ts");
  await migrate({ lockRetryDelayMs: 50 });
  const dir = mkdtempSync(path.join(tmpdir(), "slaydx-metrics-test-"));
  t.after(async () => {
    rmSync(dir, { recursive: true, force: true });
    await pool().end().catch(() => {});
    await iso.drop();
  });
  const bin = path.join(dir, "bin");
  const stub = path.join(dir, "stub");
  const proc = path.join(dir, "proc");
  for (const d of [bin, stub, proc]) mkdirSync(d, { recursive: true });
  for (const [name, body] of [["docker", STUB_DOCKER], ["df", STUB_DF]] as const) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(path.join(proc, "loadavg"), "3.50 2.25 1.10 2/512 12345\n");
  writeFileSync(path.join(proc, "cpuinfo"), Array.from({ length: 4 }, (_, i) => `processor\t: ${i}\nmodel name\t: x\n`).join("\n"));
  writeFileSync(
    path.join(proc, "meminfo"),
    "MemTotal:        8000000 kB\nMemFree: 100 kB\nMemAvailable:    1000000 kB\nSwapTotal:       4194304 kB\nSwapFree:        3145728 kB\n",
  );
  // The shared box also runs other projects' containers: only slaydx-* may appear.
  writeFileSync(path.join(stub, "ps.txt"), "other-app-1\nslaydx-web-1\nslaydx-postgres-1\nslaydx-worker-1\nunrelated\n");
  writeFileSync(
    path.join(stub, "stats.txt"),
    "other-app-1|99.00%|1GiB / 2GiB\nslaydx-web-1|12.50%|356.2MiB / 1.5GiB\nslaydx-postgres-1|250.00%|900MiB / 1GiB\nslaydx-worker-1|0.00%|2.5GiB / 3GiB\n",
  );
  writeFileSync(
    path.join(stub, "inspect.txt"),
    [
      `/other-app-1|${"d".repeat(64)}|running|0|false|2026-10-10T08:00:00Z`,
      `/slaydx-web-1|${"a".repeat(64)}|running|0|false|2026-10-10T10:00:00.123456789Z`,
      `/slaydx-postgres-1|${"b".repeat(64)}|running|2|false|2026-10-09T10:00:00Z`,
      `/slaydx-worker-1|${"c".repeat(64)}|exited|5|true|2026-10-10T09:00:00Z`,
    ].join("\n") + "\n",
  );
  // Format: `$msec $status $request_time`. Ten fresh requests (0.1 … 1.0 s); two outside the 5 minute window.
  const lines = [`${NOW - 600}.000 200 9.999`, `${NOW - 301}.500 500 9.999`];
  for (let i = 1; i <= 10; i++) lines.push(`${NOW - 10 * i}.250 ${i === 10 ? 500 : i === 9 ? 404 : 200} ${(i / 10).toFixed(3)}`);
  const nginxLog = path.join(dir, "slaydx.access.log");
  writeFileSync(nginxLog, lines.join("\n") + "\n");

  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    NODE_ENV: "test",
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    LANG: "C.UTF-8",
    STUB_DIR: stub,
    STUB_DB_URL: process.env.DATABASE_URL!,
    POSTGRES_PASSWORD: FAKE_PG_PASSWORD,
    METRICS_PROC: proc,
    METRICS_NGINX_LOG: nginxLog,
    METRICS_NOW: String(NOW),
    METRICS_LOCK: path.join(dir, "metrics.lock"),
    ...extra,
  });
  const run = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync("bash", [SCRIPT, ...args], { env: env(extra), encoding: "utf8", timeout: 60_000 });

  await t.test("--print: host, containers (slaydx-* only) and nginx are parsed from the fixtures", () => {
    const r = run(["--print"]);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout) as HostJson;
    assert.equal(j.v, 1);
    assert.deepEqual([j.cpus, j.load1, j.load5, j.load15], [4, 3.5, 2.25, 1.1]);
    assert.deepEqual([j.mem_total_mb, j.mem_avail_mb, j.mem_used_mb], [7812, 976, 6836]);
    assert.deepEqual([j.swap_total_mb, j.swap_used_mb], [4096, 1024]);
    assert.equal(j.disk_pct, 63);
    assert.deepEqual(j.containers.map((c: { name: string }) => c.name).sort(), ["slaydx-postgres-1", "slaydx-web-1", "slaydx-worker-1"]);
    const web = j.containers.find((c) => c.name === "slaydx-web-1")!;
    assert.deepEqual(
      [web.cpu_pct, web.mem_mb, web.mem_limit_mb, web.restarts, web.oom, web.status, web.id],
      [12.5, 356.2, 1536, 0, false, "running", "a".repeat(12)],
    );
    const worker = j.containers.find((c) => c.name === "slaydx-worker-1")!;
    assert.deepEqual([worker.mem_mb, worker.restarts, worker.oom, worker.status], [2560, 5, true, "exited"]);
    // 12 lines in the log, 10 of them inside the last 300 s: 8 x 200, 1 x 404, 1 x 500.
    assert.deepEqual(
      [j.nginx!.requests, j.nginx!.s2xx, j.nginx!.s4xx, j.nginx!.s5xx, j.nginx!.p50_ms, j.nginx!.p95_ms, j.nginx!.window_s],
      [10, 8, 1, 1, 500, 1000, 300],
    );
  });

  await t.test("--print: no nginx log -> nginx null, docker down -> empty containers, still valid JSON", () => {
    const r = run(["--print"], { METRICS_NGINX_LOG: path.join(dir, "missing.log") });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).nginx, null);
    writeFileSync(path.join(stub, "docker-fail"), "1");
    const d = run(["--print"]);
    rmSync(path.join(stub, "docker-fail"));
    assert.equal(d.status, 0);
    assert.deepEqual(JSON.parse(d.stdout).containers, []);
  });

  await t.test("--print never inserts and takes no lock", async () => {
    await query("DELETE FROM server_metrics");
    const before = readFileSync(path.join(stub, "docker.log"), "utf8");
    assert.equal(run(["--print"]).status, 0);
    const added = readFileSync(path.join(stub, "docker.log"), "utf8").slice(before.length);
    assert.ok(!/\bexec\b/.test(added), "docker exec was called in --print mode");
    assert.equal((await query("SELECT 1 FROM server_metrics")).length, 0);
  });

  await t.test("insert mode writes exactly one kind='host' row; credentials never on a command line", async () => {
    await query("DELETE FROM server_metrics");
    const r = run([]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");
    const rows = await query<{ kind: string; data: HostJson }>("SELECT kind, data FROM server_metrics");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "host");
    assert.equal(rows[0].data.load1, 3.5);
    assert.equal(rows[0].data.containers.length, 3);
    const log = readFileSync(path.join(stub, "docker.log"), "utf8");
    assert.ok(!log.includes(FAKE_PG_PASSWORD), "password reached a docker command line");
    assert.ok(!(r.stdout + r.stderr).includes(FAKE_PG_PASSWORD));
    // The DB user/name are resolved INSIDE the container from its own environment.
    assert.match(log, /exec -i slaydx-postgres-1 sh -c exec psql .*-U "\$POSTGRES_USER" -d "\$POSTGRES_DB"/);
  });

  await t.test("flock: a second run while the first holds the lock exits 0 and inserts nothing", async () => {
    await query("DELETE FROM server_metrics");
    const lock = path.join(dir, "held.lock");
    // Hold the lock from a child for the duration of the run.
    const holder = spawnSync("bash", ["-c", `exec 9>"${lock}"; flock -n 9 && METRICS_LOCK="${lock}" bash "${SCRIPT}"; echo done`], {
      env: env({ METRICS_LOCK: lock }),
      encoding: "utf8",
    });
    assert.equal(holder.status, 0, holder.stderr);
    assert.equal((await query("SELECT 1 FROM server_metrics")).length, 0, "the script wrote while the lock was held");
  });

  await t.test("insert failure (psql/docker down): one stderr line, exit 0, no row", async () => {
    await query("DELETE FROM server_metrics");
    writeFileSync(path.join(stub, "docker-fail"), "1");
    const r = run([]);
    rmSync(path.join(stub, "docker-fail"));
    assert.equal(r.status, 0);
    assert.match(r.stderr, /^slaydx-metrics: /);
    assert.ok(r.stderr.trim().split("\n").length <= 2, r.stderr);
    assert.equal((await query("SELECT 1 FROM server_metrics")).length, 0);
  });

  await t.test("unknown arguments are reported and still exit 0", () => {
    const r = run(["--bogus"]);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /unknown argument/);
  });
});
