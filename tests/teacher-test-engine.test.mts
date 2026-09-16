import test from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_SIZE,
  applyTestOps,
  assembleModel,
  buildTestDoc,
  criteriaFromRaw,
  gradeTable,
  keyTable,
  planBatches,
  planTestPolish,
  subjectIdOf,
  testDelivered,
  testSections,
  testUserNeeds,
  variantSection,
} from "../lib/generation/teacher/test/engine.ts";
import { testInputFromValues } from "../lib/generation/teacher/test/input.ts";
import { toGift } from "../lib/generation/teacher/test/export.ts";
import type { DocMeta, Figure } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * TEST DVIGATELI (AUDIT-20 WP-B) — mock `complete` bilan.
 *
 * Tarmoq ham, `sharp` ham chaqirilmaydi: LLM `complete` seam i bilan,
 * OMR PNG `buildFigures` seam i bilan, o'quv dasturi `topics` seam i
 * bilan almashtiriladi (`work/engine` naqshi).
 *
 * Mutatsiyalar (qizardi):
 *   1. `assembleModel` `assignPoints` ni chaqirmadi — «bsb 50 ball» testi;
 *   2. `applyTestOps` kalitni qayta hisoblamadi (eski `key` qoldi) —
 *      «sayqaldan keyin kalit yangilanadi» testi;
 *   3. `planBatches` ochiq topshiriqlarni bo'laklarga tarqatmadi —
 *      «ochiq topshiriq soni» testi;
 *   4. fayl rejimida `sourceText` normalizatsiyaga uzatilmadi —
 *      «manbasiz savol chiqmaydi» testi.
 */

/* ────────────────────────── mock ────────────────────────── */

const WORDS = ["atom", "molekula", "kislota", "tenglama", "funksiya", "vektor", "hujayra", "integral", "limit", "bosim", "tezlik", "reaksiya"];

function stemOf(i: number): string {
  const w = (k: number) => WORDS[(i * k + k) % WORDS.length];
  return `${i + 1}-topshiriq. ${w(1)} va ${w(5)} bilan ${w(7)} mavzusida ${i * 3 + 7} misol asosida qaysi javob to'g'ri?`;
}

type MockOpts = { open?: number; quote?: string; topicIds?: string[]; difficulty?: ("oson" | "orta" | "qiyin")[] };

/** Bitta bo'lak uchun «model javobi» — haqiqiy JSON shaklida. */
function mockQuestions(from: number, n: number, o: MockOpts = {}) {
  const questions = Array.from({ length: n }, (_, k) => {
    const i = from + k;
    const isOpen = k < (o.open ?? 0);
    const base = {
      stem: stemOf(i),
      difficulty: o.difficulty?.[k] ?? "orta",
      bloom: isOpen ? "evaluate" : "apply",
      explanation: `Bu savolda ${WORDS[i % WORDS.length]} tushunchasi tekshiriladi.`,
      points: 1,
      ...(o.quote ? { source: { quote: o.quote } } : {}),
      ...(o.topicIds?.length ? { topicId: o.topicIds[k % o.topicIds.length] } : {}),
    };
    return isOpen
      ? { ...base, kind: "open", answer: `Javob ${i}: to'liq yechim keltiriladi.`, rubric: [{ text: "Formula yozildi", points: 1 }, { text: "Javob topildi", points: 2 }] }
      : { ...base, kind: "single", options: [`${WORDS[i % 12]} javobi`, `${WORDS[(i + 1) % 12]} javobi`, `${WORDS[(i + 2) % 12]} javobi`, `${WORDS[(i + 3) % 12]} javobi`], answer: i % 4 };
  });
  return JSON.stringify({ questions });
}

type CallLog = { role: string; system: string; user: string };

/** Sarf telemetriyasi — `CostMeter` faqat `usage` bo'lgan chaqiruvni sanaydi. */
const USAGE = { provider: "gemini", model: "gemini-2.5-flash", inputTokens: 900, outputTokens: 1200 };

