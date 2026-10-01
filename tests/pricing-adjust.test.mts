import test from "node:test";
import assert from "node:assert/strict";
import type { FormValues } from "../lib/types.ts";
import {
  applyPriceAdjust,
  basePriceFor,
  clientAdjustedPrice,
  getClientPriceAdjust,
  isPriceAdjust,
  parsePriceAdjustments,
  priceFor,
  setClientPriceAdjustments,
  TOOL_BY_ID,
  TOOLS,
  type PriceAdjust,
} from "../lib/tools.ts";
import { ARTICLE_TYPES } from "../lib/generation/article/types-registry.ts";
import { COURSEWORK_PAGES } from "../lib/generation/work/registry.ts";
import { WORK_KIND_IDS } from "../lib/generation/work/types.ts";
import { ESSAY_CONTEXTS } from "../lib/generation/essay/registry.ts";

/**
 * Admin price adjustment, pure side (docs/admin/02-plan.md §17.2):
 * `applyPriceAdjust` rules, the validated client registry, and the guarantee
 * that with no adjustment `priceFor` is bit-for-bit the code formula for
 * every tool and every enumerable tier, in the browser and on the server.
 */

/** Runs `fn` as if in the browser (`priceFor` consults the client registry only there). */
function inBrowser<T>(fn: () => T): T {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const prev = g.window;
  g.window = {};
  try {
    return fn();
  } finally {
    if (had) g.window = prev;
    else delete g.window;
  }
}

test("applyPriceAdjust: no adjustment or 100 % is exactly the base (no rounding)", () => {
  for (const base of [0, 1, 999, 2000, 2500, 3333, 12_000, 199_000]) {
    assert.equal(applyPriceAdjust(base), base);
    assert.equal(applyPriceAdjust(base, null), base);
    for (const roundTo of [100, 500, 1000] as const) assert.equal(applyPriceAdjust(base, { percent: 100, roundTo }), base);
  }
});

test("applyPriceAdjust: scale, round to roundTo (half up), never below roundTo", () => {
  const cases: [number, PriceAdjust, number][] = [
    [3000, { percent: 120, roundTo: 500 }, 3500], // 3600 → 7.2 steps → 7
    [3000, { percent: 125, roundTo: 500 }, 4000], // 3750 → 7.5 steps → 8
    [2500, { percent: 150, roundTo: 1000 }, 4000], // 3750 → 3.75 → 4
    [2500, { percent: 90, roundTo: 100 }, 2300], // 2250 → 22.5 → 23
    [6000, { percent: 50, roundTo: 500 }, 3000],
    [2000, { percent: 1000, roundTo: 100 }, 20_000],
    [1000, { percent: 25, roundTo: 500 }, 500], // 250 → 0.5 → 1
    [100, { percent: 25, roundTo: 1000 }, 1000], // 25 → 0 steps → floor at roundTo
    [600, { percent: 25, roundTo: 100 }, 200], // 150 → 1.5 → 2
  ];
  for (const [base, adj, want] of cases) assert.equal(applyPriceAdjust(base, adj), want, `${base} ${JSON.stringify(adj)}`);
  for (let base = 500; base <= 30_000; base += 500) {
    for (const percent of [25, 80, 101, 333, 1000]) {
      for (const roundTo of [100, 500, 1000] as const) {
        const p = applyPriceAdjust(base, { percent, roundTo });
        assert.ok(Number.isSafeInteger(p) && p >= roundTo && p % roundTo === 0, `${base} ${percent} ${roundTo} → ${p}`);
      }
    }
  }
});

test("applyPriceAdjust: an out-of-bounds adjustment is ignored (base price)", () => {
  const bad = [
    { percent: 24, roundTo: 500 },
    { percent: 1001, roundTo: 500 },
    { percent: 0, roundTo: 500 },
    { percent: -50, roundTo: 500 },
    { percent: 50.5, roundTo: 500 },
    { percent: Number.NaN, roundTo: 500 },
    { percent: 120, roundTo: 250 },
    { percent: 120, roundTo: 0 },
    { percent: "120", roundTo: 500 },
  ] as unknown as PriceAdjust[];
  for (const adj of bad) {
    assert.equal(isPriceAdjust(adj), false, JSON.stringify(adj));
    assert.equal(applyPriceAdjust(3000, adj), 3000, JSON.stringify(adj));
  }
  assert.equal(isPriceAdjust({ percent: 25, roundTo: 100 }), true);
  assert.equal(isPriceAdjust({ percent: 1000, roundTo: 1000 }), true);
});

