/**
 * TEST DVIGATELI (AUDIT-20 WP-B) — `buildTestDoc`.
 *
 * Bosqichlar (`onStage` foizlari):
 *    1 plan        0→8    kirish, o'quv dasturi mavzulari, manba matni
 *    2 questions   8→60   savollar 10 talik bo'laklarda, `mapPool(2)`
 *    3 assemble   60→70   normalizatsiya, ball, variantlar, kalit, OMR
 *    4 review     70→85   20 qoida + baholovchi
 *    5 polish     85→100  «Tuzatish» (savolni QAYTA TUZISH)
 *
 * Yagona manba qarori (oila bilan bir xil): MATN `doc.sections` da
 * (ko'rsatma, variantlar, kalit, mezon jadvali), METAMA'LUMOT esa
 * `doc.teacher.test` da. Bu fayl RAQAM QO'YMAYDI va bet BO'LMAYDI —
 * tartibni `teacher/layout.ts planTeacher` (WP-C) beradi, DOCX ham,
 * ko'ruvchi ham undan o'qiydi.
 *
 * `null` — LLM yo'q (kalitsiz muhit): chaqiruvchi eski yo'lga tushadi.
 * Test vositasida eski yo'l YO'Q, shuning uchun `null` = hujjat yo'q.
 */
import type { FormValues } from "../../../types";
import type { AcademicDoc, Block, DocMeta, DocSection, DocTable, Figure } from "../../types";
import type { TranslationSource } from "../../source-types";
import type { DocReview, UserNeed } from "../../report/types";
import { llmEnabled } from "../../llm";
import { CostMeter, complete as completeRole } from "../../llm-roles";
import { parseLlmObject } from "../../json";
import { mapPool, remainingMs } from "../../quality";
import { POLISH_MAX_FIXES, runPolishWith, type Fix } from "../../report/polish-core";
import { neutralJudgeFor } from "../../report/judge";
import { scoreReviewFor } from "../../report/score";
import {
  TEACHER_LIMITS,
  type GradeBand,
  type TestCriterion,
  type TestModel,
  type TestQuestion,
  type TestVariant,
} from "../types";
import { DIFFICULTY_MIX, TEST_JUDGE_CRITERIA, teacherTypeOf } from "../registry";
import type { TeacherBuildOpts, TeacherBuilt, TeacherStage } from "../engine";
import { testInputFromValues, type TestInput } from "./input";
import { curriculumBlock, honestyNote, instructionLines, questionsUserPrompt, testSourceBlock, testSystemPrompt, type PromptTopic, type QuestionsAsk } from "./prompts";
import {
  answerKeyFor,
  answerLabel,
  assignPoints,
  buildScoring,
  buildVariants,
  clean,
  difficultyTargets,
  normalizeQuestions,
  type DropReason,
} from "./questions";
import { omrFigure, omrModelOf, omrSpecOf } from "./omr";
import { reviewTest, type TestJudgeResult, type TestReviewAsk } from "./review";
import { testLabels } from "./labels";

/* ────────────────────────── shartnoma ────────────────────────── */

/**
 * WP-A shartnomasining KENGAYTMASI: `TeacherBuildOpts` (deadline,
 * source, onStage, onCost, onUsage, complete, judge, polish, now)
 * o'zgarmaydi — `teacher/engine.ts` shu tip bilan chaqiradi. Bu yerda
 * faqat TEST ga xos seam lar qo'shiladi, hammasi IXTIYORIY: shuning
 * uchun `buildTestDoc` `TeacherBuilder` sifatida ham ishlaydi.
 */
export type TestBuildOpts = TeacherBuildOpts & {
  /** Test seam — OMR PNG (standart: `../../figures` dinamik import). */
  buildFigures?: (figures: Figure[], o: { lang: string }) => Promise<Figure[]>;
  /** Test seam — o'quv dasturi mavzulari (standart: `lib/curriculum.ts`). */
  topics?: (subjectId: string, grade: number, ids: readonly string[]) => Promise<PromptTopic[]>;
  /** Test seam — yuklangan fayl matni. */
  sourceTextOf?: (source: TranslationSource) => Promise<string>;
  /** Aralashtirish urug'i — testda barqaror qiymat. */
  seed?: string;
};

