import "./setup.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, PriceChangedError } from "../../lib/api-client.ts";
import { ID, item } from "./market-fixture.ts";

/**
 * The pure model of the market pages (`components/market/market-model.ts`, docs/market/PLAN.md §5).
 *
 * Mutations (each turned this file red, restored byte for byte):
 *   M1 `parseFilters`: trust the URL's `tool` (no `isMarketTool`) → «a foreign tool reads as no filter»;
 *   M2 `filtersToSearch`: keep `sort=new` → «the plain catalog keeps a clean URL»;
 *   M3 `galleryPages`: no `LAST_PREVIEW_PAGE` cap → «stubs never pass page 6»;
 *   M4 `discountPercent`: drop the `price >= originalPrice` guard → «no discount, no badge»;
 *   M5 `safeMarketReturn`: `safeReturnTo` alone → «only a way back into the market»;
 *   M6 `purchaseProblem`: `retrySameKey` always false → «a lost answer retries with the same key»;
 *   M7 `buyerFieldIds`: drop `extra` → «what the tool requires is always on the form».
 */

const m = await import("../../components/market/market-model.ts");

test("parseFilters: a foreign tool, subject, level or sort reads as no filter", () => {
  const f = m.parseFilters(new URLSearchParams("tool=resume&subject=magic&level=phd&sort=evil&q=tarix"));
  assert.deepEqual(f, { ...m.NO_FILTERS, q: "tarix" });
  assert.deepEqual(m.parseFilters(new URLSearchParams("tool=slide&subject=tarix&level=otm&sort=cheap")), { tool: "slide", subject: "tarix", level: "otm", sort: "cheap", q: "" });
  assert.equal(m.parseFilters(new URLSearchParams(`q=${"x".repeat(300)}`)).q.length, m.SEARCH_MAX);
  assert.deepEqual(m.parseFilters(null), m.NO_FILTERS);
});

test("filtersToSearch: the plain catalog keeps a clean URL; a one-letter query is not a query", () => {
  assert.equal(m.filtersToSearch(m.NO_FILTERS).toString(), "");
  assert.equal(m.filtersToSearch({ ...m.NO_FILTERS, q: " a " }).toString(), "");
  assert.equal(m.filtersToSearch({ tool: "essay", subject: "huquq", level: "kollej", sort: "popular", q: " o'zbek " }).toString(), "tool=essay&subject=huquq&level=kollej&sort=popular&q=o%27zbek");
  assert.equal(m.hasFilters(m.NO_FILTERS), false);
  assert.equal(m.sheetFilterCount({ ...m.NO_FILTERS, tool: "slide", subject: "tarix", sort: "cheap" }), 2, "the tool chip is outside the sheet");
});

test("TOOL_CHIPS: every tool of the registry, nothing else", async () => {
  const { MARKET_TOOL_IDS } = await import("../../lib/market/registry.ts");
  assert.deepEqual(m.TOOL_CHIPS.map((t) => t.id), [...MARKET_TOOL_IDS]);
  assert.deepEqual(m.TOOL_CHIPS.find((t) => t.id === "pro-slide")?.label, "Pro slayd");
});

test("labels: size, language, level and the meta line read naturally", () => {
  assert.equal(m.sizeLabel({ pages: 18, slideCount: null }), "18 bet");
  assert.equal(m.sizeLabel({ pages: null, slideCount: 12 }), "12 slayd");
  assert.equal(m.sizeLabel({ pages: null, slideCount: null }), "");
  assert.deepEqual(["uz", "uz-cyr", "ru", "en", "kk"].map(m.languageLabel), ["O'zbekcha", "Kirill", "Ruscha", "Inglizcha", "KK"]);
  assert.equal(m.levelLabel("otm"), "OTM");
  assert.equal(m.metaLine({ toolId: "referat", pages: 18, slideCount: null, language: "uz" }), "Referat · 18 bet · O'zbekcha");
  assert.equal(m.metaLine({ toolId: "slide", pages: null, slideCount: null, language: "ru" }), "Slayd · Ruscha");
});

test("discountPercent: no discount, no badge; no original price, no badge", () => {
  assert.equal(m.discountPercent({ price: 1500, originalPrice: 3000 }), 50);
  assert.equal(m.discountPercent({ price: 3000, originalPrice: 3000 }), 0);
  assert.equal(m.discountPercent({ price: 4000, originalPrice: 3000 }), 0);
  assert.equal(m.discountPercent({ price: 1500, originalPrice: 0 }), 0);
});

