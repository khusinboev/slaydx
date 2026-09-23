import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues, ToolConfig } from "../lib/types.ts";
import { normalizeWorkPages, workKindOf } from "../lib/generation/work/registry.ts";
import { workGenreOfTool } from "../lib/generation/work/types.ts";
import { pagesOf as essayPagesOf } from "../lib/generation/essay/input.ts";
import { glossaryTermCount } from "../lib/generation/teacher/input.ts";

/**
 * C12 (P2, BEA-01 / ABUSE-03) — narx tariflari va dvigatel
 * normalizatsiyasi BIR MANBADAN bo'lishi kerak.
 *
 * Muammo: `priceFor` `pages`/`termCount`ni XOM satr sifatida, ANIQ
 * moslikka qidirardi (bo'sh joy — moslik yo'q → eng arzon tarif),
 * dvigatel esa uni kesib (`.trim()`) va klamp qilib o'qirdi (noma'lum
 * qiymat → YUQORIROQ standart tarif). Natijada `"40-45 "` (oxirida
 * bo'sh joy) 12 000 tangaga (10–15 bet tarifi) sotib olinar, dvigatel
 * esa 40–45 betlik ish (24 000 tanga) yozardi.
 *
 * Tuzatish: `priceFor` endi AYNAN dvigatel chaqiradigan normalizator-
 * larni chaqiradi — `normalizeWorkPages` (kurs ishi/referat/mustaqil
 * ish), essay `pagesOf`, glossariy `glossaryTermCount`. Kanonik
 * standart narx TEGILMAYDI, faqat xato/yaqin/kesilishi kerak bo'lgan
 * qiymatlar tuzatiladi.
 *
 * `pages`/`termCount` BERILMAGAN holat (R1, `audit/reviews/W3-J.md`):
 * insho/glossariy uchun `essayPagesOf`/`glossaryTermCount` o'zi standart
 * qiymatga tushadi (dvigatel bilan bir xil). Kurs ishi/referat/mustaqil
 * ishda `pages` XOM (`?? defaultPages` bilan TO'LDIRMASDAN) dvigatelning
 * `normalizeWorkPages`iga uzatiladi — `work/input.ts` bilan AYNAN bir
 * xil chaqiruv. Bu referat/mustaqil ishda `defaultPages(id)` («10-15»,
 * FORMA HOLATI) dan farqli natija beradi: bo'sh/`null` so'rov endi
 * dvigatel reyestr standarti — «20-25» (5 000) — narxida, 3 000 EMAS.
 * Bu TEGILMAYDI kanonik ro'yxatga kirmaydi: `WorkComposer.tsx` HAR
 * DOIM `pages`ni aniq yuboradi, bo'sh so'rov faqat qo'lda yozilgan
 * (API) so'rovdan keladi — pastdagi differensial `CASES`da.
 */

function workPrice(toolId: "coursework" | "referat" | "mustaqil-ish", raw: unknown): number {
  const genre = workGenreOfTool(toolId)!;
  const kind = workKindOf(genre, undefined);
  const pages = normalizeWorkPages(kind, raw);
  return priceFor(TOOL_BY_ID[toolId], { pages });
}

/* ────────────────────────── 1) Kanonik narxlar — SNAPSHOT ────────────────────────── */

/**
 * Har vosita/har kanonik variant uchun BUGUNGI narx — sonlar qattiq
 * yozilgan (dinamik hisoblanmagan), aks holda snapshot o'zi bilan
 * solishtirilib hech narsani qulflamas edi. Tuzatishdan OLDIN ham,
 * KEYIN ham bu test AYNAN shu sonlarni kutadi.
 */
