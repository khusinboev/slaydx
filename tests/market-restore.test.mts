/* eslint-disable @typescript-eslint/no-explicit-any -- SQL rows and JSON answers are read untyped here */
import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { purchaseStateOf, type PurchaseFacts } from "../lib/market/purchase-state.ts";
import { buy, call, closeDb, db, drainJobs, fileOf, jobOf, ledger, marketRequest, mkItem, mkUser, resetSettings, restore, setSetting, skip, wallet } from "./helpers/market-buy.mts";

/**
 * The free restore and everything that must NOT be free (docs/market/PLAN.md §2.3, §9). The rule behind every test here:
 * one payment, one copy held; refunded money means no copy for free, on any path.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. refund looked up by `generation_id` instead of the purchase id  -> «refund, delete, restore»;
 *   2. `refund_pending` state removed (a failed paid job restorable)   -> «a failed paid job is not restorable»;
 *   3. `void` treated as holding the item                              -> «rebuy after a refunded failure»;
 *   4. (moved) the counting of a rebuy                                 -> tests/market-release.test.mts;
 *   5. reward paid while the copy failed                               -> «a failed copy pays no reward»;
 *   6. the refund-row condition removed from `deleteGeneration`        -> «the FAILED → delete window»;
 *   7. abuse flag ignored                                              -> «abuse flag»;
 *   8. in-transaction lock re-check removed                            -> «two restores at once»;
 *   9. in-transaction refund re-check removed                          -> «refund while restoring»;
 *  10. university compare removed                                      -> «a restore cannot change the university»;
 *  11. ownership dropped from the purchase lookup                      -> «a foreign purchase»;
 *  12. `market_item_id` not set on the restored row                    -> «deleted copy»;
 *  13. `ownedBy` keeps a void purchase                                 -> «rebuy after a refunded failure» (item page);
 *  14. `assertGenerationOpen` removed from the restore                 -> «an admin pause holds a restore too».
 */

after(closeDb);

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
const rows = async (sql: string, params: unknown[] = []) => (await db()).query<Record<string, any>>(sql, params);

const FIELDS = { author: "Sintetik Xaridor", university: "Sintetik Akademiya" };

/** A completed purchase; `id` is the purchase and the charged generation. */
async function bought(o: { balance?: number; maxCopies?: number; source?: string } = {}) {
  const u = await mkUser({ balance: o.balance ?? 100_000 });
  const item = await mkItem({ ...(o.maxCopies ? { maxCopies: o.maxCopies } : {}), ...(o.source ? { source: o.source } : {}) });
  const res = await buy(u, item, { fields: FIELDS });
  assert.equal(res.status, 200, res.text);
  const id = res.body.generationId as string;
  await drainJobs();
  assert.equal((await jobOf(id))!.status, "COMPLETED");
  return { u, item, id, price: res.body.price as number };
}

const deleteGen = async (u: { id: string }, id: string) => {
  const { deleteGeneration } = await import("../lib/server/jobs.ts");
  assert.equal(await deleteGeneration(id, u.id), true);
};
const adminRefund = async (u: { id: string }, id: string) => {
  const { refund } = await import("../lib/server/credits.ts");
  assert.equal(await refund(u.id, id, "Admin qaytardi"), true);
};
const failOriginal = async (item: string) => {
  const [row] = await rows("SELECT doc_json FROM market_items WHERE id = $1", [item]);
  await rows(`UPDATE market_items SET doc_json = '{}'::jsonb WHERE id = $1`, [item]);
  await drainJobs();
  await rows("UPDATE market_items SET doc_json = $2::jsonb WHERE id = $1", [item, JSON.stringify(row!.doc_json)]);
};

