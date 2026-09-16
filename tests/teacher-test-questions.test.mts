import test from "node:test";
import assert from "node:assert/strict";
import {
  DUPLICATE_JACCARD,
  GRADE_SCALE,
  answerKeyFor,
  answerLabel,
  assignPoints,
  bloomAllowed,
  bloomCoverage,
  buildScoring,
  buildVariant,
  buildVariants,
  difficultyCounts,
  difficultyTargets,
  gradeForPercent,
  hashSeed,
  isBlanketOption,
  letterCounts,
  negationMarked,
  normalizeQuestions,
  normalizeQuote,
  omrColumns,
  omrFits,
  optionCountFor,
  shuffled,
  rng,
} from "../lib/generation/teacher/test/questions.ts";
import { DIFFICULTY_MIX } from "../lib/generation/teacher/registry.ts";
import type { TestQuestion } from "../lib/generation/teacher/types.ts";

/**
 * TEST SAVOLLARI — normalizatsiya, variantlar, kalit, ball (AUDIT-20 WP-B).
 *
 * Mutatsiyalar (har biri qizardi, keyin tuzatildi):
 *   1. `normalizeAnswer` da `single` uchun chegara tekshiruvi olib
 *      tashlandi (`answer: 7` o'tib ketdi) — «bitta to'g'ri javob» testi;
 *   2. `buildVariant` da harf aylanasi (`nextLetter`) o'rniga oddiy
 *      `shuffled` qo'yildi — «harf balansi ±1» testi;
 *   3. `answerKeyFor` `optionOrder` ni e'tiborsiz qoldirdi (asl
 *      indeksdan harf oldi) — «A/B kaliti variant tartibiga mos» testi;
 *   4. `difficultyTargets` eng katta qoldiq o'rniga `Math.round` —
 *      «yig'indi = count» testi;
 *   5. `isBlanketOption` dan «yuqoridagilarning barchasi» olib
 *      tashlandi — «blanket variant o'chadi» testi;
 *   6. `assignPoints` qoldiqni tarqatmadi — «bsb 50 ball» testi.
 */

const q = (over: Partial<Record<string, unknown>> = {}) => ({
  kind: "single",
  stem: "Fotosintez jarayonida o'simlik qaysi gazni yutadi?",
  options: ["kislorod", "karbonat angidrid", "azot", "vodorod"],
  answer: 1,
  difficulty: "orta",
  bloom: "apply",
  explanation: "O'simlik CO2 ni yutadi.",
  ...over,
});

const CTX = { grade: 9, count: 20, kinds: ["single", "truefalse", "multi", "open", "match"] as const };

test("normalizatsiya: o'zak/variant/javob tekshiriladi, buzuq savol TASHLANADI", () => {
  const { questions, dropped } = normalizeQuestions(
    [
      q(),
      q({ stem: "Qisqa" }), // o'zak 15 belgidan kalta
      q({ options: ["bitta", "ikkita"] }), // variant yetmaydi (9-sinf → 4)
      q({ answer: 7 }), // MUTATSIYA-1: chegaradan tashqari indeks
      // Ruxsat etilmagan tur (`kinds` da `open` yo'q) — savol tashlanadi.
      q({ kind: "open", stem: "Nyutonning ikkinchi qonunini isbotlab bering.", options: [], answer: "F = ma" }),
    ],
    { grade: 9, count: 10, kinds: ["single", "truefalse"] },
  );
  assert.equal(questions.length, 1, `qolgan savollar: ${JSON.stringify(questions.map((x) => x.stem))}`);
  assert.equal(dropped.stem, 1);
  assert.equal(dropped.options, 1);
  assert.equal(dropped.answer, 1, "MUTATSIYA: chegaradan tashqari javob indeksi o'tib ketdi");
  assert.equal(dropped.kind, 1);
  // Id lar uzluksiz (o'chirishdan keyin qayta raqamlanadi).
  assert.deepEqual(
    questions.map((x) => x.id),
    ["q1"],
  );
});

