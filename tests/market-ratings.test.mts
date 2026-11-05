/* eslint-disable @typescript-eslint/no-explicit-any -- SQL rows and JSON answers are read untyped here */
import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buy, call, closeDb, ctxOf, db, drainJobs, marketRequest, mkItem, mkUser, resetSettings, setSetting, skip } from "./helpers/market-buy.mts";

/**
 * Ratings, reports and the opt-out through their real routes (docs/market/PLAN.md §2.3, §9, M7).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. the 10-minute age check removed            -> «not before ten minutes»;
 *   2. edit window not enforced                   -> «a week to change it»;
 *   3. counters add the new stars on an edit      -> «an edit moves the sum, not the count»;
 *   4. refund state ignored                       -> «a refund or a flag closes it»;
 *   5. abuse flag ignored                         -> «a refund or a flag closes it»;
 *   6. ownership dropped                          -> «input: whole stars» (the foreign purchase);
 *   7. hide threshold off by one                  -> «the third report hides»;
 *   8. `ON CONFLICT DO NOTHING` replaced          -> «one report per user»;
 *   9. the candidates delete removed              -> «opting out removes the waiting candidates»;
 *  10. opt-out behind `market.enabled`            -> «the opt-out works while the market is dark»;
 *  11. the delete ignores the status              -> «opting out removes the waiting candidates» (active stays).
 */

after(closeDb);

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
const rows = async (sql: string, params: unknown[] = []) => (await db()).query<Record<string, any>>(sql, params);

async function completed() {
  const u = await mkUser();
  const item = await mkItem();
  const res = await buy(u, item);
  const id = res.body.generationId as string;
  await drainJobs();
  await rows("UPDATE generations SET finished_at = now() - interval '11 minutes' WHERE id = $1", [id]);
  return { u, item, id };
}

async function rate(user: { cookie: string }, id: string, body: unknown) {
  const route = await import("../app/api/market/purchases/[id]/rating/route.ts");
  return call(route.POST, marketRequest(`/api/market/purchases/${id}/rating`, { method: "POST", cookie: user.cookie, body }), ctxOf({ id }));
}

async function report(user: { cookie: string }, id: string, reason = "Xato ma'lumot") {
  const route = await import("../app/api/market/items/[id]/report/route.ts");
  return call(route.POST, marketRequest(`/api/market/items/${id}/report`, { method: "POST", cookie: user.cookie, body: { reason } }), ctxOf({ id }));
}

async function optOut(user: { cookie: string }, method: "GET" | "PUT", body?: unknown) {
  const route = await import("../app/api/market/opt-out/route.ts");
  const handler = (method === "GET" ? route.GET : route.PUT) as (r: Request, c: unknown) => Promise<Response>;
  return call(handler, marketRequest("/api/market/opt-out", { method, cookie: user.cookie, body }));
}

const counters = async (item: string) => {
  const [r] = await rows("SELECT rating_sum, rating_count FROM market_items WHERE id = $1", [item]);
  return [Number(r!.rating_sum), Number(r!.rating_count)];
};

test("a rating lands in the row and the counters in one step", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, item, id } = await completed();
  const res = await rate(u, id, { stars: 4, text: " Yaxshi ish " });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { stars: 4, text: "Yaxshi ish" });
  assert.deepEqual(await counters(item), [4, 1]);
  const [r] = await rows("SELECT stars, text FROM market_ratings WHERE purchase_id = $1", [id]);
  assert.equal(r!.stars, 4);
  assert.equal(r!.text, "Yaxshi ish");
});

test("an edit moves the sum, not the count", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, item, id } = await completed();
  await rate(u, id, { stars: 5 });
  assert.equal((await rate(u, id, { stars: 2 })).status, 200);
  assert.deepEqual(await counters(item), [2, 1]);
});

test("not before ten minutes, and only on a finished copy", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await completed();
  await rows("UPDATE generations SET finished_at = now() - interval '9 minutes' WHERE id = $1", [id]);
  const res = await rate(u, id, { stars: 5 });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "rating_not_open");
  const v = await mkUser();
  const queued = await buy(v, await mkItem());
  const q = await rate(v, queued.body.generationId, { stars: 5 });
  assert.equal(q.body.code, "rating_not_open");
});

test("a week to change it", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, item, id } = await completed();
  await rate(u, id, { stars: 5 });
  await rows("UPDATE market_ratings SET created_at = now() - interval '8 days' WHERE purchase_id = $1", [id]);
  const res = await rate(u, id, { stars: 1 });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "rating_closed");
  assert.deepEqual(await counters(item), [5, 1]);
});