test("the state table", () => {
  const f = (o: Partial<PurchaseFacts>): PurchaseFacts => ({ id: "p", price: 3000, generationId: "p", generationStatus: "COMPLETED", purged: false, refunded: false, abuseFlag: null, ...o });
  assert.equal(purchaseStateOf(f({})), "ready");
  assert.equal(purchaseStateOf(f({ generationStatus: "QUEUED" })), "ready");
  assert.equal(purchaseStateOf(f({ generationId: null, generationStatus: null })), "restorable");
  assert.equal(purchaseStateOf(f({ purged: true })), "restorable");
  assert.equal(purchaseStateOf(f({ generationStatus: "FAILED" })), "refund_pending");
  assert.equal(purchaseStateOf(f({ generationStatus: "FAILED", price: 0 })), "restorable", "a free item has no refund to wait for");
  assert.equal(purchaseStateOf(f({ generationId: "r", generationStatus: "FAILED" })), "restorable", "a restored copy carries no charge");
  assert.equal(purchaseStateOf(f({ generationStatus: "FAILED", refunded: true })), "void");
  assert.equal(purchaseStateOf(f({ generationId: null, generationStatus: null, refunded: true })), "void");
  assert.equal(purchaseStateOf(f({ refunded: true })), "refunded", "the copy stays after an admin refund");
  assert.equal(purchaseStateOf(f({ generationId: null, generationStatus: null, abuseFlag: "x" })), "blocked");
  assert.equal(purchaseStateOf(f({ generationId: null, generationStatus: null, refunded: true, abuseFlag: "x" })), "blocked");
  assert.equal(purchaseStateOf(f({ abuseFlag: "x" })), "ready", "the flag does not take away a copy he has");
});

test("deleted copy: restore is free, a new generation of the same purchase with the same mark", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { readFingerprint } = await import("../lib/market/fingerprint.ts");
  const { u, item, id, price } = await bought({ balance: 50_000 });
  await deleteGen(u, id);
  assert.equal((await rows("SELECT generation_id FROM market_purchases WHERE id = $1", [id]))[0]!.generation_id, null);

  const res = await restore(u, id, FIELDS);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.restored, true);
  const gen = res.body.generationId as string;
  assert.notEqual(gen, id);
  const [p] = await rows("SELECT generation_id, restored_at, fingerprint FROM market_purchases WHERE id = $1", [id]);
  assert.equal(p!.generation_id, gen);
  assert.ok(p!.restored_at);
  const job = await jobOf(gen);
  assert.equal(job!.market_item_id, item);
  assert.equal(Number(job!.price), 0);

  assert.equal((await wallet(u.id)).balance, 50_000 - price, "no charge");
  assert.deepEqual((await ledger(u.id)).map((l) => l.kind), ["charge"]);
  await drainJobs();
  assert.equal((await jobOf(gen))!.status, "COMPLETED");
  assert.equal((await readFingerprint((await fileOf(gen))!)).keywords, p!.fingerprint);
  assert.equal(Number((await rows("SELECT sold_count FROM market_items WHERE id = $1", [item]))[0]!.sold_count), 1);
});

test("a copy he has: restore names it and creates nothing", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await bought();
  const res = await restore(u, id);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { generationId: id, restored: false });
  assert.equal(Number((await rows("SELECT count(*) AS n FROM generations WHERE user_id = $1", [u.id]))[0]!.n), 1);
});

test("two restores at once: one copy", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await bought();
  await deleteGen(u, id);
  // Both read «lost» first: one then waits for the purchase row, the other for the buyer's row.
  const { pool } = await db();
  const client = await pool().connect();
  let a, b;
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM market_purchases WHERE id = $1 FOR UPDATE", [id]);
    const pending = Promise.all([restore(u, id, FIELDS), restore(u, id, FIELDS)]);
    for (let i = 0; i < 200; i++) {
      const w = await client.query<{ n: string }>("SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()");
      if (Number(w.rows[0]!.n) >= 2) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await client.query("COMMIT");
    [a, b] = await pending;
  } finally {
    client.release();
  }
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  assert.equal(a.body.generationId, b.body.generationId);
  assert.equal(Number((await rows("SELECT count(*) AS n FROM generations WHERE user_id = $1", [u.id]))[0]!.n), 1);
});

