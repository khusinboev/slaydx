import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { slideLabels } from "../lib/generation/i18n.ts";
import { applyDocOps, inverseOps, parseDocOps, readSlideField, writeSlideField, FOOTER_MAX } from "../lib/generation/slide-edit.ts";
import { QUIZ_LETTERS } from "../lib/generation/slide-quiz.ts";
import { buildSlideDeck } from "../lib/generation/slides.ts";
import type { DocOp, EditRules } from "../lib/generation/slide-edit.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";

/**
 * P6 — V2 band: `footer` (deka darajasida kolontitul) va `answer`
 * (test javobini o'zgartirish) `DocOp`lari (`lib/generation/slide-edit.ts`).
 *
 * Naqsh `tests/slide-edit.test.mts` bilan bir xil: har qoida uchun
 * assertion + MUTATSIYA izohi (kodni ATAYLAB buzib, aynan shu test
 * ushlashi tekshirilgan).
 */

const GEN = "a1b2c3d4-0000-4000-8000-000000000002";
const ctx = { genId: GEN };
const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture" } as never);

function rawDoc(slides: SlideModel[]): AcademicDoc {
  return { meta, titlePage: true, toc: true, sections: [], slides, slideTemplate: "lecture" };
}

/** Hujjatni «kanonik» holatga keltiradi (`tests/slide-edit.test.mts` naqshi) — sections/renumber ham tayyor bo'lsin. */
function docOf(slides: SlideModel[]): AcademicDoc {
  const r = applyDocOps(rawDoc(slides), [{ op: "reorder", order: slides.map((_, i) => i) }], ctx);
  assert.equal(r.ok, true);
  return (r as { ok: true; doc: AcademicDoc }).doc;
}

function apply(doc: AcademicDoc, ops: DocOp[]): AcademicDoc {
  const r = applyDocOps(doc, ops, ctx);
  assert.equal(r.ok, true, r.ok ? "" : `kutilmagan xato: ${(r as { error: string }).error}`);
  return (r as { ok: true; doc: AcademicDoc }).doc;
}

function failure(doc: AcademicDoc, ops: DocOp[]): { error: string; at: number } {
  const r = applyDocOps(doc, ops, ctx);
  assert.equal(r.ok, false, "operatsiya rad etilishi kerak edi");
  return r as { ok: false; error: string; at: number };
}

const rules: EditRules = buildSlideDeck(rawDoc([{ id: "s0", layout: "bullets", title: "x" }])).bodyType;

// ═══════════════════════════════════════════ 1. `footer` op

const threeSlides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Muqova", footer: "Eski" },
  { id: "s1", layout: "bullets", title: "Bandlar", bullets: ["Bir."], footer: "Eski" },
  { id: "s2", layout: "closing", title: "Yakun" }, // footer'siz boshlangan — ham yozilishi kerak
];

test("footer op: BARCHA slaydlarning footer maydoniga yoziladi", () => {
  const doc = apply(rawDoc(threeSlides), [{ op: "footer", value: "Yangi kolontitul" }]);
  /*
   * MUTATSIYA: `applyDocOps`dagi "footer" case `slides = slides.map(...)`
   * o'rniga faqat `slides[0]`ni yangilasa (yoki `.map` "footer"ni "index"
   * bilan ishlaydigan boshqa oplar kabi bitta slaydga qo'llasa), shu
   * assertion — 3-slayd (asli footer'siz) — qizaradi.
   */
  for (const s of doc.slides!) assert.equal(s.footer, "Yangi kolontitul");
});

test("footer op: 120 belgidan uzun matn clipTo bilan qisqaradi", () => {
  const doc = apply(rawDoc(threeSlides), [{ op: "footer", value: "f".repeat(200) }]);
  assert.equal(doc.slides![0].footer?.length, FOOTER_MAX);
  assert.ok(doc.slides![0].footer!.endsWith("…"));
});

test("footer op: bo'sh qiymat — footer maydonining O'ZI o'chadi", () => {
  const doc = apply(rawDoc(threeSlides), [{ op: "footer", value: "" }]);
  for (const s of doc.slides!) assert.equal("footer" in s, false);
});

test("footer op: indeks/`add`/`reorder` kabi maxsus — chegara tekshiruvi kerak emas", () => {
  // "footer" da `index` yo'q — umumiy indeks darvozasi uni chegaradan tashqarida deb rad etmasligi kerak.
  const r = applyDocOps(rawDoc(threeSlides), [{ op: "footer", value: "X" }], ctx);
  assert.equal(r.ok, true);
});

