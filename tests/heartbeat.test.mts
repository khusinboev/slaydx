import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Process heartbeats (`lib/server/heartbeat.ts`) and the read-only breaker /
 * limiter snapshots they publish (docs/admin/02-plan.md §5.2, §6.11).
 *
 * Unit: the snapshots report name/state/openUntil/failures and
 * active/waiting/max without changing breaker or limiter behaviour; the process
 * id is `<role>@<hostname>:<pid>`; a beat against a dead DB never throws.
 * DB (throwaway database): a beat upserts one row per process with the running
 * count, concurrency and the snapshots; a second beat updates the same row.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("heartbeat") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const hb = await import("../lib/server/heartbeat.ts");
const { breakerFor, resetBreakers, snapshotBreakers, CircuitBreaker } = await import("../lib/generation/llm/breaker.ts");
const { limiterFor, resetLimiters, snapshotLimiters } = await import("../lib/generation/llm/limiter.ts");

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

test("snapshotBreakers: state, openUntil and failures; reading changes nothing", () => {
  resetBreakers();
  let now = 1_000_000;
  const b = breakerFor("hb-gemini", { threshold: 3, cooldownMs: 10_000, now: () => now, log: () => {} });
  b.failure();
  breakerFor("hb-anthropic", { log: () => {} }).trip(5_000, "kvota");
  const snap = snapshotBreakers();
  assert.deepEqual(
    snap.map((s) => s.name),
    ["hb-anthropic", "hb-gemini"],
  );
  const g = snap.find((s) => s.name === "hb-gemini")!;
  assert.deepEqual(g, { name: "hb-gemini", state: "closed", openUntil: null, failures: 1 });
  const a = snap.find((s) => s.name === "hb-anthropic")!;
  assert.equal(a.state, "open");
  assert.ok(a.openUntil && !Number.isNaN(Date.parse(a.openUntil)));
  // Snapshots are read-only: the breaker still opens on the third failure as before.
  snapshotBreakers();
  b.failure();
  assert.equal(b.state, "closed");
  b.failure();
  assert.equal(b.state, "open");
  assert.equal(b.snapshot().openUntil, new Date(now + 10_000).toISOString());
  now += 10_001;
  assert.equal(b.snapshot().state, "half-open");
  assert.ok(new CircuitBreaker("solo").snapshot().state === "closed");
  resetBreakers();
});

test("snapshotLimiters: active, waiting and max; reading changes nothing", async () => {
  resetLimiters();
  const s = limiterFor("anthropic");
  const r1 = await s.acquire();
  const r2 = await s.acquire();
  const r3 = await s.acquire();
  const r4 = await s.acquire();
  const waiting = s.acquire();
  assert.deepEqual(snapshotLimiters(), [{ name: "anthropic", active: 4, waiting: 1, max: 4 }]);
  r1?.();
  const r5 = await waiting;
  assert.deepEqual(snapshotLimiters(), [{ name: "anthropic", active: 4, waiting: 0, max: 4 }]);
  for (const r of [r2, r3, r4, r5]) r?.();
  assert.equal(s.active, 0);
  resetLimiters();
});

test("processIdFor: <role>@<hostname>:<pid>", () => {
  const host = hostname().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) || "unknown";
  assert.equal(hb.processIdFor("worker"), `worker@${host}:${process.pid}`);
  assert.equal(hb.processIdFor("web"), `web@${host}:${process.pid}`);
});

test("a failing beat never throws (DB down)", async (t) => {
  quiet(t);
  const { pool } = await import("../lib/server/db.ts");
  if (!hasDb) {
    // No database at all: the beat must still be harmless.
    hb.startHeartbeat({ role: "web", concurrency: 0, getRunning: () => 0, intervalMs: 60_000 });
    await hb.beatNow("web");
    hb.stopHeartbeat("web");
    return;
  }
  const p = pool();
  t.mock.method(p, "query", async () => {
    throw new Error("ECONNREFUSED");
  });
  hb.startHeartbeat({
    role: "web",
    concurrency: 0,
    getRunning: () => {
      throw new Error("getter broke");
    },
    intervalMs: 60_000,
  });
  await assert.doesNotReject(hb.beatNow("web"));
  hb.stopHeartbeat("web");
});

test("heartbeat row (Postgres)", { skip }, async (t) => {
  const { migrate, pool, query } = await import("../lib/server/db.ts");
  await migrate();
  t.after(async () => {
    hb.stopHeartbeat();
    resetBreakers();
    resetLimiters();
    await pool().end();
    await iso.drop();
  });
  resetBreakers();
  resetLimiters();
  breakerFor("hb-xai", { log: () => {} }).trip(60_000);
  const rel = await limiterFor("gemini").acquire();

  let running = 2;
  hb.startHeartbeat({ role: "worker", concurrency: 3, getRunning: () => running, intervalMs: 60_000 });
  // The first beat starts immediately; wait for it, then beat again.
  await hb.beatNow("worker");
  const id = hb.processIdFor("worker");
  type Row = {
    process_id: string;
    role: string;
    hostname: string;
    started_at: Date;
    last_seen_at: Date;
    running: number;
    concurrency: number;
    breakers: Array<{ name: string; state: string }>;
    limiters: Array<{ name: string; active: number; max: number }>;
  };
  let rows = await query<Row>("SELECT * FROM process_heartbeats");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].process_id, id);
  assert.equal(rows[0].role, "worker");
  assert.equal(rows[0].running, 2);
  assert.equal(rows[0].concurrency, 3);
  assert.deepEqual(rows[0].breakers.map((b) => [b.name, b.state]), [["hb-xai", "open"]]);
  assert.deepEqual(rows[0].limiters, [{ name: "gemini", active: 1, waiting: 0, max: 10 }]);
  const firstSeen = rows[0].last_seen_at;
  const startedAt = rows[0].started_at;

  running = 0;
  rel?.();
  await new Promise((r) => setTimeout(r, 20));
  // A second start for the same role refreshes options, it does not add a timer/row.
  hb.startHeartbeat({ role: "worker", concurrency: 5, getRunning: () => running, intervalMs: 60_000 });
  await hb.beatNow("worker");
  rows = await query<Row>("SELECT * FROM process_heartbeats");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].running, 0);
  assert.equal(rows[0].concurrency, 5);
  assert.equal(rows[0].limiters[0].active, 0);
  assert.ok(rows[0].last_seen_at.getTime() >= firstSeen.getTime());
  assert.equal(rows[0].started_at.getTime(), startedAt.getTime(), "started_at is the process start, kept across beats");

  hb.stopHeartbeat("worker");
  await hb.beatNow("worker"); // stopped: no-op
});