test("refund, delete, restore: the ledger link survives the deleted row, no free copy", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await bought({ balance: 50_000 });
  await adminRefund(u, id);
  const before = await restore(u, id, FIELDS);
  assert.equal(before.status, 409, "the copy is still in Ishlarim; a refunded purchase restores nothing");
  assert.equal(before.body.code, "refunded");
  await deleteGen(u, id);
  const res = await restore(u, id, FIELDS);
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.code, "refunded");
  assert.equal((await wallet(u.id)).balance, 50_000);
  assert.equal(Number((await rows("SELECT count(*) AS n FROM generations WHERE user_id = $1", [u.id]))[0]!.n), 0);
});

test("a failed paid job is not restorable: refunded money and a free copy never meet", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser({ balance: 50_000 });
  const item = await mkItem();
  const res = await buy(u, item, { fields: FIELDS });
  const id = res.body.generationId as string;
  await failOriginal(item);
  assert.equal((await wallet(u.id)).balance, 50_000, "refunded by the worker");
  const r = await restore(u, id, FIELDS);
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.code, "refunded");
  await rows("DELETE FROM transactions WHERE kind = 'refund' AND reference = $1", [id]);
  const pending = await restore(u, id, FIELDS);
  assert.equal(pending.status, 409, "before the refund row lands it is not restorable either");
  assert.equal(pending.body.code, "refund_pending");
  const owned = await buy(u, item, { fields: FIELDS });
  assert.equal(owned.status, 409, "and not buyable twice");
  assert.equal(owned.body.code, "already_owned");
});

test("rebuy after a refunded failure: full price, one purchase, the copy not counted twice", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { getMarketItem } = await import("../lib/server/market/items.ts");
  const u = await mkUser({ balance: 50_000 });
  const item = await mkItem();
  const first = await buy(u, item, { fields: FIELDS });
  const id = first.body.generationId as string;
  assert.ok((await getMarketItem(item, u.id))!.owned);
  await failOriginal(item);
  assert.equal((await getMarketItem(item, u.id))!.owned, null, "the page sells it again");

  const again = await buy(u, item, { fields: FIELDS });
  assert.equal(again.status, 200, again.text);
  const gen = again.body.generationId as string;
  assert.notEqual(gen, id);
  assert.equal((await wallet(u.id)).balance, 50_000 - first.body.price);
  assert.deepEqual((await ledger(u.id)).map((l) => l.kind), ["charge", "refund", "charge"]);
  const purchases = await rows("SELECT id FROM market_purchases WHERE item_id = $1", [item]);
  assert.deepEqual(purchases.map((p) => p.id), [gen]);
  assert.equal(Number((await rows("SELECT sold_count FROM market_items WHERE id = $1", [item]))[0]!.sold_count), 1);
  await drainJobs();
  assert.equal((await jobOf(gen))!.status, "COMPLETED");
  assert.equal((await restore(u, gen)).body.restored, false);
});

test("a refunded failure gives the last copy back: the first buyer takes it, the failed one finds it sold out", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const item = await mkItem({ maxCopies: 1 });
  await buy(u, item, { fields: FIELDS });
  await failOriginal(item);
  const [before] = await rows("SELECT sold_count, status FROM market_items WHERE id = $1", [item]);
  assert.equal(Number(before!.sold_count), 0);
  assert.equal(before!.status, "active");
  const other = await buy(await mkUser(), item);
  assert.equal(other.status, 200, other.text);
  const late = await buy(u, item, { fields: FIELDS });
  assert.equal(late.status, 410);
  assert.equal(late.body.code, "sold_out");
  assert.equal(Number((await rows("SELECT sold_count FROM market_items WHERE id = $1", [item]))[0]!.sold_count), 1);
});

