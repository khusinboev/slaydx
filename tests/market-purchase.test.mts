/* eslint-disable @typescript-eslint/no-explicit-any -- SQL rows and JSON answers are read untyped here */
import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buy, closeDb, db, drainJobs, jobOf, ledger, mkItem, mkUser, marketRequest, call, ctxOf, priceOf, resetSettings, setSetting, skip, wallet } from "./helpers/market-buy.mts";

/**
 * The market purchase through the real route on a real, isolated Postgres (docs/market/PLAN.md §2.1, §9, §10.3).
 * Races are real too: a test holds the item's row lock in its own transaction, the purchase blocks on it, the test
 * changes the row and commits, and the purchase must see the committed truth INSIDE the charge transaction.
 *
 * Mutations (each turned the named test red, then restored from a byte copy):
 *   1. `max_copies` condition dropped from the UPDATE               -> «a cap lowered under the sold count»;
 *   2. `inTx` called before the INSERT / outside the transaction    -> «a refusal in the transaction leaves nothing»;
 *   3. in-transaction price compare removed                         -> «price changed while waiting for the lock»;
 *   4. `price_version` compare removed                              -> «price_version alone»;
 *   5. university cap query removed                                 -> «university cap»;
 *   6. empty university counted by the cap                          -> «no university, no cap»;
 *   7. `already_owned` mapping of the UNIQUE violation removed      -> «two tabs past the pre-check»;
 *   9. replay check moved behind the status check                   -> «a replay after the last copy»;
 *  10. `assertCanCreate` removed                                    -> «mandatory channels»;
 *  11. `assertOfferAccepted` removed                                -> «oferta»;
 *  12. `assertGenerationOpen` removed                               -> «admin pause»;
 *  13. `paidOnly` not passed                                        -> «market.paid_only»;
 *  14. reward skips the `≠ buyer` check                             -> «author reward»;
 *  14b. reward paid again in the charge transaction                  -> «author reward» (the charge pays nothing);
 *  15. `sold_out` flip removed                                      -> «sold out at the cap»;
 *  16. in-transaction `market.tools_disabled` check removed         -> «tool withdrawn while waiting»;
 *  17. hidden check removed from the UPDATE                         -> «hidden while waiting»;
 *  18. purchase id ≠ generation id (default UUID)                   -> «happy path»;
 *  19. the `marketItemId` refusal of `prepareGeneration` removed     -> «a form cannot name an item».
 */

after(closeDb);

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

const rows = async (sql: string, params: unknown[] = []) => (await db()).query<Record<string, any>>(sql, params);
const count = async (sql: string, params: unknown[] = []) => Number((await rows(sql, params))[0]!.n);
const soldCount = async (id: string) => Number((await rows("SELECT sold_count FROM market_items WHERE id = $1", [id]))[0]!.sold_count);
const statusOf = async (id: string) => (await rows("SELECT status FROM market_items WHERE id = $1", [id]))[0]!.status as string;

/** Holds the item's row lock, lets `start` block on it (`waiters` backends), applies `sql`, commits. */
async function whileLocked<T>(itemId: string, start: () => Promise<T>, sql: string, waiters = 1): Promise<T> {
  const { pool } = await db();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM market_items WHERE id = $1 FOR UPDATE", [itemId]);
    const pending = start();
    for (let i = 0; i < 200; i++) {
      const w = await client.query<{ n: string }>("SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()");
      if (Number(w.rows[0]!.n) >= waiters) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await client.query(sql, sql.includes("$1") ? [itemId] : []);
    await client.query("COMMIT");
    return await pending;
  } finally {
    client.release();
  }
}

