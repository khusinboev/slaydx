import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { GPT, NANO, PRICING, catalogBody, expectedPrice } from "./studio-fixtures.ts";

const { parseCatalog } = await import("../../components/studio/studio-api.ts");
const { studioBasePrice, studioPrice, unitPrice, outputCount, badgeText, initials, BADGE_LABEL, FILTER_BADGES } = await import("../../components/studio/studio-price.ts");
const { resolveEntry } = await import("../../components/studio/StudioPage.tsx");
const { STUDIO_ENTRY, studioFirst } = await import("../../components/studio/studio-entry.ts");

/**
 * Pure part of the Studio UI: the catalog parser (untrusted JSON → typed models), the price preview and the model
 * resolution. No DOM.
 *
 * Locked here:
 *   - the parser keeps the usable image models only (a video / malformed entry is simply not offered), needs the pricing
 *     context (without it there is no honest preview → `null`), falls back to the first model when the default is not
 *     in the list, drops an override below ×1;
 *   - PRICE = the formula, independently re-computed: cost × markup rounded UP to the step, the model's override wins,
 *     a ≥ 1 result; the admin's per-tool adjustment is applied AFTER (`applyPriceAdjust`); `unitPrice` is one picture;
 *   - `resolveEntry`: chosen → default → first;
 *   - `studioFirst` moves the studio tool first and keeps the others in order.
 *
 * Mutations (each turned the named tests red, then restored):
 *   parseEntry accepts `kind: "video"`                                      -> «parser keeps the usable image models»;
 *   parseCatalog returns a catalog without pricing                          -> «parser needs the pricing context»;
 *   `defaultModelId` taken on trust (no `models.some`)                      -> «default falls back…»;
 *   studioPrice skips `applyPriceAdjust`                                    -> «the tool's adjustment is applied after»;
 *   studioBasePrice ignores `pricing.overrides`                             -> «override wins»;
 *   outputCount reads the raw (un-normalized) count                         -> «unitPrice…outputCount…»;
 *   resolveEntry without the server's default (first model instead)         -> «resolveEntry…»;
 */

test("parser keeps the usable image models only: a video, a malformed param list and a missing cost are not offered", () => {
  const video = MEDIA_CATALOG.clientView().find((e) => e.kind === "video")!;
  const badParams = { ...NANO, id: "x/bad-params", params: [{ type: "enum" }] };
  const noCost = { ...NANO, id: "x/no-cost", cost: undefined };
  const noLabel = { ...NANO, id: "x/no-label", label: "" };
  const parsed = parseCatalog({ ...catalogBody([NANO, GPT]), models: [NANO, video, badParams, noCost, noLabel, "junk", null, GPT] })!;
  assert.deepEqual(parsed.models.map((m) => m.id), [NANO.id, GPT.id], "MUTATSIYA: video qabul qilinsa qizaradi");
  assert.deepEqual(parsed.pricing, PRICING);
  assert.equal(parsed.defaultModelId, NANO.id);
});

test("parser needs the pricing context (no honest price preview without it) and a models list", () => {
  assert.equal(parseCatalog({ ...catalogBody([NANO]), pricing: undefined }), null, "MUTATSIYA: narxsiz katalog qabul qilinsa qizaradi");
  assert.equal(parseCatalog({ ...catalogBody([NANO]), pricing: { soumPerUsd: 0, markup: 2, step: 100 } }), null);
  assert.equal(parseCatalog({ ...catalogBody([NANO]), models: "nope" }), null);
  assert.equal(parseCatalog(null), null);
  assert.equal(parseCatalog([]), null);
});

test("default falls back to the first model when the server's default is not in the list; an empty list is allowed", () => {
  assert.equal(parseCatalog(catalogBody([NANO, GPT], PRICING, "openai/gone"))!.defaultModelId, NANO.id);
  assert.equal(parseCatalog(catalogBody([NANO, GPT], PRICING, GPT.id))!.defaultModelId, GPT.id);
  const none = parseCatalog(catalogBody([], PRICING, undefined))!;
  assert.deepEqual(none.models, []);
  assert.equal(none.defaultModelId, "");
});

test("pricing: markup defaults to 2 and step to 100; an override below ×1 or without a number is dropped", () => {
  const p = parseCatalog({ ...catalogBody([NANO]), pricing: { soumPerUsd: 12_800, overrides: { a: { markup: 0.5 }, b: { markup: 4 }, c: {}, d: "x" } } })!.pricing;
  assert.equal(p.markup, 2);
  assert.equal(p.step, 100);
  assert.deepEqual(p.overrides, { b: { markup: 4 } });
});