/** Bitta LLM chaqiruvida nechta savol — R3 §3.2 (10 talik bo'lak). */
export const BATCH_SIZE = 10;
/** Savol bo'laklarining parallelligi. */
export const BATCH_POOL = 2;
/** Sayqal uchun byudjetdan kamida shuncha qolishi kerak. */
export const TEST_POLISH_MIN_MS = 60_000;
/** Q-3 qabul chegarasi (AUDIT-18) — baholovchi ballari ±5 tebranadi. */
export const TEST_ACCEPT_DELTA = 1;

const STAGE = { plan: 8, questions: 60, assemble: 70, review: 85, done: 100 } as const;

/* ────────────────────────── modeldan hujjatga ────────────────────────── */

type RawRubric = { text?: unknown; points?: unknown; skill?: unknown };

/**
 * Ochiq topshiriqlarning baholash mezonlari — BSB jadvali (N-1 ustunlari).
 *
 * LLM javobidagi `rubric[]` shu yerda `TestCriterion[]` ga o'tadi va
 * `taskRef` orqali savolga bog'lanadi. Ballar savolning o'z balliga
 * moslashtiriladi: rubrika yig'indisi savol ballidan farq qilsa,
 * o'qituvchi qaysi biriga ishonishini bilmasdi.
 */
export function criteriaFromRaw(questions: readonly TestQuestion[], rubrics: Map<string, RawRubric[]>): TestCriterion[] {
  const out: TestCriterion[] = [];
  for (const q of questions) {
    if (q.kind !== "open") continue;
    const rows = (rubrics.get(q.stem) ?? []).map((r) => ({ text: clean(r?.text, 200), points: Math.max(0, Math.round(Number(r?.points) || 0)), skill: clean(r?.skill, 120) })).filter((r) => r.text);
    if (!rows.length) {
      out.push({ criterion: `To'liq va asosli javob berildi`, points: q.points, taskRef: q.id });
      continue;
    }
    const sum = rows.reduce((a, r) => a + r.points, 0) || rows.length;
    let left = q.points;
    rows.forEach((r, i) => {
      const share = i === rows.length - 1 ? left : Math.max(1, Math.round((q.points * (r.points || 1)) / sum));
      left -= share;
      out.push({ criterion: r.text, points: Math.max(0, i === rows.length - 1 ? Math.max(0, share) : share), taskRef: q.id, ...(r.skill ? { skill: r.skill } : {}) });
    });
  }
  return out;
}

const li = (text: string): Block => ({ kind: "li", text });

/** Bitta variantning savollar bo'limi — `li` bloklar (maket WP-C da). */
export function variantSection(model: TestModel, v: TestVariant, lang: string): DocSection {
  const L = testLabels(lang);
  const blocks: Block[] = [];
  v.order.forEach((qi, i) => {
    const q = model.questions[qi];
    if (!q) return;
    blocks.push(li(`${i + 1}. ${q.stem} (${q.points} ${L.points.toLowerCase()})`));
    if (q.kind === "open") {
      blocks.push(li(`${L.openAnswer} ______________________________________________`));
      return;
    }
    const perm = v.optionOrder[i] ?? q.options.map((_, j) => j);
    perm.forEach((orig, j) => {
      const text = q.options[orig];
      if (text) blocks.push(li(`${"ABCDEF"[j]}) ${text}`));
    });
  });
  return { id: `variant-${v.id}`, title: `${v.id}-${L.variant}`, blocks };
}

