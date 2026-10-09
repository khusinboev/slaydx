import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Housekeeping step status (`lib/server/housekeeping-status.ts`) and its
 * wiring into `lib/server/worker.ts` (docs/admin/02-plan.md §5.2, §5.5, §6.11).
 *
 * DB (throwaway database): `recordStep` returns the step's own result and
 * rethrows its own error object; it counts runs/failures, keeps the last ok
 * time and rows across a failure, records rows from a number, `{rows}` or an
 * array, and stores the error text redacted.
 * Stubbed pool: a dead DB never changes the step's result or error; the worker
 * records every named housekeeping step (not the per-job refund sub-steps) and
 * runs the new leader-only purges (§5.5).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("hkstatus") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const hs = await import("../lib/server/housekeeping-status.ts");
const { pool } = await import("../lib/server/db.ts");

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

test("rowsOf: number, {rows}, array, otherwise null", () => {
  assert.equal(hs.rowsOf(7), 7);
  assert.equal(hs.rowsOf({ rows: 3, other: 1 }), 3);
  assert.equal(hs.rowsOf(["a", "b"]), 2);
  assert.equal(hs.rowsOf(undefined), null);
  assert.equal(hs.rowsOf("12"), null);
  assert.equal(hs.rowsOf(Number.NaN), null);
  assert.equal(hs.rowsOf(1e12), 2_147_483_647);
});

test("dead DB: the step's result and error are unchanged", async (t) => {
  quiet(t);
  const p = pool();
  t.mock.method(p, "query", async () => {
    throw new Error("ECONNREFUSED");
  });
  const value = { rows: 5 };
  assert.equal(await hs.recordStep("dead-db-ok", "worker@h:1", async () => value), value);
  const boom = new Error("step failed");
  await assert.rejects(hs.recordStep("dead-db-fail", "worker@h:1", async () => {
    throw boom;
  }), (e) => e === boom);
  await hs.flushStepStatus();
});

test("worker housekeeping records every named step and runs the new purges", async (t) => {
  quiet(t);
  const seen: Array<{ text: string; params: unknown[] }> = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text: norm(text), params });
    // `reclaimStaleJobs` finds one dead job → a per-job refund sub-step runs.
    if (/SET status = 'FAILED', progress = 100/.test(text)) return { rows: [{ id: "00000000-0000-4000-8000-0000000000aa" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  const worker = await import("../lib/server/worker.ts");
  worker.resetRetentionScan();
  await worker.housekeeping();
  await hs.flushStepStatus();

  const statusRows = seen.filter((q) => /INSERT INTO housekeeping_status/.test(q.text));
  const steps = statusRows.map((q) => q.params[0]);
  for (const name of [
    "reclaim",
    "queue-ttl",
    "refund-reconcile",
    "retention",
    "payment-events",
    "sessions",
    "game-sessions",
    "rate-limits",
    "tickets",
    "sources",
    "photos",
    "source-cache",
    "error-log",
    "heartbeats",
    "admin-sessions",
    "broadcast-recipients",
  ]) {
    assert.ok(steps.includes(name), `status not recorded for ${name}`);
  }
  assert.ok(!steps.some((s) => String(s).startsWith("reclaim-refund")), "per-job sub-steps must not create status rows");
  const reclaim = statusRows.find((q) => q.params[0] === "reclaim")!;
  assert.equal(reclaim.params[1], true);
  assert.equal(reclaim.params[3], 1, "rows = dead jobs reclaimed");
  assert.match(String(reclaim.params[4]), /^worker@.+:\d+$/);

  // Leader-only purges (§5.5).
  const texts = seen.map((q) => q.text);
  assert.ok(texts.some((q) => /DELETE FROM error_log WHERE last_seen_at < now\(\) - interval '90 days'/.test(q)));
  assert.ok(texts.some((q) => /DELETE FROM process_heartbeats WHERE last_seen_at < now\(\) - interval '1 day'/.test(q)));
  assert.ok(texts.some((q) => /DELETE FROM admin_sessions WHERE expires_at < now\(\) - interval '7 days'/.test(q)));
  assert.ok(texts.some((q) => /DELETE FROM admin_enrollments WHERE created_at < now\(\) - interval '7 days' AND \(consumed_at IS NOT NULL OR expires_at < now\(\)\)/.test(q)));
  assert.ok(texts.some((q) => /DELETE FROM broadcast_recipients .*b\.status IN \('done', 'cancelled'\).*interval '180 days'/.test(q)));
  // Existing purges still run, in their original order, before the new ones.
  const at = (re: RegExp) => texts.findIndex((q) => re.test(q));
  assert.ok(at(/DELETE FROM source_cache/) >= 0);
  assert.ok(at(/DELETE FROM source_cache/) < at(/DELETE FROM error_log/));

  // The 6 h steps are skipped (and not recorded) on the next tick.
  seen.length = 0;
  await worker.housekeeping();
  await hs.flushStepStatus();
  const again = seen.filter((q) => /INSERT INTO housekeeping_status/.test(q.text)).map((q) => q.params[0]);
  assert.ok(!again.includes("retention") && !again.includes("payment-events"));
  assert.ok(again.includes("sessions"));
});

test("housekeeping_status rows (Postgres)", { skip }, async (t) => {
  quiet(t);
  const { migrate, query } = await import("../lib/server/db.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  type Row = {
    step: string;
    runs: string;
    failures: string;
    last_rows: number | null;
    last_error: string | null;
    last_ok_at: Date | null;
    last_error_at: Date | null;
    last_run_at: Date;
    last_process: string;
  };
  const row = async (step: string) => (await query<Row>("SELECT * FROM housekeeping_status WHERE step = $1", [step]))[0];

  assert.equal(await hs.recordStep("purge-x", "worker@a:1", async () => 12), 12);
  await hs.flushStepStatus();
  let r = await row("purge-x");
  assert.equal(Number(r.runs), 1);
  assert.equal(Number(r.failures), 0);
  assert.equal(r.last_rows, 12);
  assert.ok(r.last_ok_at);
  assert.equal(r.last_error, null);
  assert.equal(r.last_process, "worker@a:1");
  const okAt = r.last_ok_at!.getTime();

  const boom = new Error("connect failed token=supersecretvalue123");
  await assert.rejects(hs.recordStep("purge-x", "worker@b:2", async () => {
    throw boom;
  }), (e) => e === boom);
  await hs.flushStepStatus();
  r = await row("purge-x");
  assert.equal(Number(r.runs), 2);
  assert.equal(Number(r.failures), 1);
  assert.equal(r.last_rows, 12, "last rows of the last good run are kept");
  assert.equal(r.last_ok_at!.getTime(), okAt);
  assert.ok(r.last_error_at);
  assert.match(r.last_error!, /connect failed/);
  assert.doesNotMatch(r.last_error!, /supersecretvalue123/);
  assert.equal(r.last_process, "worker@b:2");

  await hs.recordStep("purge-x", "worker@a:1", async () => ({ rows: 4 }));
  await hs.recordStep("purge-y", "worker@a:1", async () => ["a", "b", "c"]);
  await hs.recordStep("purge-z", "worker@a:1", async () => undefined);
  await hs.flushStepStatus();
  r = await row("purge-x");
  assert.equal(Number(r.runs), 3);
  assert.equal(r.last_rows, 4);
  assert.match(r.last_error!, /connect failed/, "the last error stays visible after a recovery");
  assert.equal((await row("purge-y")).last_rows, 3);
  assert.equal((await row("purge-z")).last_rows, null);
});