test("a failed copy pays no reward; the rebuy that completes pays one", { skip }, async (t) => {
  quiet(t);
  await resetSettings({ "market.enabled": true, "market.author_reward_percent": 10 });
  const author = await mkUser({ balance: 0 });
  const u = await mkUser();
  const item = await mkItem({ source: author.id });
  await buy(u, item, { fields: FIELDS });
  await failOriginal(item);
  assert.equal((await ledger(author.id)).length, 0);
  assert.equal((await buy(u, item, { fields: FIELDS })).status, 200);
  await drainJobs();
  assert.equal((await ledger(author.id)).length, 1);
});

test("the FAILED → delete window: a failed paid copy cannot be deleted before its refund row exists", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { deleteGeneration } = await import("../lib/server/jobs.ts");
  const u = await mkUser({ balance: 50_000 });
  const item = await mkItem();
  const id = (await buy(u, item, { fields: FIELDS })).body.generationId as string;
  await failOriginal(item);
  await rows("DELETE FROM transactions WHERE kind = 'refund' AND reference = $1", [id]);
  assert.equal(await deleteGeneration(id, u.id), false, "the refund has not landed: the row stays");
  assert.equal((await restore(u, id, FIELDS)).body.code, "refund_pending");
  const { refund } = await import("../lib/server/credits.ts");
  assert.equal(await refund(u.id, id, "qayta"), true);
  assert.equal(await deleteGeneration(id, u.id), true, "refund landed: it may go");
  assert.equal((await restore(u, id, FIELDS)).body.code, "refunded");
});

test("an ordinary failed work is deleted as before", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const jobs = await import("../lib/server/jobs.ts");
  const u = await mkUser();
  const res = await jobs.enqueueGeneration({ userId: u.id, toolId: "referat", topic: "Oddiy", price: 500, format: "docx", values: {}, budgetMs: 60_000 });
  assert.ok(res.ok);
  await rows("UPDATE generations SET status = 'FAILED' WHERE id = $1", [res.id]);
  assert.equal(await jobs.deleteGeneration(res.id, u.id), true);
});

test("an admin pause holds a restore too", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await bought();
  await deleteGen(u, id);
  await setSetting("generation.paused", true);
  const res = await restore(u, id, FIELDS);
  assert.equal(res.status, 503, res.text);
  assert.equal(res.body.code, "paused");
  assert.equal(Number((await rows("SELECT count(*) AS n FROM generations WHERE user_id = $1", [u.id]))[0]!.n), 0);
});

test("a cancelled queued copy is refunded in the same step and reads void", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { cancelGeneration } = await import("../lib/server/jobs.ts");
  const u = await mkUser({ balance: 50_000 });
  const item = await mkItem();
  const res = await buy(u, item, { fields: FIELDS });
  assert.equal(await cancelGeneration(res.body.generationId, u.id), true);
  assert.equal((await wallet(u.id)).balance, 50_000);
  assert.equal((await restore(u, res.body.generationId, FIELDS)).body.code, "refunded");
  assert.equal((await buy(u, item, { fields: FIELDS })).status, 200);
});

test("a failed restored copy is restored again, still free", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, item, id } = await bought({ balance: 50_000 });
  const balance = (await wallet(u.id)).balance;
  await deleteGen(u, id);
  const first = await restore(u, id, FIELDS);
  await failOriginal(item);
  assert.equal((await jobOf(first.body.generationId))!.status, "FAILED");
  assert.equal((await wallet(u.id)).balance, balance, "a restored copy has no charge, so nothing to refund");
  const second = await restore(u, id);
  assert.equal(second.status, 200, second.text);
  assert.equal(second.body.restored, true);
  assert.deepEqual((await jobOf(second.body.generationId))!.values_json.author, FIELDS.author, "the title page comes from the failed row");
  await drainJobs();
  assert.equal((await jobOf(second.body.generationId))!.status, "COMPLETED");
  assert.equal((await wallet(u.id)).balance, balance);
});