test("happy path: charge, purchase row, counter and the copy's generation commit together", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser({ balance: 50_000 });
  const item = await mkItem({ tool: "referat", params: { pages: "15-20" } });
  const price = await priceOf(item);
  const res = await buy(u, item, { fields: { author: "Sintetik Xaridor", university: "Sintetik Davlat Universiteti", notAField: "x" } });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { generationId: res.body.generationId, price, replayed: false });
  const gen = res.body.generationId as string;

  assert.equal((await wallet(u.id)).balance, 50_000 - price);
  const led = await ledger(u.id);
  assert.equal(led.length, 1);
  assert.equal(led[0]!.kind, "charge");
  assert.equal(led[0]!.reference, gen);
  assert.equal(Number(led[0]!.balance_delta), -price);

  const [p] = await rows("SELECT * FROM market_purchases WHERE item_id = $1", [item]);
  assert.equal(p!.id, gen, "the purchase id is the charged generation's id: the ledger link for ever");
  assert.equal(p!.generation_id, gen);
  assert.equal(String(p!.buyer_user_id), u.id);
  assert.equal(Number(p!.price), price);
  assert.equal(p!.university_norm, "sintetik");
  assert.match(p!.fingerprint, /^SLX-[A-Z2-7]{10}$/);
  assert.ok(Number(p!.original_price) >= price);

  assert.equal(await soldCount(item), 1);
  const job = await jobOf(gen);
  assert.equal(job!.status, "QUEUED");
  assert.equal(job!.market_item_id, item);
  assert.equal(Number(job!.price), price);
  assert.deepEqual(Object.keys(job!.values_json).sort(), ["author", "language", "marketItemId", "university"], "only the allowed keys reach values_json");
});

test("double click: the same key is one purchase, whatever happened since", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const item = await mkItem();
  const key = randomUUID();
  const fields = { author: "Sintetik Xaridor", university: "Sintetik Universitet" };
  const first = await buy(u, item, { key, fields });
  const second = await buy(u, item, { key, fields });
  assert.equal(second.status, 200, second.text);
  assert.equal(second.body.generationId, first.body.generationId);
  assert.equal(second.body.replayed, true);
  assert.equal(second.body.price, first.body.price);
  assert.equal(second.headers.get("idempotent-replayed"), "true");
  assert.equal((await ledger(u.id)).length, 1, "no second charge");
  assert.equal(await soldCount(item), 1);
});

test("a replay after the last copy: answered as the purchase, not as sold out", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const item = await mkItem({ maxCopies: 1 });
  const key = randomUUID();
  const fields = { author: "Sintetik Xaridor", university: "Sintetik Universitet" };
  const first = await buy(u, item, { key, fields });
  assert.equal(await statusOf(item), "sold_out");
  await query1("UPDATE market_items SET price_override = 9000, price_version = price_version + 1 WHERE id = $1", item);
  const again = await buy(u, item, { key, fields, expectedPrice: first.body.price });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.generationId, first.body.generationId);
});

async function query1(sql: string, id: string) {
  await rows(sql, [id]);
}

test("the same key on another body is a conflict, not a silent replay", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const item = await mkItem();
  const key = randomUUID();
  await buy(u, item, { key, fields: { author: "Sintetik Xaridor", university: "Bir" } });
  const res = await buy(u, item, { key, fields: { author: "Boshqa Ism", university: "Bir" } });
  assert.equal(res.status, 422);
  assert.equal((await ledger(u.id)).length, 1);
});

test("second click with a new key: 409 already_owned, the existing copy named, no charge", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const item = await mkItem();
  const first = await buy(u, item);
  const res = await buy(u, item);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "already_owned");
  assert.equal(res.body.generationId, first.body.generationId);
  assert.equal(res.body.purchaseId, first.body.generationId);
  assert.equal((await ledger(u.id)).length, 1);
  assert.equal(await soldCount(item), 1);
});

test("two tabs: two keys at once are one purchase", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser({ balance: 100_000 });
  const item = await mkItem();
  const fields = { author: "Sintetik Xaridor", university: "Sintetik Universitet" };
  const answers = await Promise.all([buy(u, item, { fields }), buy(u, item, { fields }), buy(u, item, { fields })]);
  const ok = answers.filter((a) => a.status === 200);
  const owned = answers.filter((a) => a.status === 409 && a.body.code === "already_owned");
  assert.equal(ok.length, 1, answers.map((a) => a.text).join("\n"));
  assert.equal(owned.length, 2);
  assert.equal((await ledger(u.id)).length, 1);
  assert.equal(await soldCount(item), 1);
  assert.equal(await count("SELECT count(*) AS n FROM generations WHERE user_id = $1", [u.id]), 1);
});

