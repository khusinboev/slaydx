import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `GET /api/admin/system/metrics` through the REAL route (docs/ops/METRICS.md):
 *   - exact response shape; empty state (`hasData: false`, no points, no peaks);
 *   - range handling: default 24h, 24h / 7d / 30d, anything else is a 400;
 *   - downsampling in SQL: a month of samples comes back as a few hundred points, bucket maxima keep
 *     spikes, request counts become per-minute rates, containers are one series per name;
 *   - «Eng yuqori nuqtalar» come from the raw samples with their exact timestamps;
 *   - the hard row cap drops the OLDEST buckets and says so (`truncated`);
 *   - permission `system.view`: owner, admin, finance, support, viewer 200; moderator 403 (no data in
 *     the body); no admin session 401; a user without an admin account 404.
 *
 * Mutations that turn this red: a route permission the moderator also has; no `LIMIT`/slice (cap);
 * `avg` instead of `max` in the buckets (spikes vanish); bucket size mixed up between ranges.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-metrics-test-token-never-called";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("adminsrvmetrics") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const svc = await import("../lib/server/admin-server-metrics.ts");
const route = await import("../app/api/admin/system/metrics/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb && iso.isolated) await ensureMigrated();

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function sessionFor(role: Role): Promise<{ cookie: string; adminId: string }> {
  const u = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, 'Metrics Test') RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `met_${randomBytes(5).toString("hex")}`],
  );
  const { token } = await createSession(u!.id);
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u!.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: acc!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "metrics-test", reauth: true }),
  );
  return { cookie: `${SESSION_COOKIE}=${token}; ${adminCookieName()}=${s.token}`, adminId: acc!.id };
}

type Body = Awaited<ReturnType<typeof svc.getServerMetrics>> & { code?: string };
async function call(cookie: string | null, qs = ""): Promise<{ status: number; body: Body; text: string }> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "metrics-test" };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost:3000/api/admin/system/metrics${qs}`, { headers });
  const res = await inRequest(req, () => route.GET(req, undefined));
  const text = await res.text();
  let body = {} as Body;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body, text };
}

const clear = () => query("DELETE FROM server_metrics");
const host = (minutesAgo: number, data: object) =>
  query(`INSERT INTO server_metrics (at, kind, data) VALUES (now() - make_interval(mins => $1), 'host', $2::jsonb)`, [minutesAgo, JSON.stringify(data)]);
const app = (minutesAgo: number, data: object) =>
  query(`INSERT INTO server_metrics (at, kind, data) VALUES (now() - make_interval(mins => $1), 'app', $2::jsonb)`, [minutesAgo, JSON.stringify(data)]);

const HOST = (o: Record<string, unknown> = {}) => ({
  v: 1, cpus: 4, load1: 1, load5: 1, load15: 1, mem_total_mb: 8000, mem_used_mb: 4000, mem_avail_mb: 4000, swap_total_mb: 4000, swap_used_mb: 400, disk_pct: 50,
  containers: [
    { name: "slaydx-web-1", mem_mb: 400, cpu_pct: 5 },
    { name: "slaydx-worker-1", mem_mb: 900, cpu_pct: 20 },
  ],
  nginx: { window_s: 300, requests: 300, s2xx: 290, s3xx: 0, s4xx: 6, s5xx: 4, p50_ms: 80, p95_ms: 400 },
  ...o,
});
const APP = (o: { users?: number; queued?: number; oldest?: number; wait?: number } = {}) => ({
  v: 1,
  users: { active_5m: o.users ?? 10, seen_1h: 20 },
  queue: { queued: o.queued ?? 0, running: 1, oldest_age_s: o.oldest ?? 0 },
  jobs: { window_min: 5, completed: 4, failed: 1, wait_p50_s: 1, wait_p95_s: o.wait ?? 2, dur_p50_s: 30, dur_p95_s: 60 },
  db: { conns: 12, conns_active: 2, max_conns: 100, pool: { total: 5, idle: 4, waiting: 0 } },
  proc: { rss_mb: 300, heap_mb: 100, loop_lag_p99_ms: 12, loop_lag_max_ms: 40 },
});

test("empty system: hasData false, no points, no peaks, exact shape", { skip }, async () => {
  await clear();
  const s = await sessionFor("viewer");
  const r = await call(s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["app", "bucketSec", "containers", "from", "hasData", "host", "peaks", "range", "to", "truncated"]);
  assert.equal(r.body.hasData, false);
  assert.deepEqual([r.body.host, r.body.app, r.body.containers], [[], [], []]);
  assert.deepEqual(Object.values(r.body.peaks), [null, null, null, null, null]);
  assert.equal(r.body.range, "24h");
  assert.equal(r.body.bucketSec, 300);
  assert.equal(r.body.truncated, false);
});

test("range parameter: default 24h, each range has its bucket size, junk is a 400", { skip }, async () => {
  const s = await sessionFor("viewer");
  for (const [range, binSec, hours] of [["24h", 300, 24], ["7d", 1800, 168], ["30d", 7200, 720]] as const) {
    const r = await call(s.cookie, `?range=${range}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.range, range);
    assert.equal(r.body.bucketSec, binSec);
    assert.equal(Math.round((Date.parse(r.body.to) - Date.parse(r.body.from)) / 3_600_000), hours);
  }
  for (const bad of ["?range=1y", "?range=24H", "?range=%00", "?range=24h&range=7d"]) {
    const r = await call(s.cookie, bad);
    // a repeated parameter takes the first value; only unknown values are rejected
    if (bad.includes("&range=")) assert.equal(r.status, 200);
    else assert.equal(r.status, 400, bad);
  }
  // every range fits the hard cap by construction
  for (const { hours, binSec } of Object.values(svc.METRIC_RANGES)) assert.ok((hours * 3600) / binSec + 1 <= svc.MAX_SERIES_POINTS);
});