function mockComplete(o: MockOpts = {}) {
  const calls: CallLog[] = [];
  let at = 0;
  const fn = async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    if (role === "judge") return { text: JSON.stringify({ answerCorrectness: 3, clarity: 3, distractors: 2, coverage: 3, levelFit: 3, notes: ["yaxshi"], fixes: [] }), usage: USAGE };
    // Bo'lakdagi savollar soni promptdan o'qiladi («Write N items»).
    const n = Number(/Write (\d+) items/.exec(user)?.[1] ?? BATCH_SIZE);
    const open = Number(/Of these, (\d+) are OPEN/.exec(user)?.[1] ?? 0);
    const text = mockQuestions(at, n, { ...o, open });
    at += n;
    return { text, usage: USAGE };
  };
  return { fn, calls };
}

const META: DocMeta = { toolId: "test", topic: "Hosila va uning tatbiqlari", language: "uz", subject: "Matematika", grade: 11 } as DocMeta;

const VALUES = (over: FormValues = {}): FormValues => ({
  testType: "nazorat",
  mode: "topic",
  count: 20,
  variants: 2,
  omr: true,
  grade: 11,
  subject: "Matematika",
  topic: "Hosila va uning tatbiqlari",
  language: "uz",
  university: "15-son maktab",
  author: "Karimova Dilnoza",
  ...over,
});

const noFigures = async (f: Figure[]) => f.map((x) => ({ ...x, url: "data:image/png;base64,AAA", w: 2126, h: 1800 }));

const build = (values: FormValues, o: MockOpts = {}, extra: Record<string, unknown> = {}) => {
  const m = mockComplete(o);
  return buildTestDoc(META, values, {
    deadline: Date.now() + 300_000,
    complete: m.fn as never,
    buildFigures: noFigures,
    polish: false,
    seed: "gen-test",
    ...extra,
  }).then((r) => ({ ...r!, calls: m.calls }));
};

/* ────────────────────────── testlar ────────────────────────── */

test("buildTestDoc: 20 savol, 2 variant, kalit, OMR va hisobot", async () => {
  const { doc, cost } = await build(VALUES());
  const model = doc.teacher!.test!;
  assert.equal(doc.teacher!.kind, "test");
  assert.equal(model.questions.length, 20);
  assert.equal(model.variants.length, 2);
  assert.deepEqual(Object.keys(model.key), ["A", "B"]);
  assert.equal(model.key.A.length, 20);
  assert.equal(model.omr?.count, 20);
  assert.equal(model.omr?.columns, 2);
  assert.ok(doc.teacher!.figures?.[0]?.url, "OMR rasmi hujjatga tushmadi");
  assert.ok(doc.teacher!.review, "hisobot yo'q");
  assert.ok(doc.teacher!.review!.score > 0);
  assert.ok(cost.calls > 0, "CostMeter chaqiruvlarni sanamadi");
  // Ko'rsatma dvigateldan, LLM dan emas.
  assert.ok(model.instructions.some((l) => l.includes("45 daqiqa")), model.instructions.join(" | "));
});

test("savollar 10 talik bo'laklarda so'raladi, qiyinlik buyurtmasi promptda", async () => {
  const { calls } = await build(VALUES({ count: 30 }));
  const writer = calls.filter((c) => c.role === "writer");
  assert.equal(writer.length, 3, `30 savol → 3 bo'lak, chiqdi: ${writer.length}`);
  for (const c of writer) assert.match(c.user, /Write 10 items/);
  // Qiyinlik taqsimoti bo'laklarga tarqaladi (`aralash` 30/50/20).
  assert.ok(writer.some((c) => /easy/.test(c.user) && /medium/.test(c.user)), "qiyinlik buyurtmasi promptda yo'q");
  // Tizim prompti tur qoidalarini (reyestr `guidance`) olib keladi.
  assert.match(writer[0].system, /TYPE RULES/);
  assert.match(writer[0].system, /Regular class test/);
  assert.match(writer[0].system, /OUTPUT LANGUAGE: Uzbek/);
});