test("«hammasi to'g'ri» variantlari o'chadi; variant soni yetmasa savol tashlanadi", () => {
  assert.ok(isBlanketOption("Yuqoridagilarning barchasi"), "MUTATSIYA: blanket ro'yxati qisqardi");
  assert.ok(isBlanketOption("Hech biri"));
  assert.ok(isBlanketOption("All of the above"));
  assert.ok(isBlanketOption("A va B"));
  assert.ok(!isBlanketOption("karbonat angidrid"));

  const { questions, dropped, strippedOptions } = normalizeQuestions(
    [q({ options: ["kislorod", "karbonat angidrid", "azot", "Hammasi to'g'ri"] })],
    { ...CTX, count: 5 },
  );
  assert.equal(strippedOptions, 1, "blanket variant olib tashlanmadi");
  assert.equal(questions.length, 0, "4 variantdan bittasi tushib qolgach savol qolmasligi kerak");
  assert.equal(dropped.blanket, 1);
});

test("1–4-sinfda 3 variant, 5–11-sinfda 4 (S-19/S-10); DTM turi 4 ga qulflaydi", () => {
  assert.equal(optionCountFor({ grade: 3 }), 3);
  assert.equal(optionCountFor({ grade: 9 }), 4);
  assert.equal(optionCountFor({ grade: 3, optionCountFixed: 4 }), 4, "tur qat'iy 4 desa sinf shoxi bekor bo'ladi");

  const junior = normalizeQuestions([q({ options: ["a", "b", "c"] })], { grade: 2, count: 5, kinds: ["single"] });
  assert.equal(junior.questions.length, 1, "3 variantli savol 2-sinfda qabul qilinishi kerak");
  assert.equal(junior.questions[0].options.length, 3);
  const senior = normalizeQuestions([q({ options: ["a", "b", "c"] })], { grade: 9, count: 5, kinds: ["single"] });
  assert.equal(senior.questions.length, 0, "9-sinfda 3 variant yetarli emas");
});

test("dublikat o'zaklar (trigram Jaccard ≥ 0,8) tashlanadi", () => {
  const same = "Amir Temur qaysi shaharda tug'ilgan va o'sha shahar nomi nima edi?";
  const { questions, dropped } = normalizeQuestions([q({ stem: same }), q({ stem: same }), q({ stem: `${same} Javobni tanlang.` })], {
    ...CTX,
    count: 10,
  });
  assert.equal(questions.length, 1);
  assert.equal(dropped.duplicate, 2);
  assert.ok(DUPLICATE_JACCARD > 0.5 && DUPLICATE_JACCARD <= 0.9);
});

test("fayl rejimi: iqtibos manbada topilmasa savol O'CHIRILADI (R3 §3.8)", () => {
  const sourceText = "Hosila — funksiya orttirmasining argument orttirmasiga nisbatining limiti. Bu ta'rif X bobda berilgan.";
  const { questions, dropped } = normalizeQuestions(
    [
      q({ stem: "Hosila tushunchasi nimani bildiradi?", source: { quote: "funksiya orttirmasining argument  orttirmasiga nisbatining limiti" } }),
      q({ stem: "Integral nima ekanligini ayting?", source: { quote: "integral — bu yig'indi limiti" } }),
      q({ stem: "Limit tushunchasi nimani bildiradi?" }), // iqtibossiz
    ],
    { ...CTX, count: 10, sourceText },
  );
  assert.equal(questions.length, 1, "faqat manbada tasdiqlangan savol qolishi kerak");
  assert.equal(dropped.source, 2);
  // Tipografik farq (NBSP, apostrof, ikki probel) qiyoslashni buzmasin.
  assert.equal(normalizeQuote("Hosila — «ta’rif»"), normalizeQuote("hosila - \"ta'rif\""));
});

