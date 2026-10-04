import test from "node:test";
import assert from "node:assert/strict";
import type { FormValues } from "../lib/types.ts";
import { encodeEssayValues, essayInputFromValues, parseEpigraph } from "../lib/generation/essay/input.ts";

/**
 * INSHO KIRISHI (AUDIT-19 WP-D) — forma ↔ dvigatel.
 *
 * Mutatsiya: IELTS til majburlash olib tashlansa, kontekst–tur
 * mosligi tekshirilmasa yoki `pages` chegarasi (1–5) yo'qolsa —
 * quyidagi testlar qizaradi.
 */

const V = (o: FormValues = {}): FormValues => ({ topic: "Ona tilim", ...o });

test("standart qiymatlar — maktab konteksti, o'zbek tili, 2 varaq", () => {
  const input = essayInputFromValues(V());
  assert.equal(input.context, "school_dtm");
  assert.equal(input.kind, "reflective");
  assert.equal(input.language, "uz");
  assert.equal(input.pages, 2);
  assert.equal(input.person, "first", "maktab inshosi — 1-shaxs");
  assert.equal(input.design, "iris");
  assert.equal(input.wordTarget, 0, "varaq bilan o'lchanadigan kontekstda so'z maqsadi yo'q");
  assert.equal(input.epigraph, null);
  assert.equal(input.workTitle, "");
});

test("IELTS — til majburiy ingliz, hajm so'z bilan, 3-shaxs emas", () => {
  const input = essayInputFromValues(V({ essayContext: "ielts_task2", essayKind: "discussion", language: "uz", wordTarget: "900" }));
  assert.equal(input.language, "en", "IELTS faqat inglizcha (qaror 3)");
  assert.equal(input.kind, "discussion");
  assert.equal(input.wordTarget, 900, "kirish qiymatni saqlaydi — chegarani `essayWords` qo'yadi");
  assert.equal(input.person, "first");
});

test("kontekstga mos kelmaydigan tur birinchi turga tushadi", () => {
  // `opinion` — IELTS turi, maktab inshosida yo'q.
  assert.equal(essayInputFromValues(V({ essayContext: "school_dtm", essayKind: "opinion" })).kind, "reflective");
  // `literary` — akademikda ham bor, o'z joyida qoladi.
  assert.equal(essayInputFromValues(V({ essayContext: "academic", essayKind: "literary" })).kind, "literary");
  // Noma'lum kontekst — maktab inshosi.
  assert.equal(essayInputFromValues(V({ essayContext: "toefl" })).context, "school_dtm");
});

test("epigraf — «matn — Muallif» ajratiladi, alohida maydon ustun", () => {
  assert.deepEqual(parseEpigraph("So‘z — qalb kaliti — Alisher Navoiy"), { text: "So‘z — qalb kaliti", author: "Alisher Navoiy" });
  assert.deepEqual(parseEpigraph("Yaxshi kitob — do‘st", "Abdulla Qodiriy"), { text: "Yaxshi kitob — do‘st", author: "Abdulla Qodiriy" });
  assert.deepEqual(parseEpigraph("Muallifsiz iqtibos matni"), { text: "Muallifsiz iqtibos matni", author: "" });
  assert.equal(parseEpigraph(""), null);
});

test("epigraf va asar nomi — faqat ularni qabul qiladigan turda", () => {
  const literary = essayInputFromValues(V({ essayContext: "school_dtm", essayKind: "literary", workTitle: "Alpomish", epigraph: "So‘z — qalb kaliti — Navoiy" }));
  assert.equal(literary.workTitle, "Alpomish");
  assert.equal(literary.epigraph?.author, "Navoiy");
  // Mulohazali inshoda epigraf ham, asar ham so'ralmaydi — forma eski bo'lsa ham o'tmaydi.
  const reflective = essayInputFromValues(V({ essayContext: "school_dtm", essayKind: "reflective", workTitle: "Alpomish", epigraph: "So‘z — qalb kaliti — Navoiy" }));
  assert.equal(reflective.workTitle, "");
  assert.equal(reflective.epigraph, null);
});

test("varaq 1–5 ga qisiladi, shaxs formadan bekor qilinadi", () => {
  assert.equal(essayInputFromValues(V({ pages: "9" })).pages, 5);
  assert.equal(essayInputFromValues(V({ pages: "0" })).pages, 1);
  assert.equal(essayInputFromValues(V({ pages: "abc" })).pages, 2);
  assert.equal(essayInputFromValues(V({ essayContext: "academic", person: "first" })).person, "first", "forma kontekst standartini bekor qiladi");
  assert.equal(essayInputFromValues(V({ essayContext: "academic" })).person, "third");
  assert.equal(essayInputFromValues(V({ person: "nobody" })).person, "first");
});

test("encodeEssayValues — faqat berilgan maydonlar, kirish bilan aylanadi", () => {
  const values = encodeEssayValues({
    topic: "Kitob o‘qish",
    context: "academic",
    kind: "compare_contrast",
    language: "en",
    pages: 3,
    wordTarget: 800,
    epigraph: { text: "Words matter", author: "Anon" },
    design: "vintage",
    person: "third",
  });
  assert.equal(values.essayContext, "academic");
  assert.equal(values.essayKind, "compare_contrast");
  assert.equal(values.wordTarget, "800");
  assert.equal(values.epigraph, "Words matter");
  assert.equal(values.epigraphAuthor, "Anon");
  assert.ok(!("userFacts" in values), "berilmagan maydon yozilmaydi (qoralama ustiga chiqmasin)");

  const back = essayInputFromValues({ ...values });
  assert.equal(back.context, "academic");
  assert.equal(back.kind, "compare_contrast");
  assert.equal(back.language, "en");
  assert.equal(back.pages, 3);
  assert.equal(back.wordTarget, 800);
  assert.equal(back.design, "vintage");
  assert.equal(back.person, "third");
});

test("essayLevel (mobile sprint): b1/« C2 » parsed, junk/number/missing → B2, IELTS → null, round trip", () => {
  assert.equal(essayInputFromValues(V({ essayLevel: "b1" })).level, "B1");
  assert.equal(essayInputFromValues(V({ essayLevel: " C2 " })).level, "C2");
  assert.equal(essayInputFromValues(V({ essayLevel: "X9" })).level, "B2");
  assert.equal(essayInputFromValues(V({ essayLevel: 5 })).level, "B2");
  assert.equal(essayInputFromValues(V()).level, "B2", "owner decision O3: default B2");
  assert.equal(essayInputFromValues(V({ essayContext: "academic", essayLevel: "a2" })).level, "A2");
  // MUTATION: without the IELTS rule a stale «A1» from a school draft would reach the IELTS prompt.
  assert.equal(essayInputFromValues(V({ essayContext: "ielts_task2", essayLevel: "A1" })).level, null);

  const values = encodeEssayValues({ context: "academic", level: "C1" });
  assert.equal(values.essayLevel, "C1");
  assert.equal(essayInputFromValues(values).level, "C1");
  assert.equal(encodeEssayValues({ context: "ielts_task2", level: null }).essayLevel, "", "null encodes as empty");
  assert.ok(!("essayLevel" in encodeEssayValues({ topic: "x" })), "not given → not written");
});