test("bo'lak rejasi: ochiq topshiriqlar bo'laklar bo'ylab tarqaladi", () => {
  const input = testInputFromValues(META, VALUES({ testType: "chsb", count: 20, openCount: 5, questionKinds: '["single","open"]' }));
  const asks = planBatches(input);
  assert.equal(asks.length, 2);
  assert.equal(asks.reduce((a, x) => a + x.n, 0), 20);
  // MUTATSIYA-3: tarqatilmasa birinchi bo'lakda 5, ikkinchisida 0 bo'lardi.
  assert.equal(asks.reduce((a, x) => a + x.open, 0), 5);
  for (const a of asks) assert.ok(a.open <= a.n);
  for (const a of asks) assert.equal(a.mix.oson + a.mix.orta + a.mix.qiyin, a.n, "bo'lak qiyinligi yig'indisi savol soniga teng emas");
});

test("bsb turi: ochiq topshiriq + mezon jadvali, jami AYNAN 50 ball", async () => {
  const { doc } = await build(VALUES({ testType: "bsb", count: 8, openCount: 5, questionKinds: '["single","open"]', criteriaTable: true }));
  const model = doc.teacher!.test!;
  assert.equal(model.scoring.total, 50);
  // MUTATSIYA-1: `assignPoints` chaqirilmasa yig'indi 8 bo'lardi.
  assert.equal(model.questions.reduce((a, q) => a + q.points, 0), 50);
  const open = model.questions.filter((q) => q.kind === "open");
  assert.ok(open.length >= 1, "ochiq topshiriq yo'q");
  assert.ok(open[0].points > model.questions.find((q) => q.kind === "single")!.points, "ochiq topshiriq og'irroq emas");
  assert.ok(model.criteria?.length, "mezon jadvali qurilmadi");
  for (const c of model.criteria!) assert.ok(model.questions.some((q) => q.id === c.taskRef), `mezon ${c.criterion} topshiriqqa bog'lanmagan`);
  // Mezon bo'limi hujjatda ham bor.
  assert.ok(doc.tables?.some((t) => t.id === "criteria"), "mezon jadvali hujjatga tushmadi");
  assert.ok(doc.sections.some((s) => s.id === "criteria"));
});

test("fayl rejimi: iqtibossiz savollar hujjatga TUSHMAYDI", async () => {
  const sourceText = "Hosila — funksiya orttirmasining argument orttirmasiga nisbatining limiti. Integral esa yig'indining limiti sifatida aniqlanadi.";
  const good = await build(
    VALUES({ mode: "file", count: 10 }),
    { quote: "funksiya orttirmasining argument orttirmasiga nisbatining limiti" },
    { sourceTextOf: async () => sourceText, source: { kind: "docx", bytes: new Uint8Array() } },
  );
  assert.equal(good.doc.teacher!.test!.questions.length, 10, "manbada tasdiqlangan savollar tushib qoldi");
  assert.ok(good.doc.teacher!.test!.questions.every((q) => q.source?.quote), "iqtibos saqlanmadi");
  // Tizim prompti «faqat manbadan» shartini olib keladi.
  assert.ok(good.calls.some((c) => /SOURCE MODE — HARD RULE/.test(c.user)), "manba bloki promptda yo'q");

  // MUTATSIYA-4: manba uzatilmasa quyidagi savollar ham o'tib ketardi.
  const bad = await build(
    VALUES({ mode: "file", count: 10 }),
    { quote: "manbada umuman yo'q bo'lgan uydirma iqtibos matni" },
    { sourceTextOf: async () => sourceText, source: { kind: "docx", bytes: new Uint8Array() } },
  );
  assert.equal(bad.doc, undefined, "manbasiz savollardan hujjat qurildi");
});