test("galleryPages: readable pages, then stubs; stubs never pass page 6 nor the document's end", () => {
  const kinds = (v: Parameters<typeof m.galleryPages>[0]) => m.galleryPages(v).map((p) => `${p.page}${p.kind[0]}`);
  const cover = "/api/market/items/a/preview/1?v=3";
  assert.deepEqual(kinds({ cover, previewPages: 2, totalPages: 18 }), ["1p", "2p", "3s", "4s", "5s", "6s"]);
  assert.deepEqual(kinds({ cover, previewPages: 3, totalPages: 4 }), ["1p", "2p", "3p", "4s"]);
  assert.deepEqual(kinds({ cover, previewPages: 3, totalPages: 2 }), ["1p", "2p"]);
  assert.deepEqual(kinds({ cover, previewPages: 2, totalPages: null }), ["1p", "2p"], "an unknown length: readable pages only");
  assert.equal(m.galleryPages({ cover, previewPages: 2, totalPages: 18 })[3]!.url, "/api/market/items/a/preview/4?v=3");
});

test("buyerFieldIds: by family; what the tool requires is always on the form", () => {
  assert.deepEqual(m.buyerFieldIds("slide", []), ["author", "university", "group"]);
  assert.deepEqual(m.buyerFieldIds("thesis", ["author"]), ["author", "university", "city"]);
  assert.ok(m.buyerFieldIds("konspekt", []).includes("faculty"), "konspekt has a student's title page");
  assert.deepEqual(m.buyerFieldIds("referat", []).length, 8);
  assert.ok(m.buyerFieldIds("slide", ["teacher"]).includes("teacher"));
  assert.deepEqual(m.buyerLabelOverrides("lesson-plan"), { university: "Muassasa" });
  assert.deepEqual(m.buyerLabelOverrides("referat"), {});
});

test("missingBuyerFields / purchaseFields: blanks are missing; only trimmed values on screen are sent", () => {
  assert.deepEqual(m.missingBuyerFields({ author: "  ", university: "TDIU" }, ["author", "university"]), ["author"]);
  assert.deepEqual(m.purchaseFields({ author: " Ali ", university: "", city: "Toshkent" }, ["author", "university"]), { author: "Ali" });
});

test("return path: the wallet link carries the item, only a way back into the market is accepted", () => {
  assert.equal(m.buyReturnPath(ID), `/uz/market/${ID}?buy=1`);
  assert.equal(m.walletReturnHref(ID), `/uz/wallet?return=${encodeURIComponent(`/uz/market/${ID}?buy=1`)}`);
  assert.equal(m.safeMarketReturn(`/uz/market/${ID}?buy=1`), `/uz/market/${ID}?buy=1`);
  for (const bad of ["/uz/wallet", "/uz/market", "https://evil.example/uz/market/x", "//evil.example", "/uz/../api/x", "javascript:alert(1)", 7, null]) {
    assert.equal(m.safeMarketReturn(bad), null, String(bad));
  }
});

test("purchaseProblem: every refusal maps to what the sheet does; a lost answer retries with the same key", () => {
  assert.deepEqual(m.purchaseProblem(new PriceChangedError("x", 2000)), { kind: "price_changed", price: 2000 });
  assert.deepEqual(m.purchaseProblem(new ApiError("Balans yetarli emas", 402, { required: 1500, available: 200 })), { kind: "insufficient", required: 1500, available: 200, message: "Balans yetarli emas" });
  assert.deepEqual(m.purchaseProblem(new ApiError("x", 409, { code: "already_owned", generationId: "g1" })), { kind: "already_owned", generationId: "g1" });
  assert.equal(m.purchaseProblem(new ApiError("x", 410, { code: "gone" })).kind, "gone");
  assert.deepEqual(m.purchaseProblem(new ApiError("x", 410, { code: "sold_out" })), { kind: "gone", message: "Bu ish sotilib bo'ldi." });
  assert.equal(m.purchaseProblem(new ApiError("x", 409, { code: "university_cap" })).kind, "university_cap");
  assert.equal(m.purchaseProblem(new ApiError("x", 403, { code: "channel_required" })).kind, "channel");
  assert.equal(m.purchaseProblem(new ApiError("x", 503, { code: "market_disabled" })).kind, "closed");
  assert.equal(m.purchaseProblem(new ApiError("x", 503, { code: "paused" })).kind, "paused");
  for (const status of [0, 408, 500, 503]) assert.deepEqual(m.purchaseProblem(new ApiError("x", status)), { kind: "error", message: "x", retrySameKey: true }, String(status));
  assert.deepEqual(m.purchaseProblem(new ApiError("x", 429)), { kind: "error", message: "x", retrySameKey: false });
  assert.deepEqual(m.purchaseProblem(new TypeError("boom")).kind, "error");
});

test("benefitsOf: promises what the tool produces", () => {
  assert.match(m.benefitsOf("slide").join(" | "), /PPTX.*Birinchi slaydda/);
  assert.match(m.benefitsOf("referat").join(" | "), /DOCX.*Titul sahifa/);
  assert.equal(m.previewUrlOf(item().cover, 3), `/api/market/items/${ID}/preview/3?v=2`);
});