test("buckets keep the spike (max), requests become per-minute rates, containers are one series per name", { skip }, async () => {
  await clear();
  const s = await sessionFor("owner");
  // Five host samples (5 min apart, newest first below) and ten app samples (1 min apart) in the last 45 minutes.
  await host(41, HOST({ mem_avail_mb: 4000 }));
  await host(36, HOST({ mem_avail_mb: 800, load1: 9.5, swap_used_mb: 3000 })); // the spike: 90 % memory, load 9.5, swap 75 %
  await host(31, HOST({ nginx: { window_s: 300, requests: 600, s2xx: 600, s3xx: 0, s4xx: 0, s5xx: 0, p50_ms: 50, p95_ms: 90 } }));
  await host(26, HOST({ nginx: null }));
  await host(21, HOST({ containers: [{ name: "slaydx-web-1", mem_mb: 450, cpu_pct: 7 }] }));
  for (let i = 0; i < 10; i++) await app(40 - i, APP({ users: 10 + i * 5, queued: i, oldest: i * 10, wait: i }));
  const r = await call(s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.hasData, true);
  // Series are ascending in time.
  const ts = r.body.host.map((p) => Date.parse(p.t));
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  assert.ok(r.body.host.length >= 5 && r.body.host.length <= 10, `host points ${r.body.host.length}`);
  // The spike survived the downsampling.
  assert.equal(Math.max(...r.body.host.map((p) => p.memUsedPct ?? 0)), 90);
  assert.equal(Math.max(...r.body.host.map((p) => p.load1 ?? 0)), 9.5);
  assert.equal(Math.max(...r.body.host.map((p) => p.swapUsedPct ?? 0)), 75);
  // 300 requests in a 300 s window = 60/min; 600 = 120/min; a sample without nginx data adds nothing.
  const perMin = r.body.host.map((p) => p.reqPerMin).filter((v): v is number => v !== null);
  assert.ok(perMin.includes(60) && perMin.includes(120), JSON.stringify(perMin));
  assert.ok(r.body.host.some((p) => p.s5xxPerMin === 0.8), "4 x 5xx in 300 s = 0.8 per minute");
  assert.ok(r.body.host.some((p) => p.p95Ms === 400));
  // App points: users peak is the max of the bucket, never an average.
  assert.equal(Math.max(...r.body.app.map((p) => p.activeUsers ?? 0)), 55);
  assert.equal(Math.max(...r.body.app.map((p) => p.queued ?? 0)), 9);
  assert.ok(r.body.app.length >= 2 && r.body.app.length <= 4, `app buckets ${r.body.app.length}`);
  // Containers: two names; the worker has no row in the last sample.
  const names = [...new Set(r.body.containers.map((c) => c.name))].sort();
  assert.deepEqual(names, ["slaydx-web-1", "slaydx-worker-1"]);
  assert.equal(Math.max(...r.body.containers.filter((c) => c.name === "slaydx-web-1").map((c) => c.memMb ?? 0)), 450);
  assert.equal(Math.max(...r.body.containers.filter((c) => c.name === "slaydx-worker-1").map((c) => c.memMb ?? 0)), 900);
});

