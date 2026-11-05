import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, basePriceFor } from "../lib/tools.ts";
import type { FormValues, ToolId } from "../lib/types.ts";
import { paramsAsFormValues, pickMarketParams } from "../lib/market/params.ts";
import { MARKET_TOOLS, MARKET_TOOL_IDS, MAX_COPIES_KEY, marketFamilyOf, requiredPurchaseFields } from "../lib/market/registry.ts";
import { buildSearchText, normalizeText, normalizeTopic, normalizeUniversity, searchTerms } from "../lib/market/normalize.ts";
import { classifySubject, MARKET_SUBJECTS } from "../lib/market/subjects.ts";
import { hasOwn } from "./helpers/market-own.mts";

/**
 * The tool registry, the params allow-list, the required title-page set and the text normalisation of the market.
 *
 * The key test: the price of a listing is computed from `params_json`, not from the source's `values_json`. A key missing
 * from the allow-list would silently sell every coursework at the cheapest tier, so the formula runs on both sides over
 * a grid of every price tier of every registry tool.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. "pages" removed from WORK_KEYS                      -> «the price survives»;
 *   2. "slideCount" removed from SLIDE_KEYS                -> «the price survives»;
 *   3. "articleType" removed from the thesis keys          -> «the price survives»;
 *   4. "essayContext" removed from the essay keys          -> «the price survives»;
 *   5. `isScalar` filter dropped from `pickMarketParams`   -> «unknown keys»;
 *   6. `"author"` added to WORK_KEYS                       -> «unknown keys»;
 *   7. `requiredPurchaseFields` returns [] always          -> «required fields»;
 *   8. normalizeText keeps apostrophes                     -> «one key for every spelling»;
 *   9. `resume` added to MARKET_TOOLS                      -> «never in the market».
 */

const GRID: Record<string, FormValues[]> = {
  slide: [4, 10, 20, 21, 25, 30].map((slideCount) => ({ slideCount })),
  "pro-slide": [4, 12, 30].map((slideCount) => ({ slideCount })),
  referat: ["10-15", "15-20", "20-25", "25-30"].map((pages) => ({ pages, workKind: "informative" })),
  "mustaqil-ish": ["10-15", "15-20", "20-25", "25-30"].map((pages) => ({ pages, workKind: "written" })),
  coursework: ["10-15", "20-25", "30-35", "40-45"].flatMap((pages) => [{ pages, workKind: "theory" }, { pages, workKind: "applied" }, { pages, kind: "project" }]),
  konspekt: ["5-10", "10-20", "20-30"].map((pages) => ({ pages })),
  essay: [
    ...[1, 2, 3, 4, 5].map((pages) => ({ essayContext: "school_dtm", pages })),
    ...[500, 750, 1000].map((wordTarget) => ({ essayContext: "academic", wordTarget, pages: 2 })),
    { essayContext: "ielts_task2", pages: 1 },
  ],
  thesis: [
    { articleType: "conference_thesis", pages: "1-2" },
    { articleType: "conference_extended", pages: "3-5" },
    { articleType: "conference_extended", pages: "1-2" },
  ],
  "lesson-plan": [{ lessonType: "yangi-mavzu", grade: 7 }, { grade: 5 }],
};

const PERSONAL: FormValues = { author: "X", university: "Y", teacher: "Z", email: "e", topic: "T", extra: "secret", sourceText: "", logoAssetId: "" };

test("the price survives the allow-list: base price from params == base price from the full values, on every tier", () => {
  for (const toolId of MARKET_TOOL_IDS) {
    const tool = TOOL_BY_ID[toolId];
    const grid = GRID[toolId];
    assert.ok(grid?.length, `grid for ${toolId}`);
    const prices = new Set<number>();
    for (const row of grid!) {
      const values = { ...PERSONAL, ...row };
      const stored = JSON.parse(JSON.stringify(pickMarketParams(toolId, values))) as unknown;
      const full = basePriceFor(tool, values);
      assert.equal(basePriceFor(tool, paramsAsFormValues(toolId, stored)), full, `${toolId} ${JSON.stringify(row)}`);
      prices.add(full);
    }
    if (toolId !== "lesson-plan") assert.ok(prices.size > 1, `${toolId}: the grid really walks several price tiers`);
  }
});

