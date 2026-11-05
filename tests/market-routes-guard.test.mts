/* eslint-disable @typescript-eslint/no-explicit-any -- SQL rows and JSON answers are read untyped here */
import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import sharp from "sharp";
import { buy, call, closeDb, ctxOf, db, drainJobs, marketRequest, mkItem, mkUser, neutralWork, resetSettings, setSetting, skip } from "./helpers/market-buy.mts";

/**
 * Anti-theft of the market (docs/market/PLAN.md §3). The explicit leak test: every route under `app/api/market` is listed
 * in `GUARDED` with who may call it; a new route file fails the first test until someone decides. A marked sentence
 * lives in the item's document, in its neutral file and in its asset; no answer to a non-buyer may contain it, nor a
 * body-shaped key, nor the source's identity. Then the owner-only generation routes against a foreign user.
 *
 * Guarded routes (public = anonymous allowed, cards/rasters only; user = own data only):
 *   GET  /api/market/items                                public
 *   GET  /api/market/items/[id]                           public
 *   GET  /api/market/items/[id]/preview/[page]            public, raster only
 *   POST /api/market/items/[id]/purchase                  user, gates
 *   POST /api/market/items/[id]/report                    user
 *   GET  /api/market/suggest                              public
 *   GET  /api/market/purchases                            user, own rows
 *   POST /api/market/purchases/[id]/restore               user, own row
 *   POST /api/market/purchases/[id]/rating                user, own row
 *   GET,PUT /api/market/opt-out                           user, own flag
 *
 * Mutations (each turned the named test red, then restored):
 *   1. a new route file added without listing it          -> «every market route is listed»;
 *   2. `doc_json` added to MARKET_ROW_COLUMNS + card      -> «no body in any public answer»;
 *   3. `source_user_id` added to the card                 -> «no body in any public answer»;
 *   4. `noStoreOnError` wrapper removed                   -> «cache headers»;
 *   5. preview cache ignores `?v=`                        -> «cache headers»;
 *   6. BYTE_ROUTES entry removed                          -> «next.config»;
 *   7. market gate removed from the list route            -> «market.enabled off»;
 *   8. browser limit removed                              -> «rate limits»;
 *   9. preview IP limit removed                           -> «rate limits»;
 *  10. suggest IP limit removed                           -> «rate limits»;
 *  11. status check dropped from `getMarketItem`          -> «no status oracle»;
 *  12. `features.market` always true                      -> «features.market»;
 *  13. a cookieless view keyed by its fresh browser key   -> «catalog limits».
 *   review fix: preview max-age back to 86400 -> «cache headers»;
 */

after(closeDb);

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
const rows = async (sql: string, params: unknown[] = []) => (await db()).query<Record<string, any>>(sql, params);

const GUARDED: Record<string, readonly string[]> = {
  "items/route.ts": ["GET"],
  "items/[id]/route.ts": ["GET"],
  "items/[id]/preview/[page]/route.ts": ["GET"],
  "items/[id]/purchase/route.ts": ["POST"],
  "items/[id]/report/route.ts": ["POST"],
  "suggest/route.ts": ["GET"],
  "purchases/route.ts": ["GET"],
  "purchases/[id]/restore/route.ts": ["POST"],
  "purchases/[id]/rating/route.ts": ["POST"],
  "opt-out/route.ts": ["GET", "PUT"],
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

const API = join(process.cwd(), "app/api/market");
const SECRET = "Bu jumla faqat sotuvdagi ish ichida turadi va tashqariga chiqmaydi.";

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 100, height: 140, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
}

async function secretItem(o: { source?: string } = {}) {
  const doc = neutralWork("referat", "Himoya mavzusi") as any;
  doc.sections[0].blocks[0].text = SECRET;
  const id = await mkItem({ doc, title: "Himoya mavzusi", ...(o.source ? { source: o.source } : {}) });
  const bytes = Buffer.from(`PK ${SECRET}`);
  await rows(`INSERT INTO market_item_files (item_id, file_name, mime, size_bytes, bytes) VALUES ($1, 'n.docx', 'application/x', $2, $3)`, [id, bytes.byteLength, bytes]);
  const raster = await jpeg();
  await rows(`INSERT INTO market_previews (item_id, page, kind, mime, size_bytes, bytes, version) VALUES ($1, 1, 'page', 'image/jpeg', $2, $3, 1)`, [id, raster.byteLength, raster]);
  return id;
}

