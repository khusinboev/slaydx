import test from "node:test";
import assert from "node:assert/strict";
import type { ReviewCheck, ReviewLevel } from "../lib/generation/report/types.ts";
import {
  DTM_NOTE,
  ESSAY_RUBRICS,
  essayJudgeDetail,
  essayJudgeOf,
  essayRubric,
  essayScore,
  essayWeights,
  ieltsBand,
  ieltsBandScore,
  ieltsBands,
  judgeScoreOf,
  rubricPoints,
  ruleShareOf,
} from "../lib/generation/essay/rubric.ts";

/**
 * INSHO RUBRIKALARI (AUDIT-19 WP-D) — VAZNLAR BITTA JOYDA.
 *
 * Mutatsiyalar (har biri kamida bitta testni qizartiradi):
 *   1. DTM taqsimoti buzilsa (mazmun 8 → 5) — «DTM 24 ball taqsimoti».
 *   2. IELTS band formulasi `4 + s×5/3` o'rniga `s×3` bo'lsa — «band».
 *   3. `ruleWeight` maktabda 0.4 dan 0.6 ga o'zgarsa — «ulushlar».
 *   4. `skipped` mezon maxrajdan chiqarilmasa — «skip».
 *   5. `DTM_NOTE` (X-8 izohi) olib tashlansa — «panel izohi».
 */

const rules = (levels: ReviewLevel[]): ReviewCheck[] => levels.map((level, i) => ({ id: `r${i}`, level, label: `r${i}` }));

test("DTM 24 ball taqsimoti — mazmun 8 / tuzilma 5 / til 5 / savodxonlik 4 / ijodiylik 2", () => {
  const r = ESSAY_RUBRICS.dtm24;
  assert.deepEqual(r.weights, { content: 8, structure: 5, language: 5, literacy: 4, creativity: 2 });
  assert.equal(Object.values(r.weights).reduce((a, b) => a + (b ?? 0), 0), 24);
  assert.equal(r.maxPoints, 24);
});

test("akademik rubrika 100 ball — tezis 25 / dalil 25 / tuzilma 20 / til 20 / format 10", () => {
  const r = ESSAY_RUBRICS.academic100;
  assert.deepEqual(r.weights, { thesis: 25, evidence: 25, structure: 20, language: 20, format: 10 });
  assert.equal(Object.values(r.weights).reduce((a, b) => a + (b ?? 0), 0), 100);
});

test("DTM: to'liq baho 24/24 → 100, nol → 0", () => {
  const perfect = essayJudgeOf("school_dtm", { content: 3, structure: 3, language: 3, literacy: 3, creativity: 3 });
  assert.equal(judgeScoreOf(essayRubric("school_dtm"), perfect), 100);
  assert.equal(rubricPoints(essayRubric("school_dtm"), perfect), 24);
  const zero = essayJudgeOf("school_dtm", { content: 0, structure: 0, language: 0, literacy: 0, creativity: 0 });
  assert.equal(judgeScoreOf(essayRubric("school_dtm"), zero), 0);
  assert.equal(rubricPoints(essayRubric("school_dtm"), zero), 0);
});

test("DTM: faqat mazmun to'liq → 8/24 (vazn taqsimoti ishlaydi)", () => {
  const j = essayJudgeOf("school_dtm", { content: 3, structure: 0, language: 0, literacy: 0, creativity: 0 });
  assert.equal(rubricPoints(essayRubric("school_dtm"), j), 8);
  assert.equal(judgeScoreOf(essayRubric("school_dtm"), j), 33);
  // Ijodiylik eng kam vaznli — faqat u to'liq bo'lsa 2/24.
  const creative = essayJudgeOf("school_dtm", { content: 0, structure: 0, language: 0, literacy: 0, creativity: 3 });
  assert.equal(rubricPoints(essayRubric("school_dtm"), creative), 2);
});

test("IELTS band: 0 → 4, 1 → 6, 2 → 7, 3 → 9", () => {
  assert.equal(ieltsBand(0), 4);
  assert.equal(ieltsBand(1), 6);
  assert.equal(ieltsBand(2), 7);
  assert.equal(ieltsBand(3), 9);
  // Chegaradan tashqari qiymat qisiladi.
  assert.equal(ieltsBand(5), 9);
  assert.equal(ieltsBand(-2), 4);
});

test("IELTS: mean(band) × 100 / 9 — to'liq 100, nol 44", () => {
  const top = essayJudgeOf("ielts_task2", { tr: 3, cc: 3, lr: 3, gra: 3 });
  assert.deepEqual(ieltsBands(top), { tr: 9, cc: 9, lr: 9, gra: 9 });
  assert.equal(ieltsBandScore(top), 100);
  const low = essayJudgeOf("ielts_task2", { tr: 0, cc: 0, lr: 0, gra: 0 });
  assert.equal(ieltsBandScore(low), 44, "4/9 ≈ 44");
  // Aralash: 7, 7, 6, 9 → mean 7.25 → 81.
  const mixed = essayJudgeOf("ielts_task2", { tr: 2, cc: 2, lr: 1, gra: 3 });
  assert.deepEqual(ieltsBands(mixed), { tr: 7, cc: 7, lr: 6, gra: 9 });
  assert.equal(ieltsBandScore(mixed), 81);
  assert.equal(judgeScoreOf(essayRubric("ielts_task2"), mixed), 81, "IELTS da baholovchi bali — band bali");
  assert.equal(rubricPoints(essayRubric("ielts_task2"), mixed), null, "band shkalasida «ball» yo'q");
});

