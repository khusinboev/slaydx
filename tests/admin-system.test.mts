import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `/api/admin/system` through the REAL route (docs/admin/02-plan.md §6.11, S15,
 * §10 T12) on a throwaway Postgres:
 *   - exact response shape; db ok + latency, migrations applied / latest / last;
 *   - queue counts and the oldest queued age from real `generations` rows;
 *   - processes: rows written by the real heartbeat writer and plain rows, `stale`
 *     follows `admin-heartbeat.isStale` (the AI screen's rule) at its boundary;
 *   - housekeeping: rows written by `writeStepStatus` (ok, failing, repeated);
 *   - config: problems / warnings are message text only: no env value (a fake key,
 *     a secret and the raw FREE_LLM_DISABLED value never appear) and the
 *     unrecognised-value warning is blanked;
 *   - permission: owner, admin, finance, support, viewer 200; moderator 403 with a
 *     denied audit row; 401 without an admin session; 404 for a non-admin.
 *
 * Mutation checks (each made the named assertion fail, then restored) are listed
 * in the work-package report.
 */

const SECRETS = {
  CRON_SECRET: "cron-secret-VALUE-1f9a7c",
  GEMINI_API_KEY: "gemini-key-VALUE-77aa11",
  FREE_LLM_DISABLED: "sup3r-s3cret-typo",
  ADMIN_TOTP_KEY: randomBytes(32).toString("base64"),
} as const;

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
// 2FA-mode suite (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-system-test-token-never-called";
delete process.env.NEXT_PUBLIC_TELEGRAM_BOT; // → a config PROBLEM (token without bot username)
delete process.env.TELEGRAM_WEBHOOK_SECRET; // → a config WARNING (webhook guarded by CRON_SECRET)
for (const k of ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "AISHA_API_KEY", "TTS_GEMINI_MODEL"]) delete process.env[k]; // → TTS warning
Object.assign(process.env, SECRETS);

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("adminsystem") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { writeHeartbeat } = await import("../lib/server/heartbeat.ts");
const { writeStepStatus } = await import("../lib/server/housekeeping-status.ts");
const hb = await import("../lib/server/admin-heartbeat.ts");
const sys = await import("../lib/server/admin-system.ts");
const route = await import("../app/api/admin/system/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb && iso.isolated) await ensureMigrated();

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function sessionFor(role: Role): Promise<{ cookie: string; adminId: string }> {
  const u = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, 'System Test') RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `sys_${randomBytes(5).toString("hex")}`],
  );
  const { token } = await createSession(u!.id);
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u!.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: acc!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "system-test", reauth: true }),
  );
  return { cookie: `${SESSION_COOKIE}=${token}; ${adminCookieName()}=${s.token}`, adminId: acc!.id };
}

type Status = Awaited<ReturnType<typeof sys.getSystemStatus>>;
type Res = { status: number; body: Status & { code?: string; error?: string }; text: string };

async function call(cookie: string | null): Promise<Res> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "system-test" };
  if (cookie) headers.cookie = cookie;
  const req = new Request("http://localhost:3000/api/admin/system", { headers });
  const res = await inRequest(req, () => route.GET(req, undefined));
  const text = await res.text();
  let body = {} as Res["body"];
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body, text };
}

const STALE_MS = hb.HEARTBEAT_STALE_SEC * 1000;

// ───────────────────────────── empty system

test("empty system: db ok, no queue, no processes, no housekeeping; shape is exact", { skip }, async () => {
  const s = await sessionFor("viewer");
  const r = await call(s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["config", "db", "housekeeping", "nodeEnv", "processes", "queue", "version"]);
  assert.deepEqual(Object.keys(r.body.db).sort(), ["latencyMs", "migrations", "ok"]);
  assert.deepEqual(Object.keys(r.body.db.migrations).sort(), ["applied", "lastApplied", "latest"]);
  assert.deepEqual(Object.keys(r.body.queue).sort(), ["oldestQueuedSec", "queued", "running"]);
  assert.deepEqual(Object.keys(r.body.config).sort(), ["problems", "warnings"]);
  assert.equal(r.body.db.ok, true);
  assert.ok(typeof r.body.db.latencyMs === "number" && r.body.db.latencyMs >= 0 && r.body.db.latencyMs < 5_000);
  assert.deepEqual(r.body.queue, { queued: 0, running: 0, oldestQueuedSec: null });
  assert.deepEqual(r.body.processes, []);
  assert.deepEqual(r.body.housekeeping, []);
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  assert.equal(r.body.version, pkg.version);
  const env = process.env.NODE_ENV;
  assert.equal(r.body.nodeEnv, env === "production" || env === "development" || env === "test" ? env : "unknown");
});

