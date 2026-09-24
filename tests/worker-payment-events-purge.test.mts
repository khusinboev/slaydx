import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * TO'LOV WEBHOOK IZI — HOUSEKEEPING'DA TOZALASH (W3 wrap-up (b), OBS-09 davomi).
 *
 * `payment_events` (`025_payment_events.sql`) har Click/Payme so'rovini
 * yozadi. `purgePaymentEvents(365)` bor edi, lekin hech kim chaqirmasdi —
 * jadval cheksiz o'sardi. Endi `housekeeping()` uni ALOHIDA qadam sifatida
 * ko'pi bilan 6 soatda bir marta yurgizadi (saqlash skaneri naqshi).
 *
 * `pool().query`/`connect` stublanadi (bazasiz), SQL matni yig'iladi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const worker = await import("../lib/server/worker.ts");

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const PURGE = /DELETE FROM payment_events WHERE id IN \( ?SELECT id FROM payment_events WHERE received_at < now\(\)/;

function mockDb(t: TestContext, fail: (sql: string) => boolean = () => false): Array<{ sql: string; params: unknown[] }> {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  const run = async (text: string, params: unknown[] = []) => {
    const sql = norm(text);
    seen.push({ sql, params });
    if (fail(sql)) throw new Error("sinov: kiritilgan xato");
    return { rows: [], rowCount: 0 };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

function quiet(t: TestContext) {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
}

test("housekeeping(): payment_events 365 kundan eskisi tozalanadi — 6 soatda bir marta", async (t) => {
  quiet(t);
  const seen = mockDb(t);
  worker.resetRetentionScan();
  await worker.housekeeping();
  const first = seen.filter((q) => PURGE.test(q.sql));
  // MUTATSIYA: `step("payment-events", …)` olib tashlansa — qizaradi.
  assert.equal(first.length, 1, "birinchi housekeeping payment_events ni tozalashi kerak");
  assert.equal(first[0].params[0], "365", "saqlash muddati 365 kun");

  seen.length = 0;
  await worker.housekeeping();
  // MUTATSIYA: 6 soatlik belgi tekshiruvi olib tashlansa — har daqiqada yuradi.
  assert.ok(!seen.some((q) => PURGE.test(q.sql)), "tozalash keyingi daqiqada yana yurdi");
  // Boshqa qadamlar har daqiqada davom etadi.
  assert.ok(seen.some((q) => /DELETE FROM sessions WHERE/.test(q.sql)));
});

test("housekeeping(): payment_events tozalash yiqilsa qolgan qadamlar ishlaydi (alohida qadam)", async (t) => {
  quiet(t);
  const seen = mockDb(t, (sql) => PURGE.test(sql));
  worker.resetRetentionScan();
  await worker.housekeeping();
  assert.ok(seen.some((q) => PURGE.test(q.sql)), "tozalash chaqirilmadi");
  for (const re of [/DELETE FROM sessions WHERE/, /DELETE FROM game_sessions/, /DELETE FROM source_uploads/, /DELETE FROM photo_uploads/]) {
    assert.ok(seen.some((q) => re.test(q.sql)), `keyingi qadam o'tkazib yuborildi: ${re}`);
  }
});