/** Javoblar kaliti jadvali: № × variant + ball/Bloom/qiyinlik. */
export function keyTable(model: TestModel, lang: string): DocTable {
  const L = testLabels(lang);
  const headers = [L.question, ...model.variants.map((v) => `${v.id}-${L.variant}`), L.points, L.bloom, L.difficulty];
  const rows = model.questions.map((_, i) => {
    const cells = model.variants.map((v) => model.key[v.id]?.[i] ?? "—");
    // Qator raqami — A variantidagi o'rin (kalit shu tartibda o'qiladi).
    const first = model.variants[0];
    const q = first ? model.questions[first.order[i]] : model.questions[i];
    return [String(i + 1), ...cells, String(q?.points ?? 1), q?.bloom ?? "—", q?.difficulty ?? "—"];
  });
  return { id: "key", caption: L.key, headers, rows, anchor: "key" };
}

/** Ball → baho jadvali (248-son buyruq, 23-band). */
export function gradeTable(scale: readonly GradeBand[], total: number, lang: string): DocTable {
  const L = testLabels(lang);
  return {
    id: "grades",
    caption: L.gradeTable,
    headers: [L.percent, L.points, L.grade],
    rows: scale.map((b) => [
      `${b.minPercent}–${b.maxPercent} %`,
      `${Math.ceil((b.minPercent / 100) * total)}–${Math.floor((b.maxPercent / 100) * total)}`,
      String(b.grade),
    ]),
    anchor: "key",
  };
}

/** BSB/ChSB mezon jadvali (N-1 ustunlari). */
export function criteriaTable(model: TestModel, lang: string): DocTable | null {
  const rows = (model.criteria ?? []).map((c) => {
    const q = model.questions.find((x) => x.id === c.taskRef);
    const at = q ? model.questions.indexOf(q) + 1 : 0;
    return [at ? `${at}` : "—", c.skill ?? "—", q ? q.stem : "—", String(c.points), c.criterion];
  });
  if (!rows.length) return null;
  const L = testLabels(lang);
  return { id: "criteria", caption: L.criteria, headers: [L.question, L.skill, L.task, L.points, L.criterion], rows, anchor: "criteria" };
}

/** Kalit bo'limining matni — jadval `tableRef` bilan kiradi. */
function keySection(model: TestModel, lang: string): DocSection {
  const L = testLabels(lang);
  const blocks: Block[] = [{ kind: "p", text: L.keyWarning }, { kind: "tableRef", text: L.key, tableId: "key" }];
  for (const q of model.questions) {
    if (q.kind !== "open") continue;
    blocks.push(li(`${model.questions.indexOf(q) + 1}. ${L.answer}: ${String(q.answer)}`));
  }
  blocks.push({ kind: "tableRef", text: L.gradeTable, tableId: "grades" });
  return { id: "key", title: L.key, blocks };
}

/** Butun hujjat: bo'limlar + jadvallar (`planTeacher` shu tartibni o'qiydi). */
export function testSections(model: TestModel, input: TestInput, figureId: string | null): { sections: DocSection[]; tables: DocTable[] } {
  const L = testLabels(input.language);
  const sections: DocSection[] = [];
  const tables: DocTable[] = [];

  sections.push({
    id: "instructions",
    title: L.instructions,
    blocks: [{ kind: "p", text: L.student }, ...model.instructions.map(li)],
  });
  for (const v of model.variants) sections.push(variantSection(model, v, input.language));
  if (figureId) sections.push({ id: "omr", title: L.answerSheet, blocks: [{ kind: "figure", text: L.answerSheet, figureId }] });
  if (input.answerKey !== "yoq") {
    sections.push(keySection(model, input.language));
    tables.push(keyTable(model, input.language), gradeTable(model.scoring.gradeScale, model.scoring.total, input.language));
  }
  if (input.criteriaTable) {
    const t = criteriaTable(model, input.language);
    if (t) {
      sections.push({ id: "criteria", title: L.criteria, blocks: [{ kind: "tableRef", text: L.criteria, tableId: "criteria" }] });
      tables.push(t);
    }
  }
  sections.push({ id: "honesty", title: "", blocks: [{ kind: "p", text: honestyNote(model.type) }] });
  return { sections, tables };
}

/* ────────────────────────── savollarni yozish ────────────────────────── */