test("footer op: inverseOps — OLDINGI qiymat bilan qaytaradi", () => {
  const doc = rawDoc(threeSlides);
  const ops: DocOp[] = [{ op: "footer", value: "Yangi" }];
  const inv = inverseOps(doc, ops, ctx);
  assert.deepEqual(inv, [{ op: "footer", value: "Eski" }]);

  const forward = apply(doc, ops);
  const back = apply(forward, inv);
  for (const s of back.slides!) assert.equal(s.footer, "Eski");
  /*
   * MUTATSIYA: `inverseOps`dagi footer branch `slides[0]?.footer` o'rniga
   * doim `""` qaytarsa, `back` dagi footer "Eski" emas, yo'qolgan bo'lardi
   * — yuqoridagi tsikl aynan shuni ushlaydi.
   */
});

test("footer op: aylanma tenglik — apply(apply(doc,ops), inverse) = doc (deka bir xil footer bilan boshlangan)", () => {
  // `footer` DEKA darajasida — teskarisi faqat `slides[0]` qiymatini eslaydi, ya'ni
  // to'liq aylanma tenglik boshlang'ich holat BIR XIL bo'lganda kafolatlanadi
  // (haqiqiy dekada shunday — `deckFooter` bir marta hisoblanib hammaga yoziladi).
  const uniform = threeSlides.map((s) => ({ ...s, footer: "Eski" }));
  const doc = docOf(uniform);
  const ops: DocOp[] = [{ op: "footer", value: "Boshqa matn" }];
  const back = apply(apply(doc, ops), inverseOps(doc, ops, ctx));
  assert.deepEqual(back, doc);
});

test("readSlideField: {f:'footer'} model qiymatini qaytaradi", () => {
  assert.equal(readSlideField(threeSlides[0], { f: "footer" }), "Eski");
  assert.equal(readSlideField(threeSlides[2], { f: "footer" }), null);
});

test("parseDocOps: footer op — «value» string bo'lishi shart", () => {
  const ok = parseDocOps([{ op: "footer", value: "Matn" }]);
  assert.ok(ok.ok && ok.ops[0].op === "footer");
  assert.equal(parseDocOps([{ op: "footer" }]).ok, false);
  assert.equal(parseDocOps([{ op: "footer", value: 5 }]).ok, false);
});

test("writeSlideField: {f:'footer'} — DEKA darajasida, bitta slaydga yozib bo'lmaydi", () => {
  const r = writeSlideField(threeSlides[0], { f: "footer" }, "Yangi", rules);
  assert.equal(r.ok, false);
  assert.match((r as { ok: false; error: string }).error, /footer op/);
});

test("{op:'text', src:{f:'footer'}} — applyDocOps ham xuddi shu xatoni qaytaradi", () => {
  // Klient xato o'rniga {op:"footer"} ishlatishi kerak — umumiy "text" yo'li orqali kirsa ham rad etilsin.
  const f = failure(rawDoc(threeSlides), [{ op: "text", index: 0, src: { f: "footer" }, value: "Yangi" }]);
  assert.match(f.error, /footer op/);
  assert.equal(f.at, 0);
});

// ═══════════════════════════════════════════ 2. `answer` op

/**
 * `finalizeQuiz` allaqachon o'tgan (izoh yozilgan, `answers` sarlavhasi
 * lokalizatsiya qilingan) realistik deka — aylanma tenglik testi shu
 * holatdan boshlanishi kerak, aks holda `rebuildAnswerKey`/
 * `refreshAnswerNote`ning "har chaqiruvda qayta yozish" xatti-harakati
 * (title/notes) sun'iy fixture bilan «diff» bo'lib ko'rinardi.
 */
function quizDoc(): AcademicDoc {
  const L = slideLabels(meta.language);
  const slides: SlideModel[] = [
    {
      id: "s0",
      layout: "quiz",
      title: "Test 1",
      quiz: [{ q: "Birinchi savol?", options: ["Bir", "Ikki", "Uch", "To‘rt"], answer: 0 }],
      notes: "Javob: A — Bir",
      footer: "F",
    },
    {
      id: "s1",
      layout: "quiz",
      title: "Test 2",
      quiz: [{ q: "Ikkinchi savol?", options: ["A", "B", "C", "D"], answer: 2 }],
      notes: "Javob: C — C",
      footer: "F",
    },
    {
      id: "s2",
      layout: "answers",
      title: L.answers,
      bullets: ["1 — A", "2 — C"],
      footer: "F",
    },
  ];
  return docOf(slides);
}

test("answer op: slides[index].quiz[q].answer yangilanadi", () => {
  const doc = apply(quizDoc(), [{ op: "answer", index: 0, q: 0, answer: 3 }]);
  assert.equal(doc.slides![0].quiz![0].answer, 3);
});

test("answer op: refreshAnswerNote — izoh yangi variantga mos", () => {
  const doc = apply(quizDoc(), [{ op: "answer", index: 0, q: 0, answer: 3 }]);
  assert.match(doc.slides![0].notes ?? "", new RegExp(`^Javob: ${QUIZ_LETTERS[3]} — To‘rt`));
});

