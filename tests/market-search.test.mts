import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { buildSearchText, normalizeTopic } from "../lib/market/normalize.ts";

/**
 * Catalog reads (docs/market/PLAN.md §5.2, §3.1) on a real, isolated Postgres: FTS across scripts and apostrophes, prefix
 * on the last token, the optional trigram fallback, filters, facets, keyset pagination in each sort, what a non-buyer may
 * ever receive, and the item page's visibility rules.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `:*` prefix dropped from `tsquery`                         -> «prefix»;
 *   2. status filter `m.status = 'active'` removed                -> «visibility»;
 *   3. hidden_until_review filter removed                         -> «visibility»;
 *   4. tools filter `tool_id = ANY` removed                       -> «tools_disabled»;
 *   5. cursor comparison `<` → `<=`                               -> «pagination» (repeats a row);
 *   6. sort value without `::text` (timestamp cut to ms)          -> «pagination» (same-millisecond rows);
 *   7. `skip` ignored in `whereOf`                                -> «facets»;
 *   8. fuzzy branch never taken                                   -> «trigram fallback»;
 *   9. owner check removed in `getMarketItem`                     -> «a buyer keeps reaching»;
 *  10. visibility check removed in `getMarketItem`                -> «item page», «a buyer keeps reaching»;
 *  11. limit cap removed                                          -> «page size»;
 *  12. the cheap sort ignores the tool percent                    -> «sorts»;
 *  13. the first-page cache bypassed                              -> «the first page is cached»;
 *  14. the view counter not debounced                             -> «the view counter»;
 *  15. stars shown from one vote                                  -> «a card is the shop window»;
 *  16. the sitemap cache removed                                  -> «sitemap»;
 *  17. the sitemap cache read before the switch                   -> «sitemap».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("marketsearch") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

let ready: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  ready ??= mod.migrate();
  await ready;
  return mod;
}
after(async () => {
  if (!ready) return;
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

type Seed = { tool?: string; title?: string; subject?: string; level?: string; status?: string; sold?: number; rating?: [number, number]; approvedDaysAgo?: number; params?: Record<string, unknown>; original?: number; override?: number; hidden?: boolean; outline?: string[]; approvedAt?: string };

let seq = 0;
async function item(o: Seed = {}): Promise<string> {
  const { query } = await db();
  const title = o.title ?? `Mavzu ${seq++}`;
  const outline = o.outline ?? [];
  const [row] = await query<{ id: string }>(
    `INSERT INTO market_items (tool_id, title, summary, subject, level, status, doc_json, params_json, outline_json, topic_norm, search_text, original_price, price_override, sold_count, rating_sum, rating_count, approved_at, quality_json, slide_count)
     VALUES ($1, $2, 'Qisqa tavsif', $3, $4, $5, '{"secretBody":"MAXFIY MATN"}'::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, COALESCE($15::timestamptz, now() - $16::int * interval '1 day'), $17::jsonb, NULL)
     RETURNING id`,
    [
      o.tool ?? "referat",
      title,
      o.subject ?? "tarix",
      o.level ?? "otm",
      o.status ?? "active",
      JSON.stringify(o.params ?? { pages: "15-20" }),
      JSON.stringify(outline),
      normalizeTopic(title),
      buildSearchText({ title, summary: "", outline }),
      o.original ?? 4000,
      o.override ?? null,
      o.sold ?? 0,
      o.rating?.[0] ?? 0,
      o.rating?.[1] ?? 0,
      o.approvedAt ?? null,
      o.approvedDaysAgo ?? 0,
      JSON.stringify(o.hidden ? { hidden_until_review: true } : {}),
    ],
  );
  return row!.id;
}

async function fresh() {
  const { query } = await db();
  await query("DELETE FROM market_purchases");
  await query("DELETE FROM market_items");
  await query("DELETE FROM market_tool_pricing");
  await query("DELETE FROM app_settings WHERE key LIKE 'market.%'");
  (await import("../lib/server/settings.ts")).invalidateSettingsCache();
  (await import("../lib/server/market/pricing.ts")).invalidateMarketPricingCache();
  (await import("../lib/server/market/search.ts")).invalidateMarketCatalogCache();
}

const search = async () => import("../lib/server/market/search.ts");
const titles = (r: { items: { title: string }[] }) => r.items.map((i) => i.title);

test("FTS: Latin, Cyrillic and every apostrophe meet one row; the outline is searchable; the body is not in the index", { skip }, async () => {
  await fresh();
  const { listMarketItems } = await search();
  await item({ title: "O'zbekiston tarixi", outline: ["Amir Temur davri"] });
  await item({ title: "Fizika asoslari" });
  for (const q of ["o'zbekiston", "oʻzbekiston", "O‘ZBEKISTON", "ozbekiston", "Ўзбекистон", "ўзбекистон тарихи", "temur"]) {
    assert.deepEqual(titles(await listMarketItems({ q })), ["O'zbekiston tarixi"], q);
  }
  assert.deepEqual(titles(await listMarketItems({ q: "maxfiy" })), [], "doc_json is not searched");
});

test("prefix: the last token matches as a prefix, the others as whole words", { skip }, async () => {
  await fresh();
  const { listMarketItems } = await search();
  await item({ title: "Kimyo laboratoriyasi" });
  assert.deepEqual(titles(await listMarketItems({ q: "labor" })), ["Kimyo laboratoriyasi"]);
  assert.deepEqual(titles(await listMarketItems({ q: "kimyo lab" })), ["Kimyo laboratoriyasi"]);
});

test("a query cannot break the tsquery; one letter is no search; a tsquery operator is just a word", { skip }, async () => {
  await fresh();
  const { listMarketItems } = await search();
  await item({ title: "Biologiya" });
  for (const q of ["bio':* & !", "(((", "a|b&c", "\\'", "%%%"]) await listMarketItems({ q });
  assert.deepEqual(titles(await listMarketItems({ q: "b" })), ["Biologiya"], "below two letters the query is ignored");
});

test("trigram fallback: a typo finds the topic through pg_trgm when FTS finds too little; GIN serves FTS", { skip }, async (t) => {
  await fresh();
  const { query } = await db();
  const { listMarketItems, marketTrgmAvailable, suggestMarketItems } = await search();
  await item({ title: "Fotosintez jarayoni" });
  if (!(await marketTrgmAvailable())) return t.skip("pg_trgm is not installed here");
  assert.deepEqual(titles(await listMarketItems({ q: "fotosintes jarayoni" })), ["Fotosintez jarayoni"]);
  assert.deepEqual(titles(await listMarketItems({ q: "qozonxona" })), [], "nothing similar: nothing shown");
  assert.deepEqual((await suggestMarketItems({ tool: "referat", q: "fotosintes jarayoni" })).map((c) => c.title), ["Fotosintez jarayoni"]);
  await query("SET enable_seqscan = off");
  const plan = await query<{ "QUERY PLAN": string }>("EXPLAIN SELECT 1 FROM market_items WHERE search_tsv @@ to_tsquery('simple','fotosintez')");
  await query("SET enable_seqscan = on");
  assert.match(plan.map((r) => r["QUERY PLAN"]).join("\n"), /market_items_search_idx/);
});

test("filters: tool, subject and level narrow the list; a value outside the catalog is ignored", { skip }, async () => {
  await fresh();
  const { listMarketItems } = await search();
  await item({ title: "A", tool: "referat", subject: "tarix", level: "otm" });
  await item({ title: "B", tool: "essay", subject: "tarix", level: "maktab", params: { essayContext: "school_dtm", pages: 2 } });
  await item({ title: "C", tool: "referat", subject: "fizika", level: "kollej" });
  assert.deepEqual(titles(await listMarketItems({ tool: "essay" })), ["B"]);
  assert.deepEqual(titles(await listMarketItems({ subject: "fizika" })).sort(), ["C"]);
  assert.deepEqual(titles(await listMarketItems({ level: "maktab" })), ["B"]);
  assert.deepEqual(titles(await listMarketItems({ tool: "referat", subject: "tarix" })), ["A"]);
  assert.equal((await listMarketItems({ tool: "resume", level: "phd", subject: "x", sort: "evil" })).items.length, 3);
});

test("facets: each dimension counts over the other filters, not over itself", { skip }, async () => {
  await fresh();
  const { listMarketItems } = await search();
  await item({ tool: "referat", subject: "tarix" });
  await item({ tool: "referat", subject: "fizika" });
  await item({ tool: "slide", subject: "tarix", params: { slideCount: 10 } });
  const r = await listMarketItems({ tool: "referat" });
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.facets.tools, [{ id: "referat", count: 2 }, { id: "slide", count: 1 }], "the tool chips keep their counts");
  assert.deepEqual(r.facets.subjects, [{ id: "fizika", count: 1 }, { id: "tarix", count: 1 }], "subjects within the tool");
  assert.deepEqual((await listMarketItems({ subject: "tarix" })).facets.tools, [{ id: "referat", count: 1 }, { id: "slide", count: 1 }]);
});

test("visibility: only active items of tools on sale; sold out, retired, candidates and report-hidden items are absent", { skip }, async () => {
  await fresh();
  const { listMarketItems } = await search();
  await item({ title: "Faol" });
  for (const status of ["candidate", "sold_out", "retired", "rejected"]) await item({ title: status, status });
  await item({ title: "Shikoyat", hidden: true });
  const r = await listMarketItems({});
  assert.deepEqual(titles(r), ["Faol"]);
  assert.deepEqual(r.facets.tools, [{ id: "referat", count: 1 }]);
  assert.equal((await listMarketItems({ sort: "popular" })).items.length, 1);
});

test("tools_disabled: a withdrawn tool leaves the list and the facets", { skip }, async () => {
  await fresh();
  const { transaction } = await db();
  const s = await import("../lib/server/settings.ts");
  const { listMarketItems, invalidateMarketCatalogCache } = await search();
  await item({ title: "Referat", tool: "referat" });
  await item({ title: "Slayd", tool: "slide", params: { slideCount: 10 } });
  await transaction((c) => s.setSettingInTx(c, "market.tools_disabled", ["slide"], null));
  s.invalidateSettingsCache();
  invalidateMarketCatalogCache();
  const r = await listMarketItems({});
  assert.deepEqual(titles(r), ["Referat"]);
  assert.deepEqual(r.facets.tools.map((f) => f.id), ["referat"]);
});

test("a card is the shop window: live prices, the cover URL, and no doc, params, flags or source on it", { skip }, async () => {
  await fresh();
  const { listMarketItems } = await search();
  const id = await item({ title: "Karta", original: 111, sold: 3, rating: [14, 3] });
  const { items } = await listMarketItems({});
  const card = items[0]!;
  assert.deepEqual(card, {
    id,
    toolId: "referat",
    title: "Karta",
    summary: "Qisqa tavsif",
    subject: "tarix",
    level: "otm",
    language: "uz",
    pages: null,
    slideCount: null,
    price: 2000,
    originalPrice: 4000,
    soldCount: 3,
    rating: { avg: 4.7, count: 3 },
    cover: `/api/market/items/${id}/preview/1?v=1`,
    status: "active",
  });
  assert.ok(!JSON.stringify(items).includes("MAXFIY"));
  const few = await item({ title: "Kam baho", rating: [10, 2] });
  (await search()).invalidateMarketCatalogCache();
  assert.equal((await listMarketItems({})).items.find((c) => c.id === few)!.rating, null, "stars only from 3 votes");
});

test("pagination: keyset walk visits each row once in every sort, same-instant rows included", { skip }, async () => {
  await fresh();
  const { listMarketItems } = await search();
  const instant = "2026-11-01T10:00:00.123456Z";
  const ids = new Set<string>();
  for (let i = 0; i < 12; i++) {
    ids.add(await item({ sold: i % 3, rating: [15 + (i % 3), 3], original: 3000 + (i % 4) * 1000, approvedAt: i % 2 ? instant : `2026-11-01T10:00:00.12345${i % 10}Z` }));
  }
  for (const sort of ["new", "popular", "cheap", "rating"]) {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r: Awaited<ReturnType<Awaited<ReturnType<typeof search>>["listMarketItems"]>> = await listMarketItems({ sort, limit: 5, cursor });
      seen.push(...r.items.map((c) => c.id));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    assert.equal(seen.length, 12, `${sort}: ${seen.length}`);
    assert.equal(new Set(seen).size, 12, `${sort} repeats a row`);
  }
});

test("sorts: popular, cheap (with the tool percent and the override) and rating order the page", { skip }, async () => {
  await fresh();
  const { query } = await db();
  const { listMarketItems } = await search();
  await item({ title: "Arzon override", original: 9000, override: 1000 });
  await item({ title: "Qimmat", original: 8000 });
  await item({ title: "O'rta", original: 5000, sold: 9, rating: [15, 3] });
  await query("INSERT INTO market_tool_pricing (tool_id, percent) VALUES ('slide', 10)");
  await item({ title: "Foizli slayd", tool: "slide", original: 8000, params: { slideCount: 30 }, sold: 2, rating: [12, 3] });
  assert.deepEqual(titles(await listMarketItems({ sort: "cheap" })), ["Foizli slayd", "Arzon override", "O'rta", "Qimmat"], "800, 1 000, 2 500, 4 000");
  assert.equal(titles(await listMarketItems({ sort: "popular" }))[0], "O'rta");
  assert.deepEqual(titles(await listMarketItems({ sort: "rating" })).slice(0, 2), ["O'rta", "Foizli slayd"]);
  assert.ok(titles(await listMarketItems({ sort: "new" })).length === 4);
});

test("page size: at most 48; a bad cursor is a 400", { skip }, async () => {
  await fresh();
  const { listMarketItems, MARKET_PAGE_MAX } = await search();
  for (let i = 0; i < 50; i++) await item();
  assert.equal(MARKET_PAGE_MAX, 48);
  assert.equal((await listMarketItems({ limit: 500 })).items.length, 48);
  assert.equal((await listMarketItems({})).items.length, 24, "the default page");
  await assert.rejects(listMarketItems({ cursor: "not-a-cursor" }), (e: { status?: number }) => e.status === 400);
  await assert.rejects(listMarketItems({ cursor: Buffer.from('["x","not-a-uuid"]').toString("base64url") }), (e: { status?: number }) => e.status === 400);
});

test("the first page is cached 15 s: a thousand identical requests hit Postgres once", { skip }, async () => {
  await fresh();
  const { listMarketItems } = await search();
  await item({ title: "Birinchi" });
  const first = await listMarketItems({});
  await item({ title: "Ikkinchi" });
  assert.equal((await listMarketItems({})).items.length, first.items.length, "served from the cache");
  assert.equal((await listMarketItems({ q: "ikkinchi" })).items.length, 1, "a search is never cached");
});

test("suggest: the tool's ready works for a topic being typed; wrong tool, short text and other tools' items give nothing", { skip }, async () => {
  await fresh();
  const { suggestMarketItems } = await search();
  await item({ title: "Quyosh energiyasi", tool: "referat", sold: 1 });
  await item({ title: "Quyosh tizimi", tool: "referat", sold: 5 });
  await item({ title: "Quyosh", tool: "slide", params: { slideCount: 10 } });
  assert.deepEqual((await suggestMarketItems({ tool: "referat", q: "quyosh" })).map((c) => c.title), ["Quyosh tizimi", "Quyosh energiyasi"]);
  assert.equal((await suggestMarketItems({ tool: "referat", q: "quyosh", limit: 1 })).length, 1);
  assert.deepEqual(await suggestMarketItems({ tool: "resume", q: "quyosh" }), []);
  assert.deepEqual(await suggestMarketItems({ tool: "referat", q: "q" }), []);
});

test("item page: the view is the card + headings + the buyer's state; no oracle for anything else", { skip }, async () => {
  await fresh();
  const { getMarketItem } = await import("../lib/server/market/items.ts");
  const id = await item({ title: "Sahifa", outline: ["Kirish", "Xulosa"], params: { pages: "15-20" } });
  const { query } = await db();
  await query("UPDATE market_items SET pages = 18 WHERE id = $1", [id]);
  const view = (await getMarketItem(id, null))!;
  assert.deepEqual(view.outline, ["Kirish", "Xulosa"]);
  assert.equal(view.previewPages, 2);
  assert.deepEqual(view.requiredFields, ["author", "university"]);
  assert.deepEqual(view.createTool, { slug: "referat", topic: "Sahifa" });
  assert.equal(view.owned, null);
  assert.ok(!JSON.stringify(view).includes("MAXFIY"));
  const deckId = await item({ tool: "slide", params: { slideCount: 10 } });
  await query("UPDATE market_items SET slide_count = 10 WHERE id = $1", [deckId]);
  const deck = (await getMarketItem(deckId, null))!;
  assert.equal(deck.previewPages, 3, "decks show one more");
  assert.deepEqual(deck.requiredFields, []);
  for (const bad of ["x", "' OR 1=1", randomUUID()]) assert.equal(await getMarketItem(bad, null), null, bad);
  for (const status of ["candidate", "retired", "rejected"]) assert.equal(await getMarketItem(await item({ status }), null), null, status);
  assert.equal(await getMarketItem(await item({ hidden: true }), null), null);
  assert.equal((await getMarketItem(await item({ status: "sold_out" }), null))?.status, "sold_out", "a sold-out item stays reachable");
});

test("a buyer keeps reaching: retired, hidden or tool withdrawn, the owner sees «sold out» + his copy; a stranger a 404", { skip }, async () => {
  await fresh();
  const { query, transaction } = await db();
  const s = await import("../lib/server/settings.ts");
  const { getMarketItem } = await import("../lib/server/market/items.ts");
  const [u] = await query<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'Xaridor') RETURNING id", [`buyer-${process.pid}`]);
  const id = await item({ status: "retired" });
  const [p] = await query<{ id: string }>("INSERT INTO market_purchases (item_id, buyer_user_id, price, original_price, fingerprint) VALUES ($1, $2, 2000, 4000, 'SLX-1') RETURNING id", [id, u!.id]);
  assert.equal(await getMarketItem(id, null), null);
  const view = (await getMarketItem(id, String(u!.id)))!;
  assert.equal(view.status, "sold_out");
  assert.deepEqual(view.owned, { generationId: null, purchaseId: p!.id });
  const active = await item({ tool: "slide", params: { slideCount: 10 } });
  await transaction((c) => s.setSettingInTx(c, "market.tools_disabled", ["slide"], null));
  s.invalidateSettingsCache();
  assert.equal(await getMarketItem(active, null), null, "a withdrawn tool is a 404 to a stranger");
});

test("the view counter: once per viewer per hour, per item; only public items; never throws", { skip }, async () => {
  await fresh();
  const { query } = await db();
  const { recordMarketView } = await import("../lib/server/market/items.ts");
  const id = await item();
  assert.equal(await recordMarketView(id, "viewer-a"), true);
  assert.equal(await recordMarketView(id, "viewer-a"), false);
  assert.equal(await recordMarketView(id, "viewer-b"), true);
  assert.equal((await query<{ view_count: string }>("SELECT view_count FROM market_items WHERE id = $1", [id]))[0]!.view_count, "2");
  assert.equal((await query<{ views: number }>("SELECT views FROM market_views WHERE item_id = $1", [id]))[0]!.views, 2);
  assert.equal(await recordMarketView(await item({ status: "retired" }), "viewer-a"), false);
  assert.equal(await recordMarketView("nonsense", "viewer-a"), false);
});

test("sitemap: the market entries are kept an hour in process, and vanish with the switch at once", { skip }, async () => {
  await fresh();
  const { query, transaction } = await db();
  const s = await import("../lib/server/settings.ts");
  const { default: sitemap } = await import("../app/sitemap.ts");
  const urls = async () => (await sitemap()).filter((e) => e.url.includes("/uz/market/")).length;
  await item({ title: "Birinchi" });
  assert.equal(await urls(), 0, "dark: nothing");
  await transaction((c) => s.setSettingInTx(c, "market.enabled", true, null));
  s.invalidateSettingsCache();
  assert.equal(await urls(), 1);
  await item({ title: "Ikkinchi" });
  (await search()).invalidateMarketCatalogCache();
  assert.equal(await urls(), 1, "no catalog queries for an hour");
  await query("DELETE FROM app_settings WHERE key = 'market.enabled'");
  s.invalidateSettingsCache();
  assert.equal(await urls(), 0);
});

test("market.enabled ships off", { skip }, async () => {
  await fresh();
  const { marketEnabled, isToolOnSale } = await import("../lib/server/market/items.ts");
  assert.equal(await marketEnabled(), false);
  assert.equal(await isToolOnSale("referat"), true);
  assert.equal(await isToolOnSale("resume"), false);
});