const routes = async () => ({
  list: await import("../app/api/market/items/route.ts"),
  item: await import("../app/api/market/items/[id]/route.ts"),
  preview: await import("../app/api/market/items/[id]/preview/[page]/route.ts"),
  suggest: await import("../app/api/market/suggest/route.ts"),
  purchases: await import("../app/api/market/purchases/route.ts"),
  report: await import("../app/api/market/items/[id]/report/route.ts"),
  purchase: await import("../app/api/market/items/[id]/purchase/route.ts"),
  restore: await import("../app/api/market/purchases/[id]/restore/route.ts"),
  rating: await import("../app/api/market/purchases/[id]/rating/route.ts"),
  optOut: await import("../app/api/market/opt-out/route.ts"),
});

const get = <C,>(h: (r: Request, c: C) => Promise<Response>, path: string, ctx?: C, cookie?: string) => call(h, marketRequest(path, { cookie }), ctx);
type Plain = (r: Request, c: unknown) => Promise<Response>;

/** Every read a stranger can make of one item. */
async function publicAnswers(id: string, cookie?: string) {
  const r = await routes();
  return [
    await get(r.list.GET as Plain, "/api/market/items", undefined, cookie),
    await get(r.list.GET as Plain, "/api/market/items?q=himoya", undefined, cookie),
    await get(r.item.GET, `/api/market/items/${id}`, ctxOf({ id }), cookie),
    await get(r.suggest.GET as Plain, "/api/market/suggest?tool=referat&q=himoya", undefined, cookie),
    await get(r.preview.GET, `/api/market/items/${id}/preview/1?v=1`, ctxOf({ id, page: "1" }), cookie),
  ];
}

const assertNoBody = (text: string, label: string) => {
  assert.ok(!text.includes(SECRET), `${label}: the body sentence leaked`);
  assert.ok(!text.includes("market-asset://"), `${label}: a placeholder leaked`);
  assert.ok(!/"(doc|doc_json|docJson|sections|blocks|slides|html|params_json|paramsJson|pii_flags|source_user_id|sourceUserId|source_generation_id|fingerprint|topic_norm)"\s*:/.test(text), `${label}: a private key leaked`);
};

test("every market route is listed, with the methods it exports", async () => {
  const found = routeFiles(API).map((f) => relative(API, f)).sort();
  assert.deepEqual(found, Object.keys(GUARDED).sort(), "a new route must be added to GUARDED and to the sweeps below");
  for (const [file, methods] of Object.entries(GUARDED)) {
    const src = readFileSync(join(API, file), "utf8");
    const exported = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|HEAD)\b/g)].map((m) => m[1]);
    assert.deepEqual(exported, [...methods], file);
    assert.match(src, /marketHandler\(/, `${file}: the shared no-store wrapper`);
  }
});

test("no body in any public answer: anonymous, a stranger, and a raster for the preview", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const author = await mkUser();
  const id = await secretItem({ source: author.id });
  const stranger = await mkUser();
  for (const cookie of [undefined, stranger.cookie]) {
    const answers = await publicAnswers(id, cookie);
    assert.deepEqual(answers.map((a) => a.status), [200, 200, 200, 200, 200]);
    answers.forEach((a, i) => assertNoBody(a.text, `answer ${i}`));
    assert.equal(answers[0]!.body.items.length, 1, "the sweep really saw the item");
    assert.equal(answers[2]!.body.id, id);
    assert.equal(answers[3]!.body.items.length, 1);
    assert.equal(answers[2]!.body.owned, null);
    assert.equal(answers[4]!.headers.get("content-type"), "image/jpeg");
    assert.ok(!answers[2]!.text.includes(String(author.id)) || !/"\w*[uU]ser\w*"/.test(answers[2]!.text), "the author is not on the page");
  }
});