test("PRICE = the formula (independent copy): cost × markup rounded UP to the step, for every model × count", () => {
  for (const m of [NANO, GPT]) {
    for (const n of [1, 2, 3, 4]) {
      assert.equal(studioBasePrice(m, { imageCount: n }, PRICING), expectedPrice(m, n), `${m.id} × ${n}`);
    }
  }
  assert.equal(studioBasePrice(NANO, { imageCount: 1 }, PRICING), 900, "0.034 × 12 800 × 2 = 870.4 → 900 (rounded UP)");
  const fine = { ...PRICING, step: 10 };
  assert.equal(studioBasePrice(NANO, { imageCount: 1 }, fine), 880, "the step comes from the server");
  // A zero-cost rule never prices at 0 («a priced job is never free by rounding»).
  assert.ok(studioBasePrice({ ...NANO, cost: { per: "output", usd: 0, countParam: "imageCount" } }, {}, PRICING) >= 1);
});

test("override wins for its model; the global markup for the others", () => {
  const pricing = { ...PRICING, markup: 3, overrides: { [GPT.id]: { markup: 5 } } };
  assert.equal(studioBasePrice(NANO, { imageCount: 2 }, pricing), expectedPrice(NANO, 2, pricing));
  assert.equal(studioBasePrice(GPT, { imageCount: 2 }, pricing), expectedPrice(GPT, 2, pricing), "MUTATSIYA: override o'qilmasa qizaradi");
  assert.ok(studioBasePrice(GPT, { imageCount: 2 }, pricing) > studioBasePrice(GPT, { imageCount: 2 }, { ...pricing, overrides: {} }));
});

test("the tool's adjustment (tool_pricing %) is applied AFTER, with its own rounding; none = the base price", () => {
  const base = studioBasePrice(NANO, { imageCount: 1 }, PRICING);
  assert.equal(base, 900);
  assert.equal(studioPrice(NANO, { imageCount: 1 }, PRICING, undefined), base);
  assert.equal(studioPrice(NANO, { imageCount: 1 }, PRICING, { percent: 150, roundTo: 500 }), 1500, "900 × 1.5 = 1 350 → 1 500 (to 500), MUTATSIYA: tuzatish qo'llanmasa qizaradi");
  assert.equal(studioPrice(NANO, { imageCount: 1 }, PRICING, { percent: 100, roundTo: 100 }), base, "100 % is a no-op");
});

test("unitPrice is ONE picture whatever the count; outputCount reads the normalized count", () => {
  assert.equal(unitPrice(NANO, { imageCount: 4, imageRatio: "16:9" }, PRICING), expectedPrice(NANO, 1));
  assert.equal(outputCount(NANO, { imageCount: 3 }), 3);
  assert.equal(outputCount(NANO, { imageCount: 99 }), 1, "a count the model refuses reads as its default, like the price");
  assert.equal(outputCount(NANO, {}), 1);
  const flat = { ...NANO, cost: { per: "job" as const, usd: 0.05 } };
  assert.equal(outputCount(flat, { imageCount: 4 }), 1, "a per-job model makes one result");
  assert.equal(unitPrice(flat, { imageCount: 4 }, PRICING), studioPrice(flat, { imageCount: 4 }, PRICING));
});

test("resolveEntry: the chosen model, else the server's default, else the first; none for an empty catalog", () => {
  const cat = parseCatalog(catalogBody([NANO, GPT], PRICING, GPT.id))!;
  assert.equal(resolveEntry(cat, NANO.id)?.id, NANO.id);
  assert.equal(resolveEntry(cat, null)?.id, GPT.id, "no choice yet: the default");
  assert.equal(resolveEntry(cat, "gone/model")?.id, GPT.id, "MUTATSIYA: noma'lum id da birinchi model qaytsa qizaradi");
  assert.equal(resolveEntry(parseCatalog(catalogBody([NANO, GPT], PRICING, undefined))!, "gone")?.id, NANO.id, "no default either: the first");
  assert.equal(resolveEntry(parseCatalog(catalogBody([], PRICING, undefined))!, null), null);
  assert.equal(resolveEntry(null, NANO.id), null);
});

test("badge words, filter order and avatar initials", () => {
  assert.equal(badgeText(NANO), "Tez, Arzon");
  assert.equal(badgeText(GPT), "Sifatli, Matnli dizayn");
  assert.deepEqual(FILTER_BADGES.map((b) => BADGE_LABEL[b]), ["Tez", "Sifatli", "Arzon", "Matnli dizayn"]);
  assert.equal(initials("Nano Banana"), "NB");
  assert.equal(initials("ChatGPT (GPT Image)"), "CG");
  assert.equal(initials("Aisha"), "AI");
  assert.equal(initials(""), "");
});

test("studioFirst moves the studio tool to the front of its group and keeps the rest in order; the entry points at /uz/studio", () => {
  const tools = [{ slug: "podcast" }, { slug: "studio" }, { slug: "video" }];
  assert.deepEqual(studioFirst(tools).map((t) => t.slug), ["studio", "podcast", "video"]);
  assert.deepEqual(studioFirst([{ slug: "a" }, { slug: "b" }]).map((t) => t.slug), ["a", "b"], "no studio: unchanged");
  assert.equal(STUDIO_ENTRY.href, "/uz/studio");
  assert.equal(studioFirst(tools).length, 3);
});