test("migrations: applied = rows in schema_migrations, latest = files shipped, lastApplied = the newest name", { skip }, async () => {
  const s = await sessionFor("owner");
  const r = await call(s.cookie);
  const files = readdirSync("lib/server/migrations").filter((f) => f.endsWith(".sql")).sort();
  const applied = await query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY name`);
  assert.equal(r.body.db.migrations.applied, applied.length);
  assert.equal(r.body.db.migrations.latest, files.length);
  assert.equal(r.body.db.migrations.applied, r.body.db.migrations.latest, "a fresh database has everything applied");
  assert.equal(r.body.db.migrations.lastApplied, files.at(-1));
});

// ───────────────────────────── queue

test("queue: counts QUEUED and IN_PROGRESS jobs only; oldestQueuedSec is the age of the oldest QUEUED", { skip }, async () => {
  const u = await queryOne<{ id: string }>(`INSERT INTO users (name) VALUES ('Queue seed') RETURNING id::text AS id`);
  const gen = (status: string, minutesAgo: number) =>
    query(
      `INSERT INTO generations (id, user_id, tool_id, status, created_at) VALUES ($1, $2, 'slide', $3, now() - make_interval(mins => $4))`,
      [randomUUID(), u!.id, status, minutesAgo],
    );
  await gen("QUEUED", 3);
  await gen("QUEUED", 10); // the oldest queued one
  await gen("QUEUED", 5);
  await gen("IN_PROGRESS", 60); // older, but running: must not count as queued age
  await gen("IN_PROGRESS", 1);
  await gen("COMPLETED", 600);
  await gen("FAILED", 600);
  const s = await sessionFor("support");
  const r = await call(s.cookie);
  assert.equal(r.body.queue.queued, 3);
  assert.equal(r.body.queue.running, 2);
  const age = r.body.queue.oldestQueuedSec as number;
  assert.ok(age >= 600 && age < 660, `oldest queued ≈ 10 min, got ${age}`);
});

// ───────────────────────────── processes

test("processes: real heartbeat writer + plain rows; stale follows the shared isStale rule at its boundary", { skip }, async () => {
  // A real beat (this very process), fresh.
  await writeHeartbeat({ role: "web", concurrency: 0, getRunning: () => 0 }, new Date(Date.now() - 3_600_000));
  const realId = (await queryOne<{ process_id: string }>(`SELECT process_id FROM process_heartbeats`))!.process_id;
  assert.match(realId, /^web@.+:\d+$/);

  const insert = (id: string, role: "web" | "worker", ageMs: number, running: number, concurrency: number) =>
    query(
      `INSERT INTO process_heartbeats (process_id, role, hostname, started_at, last_seen_at, running, concurrency)
       VALUES ($1, $2, 'host-a', now() - interval '3 hours', now() - make_interval(secs => $3), $4, $5)`,
      [id, role, ageMs / 1000, running, concurrency],
    );
  await insert("worker@host-a:11", "worker", 5_000, 3, 4);
  await insert("worker@host-b:12", "worker", STALE_MS - 15_000, 0, 4); // just inside the window
  await insert("worker@host-c:13", "worker", STALE_MS + 15_000, 2, 4); // just outside
  await insert("worker@host-d:14", "worker", 20 * 60_000, 1, 4); // long dead

  const s = await sessionFor("finance");
  const r = await call(s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.processes.length, 5);
  for (const p of r.body.processes) {
    assert.deepEqual(Object.keys(p).sort(), ["concurrency", "hostname", "lastSeenAt", "process", "role", "running", "stale", "startedAt"]);
    assert.equal(p.stale, hb.isStale(p.lastSeenAt), `${p.process}: the same rule as the AI screen`);
  }
  const by = (id: string) => r.body.processes.find((p) => p.process === id)!;
  assert.equal(by(realId).stale, false);
  assert.equal(by("worker@host-a:11").stale, false);
  assert.equal(by("worker@host-b:12").stale, false);
  assert.equal(by("worker@host-c:13").stale, true);
  assert.equal(by("worker@host-d:14").stale, true);
  assert.equal(by("worker@host-a:11").running, 3);
  assert.equal(by("worker@host-a:11").concurrency, 4);
  assert.equal(by("worker@host-a:11").role, "worker");
  assert.equal(by("worker@host-a:11").hostname, "host-a");
  assert.equal(by(realId).role, "web");
  // Workers first, newest signal first within a role.
  assert.deepEqual(r.body.processes.map((p) => p.role), ["worker", "worker", "worker", "worker", "web"]);
  assert.equal(r.body.processes[0].process, "worker@host-a:11");

  // The boundary itself, with an injected clock: exactly at the limit is not stale, one ms later is.
  const base = Date.now();
  await query(`UPDATE process_heartbeats SET last_seen_at = $1::timestamptz WHERE process_id = 'worker@host-a:11'`, [new Date(base).toISOString()]);
  const edge = await sys.getSystemStatus(base + STALE_MS);
  assert.equal(edge.processes.find((p) => p.process === "worker@host-a:11")!.stale, false);
  const past = await sys.getSystemStatus(base + STALE_MS + 1);
  assert.equal(past.processes.find((p) => p.process === "worker@host-a:11")!.stale, true);
});

// ───────────────────────────── housekeeping

test("housekeeping: rows from the real status writer, failures and the last error, ordered by step", { skip }, async () => {
  await writeStepStatus("purgeOldSources", "worker@host-a:11", { ok: true, rows: 7, error: null });
  await writeStepStatus("purgeOldSources", "worker@host-a:11", { ok: true, rows: 2, error: null });
  await writeStepStatus("reclaimStaleJobs", "worker@host-a:11", { ok: true, rows: 0, error: null });
  await writeStepStatus("refundUnrefundedFailed", "worker@host-b:12", { ok: true, rows: 1, error: null });
  await writeStepStatus("refundUnrefundedFailed", "worker@host-b:12", { ok: false, rows: null, error: "lock timeout on generations" });
  const s = await sessionFor("admin");
  const r = await call(s.cookie);
  assert.deepEqual(r.body.housekeeping.map((h) => h.step), ["purgeOldSources", "reclaimStaleJobs", "refundUnrefundedFailed"]);
  const [purge, reclaim, refund] = r.body.housekeeping;
  for (const h of r.body.housekeeping) {
    assert.deepEqual(Object.keys(h).sort(), ["failures", "lastError", "lastErrorAt", "lastOkAt", "lastProcess", "lastRows", "lastRunAt", "runs", "step"]);
  }
  assert.equal(purge.runs, 2);
  assert.equal(purge.failures, 0);
  assert.equal(purge.lastRows, 2);
  assert.equal(purge.lastError, null);
  assert.equal(purge.lastErrorAt, null);
  assert.notEqual(purge.lastOkAt, null);
  assert.equal(purge.lastProcess, "worker@host-a:11");
  assert.equal(reclaim.runs, 1);
  assert.equal(reclaim.lastRows, 0);
  assert.equal(refund.runs, 2);
  assert.equal(refund.failures, 1);
  assert.equal(refund.lastError, "lock timeout on generations");
  assert.notEqual(refund.lastErrorAt, null);
  assert.notEqual(refund.lastOkAt, null, "the earlier successful run is remembered");
  assert.equal(refund.lastRows, 1, "rows of the last OK run stay");
  assert.equal(typeof purge.runs, "number", "bigint counters are plain numbers");
});

// ───────────────────────────── config

test("config: problems and warnings are message text; no env value ever appears (T12)", { skip }, async () => {
  const s = await sessionFor("owner");
  const r = await call(s.cookie);
  assert.equal(r.status, 200, r.text);
  const { problems, warnings } = r.body.config;
  assert.ok(problems.some((m) => m.includes("NEXT_PUBLIC_TELEGRAM_BOT")), `problems: ${problems.join(" | ")}`);
  assert.ok(warnings.some((m) => m.includes("TTS")), "TTS warning");
  assert.ok(warnings.some((m) => m.includes("FREE_LLM_DISABLED")), "the unrecognised kill-switch value is reported");
  assert.ok(problems.every((m) => typeof m === "string") && warnings.every((m) => typeof m === "string"));
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!r.text.includes(value), `${name} value must not appear in the response`);
  }
  assert.ok(!r.text.includes(process.env.TELEGRAM_BOT_TOKEN!), "bot token not in the response");
  const free = warnings.find((m) => m.includes("FREE_LLM_DISABLED"))!;
  assert.ok(free.includes('FREE_LLM_DISABLED="…"'), `the raw value is blanked: ${free}`);
});

test("safeConfigMessage: blanks quoted values after '=', keeps names, bounds the length", () => {
  assert.equal(sys.safeConfigMessage('X="top secret" tanilmadi'), 'X="…" tanilmadi');
  assert.equal(sys.safeConfigMessage("Y='abc' va Z = \"d e\""), "Y='…' va Z = \"…\"");
  assert.equal(sys.safeConfigMessage("DATABASE_URL yo'q — ma'lumotlar bazasi ulanmagan"), "DATABASE_URL yo'q — ma'lumotlar bazasi ulanmagan");
  assert.equal(sys.safeConfigMessage("a".repeat(1_000)).length, 400);
});

// ───────────────────────────── permission

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
  assert.ok(!r.text.includes("processes") && !r.text.includes("config"), "a 403 carries no data");
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