test("two tabs past the pre-check: the UNIQUE index answers already_owned and the second charge rolls back", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser({ balance: 50_000 });
  const item = await mkItem();
  const fields = { author: "Sintetik Xaridor", university: "Sintetik Universitet" };
  // Both requests read «not owned» first: one then waits for the item row, the other for the buyer's row.
  const answers = await whileLocked(item, () => Promise.all([buy(u, item, { fields }), buy(u, item, { fields })]), "SELECT 1", 2);
  assert.deepEqual(answers.map((a) => a.status).sort(), [200, 409], answers.map((a) => a.text).join("\n"));
  const lost = answers.find((a) => a.status === 409)!;
  assert.equal(lost.body.code, "already_owned");
  assert.equal(lost.body.generationId, answers.find((a) => a.status === 200)!.body.generationId);
  assert.equal((await ledger(u.id)).length, 1);
  assert.equal(await soldCount(item), 1);
});

test("a cap lowered under the sold count: an active item refuses and reads sold out", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const item = await mkItem({ maxCopies: 5 });
  await rows("UPDATE market_items SET sold_count = 2, max_copies = 2 WHERE id = $1", [item]);
  const u = await mkUser();
  const res = await buy(u, item);
  assert.equal(res.status, 410, res.text);
  assert.equal(res.body.code, "sold_out");
  assert.equal((await ledger(u.id)).length, 0);
  assert.equal(await soldCount(item), 2);
});

test("last copy race: two buyers, one copy, the loser pays nothing", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const a = await mkUser();
  const b = await mkUser();
  const item = await mkItem({ maxCopies: 1 });
  const [x, y] = await Promise.all([buy(a, item), buy(b, item)]);
  const answers = [x, y];
  const win = answers.find((r) => r.status === 200);
  const lose = answers.find((r) => r.status !== 200);
  assert.ok(win, answers.map((r) => r.text).join("\n"));
  assert.equal(lose!.status, 410);
  assert.equal(lose!.body.code, "sold_out");
  assert.equal(await soldCount(item), 1);
  assert.equal(await count("SELECT count(*) AS n FROM market_purchases WHERE item_id = $1", [item]), 1);
  const loser = x.status === 200 ? b : a;
  assert.equal((await ledger(loser.id)).length, 0, "the charge rolled back");
  assert.equal(await count("SELECT count(*) AS n FROM generations WHERE user_id = $1", [loser.id]), 0, "the row rolled back");
});

test("sold out at the cap: the status flips at the last copy; the catalog no longer sells it", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const item = await mkItem({ maxCopies: 2 });
  await buy(await mkUser(), item);
  assert.equal(await statusOf(item), "active");
  await buy(await mkUser(), item);
  assert.equal(await statusOf(item), "sold_out");
  const late = await mkUser();
  const res = await buy(late, item);
  assert.equal(res.status, 410);
  assert.equal(res.body.code, "sold_out");
  assert.equal((await ledger(late.id)).length, 0);
});

test("a refusal in the transaction leaves nothing: price changed while waiting for the lock", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser({ balance: 50_000 });
  const item = await mkItem();
  const price = await priceOf(item);
  const res = await whileLocked(item, () => buy(u, item), "UPDATE market_items SET price_override = 1234000 WHERE id = $1");
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.code, "price_changed");
  assert.notEqual(res.body.price, price);
  assert.equal((await wallet(u.id)).balance, 50_000, "the charge rolled back");
  assert.equal((await ledger(u.id)).length, 0);
  assert.equal(await count("SELECT count(*) AS n FROM generations WHERE user_id = $1", [u.id]), 0);
  assert.equal(await soldCount(item), 0, "the counter rolled back");
  assert.equal(await count("SELECT count(*) AS n FROM market_purchases WHERE item_id = $1", [item]), 0);
});

test("price_version alone refuses: same number, another listing version", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const item = await mkItem();
  const res = await whileLocked(item, () => buy(u, item), "UPDATE market_items SET price_version = price_version + 1 WHERE id = $1");
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.code, "price_changed");
  assert.equal((await ledger(u.id)).length, 0);
});