test("a refund or a flag closes it", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { refund } = await import("../lib/server/credits.ts");
  const a = await completed();
  await refund(a.u.id, a.id, "Admin");
  assert.equal((await rate(a.u, a.id, { stars: 5 })).status, 409);
  const b = await completed();
  await rows("UPDATE market_purchases SET abuse_flag = 'leak' WHERE id = $1", [b.id]);
  assert.equal((await rate(b.u, b.id, { stars: 5 })).status, 409);
});

test("input: whole stars 1..5, text up to 300; a foreign purchase is a plain 404", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { u, id } = await completed();
  for (const stars of [0, 6, 2.5, "5", null]) assert.equal((await rate(u, id, { stars })).status, 400, String(stars));
  assert.equal((await rate(u, id, { stars: 3, text: "x".repeat(301) })).status, 400);
  assert.equal((await rate(u, id, { stars: 3, text: 7 })).status, 400);
  assert.equal((await rate(u, id, { stars: 3, text: "x".repeat(300) })).status, 200);
  const thief = await mkUser();
  assert.equal((await rate(thief, id, { stars: 1 })).status, 404);
  assert.equal((await rate(thief, randomUUID(), { stars: 1 })).status, 404);
});

test("one report per user; the third distinct report hides the item from everyone but its buyer", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { getMarketItem } = await import("../lib/server/market/items.ts");
  const { listMarketItems } = await import("../lib/server/market/search.ts");
  const item = await mkItem();
  const owner = await mkUser();
  await buy(owner, item);
  const [a, b, c] = [await mkUser(), await mkUser(), await mkUser()];
  assert.deepEqual((await report(a, item)).body, { reported: true });
  assert.deepEqual((await report(a, item)).body, { reported: false }, "a repeat is no error and no second vote");
  assert.equal((await report(b, item)).body.reported, true);
  assert.ok(await getMarketItem(item, null), "two distinct reports do not hide");
  assert.equal((await report(c, item)).body.reported, true);
  const [row] = await rows("SELECT status, quality_json FROM market_items WHERE id = $1", [item]);
  assert.equal(row!.status, "active", "the status does not change");
  assert.equal(row!.quality_json.hidden_until_review, true);
  assert.equal(await getMarketItem(item, null), null);
  assert.ok(await getMarketItem(item, owner.id), "the buyer keeps his page");
  assert.deepEqual((await listMarketItems({})).items.filter((i) => i.id === item), []);
  assert.equal((await report(await mkUser(), item)).status, 404, "a hidden item is 404 for a new reporter");
});

test("a report needs a public item", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  assert.equal((await report(u, await mkItem({ status: "candidate" }))).status, 404);
  assert.equal((await report(u, randomUUID())).status, 404);
  const route = await import("../app/api/market/items/[id]/report/route.ts");
  const id = await mkItem();
  assert.equal((await call(route.POST, marketRequest(`/api/market/items/${id}/report`, { method: "POST", body: {} }), ctxOf({ id }))).status, 401);
  assert.equal((await report(u, id, "x".repeat(2000))).status, 200);
  const [r] = await rows("SELECT length(reason) AS n FROM market_reports WHERE item_id = $1", [id]);
  assert.equal(Number(r!.n), 300, "the reason is bounded");
});

test("opting out removes the waiting candidates, not the active listings; the toggle goes both ways", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const u = await mkUser();
  const waiting = await mkItem({ status: "candidate", source: u.id });
  const active = await mkItem({ status: "active", source: u.id });
  const foreign = await mkItem({ status: "candidate", source: (await mkUser()).id });
  assert.deepEqual((await optOut(u, "GET")).body, { optOut: false });
  const on = await optOut(u, "PUT", { optOut: true });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { optOut: true });
  assert.deepEqual((await optOut(u, "GET")).body, { optOut: true });
  assert.equal((await rows("SELECT 1 FROM market_items WHERE id = $1", [waiting])).length, 0);
  assert.equal((await rows("SELECT 1 FROM market_items WHERE id = $1", [active])).length, 1);
  assert.equal((await rows("SELECT 1 FROM market_items WHERE id = $1", [foreign])).length, 1);
  assert.equal((await rows("SELECT market_opt_out FROM users WHERE id = $1", [u.id]))[0]!.market_opt_out, true);
  assert.deepEqual((await optOut(u, "PUT", { optOut: false })).body, { optOut: false });
  assert.equal((await optOut(u, "PUT", { optOut: "yes" })).status, 400);
});

test("the opt-out works while the market is dark: candidates are collected before anyone sees the shop", { skip }, async (t) => {
  quiet(t);
  await resetSettings({ "market.enabled": false });
  const u = await mkUser();
  assert.equal((await optOut(u, "PUT", { optOut: true })).status, 200);
  await setSetting("market.enabled", true);
});