test("darslik rejimi: mavzular promptga tushadi, har savolda topicId", async () => {
  const topics = [
    { id: "hosila-1", title: "Hosila ta'rifi" },
    { id: "hosila-2", title: "Hosilaning geometrik ma'nosi" },
  ];
  const { doc, calls } = await build(
    VALUES({ mode: "curriculum", count: 10, topicIds: JSON.stringify(topics.map((t) => t.id)) }),
    { topicIds: topics.map((t) => t.id) },
    { topics: async () => topics },
  );
  assert.ok(calls.some((c) => /CURRICULUM MODE/.test(c.user)), "dastur bloki promptda yo'q");
  assert.ok(calls.some((c) => c.user.includes("[hosila-1] Hosila ta'rifi")), "mavzu id si promptda yo'q");
  const model = doc.teacher!.test!;
  assert.deepEqual(model.topicIds, ["hosila-1", "hosila-2"]);
  assert.ok(model.questions.every((q) => q.topicId), "topicId saqlanmadi");
  const cov = doc.teacher!.review!.checks.find((c) => c.id === "curriculumCoverage");
  assert.equal(cov?.level, "green", cov?.detail);
});

test("bo'limlar: ko'rsatma → variantlar → OMR → kalit → halollik izohi", async () => {
  const { doc } = await build(VALUES({ count: 10, variants: 2 }));
  const ids = doc.sections.map((s) => s.id);
  assert.deepEqual(ids, ["instructions", "variant-A", "variant-B", "omr", "key", "honesty"]);
  const a = doc.sections.find((s) => s.id === "variant-A")!;
  // Har savol `li` blok, variantlari ham.
  assert.ok(a.blocks.every((b) => b.kind === "li"), "savollar li blok emas");
  assert.ok(a.blocks.some((b) => /^1\. /.test(b.text)));
  assert.ok(a.blocks.some((b) => /^A\) /.test(b.text)));
  // Halollik izohi — «BSB uslubida», rasmiy emas (R3 §4.3).
  const honesty = doc.sections.find((s) => s.id === "honesty")!;
  assert.match(honesty.blocks[0].text, /Pedagogik mahorat va xalqaro baholash markazi/);
  // Kalit betida ogohlantirish.
  assert.match(doc.sections.find((s) => s.id === "key")!.blocks[0].text, /O'QITUVCHI UCHUN/);
  assert.ok(doc.tables?.some((t) => t.id === "key"));
  assert.ok(doc.tables?.some((t) => t.id === "grades"), "ball → baho jadvali yo'q");
});

test("DTM turi: 4 variant qat'iy, qiyinlik 20/60/20", async () => {
  const { doc } = await build(VALUES({ testType: "dtm", count: 30, grade: 3 }));
  const model = doc.teacher!.test!;
  // 3-sinf bo'lsa ham DTM turi 4 variantni QAT'IY belgilaydi.
  assert.ok(model.questions.every((q) => q.options.length === 4), "DTM da 4 variant bo'lishi shart");
  assert.equal(model.omr?.optionCount, 4);
  assert.equal(model.timeMin, 90, "DTM standart vaqti 90 daqiqa");
});

test("kalit jadvali va ball→baho jadvali modeldan hisoblanadi", () => {
  const input = testInputFromValues(META, VALUES({ count: 4, variants: 2 }));
  const questions = ["a", "b", "c", "d"].map((x, i) => ({
    id: `q${i + 1}`,
    kind: "single" as const,
    stem: `${stemOf(i)} ${x}`,
    options: ["bir", "ikki", "uch", "to'rt"],
    answer: i % 4,
    points: 1,
    bloom: "apply" as const,
    difficulty: "orta" as const,
    explanation: "izoh matni shu yerda",
  }));
  const model = assembleModel(questions, input, new Map(), "seed-1");
  const kt = keyTable(model, "uz");
  assert.deepEqual(kt.headers, ["№", "A-variant", "B-variant", "Ball", "Bloom", "Qiyinlik"]);
  assert.equal(kt.rows.length, 4);
  for (const v of model.variants) assert.deepEqual(model.key[v.id], kt.rows.map((r) => r[kt.headers.indexOf(`${v.id}-variant`)]));

  const gt = gradeTable(model.scoring.gradeScale, 20, "uz");
  assert.deepEqual(gt.rows.map((r) => r[2]), ["5", "4", "3", "2"]);
  assert.equal(gt.rows[0][1], "18–20", `86–100 % dan 20 ballda: ${gt.rows[0][1]}`);

  const sec = variantSection(model, model.variants[0], "uz");
  assert.equal(sec.id, "variant-A");
  assert.equal(sec.blocks.length, 4 * 5, "har savol 1 o'zak + 4 variant bloki");
});

