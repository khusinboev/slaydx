import test from "node:test";
import assert from "node:assert/strict";
import {
  KEY_TRUST_MIN,
  OPTION_BALANCE_MAX,
  TEST_RULE_IDS,
  keyTrustCheck,
  mixedScript,
  reviewTest,
  scoreTestReview,
  testJudgeUserPrompt,
  testRuleChecks,
} from "../lib/generation/teacher/test/review.ts";
import { assembleModel } from "../lib/generation/teacher/test/engine.ts";
import { testInputFromValues } from "../lib/generation/teacher/test/input.ts";
import { TEACHER_RULE_IDS, TEST_JUDGE_CRITERIA } from "../lib/generation/teacher/registry.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";
import type { TestModel, TestQuestion } from "../lib/generation/teacher/types.ts";
import type { FormValues } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * TEST HISOBOTI (AUDIT-20 WP-B) — 20 qoida + baholovchi.
 *
 * Mutatsiyalar (qizardi):
 *   1. `difficultyMix` toleransi ±1 dan ±3 ga kengaytirildi —
 *      «tolerans» testi;
 *   2. `keyMatchesVariants` `optionOrder` ni tekshirmadi — «buzilgan
 *      kalit qizil» testi;
 *   3. `noBlanketOption` faqat birinchi variantga qaradi —
 *      «hammasi to'g'ri qizil» testi;
 *   4. `scoreSum` e'lon qilingan jamiga emas, savol soniga solishtirdi
 *      — «bsb 50 ball» testi;
 *   5. `keyTrustCheck` chegara `< 2` bo'ldi — «kalitga ishonch» testi.
 */

const META: DocMeta = { toolId: "test", topic: "Hosila", language: "uz", subject: "Matematika", grade: 11 } as DocMeta;
const WORDS = ["atom", "molekula", "kislota", "tenglama", "funksiya", "vektor", "hujayra", "integral", "limit", "bosim", "tezlik", "reaksiya"];

const stemOf = (i: number) => {
  const w = (k: number) => WORDS[(i * k + k) % WORDS.length];
  return `${i + 1}-topshiriq. ${w(1)} va ${w(5)} bilan ${w(7)} mavzusida ${i * 3 + 7} misol asosida qaysi javob to'g'ri?`;
};

const mk = (i: number, over: Partial<TestQuestion> = {}): TestQuestion => ({
  id: `q${i + 1}`,
  kind: "single",
  stem: stemOf(i),
  options: ["birinchi javob", "ikkinchi javob", "uchinchi javob", "to'rtinchi javob"],
  answer: i % 4,
  points: 1,
  bloom: i % 4 === 0 ? "remember" : i % 4 === 1 ? "understand" : i % 4 === 2 ? "apply" : "analyze",
  difficulty: i % 10 < 3 ? "oson" : i % 10 < 8 ? "orta" : "qiyin",
  explanation: "Bu savolda asosiy tushuncha tekshiriladi.",
  ...over,
});

const VALUES = (over: FormValues = {}): FormValues => ({ testType: "nazorat", mode: "topic", count: 10, variants: 2, omr: true, grade: 11, ...over });

function model(n: number, over: FormValues = {}, edit: (q: TestQuestion, i: number) => TestQuestion = (q) => q): TestModel {
  const input = testInputFromValues(META, VALUES({ count: n, ...over }));
  return assembleModel(Array.from({ length: n }, (_, i) => edit(mk(i), i)), input, new Map(), "seed-review");
}

const byId = (m: TestModel, id: string, ask = {}) => testRuleChecks(m, { count: m.questions.length, ...ask }).find((c) => c.id === id)!;

/* ────────────────────────── testlar ────────────────────────── */

test("20 qoida — reyestr ro'yxati bilan AYNAN mos", () => {
  assert.equal(TEST_RULE_IDS.length, 20, `qoidalar soni: ${TEST_RULE_IDS.length}`);
  assert.deepEqual([...TEST_RULE_IDS].sort(), [...TEACHER_RULE_IDS.test].sort(), "reyestr va implementatsiya ro'yxati ajralib ketdi");
  const checks = testRuleChecks(model(10));
  assert.deepEqual(checks.map((c) => c.id), [...TEST_RULE_IDS], "bandlar tartibi/tarkibi ro'yxatdan farq qiladi");
  for (const c of checks) assert.ok(c.label.length > 3, `${c.id}: yorliq yo'q`);
});