type RawQuestion = Record<string, unknown> & { rubric?: unknown };

/** Bo'lak rejasi: nechta savol, qanday qiyinlik, nechtasi ochiq. */
export function planBatches(input: TestInput): QuestionsAsk[] {
  const target = difficultyTargets(input.count, DIFFICULTY_MIX[input.difficulty]);
  const pool: ("oson" | "orta" | "qiyin")[] = [
    ...Array<"oson">(target.oson).fill("oson"),
    ...Array<"orta">(target.orta).fill("orta"),
    ...Array<"qiyin">(target.qiyin).fill("qiyin"),
  ];
  const asks: QuestionsAsk[] = [];
  let openLeft = input.openCount;
  for (let from = 0; from < input.count; from += BATCH_SIZE) {
    const n = Math.min(BATCH_SIZE, input.count - from);
    const slice = pool.slice(from, from + n);
    const mix = { oson: 0, orta: 0, qiyin: 0 };
    for (const d of slice) mix[d]++;
    // Ochiq topshiriqlar bo'laklar bo'ylab tekis (oxirgi bo'lakka qoldiq).
    const open = Math.min(openLeft, Math.ceil(input.openCount / Math.ceil(input.count / BATCH_SIZE)));
    openLeft -= open;
    asks.push({ n, mix, open, avoid: [], from: from + 1 });
  }
  return asks;
}

type Ask = (role: "writer" | "judge", system: string, user: string, o: { json?: boolean; maxTokens: number; timeoutMs: number }) => Promise<string | null>;

const questionTimeout = (n: number, deadline: number) => Math.min(Math.max(35_000, 12_000 + n * 4_000), 90_000, remainingMs(deadline));

/* ────────────────────────── asosiy ────────────────────────── */