const CANONICAL_SNAPSHOT: [ToolConfig, FormValues, number][] = [
  // Kurs ishi — 7 tarif.
  [TOOL_BY_ID.coursework, { pages: "10-15" }, 12000],
  [TOOL_BY_ID.coursework, { pages: "15-20" }, 14000],
  [TOOL_BY_ID.coursework, { pages: "20-25" }, 16000],
  [TOOL_BY_ID.coursework, { pages: "25-30" }, 18000],
  [TOOL_BY_ID.coursework, { pages: "30-35" }, 20000],
  [TOOL_BY_ID.coursework, { pages: "35-40" }, 22000],
  [TOOL_BY_ID.coursework, { pages: "40-45" }, 24000],
  [TOOL_BY_ID.coursework, {}, 16000], // standart — `defaultPages("coursework")` = "20-25"
  // Referat — 4 tarif.
  [TOOL_BY_ID.referat, { pages: "10-15" }, 3000],
  [TOOL_BY_ID.referat, { pages: "15-20" }, 4000],
  [TOOL_BY_ID.referat, { pages: "20-25" }, 5000],
  [TOOL_BY_ID.referat, { pages: "25-30" }, 6000],
  // Mustaqil ish — referat bilan bir xil jadval.
  [TOOL_BY_ID["mustaqil-ish"], { pages: "10-15" }, 3000],
  [TOOL_BY_ID["mustaqil-ish"], { pages: "15-20" }, 4000],
  [TOOL_BY_ID["mustaqil-ish"], { pages: "20-25" }, 5000],
  [TOOL_BY_ID["mustaqil-ish"], { pages: "25-30" }, 6000],
  // Diqqat: referat/mustaqil-ish `{}` bu ro'yxatda YO'Q — real forma
  // (`WorkComposer.tsx`) HAR DOIM `pages` yuboradi, bo'sh so'rov faqat
  // qo'lda yozilgan API chaqiruvi; narxi endi (R1) dvigatel standartiga
  // mos — pastdagi differensial `CASES`da tekshiriladi.
  // Insho — 1..5 varaq.
  [TOOL_BY_ID.essay, { pages: "1" }, 2000],
  [TOOL_BY_ID.essay, { pages: "2" }, 2500],
  [TOOL_BY_ID.essay, { pages: "3" }, 3000],
  [TOOL_BY_ID.essay, { pages: "4" }, 3500],
  [TOOL_BY_ID.essay, { pages: "5" }, 4000],
  [TOOL_BY_ID.essay, {}, 2500], // standart — `defaultPages("essay")` = "2"
  // Glossariy — 10/20/40 atama.
  [TOOL_BY_ID.glossary, { termCount: "10" }, 6000],
  [TOOL_BY_ID.glossary, { termCount: "20" }, 9000],
  [TOOL_BY_ID.glossary, { termCount: "40" }, 15000],
  [TOOL_BY_ID.glossary, {}, 6000], // standart — hech qanday tur tanlanmasa 10 talik tarif
];

test("kanonik narxlar — tuzatishdan keyin ham AYNAN bugungi qiymat (snapshot)", () => {
  for (const [tool, values, want] of CANONICAL_SNAPSHOT) {
    assert.equal(priceFor(tool, values), want, `${tool.id} ${JSON.stringify(values)}`);
  }
});

/* ─────────────── 2) Differensial jadval — xato/kesilgan/yaqin qiymatlar ─────────────── */

type Case = { tool: ToolConfig; raw: FormValues; engineTier: FormValues; label: string };

