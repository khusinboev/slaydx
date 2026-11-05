import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { discountPercent, marketPriceOf, roundToStep } from "../lib/market/pricing.ts";

/**
 * The market price (docs/market/PLAN.md §4). The formula is pure; the server functions are exercised on a real Postgres:
 * 50 % of the LIVE `effectivePrice`, `tool_pricing` applied once, per-tool percent, per-item override, rounding, the
 * floor, and the transaction-level read that makes mid-checkout changes visible.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `raw` uses `override ?? …` without the override branch               -> «formula»;
 *   2. `Math.max(minPrice, …)` removed                                      -> «formula»;
 *   3. `tool_pricing` compounded: percent applied on `base` then the price  -> «once, not twice»;
 *   4. `toolPercents.get` ignored                                           -> «per-tool»;
 *   5. `setItemPriceOverrideInTx` without `price_version + 1`               -> «price_version»;
 *   6. `setToolPercentInTx` without the items UPDATE                        -> «price_version»;
 *   7. `marketPriceInTx` reads `getSetting` (cached) instead of InTx        -> «mid-checkout»;
 *   8. `originalOf` reads the snapshot instead of `effectivePrice`          -> «the market follows»;
 *   9. negative override accepted                                           -> «override input».
 */

test("formula: percent, rounding, floor, override", () => {
  const base = { original: 3000, override: null, percent: 50, roundTo: 500, minPrice: 1000 };
  assert.equal(marketPriceOf(base), 1500);
  assert.equal(marketPriceOf({ ...base, original: 3500 }), 2000, "1 750 rounds to the 500 step");
  assert.equal(marketPriceOf({ ...base, original: 3200, roundTo: 100 }), 1600);
  assert.equal(marketPriceOf({ ...base, original: 1000 }), 1000, "the floor: 500 → 1 000");
  assert.equal(marketPriceOf({ ...base, percent: 80 }), 2500, "2 400 rounds to 2 500");
  assert.equal(marketPriceOf({ ...base, override: 7777 }), 8000, "an override beats the percent, the step still applies");
  assert.equal(marketPriceOf({ ...base, override: 0 }), 1000, "the floor applies to an override too");
  assert.equal(marketPriceOf({ ...base, minPrice: 0, override: 0 }), 0, "a free item needs a zero floor");
  assert.equal(roundToStep(1250, 500), 1500);
  assert.equal(discountPercent(1500, 3000), 50);
  assert.equal(discountPercent(3000, 3000), 0);
  assert.equal(discountPercent(1000, 0), 0);
});

test("settings: the plan's defaults and bounds; the feature ships OFF", async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
  const s = await import("../lib/server/settings.ts");
  const expected: Record<string, [unknown, number?, number?]> = {
    "market.enabled": [false],
    "market.percent": [50, 10, 100],
    "market.round_to": [500, 100, 1000],
    "market.min_price": [1000, 0, 20000],
    "market.paid_only": [false],
    "market.author_reward_percent": [0, 0, 50],
    "market.max_copies_slides": [30, 1, 1000],
    "market.max_copies_teacher": [50, 1, 1000],
    "market.max_copies_essay": [10, 1, 1000],
    "market.max_copies_work": [5, 1, 1000],
    "market.max_copies_thesis": [3, 1, 1000],
    "market.same_university_cap": [2, 0, 50],
    "market.preview_pages": [2, 1, 5],
    "market.min_quality": [70, 0, 100],
    "market.per_topic_limit": [3, 1, 20],
    "market.backfill_batch": [100, 0, 1000],
  };
  for (const [key, [value, min, max]] of Object.entries(expected)) {
    const def = s.settingDef(key as never) as unknown as { envDefault(): unknown; min?: number; max?: number; validate(v: unknown): { ok: boolean } };
    assert.equal(def.envDefault(), value, key);
    if (min === undefined) continue;
    assert.deepEqual([def.min, def.max], [min, max], key);
    assert.equal(def.validate(min).ok, true, key);
    assert.equal(def.validate(max + 1).ok, false, key);
  }
  assert.deepEqual(s.settingDef("market.tools_disabled").envDefault(), []);
  assert.equal(s.validateSetting("market.round_to", 250).ok, false, "only the steps of the formula");
  assert.equal(s.validateSetting("market.round_to", 1000).ok, true);
  assert.equal(s.validateSetting("market.tools_disabled", ["nonsense"]).ok, false);
});

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("marketprice") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

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