test("toza test: barcha qoidalar yashil", () => {
  const m = model(20);
  const checks = testRuleChecks(m, { count: 20 });
  const bad = checks.filter((c) => c.level !== "green");
  assert.deepEqual(bad.map((c) => `${c.id}: ${c.detail}`), [], "toza testda qizil/sariq band chiqdi");
});

test("count: yetishmagan savollar sariq, 80 % dan kam bo'lsa qizil", () => {
  assert.equal(byId(model(10), "count", { count: 10 }).level, "green");
  const m = model(9);
  assert.equal(testRuleChecks(m, { count: 10 }).find((c) => c.id === "count")!.level, "yellow");
  assert.equal(testRuleChecks(m, { count: 20 }).find((c) => c.id === "count")!.level, "red");
  assert.ok(testRuleChecks(m, { count: 20 }).find((c) => c.id === "count")!.fix, "«Tuzatish» tugmasi yo'q");
});

test("oneCorrect: yopiq savolda javob shakli buzilsa QIZIL", () => {
  assert.equal(byId(model(10), "oneCorrect").level, "green");
  // Chegaradan tashqari indeks.
  const bad = model(10, {}, (q, i) => (i === 3 ? { ...q, answer: 9 } : q));
  assert.equal(byId(bad, "oneCorrect").level, "red");
  assert.match(byId(bad, "oneCorrect").detail!, /4-savol/);
  // Ko'p javobli savolda 2–3 to'g'ri javob bo'lishi shart.
  const multi = model(10, {}, (q, i) => (i === 0 ? { ...q, kind: "multi", answer: [0] } : q));
  assert.equal(byId(multi, "oneCorrect").level, "red");
  const okMulti = model(10, {}, (q, i) => (i === 0 ? { ...q, kind: "multi", answer: [0, 2] } : q));
  assert.equal(byId(okMulti, "oneCorrect").level, "green");
});

test("noBlanketOption: «hammasi to'g'ri» qaysi o'rinda bo'lsa ham QIZIL", () => {
  // MUTATSIYA-3: faqat birinchi variantga qaralsa bu test o'tib ketardi.
  const m = model(10, {}, (q, i) => (i === 5 ? { ...q, options: [...q.options.slice(0, 3), "Yuqoridagilarning barchasi"] } : q));
  const c = byId(m, "noBlanketOption");
  assert.equal(c.level, "red");
  assert.match(c.detail!, /6-savol/);
  assert.ok(c.fix, "«Tuzatish» yo'q");
  assert.equal(byId(model(10), "noBlanketOption").level, "green");
});

test("difficultyMix: ±1 savol yashil, ±2 sariq, undan katta QIZIL", () => {
  // `aralash` 20 savolda 6/10/4 kutiladi.
  const exact = model(20, {}, (q, i) => ({ ...q, difficulty: i < 6 ? "oson" : i < 16 ? "orta" : "qiyin" }));
  assert.equal(byId(exact, "difficultyMix", { difficulty: "aralash" }).level, "green");
  const off1 = model(20, {}, (q, i) => ({ ...q, difficulty: i < 7 ? "oson" : i < 16 ? "orta" : "qiyin" }));
  assert.equal(byId(off1, "difficultyMix", { difficulty: "aralash" }).level, "green");
  const off2 = model(20, {}, (q, i) => ({ ...q, difficulty: i < 8 ? "oson" : i < 16 ? "orta" : "qiyin" }));
  assert.equal(byId(off2, "difficultyMix", { difficulty: "aralash" }).level, "yellow");
  // MUTATSIYA-1: tolerans kengaytirilsa quyidagi qator yashil chiqardi.
  const all = model(20, {}, (q) => ({ ...q, difficulty: "orta" }));
  assert.equal(byId(all, "difficultyMix", { difficulty: "aralash" }).level, "red");
  assert.match(byId(all, "difficultyMix", { difficulty: "aralash" }).detail!, /oson 0\/6/);
});