test("sayqal: reja bitta fix ga birlashadi, op kalit bilan qayta quriladi", () => {
  const review = {
    score: 70,
    checks: [
      { id: "count", level: "green" as const, label: "Savollar soni" },
      { id: "difficultyMix", level: "red" as const, label: "Qiyinlik", fix: { op: "rewrite" as const, target: "questions", instruction: "Qiyinlikni to'g'rilang." } },
      { id: "stemLength", level: "yellow" as const, label: "Uzunlik", fix: { op: "rewrite" as const, target: "questions", instruction: "O'zaklarni qisqartiring." } },
      { id: "keyBalance", level: "red" as const, label: "Harf balansi" },
    ],
    judgeNotes: [],
    verifiedShare: 0,
    recentShare: 0,
    builtAt: "2026-09-16T00:00:00.000Z",
  };
  const plan = planTestPolish(review);
  assert.equal(plan.fixes.length, 1, "fix lar birlashmadi — parallel qayta yozish bir-birini yo'q qiladi");
  assert.match(plan.fixes[0].instruction, /Qiyinlikni to'g'rilang/);
  assert.match(plan.fixes[0].instruction, /O'zaklarni qisqartiring/);
  assert.deepEqual(plan.skipped, [{ id: "keyBalance", reason: "manual" }]);
});

test("applyTestOps kalit, ball va bo'limlarni QAYTA hisoblaydi", () => {
  const input = testInputFromValues(META, VALUES({ count: 4, variants: 2 }));
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `q${i + 1}`,
      kind: "single" as const,
      stem: stemOf(i),
      options: ["bir", "ikki", "uch", "to'rt"],
      answer: i % 4,
      points: 1,
      bloom: "apply" as const,
      difficulty: "orta" as const,
      explanation: "izoh matni shu yerda",
    }));
  const model = assembleModel(mk(4), input, new Map(), "seed-1");
  const doc = { meta: META, titlePage: true, toc: false, sections: [], tables: [], teacher: { v: 1 as const, kind: "test" as const, type: "nazorat", school: { institution: "", author: "", subject: "", grade: 11, language: "uz" }, test: model } };
  const res = applyTestOps(doc, [{ op: "questions", questions: mk(3).map((q) => ({ ...q, answer: 0 })) }], input, "seed-1");
  assert.ok(res.ok);
  const next = res.ok ? res.doc.teacher!.test! : model;
  assert.equal(next.questions.length, 3);
  // MUTATSIYA-2: kalit qayta hisoblanmasa uzunligi 4 bo'lib qolardi.
  assert.equal(next.key.A.length, 3);
  for (const v of next.variants) v.order.forEach((qi, i) => assert.equal(next.key[v.id][i], "ABCD"[v.optionOrder[i].indexOf(next.questions[qi].answer as number)]));
  assert.ok(res.ok && res.doc.sections.some((s) => s.id === "variant-A"));
});

test("mezon jadvali rubrikadan quriladi, ballar topshiriq balliga moslashadi", () => {
  const q = {
    id: "q1",
    kind: "open" as const,
    stem: "Nyutonning ikkinchi qonunini yozing va tezlanishni toping.",
    options: [],
    answer: "a = F/m = 3 m/s²",
    points: 6,
    bloom: "evaluate" as const,
    difficulty: "qiyin" as const,
    explanation: "izoh",
  };
  const rubrics = new Map([[q.stem, [{ text: "Formula yozildi", points: 1 }, { text: "Qo'llandi", points: 1 }, { text: "Javob topildi", points: 1 }]]]);
  const criteria = criteriaFromRaw([q], rubrics);
  assert.equal(criteria.length, 3);
  assert.equal(criteria.reduce((a, c) => a + c.points, 0), 6, "mezon ballari topshiriq balliga teng emas");
  for (const c of criteria) assert.equal(c.taskRef, "q1");
  // Rubrikasiz ochiq topshiriq ham mezonsiz qolmaydi.
  assert.equal(criteriaFromRaw([q], new Map()).length, 1);
});

