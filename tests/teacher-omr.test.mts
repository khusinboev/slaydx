import test from "node:test";
import assert from "node:assert/strict";
import { OMR_MM, MM_PX, omrHeightMm, omrLabels, omrSvg } from "../lib/generation/figures/omr.ts";
import { buildFigure } from "../lib/generation/figures/index.ts";
import { omrCount, omrFigure, omrModelOf, omrSpecOf, omrUsable } from "../lib/generation/teacher/test/omr.ts";
import { buildVariants, normalizeQuestions } from "../lib/generation/teacher/test/questions.ts";
import { TEACHER_LIMITS } from "../lib/generation/teacher/types.ts";
import type { FigureSpec } from "../lib/generation/types.ts";

/**
 * OMR JAVOBLAR VARAG'I (AUDIT-20 WP-B) — maket va PNG.
 *
 * Mutatsiyalar (qizardi):
 *   1. `OMR_MM.radius` 2,6 → 1,2 — «doira radiusi» testi;
 *   2. `omrColumns` 10 o'rniga 20 savolni bir ustunga soldi —
 *      «40 savol 4 ustun» testi;
 *   3. `omrSpecOf` da `open` savollar ham sanaldi — «ochiq savol
 *      varaqqa tushmaydi» testi;
 *   4. `figures/index.ts` dagi omr shoxi PNG chizmay `figure` ni
 *      qaytardi — «PNG chiqadi» testi.
 */

const spec = (over: Partial<Extract<FigureSpec, { kind: "omr" }>> = {}): Extract<FigureSpec, { kind: "omr" }> => ({
  kind: "omr",
  count: 20,
  optionCount: 4,
  columns: 2,
  variantIds: ["A", "B"],
  idBoxes: 6,
  hasMulti: false,
  ...over,
});

test("o'lchovlar R3 §3.6 jadvalidan: r = 2,6 mm, qator 9 mm, qadam 8 mm, ustunda 10 savol", () => {
  assert.equal(OMR_MM.radius, 2.6, "MUTATSIYA: doira radiusi o'zgardi");
  assert.equal(OMR_MM.rowHeight, 9);
  assert.equal(OMR_MM.optionStep, 8);
  assert.equal(OMR_MM.markerSize, 6);
  assert.equal(OMR_MM.perColumn, TEACHER_LIMITS.omrPerColumn);
  assert.equal(OMR_MM.width, 180, "blanka kengligi 180 mm (standart 160 emas — R3 §6.1)");
  // 1 mm = 96/25.4 px: `figurePng(svg, { widthMm: 180 })` shu nisbatga tayanadi.
  assert.ok(Math.abs(MM_PX - 3.779) < 0.01, `MM_PX = ${MM_PX}`);
});

test("SVG: viewBox 180 mm kenglikda, doiralar soni = savol × variant", () => {
  const svg = omrSvg(spec({ count: 20, optionCount: 4, columns: 2 }));
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  assert.ok(vb, "viewBox yo'q");
  const wPx = Number(vb![1]);
  assert.ok(Math.abs(wPx - 180 * MM_PX) < 0.5, `kenglik ${wPx} px ≠ 180 mm`);
  assert.ok(Math.abs(Number(vb![2]) - omrHeightMm(spec({ count: 20 })) * MM_PX) < 0.5, `balandlik ${vb![2]} px`);

  const circles = svg.match(/<circle /g)?.length ?? 0;
  // 20 javob doirasi × 4 + variant (2) + test kodi (6 katak × 10 raqam).
  assert.equal(circles, 20 * 4 + 2 + 6 * 10, `doiralar soni: ${circles}`);
  // Registratsiya belgilari — uchta to'ldirilgan kvadrat.
  assert.equal(svg.match(/<rect [^>]*fill="#000"/g)?.length ?? 0, 3, "registratsiya kvadratlari yo'q");
  // Savol raqamlari 1…20 chiziladi.
  for (const n of [1, 10, 11, 20]) assert.ok(svg.includes(`>${n}</text>`), `${n}-savol raqami yo'q`);
  assert.ok(!svg.includes(">21</text>"), "ortiqcha savol raqami chizildi");
});