test("«Eng yuqori nuqtalar»: exact values and timestamps from the raw samples", { skip }, async () => {
  const s = await sessionFor("owner");
  const r = await call(s.cookie);
  const p = r.body.peaks;
  assert.equal(p.activeUsers?.value, 55);
  assert.equal(p.activeUsers?.queued, 9);
  assert.equal(p.activeUsers?.waitP95Sec, 9);
  const ageMin = (Date.now() - Date.parse(p.activeUsers!.at)) / 60_000;
  assert.ok(ageMin > 30.5 && ageMin < 32.5, `peak users were ${ageMin} minutes ago`); // i = 9 -> 40 - 9 = 31 minutes ago
  assert.equal(p.memUsedPct?.value, 90);
  assert.ok(Math.abs((Date.now() - Date.parse(p.memUsedPct!.at)) / 60_000 - 36) < 1);
  assert.equal(p.oldestQueuedSec?.value, 90);
  assert.equal(p.waitP95Sec?.value, 9);
  assert.equal(p.load1?.value, 9.5);
});

test("downsampling: a month of samples is a few hundred points per series", { skip }, async () => {
  await clear();
  const s = await sessionFor("owner");
  await query(
    `INSERT INTO server_metrics (at, kind, data)
     SELECT now() - make_interval(mins => g), 'app', $1::jsonb FROM generate_series(1, 43200) g`,
    [JSON.stringify(APP())],
  );
  await query(
    `INSERT INTO server_metrics (at, kind, data)
     SELECT now() - make_interval(mins => g * 5), 'host', $1::jsonb FROM generate_series(1, 8640) g`,
    [JSON.stringify(HOST())],
  );
  const counts: Record<string, number[]> = {};
  for (const range of ["24h", "7d", "30d"] as const) {
    const r = await call(s.cookie, `?range=${range}`);
    assert.equal(r.status, 200);
    counts[range] = [r.body.host.length, r.body.app.length];
    assert.equal(r.body.truncated, false);
  }
  // 24 h / 5 min = 288, 7 d / 30 min = 336, 30 d / 2 h = 360 buckets (+1 for the partial edge bucket).
  assert.ok(counts["24h"][0] >= 280 && counts["24h"][0] <= 290, JSON.stringify(counts));
  assert.ok(counts["24h"][1] >= 280 && counts["24h"][1] <= 290, JSON.stringify(counts));
  assert.ok(counts["7d"][0] >= 330 && counts["7d"][0] <= 338, JSON.stringify(counts));
  assert.ok(counts["30d"][0] >= 355 && counts["30d"][0] <= 362, JSON.stringify(counts));
  assert.ok(counts["30d"][1] >= 355 && counts["30d"][1] <= 362, JSON.stringify(counts));
  const raw = (await query<{ n: string }>("SELECT count(*)::text AS n FROM server_metrics"))[0].n;
  assert.ok(Number(raw) > 50_000);
});

test("hard row cap: only the newest buckets are returned and `truncated` says so", { skip }, async () => {
  // The service takes the caps as a parameter so the cap is testable without 800+ real buckets.
  const out = await svc.getServerMetrics("7d", Date.now(), { series: 3, containers: 5 });
  assert.equal(out.truncated, true);
  assert.equal(out.host.length, 3);
  assert.equal(out.app.length, 3);
  assert.ok(out.containers.length <= 5);
  const full = await svc.getServerMetrics("7d");
  assert.deepEqual(out.host.map((p) => p.t), full.host.slice(-3).map((p) => p.t), "the cap must drop the OLDEST buckets");
  assert.equal(full.truncated, false);
});

test("permission: system.view — owner, admin, finance, support, viewer 200; moderator 403 with a denied audit row", { skip }, async () => {
  for (const role of ["owner", "admin", "finance", "support", "viewer"] as const) {
    const s = await sessionFor(role);
    const r = await call(s.cookie);
    assert.equal(r.status, 200, `${role}: ${r.text.slice(0, 100)}`);
  }
  const m = await sessionFor("moderator");
  const r = await call(m.cookie);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "forbidden");
  assert.ok(!r.text.includes("peaks") && !r.text.includes("host"), "a 403 carries no data");
  const audit = await query<{ outcome: string }>(`SELECT outcome FROM admin_audit_log WHERE admin_id = $1`, [m.adminId]);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].outcome, "denied");
});

test("guard: no admin session is 401 admin_auth, a user without an admin account is 404", { skip }, async () => {
  const s = await sessionFor("owner");
  const r401 = await call(s.cookie.split("; ")[0]);
  assert.equal(r401.status, 401);
  assert.equal(r401.body.code, "admin_auth");
  assert.equal((await call(null)).status, 404);
});

test("read-only: the endpoint never writes", { skip }, async () => {
  const s = await sessionFor("owner");
  const before = (await query<{ n: string }>("SELECT count(*)::text AS n FROM server_metrics"))[0].n;
  await call(s.cookie, "?range=30d");
  assert.equal((await query<{ n: string }>("SELECT count(*)::text AS n FROM server_metrics"))[0].n, before);
});