test("Bloom: evaluate/create FAQAT ochiq savolda; yopiqda tushiriladi", () => {
  assert.ok(bloomAllowed("evaluate", "open"));
  assert.ok(!bloomAllowed("evaluate", "single"));
  assert.ok(bloomAllowed("analyze", "single"));
  const { questions } = normalizeQuestions(
    [q({ bloom: "create", difficulty: "qiyin" }), q({ kind: "open", stem: "Nyutonning ikkinchi qonunini asoslang.", answer: "F = ma", bloom: "create" })],
    { ...CTX, count: 5 },
  );
  assert.equal(questions[0].bloom, "analyze", "yopiq savolda create qolib ketdi");
  assert.equal(questions[1].bloom, "create");
  assert.deepEqual(bloomCoverage(questions).sort(), ["analyze", "create"]);
});

test("qiyinlik taqsimoti: yig'indi = count, aralash 30/50/20", () => {
  const t20 = difficultyTargets(20, DIFFICULTY_MIX.aralash);
  assert.deepEqual(t20, { oson: 6, orta: 10, qiyin: 4 });
  // MUTATSIYA-4: `Math.round` da 7 savolda yig'indi 7 dan chiqib ketardi.
  for (const n of [5, 7, 10, 13, 15, 30, 40]) {
    for (const mix of Object.values(DIFFICULTY_MIX)) {
      const t = difficultyTargets(n, mix);
      assert.equal(t.oson + t.orta + t.qiyin, n, `n=${n}: yig'indi ${JSON.stringify(t)}`);
    }
  }
  const dtm = difficultyTargets(30, DIFFICULTY_MIX.dtm);
  assert.deepEqual(dtm, { oson: 6, orta: 18, qiyin: 6 }, "DTM 20/60/20");
});

test("qiyinlik hisobi hujjatdan qayta o'qiladi", () => {
  const { questions } = normalizeQuestions(
    [q({ difficulty: "oson" }), q({ stem: "Suv molekulasi qanday atomlardan tashkil topgan?", difficulty: "qiyin" })],
    { ...CTX, count: 5 },
  );
  assert.deepEqual(difficultyCounts(questions), { oson: 1, orta: 0, qiyin: 1 });
});

test("seeded aralashtirish TAKRORLANADI va kirishni o'zgartirmaydi", () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = shuffled(src, rng(hashSeed("gen-1:A")));
  const b = shuffled(src, rng(hashSeed("gen-1:A")));
  const c = shuffled(src, rng(hashSeed("gen-1:B")));
  assert.deepEqual(a, b, "bir xil urug' — bir xil tartib");
  assert.notDeepEqual(a, c, "boshqa urug' — boshqa tartib");
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8], "kirish massivi o'zgardi");
  assert.deepEqual([...a].sort((x, y) => x - y), src);
});

test("variantlar: bir xil savol to'plami, faqat tartib farqi (variantParity)", () => {
  const questions = mkQuestions(12);
  const [A, B] = buildVariants(questions, 2, "gen-42");
  assert.deepEqual([A.id, B.id], ["A", "B"]);
  for (const v of [A, B]) {
    assert.equal(v.order.length, questions.length);
    assert.deepEqual([...v.order].sort((x, y) => x - y), questions.map((_, i) => i), `${v.id}: savol to'plami buzildi`);
    assert.equal(v.optionOrder.length, questions.length, `${v.id}: optionOrder uzunligi`);
    v.optionOrder.forEach((perm, i) => {
      const qq = questions[v.order[i]];
      assert.deepEqual([...perm].sort((x, y) => x - y), qq.options.map((_, j) => j), `${v.id}/${i}: variant tartibi to'plami buzildi`);
    });
  }
  assert.notDeepEqual(A.order, B.order, "A va B savol tartibi bir xil chiqdi");
});

