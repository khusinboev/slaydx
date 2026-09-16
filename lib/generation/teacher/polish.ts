/**
 * AVTO-SAYQAL — O'QITUVCHI VOSITALARI (AUDIT-20 WP-A) — SOF, IZOMORF.
 *
 *   planTeacherPolish(review, doc)  → hisobotdagi tuzatiladigan bandlar → ≤6 fix
 *   runTeacherPolish(doc, review)   → plan → apply → qayta hisobot →
 *                                     ball `acceptDelta` (+1) dan ko'p
 *                                     OSHSA qabul
 *   teacherUserNeeds(review, doc)   → «Sizdan kutiladi»
 *
 * Mantiq NEYTRAL yadroda (`report/polish-core.ts runPolishWith`) — bu
 * yerda faqat O'QITUVCHI HUJJATIGA XOS qismlar.
 *
 * Ikki farq `work/polish.ts` dan:
 *
 *   1. JADVAL nishoni (`table:0`). Xaritada hujjatning butun mazmuni
 *      jadvalda: bo'lim matnini qayta yozish u yerda hech nimani
 *      tuzatmaydi, shuning uchun sayqal jadval QATORLARINI ham qayta
 *      yoza oladi (qator va ustun soni O'ZGARMAYDI — aks holda model
 *      bilan pasport qatori ajralib ketardi).
 *   2. `acceptDelta` +1 (reja bo'yicha; talaba ishida +2). Bu hujjatlar
 *      qisqa va baholovchi ballari kamroq tebranadi.
 *
 * `apply` VAQTINCHA shu faylda (`applyTeacherSectionOps`): WP-D
 * `teacher/edit.ts applyTeacherOps` ni berganda `deps.apply` almashadi.
 */
import type { AcademicDoc, Block, DocTable } from "../types";
import type { DocReview, ReviewCheck, ReviewGuardInput, UserNeed } from "../report/types";
import {
  HONESTY_LIMIT,
  POLISH_JUDGE_NOTE,
  POLISH_MAX_FIXES,
  POLISH_SKIP,
  REWRITE_TIMEOUT_MS,
  RewriteError,
  applyPolishWith,
  keepVisuals,
  needsUserData,
  runPolishWith,
  type ApplyOpsResult,
  type ApplyPolishResultOf,
  type Fix,
  type PolishPlan,
  type PolishSkip,
  type RunPolishResult,
} from "../report/polish-core";
import { parseLlmObject } from "../json";
import { remainingMs } from "../quality";
import { blocksFromLlm } from "../article/parse";
import type { LlmUsage } from "../llm-roles";
import type { CompleteFn } from "../research/pipeline";
import type { TeacherModel } from "./types";
import { teacherTypeOf } from "./registry";
import { teacherLabels, teacherRewritePrompt, teacherSystemPrompt, teacherTableRewritePrompt, type TeacherContext } from "./prompts";
import type { TeacherInput, TeacherLang } from "./input";
import { clip } from "./guard";
import { applyTeacherOps, teacherOpsFromPolish } from "./edit";
import { neutralTeacherJudge, parseTableTarget, reviewTeacher, scoreTeacherReview, teacherJudgeChecks, type TeacherJudgeResult } from "./review";

export { HONESTY_LIMIT, POLISH_SKIP, RewriteError };
export type { PolishPlan, PolishSkip };

export type TeacherFix = Fix;

/** Q-3 qabul chegarasi — reja bo'yicha +1. */
export const TEACHER_ACCEPT_DELTA = 1;

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

/**
 * VAQTINCHA op tipi. WP-D `teacher/edit.ts` to'liq `TeacherOp` beradi;
 * sayqalga esa ikki amal yetadi — bo'lim bloklarini va jadval
 * qatorlarini ALMASHTIRISH.
 */
export type TeacherSectionOp =
  | { op: "setSection"; sectionId: string; blocks: Block[] }
  | { op: "setTable"; index: number; rows: string[][] };

export type TeacherRewriteDeps = { complete: CompleteFn; deadline?: number };

export type TeacherRewriteOut = { ops: TeacherSectionOp[] };

/* ────────────────────────── kontekst ────────────────────────── */