test("parsePriceAdjustments: only registry tools with valid, non-100 % entries", () => {
  assert.deepEqual(parsePriceAdjustments(undefined), {});
  assert.deepEqual(parsePriceAdjustments(null), {});
  assert.deepEqual(parsePriceAdjustments([]), {});
  assert.deepEqual(parsePriceAdjustments("x"), {});
  const parsed = parsePriceAdjustments({
    slide: { percent: 120, roundTo: 500, extra: "dropped" },
    essay: { percent: 100, roundTo: 1000 },
    image: { percent: 5, roundTo: 500 },
    nope: { percent: 120, roundTo: 500 },
    constructor: { percent: 120, roundTo: 500 },
    ["__proto__"]: { percent: 120, roundTo: 500 },
  });
  assert.deepEqual(parsed, { slide: { percent: 120, roundTo: 500 } });
});

test("client registry: invisible on the server, applied in the browser, change detection", (t) => {
  t.after(() => setClientPriceAdjustments({}));
  const slide = TOOL_BY_ID.slide;
  assert.equal(setClientPriceAdjustments({ slide: { percent: 150, roundTo: 1000 } }), true);
  assert.equal(setClientPriceAdjustments({ slide: { percent: 150, roundTo: 1000 } }), false, "same map → no change");

  // Server (no `window`): the registry is ignored — the server never relies on client state.
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  assert.equal(getClientPriceAdjust("slide"), undefined);
  assert.equal(priceFor(slide, { slideCount: 10 }), 3000);
  assert.equal(clientAdjustedPrice("slide", 3000), 3000);

  inBrowser(() => {
    assert.deepEqual(getClientPriceAdjust("slide"), { percent: 150, roundTo: 1000 });
    assert.equal(priceFor(slide, { slideCount: 10 }), 5000); // 4500 → 4.5 → 5 × 1000
    assert.equal(basePriceFor(slide, { slideCount: 10 }), 3000);
    assert.equal(clientAdjustedPrice("slide", 3000), 5000);
    // Other tools are untouched.
    assert.equal(priceFor(TOOL_BY_ID.image, { imageCount: 1 }), 2000);
    assert.equal(getClientPriceAdjust("image"), undefined);
  });

  assert.equal(setClientPriceAdjustments({ slide: { percent: 150, roundTo: 500 } }), true, "roundTo change is a change");
  assert.equal(setClientPriceAdjustments(null), true, "cleared");
  inBrowser(() => assert.equal(priceFor(slide, { slideCount: 10 }), 3000));
  assert.equal(setClientPriceAdjustments({ slide: { percent: 100, roundTo: 500 } }), false, "100 % = no adjustment");
});

/*
 * Inputs for the exhaustive equality check, built from the registries: every
 * option of every tool field, every article/thesis type × page package, every
 * work kind × page package, every essay context × pages × word target, and
 * sweeps over every numeric price driver (slides, images, terms, characters),
 * including malformed values the formula normalises.
 */