test("retired, hidden or withdrawn while waiting for the lock: 410, no charge", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const a = await mkUser();
  const retired = await mkItem();
  const r1 = await whileLocked(retired, () => buy(a, retired), "UPDATE market_items SET status = 'retired' WHERE id = $1");
  assert.equal(r1.status, 410, r1.text);
  assert.equal(r1.body.code, "gone");
  assert.equal((await ledger(a.id)).length, 0);

  const hidden = await mkItem();
  const r2 = await whileLocked(hidden, () => buy(a, hidden), `UPDATE market_items SET quality_json = '{"hidden_until_review": true}' WHERE id = $1`);
  assert.equal(r2.status, 410, `hidden while waiting: ${r2.text}`);
  assert.equal((await ledger(a.id)).length, 0);

  const withdrawn = await mkItem();
  const r3 = await whileLocked(withdrawn, () => buy(a, withdrawn), `INSERT INTO app_settings (key, value) VALUES ('market.tools_disabled', '["referat"]'::jsonb)`);
  assert.equal(r3.status, 410, `tool withdrawn while waiting: ${r3.text}`);
  assert.equal((await ledger(a.id)).length, 0);
});

test("stale price: 409 price_changed carries the new price; the retry with it buys", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const item = await mkItem();
  const price = await priceOf(item);
  const stale = await buy(u, item, { expectedPrice: price + 500 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "price_changed");
  assert.equal(stale.body.price, price);
  assert.equal((await ledger(u.id)).length, 0);
  const ok = await buy(u, item, { expectedPrice: stale.body.price });
  assert.equal(ok.status, 200);
});

test("balance short: 402 with required and available; nothing written; a top-up then buys", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser({ balance: 100 });
  const item = await mkItem();
  const price = await priceOf(item);
  const res = await buy(u, item);
  assert.equal(res.status, 402, res.text);
  assert.equal(res.body.required, price);
  assert.equal(res.body.available, 100);
  assert.equal(await soldCount(item), 0);
  assert.equal(await count("SELECT count(*) AS n FROM market_purchases WHERE item_id = $1", [item]), 0);
  await rows("UPDATE users SET balance = 100000 WHERE id = $1", [u.id]);
  assert.equal((await buy(u, item)).status, 200);
});

test("bonus so'm pays by default; market.paid_only hides it", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser({ balance: 0, points: 50_000 });
  const item = await mkItem();
  const price = await priceOf(item);
  assert.equal((await buy(u, item)).status, 200);
  assert.equal((await wallet(u.id)).points, 50_000 - price);

  await setSetting("market.paid_only", true);
  const v = await mkUser({ balance: 0, points: 50_000 });
  const other = await mkItem();
  const res = await buy(v, other);
  assert.equal(res.status, 402, res.text);
  assert.equal(res.body.code, "paid_balance_required");
  assert.equal(res.body.bonus, 50_000);
  assert.ok(!/video/i.test(res.body.error), `not the video wording: ${res.body.error}`);
  assert.equal((await wallet(v.id)).points, 50_000);
});

test("university cap: spelled any way, per item; other universities pass; 0 switches it off", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const item = await mkItem({ title: "Issiqlik dvigatellari" });
  const twin = await mkItem({ title: "Issiqlik dvigatellari tarixi" });
  await buy(await mkUser(), item, { fields: { author: "A", university: "Toshkent Davlat Universiteti" } });
  await buy(await mkUser(), item, { fields: { author: "B", university: "toshkent universiteti" } });
  const third = await mkUser();
  const res = await buy(third, item, { fields: { author: "C", university: "ТОШКЕНТ ДАВЛАТ УНИВЕРСИТЕТИ" } });
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.code, "university_cap");
  assert.deepEqual(res.body.suggestions.map((c: { id: string }) => c.id), [twin], "same-topic alternatives, not the item itself");
  assert.equal((await ledger(third.id)).length, 0);
  assert.equal(await soldCount(item), 2, "the refused copy is not counted");
  assert.equal((await buy(await mkUser(), item, { fields: { author: "D", university: "Samarqand Davlat Universiteti" } })).status, 200);
  await setSetting("market.same_university_cap", 0);
  assert.equal((await buy(await mkUser(), item, { fields: { author: "E", university: "Toshkent Davlat Universiteti" } })).status, 200);
});

test("no university, no cap: a deck bought without one is not limited to two buyers", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const doc = { meta: { toolId: "slide", topic: "x", language: "uz" }, slides: [{ id: "a", layout: "title", title: "x" }] };
  const item = await mkItem({ tool: "slide", doc, params: { slideCount: 8 } });
  for (let i = 0; i < 3; i++) {
    const res = await buy(await mkUser(), item, { fields: {} });
    assert.equal(res.status, 200, res.text);
  }
});