const CASES: Case[] = [
  // Kurs ishi: oxirida bo'sh joy — BEA-01 ning aynan o'zi (12 000 emas, 24 000).
  { tool: TOOL_BY_ID.coursework, raw: { pages: "40-45 " }, engineTier: { pages: "40-45" }, label: "coursework: oxirida bo'sh joy" },
  { tool: TOOL_BY_ID.coursework, raw: { pages: "\t40-45\n" }, engineTier: { pages: "40-45" }, label: "coursework: tab/yangi qator" },
  // Noma'lum/soxta qiymat — dvigatel "20-25" standartiga tushadi, narx ham shunga.
  { tool: TOOL_BY_ID.coursework, raw: { pages: "zzz" }, engineTier: { pages: "20-25" }, label: "coursework: noma'lum satr" },
  { tool: TOOL_BY_ID.coursework, raw: { pages: "43" }, engineTier: { pages: "20-25" }, label: "coursework: yaqin (lekin tarifda yo'q) son" },
  // Referat / mustaqil ish: xuddi shu naqsh.
  { tool: TOOL_BY_ID.referat, raw: { pages: "25-30 " }, engineTier: { pages: "25-30" }, label: "referat: oxirida bo'sh joy" },
  { tool: TOOL_BY_ID.referat, raw: { pages: "yo'q-bunday" }, engineTier: { pages: "20-25" }, label: "referat: noma'lum satr" },
  { tool: TOOL_BY_ID["mustaqil-ish"], raw: { pages: " 25-30" }, engineTier: { pages: "25-30" }, label: "mustaqil-ish: boshida bo'sh joy" },
  /*
   * R1 (`audit/reviews/W3-J.md`): `pages` BERILMAGAN/`null` — faqat
   * qo'lda yozilgan so'rovdan keladi (forma doim `pages` yuboradi).
   * Dvigatel `normalizeWorkPages(kind, undefined)` bilan «20-25»
   * standartiga tushadi — narx ham endi shunga mos (5 000), 3 000 EMAS.
   */
  { tool: TOOL_BY_ID.referat, raw: {}, engineTier: { pages: "20-25" }, label: "referat: pages berilmagan" },
  { tool: TOOL_BY_ID.referat, raw: { pages: null }, engineTier: { pages: "20-25" }, label: "referat: pages null" },
  { tool: TOOL_BY_ID["mustaqil-ish"], raw: {}, engineTier: { pages: "20-25" }, label: "mustaqil-ish: pages berilmagan" },
  { tool: TOOL_BY_ID["mustaqil-ish"], raw: { pages: null }, engineTier: { pages: "20-25" }, label: "mustaqil-ish: pages null" },
];