let seq = 0;
async function item(tool: string, params: Record<string, unknown>, over: { override?: number } = {}) {
  const { queryOne } = await db();
  return (await queryOne<{ id: string; tool_id: string; params_json: Record<string, unknown>; price_override: string | null; original_price: string; price_version: number }>(
    `INSERT INTO market_items (tool_id, title, doc_json, topic_norm, params_json, price_override, original_price, status)
     VALUES ($1, 'T', '{}'::jsonb, $2, $3::jsonb, $4, 111, 'active')
     RETURNING id, tool_id, params_json, price_override, original_price, price_version`,
    [tool, `t${seq++}`, JSON.stringify(params), over.override ?? null],
  ))!;
}

async function settings(values: Record<string, unknown>) {
  const { transaction } = await db();
  const s = await import("../lib/server/settings.ts");
  await transaction(async (c) => {
    for (const [k, v] of Object.entries(values)) await s.setSettingInTx(c, k, v, null);
  });
  s.invalidateSettingsCache();
}

async function reset() {
  const { query } = await db();
  await query("DELETE FROM app_settings WHERE key LIKE 'market.%'");
  await query("DELETE FROM market_tool_pricing");
  await query("DELETE FROM tool_pricing");
  (await import("../lib/server/settings.ts")).invalidateSettingsCache();
  (await import("../lib/server/pricing.ts")).invalidatePricingCache();
  (await import("../lib/server/market/pricing.ts")).invalidateMarketPricingCache();
}

test("defaults: 50 % of the tier's live price, rounded", { skip }, async () => {
  await reset();
  const { marketPriceForItem } = await import("../lib/server/market/pricing.ts");
  assert.deepEqual(await marketPriceForItem(await item("referat", { pages: "15-20" })), { price: 2000, originalPrice: 4000 });
  assert.deepEqual(await marketPriceForItem(await item("coursework", { pages: "40-45" })), { price: 12000, originalPrice: 24000 });
  assert.deepEqual(await marketPriceForItem(await item("slide", { slideCount: 10 })), { price: 1500, originalPrice: 3000 });
});

test("once, not twice: a tool_pricing row moves the original, the market percent sits on top of it", { skip }, async () => {
  await reset();
  const { query } = await db();
  await query("INSERT INTO tool_pricing (tool_id, percent, round_to, updated_at) VALUES ('referat', 200, 100, now())");
  (await import("../lib/server/pricing.ts")).invalidatePricingCache();
  const { marketPriceForItem } = await import("../lib/server/market/pricing.ts");
  assert.deepEqual(await marketPriceForItem(await item("referat", { pages: "15-20" })), { price: 4000, originalPrice: 8000 });
});

test("the market follows: the live original wins over the approval snapshot", { skip }, async () => {
  await reset();
  const { marketPriceForItem } = await import("../lib/server/market/pricing.ts");
  const row = await item("referat", { pages: "25-30" });
  assert.equal(row.original_price, "111");
  assert.equal((await marketPriceForItem(row)).originalPrice, 6000);
  assert.equal((await marketPriceForItem({ ...row, tool_id: "gone-tool" })).originalPrice, 111, "a tool gone from the registry falls back to the snapshot");
});

test("per-tool: the tool's percent beats the global one and only for that tool; the settings steer the rest", { skip }, async () => {
  await reset();
  const p = await import("../lib/server/market/pricing.ts");
  const { transaction } = await db();
  await settings({ "market.percent": 40, "market.round_to": 100, "market.min_price": 500 });
  await transaction((c) => p.setToolPercentInTx(c, "slide", 70, null));
  p.invalidateMarketPricingCache();
  assert.equal((await p.marketPriceForItem(await item("slide", { slideCount: 10 }))).price, 2100);
  assert.equal((await p.marketPriceForItem(await item("referat", { pages: "10-15" }))).price, 1200);
  await settings({ "market.min_price": 5000 });
  assert.equal((await p.marketPriceForItem(await item("referat", { pages: "10-15" }))).price, 5000);
  await transaction((c) => p.setToolPercentInTx(c, "slide", null, null));
  p.invalidateMarketPricingCache();
  assert.deepEqual(await p.listToolPercents(), []);
});