test("keyMatchesVariants / variantParity: kalit buzilsa QIZIL", () => {
  const m = model(10);
  assert.equal(byId(m, "keyMatchesVariants").level, "green");
  assert.equal(byId(m, "variantParity").level, "green");

  // MUTATSIYA-2: kalitning bitta harfi almashtirildi.
  const broken: TestModel = { ...m, key: { ...m.key, A: m.key.A.map((x, i) => (i === 2 ? (x === "A" ? "B" : "A") : x)) } };
  assert.equal(byId(broken, "keyMatchesVariants").level, "red");
  assert.match(byId(broken, "keyMatchesVariants").detail!, /A\/3/);

  // Variantda savol to'plami farq qilsa — paritet buziladi.
  const parity: TestModel = { ...m, variants: [m.variants[0], { ...m.variants[1], order: m.variants[1].order.slice(0, -1) }] };
  assert.equal(byId(parity, "variantParity").level, "red");
});

test("keyBalance: harflar bir tomonga og'sa sariq/qizil", () => {
  const m = model(20);
  assert.equal(byId(m, "keyBalance").level, "green", byId(m, "keyBalance").detail);
  const skewed: TestModel = { ...m, key: { ...m.key, A: m.key.A.map(() => "C") } };
  assert.equal(byId(skewed, "keyBalance").level, "red");
  assert.match(byId(skewed, "keyBalance").detail!, /farqi: 20/);
});

test("scoreSum: bsb 50 ballga AYNAN teng bo'lishi kerak", () => {
  const bsb = model(8, { testType: "bsb", count: 8 });
  assert.equal(bsb.scoring.total, 50);
  assert.equal(byId(bsb, "scoreSum").level, "green", byId(bsb, "scoreSum").detail);
  // MUTATSIYA-4: bitta topshiriq balli o'zgardi — yig'indi 49.
  const off: TestModel = { ...bsb, questions: bsb.questions.map((q, i) => (i === 0 ? { ...q, points: q.points - 1 } : q)) };
  assert.equal(byId(off, "scoreSum").level, "yellow");
  const far: TestModel = { ...bsb, questions: bsb.questions.map((q, i) => (i === 0 ? { ...q, points: 1 } : q)) };
  assert.equal(byId(far, "scoreSum").level, "red");
});

test("sourceGrounded: fayl rejimida iqtibos manbada tekshiriladi", () => {
  const topic = model(5);
  assert.equal(byId(topic, "sourceGrounded").level, "green");
  assert.match(byId(topic, "sourceGrounded").detail!, /fayl rejimi emas/);

  const src = "Hosila — funksiya orttirmasining argument orttirmasiga nisbatining limiti.";
  const withQuote = model(5, { mode: "file" }, (q) => ({ ...q, source: { quote: "funksiya orttirmasining argument orttirmasiga nisbatining limiti" } }));
  assert.equal(byId(withQuote, "sourceGrounded", { sourceText: src }).level, "green");

  const fake = model(5, { mode: "file" }, (q, i) => (i < 3 ? { ...q, source: { quote: "manbada yo'q uydirma iqtibos" } } : { ...q, source: { quote: "funksiya orttirmasining argument orttirmasiga nisbatining limiti" } }));
  const c = byId(fake, "sourceGrounded", { sourceText: src, droppedBySource: 2 });
  assert.equal(c.level, "red");
  assert.match(c.detail!, /2 savol manbada tasdiqlanmagani uchun olib tashlandi/);
  assert.ok(c.fix);
});

test("curriculumCoverage: har mavzuga kamida bitta savol", () => {
  const ids = ["hosila-1", "hosila-2", "hosila-3"];
  const full = model(6, { mode: "curriculum", topicIds: JSON.stringify(ids) }, (q, i) => ({ ...q, topicId: ids[i % 3] }));
  assert.equal(byId(full, "curriculumCoverage").level, "green");
  const one = model(6, { mode: "curriculum", topicIds: JSON.stringify(ids) }, (q, i) => ({ ...q, topicId: ids[i % 2] }));
  assert.equal(byId(one, "curriculumCoverage").level, "yellow");
  const none = model(6, { mode: "curriculum", topicIds: JSON.stringify(ids) }, (q) => ({ ...q, topicId: ids[0] }));
  assert.equal(byId(none, "curriculumCoverage").level, "red");
  assert.match(byId(none, "curriculumCoverage").detail!, /hosila-2/);
});