test("differensial jadval: priceFor(xom) === priceFor(dvigatel normallashtirgan qiymat)", () => {
  const failures: string[] = [];
  for (const c of CASES) {
    const a = priceFor(c.tool, c.raw);
    const b = priceFor(c.tool, c.engineTier);
    if (a !== b) failures.push(`${c.label}: priceFor(xom)=${a} !== priceFor(tarif)=${b}`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("kurs ishi: priceFor AYNAN `normalizeWorkPages` chaqirgan qiymatni ishlatadi", () => {
  // "40-45 " kesilib "40-45" bo'ladi — 24 000, 12 000 EMAS.
  assert.equal(priceFor(TOOL_BY_ID.coursework, { pages: "40-45 " }), workPrice("coursework", "40-45 "));
  assert.equal(priceFor(TOOL_BY_ID.coursework, { pages: "40-45 " }), 24000);
  // "zzz" — dvigatel "20-25" ga tushadi — 16 000, 12 000 EMAS (`tool.basePrice` fallback).
  assert.equal(priceFor(TOOL_BY_ID.coursework, { pages: "zzz" }), workPrice("coursework", "zzz"));
  assert.equal(priceFor(TOOL_BY_ID.coursework, { pages: "zzz" }), 16000);
});

test("referat/mustaqil ish: yaqin/kesilgan qiymatlar dvigatel bilan bir xil narx oladi", () => {
  assert.equal(priceFor(TOOL_BY_ID.referat, { pages: "25-30 " }), workPrice("referat", "25-30 "));
  assert.equal(priceFor(TOOL_BY_ID.referat, { pages: "25-30 " }), 6000);
  assert.equal(priceFor(TOOL_BY_ID["mustaqil-ish"], { pages: " 25-30" }), workPrice("mustaqil-ish", " 25-30"));
});

test("referat/mustaqil ish: pages berilmagan/null — 5 000 (20-25 tarifi), 3 000 EMAS (R1)", () => {
  // Faqat qo'lda yozilgan so'rovga tegishli — `WorkComposer.tsx` HAR DOIM `pages` yuboradi.
  for (const tool of [TOOL_BY_ID.referat, TOOL_BY_ID["mustaqil-ish"]] as const) {
    assert.equal(priceFor(tool, {}), 5000, `${tool.id}: pages berilmagan`);
    assert.equal(priceFor(tool, { pages: null }), 5000, `${tool.id}: pages null`);
    assert.equal(priceFor(tool, {}), workPrice(tool.id as "referat" | "mustaqil-ish", undefined));
    assert.notEqual(priceFor(tool, {}), 3000, "MUTATSIYA: eski 'defaultPages bilan to'ldirish' xatosi qaytdi");
  }
});

test("insho: pagesOf bilan bir xil klamp — '5 ', '99', '4.6' hammasi 5 varaq narxida", () => {
  const essay = TOOL_BY_ID.essay;
  for (const raw of ["5 ", "99", "4.6", " 5"]) {
    assert.equal(priceFor(essay, { pages: raw }), priceFor(essay, { pages: String(essayPagesOf(raw)) }), `pages="${raw}"`);
    assert.equal(priceFor(essay, { pages: raw }), 4000, `pages="${raw}" → 5 varaq narxi kutilgan`);
  }
});

test("glossariy: termCount='39' 40 talik tarifda (15 000), 6 000 EMAS", () => {
  const g = TOOL_BY_ID.glossary;
  assert.equal(priceFor(g, { termCount: "39" }), 15000);
  assert.equal(priceFor(g, { termCount: "40 " }), 15000, "oxirida bo'sh joy bilan ham");
  assert.equal(priceFor(g, { termCount: 21 }), 15000, "son sifatida ham (string emas)");
  assert.equal(priceFor(g, { termCount: "11" }), 9000, "11 — 20 talik tarifga chegaralanadi (ceil)");
  // Tur bo'yicha standart ham hisobga olinadi: "imtihon-atamalari" termsDefault 20.
  assert.equal(
    priceFor(g, { glossaryType: "imtihon-atamalari" }),
    priceFor(g, { glossaryType: "imtihon-atamalari", termCount: String(glossaryTermCount({ glossaryType: "imtihon-atamalari" })) }),
  );
  assert.equal(priceFor(g, { glossaryType: "imtihon-atamalari" }), 9000);
});

/* ─────────────── 3) Byudjet — R2: `budgetFor` ham bir manbadan ─────────────── */

test("byudjet: kurs ishi/referat/mustaqil-ish `normalizeWorkPages` bilan bir manbadan (R2)", async () => {
  const { budgetFor, workBudgetMs } = await import("../lib/generation/budget.ts");
  const { pagesMid } = await import("../lib/generation/work/registry.ts");
  const { DEFAULT_JOB_TIMEOUT_MS } = await import("../lib/server/env.ts");

  /*
   * Triage (`verify-money.md` band 3 / review §5): `pages` berilmagan
   * referat ilgari `extractMeta`ning "10-15" (13 bet) fallbacki bilan
   * 357 000 ms byudjet olardi, dvigatel esa "20-25" (22 bet, 447 000 ms
   * kerak) yozardi — narx to'g'ri bo'lsa ham (R1) ish MUDDAT
   * darvozasidan yiqilib, PULLIK ish bekor bo'lib qolar edi. Byudjet
   * endi SHU normalizatordan — narx bilan bir manbadan.
   */
  assert.ok(
    budgetFor(TOOL_BY_ID.referat, {}, DEFAULT_JOB_TIMEOUT_MS) >= workBudgetMs(pagesMid("20-25")),
    "referat: pages berilmagan byudjet 20-25 bet uchun yetarli bo'lishi kerak",
  );
  assert.ok(
    budgetFor(TOOL_BY_ID["mustaqil-ish"], { pages: null }, DEFAULT_JOB_TIMEOUT_MS) >= workBudgetMs(pagesMid("20-25")),
    "mustaqil-ish: pages null byudjet 20-25 bet uchun yetarli bo'lishi kerak",
  );
  // Kanonik tariflar — byudjet aynan bugungidek, dvigatel hajmiga to'g'ridan-to'g'ri mos.
  for (const pages of ["10-15", "15-20", "20-25", "25-30", "30-35", "35-40", "40-45"]) {
    assert.equal(
      budgetFor(TOOL_BY_ID.coursework, { pages }, DEFAULT_JOB_TIMEOUT_MS),
      workBudgetMs(pagesMid(pages)),
      `coursework ${pages}: byudjet o'zgarmasligi kerak`,
    );
  }
});