test("«Sizdan kutiladi» bandlari: kalit tekshiruvi doim, manba — faqat fayl rejimida", () => {
  const input = testInputFromValues(META, VALUES({ mode: "file" }));
  const needs = testUserNeeds({ kind: 0, stem: 0, options: 0, answer: 0, duplicate: 0, blanket: 0, source: 3, extra: 0 }, input);
  assert.ok(needs.some((n) => n.id === "key"), "kalitni tekshirish bandi yo'q");
  const src = needs.find((n) => n.id === "source");
  assert.match(src!.hint, /3 ta savol/);
  const topic = testUserNeeds({ kind: 0, stem: 0, options: 0, answer: 0, duplicate: 0, blanket: 0, source: 0, extra: 0 }, testInputFromValues(META, VALUES()));
  assert.ok(!topic.some((n) => n.id === "source"), "mavzu rejimida manba bandi chiqdi");
});

test("GIFT eksporti: to'g'ri javob `=`, xatolari `~`, maxsus belgilar ekranlanadi", () => {
  const input = testInputFromValues(META, VALUES({ count: 2 }));
  const model = assembleModel(
    [
      { id: "q1", kind: "single", stem: "Hosila nimani bildiradi?", options: ["limit", "yig'indi", "ko'paytma", "ayirma"], answer: 0, points: 1, bloom: "apply", difficulty: "orta", explanation: "izoh" },
      { id: "q2", kind: "truefalse", stem: "Integral — hosilaga teskari amal {ha}", options: ["To'g'ri", "Noto'g'ri"], answer: true, points: 1, bloom: "remember", difficulty: "oson", explanation: "izoh" },
    ],
    input,
    new Map(),
    "s",
  );
  const gift = toGift(model, "Hosila");
  assert.match(gift, /\{=limit ~yig'indi ~ko'paytma ~ayirma\}/);
  assert.match(gift, /\{T\}/);
  assert.match(gift, /\\\{ha\\\}/, "GIFT maxsus belgilari ekranlanmadi");
  assert.equal(gift.split("\n").filter((l) => l.startsWith("::")).length, 2);
});

test("`delivered` savol soni bo'yicha; fan id si bazaga mos shaklda", async () => {
  const { doc } = await build(VALUES({ count: 20 }));
  assert.deepEqual(testDelivered(doc, VALUES({ count: 20 })), { got: 20, want: 20 });
  assert.equal(subjectIdOf("Matematika"), "matematika");
  assert.equal(subjectIdOf("Ona tili"), "ona-tili");
  assert.equal(subjectIdOf("O'zbekiston tarixi"), "ozbekiston-tarixi");
});

test("LLM javob bermasa hujjat qurilmaydi (`null`)", async () => {
  const out = await buildTestDoc(META, VALUES(), {
    deadline: Date.now() + 60_000,
    complete: (async () => null) as never,
    buildFigures: noFigures,
    polish: false,
  });
  assert.equal(out, null);
});

test("testSections: kalit «yo'q» bo'lsa kalit beti chizilmaydi", () => {
  const input = testInputFromValues(META, VALUES({ count: 3, answerKey: "yoq", omr: false }));
  const model = assembleModel(
    Array.from({ length: 3 }, (_, i) => ({
      id: `q${i + 1}`,
      kind: "single" as const,
      stem: stemOf(i),
      options: ["bir", "ikki", "uch", "to'rt"],
      answer: i % 4,
      points: 1,
      bloom: "apply" as const,
      difficulty: "orta" as const,
      explanation: "izoh matni",
    })),
    input,
    new Map(),
    "s",
  );
  const { sections, tables } = testSections(model, input, null);
  assert.ok(!sections.some((s) => s.id === "key"), "kalit «yo'q» bo'lsa ham chizildi");
  assert.equal(tables.length, 0);
  assert.equal(model.omr, undefined, "OMR o'chirilgan bo'lsa spec qurilmasin");
});
