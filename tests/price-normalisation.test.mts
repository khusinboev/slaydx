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
 * ish), essay `pagesOf`, glossariy `glossaryTermCount`. Standart
 * (`pages`/`termCount` berilmagan) holat `defaultPages()` orqali
 * TO'LDIRILADI (o'zgarmadi — bu forma ko'rsatadigan HAQIQIY standart,
 * `WorkComposer.tsx` `normalizeWorkPages(kind, defaultPages(id))`),
 * so'ng SHU QIYMAT normalizatordan o'tadi — ya'ni kanonik standart
 * narx TEGILMAYDI, faqat xato/yaqin/kesilishi kerak bo'lgan qiymatlar
 * tuzatiladi.
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
  [TOOL_BY_ID.referat, {}, 3000], // standart — `defaultPages("referat")` = "10-15"
  // Mustaqil ish — referat bilan bir xil jadval.
  [TOOL_BY_ID["mustaqil-ish"], { pages: "10-15" }, 3000],
  [TOOL_BY_ID["mustaqil-ish"], { pages: "15-20" }, 4000],
  [TOOL_BY_ID["mustaqil-ish"], { pages: "20-25" }, 5000],
  [TOOL_BY_ID["mustaqil-ish"], { pages: "25-30" }, 6000],
  [TOOL_BY_ID["mustaqil-ish"], {}, 3000],
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