test("purged by retention: restorable", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await bought();
  await rows("UPDATE generations SET files_purged_at = now() WHERE id = $1", [id]);
  const res = await restore(u, id, FIELDS);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.restored, true);
});

test("abuse flag: no restore", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await bought();
  await deleteGen(u, id);
  await rows("UPDATE market_purchases SET abuse_flag = 'leak' WHERE id = $1", [id]);
  const res = await restore(u, id, FIELDS);
  assert.equal(res.status, 403, res.text);
  assert.equal(res.body.code, "restore_blocked");
});

test("refund while restoring: the transaction re-reads the ledger", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await bought();
  await deleteGen(u, id);
  const { pool } = await db();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM market_purchases WHERE id = $1 FOR UPDATE", [id]);
    const pending = restore(u, id, FIELDS);
    for (let i = 0; i < 200; i++) {
      const w = await client.query<{ n: string }>("SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()");
      if (Number(w.rows[0]!.n) > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await client.query(`INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note) VALUES ($1, 'refund', 0, 0, 1, $2, 'test')`, [u.id, id]);
    await client.query("COMMIT");
    const res = await pending;
    assert.equal(res.status, 409, res.text);
    assert.equal(Number((await rows("SELECT count(*) AS n FROM generations WHERE user_id = $1", [u.id]))[0]!.n), 0);
  } finally {
    client.release();
  }
});

test("a restore cannot change the university the cap counted", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await bought();
  await deleteGen(u, id);
  const res = await restore(u, id, { author: "Boshqa Ism", university: "Boshqa Akademiya" });
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.code, "university_changed");
});

test("the deleted row took the title page with it: the request must bring the required fields", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await bought();
  await deleteGen(u, id);
  const res = await restore(u, id);
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.code, "fields_required");
  assert.deepEqual(res.body.missing.sort(), ["author", "university"]);
});

test("a retired item is still restored for its buyer", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, item, id } = await bought();
  await deleteGen(u, id);
  await rows("UPDATE market_items SET status = 'retired' WHERE id = $1", [item]);
  const res = await restore(u, id, FIELDS);
  assert.equal(res.status, 200, res.text);
  await drainJobs();
  assert.equal((await jobOf(res.body.generationId))!.status, "COMPLETED");
});

test("a foreign purchase: 404, the same as an unknown id", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { id } = await bought();
  const thief = await mkUser();
  assert.equal((await restore(thief, id, FIELDS)).status, 404);
  assert.equal((await restore(thief, randomUUID(), FIELDS)).status, 404);
  assert.equal((await restore(thief, "not-a-uuid", FIELDS)).status, 404);
});

test("Xaridlarim: own purchases, the states the buttons follow, no document", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const route = await import("../app/api/market/purchases/route.ts");
  const { u, item, id, price } = await bought();
  const other = await bought();
  const list = async (cookie?: string) => call(route.GET as (r: Request, c: unknown) => Promise<Response>, marketRequest("/api/market/purchases", { cookie }));
  assert.equal((await list()).status, 401);
  const res = await list(u.cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.purchases.length, 1, "another buyer's purchase is not listed");
  const row = res.body.purchases[0];
  assert.equal(row.id, id);
  assert.equal(row.itemId, item);
  assert.equal(row.price, price);
  assert.equal(row.state, "ready");
  assert.equal(row.canRestore, false);
  assert.equal(row.generationId, id);
  assert.ok(row.cover.startsWith(`/api/market/items/${item}/preview/1`));
  assert.ok(!res.text.includes(other.id));
  assert.ok(!/"(doc|doc_json|sections|slides)"/.test(res.text));
  await deleteGen(u, id);
  const after2 = (await list(u.cookie)).body.purchases[0];
  assert.equal(after2.state, "restorable");
  assert.equal(after2.canRestore, true);
  assert.equal(after2.generationId, null);
});