test("refused purchases hold no body either: every error answer of the money path", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const r = await routes();
  const id = await secretItem();
  const u = await mkUser({ balance: 0 });
  const answers = [
    await buy(u, id),
    await buy(u, id, { expectedPrice: 1 }),
    await buy(u, id, { fields: {} }),
    await call(r.report.POST, marketRequest(`/api/market/items/${id}/report`, { method: "POST", body: {} }), ctxOf({ id })),
    await call(r.purchase.POST, marketRequest(`/api/market/items/${id}/purchase`, { method: "POST", body: {} }), ctxOf({ id })),
  ];
  assert.deepEqual(answers.map((a) => a.status), [402, 409, 400, 401, 401]);
  answers.forEach((a, i) => assertNoBody(a.text, `error ${i}`));
});

test("no status oracle: unknown ids and non-public items answer the same 404", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const r = await routes();
  const answers = [];
  for (const id of [randomUUID(), "not-a-uuid", await mkItem({ status: "candidate" }), await mkItem({ status: "rejected" }), await mkItem({ status: "retired" }), await mkItem({ hidden: true })]) {
    const a = await get(r.item.GET, `/api/market/items/${id}`, ctxOf({ id }));
    assert.equal(a.status, 404, id);
    answers.push(a.body.error);
  }
  assert.equal(new Set(answers).size, 1, "one message for all of them");
  const preview = await mkItem({ status: "candidate" });
  assert.equal((await get(r.preview.GET, `/api/market/items/${preview}/preview/1`, ctxOf({ id: preview, page: "1" }))).status, 404);
  for (const page of ["0", "7a", "-1", "99", "1e0"]) {
    assert.equal((await get(r.preview.GET, `/api/market/items/${preview}/preview/${page}`, ctxOf({ id: preview, page }))).status, 404, page);
  }
});

test("the owner-only generation routes hold for a foreign user on a bought copy", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const id = await secretItem();
  const buyer = await mkUser();
  const gen = (await buy(buyer, id)).body.generationId as string;
  await drainJobs();
  const thief = await mkUser();
  const detail = await import("../app/api/generations/[id]/route.ts");
  const file = await import("../app/api/generations/[id]/file/route.ts");
  const docRoute = await import("../app/api/generations/[id]/doc/route.ts");
  const results = await import("../app/api/generations/[id]/results/route.ts");
  const rebuild = await import("../app/api/generations/[id]/rebuild/route.ts");
  const thumb = await import("../app/api/generations/[id]/thumb/route.ts");
  const download = await import("../app/api/generations/[id]/download/route.ts");
  const asset = await import("../app/api/generations/[id]/assets/[assetId]/route.ts");
  const ctx = ctxOf({ id: gen });
  const reads: [string, Plain, unknown][] = [
    ["detail", detail.GET as Plain, ctx],
    ["file", file.GET as Plain, ctx],
    ["thumb", thumb.GET as Plain, ctx],
    ["asset", asset.GET as Plain, ctxOf({ id: gen, assetId: "a".repeat(24) })],
  ];
  for (const [name, h, c] of reads) {
    const a = await call(h, marketRequest(`/api/generations/${gen}`, { cookie: thief.cookie }), c);
    assert.ok(a.status === 404 || a.status === 403 || a.status === 405, `${name}: ${a.status}`);
    assert.ok(!a.text.includes(SECRET), name);
  }
  const scores = await call(results.GET as Plain, marketRequest(`/api/generations/${gen}/results`, { cookie: thief.cookie }), ctx);
  assert.deepEqual(scores.body.results, [], "scoped by owner in SQL: nothing to read");
  const dl = await call(download.POST as Plain, marketRequest(`/api/generations/${gen}/download`, { method: "POST", cookie: thief.cookie, body: { format: "native" } }), ctx);
  assert.equal(dl.status, 404);
  const patch = await call(docRoute.PATCH as Plain, marketRequest(`/api/generations/${gen}/doc`, { method: "PATCH", cookie: thief.cookie, body: { baseVersion: 0, ops: [{ op: "text", path: "x", value: "y" }] } }), ctx);
  assert.equal(patch.status, 404, patch.text);
  const again = await call(rebuild.POST as Plain, marketRequest(`/api/generations/${gen}/rebuild`, { method: "POST", cookie: thief.cookie, body: {} }), ctx);
  assert.equal(again.status, 404, again.text);
  // The buyer himself reads his copy through the same route: the test above is not vacuous.
  const own = await call(detail.GET as Plain, marketRequest(`/api/generations/${gen}`, { cookie: buyer.cookie }), ctx);
  assert.equal(own.status, 200);
  assert.equal(own.body.generation.marketItemId, id, "the «Bozordan» badge");
  assert.ok(own.text.includes(SECRET));
});