test("stemLength / optionBalance / languagePurity / negativeStem", () => {
  const longStem = model(10, {}, (q, i) => (i === 0 ? { ...q, stem: "a".repeat(260) } : q));
  assert.equal(byId(longStem, "stemLength").level, "yellow");

  const unbalanced = model(10, {}, (q, i) => (i === 0 ? { ...q, options: ["ha", "bu javob juda uzun va batafsil yozilgan, shuning uchun to'g'ri", "yo'q", "bor"] } : q));
  assert.equal(byId(unbalanced, "optionBalance").level, "red");
  assert.ok(OPTION_BALANCE_MAX === 2.5);

  assert.ok(mixedScript("Hosila — bu предел nisbati"), "lotin/kirill aralashmasi aniqlanmadi");
  assert.ok(!mixedScript("Nyuton qonuni: F = ma"), "formula aralashma deb belgilandi");
  const mixed = model(10, {}, (q, i) => (i === 0 ? { ...q, stem: `${q.stem} предел значение функции` } : q));
  assert.equal(byId(mixed, "languagePurity").level, "yellow");
  const decimal = model(10, {}, (q, i) => (i < 5 ? { ...q, stem: `${q.stem} Javob 3.14 ga teng?` } : q));
  assert.equal(byId(decimal, "languagePurity").level, "red");

  const neg = model(10, {}, (q, i) => (i === 0 ? { ...q, stem: "Quyidagilardan qaysi biri suvda erimaydi deb hisoblanadi?" } : q));
  assert.equal(byId(neg, "negativeStem").level, "red");
  const marked = model(10, {}, (q, i) => (i === 0 ? { ...q, stem: "Quyidagilardan qaysi biri suvda eriMAYDI deb hisoblanadi?" } : q));
  assert.equal(byId(marked, "negativeStem").level, "green");
});

test("answerPresent / explanationPresent / bloomCoverage / omrFits", () => {
  const open = model(6, { testType: "bsb", count: 5, questionKinds: '["single","open"]', criteriaTable: true }, (q, i) =>
    i === 0 ? { ...q, kind: "open", options: [], answer: "", bloom: "evaluate" } : q,
  );
  assert.equal(byId(open, "answerPresent").level, "red");

  const noExpl = model(10, {}, (q, i) => (i < 3 ? { ...q, explanation: "" } : q));
  assert.equal(byId(noExpl, "explanationPresent").level, "red");
  assert.equal(byId(model(10, {}, (q, i) => (i === 0 ? { ...q, explanation: "" } : q)), "explanationPresent").level, "yellow");

  // Yopiq savolda evaluate — Bloom qoidasi buziladi.
  const wrongBloom = model(10, {}, (q, i) => (i === 0 ? { ...q, bloom: "create" } : q));
  assert.ok(byId(wrongBloom, "bloomCoverage").level !== "green");
  const oneLevel = model(20, {}, (q) => ({ ...q, bloom: "remember" }));
  assert.equal(byId(oneLevel, "bloomCoverage").level, "red");

  const m = model(10);
  assert.equal(byId(m, "omrFits").level, "green");
  const broken: TestModel = { ...m, omr: { ...m.omr!, count: 45, columns: 5 } };
  assert.equal(byId(broken, "omrFits").level, "red");
});

