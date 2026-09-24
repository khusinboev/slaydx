import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import { essayInputFromValues } from "../lib/generation/essay/input.ts";
import { ESSAY_CONTEXTS, essayWords } from "../lib/generation/essay/registry.ts";
import { ESSAY_LIMITS } from "../lib/generation/essay/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * Insho narxi — so'z bilan o'lchanadigan kontekstda DVIGATEL yozadigan
 * hajmdan (W3-J sharhi, C12 bilan bir sinf; W4-E).
 *
 * Akademik esseda dvigatel hajmni `wordTarget` dan oladi (500–1 000 ga
 * qisiladi, `essayWords`), narx esa faqat `pages` dan edi:
 * `{essayContext: academic, pages: "1", wordTarget: 1000}` 2 000 turardi,
 * dvigatel esa 1 000 so'z (4 varaq, 3 500) yozardi. IELTS da esa hajm
 * qat'iy 250–330 — `pages: "5"` 4 000 olardi, dvigatel baribir 280 so'z
 * yozardi.
 *
 * MOLIYA QOIDASI: forma yuboradigan KANONIK qiymatlarning narxi aynan
 * o'zgarmaydi (quyidagi jadval — tuzatishdan OLDINGI narxlar surati).
 * Faqat noto'g'ri/tushirib qoldirilgan qiymatlar dvigatel yozadigan
 * hajmga ko'chadi.
 */

const essay = TOOL_BY_ID.essay;
const TABLE: Record<number, number> = { 1: 2000, 2: 2500, 3: 3000, 4: 3500, 5: 4000 };

/*
 * Kanonik kirishlar — `EssayComposer.toValues` (maktab: varaq 1–5; akademik:
 * `WORD_OPTIONS` 500/750/1000 va standart 700, `pages = pagesForWords(w)`;
 * IELTS: `pages = 1`) va narx yorliqlari (`{pages}`), hamda `{}`.
 * Narxlar — tuzatishdan OLDINGI `priceFor` natijasi (21 ta).
 */
const CANONICAL: Array<[FormValues, number]> = [
  [{ essayContext: "school_dtm", pages: "1", wordTarget: "" }, 2000],
  [{ essayContext: "school_dtm", pages: "2", wordTarget: "" }, 2500],
  [{ essayContext: "school_dtm", pages: "3", wordTarget: "" }, 3000],
  [{ essayContext: "school_dtm", pages: "4", wordTarget: "" }, 3500],
  [{ essayContext: "school_dtm", pages: "5", wordTarget: "" }, 4000],
  [{ essayContext: "academic", pages: "2", wordTarget: "500" }, 2500],
  [{ essayContext: "academic", pages: "3", wordTarget: "700" }, 3000],
  [{ essayContext: "academic", pages: "3", wordTarget: "750" }, 3000],
  [{ essayContext: "academic", pages: "4", wordTarget: "1000" }, 3500],
  [{ essayContext: "ielts_task2", pages: "1", wordTarget: "" }, 2000],
  [{ pages: "1" }, 2000],
  [{ pages: 1 }, 2000],
  [{ pages: "2" }, 2500],
  [{ pages: 2 }, 2500],
  [{ pages: "3" }, 3000],
  [{ pages: 3 }, 3000],
  [{ pages: "4" }, 3500],
  [{ pages: 4 }, 3500],
  [{ pages: "5" }, 4000],
  [{ pages: 5 }, 4000],
  [{}, 2500],
];

test("insho narxi: kanonik forma qiymatlari — narx AYNAN o'zgarmagan (21/21)", () => {
  let changed = 0;
  for (const [values, want] of CANONICAL) {
    const got = priceFor(essay, values);
    if (got !== want) changed++;
    assert.equal(got, want, JSON.stringify(values));
  }
  assert.equal(changed, 0);
});

/** Dvigatel yozadigan hajm → narx varag'i (dvigatelning O'Z funksiyalari bilan). */
function enginePages(values: FormValues): number {
  const input = essayInputFromValues(values);
  const spec = ESSAY_CONTEXTS[input.context];
  if (spec.sizing === "pages") return input.pages;
  if (input.context === "ielts_task2") return ESSAY_LIMITS.pagesMin;
  const aim = essayWords(input.context, { pages: input.pages, wordTarget: input.wordTarget }).aim;
  return Math.max(ESSAY_LIMITS.pagesMin, Math.min(ESSAY_LIMITS.pagesMax, Math.ceil(aim / ESSAY_LIMITS.academicWordsPerPage)));
}

test("insho narxi: akademik — narx `wordTarget` (dvigatel hajmi) dan, `pages` dan emas", () => {
  // MUTATSIYA: narx yana `pagesOf(values.pages)` dan olinsa — 2 000 bo'lib qoladi.
  assert.equal(priceFor(essay, { essayContext: "academic", pages: "1", wordTarget: "1000" }), 3500);
  assert.equal(priceFor(essay, { essayContext: "academic", pages: "5", wordTarget: "500" }), 2500);
  // Chegaradan tashqari so'z — dvigatel 500–1 000 ga qisadi, narx ham.
  assert.equal(priceFor(essay, { essayContext: "academic", pages: "1", wordTarget: "5000" }), 3500);
  assert.equal(priceFor(essay, { essayContext: "academic", pages: "4", wordTarget: "300" }), 2500);
  // `wordTarget` tushib qolgan: dvigatel `pages × 250` ni 500–1 000 ga qisadi.
  assert.equal(priceFor(essay, { essayContext: "academic", pages: "1" }), 2500);
  assert.equal(priceFor(essay, { essayContext: "academic", pages: "5" }), 3500);
});

test("insho narxi: IELTS — hajm qat'iy (250–330 so'z), `pages` narxni ko'tarmaydi", () => {
  for (const p of ["1", "2", "5", "99", ""]) {
    assert.equal(priceFor(essay, { essayContext: "ielts_task2", pages: p }), 2000, `pages="${p}"`);
  }
  assert.equal(priceFor(essay, { essayContext: "ielts_task2", pages: "5", wordTarget: "1000" }), 2000);
});

test("insho narxi: noto'g'ri/tushirilgan qiymatlar — narx dvigatel yozadigan hajmga teng (differensial)", () => {
  const ctxs = ["school_dtm", "academic", "ielts_task2", "zzz", undefined];
  const pagesVals: unknown[] = [undefined, null, "", " ", "0", "1", "3", "5", "5 ", "4.6", "99", "abc", "-3", 2.5];
  const wts: unknown[] = [undefined, "", "0", "abc", "300", "500", "600", "750", "1000", "1001", "2000", "-50", 1000, 450];
  let n = 0;
  for (const c of ctxs)
    for (const p of pagesVals)
      for (const w of wts) {
        const v: Record<string, unknown> = {};
        if (c !== undefined) v.essayContext = c;
        if (p !== undefined) v.pages = p;
        if (w !== undefined) v.wordTarget = w;
        const values = v as FormValues;
        assert.equal(priceFor(essay, values), TABLE[enginePages(values)], JSON.stringify(v));
        n++;
      }
  assert.ok(n > 900);
});
