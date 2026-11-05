/* eslint-disable @typescript-eslint/no-explicit-any -- SQL rows and JSON answers are read untyped here */
import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { buy, call, closeDb, ctxOf, db, drainJobs, jobOf, ledger, marketRequest, mkItem, mkUser, resetSettings, skip, type TestUser, wallet } from "./helpers/market-buy.mts";

/**
 * A refund gives the copy back (docs/market/PLAN.md §2.3): review finding M1. The two probes that proved the hole run
 * through the real `DELETE /api/generations/{id}`: an attacker selling an item out, two accounts closing a university.
 * Every refund path releases through the same function, once.
 *
 * Mutations (each turned the named test red, then restored from a byte copy):
 *   1. release call removed from `refundInTx`                       -> «probe 1», «queue TTL»;
 *   2. release call removed from `refundRatio`                      -> «worker FAILED releases», «admin refund releases»;
 *   3. the `ratio >= 1` gate removed, each function                 -> «a partial refund releases nothing»;
 *   4. `NOT EXISTS refund` removed from the university count        -> «probe 2»;
 *   5. `status` CASE turns any status active                        -> «retired stays retired»;
 *   6. `sold_count - 1 < max_copies` removed from the CASE          -> «a cap lowered under the sold count stays sold out»;
 *   7. a second release before the refund check                     -> «no double release»;
 *   8. rating not removed                                           -> «the rating leaves with the sale»;
 *   9. rebuy does not count (`sold_count + 0`)                      -> «the void buyer buys again: one new sale»;
 *  10. the purchase lookup ignores the id (`LIMIT 1`)               -> «an ordinary refund touches no item».
 */

after(closeDb);

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
const rows = async (sql: string, params: unknown[] = []) => (await db()).query<Record<string, any>>(sql, params);
const itemOf = async (id: string) => {
  const [r] = await rows("SELECT sold_count, status, rating_sum, rating_count FROM market_items WHERE id = $1", [id]);
  return { sold: Number(r!.sold_count), status: r!.status as string, sum: Number(r!.rating_sum), count: Number(r!.rating_count) };
};

/** The real route the app calls: a queued copy is cancelled and refunded, then deleted. */
async function cancel(user: TestUser, id: string) {
  const route = await import("../app/api/generations/[id]/route.ts");
  const res = await call(route.DELETE as (r: Request, c: unknown) => Promise<Response>, marketRequest(`/api/generations/${id}`, { method: "DELETE", cookie: user.cookie }), ctxOf({ id }));
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.refunded, true);
}

const FIELDS = { author: "Sintetik Xaridor", university: "Sintetik Akademiya" };

test("probe 1: cancel gives the copy back, an attacker cannot sell an item out for free", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const item = await mkItem({ maxCopies: 1 });
  const attacker = await mkUser({ balance: 50_000 });
  const first = await buy(attacker, item, { fields: FIELDS });
  assert.deepEqual(await itemOf(item), { sold: 1, status: "sold_out", sum: 0, count: 0 });
  await cancel(attacker, first.body.generationId);
  assert.equal((await wallet(attacker.id)).balance, 50_000);
  assert.deepEqual(await itemOf(item), { sold: 0, status: "active", sum: 0, count: 0 });
  const victim = await mkUser();
  const res = await buy(victim, item, { fields: FIELDS });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(await itemOf(item), { sold: 1, status: "sold_out", sum: 0, count: 0 });
});

test("probe 2: two accounts cannot close a university by buying and cancelling", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const item = await mkItem();
  for (let i = 0; i < 2; i++) {
    const u = await mkUser();
    const res = await buy(u, item, { fields: { author: "Soxta", university: "Toshkent Davlat Universiteti" } });
    await cancel(u, res.body.generationId);
  }
  const student = await mkUser();
  const res = await buy(student, item, { fields: { author: "Haqiqiy Talaba", university: "toshkent universiteti" } });
  assert.equal(res.status, 200, res.text);
});