function enumerateValues(): FormValues[] {
  const out: FormValues[] = [{}];
  const pagesIds = new Set<string>(["", "0", "1", "2", "3", "4", "5", "6", "4.6", "99", " 5 ", "zzz", "40-45 "]);
  for (const id of COURSEWORK_PAGES) pagesIds.add(id);
  for (const type of Object.values(ARTICLE_TYPES)) for (const p of type.pages) pagesIds.add(p);
  for (const p of ["1-2", "3-5", "5-10", "10-15", "15-20", "20-25", "25-30"]) pagesIds.add(p);

  for (const tool of TOOLS) {
    for (const f of tool.fields) {
      for (const o of f.options ?? []) out.push({ [f.name]: o.value });
    }
  }
  for (const pages of pagesIds) out.push({ pages });
  for (const articleType of [...Object.keys(ARTICLE_TYPES), "", "bogus"]) {
    for (const pages of pagesIds) out.push({ articleType, pages });
    out.push({ articleType });
  }
  for (const workKind of [...WORK_KIND_IDS, "", "bogus"]) {
    for (const pages of pagesIds) out.push({ workKind, pages });
    out.push({ kind: workKind, pages: "40-45" });
  }
  for (const essayContext of [...Object.keys(ESSAY_CONTEXTS), "", "bogus"]) {
    for (const pages of ["", "1", "2", "3", "4", "5", "6", "x"]) {
      for (const wordTarget of [undefined, 0, 250, 400, 500, 650, 750, 900, 1000, 1200, "abc"]) {
        out.push(wordTarget === undefined ? { essayContext, pages } : { essayContext, pages, wordTarget });
      }
    }
  }
  for (let n = -1; n <= 45; n++) out.push({ slideCount: n }, { slideCount: String(n) });
  out.push({ slideCount: "abc" }, { slideCount: 2.5 }, { slideCount: 1e9 });
  for (let n = -1; n <= 8; n++) out.push({ imageCount: n }, { imageCount: String(n) });
  for (let n = -1; n <= 50; n++) out.push({ termCount: n }, { termCount: String(n) });
  for (const len of [0, 1, 7, 8, 9_999, 10_000, 10_001, 14_999, 15_000, 15_001, 50_000, 200_000]) {
    out.push({ sourceText: "a".repeat(len) });
    out.push({ sourceAssetId: "0123456789abcdef01234567", sourceChars: len });
  }
  out.push({ sourceAssetId: "0123456789abcdef01234567", sourceChars: "x" }, { price: 1, basePrice: 1 });
  return out;
}

test("no adjustment: priceFor equals the code formula for EVERY tool and enumerable tier (browser and server)", (t) => {
  t.after(() => setClientPriceAdjustments({}));
  const inputs = enumerateValues();
  assert.ok(inputs.length > 1000, `too few inputs: ${inputs.length}`);
  let checked = 0;
  const check = (label: string) => {
    for (const tool of TOOLS) {
      for (const values of inputs) {
        const base = basePriceFor(tool, values);
        const shown = priceFor(tool, values);
        if (shown !== base) assert.fail(`${label}: ${tool.id} ${JSON.stringify(values).slice(0, 120)} → ${shown} ≠ ${base}`);
        checked++;
      }
    }
  };

  setClientPriceAdjustments({});
  check("server, empty registry");
  inBrowser(() => check("browser, empty registry"));

  // A map that only contains 100 % entries is "no adjustment" for every tool.
  const all100 = Object.fromEntries(TOOLS.map((tool) => [tool.id, { percent: 100, roundTo: 1000 }]));
  setClientPriceAdjustments(all100);
  inBrowser(() => check("browser, all tools at 100 %"));

  // The server ignores the registry even when it is not empty.
  setClientPriceAdjustments(Object.fromEntries(TOOLS.map((tool) => [tool.id, { percent: 300, roundTo: 1000 }])));
  check("server, non-empty registry");
  assert.ok(checked > 4 * TOOLS.length * 1000);
});

test("an adjustment touches only its own tool; others stay at the formula", (t) => {
  t.after(() => setClientPriceAdjustments({}));
  const inputs = enumerateValues().filter((_, i) => i % 7 === 0);
  for (const target of TOOLS) {
    setClientPriceAdjustments({ [target.id]: { percent: 130, roundTo: 500 } });
    inBrowser(() => {
      for (const tool of TOOLS) {
        for (const values of inputs) {
          const base = basePriceFor(tool, values);
          const want = tool.id === target.id ? applyPriceAdjust(base, { percent: 130, roundTo: 500 }) : base;
          assert.equal(priceFor(tool, values), want, `${target.id} adjusted; ${tool.id} ${JSON.stringify(values).slice(0, 80)}`);
        }
      }
    });
  }
});