export async function buildTestDoc(meta: DocMeta, values: FormValues, opts: TestBuildOpts): Promise<TeacherBuilt | null> {
  const complete = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;
  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();
  const stage = (ev: TeacherStage) => opts.onStage?.(ev);

  const input = testInputFromValues(meta, values);
  const spec = teacherTypeOf("test", input.type);
  const seed = opts.seed ?? `${meta.toolId}:${input.topic}:${input.count}`;

  const call: Ask = async (role, system, user, o) => {
    const r = await complete(role, system, user, o);
    if (r?.usage) {
      meter.add(r.usage);
      opts.onUsage?.(r.usage);
    }
    return r?.text ?? null;
  };

  /* ── 1. reja: manba matni va dastur mavzulari ── */
  stage({ progress: 2, step: "Reja" });
  const sourceText = input.mode === "file" ? await resolveSource(meta, opts) : "";
  const topics = input.mode === "curriculum" ? await resolveTopics(input, opts) : [];
  const blocks = {
    source: input.mode === "file" ? testSourceBlock({ ...meta, sourceText: sourceText.slice(0, TEACHER_LIMITS.sourceTextChars) }) : "",
    curriculum: input.mode === "curriculum" ? curriculumBlock(topics) : "",
  };
  stage({ progress: STAGE.plan, step: "Savollar" });

  /* ── 2. savollar: 10 talik bo'laklar, mapPool(2) ── */
  const system = testSystemPrompt(input, spec);
  const asks = planBatches(input);
  const written: RawQuestion[][] = new Array(asks.length).fill(null).map(() => []);
  let done = 0;
  await mapPool(asks, BATCH_POOL, async (ask, i) => {
    const raw = await call("writer", system, questionsUserPrompt(input, ask, blocks), {
      json: true,
      maxTokens: Math.min(8000, 700 + ask.n * 320),
      timeoutMs: questionTimeout(ask.n, deadline),
    });
    const parsed = raw ? parseLlmObject<{ questions?: unknown }>(raw) : null;
    written[i] = Array.isArray(parsed?.questions) ? (parsed.questions as RawQuestion[]) : [];
    done++;
    stage({ progress: STAGE.plan + Math.round(((STAGE.questions - STAGE.plan) * done) / asks.length), step: "Savollar" });
  });

  const rawAll = written.flat();
  if (!rawAll.length) return null;

  /* ── 3. yig'ish: normalizatsiya → ball → variantlar → kalit → OMR ── */
  stage({ progress: STAGE.questions, step: "Yig'ish" });
  const norm = normalizeQuestions(rawAll, {
    grade: input.grade,
    count: input.count,
    kinds: input.kinds,
    optionCountFixed: spec.limits.optionCountFixed,
    ...(sourceText ? { sourceText } : {}),
    ...(topics.length ? { topicIds: topics.map((t) => t.id) } : {}),
  });
  if (!norm.questions.length) return null;

  const rubrics = new Map<string, RawRubric[]>();
  for (const r of rawAll) if (Array.isArray(r?.rubric)) rubrics.set(clean(r.stem ?? r.question, TEACHER_LIMITS.stemCharsMax), r.rubric as RawRubric[]);

  const model = assembleModel(norm.questions, input, rubrics, seed);
  const figure = model.omr ? omrFigure({ kind: "omr", ...model.omr }, testLabels(input.language).answerSheet) : null;
  const built = figure ? await drawFigure(figure, input.language, opts) : null;

  const { sections, tables } = testSections(model, input, built ? built.id : null);
  let doc: AcademicDoc = {
    meta,
    titlePage: true,
    toc: false,
    sections,
    tables,
    teacher: {
      v: 1,
      kind: "test",
      type: input.type,
      school: {
        institution: input.institution,
        author: input.author,
        subject: input.subject,
        grade: input.grade,
        language: input.language,
        ...(input.gradeLetter ? { gradeLetter: input.gradeLetter } : {}),
        ...(input.date ? { date: input.date } : {}),
        ...(input.approver ? { approver: input.approver } : {}),
      },
      test: model,
      ...(built ? { figures: [built] } : {}),
    },
  };

  /* ── 4. hisobot ── */
  stage({ progress: STAGE.assemble, step: "Hisobot" });
  const ask: TestReviewAsk = {
    count: input.count,
    difficulty: input.difficulty,
    ...(sourceText ? { sourceText } : {}),
    droppedBySource: norm.dropped.source,
  };
  let review = await reviewTest(doc, { ask, complete, deadline, judge: opts.judge, now, onUsage: (u) => opts.onUsage?.(u) });
  doc = withReview(doc, review);

  /* ── 5. sayqal: savolni QAYTA TUZISH ── */
  stage({ progress: STAGE.review, step: "Sayqal" });
  const wantPolish = opts.polish !== false && process.env.TEACHER_POLISH !== "0";
  if (wantPolish && remainingMs(deadline) > TEST_POLISH_MIN_MS) {
    const res = await runPolishWith<TestPolishOp, TestJudgeResult>(doc, review, {
      plan: (r) => planTestPolish(r),
      userNeeds: () => testUserNeeds(norm.dropped, input),
      rewrite: (d, fix, fixDeadline) => rewriteQuestions(d, fix, { call, input, spec, blocks, deadline: fixDeadline, seed }),
      apply: (d, ops) => applyTestOps(d, ops, input, seed),
      review: (d) => reviewTest(d, { ask, complete, deadline, judge: opts.judge, now, onUsage: (u) => opts.onUsage?.(u) }),
      judgeFromReview: (prev) => judgeFromChecks(prev),
      rescore: (fresh, j) => ({ ...fresh, score: scoreReviewFor(fresh.checks.filter((c) => (TEST_RULE_SET as Set<string>).has(c.id)), j, TEST_JUDGE_CRITERIA) }),
      acceptDelta: TEST_ACCEPT_DELTA,
      deadline,
      judge: opts.judge,
      now,
    });
    doc = withReview(res.doc, res.review);
    review = res.review;
  } else {
    doc = withReview(doc, { ...review, userNeeds: testUserNeeds(norm.dropped, input) });
  }

  stage({ progress: STAGE.done, step: "Tayyor" });
  const cost = meter.toJson();
  opts.onCost?.(cost);
  /*
   * `delivered` — SAVOL soni (AUDIT-20 §2). Dvigatel uni O'ZI qaytaradi,
   * chunki qancha savol manbada tasdiqlanmagani uchun o'chirilganini
   * faqat shu yer biladi; `delivered.ts` (WP-F) ikkinchi marta
   * hisoblamaydi.
   */
  return { doc, cost, delivered: { got: model.questions.length, want: input.count } };
}