test("kalit HAR VARIANT uchun o'z tartibiga mos (keyMatchesVariants)", () => {
  const questions = mkQuestions(10);
  const variants = buildVariants(questions, 2, "gen-7");
  const key = answerKeyFor(questions, variants);
  assert.deepEqual(Object.keys(key), ["A", "B"]);
  for (const v of variants) {
    assert.equal(key[v.id].length, questions.length);
    v.order.forEach((qi, i) => {
      // MUTATSIYA-3: `optionOrder` e'tiborsiz qolsa bu tekshiruv qizaradi.
      const letter = key[v.id][i];
      const shownAt = "ABCD".indexOf(letter);
      assert.equal(v.optionOrder[i][shownAt], questions[qi].answer, `${v.id}/${i + 1}: kalit harfi noto'g'ri variantni ko'rsatdi`);
    });
  }
  assert.notDeepEqual(key.A, key.B, "ikki variant kaliti aynan bir xil chiqdi — aralashtirish ishlamadi");
});

test("to'g'ri javob harflari TEKIS taqsimlanadi (keyBalance ±1)", () => {
  const questions = mkQuestions(20);
  for (const seed of ["g1", "g2", "g3", "g4"]) {
    const v = buildVariant(questions, "A", hashSeed(seed));
    const counts = letterCounts(questions, v);
    const values = ["A", "B", "C", "D"].map((l) => counts[l] ?? 0);
    assert.equal(values.reduce((a, b) => a + b, 0), 20);
    // MUTATSIYA-2: oddiy aralashtirishda 20 savolda 9/2 taqsimot chiqardi.
    assert.ok(Math.max(...values) - Math.min(...values) <= 1, `${seed}: harf balansi ${JSON.stringify(counts)}`);
  }
});

test("javob yozuvi: single/truefalse/multi/open/match", () => {
  const single: TestQuestion = { ...mkQuestions(1)[0], answer: 2 };
  assert.equal(answerLabel(single, [3, 2, 0, 1]), "B", "asl 2-variant ikkinchi o'rinda → B");
  const tf: TestQuestion = { ...single, kind: "truefalse", options: ["To'g'ri", "Noto'g'ri"], answer: true };
  assert.equal(answerLabel(tf, [0, 1]), "A");
  assert.equal(answerLabel({ ...tf, answer: false }, [0, 1]), "B");
  const multi: TestQuestion = { ...single, kind: "multi", answer: [0, 2] };
  assert.equal(answerLabel(multi, [2, 1, 0, 3]), "A, C");
  const open: TestQuestion = { ...single, kind: "open", options: [], answer: "F = ma" };
  assert.equal(answerLabel(open, []), "—");
  const match: TestQuestion = { ...single, kind: "match", answer: [{ left: 0, right: 1 }, { left: 1, right: 0 }] };
  assert.equal(answerLabel(match, []), "1-B, 2-A");
});

test("truefalse tartibi ARALASHMAYDI — A doim «to'g'ri» (OMR ko'rsatmasi)", () => {
  const questions = normalizeQuestions(
    Array.from({ length: 6 }, (_, i) => q({ kind: "truefalse", stem: `Suv ${i} darajada muzlaydi degan fikr to'g'rimi?`, answer: i % 2 === 0 })),
    { ...CTX, count: 6 },
  ).questions;
  assert.equal(questions.length, 6);
  const v = buildVariant(questions, "A", hashSeed("tf"));
  v.optionOrder.forEach((perm, i) => assert.deepEqual(perm, [0, 1], `${i}: to'g'ri/noto'g'ri tartibi aralashdi`));
  v.order.forEach((qi, i) => assert.equal(answerLabel(questions[qi], v.optionOrder[i]), questions[qi].answer === true ? "A" : "B"));
});

test("ball: bsb 50 / chsb 40 ga AYNAN teng; ochiq topshiriq og'irroq", () => {
  const mixed = [
    ...mkQuestions(4),
    { ...mkQuestions(1)[0], id: "q5", kind: "open" as const, options: [], answer: "javob matni" },
    { ...mkQuestions(1)[0], id: "q6", kind: "open" as const, options: [], answer: "ikkinchi javob" },
  ];
  for (const total of [50, 40]) {
    const points = assignPoints(mixed, total);
    assert.equal(points.reduce((a, x) => a + x.points, 0), total, `MUTATSIYA: ${total} ball yig'indisi chiqmadi`);
    assert.ok(points[4].points > points[0].points, "ochiq topshiriq yopiqdan og'irroq bo'lishi kerak");
    for (const p of points) assert.ok(p.points >= 1, "0 ballik topshiriq bo'lmasin");
  }
  // `totalPoints: null` — har savol 1 ball (joriy nazorat).
  const flat = assignPoints(mixed, null);
  assert.deepEqual(flat.map((x) => x.points), [1, 1, 1, 1, 1, 1]);
  const scoring = buildScoring(assignPoints(mixed, 50), 50);
  assert.equal(scoring.total, 50);
  assert.equal(scoring.gradeScale.length, 4);
});