/**
 * Dvigatel konteksti HUJJATDAN (forma qiymatlari endi yo'q) —
 * `workContextOf` naqshi. Faqat qayta yozish promptiga kerak bo'lgan
 * maydonlar to'ldiriladi; qolganlari `TeacherInput` ning standartlari.
 */
export function teacherContextOf(doc: AcademicDoc): TeacherContext {
  const model = doc.teacher!;
  const school = model.school;
  const langRaw = (school.language || doc.meta.language || "uz").toLowerCase();
  const language: TeacherLang = langRaw === "ru" ? "ru" : langRaw === "en" ? "en" : "uz";
  const input: TeacherInput = {
    kind: model.kind,
    type: model.type,
    topic: doc.meta.topic,
    subject: school.subject || doc.meta.subject,
    language,
    institution: school.institution,
    author: school.author,
    approver: school.approver ?? "",
    grade: school.grade,
    gradeLetter: school.gradeLetter ?? "",
    date: school.date ?? "",
    extra: doc.meta.extra ?? "",
    sourceText: "",
    duration: model.lesson?.durationMin ?? doc.meta.duration,
    stageCount: model.lesson?.stages.length ?? 6,
    competencies: model.lesson?.competencies ?? [],
    assessmentStyle: "an'anaviy",
    mapType: model.map?.type ?? "yillik",
    weeklyHours: model.map?.weeklyHours ?? doc.meta.weeklyHours,
    totalHours: model.map?.totalHours ?? doc.meta.totalHours,
    controlLink: "erkin",
    termCount: model.glossary?.terms.length ?? doc.meta.termCount,
    includeExample: Boolean(model.glossary?.includeExample),
    translationLangs: model.glossary?.terms.some((t) => t.ru || t.en) ? ["ru", "en"] : [],
    caseCount: model.keys?.cases.length ?? 5,
    audience: model.keys?.audience ?? "otm",
    curriculumSubject: "",
    topicIds: [],
  };
  return {
    kind: model.kind,
    spec: teacherTypeOf(model.kind, model.type),
    input,
    /*
     * `sourceText` ATAYLAB bo'sh: manba fayl `doc_json` da saqlanmaydi
     * va uni qayta o'qish serverga bog'lanish bo'lardi. Qayta yozish
     * mavjud MATN ustida ishlaydi, manbadan yangi fakt olmaydi — bu
     * halollik chegarasiga ham mos.
     */
    meta: { ...doc.meta, sourceText: "" },
    labels: teacherLabels(language),
    curriculum: [],
  };
}

/* ────────────────────────── reja ────────────────────────── */

const rewriteFix = (target: string, instruction: string): TeacherFix => ({ op: "rewrite", target, instruction });

/**
 * Past baholangan mezon → HALOL ko'rsatma. Baholovchi `fixes` bermasa
 * yoki hammasi Q-2 filtridan tushsa, sayqal bo'sh qolmasin
 * (`workCriterionFixes` naqshi, AUDIT-18 jonli saboqi).
 */
export function teacherCriterionFixes(review: DocReview, doc: AcademicDoc): TeacherFix[] {
  const model = doc.teacher;
  if (!model) return [];
  const level = (id: string) => review.checks.find((c) => c.id === `judge:${id}`)?.level;
  const low = (id: string) => level(id) === "red" || level(id) === "yellow";
  const has = (id: string) => doc.sections.some((s) => s.id === id && s.blocks.length);
  const out: TeacherFix[] = [];
  const push = (target: string | null, instruction: string) => {
    if (target && !out.some((f) => f.target === target)) out.push(rewriteFix(target, instruction));
  };

  if (model.kind === "lesson") {
    if (low("topicAlignment") || low("pedagogicalVariety")) push(has("stages") ? "stages" : null, `Rewrite the stages so that each names a concrete example, question or exercise from «${doc.meta.topic}» and the interaction modes differ (teacher-led, pair, independent). Keep the stage count and the minutes.`);
    if (low("ageFit")) push(has("goal") ? "goal" : null, `State the three objectives in the vocabulary of grade ${model.school.grade || "the stated level"}, each about this topic, one sentence per objective.`);
    if (low("homeworkRelevance")) push(has("homework") ? "homework" : null, "Rewrite the homework so that it directly practises what the lesson goal states, in a volume a pupil of this grade can finish at home.");
  }
  if (model.kind === "map") {
    if (low("topicProgression") || low("methodDiversity") || low("controlFit") || low("subjectCoherence")) push("table:0", "Rewrite the table rows: topics ordered from simpler to more complex, methods varied and matched to the topic, and the control column matching both. Keep the week numbers and the hours column unchanged.");
  }
  if (model.kind === "glossary") {
    if (low("definitionAccuracy") || low("levelFit") || low("exampleQuality")) push(has("terms") ? "terms" : null, "Rewrite the weak definitions so that each says what the thing IS, through what mechanism, and what distinguishes it; keep the terms and the alphabetical order unchanged.");
  }
  if (model.kind === "keys") {
    if (low("situationRealism") || low("taskAlignment")) push(has("case1") ? "case1" : null, "Make the situation concrete (named roles, setting, the numbers the tasks rely on) and make every task depend on those facts. It remains a fictional teaching case.");
    if (low("rubricSpecificity")) push(has("rubric") ? "rubric" : null, "Rewrite the rubric criteria so that each names what exactly is assessed in THAT case; keep the point values.");
  }
  return out;
}