test("answer op: `answers` slaydi QAYTA yig'iladi — yangi harf ko'rinadi", () => {
  const doc = apply(quizDoc(), [{ op: "answer", index: 0, q: 0, answer: 3 }]);
  const key = doc.slides!.find((s) => s.layout === "answers")!;
  /*
   * MUTATSIYA: "answer" case `rebuildAnswerKey(slides, lang)` chaqirig'i
   * olib tashlansa, `key.bullets[0]` eski "1 — A" bo'lib qolardi — shu
   * assertion buni ushlaydi.
   */
  assert.equal(key.bullets?.[0], "1 — D");
  assert.equal(key.bullets?.[1], "2 — C", "boshqa savolga tegilmagan");
});

test("answer op: bo'lmagan savol indeksi — 422 xato, hujjat o'zgarmaydi", () => {
  const f = failure(quizDoc(), [{ op: "answer", index: 0, q: 5, answer: 1 }]);
  assert.match(f.error, /savol yo'q/);
});

test("answer op: chegaradan tashqari javob (4..) — xato", () => {
  const f = failure(quizDoc(), [{ op: "answer", index: 0, q: 0, answer: 4 }]);
  assert.match(f.error, /Javob indeksi/);
  const f2 = failure(quizDoc(), [{ op: "answer", index: 0, q: 0, answer: -1 }]);
  assert.match(f2.error, /Javob indeksi/);
});

test("answer op: chegaradan tashqari slayd indeksi — umumiy darvoza ushlaydi", () => {
  const f = failure(quizDoc(), [{ op: "answer", index: 99, q: 0, answer: 1 }]);
  assert.match(f.error, /indeksi chegaradan tashqarida/);
});

test("answer op: inverseOps — ESKI javob bilan qaytaradi, `answers` slaydi ham tiklanadi", () => {
  const doc = quizDoc();
  const ops: DocOp[] = [{ op: "answer", index: 0, q: 0, answer: 3 }];
  const inv = inverseOps(doc, ops, ctx);
  assert.deepEqual(inv, [{ op: "answer", index: 0, q: 0, answer: 0 }]);

  const forward = apply(doc, ops);
  const back = apply(forward, inv);
  assert.equal(back.slides![0].quiz![0].answer, 0);
  const key = back.slides!.find((s) => s.layout === "answers")!;
  /*
   * MUTATSIYA: agar inverse `answer` op `applyDocOps` orqali qo'llanmasa
   * (masalan to'g'ridan-to'g'ri quiz maydoni yozilsa, `rebuildAnswerKey`
   * chaqirilmasa), `key.bullets[0]` "1 — D" bo'lib qolib, undo dan keyin
   * ham eski (noto'g'ri) kalit ko'rinardi.
   */
  assert.equal(key.bullets?.[0], "1 — A");
});

test("answer op: aylanma tenglik — apply(apply(doc,ops), inverse) = doc", () => {
  const doc = quizDoc();
  const ops: DocOp[] = [{ op: "answer", index: 1, q: 0, answer: 0 }];
  const back = apply(apply(doc, ops), inverseOps(doc, ops, ctx));
  assert.deepEqual(back, doc);
});

test("parseDocOps: answer op — index/q/answer son bo'lishi shart", () => {
  const ok = parseDocOps([{ op: "answer", index: 0, q: 0, answer: 2 }]);
  assert.ok(ok.ok && ok.ops[0].op === "answer");
  assert.equal(parseDocOps([{ op: "answer", index: 0, q: "0", answer: 2 }]).ok, false);
  assert.equal(parseDocOps([{ op: "answer", index: 0, q: 0, answer: "2" }]).ok, false);
  assert.equal(parseDocOps([{ op: "answer", q: 0, answer: 2 }]).ok, false, "«index» yo'q");
});

test("parseDocOps: answer op — manfiy q/answer rad etiladi (`num` 0..999 talab qiladi)", () => {
  /*
   * MUTATSIYA: `num()` faqat `v >= 0` ni tekshiradi — agar bu shart olib
   * tashlansa (masalan `Number.isInteger` yetarli deb hisoblansa), manfiy
   * `q`/`answer` parse bosqichidan o'tib ketardi (keyin `applyDocOps`da
   * `quiz?.[op.q]` `undefined` bo'lib "Bunday savol yo'q" bilan tutilardi —
   * lekin bu xato turi noto'g'ri, chegara PARSE bosqichida bo'lishi kerak).
   */
  assert.equal(parseDocOps([{ op: "answer", index: 0, q: -1, answer: 0 }]).ok, false);
  assert.equal(parseDocOps([{ op: "answer", index: 0, q: 0, answer: -1 }]).ok, false);
});