test("ball → baho jadvali 248-son buyruq bo'yicha (86/66/30)", () => {
  assert.deepEqual(GRADE_SCALE.map((b) => [b.minPercent, b.grade]), [[86, 5], [66, 4], [30, 3], [0, 2]]);
  assert.equal(gradeForPercent(100), 5);
  assert.equal(gradeForPercent(86), 5);
  assert.equal(gradeForPercent(85), 4);
  assert.equal(gradeForPercent(66), 4);
  assert.equal(gradeForPercent(65), 3);
  assert.equal(gradeForPercent(30), 3);
  assert.equal(gradeForPercent(29), 2);
  assert.equal(gradeForPercent(0), 2);
});

test("OMR sig'imi: ustunda 10 savol, ≤4 ustun ⇒ ≤40 savol", () => {
  assert.equal(omrColumns(10), 1);
  assert.equal(omrColumns(11), 2);
  assert.equal(omrColumns(40), 4);
  assert.equal(omrColumns(41), 5);
  assert.ok(omrFits(40));
  assert.ok(!omrFits(41));
  assert.ok(!omrFits(0));
});

test("inkor BOSH HARFDA ajratilgani aniqlanadi (S-18)", () => {
  assert.ok(negationMarked("Quyidagilardan qaysi biri suvda eriMAYDI?"));
  assert.ok(negationMarked("Qaysi javob NOTO'G'RI?"));
  assert.ok(!negationMarked("Quyidagilardan qaysi biri to'g'ri emas?"));
});

/* ────────────────────────── yordamchi ────────────────────────── */

const TOPICS = [
  "Fotosintez jarayonida qaysi gaz yutiladi",
  "Nyutonning ikkinchi qonuni qanday ifodalanadi",
  "Amir Temur qaysi shaharda tug'ilgan",
  "Suv molekulasi nechta atomdan iborat",
  "Hosila qanday geometrik ma'noga ega",
  "Integral yuzani hisoblashda qanday qo'llanadi",
  "Kislorod atomining valentligi nechaga teng",
  "O'zbekiston qaysi yilda mustaqillikka erishdi",
  "Kvadrat tenglama diskriminanti qanday topiladi",
  "Hujayra membranasi qanday vazifani bajaradi",
  "Elektr toki kuchi qanday birlikda o'lchanadi",
  "Adabiy asarda syujet qanday tuzilmaga ega",
  "Geografik kenglik qanday aniqlanadi",
  "Kimyoviy reaksiya tezligi nimaga bog'liq",
  "Gravitatsiya kuchi qanday formula bilan topiladi",
  "Bakteriyalar qanday ko'payadi va rivojlanadi",
  "Trigonometrik funksiyalar davri qanchaga teng",
  "Atmosfera bosimi qanday asbob bilan o'lchanadi",
  "Fe'l zamonlari o'zbek tilida nechta bo'ladi",
  "Vektorlarning skalyar ko'paytmasi nima beradi",
];

function mkQuestions(n: number): TestQuestion[] {
  const raw = Array.from({ length: n }, (_, i) => q({ stem: `${TOPICS[i % TOPICS.length]} (${i + 1})?`, answer: i % 4 }));
  const { questions } = normalizeQuestions(raw, { grade: 9, count: n, kinds: ["single"] });
  assert.equal(questions.length, n, "yordamchi savollar normalizatsiyadan o'tmadi");
  return questions;
}