test("required title-page fields: the tool's own set, whitespace is not a value", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const item = await mkItem({ tool: "referat" });
  const res = await buy(u, item, { fields: { author: "   ", university: "Bir" } });
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.code, "fields_required");
  assert.deepEqual(res.body.missing, ["author"]);
  assert.equal((await ledger(u.id)).length, 0);
});

test("not for sale: 410 retired, sold out, hidden, withdrawn; 404 for what was never public", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const code = async (id: string) => {
    const r = await buy(u, id, { expectedPrice: 1000 });
    return [r.status, r.body.code];
  };
  assert.deepEqual(await code(await mkItem({ status: "retired" })), [410, "gone"]);
  assert.deepEqual(await code(await mkItem({ status: "sold_out" })), [410, "sold_out"]);
  assert.deepEqual(await code(await mkItem({ hidden: true })), [410, "gone"]);
  assert.deepEqual(await code(await mkItem({ status: "candidate" })), [404, undefined]);
  assert.deepEqual(await code(await mkItem({ status: "rejected" })), [404, undefined]);
  assert.deepEqual(await code(randomUUID()), [404, undefined]);
  assert.deepEqual(await code("not-a-uuid"), [404, undefined]);
  const offSale = await mkItem();
  await setSetting("market.tools_disabled", ["referat"]);
  assert.deepEqual(await code(offSale), [410, "gone"]);
  assert.equal((await ledger(u.id)).length, 0);
});

test("market.enabled off: 503 for a user, an admin account walks the dark market", { skip }, async (t) => {
  quiet(t);
  await resetSettings({ "market.enabled": false });
  const item = await mkItem();
  const u = await mkUser();
  const res = await buy(u, item);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "market_disabled");
  const admin = await mkUser({ admin: true });
  assert.equal((await buy(admin, item)).status, 200);
});

test("admin pause: generation.paused and paused_tools answer 503 paused, nothing charged", { skip }, async (t) => {
  quiet(t);
  await resetSettings({ "market.enabled": true, "generation.paused": true });
  const u = await mkUser();
  const item = await mkItem();
  const a = await buy(u, item);
  assert.equal(a.status, 503);
  assert.equal(a.body.code, "paused");
  await resetSettings({ "market.enabled": true, "generation.paused_tools": ["referat"] });
  const b = await buy(u, item);
  assert.equal(b.status, 503);
  assert.equal(b.body.code, "paused");
  assert.equal((await ledger(u.id)).length, 0);
});

test("oferta gate: 403 offer_required before anything is charged", { skip }, async (t) => {
  quiet(t);
  await resetSettings({ "market.enabled": true, "oferta.gate_enabled": true, "oferta.requisites": "Sintetik rekvizit" });
  const u = await mkUser();
  const res = await buy(u, await mkItem());
  assert.equal(res.status, 403, res.text);
  assert.equal(res.body.code, "offer_required");
  assert.equal((await ledger(u.id)).length, 0);
});

test("mandatory channels: 403 before anything is charged", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  await rows(`INSERT INTO bonus_channels (chat_id, title, username, active, mandatory) VALUES (-1001234, 'Sintetik kanal', 'sintetik', TRUE, TRUE)`);
  t.after(() => rows("DELETE FROM bonus_channels"));
  const u = await mkUser();
  const res = await buy(u, await mkItem());
  assert.equal(res.status, 403, res.text);
  assert.ok(res.body.code === "telegram_required" || res.body.code === "channel_required", res.text);
  assert.equal((await ledger(u.id)).length, 0);
});