/* ────────────────────────── yig'ish ────────────────────────── */

const TEST_RULE_SET = new Set<string>([
  "count", "oneCorrect", "optionCount", "noDuplicates", "noBlanketOption", "stemLength", "optionBalance", "keyBalance",
  "difficultyMix", "bloomCoverage", "keyMatchesVariants", "variantParity", "sourceGrounded", "curriculumCoverage",
  "scoreSum", "omrFits", "languagePurity", "negativeStem", "answerPresent", "explanationPresent",
]);

/** Savollar ro'yxatidan TO'LIQ model — ball, variant, kalit, OMR bir joyda. */
export function assembleModel(questions: readonly TestQuestion[], input: TestInput, rubrics: Map<string, RawRubric[]>, seed: string): TestModel {
  const scored = assignPoints(questions, input.totalPoints);
  const variants = buildVariants(scored, input.variants, seed);
  const key = answerKeyFor(scored, variants);
  const scoring = buildScoring(scored, input.totalPoints);
  const criteria = input.criteriaTable ? criteriaFromRaw(scored, rubrics) : [];
  const omrSpec = input.omr ? omrSpecOf(scored, variants) : null;
  const openCount = scored.filter((q) => q.kind === "open").length;
  return {
    mode: input.mode,
    type: input.type,
    questions: scored,
    variants,
    key,
    scoring,
    instructions: instructionLines(input, scored.length, scoring.total, openCount),
    timeMin: input.timeMin,
    topicIds: input.topicIds,
    ...(criteria.length ? { criteria } : {}),
    ...(omrSpec ? { omr: omrModelOf(omrSpec) } : {}),
  };
}

function withReview(doc: AcademicDoc, review: DocReview): AcademicDoc {
  if (!doc.teacher) return doc;
  return {
    ...doc,
    teacher: { ...doc.teacher, review, ...(review.polish ? { polish: review.polish } : {}), ...(review.userNeeds ? { userNeeds: review.userNeeds } : {}) },
  };
}

/* ────────────────────────── sayqal ────────────────────────── */

export type TestPolishOp = { op: "questions"; questions: TestQuestion[] };

/**
 * Sayqal REJASI — barcha «Tuzatish» bandlari BITTA fix ga birlashtiriladi.
 *
 * Nega birlashtiriladi: qoidalarning hammasi bitta nishonga
 * (`questions`) tegadi, `applyPolishWith` esa fix larni PARALLEL
 * bajaradi. Ikki parallel chaqiruv bir xil ro'yxatni qayta yozsa,
 * ikkinchisi birinchisini yo'q qilardi.
 */
export function planTestPolish(review: DocReview): { fixes: Fix[]; skipped: { id: string; reason: string }[] } {
  const fixable = review.checks.filter((c) => c.fix && c.level !== "green").slice(0, POLISH_MAX_FIXES);
  const skipped = review.checks.filter((c) => c.level !== "green" && !c.fix).map((c) => ({ id: c.id, reason: "manual" }));
  if (!fixable.length) return { fixes: [], skipped };
  return {
    fixes: [
      {
        op: "rewrite",
        target: "questions",
        instruction: fixable.map((c) => `— ${c.fix!.instruction}`).join("\n"),
      },
    ],
    skipped,
  };
}

