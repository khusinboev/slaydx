import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * Worker wiring of the bonus channel stay sweep (docs/bonus/PLAN.md, K1):
 * `purgeHousekeeping` runs `staySweep(200)` as the recorded step «bonus-stay»,
 * at most every 10 minutes (the mark is set before the run, like
 * «retention»), and a failing sweep does not stop the other steps.
 * Stubbed pool — no database.
 *
 * Mutations (each turned a test red, then restored):
 *   1. the `step("bonus-stay", …)` call removed → «recorded … with batch 200»;
 *   3. `STAY_BATCH` back to 50 → «recorded … with batch 200».
 *   2. the 10 min cadence check removed → «skipped on the next tick».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-bonus-worker-token";
process.env.DATABASE_URL ||= "postgres://unused/unused";

const hs = await import("../lib/server/housekeeping-status.ts");
const { pool } = await import("../lib/server/db.ts");
const worker = await import("../lib/server/worker.ts");

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const DUE = /FROM bonus_channel_claims c JOIN bonus_channels ch .* LIMIT \$1/;

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

function stubPool(t: TestContext, fail = false) {
  const seen: Array<{ text: string; params: unknown[] }> = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text: norm(text), params });
    if (fail && DUE.test(norm(text))) throw new Error("bonus sweep exploded");
    return { rows: [], rowCount: 0 };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

test("housekeeping records «bonus-stay» with batch 200, then skips it for 10 minutes", async (t) => {
  quiet(t);
  const seen = stubPool(t);
  worker.resetRetentionScan();
  await worker.housekeeping();
  await hs.flushStepStatus();

  const due = seen.filter((q) => DUE.test(q.text));
  assert.equal(due.length, 1, "MUTATSIYA 1: the sweep ran once");
  assert.deepEqual(due[0]!.params, [worker.STAY_SWEEP_BATCH, 6]);
  assert.equal(worker.STAY_SWEEP_BATCH, 200);
  const status = seen.filter((q) => /INSERT INTO housekeeping_status/.test(q.text)).find((q) => q.params[0] === "bonus-stay");
  assert.ok(status, "status row recorded");
  assert.equal(status!.params[1], true, "ok");
  assert.equal(status!.params[3], 0, "rows = claims checked");

  // Leader-only purges: it runs after the existing ones.
  const at = (re: RegExp) => seen.findIndex((q) => re.test(q.text));
  assert.ok(at(/DELETE FROM source_cache/) < at(DUE));

  seen.length = 0;
  await worker.housekeeping();
  await hs.flushStepStatus();
  assert.equal(seen.filter((q) => DUE.test(q.text)).length, 0, "MUTATSIYA 2: cadence");
  assert.ok(!seen.some((q) => /INSERT INTO housekeeping_status/.test(q.text) && q.params[0] === "bonus-stay"));
});

test("a failing sweep is recorded as a failure and does not throw out of housekeeping", async (t) => {
  quiet(t);
  const seen = stubPool(t, true);
  worker.resetRetentionScan();
  await worker.housekeeping();
  await hs.flushStepStatus();
  const status = seen.filter((q) => /INSERT INTO housekeeping_status/.test(q.text)).find((q) => q.params[0] === "bonus-stay");
  assert.ok(status);
  assert.equal(status!.params[1], false);
  assert.match(String(status!.params[2]), /bonus sweep exploded/);
});