test("ulushlar: maktab/IELTS da baholovchi 0.6, akademikda qoidalar 0.6", () => {
  assert.deepEqual(essayWeights("school_dtm"), { rule: 0.4, judge: 0.6 });
  assert.deepEqual(essayWeights("ielts_task2"), { rule: 0.4, judge: 0.6 });
  assert.deepEqual(essayWeights("academic"), { rule: 0.6, judge: 0.4 });
});

test("essayScore: qoidalar + baholovchi ulush bo'yicha qo'shiladi", () => {
  const green = rules(["green", "green", "green", "green"]);
  const red = rules(["red", "red", "red", "red"]);
  assert.equal(ruleShareOf(green), 1);
  assert.equal(ruleShareOf(red), 0);
  assert.equal(ruleShareOf(rules(["green", "yellow"])), 0.75);

  const dtmTop = essayJudgeOf("school_dtm", { content: 3, structure: 3, language: 3, literacy: 3, creativity: 3 });
  assert.equal(essayScore(green, dtmTop, "school_dtm"), 100);
  assert.equal(essayScore(red, dtmTop, "school_dtm"), 60, "maktabda baholovchi ulushi 0.6");

  const acTop = essayJudgeOf("academic", { thesis: 3, evidence: 3, structure: 3, language: 3, format: 3 });
  assert.equal(essayScore(red, acTop, "academic"), 40, "akademikda baholovchi ulushi 0.4");
  assert.equal(essayScore(green, essayJudgeOf("academic", { thesis: 0, evidence: 0, structure: 0, language: 0, format: 0 }), "academic"), 60);
});

test("IELTS yakuniy ball: qoidalar qizil + baholovchi nol → 26", () => {
  const low = essayJudgeOf("ielts_task2", { tr: 0, cc: 0, lr: 0, gra: 0 });
  assert.equal(essayScore(rules(["red", "red"]), low, "ielts_task2"), 26, "0.6 × 44");
  const top = essayJudgeOf("ielts_task2", { tr: 3, cc: 3, lr: 3, gra: 3 });
  assert.equal(essayScore(rules(["green", "green"]), top, "ielts_task2"), 100);
});

test("skip: baholanmagan mezon MAXRAJGA kirmaydi", () => {
  const j = essayJudgeOf("school_dtm", { content: 3, structure: 0, language: 0, literacy: 0, creativity: 0 });
  j.skipped = ["creativity"];
  // Ijodiylik chiqarilgach maxraj 24 → 22: 8/22 ≈ 36 (aks holda 33).
  assert.equal(judgeScoreOf(essayRubric("school_dtm"), j), 36);
  const ielts = essayJudgeOf("ielts_task2", { tr: 3, cc: 3, lr: 3, gra: 0 });
  ielts.skipped = ["gra"];
  assert.deepEqual(ieltsBands(ielts), { tr: 9, cc: 9, lr: 9 });
  assert.equal(ieltsBandScore(ielts), 100);
});

test("panel izohi: DTM taqsimoti taxminiy ekani aytiladi (X-8)", () => {
  assert.ok(ESSAY_RUBRICS.dtm24.notes.includes(DTM_NOTE));
  assert.match(DTM_NOTE, /TAXMINIY/);
  assert.match(DTM_NOTE, /rasmiy DTM hujjatida/i);
  assert.equal(ESSAY_RUBRICS.academic100.notes.length, 0);
  assert.equal(ESSAY_RUBRICS.ielts_band.notes.length, 1, "IELTS bandi ham taxmin ekani aytiladi");
});

test("band detali hisobotda ko'rinadi, xom ball esa o'qiladigan qoladi", () => {
  assert.equal(essayJudgeDetail("ielts_task2", "tr", 2), "Band 7 · 2/3");
  assert.equal(essayJudgeDetail("school_dtm", "content", 2), "2/3");
  assert.equal(essayJudgeDetail("academic", "thesis", 3), "3/3");
  assert.match(essayJudgeDetail("ielts_task2", "gra", 3), /Band 9/);
});

test("rubrika kontekstga bog'langan — id lar aralashmaydi", () => {
  assert.equal(essayRubric("school_dtm").id, "dtm24");
  assert.equal(essayRubric("academic").id, "academic100");
  assert.equal(essayRubric("ielts_task2").id, "ielts_band");
  assert.deepEqual([...essayRubric("ielts_task2").criteria], ["tr", "cc", "lr", "gra"]);
});