/**
 * Hisobot → fix rejasi. Qoidalarning O'Z `fix` i + baholovchi
 * tavsiyalari (Q-2 filtri bilan) + mezon tuzatishlari.
 *
 * Avtomatik TUZATILMAYDI: `termCount`, `caseCount`, `weekCount`,
 * `stageCount` — ular MIQDOR bandlari, ularni «tuzatish» yangi
 * material o'ylab topish bo'lardi va `delivered` allaqachon farqni
 * qaytaradi. `hoursSum`/`minutesSum`/`rubricSum` ham yo'q: ular
 * QO'RIQCHI arifmetikasi, qizil bo'lsa kod xatosi — modelni qayta
 * so'rash uni tuzatmaydi.
 */
const NOT_FIXABLE = new Set(["termCount", "caseCount", "weekCount", "stageCount", "hoursSum", "minutesSum", "rubricSum", "alphaOrder", "structure"]);

export function planTeacherPolish(review: DocReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  const candidates: TeacherFix[] = [];
  if (!doc.teacher) return { fixes: [], skipped: [{ id: "legacy", reason: "manual" }] };

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  // Qizil avval — 60 % ulushda har qizil band butun yashilcha yo'qotadi.
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  for (const c of rules) {
    if (NOT_FIXABLE.has(c.id)) {
      skipped.push({ id: c.id, reason: c.id === "termCount" || c.id === "caseCount" || c.id === "weekCount" ? "user" : "manual" });
      continue;
    }
    if (!c.fix) {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    candidates.push(rewriteFix(c.fix.target, c.fix.instruction));
  }

  for (const c of review.checks) {
    if (!c.id.startsWith("judge:fix:") || !c.fix) continue;
    if (needsUserData(c.fix.instruction)) {
      skipped.push({ id: c.id, reason: "user" });
      continue;
    }
    candidates.push(rewriteFix(c.fix.target, c.fix.instruction));
  }
  const targets = new Set(candidates.map((f) => f.target));
  for (const f of teacherCriterionFixes(review, doc)) if (!targets.has(f.target)) candidates.push(f);

  /* ── nishon mavjudligi + bitta nishon = bitta fix ── */
  const validSection = new Set(doc.sections.filter((s) => s.blocks.length).map((s) => s.id));
  const tableCount = doc.tables?.length ?? 0;
  const merged = new Map<string, string[]>();
  for (const f of candidates) {
    const tbl = parseTableTarget(f.target);
    const ok = tbl === null ? validSection.has(f.target) : tbl < tableCount;
    if (!ok) continue;
    const listed = merged.get(f.target) ?? [];
    if (!listed.includes(f.instruction)) listed.push(f.instruction);
    merged.set(f.target, listed);
  }
  const fixes: TeacherFix[] = [];
  for (const [target, instructions] of merged) {
    if (fixes.length >= POLISH_MAX_FIXES) {
      skipped.push({ id: target, reason: "limit" });
      continue;
    }
    fixes.push(rewriteFix(target, instructions.length === 1 ? instructions[0] : instructions.map((s, i) => `(${i + 1}) ${s}`).join(" ")));
  }
  return { fixes, skipped };
}

/* ────────────────────────── «Sizdan kutiladi» ────────────────────────── */

/**
 * AI O'YLAB TOPMAYDIGAN narsalar (Q-2). O'qituvchi vositalarida ular
 * uchta: shapka maydonlari, darslik/dastur havolasi va miqdor
 * kamomadi.
 */
export function teacherUserNeeds(review: DocReview, doc: AcademicDoc): UserNeed[] {
  const out: UserNeed[] = [];
  const model = doc.teacher;
  if (!model) return out;
  const find = (id: string) => review.checks.find((c) => c.id === id);

  const header: [string, string][] = [
    [model.school.institution, "muassasa nomi"],
    [model.school.author, "tuzuvchi F.I.Sh."],
  ];
  const empty = header.filter(([v]) => !String(v ?? "").trim()).map(([, label]) => label);
  if (empty.length) out.push({ id: "header", label: "Hujjat shapkasi", hint: `To‘ldirilmagan: ${empty.join(", ")} — shapkada bo‘sh qoladi` });

  /*
   * Darslik sahifasi / dastur bandi — halollik chegarasi. Model ularni
   * BILMAYDI; foydalanuvchi `extra` da so'ragan bo'lsa, javob uydirma
   * bo'lardi. Shuning uchun so'rov bandga aylanadi.
   */
  if (/darslik|sahifa|bet raqam|dastur band|страниц|textbook page/i.test(String(doc.meta.extra ?? ""))) {
    out.push({
      id: "textbook",
      label: "Darslik ma’lumoti",
      hint: "Darslik sahifasi va rasmiy dastur bandi raqamini AI bilmaydi — ularni o‘zingiz qo‘shing (uydirma raqam yozilmaydi)",
    });
  }

  for (const [id, label, hint] of [
    ["termCount", "Atamalar soni", "so‘ralgan atamalarning hammasi topilmadi — mavzuni toraytiring yoki kamroq atama tanlang"],
    ["caseCount", "Keyslar soni", "so‘ralgan keyslarning hammasi chiqmadi — mavzuni aniqlashtiring"],
    ["weekCount", "Haftalar soni", "soatlardan chiqqan haftalar to‘liq to‘lmadi — haftalik/jami soatni tekshiring"],
  ] as const) {
    const c = find(id);
    if (c && c.level !== "green") out.push({ id, label, hint: `${c.detail ?? ""} — ${hint}` });
  }
  return out;
}

/* ────────────────────────── qayta yozish ────────────────────────── */

async function ask(deps: TeacherRewriteDeps, system: string, user: string, maxTokens: number): Promise<string> {
  const timeoutMs = Math.max(1, Math.min(REWRITE_TIMEOUT_MS, remainingMs(deps.deadline)));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bomb = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const r = await Promise.race([deps.complete("writer", system, user, { json: true, maxTokens, timeoutMs }).catch(() => null), bomb]);
    if (!r?.text) throw new RewriteError(RETRY_MSG, 422, "llm");
    return r.text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Jadval qatorlari — qator va ustun soni O'ZGARMAYDI. */
function rowsFromLlm(raw: unknown, table: DocTable): string[][] | null {
  if (!Array.isArray(raw)) return null;
  const width = table.headers.length;
  const rows: string[][] = [];
  for (const r of raw) {
    if (!Array.isArray(r)) continue;
    const cells = r.slice(0, width).map((c) => clip(c, 200));
    while (cells.length < width) cells.push("");
    rows.push(cells);
  }
  if (rows.length !== table.rows.length) return null;
  return rows;
}

/**
 * Bitta fix → op lar (hujjat O'ZGARMAYDI). Nishon — bo'lim id si yoki
 * `table:<n>`.
 */
export async function rewriteTeacherFix(doc: AcademicDoc, fix: TeacherFix, deps: TeacherRewriteDeps): Promise<TeacherRewriteOut> {
  if (!doc.teacher) throw new RewriteError("Eski hujjatda «Tuzatish» yo'q — qaytadan yarating", 409, "legacy");
  const ctx = teacherContextOf(doc);
  const system = teacherSystemPrompt(ctx);

  const tableIndex = parseTableTarget(fix.target);
  if (tableIndex !== null) {
    const table = doc.tables?.[tableIndex];
    if (!table) throw new RewriteError(`Jadval topilmadi: ${fix.target}`, 422, "target");
    const raw = await ask(deps, system, teacherTableRewritePrompt(ctx, table.headers, table.rows, fix.instruction), Math.min(8000, 800 + table.rows.length * table.headers.length * 24));
    const rows = rowsFromLlm(parseLlmObject<{ rows?: unknown }>(raw)?.rows, table);
    if (!rows) throw new RewriteError(RETRY_MSG, 422, "llm");
    return { ops: [{ op: "setTable", index: tableIndex, rows }] };
  }

  const section = doc.sections.find((s) => s.id === fix.target);
  if (!section) throw new RewriteError(`Bo'lim topilmadi: ${fix.target}`, 422, "target");
  const current = section.blocks.map((b) => b.text).join("\n\n").slice(0, 12_000);
  const raw = await ask(deps, system, teacherRewritePrompt(ctx, section.title, current, fix.instruction), Math.min(8000, Math.max(1500, current.length)));
  const parsed = parseLlmObject<{ blocks?: unknown }>(raw);
  const blocks = blocksFromLlm(parsed?.blocks, raw);
  if (!blocks.length) throw new RewriteError(RETRY_MSG, 422, "llm");
  return { ops: [{ op: "setSection", sectionId: section.id, blocks: keepVisuals(section.blocks, blocks) }] };
}

/* ────────────────────────── op larni qo'llash ────────────────────────── */

/**
 * Sayqal op larini QO'LLASH — WP-D dan beri `teacher/edit.ts
 * applyTeacherOps` orqali (standart `deps.apply`).
 *
 * Nega to'g'ridan-to'g'ri emas: sayqal tili (`setSection`/`setTable`)
 * tahrir tilidan tor, va MUHIMI — `applyTeacherOps` jadval katagini
 * MODELGA ham ko'chiradi. Ilgari (`applyTeacherSectionOps`) sayqal
 * xarita jadvalini qayta yozganda `map.quarters[].weeks[]` eski
 * mavzular bilan qolardi: hisobot qayta hisoblanganda (`runPolishWith`
 * → `reviewTeacher`) qoidalar YANGI jadvalni, baholovchi esa ESKI
 * modelni ko'rardi va ball ikki manbadan chiqardi.
 */
export function applyTeacherPolishOps(doc: AcademicDoc, ops: TeacherSectionOp[]): ApplyOpsResult {
  const r = applyTeacherOps(doc, teacherOpsFromPolish(ops), { genId: "" });
  return r.ok ? { ok: true, doc: r.doc } : { ok: false, error: r.error };
}

/**
 * ZAXIRA `apply` — `setSection` va `setTable` ni modelga tegmasdan
 * qo'llaydi. Eski hujjat (`doc.teacher` yo'q) uchun qoladi:
 * `applyTeacherOps` unda ataylab 409 beradi, sayqal esa matnni
 * baribir tuzata oladi.
 */
export function applyTeacherSectionOps(doc: AcademicDoc, ops: TeacherSectionOp[]): ApplyOpsResult {
  const next: AcademicDoc = {
    ...doc,
    sections: doc.sections.map((s) => ({ ...s, blocks: [...s.blocks] })),
    ...(doc.tables ? { tables: doc.tables.map((t) => ({ ...t, rows: t.rows.map((r) => [...r]) })) } : {}),
  };
  for (const op of ops) {
    if (op.op === "setSection") {
      const target = next.sections.find((s) => s.id === op.sectionId);
      if (!target) return { ok: false, error: `bo'lim topilmadi: ${op.sectionId}` };
      if (!op.blocks.length) return { ok: false, error: `bo'sh matn: ${op.sectionId}` };
      target.blocks = op.blocks.map((b) => ({ ...b }));
      continue;
    }
    if (op.op === "setTable") {
      const table = next.tables?.[op.index];
      if (!table) return { ok: false, error: `jadval topilmadi: ${op.index}` };
      if (op.rows.length !== table.rows.length) return { ok: false, error: `qator soni mos emas: ${op.index}` };
      table.rows = op.rows.map((r) => [...r]);
      continue;
    }
    return { ok: false, error: `noma'lum op: ${String((op as { op?: unknown }).op)}` };
  }
  return { ok: true, doc: next };
}

/* ────────────────────────── ball ko'chirish ────────────────────────── */

/** Avvalgi hisobotdan baholovchi ballari — `judge:*` bandlaridan. */
export function teacherJudgeFromReview(prev: DocReview | undefined, model: TeacherModel): TeacherJudgeResult | null {
  if (!prev) return null;
  const j = neutralTeacherJudge(model);
  const criteria = teacherTypeOf(model.kind, model.type).judge.criteria as readonly string[];
  let any = false;
  for (const c of criteria) {
    const m = /^(\d)\/3$/.exec(prev.checks.find((x) => x.id === `judge:${c}`)?.detail ?? "");
    if (!m) continue;
    (j as Record<string, unknown>)[c] = Math.max(0, Math.min(3, Number(m[1])));
    any = true;
  }
  if (!any) return null;
  const skipped = criteria.filter((c) => !prev.checks.some((x) => x.id === `judge:${c}`));
  if (skipped.length) j.skipped = [...skipped];
  j.notes = prev.judgeNotes.filter((n) => n !== POLISH_JUDGE_NOTE);
  j.fixes = prev.checks
    .filter((c): c is ReviewCheck & { fix: NonNullable<ReviewCheck["fix"]> } => c.id.startsWith("judge:fix:") && Boolean(c.fix))
    .map((c) => ({ target: c.fix.target, instruction: c.fix.instruction }));
  return j;
}

/* ────────────────────────── apply / run ────────────────────────── */

export type TeacherApplyPolishResult = ApplyPolishResultOf<TeacherSectionOp>;

const rewriteForCore = async (doc: AcademicDoc, fix: TeacherFix, deps: TeacherRewriteDeps) => {
  const r = await rewriteTeacherFix(doc, fix, deps);
  return {
    ops: r.ops,
    unresolved: [],
    rewrittenSections: r.ops.map((op) => (op.op === "setSection" ? op.sectionId : `table:${op.index}`)),
  };
};

export async function applyTeacherPolish(doc: AcademicDoc, fixes: TeacherFix[], deps: TeacherRewriteDeps & { concurrency?: number }): Promise<TeacherApplyPolishResult> {
  return applyPolishWith<TeacherSectionOp>(doc, fixes, { concurrency: deps.concurrency, rewrite: (d, fix) => rewriteForCore(d, fix, deps) });
}

export type TeacherPolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  judge?: boolean;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  concurrency?: number;
  /** WP-D `teacher/edit.ts applyTeacherOps` — berilmasa vaqtinchalik `setSection`/`setTable`. */
  apply?: (doc: AcademicDoc, ops: TeacherSectionOp[]) => ApplyOpsResult;
  /** Q-3 chegarasi; standart `TEACHER_ACCEPT_DELTA` (+1). */
  acceptDelta?: number;
};

export type TeacherPolishResult = RunPolishResult<TeacherSectionOp>;

export async function runTeacherPolish(doc: AcademicDoc, review: DocReview, deps: TeacherPolishDeps): Promise<TeacherPolishResult> {
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const model = doc.teacher;
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  return runPolishWith<TeacherSectionOp, TeacherJudgeResult>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    guard: deps.guard,
    concurrency: deps.concurrency,
    acceptDelta: deps.acceptDelta ?? TEACHER_ACCEPT_DELTA,
    plan: planTeacherPolish,
    userNeeds: teacherUserNeeds,
    rewrite: (d, fix, deadline) => rewriteForCore(d, fix, { complete, deadline }),
    // Modelli hujjat — `applyTeacherOps` (model ⇄ jadval izchil);
    // eski hujjatda u 409 beradi, shuning uchun matn-only zaxira.
    apply: (d, ops) => (deps.apply ? deps.apply(d, ops) : d.teacher ? applyTeacherPolishOps(d, ops) : applyTeacherSectionOps(d, ops)),
    review: (d, guard) => reviewTeacher(d, { complete, deadline: deps.deadline, judge, now, guard }),
    judgeFromReview: (prev) => (model ? teacherJudgeFromReview(prev, model) : null),
    rescore: (fresh, j) => {
      if (!model) return fresh;
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      return { ...fresh, score: scoreTeacherReview(rules, model, j), checks: [...rules, ...teacherJudgeChecks(model, j)], judgeNotes: [...j.notes, POLISH_JUDGE_NOTE] };
    },
  });
}