test("no double release: cancel and refunds racing behind the item lock release once", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { cancelGeneration } = await import("../lib/server/jobs.ts");
  const { refund } = await import("../lib/server/credits.ts");
  const item = await mkItem();
  await buy(await mkUser(), item, { fields: FIELDS });
  const u = await mkUser({ balance: 50_000 });
  const id = (await buy(u, item, { fields: { ...FIELDS, university: "Boshqa Akademiya" } })).body.generationId as string;
  assert.equal((await itemOf(item)).sold, 2);

  const { pool } = await db();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM market_items WHERE id = $1 FOR UPDATE", [item]);
    // The loser of `refundInTx` meets the unique ledger index and rolls back: settled, not awaited as a success.
    const pending = Promise.allSettled([cancelGeneration(id, u.id), refund(u.id, id, "a"), refund(u.id, id, "b")]);
    for (let i = 0; i < 200; i++) {
      const w = await client.query<{ n: string }>("SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()");
      if (Number(w.rows[0]!.n) >= 1) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await client.query("COMMIT");
    await pending;
  } finally {
    client.release();
  }
  assert.equal((await ledger(u.id)).filter((l) => l.kind === "refund").length, 1);
  assert.equal((await wallet(u.id)).balance, 50_000);
  assert.equal((await itemOf(item)).sold, 1, "exactly one copy came back");
  const { refund: again } = await import("../lib/server/credits.ts");
  assert.equal(await again(u.id, id, "c"), false);
  assert.equal((await itemOf(item)).sold, 1);
});

test("last copy after a cancel: a stranger and the refunded buyer race, one new sale", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const item = await mkItem({ maxCopies: 1 });
  const first = await mkUser();
  const id = (await buy(first, item, { fields: FIELDS })).body.generationId as string;
  await (await import("../lib/server/jobs.ts")).cancelGeneration(id, first.id);
  const stranger = await mkUser();
  const [a, b] = await Promise.all([buy(first, item, { fields: FIELDS }), buy(stranger, item, { fields: FIELDS })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 410], `${a.text}\n${b.text}`);
  const after_ = await itemOf(item);
  assert.equal(after_.sold, 1);
  assert.equal(after_.status, "sold_out");
  assert.equal(Number((await rows("SELECT count(*) AS n FROM market_purchases WHERE item_id = $1", [item]))[0]!.n), a.status === 200 ? 1 : 2, "the loser's void row stays only if he was the first buyer");
});

test("the void buyer buys again: one new sale, counted once", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const item = await mkItem();
  const u = await mkUser({ balance: 50_000 });
  const first = await buy(u, item, { fields: FIELDS });
  await (await import("../lib/server/jobs.ts")).cancelGeneration(first.body.generationId, u.id);
  assert.equal((await itemOf(item)).sold, 0);
  const again = await buy(u, item, { fields: FIELDS });
  assert.equal(again.status, 200, again.text);
  assert.equal((await itemOf(item)).sold, 1);
  assert.equal((await rows("SELECT id FROM market_purchases WHERE item_id = $1", [item])).length, 1);
});

test("worker FAILED releases", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const item = await mkItem({ maxCopies: 1 });
  await buy(await mkUser(), item, { fields: FIELDS });
  await rows(`UPDATE market_items SET doc_json = '{}'::jsonb WHERE id = $1`, [item]);
  await drainJobs();
  assert.deepEqual(await itemOf(item), { sold: 0, status: "active", sum: 0, count: 0 });
});

test("queue TTL releases through the same function", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { refundInTx } = await import("../lib/server/refund-tx.ts");
  const { transaction } = await db();
  const item = await mkItem();
  const u = await mkUser();
  const id = (await buy(u, item, { fields: FIELDS })).body.generationId as string;
  assert.equal(await transaction((c) => refundInTx(c, u.id, id, "TTL")), true);
  assert.equal((await itemOf(item)).sold, 0);
});