/** «Sizdan kutiladi» — AI o'ylab topmaydigan ma'lumot (Q-2). */
export function testUserNeeds(dropped: Record<DropReason, number>, input: TestInput): UserNeed[] {
  const out: UserNeed[] = [];
  if (input.mode === "file" && dropped.source > 0)
    out.push({
      id: "source",
      label: "Manbada tasdiqlanmagan savollar",
      hint: `${dropped.source} ta savol yuklangan hujjatda so'zma-so'z tasdiqlanmagani uchun olib tashlandi — kerak bo'lsa to'liqroq manba yuklang.`,
    });
  out.push({ id: "key", label: "Javoblar kalitini tekshiring", hint: "Kalit AI tomonidan qo'yilgan — sinfga tarqatishdan oldin bir marta ko'z yugurtiring." });
  if (input.mode !== "curriculum" && input.grade >= 1)
    out.push({ id: "topics", label: "Mavzu qamrovi", hint: "Savollar siz kiritgan mavzudan chiqadi; dastur bo'yicha aniq mavzu kerak bo'lsa «darslik rejimi» ni tanlang." });
  return out;
}

type RewriteCtx = {
  call: Ask;
  input: TestInput;
  spec: ReturnType<typeof teacherTypeOf<"test">>;
  blocks: { source: string; curriculum: string };
  deadline: number;
  seed: string;
};

/** «Tuzatish» — belgilangan kamchiliklar bilan savollarni QAYTA TUZADI. */
async function rewriteQuestions(doc: AcademicDoc, fix: Fix, ctx: RewriteCtx) {
  const model = doc.teacher?.test;
  if (!model) return { ops: [], unresolved: [], rewrittenSections: [] };
  const { input, spec } = ctx;
  const ask: QuestionsAsk = {
    n: input.count,
    mix: difficultyTargets(input.count, DIFFICULTY_MIX[input.difficulty]),
    open: model.questions.filter((q) => q.kind === "open").length,
    avoid: [],
    from: 1,
  };
  const user = [
    questionsUserPrompt(input, ask, ctx.blocks),
    "",
    "REVISION — the previous version had these defects; fix ALL of them and return the FULL list again:",
    fix.instruction,
    "",
    "PREVIOUS ITEMS (rewrite them, keep what was good):",
    ...model.questions.map((q, i) => `${i + 1}. ${q.stem} [${q.difficulty}/${q.bloom}] → ${answerLabel(q, q.options.map((_, j) => j))}`),
  ].join("\n");
  const raw = await ctx.call("writer", testSystemPrompt(input, spec), user, {
    json: true,
    maxTokens: Math.min(12_000, 900 + input.count * 320),
    timeoutMs: questionTimeout(input.count, ctx.deadline),
  });
  const parsed = raw ? parseLlmObject<{ questions?: unknown }>(raw) : null;
  const list = Array.isArray(parsed?.questions) ? (parsed.questions as RawQuestion[]) : [];
  if (!list.length) return { ops: [], unresolved: [], rewrittenSections: [] };
  const norm = normalizeQuestions(list, {
    grade: input.grade,
    count: input.count,
    kinds: input.kinds,
    optionCountFixed: spec.limits.optionCountFixed,
  });
  if (norm.questions.length < Math.ceil(model.questions.length * 0.8)) return { ops: [], unresolved: [], rewrittenSections: [] };
  return { ops: [{ op: "questions", questions: norm.questions } as TestPolishOp], unresolved: [], rewrittenSections: ["questions"] };
}

/** Op → hujjat: model, bo'limlar va jadvallar QAYTA quriladi (kalit bilan birga). */
export function applyTestOps(doc: AcademicDoc, ops: TestPolishOp[], input: TestInput, seed: string): { ok: true; doc: AcademicDoc } | { ok: false; error: string } {
  const last = ops[ops.length - 1];
  if (!last?.questions.length) return { ok: false, error: "savollar yo'q" };
  if (!doc.teacher?.test) return { ok: false, error: "test modeli yo'q" };
  const model = assembleModel(last.questions, input, new Map(), seed);
  const figureId = doc.teacher.figures?.[0]?.id ?? null;
  const { sections, tables } = testSections(model, input, model.omr ? figureId : null);
  return { ok: true, doc: { ...doc, sections, tables, teacher: { ...doc.teacher, test: model } } };
}