test("author reward: off by default; paid once on COMPLETED; a cancel pays nothing; an own item pays none", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const author = await mkUser({ balance: 0 });
  const quietItem = await mkItem({ source: author.id });
  await buy(await mkUser(), quietItem);
  await drainJobs();
  assert.equal((await ledger(author.id)).length, 0, "reward 0: no ledger row");

  await setSetting("market.author_reward_percent", 10);
  const item = await mkItem({ source: author.id });
  const price = await priceOf(item);
  const res = await buy(await mkUser(), item);
  assert.equal((await ledger(author.id)).length, 0, "the charge pays nothing: no sale yet");
  await drainJobs();
  const led = await ledger(author.id);
  assert.equal(led.length, 1);
  assert.equal(led[0]!.kind, "bonus");
  assert.equal(led[0]!.reference, `market-author:${res.body.generationId}`);
  assert.equal(Number(led[0]!.points_delta), Math.floor(price / 10));
  assert.equal((await wallet(author.id)).points, Math.floor(price / 10));

  const farmed = await mkItem({ source: author.id });
  const farmer = await mkUser();
  const cancelled = await buy(farmer, farmed);
  await (await import("../lib/server/jobs.ts")).cancelGeneration(cancelled.body.generationId, farmer.id);
  await drainJobs();
  assert.equal((await ledger(author.id)).length, 1, "buy + cancel farms nothing");

  const own = await mkItem({ source: author.id });
  await rows("UPDATE users SET balance = 100000 WHERE id = $1", [author.id]);
  assert.equal((await buy(author, own)).status, 200);
  await drainJobs();
  assert.equal((await ledger(author.id)).filter((l) => l.kind === "bonus").length, 1, "own purchase pays no reward");
});

test("two buyers of each other's items: no second user's row in the charge transaction, both pass with the reward on", { skip }, async (t) => {
  quiet(t);
  await resetSettings({ "market.enabled": true, "market.author_reward_percent": 10 });
  const a = await mkUser();
  const b = await mkUser();
  const ofA = await mkItem({ source: a.id });
  const ofB = await mkItem({ source: b.id });
  const [x, y] = await Promise.all([buy(a, ofB), buy(b, ofA)]);
  assert.deepEqual([x.status, y.status], [200, 200], `${x.text}\n${y.text}`);
  await drainJobs();
  assert.equal((await ledger(a.id)).filter((l) => l.kind === "bonus").length, 1);
  assert.equal((await ledger(b.id)).filter((l) => l.kind === "bonus").length, 1);
});

test("the queue is full: 429 with Retry-After, nothing charged, nothing counted", { skip }, async (t) => {
  quiet(t);
  await resetSettings({ "market.enabled": true, "queue.user_max_inflight": 1 });
  const u = await mkUser();
  assert.equal((await buy(u, await mkItem())).status, 200);
  const item = await mkItem();
  const res = await buy(u, item);
  assert.equal(res.status, 429, res.text);
  assert.ok(res.headers.get("retry-after"));
  assert.equal((await ledger(u.id)).length, 1);
  assert.equal(await soldCount(item), 0);
});

test("the request: login, CSRF, key and price are required; a blocked user is out", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const route = await import("../app/api/market/items/[id]/purchase/route.ts");
  const item = await mkItem();
  const u = await mkUser();
  const price = await priceOf(item);
  const post = (o: Parameters<typeof marketRequest>[1]) => call(route.POST, marketRequest(`/api/market/items/${item}/purchase`, { method: "POST", ...o }), ctxOf({ id: item }));
  const body = { expectedPrice: price, fields: { author: "A", university: "B" } };
  assert.equal((await post({ key: randomUUID(), body })).status, 401);
  assert.equal((await post({ cookie: u.cookie, key: randomUUID(), body, origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ cookie: u.cookie, body })).status, 400, "no Idempotency-Key");
  assert.equal((await post({ cookie: u.cookie, key: "abc", body })).status, 400);
  assert.equal((await post({ cookie: u.cookie, key: randomUUID(), body: { fields: body.fields } })).status, 400, "no expectedPrice");
  assert.equal((await post({ cookie: u.cookie, key: randomUUID(), body: { ...body, expectedPrice: -1 } })).status, 400);
  const blocked = await mkUser({ blocked: true });
  assert.equal((await post({ cookie: blocked.cookie, key: randomUUID(), body })).status, 401);
  assert.equal((await ledger(u.id)).length, 0);
});

test("a form cannot name an item: POST /api/generations with marketItemId is refused", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const route = await import("../app/api/generations/route.ts");
  const u = await mkUser();
  const item = await mkItem();
  const req = marketRequest("/api/generations", { method: "POST", cookie: u.cookie, body: { slug: "referat", values: { topic: "Mavzu matni uchun", marketItemId: item, author: "A", university: "B" } } });
  const res = await call(route.POST as (r: Request, c: unknown) => Promise<Response>, req);
  assert.equal(res.status, 400, res.text);
  assert.equal(await count("SELECT count(*) AS n FROM generations WHERE user_id = $1", [u.id]), 0);
});