test("unknown keys: only the tool's list passes, whatever the form sent; stored junk is re-filtered on read", () => {
  const values = { ...PERSONAL, pages: "15-20", workKind: "informative", language: "uz", slideCount: 9, nested: { author: "X" } };
  assert.deepEqual(pickMarketParams("referat", values), { pages: "15-20", workKind: "informative", language: "uz" });
  assert.deepEqual(pickMarketParams("referat", { pages: { evil: 1 }, language: "" }), {});
  assert.deepEqual(paramsAsFormValues("referat", { pages: "15-20", author: "X", extra: "secret" }), { pages: "15-20" });
  for (const junk of [null, 5, "x", ["pages"]]) assert.deepEqual(paramsAsFormValues("referat", junk), {});
  assert.deepEqual(pickMarketParams("resume" as ToolId, { pages: "1" }), {}, "a tool outside the registry has no params at all");
});

test("the registry: the plan's nine tools, each with a family whose cap setting exists", () => {
  assert.deepEqual([...MARKET_TOOL_IDS].sort(), ["coursework", "essay", "konspekt", "lesson-plan", "mustaqil-ish", "pro-slide", "referat", "slide", "thesis"]);
  for (const id of MARKET_TOOL_IDS) {
    assert.ok(TOOL_BY_ID[id], `${id} is a real tool`);
    assert.match(MAX_COPIES_KEY[marketFamilyOf(id)!], /^market\.max_copies_/);
  }
  assert.equal(marketFamilyOf("konspekt"), "slides", "konspekt shares the slides cap (plan §1.1)");
  assert.equal(marketFamilyOf("thesis"), "thesis");
  assert.equal(marketFamilyOf("lesson-plan"), "teacher");
});

test("never in the market: personal, media and Studio tools", () => {
  for (const id of ["resume", "translation", "image", "portrait", "video", "podcast", "greeting", "studio-image", "studio-video", "studio-speech", "studio-voice", "article", "test", "keys", "glossary"]) {
    assert.ok(!hasOwn(MARKET_TOOLS, id), id);
  }
});

test("required fields: the tool's own contract, read from `missingRequired`", () => {
  for (const id of ["referat", "mustaqil-ish", "coursework", "lesson-plan"] as const) assert.deepEqual(requiredPurchaseFields(id), ["author", "university"], id);
  for (const id of ["slide", "pro-slide", "essay", "thesis", "konspekt"] as const) assert.deepEqual(requiredPurchaseFields(id), [], id);
});

test("one key for every spelling: scripts, apostrophes, case and punctuation meet", () => {
  const key = "ozbekiston tarixi";
  for (const v of ["Ўзбекистон тарихи", "O'zbekiston tarixi", "Oʻzbekiston  tarixi", "O‘zbekiston tarixi!", "O’ZBEKISTON TARIXI", "ozbekiston tarixi"]) {
    assert.equal(normalizeTopic(v), key, v);
  }
  assert.equal(normalizeText("  Tog'  --  bog' 2026 "), "tog bog 2026");
  assert.equal(normalizeUniversity("Toshkent davlat universiteti"), normalizeUniversity("ТОШКЕНТ ДАВЛАТ УНИВЕРСИТЕТИ"));
  assert.equal(normalizeUniversity("Toshkent davlat universiteti"), "toshkent");
  assert.notEqual(normalizeUniversity("Buxoro davlat universiteti"), normalizeUniversity("Toshkent davlat universiteti"));
});

test("search terms: one letter is no query; words only, at most 8; the raw text cannot reach a tsquery", () => {
  assert.equal(searchTerms("a"), null);
  assert.equal(searchTerms("  ' "), null);
  assert.deepEqual(searchTerms("Ўзбекистон  тарихи")?.terms, ["ozbekiston", "tarixi"]);
  assert.deepEqual(searchTerms("foo & bar | !baz:* (x)")?.terms, ["foo", "bar", "baz", "x"]);
  assert.equal(searchTerms("a b c d e f g h i j")?.terms.length, 8);
  assert.equal(buildSearchText({ title: "Ўзбекистон", summary: "Tarix", outline: ["Kirish"] }), "ozbekiston tarix kirish");
});

test("subjects: fixed 14 ids; keywords across scripts; the work's profile as a fallback; `boshqa` last", () => {
  assert.equal(MARKET_SUBJECTS.length, 14);
  assert.equal(classifySubject({ topic: "Kvadrat tenglamalarni yechish" }), "matematika");
  assert.equal(classifySubject({ topic: "Амир Темур даври тарихи" }), "tarix");
  assert.equal(classifySubject({ topic: "Python dasturlash asoslari" }), "informatika");
  assert.equal(classifySubject({ topic: "Soliq tizimi" }), "iqtisodiyot");
  assert.equal(classifySubject({ topic: "Bo'shliq", profile: "legal" }), "huquq");
  assert.equal(classifySubject({ topic: "Bo'shliq", subjectName: "Biologiya" }), "biologiya");
  assert.equal(classifySubject({ topic: "Yangi yil bayrami" }), "boshqa");
});