test("ustunlar: 40 savol → 4 ustun, 10 savol → 1 ustun (blanka bir betda qoladi)", () => {
  const wide = omrSvg(spec({ count: 40, columns: 4 }));
  assert.equal(wide.match(/<circle /g)!.length, 40 * 4 + 2 + 60);
  // MUTATSIYA-2: bitta ustunda 40 savol bo'lsa balandlik ikki barobar oshardi.
  assert.equal(omrHeightMm(spec({ count: 40 })), omrHeightMm(spec({ count: 10 })), "4 ustunli blanka balandligi 1 ustunlidan farq qilmasin");
  const narrow = omrSvg(spec({ count: 7, columns: 1, variantIds: ["A"] }));
  assert.equal(narrow.match(/<circle /g)!.length, 7 * 4 + 1 + 60);
  assert.ok(omrHeightMm(spec({ count: 7 })) < omrHeightMm(spec({ count: 10 })), "7 savolli blanka pastroq bo'lishi kerak");
});

test("variant va til: Ⓐ Ⓑ doiralari, ko'rsatmalar hujjat tilida", () => {
  const uz = omrSvg(spec({ variantIds: ["A", "B", "C", "D"] }), { lang: "uz" });
  assert.ok(uz.includes(">Variant:<"), "variant yorlig'i yo'q");
  for (const id of ["A", "B", "C", "D"]) assert.ok(uz.includes(`>${id}</text>`), `${id} varianti yo'q`);
  assert.ok(uz.includes("JAVOBLAR VARAG"), "sarlavha yo'q");
  assert.ok(uz.includes("Test kodi:"));

  const ru = omrSvg(spec(), { lang: "ru" });
  assert.ok(ru.includes("ЛИСТ ОТВЕТОВ"), "ruscha sarlavha yo'q");
  const en = omrSvg(spec(), { lang: "en" });
  assert.ok(en.includes("ANSWER SHEET"));
  // Til noma'lum bo'lsa — o'zbekcha (hujjat tili standarti).
  assert.equal(omrLabels("kaa").title, omrLabels("uz").title);
});

test("ko'p javobli savol bo'lsa ALOHIDA ko'rsatma satri chiqadi (S-10 qoidasi buzilmasin)", () => {
  const plain = omrSvg(spec({ hasMulti: false }));
  const multi = omrSvg(spec({ hasMulti: true }));
  assert.ok(!plain.includes("2 ta doira belgilanadi"), "ko'p javob izohi keraksiz joyda chiqdi");
  assert.ok(multi.includes("2 ta doira belgilanadi"), "ko'p javobli savol izohi yo'q");
  // DTM qoidasi (S-10) har ikkala holatda ham bor.
  for (const s of [plain, multi]) {
    assert.ok(s.includes("KO'K"), "ko'k siyoh qoidasi yo'q");
    assert.ok(s.includes("ball berilmaydi"), "ikkita doira qoidasi yo'q");
  }
});