/** Eski hisobotdagi baholovchi bandlaridan ballarni tiklaydi. */
function judgeFromChecks(prev: DocReview): TestJudgeResult | null {
  const spec = teacherTypeOf("test", "nazorat");
  const neutral = neutralJudgeFor(spec.judge);
  const found = prev.checks.filter((c) => (TEST_JUDGE_CRITERIA as readonly string[]).includes(c.id));
  if (!found.length) return null;
  const out = { ...neutral };
  for (const c of found) out[c.id as TestJudgeCriterionKey] = c.level === "green" ? 3 : c.level === "yellow" ? 2 : 0;
  return out;
}

type TestJudgeCriterionKey = (typeof TEST_JUDGE_CRITERIA)[number];

/* ────────────────────────── tashqi manbalar ────────────────────────── */

/** Yuklangan fayl matni — tarjima ekstraktori orqali (`work/engine.ts` naqshi). */
async function resolveSource(meta: DocMeta, opts: TestBuildOpts): Promise<string> {
  if (meta.sourceText) return meta.sourceText;
  if (!opts.source) return "";
  if (opts.sourceTextOf) return opts.sourceTextOf(opts.source);
  try {
    const { extractSegments } = await import("../../translate/index");
    const ex = await extractSegments(opts.source.kind, opts.source.bytes);
    return ex.segments.map((s) => s.text).join("\n\n").slice(0, TEACHER_LIMITS.sourceTextChars);
  } catch (e) {
    console.warn("[test] manba fayl o'qilmadi:", e instanceof Error ? e.message : e);
    return "";
  }
}

/**
 * O'quv dasturi mavzulari — DINAMIK import: `lib/curriculum.ts` katta
 * JSON fayllarni `import()` bilan tortadi, dvigatel esa ular kerak
 * bo'lmaganda (mavzu/fayl rejimi) ularni umuman yuklamasligi kerak.
 */
async function resolveTopics(input: TestInput, opts: TestBuildOpts): Promise<PromptTopic[]> {
  if (opts.topics) return opts.topics(input.subject, input.grade, input.topicIds);
  try {
    const mod = await import("../../../curriculum");
    const entry = await mod.curriculumTopics(subjectIdOf(input.subject), input.grade);
    if (!entry) return [];
    const picked = input.topicIds.length ? mod.pickTopics(entry, input.topicIds) : mod.flatTopics(entry).slice(0, TEACHER_LIMITS.curriculumTopicsMax);
    const unitOf = (id: string) => entry.units.find((u) => u.topics.some((t) => t.id === id))?.title;
    return picked.map((t) => ({ id: t.id, title: t.title, ...(unitOf(t.id) ? { unit: unitOf(t.id)! } : {}) }));
  } catch (e) {
    console.warn("[test] o'quv dasturi yuklanmadi:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Fan NOMI → baza id si («Matematika» → `matematika`). */
export function subjectIdOf(subject: string): string {
  return String(subject ?? "")
    .toLowerCase()
    .replace(/[‘’ʻʼ']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** OMR PNG — DINAMIK import (`sharp` server-only; dvigatel izomorf qoladi). */
async function drawFigure(figure: Figure, lang: string, opts: TestBuildOpts): Promise<Figure | null> {
  try {
    const draw = opts.buildFigures ?? (await import("../../figures")).buildFigures;
    const out = await draw([figure], { lang });
    return out[0] ?? null;
  } catch (e) {
    console.warn("[test] javoblar varag'i chizilmadi:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Va'da qilingan savol soni bilan solishtirish (`delivered.ts`, WP-F). */
export function testDelivered(doc: AcademicDoc, values: FormValues): { got: number; want: number } | null {
  const model = doc.teacher?.test;
  if (!model) return null;
  const want = Number(values.count);
  return { got: model.questions.length, want: Number.isFinite(want) && want > 0 ? Math.round(want) : model.questions.length };
}