test("baholovchi: ball 60/40, past `answerCorrectness` kalitga ishonch bandini beradi", async () => {
  const m = model(10);
  const doc: AcademicDoc = { meta: META, titlePage: true, toc: false, sections: [], teacher: { v: 1, kind: "test", type: "nazorat", school: { institution: "", author: "", subject: "Matematika", grade: 11, language: "uz" }, test: m } };

  const good = await reviewTest(doc, {
    ask: { count: 10 },
    complete: (async (role: LlmRole) => (role === "judge" ? { text: JSON.stringify({ answerCorrectness: 3, clarity: 3, distractors: 3, coverage: 3, levelFit: 3, notes: [], fixes: [] }) } : null)) as never,
    deadline: Date.now() + 60_000,
  });
  assert.equal(good.score, 100, "toza test + 3/3 baholovchi 100 ball bermadi");
  assert.ok(!good.checks.some((c) => c.id === "keyTrust"), "yaxshi kalitda ogohlantirish chiqdi");
  for (const c of TEST_JUDGE_CRITERIA) assert.ok(good.checks.some((x) => x.id === `judge:${c}`), `${c} bandi hisobotda yo'q`);

  const shaky = await reviewTest(doc, {
    ask: { count: 10 },
    complete: (async () => ({ text: JSON.stringify({ answerCorrectness: 1, clarity: 3, distractors: 3, coverage: 3, levelFit: 3, notes: ["kalitda xato bor"], fixes: [] }) })) as never,
    deadline: Date.now() + 60_000,
  });
  const trust = shaky.checks.find((c) => c.id === "keyTrust");
  // MUTATSIYA-5: chegara `< 2` bo'lsa `answerCorrectness: 2` da band chiqmasdi.
  assert.equal(trust?.level, "red");
  assert.match(trust!.detail!, /kalitini o'zingiz tekshiring/);
  assert.ok(shaky.score < good.score);
  assert.equal(KEY_TRUST_MIN, 2);
});

test("baholovchisiz hisobot: neytral ballar va izoh", async () => {
  const m = model(10);
  const doc: AcademicDoc = { meta: META, titlePage: true, toc: false, sections: [], teacher: { v: 1, kind: "test", type: "nazorat", school: { institution: "", author: "", subject: "", grade: 11, language: "uz" }, test: m } };
  const r = await reviewTest(doc, { ask: { count: 10 }, judge: false });
  assert.ok(r.score > 0 && r.score < 100, `neytral ball: ${r.score}`);
  assert.equal(r.checks.filter((c) => c.id === "keyTrust").length, 0);
  // Model yo'q hujjat — hisobot 0, yiqilmaydi.
  const empty = await reviewTest({ meta: META, titlePage: true, toc: false, sections: [] }, { judge: false });
  assert.equal(empty.score, 0);
});

test("baholovchi prompti KALITNI ham beradi (answerCorrectness shusiz o'lchanmaydi)", () => {
  const m = model(3);
  const text = testJudgeUserPrompt(m, "Hosila");
  assert.match(text, /KEY: [A-D]/);
  assert.match(text, /EXPLANATION:/);
  assert.match(text, /TEST TYPE: nazorat/);
  for (const q of m.questions) assert.ok(text.includes(q.stem), "savol o'zagi baholovchiga berilmadi");
});

test("scoreTestReview: 60 % qoidalar + 40 % baholovchi", () => {
  const rules = [
    { id: "a", level: "green" as const, label: "a" },
    { id: "b", level: "green" as const, label: "b" },
  ];
  const judge = { answerCorrectness: 3, clarity: 3, distractors: 3, coverage: 3, levelFit: 3, notes: [], fixes: [] };
  assert.equal(scoreTestReview(rules, judge), 100);
  assert.equal(scoreTestReview([{ id: "a", level: "red" as const, label: "a" }], judge), 40, "qoida 0 bo'lsa faqat baholovchi ulushi qolsin");
  assert.equal(scoreTestReview(rules, { ...judge, answerCorrectness: 0, clarity: 0, distractors: 0, coverage: 0, levelFit: 0 }), 60);
});

test("keyTrustCheck: 3 ball — band yo'q, 2 ball — sariq, ≤1 — qizil", () => {
  const base = { clarity: 3, distractors: 3, coverage: 3, levelFit: 3, notes: [], fixes: [] };
  assert.equal(keyTrustCheck({ ...base, answerCorrectness: 3 }), null);
  assert.equal(keyTrustCheck({ ...base, answerCorrectness: 2 })?.level, "yellow");
  assert.equal(keyTrustCheck({ ...base, answerCorrectness: 1 })?.level, "red");
  assert.equal(keyTrustCheck({ ...base, answerCorrectness: 0 })?.level, "red");
});