test("spec modeldan quriladi: ochiq/moslik savollar varaqqa TUSHMAYDI", () => {
  const raw = [
    ...Array.from({ length: 12 }, (_, i) => ({
      kind: "single",
      stem: stemOf(i),
      options: ["birinchi javob", "ikkinchi javob", "uchinchi javob", "to'rtinchi javob"],
      answer: i % 4,
    })),
    { kind: "open", stem: "Nyutonning ikkinchi qonunini yozing va tushuntiring.", options: [], answer: "F = ma" },
    { kind: "multi", stem: "Quyidagilardan qaysilari metall hisoblanadi (2 ta javob)?", options: ["temir", "kislorod", "mis", "azot"], answer: [0, 2] },
  ];
  const { questions } = normalizeQuestions(raw, { grade: 9, count: 20, kinds: ["single", "open", "multi"] });
  assert.equal(questions.length, 14);
  // MUTATSIYA-3: `open` sanalsa 14 chiqardi.
  assert.equal(omrCount(questions), 13, "ochiq savol javob varag'iga tushdi");
  assert.ok(omrUsable(questions));

  const variants = buildVariants(questions, 2, "gen-omr");
  const s = omrSpecOf(questions, variants);
  assert.ok(s, "spec qurilmadi");
  assert.equal(s!.count, 13);
  assert.equal(s!.columns, 2);
  assert.equal(s!.optionCount, 4);
  assert.deepEqual(s!.variantIds, ["A", "B"]);
  assert.equal(s!.idBoxes, TEACHER_LIMITS.omrIdBoxes);
  assert.ok(s!.hasMulti, "ko'p javobli savol bayrog'i qo'yilmadi");

  // `TestModel.omr` — AYNI spec, `kind` siz (ikki joyda qo'lda yozilmaydi).
  assert.deepEqual(omrModelOf(s!), { count: 13, optionCount: 4, columns: 2, variantIds: ["A", "B"], idBoxes: 6, hasMulti: true });

  // Faqat ochiq savollardan iborat testda javob varag'i YO'Q.
  const openOnly = normalizeQuestions(
    [{ kind: "open", stem: "Fotosintez jarayonini bosqichma-bosqich tushuntiring.", options: [], answer: "javob" }],
    { grade: 9, count: 5, kinds: ["open"] },
  ).questions;
  assert.equal(omrSpecOf(openOnly, buildVariants(openOnly, 1, "g")), null);
  assert.ok(!omrUsable(openOnly));
});

test("40 dan ortiq savolda spec QURILMAYDI (omrFits — blanka bir betga sig'maydi)", () => {
  const many = normalizeQuestions(
    Array.from({ length: 45 }, (_, i) => ({
      kind: "single",
      stem: stemOf(i),
      options: ["a javobi", "b javobi", "c javobi", "d javobi"],
      answer: i % 4,
    })),
    { grade: 9, count: 45, kinds: ["single"] },
  ).questions;
  assert.equal(many.length, 45);
  assert.equal(omrSpecOf(many, buildVariants(many, 1, "g")), null, "41+ savolda blanka yasalmasligi kerak");
  assert.ok(omrSpecOf(many.slice(0, 40), buildVariants(many.slice(0, 40), 1, "g")));
});

test("buildFigure OMR ni PNG ga aylantiradi (sharp, 180 mm @ 300 dpi)", async () => {
  const fig = omrFigure(spec({ count: 20, columns: 2 }), "Javoblar varag'i");
  const out = await buildFigure(fig, { lang: "uz" });
  // MUTATSIYA-4: shox PNG chizmasa `url` bo'lmasdi.
  assert.ok(out.url?.startsWith("data:image/png;base64,"), "OMR PNG chizilmadi");
  assert.equal(out.w, Math.round((180 / 25.4) * 300), `kenglik ${out.w} px ≠ 180 mm @ 300 dpi`);
  assert.ok(out.h > out.w * 0.5 && out.h < out.w * 1.6, `balandlik nisbati g'alati: ${out.w}×${out.h}`);
  assert.ok(!out.fallbackBlocks, "OMR matn ro'yxatiga aylandi");
  assert.deepEqual(out.spec, fig.spec, "spec o'zgardi — qayta chizish buziladi");
});

/* ────────────────────────── yordamchi ────────────────────────── */

const WORDS = [
  "atom", "molekula", "kislota", "tenglama", "funksiya", "vektor", "hujayra", "gravitatsiya", "integral", "limit",
  "bosim", "tezlik", "kuchlanish", "reaksiya", "fotosintez", "sintaksis", "morfologiya", "iqlim", "relyef", "populyatsiya",
];

/** Bir-biriga O'XSHAMAGAN o'zaklar — aks holda dublikat filtri ularni yeb qo'yadi. */
export function stemOf(i: number): string {
  const w = (k: number) => WORDS[((i * k + k) % WORDS.length + WORDS.length) % WORDS.length];
  return `${i + 1}-topshiriq. ${w(1)} va ${w(7)} bilan ${w(13)} mavzusida ${i * 3 + 7} misol asosida qaysi javob to'g'ri?`;
}