test("admin refund releases: the sale is reversed although the file stays with the buyer", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { refund } = await import("../lib/server/credits.ts");
  const item = await mkItem({ maxCopies: 1 });
  const u = await mkUser();
  const id = (await buy(u, item, { fields: FIELDS })).body.generationId as string;
  await drainJobs();
  assert.equal((await jobOf(id))!.status, "COMPLETED");
  assert.equal(await refund(u.id, id, "Admin"), true);
  assert.deepEqual(await itemOf(item), { sold: 0, status: "active", sum: 0, count: 0 });
  assert.equal((await jobOf(id))!.status, "COMPLETED");
  const again = await buy(u, item, { fields: FIELDS });
  assert.equal(again.status, 409, "he still has the copy: no second purchase while it exists");
  assert.equal(again.body.code, "already_owned");
});

test("a partial refund releases nothing", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { refundPartial } = await import("../lib/server/credits.ts");
  const item = await mkItem();
  const u = await mkUser();
  const id = (await buy(u, item, { fields: FIELDS })).body.generationId as string;
  assert.equal(await refundPartial(u.id, id, 0.5, "qisman"), true);
  assert.equal((await itemOf(item)).sold, 1);
  const { refundInTx } = await import("../lib/server/refund-tx.ts");
  const { transaction } = await db();
  const v = await mkUser();
  const other = (await buy(v, item, { fields: { ...FIELDS, university: "Boshqa Akademiya" } })).body.generationId as string;
  assert.equal(await transaction((c) => refundInTx(c, v.id, other, "qisman", 0.5)), true);
  assert.equal((await itemOf(item)).sold, 2, "the same rule in the transaction variant");
});

test("retired stays retired", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { refund } = await import("../lib/server/credits.ts");
  const item = await mkItem();
  const u = await mkUser();
  const id = (await buy(u, item, { fields: FIELDS })).body.generationId as string;
  await rows("UPDATE market_items SET status = 'retired' WHERE id = $1", [item]);
  await refund(u.id, id, "Admin");
  const row = await itemOf(item);
  assert.equal(row.status, "retired");
  assert.equal(row.sold, 0);
});

test("a cap lowered under the sold count stays sold out", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { refund } = await import("../lib/server/credits.ts");
  const item = await mkItem();
  const u = await mkUser();
  const id = (await buy(u, item, { fields: FIELDS })).body.generationId as string;
  await rows("UPDATE market_items SET sold_count = 3, max_copies = 1, status = 'sold_out' WHERE id = $1", [item]);
  await refund(u.id, id, "Admin");
  const row = await itemOf(item);
  assert.equal(row.sold, 2);
  assert.equal(row.status, "sold_out");
});

test("the rating leaves with the sale: no stale counters when the row is replaced later", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { refund } = await import("../lib/server/credits.ts");
  const item = await mkItem();
  const u = await mkUser();
  const id = (await buy(u, item, { fields: FIELDS })).body.generationId as string;
  await rows("INSERT INTO market_ratings (purchase_id, stars) VALUES ($1, 4)", [id]);
  await rows("UPDATE market_items SET rating_sum = 9, rating_count = 2 WHERE id = $1", [item]);
  await refund(u.id, id, "Admin");
  const row = await itemOf(item);
  assert.deepEqual([row.sum, row.count], [5, 1]);
  assert.equal((await rows("SELECT 1 FROM market_ratings WHERE purchase_id = $1", [id])).length, 0);
});

test("an ordinary refund touches no item; a reference that is no purchase is ignored", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { releaseMarketCopyInTx } = await import("../lib/server/market/release.ts");
  const jobs = await import("../lib/server/jobs.ts");
  const { refund } = await import("../lib/server/credits.ts");
  const { transaction } = await db();
  const item = await mkItem();
  await buy(await mkUser(), item, { fields: FIELDS });
  const u = await mkUser();
  const res = await jobs.enqueueGeneration({ userId: u.id, toolId: "referat", topic: "Oddiy", price: 500, format: "docx", values: {}, budgetMs: 60_000 });
  assert.ok(res.ok);
  assert.equal(await refund(u.id, res.id, "oddiy"), true);
  assert.equal((await itemOf(item)).sold, 1);
  assert.equal(await transaction((c) => releaseMarketCopyInTx(c, "not-a-uuid")), false);
});