test("cache headers: JSON and errors are private no-store; a raster is public only under its own version", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const id = await secretItem();
  const answers = await publicAnswers(id);
  for (const a of answers.slice(0, 4)) assert.equal(a.headers.get("cache-control"), "private, no-store");
  assert.equal(answers[4]!.headers.get("cache-control"), "public, max-age=3600, immutable");
  assert.equal(answers[4]!.headers.get("x-content-type-options"), "nosniff");
  const r = await routes();
  const stale = await get(r.preview.GET, `/api/market/items/${id}/preview/1?v=99`, ctxOf({ id, page: "1" }));
  assert.equal(stale.headers.get("cache-control"), "private, no-store", "another version must not pin these bytes");
  const none = await get(r.preview.GET, `/api/market/items/${id}/preview/1`, ctxOf({ id, page: "1" }));
  assert.equal(none.headers.get("cache-control"), "private, no-store");
  const missing = randomUUID();
  const err = await get(r.item.GET, `/api/market/items/${missing}`, ctxOf({ id: missing }));
  assert.equal(err.status, 404);
  assert.equal(err.headers.get("cache-control"), "private, no-store");
  const previewErr = await get(r.preview.GET, `/api/market/items/${missing}/preview/1?v=1`, ctxOf({ id: missing, page: "1" }));
  assert.equal(previewErr.status, 404);
  assert.equal(previewErr.headers.get("cache-control"), "private, no-store");
});

test("next.config: only the preview route escapes the /api no-store rule", async () => {
  const src = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
  const entries = src.slice(src.indexOf("BYTE_ROUTES = ["), src.indexOf('].join("|")')).split("\n").filter((l) => l.includes('"'));
  const market = entries.filter((l) => l.includes("market"));
  assert.deepEqual(market.map((l) => l.trim()), ['"market/items/[^/]+/preview/[^/]+",']);
});

test("market.enabled off: every read is 503; flipped on, the same route answers", { skip }, async (t) => {
  quiet(t);
  await resetSettings({ "market.enabled": false });
  const r = await routes();
  const id = await secretItem();
  const u = await mkUser();
  const answers = await publicAnswers(id, u.cookie);
  answers.push(await get(r.purchases.GET as Plain, "/api/market/purchases", undefined, u.cookie));
  for (const a of answers) {
    assert.equal(a.status, 503, a.text);
    assert.equal(a.body.code, "market_disabled");
    assert.equal(a.headers.get("cache-control"), "private, no-store");
  }
  const rest = await call(r.restore.POST, marketRequest(`/api/market/purchases/${id}/restore`, { method: "POST", cookie: u.cookie, body: {} }), ctxOf({ id }));
  assert.equal(rest.status, 503);
  const rate = await call(r.rating.POST, marketRequest(`/api/market/purchases/${id}/rating`, { method: "POST", cookie: u.cookie, body: { stars: 5 } }), ctxOf({ id }));
  assert.equal(rate.status, 503);
  const rep = await call(r.report.POST, marketRequest(`/api/market/items/${id}/report`, { method: "POST", cookie: u.cookie, body: {} }), ctxOf({ id }));
  assert.equal(rep.status, 503);
  const admin = await mkUser({ admin: true });
  assert.equal((await get(r.list.GET as Plain, "/api/market/items", undefined, admin.cookie)).status, 200, "an admin sees the dark market");
  await setSetting("market.enabled", true);
  assert.equal((await get(r.list.GET as Plain, "/api/market/items")).status, 200);
});

