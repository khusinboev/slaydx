import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * The market in worker housekeeping: a restart must not start a scan. Deploys restart every worker, and the scan on the
 * first tick after a start was the hang the lead saw. This file imports the worker fresh (nothing has called
 * `resetRetentionScan`), so `housekeeping()` here IS the first tick of a process. Database stubbed, as in
 * tests/housekeeping-status.test.mts. The cadence after that first hour is locked there.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `lastMarketScanAt = -Infinity`                 -> «the first tick»;
 *   2. the warm-up step removed from `purgeHousekeeping` -> «the warm-up runs every tick».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const worker = await import("../lib/server/worker.ts");
const hs = await import("../lib/server/housekeeping-status.ts");

function stubDb(t: TestContext): () => unknown[] {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
  const seen: { text: string; params: unknown[] }[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text, params });
    return { rows: [], rowCount: 0 };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return () => seen.filter((q) => /INSERT INTO housekeeping_status/.test(q.text)).map((q) => q.params[0]);
}

test("the first tick after a start runs no market scan and no market sweep", async (t) => {
  const steps = stubDb(t);
  await worker.housekeeping();
  await hs.flushStepStatus();
  const done = steps();
  assert.ok(done.includes("sessions"), "housekeeping ran");
  for (const step of ["market-candidates", "market-previews-gc", "market-rejected-gc"]) assert.ok(!done.includes(step), step);
});

test("the warm-up runs every tick; after the wait the scan runs", async (t) => {
  const steps = stubDb(t);
  await worker.housekeeping();
  await hs.flushStepStatus();
  assert.ok(steps().includes("market-previews-warm"));
  worker.resetRetentionScan();
  await worker.housekeeping();
  await hs.flushStepStatus();
  assert.ok(steps().includes("market-candidates"));
});