test("override: absolute so'm, beats every percent", { skip }, async () => {
  await reset();
  const { marketPriceForItem } = await import("../lib/server/market/pricing.ts");
  assert.equal((await marketPriceForItem(await item("coursework", { pages: "40-45" }, { override: 3000 }))).price, 3000);
});

test("price_version: an override change and a tool percent change bump it; another tool is untouched", { skip }, async () => {
  await reset();
  const { transaction, queryOne } = await db();
  const p = await import("../lib/server/market/pricing.ts");
  const [a, b] = [await item("slide", { slideCount: 8 }), await item("essay", { essayContext: "academic" })];
  const version = async (id: string) => (await queryOne<{ price_version: number }>("SELECT price_version FROM market_items WHERE id = $1", [id]))!.price_version;
  await transaction((c) => p.setItemPriceOverrideInTx(c, a.id, 2500));
  assert.equal(await version(a.id), 2);
  await transaction((c) => p.setItemPriceOverrideInTx(c, a.id, null));
  assert.equal(await version(a.id), 3);
  await transaction((c) => p.setToolPercentInTx(c, "slide", 60, null));
  assert.equal(await version(a.id), 4);
  assert.equal(await version(b.id), 1);
  await transaction((c) => p.setToolPercentInTx(c, "slide", null, null));
  assert.equal(await version(a.id), 5);
});

test("override input: a negative or fractional price is refused, an unknown item is a 404; a bad percent too", { skip }, async () => {
  await reset();
  const { transaction } = await db();
  const p = await import("../lib/server/market/pricing.ts");
  const row = await item("slide", { slideCount: 8 });
  await assert.rejects(transaction((c) => p.setItemPriceOverrideInTx(c, row.id, -1)), /manfiy/);
  await assert.rejects(transaction((c) => p.setItemPriceOverrideInTx(c, row.id, 1.5)), /manfiy/);
  await assert.rejects(transaction((c) => p.setItemPriceOverrideInTx(c, "00000000-0000-4000-8000-000000000000", 1000)), /yo'q/);
  await assert.rejects(transaction((c) => p.setToolPercentInTx(c, "slide", 5, null)), /Foiz/);
});

test("mid-checkout: the in-transaction price sees a committed change the 15 s cache still hides", { skip }, async () => {
  await reset();
  const { transaction, query } = await db();
  const p = await import("../lib/server/market/pricing.ts");
  const row = await item("referat", { pages: "15-20" });
  assert.equal((await p.marketPriceForItem(row)).price, 2000, "warms every cache");
  // Another process commits: nothing here invalidates this process's caches.
  await query(`INSERT INTO app_settings (key, value, updated_at) VALUES ('market.percent', '75'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = '75'::jsonb`);
  await query("INSERT INTO market_tool_pricing (tool_id, percent) VALUES ('coursework', 20)");
  assert.equal((await p.marketPriceForItem(row)).price, 2000, "the cached read is stale for up to 15 s");
  assert.deepEqual(await transaction((c) => p.marketPriceInTx(c, row)), { price: 3000, originalPrice: 4000 });
  await query("INSERT INTO tool_pricing (tool_id, percent, round_to, updated_at) VALUES ('referat', 200, 100, now())");
  assert.deepEqual(await transaction((c) => p.marketPriceInTx(c, row)), { price: 6000, originalPrice: 8000 });
  const cw = await item("coursework", { pages: "40-45" });
  assert.deepEqual(await transaction((c) => p.marketPriceInTx(c, cw)), { price: 5000, originalPrice: 24000 }, "the tool percent row, fresh");
});

test("in-transaction override and floor agree with the cached formula", { skip }, async () => {
  await reset();
  const { transaction } = await db();
  const p = await import("../lib/server/market/pricing.ts");
  const row = await item("coursework", { pages: "10-15" }, { override: 3000 });
  const cached = await p.marketPriceForItem(row);
  assert.deepEqual(await transaction((c) => p.marketPriceInTx(c, row)), cached);
});