test("features.market follows the switch; an admin sees it early", { skip }, async (t) => {
  quiet(t);
  await resetSettings({ "market.enabled": false });
  const session = await import("../app/api/auth/session/route.ts");
  const u = await mkUser();
  const admin = await mkUser({ admin: true });
  const flag = async (cookie?: string) => (await call(session.GET as Plain, marketRequest("/api/auth/session", { cookie }))).body.features.market;
  assert.equal(await flag(), false);
  assert.equal(await flag(u.cookie), false);
  assert.equal(await flag(admin.cookie), true);
  await setSetting("market.enabled", true);
  assert.equal(await flag(), true);
});

test("rate limits: the browser and IP buckets answer 429 past their ceiling", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const { IP_LIMITS, BROWSER_KEY_COOKIE } = await import("../lib/server/ip-limits.ts");
  const { windowStartOf } = await import("../lib/server/ratelimit.ts");
  const r = await routes();
  const fill = async (bucket: string, spec: { count: number; windowSec: number }) =>
    rows("INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, $2, $3) ON CONFLICT (bucket, window_start) DO UPDATE SET hits = EXCLUDED.hits", [bucket, windowStartOf(Date.now(), spec.windowSec), spec.count]);
  const key = "b".repeat(20);
  await fill(`market:list:b:${key}`, IP_LIMITS.marketListPerBrowser);
  const limited = await call(r.list.GET as Plain, marketRequest("/api/market/items", { cookie: `${BROWSER_KEY_COOKIE}=${key}` }));
  assert.equal(limited.status, 429, "the browser bucket");
  const open = await call(r.list.GET as Plain, marketRequest("/api/market/items"));
  assert.equal(open.status, 200, "another browser passes");
  assert.match(open.headers.get("set-cookie") ?? "", new RegExp(`${BROWSER_KEY_COOKIE}=.*Path=/api/market`), "a new browser gets its key");

  const { clientIp } = await import("../lib/server/ratelimit.ts");
  const ip = clientIp(marketRequest("/api/market/items"));
  await fill(`market:list:ip:${ip}`, IP_LIMITS.marketListPerIp);
  assert.equal((await call(r.list.GET as Plain, marketRequest("/api/market/items"))).status, 429, "the IP ceiling");

  const id = await secretItem();
  await fill(`market:preview:ip:${ip}`, IP_LIMITS.marketPreviewPerIp);
  assert.equal((await get(r.preview.GET, `/api/market/items/${id}/preview/1`, ctxOf({ id, page: "1" }))).status, 429, "the preview bucket");
  await fill(`market:suggest:ip:${ip}`, IP_LIMITS.marketSuggestPerIp);
  assert.equal((await get(r.suggest.GET as Plain, "/api/market/suggest?tool=referat&q=abc")).status, 429, "the suggest bucket");
});

test("catalog limits: a page is at most 48 cards, unknown filters are refused or ignored, the view counter moves once", { skip }, async (t) => {
  quiet(t);
  await resetSettings();
  const r = await routes();
  const id = await mkItem();
  const u = await mkUser();
  const page = await get(r.list.GET as Plain, "/api/market/items?limit=100000");
  assert.equal(page.status, 200);
  assert.ok(page.body.items.length <= 48);
  for (let i = 0; i < 3; i++) await get(r.item.GET, `/api/market/items/${id}`, ctxOf({ id }), u.cookie);
  assert.equal(Number((await rows("SELECT view_count FROM market_items WHERE id = $1", [id]))[0]!.view_count), 1);
  assert.equal((await get(r.list.GET as Plain, "/api/market/items?cursor=%%%")).status, 400);
  // No cookie: every request looks like a new browser, so the IP carries the count, once a day.
  const anon = await mkItem();
  for (let i = 0; i < 3; i++) await get(r.item.GET, `/api/market/items/${anon}`, ctxOf({ id: anon }));
  assert.equal(Number((await rows("SELECT view_count FROM market_items WHERE id = $1", [anon]))[0]!.view_count), 1, "cookieless requests do not inflate the counter");
});
