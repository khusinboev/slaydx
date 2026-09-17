/**
 * AVTO-SAYQAL — SARALASH O'YINI (AUDIT-22 WP-D) — SOF, IZOMORF.
 *
 *   planSortingPolish(review, doc) → hisobotdagi tuzatiladigan bandlar
 *   runSortingPolish(doc, review)  → plan → apply → qayta hisobot →
 *                                    ball `acceptDelta` dan ko'p OSHSA qabul
 *   sortingUserNeeds(review, doc)  → «Sizdan kutiladi»
 *
 * Mantiq NEYTRAL yadroda (`report/polish-core.ts runPolishWith`) — bu
 * yerda faqat SARALASHGA XOS qismlar.
 *
 * ── O'yin MODEL shaklida qayta yoziladi (AUDIT-20/21 saboqi)
 *
 * Umumiy nasr yo'li (`blocksFromLlm` → `setSection`) bu yerda ATAYLAB
 * ishlatilmaydi. Bosma bo'limdagi ro'yxat ARALASH va toifasiz: uni
 * qayta o'qib modelni tiklash MUMKIN EMAS, ya'ni nasr yangilanib, model
 * (jadval, javob kaliti, interaktiv ekran va ball hisobi shundan
 * o'qiydi) eski holida qolardi. Shuning uchun sayqal MODEL so'raydi
 * (`sortingRewritePrompt`) va nasr shu ro'yxatdan QAYTA yig'iladi
 * (`sortingSections`).
 *
 * Nishon bitta (`sorting`): o'yin bo'linmaydigan butunlik — bitta
 * toifani alohida qayta yozish qolganlari bilan ikki ma'nolilikni
 * tekshirishni yo'qotardi.
 */
import type { AcademicDoc } from "../../types";
import type { DocReview, ReviewCheck, ReviewGuardInput, UserNeed } from "../../report/types";
import {
  POLISH_JUDGE_NOTE,
  POLISH_MAX_FIXES,
  POLISH_SKIP,
  REWRITE_TIMEOUT_MS,
  RewriteError,
  applyPolishWith,
  needsUserData,
  runPolishWith,
  type ApplyOpsResult,
  type ApplyPolishResultOf,
  type Fix,
  type PolishPlan,
  type PolishSkip,
  type RunPolishResult,
} from "../../report/polish-core";
import { parseLlmObject } from "../../json";
import { remainingMs } from "../../quality";
import type { LlmUsage } from "../../llm-roles";
import type { CompleteFn } from "../../research/pipeline";
import { gameTypeOf } from "../registry";
import { GAME_LIMITS, type GameModel, type SortingCategory } from "../types";
import { gameLayoutLabels } from "../layout";
import { numbered, pickCategories, sortingSections } from "./engine";
import { sortingLangOf, type SortingInput } from "./input";
import { sortingRewritePrompt, sortingSystemPrompt, type SortingContext } from "./prompts";
import { SORTING_TARGET, neutralSortingJudge, reviewSorting, scoreSortingReview, sortingJudgeChecks, type SortingJudgeResult } from "./review";

export { POLISH_SKIP, RewriteError };
export type { PolishPlan, PolishSkip };

export type SortingFix = Fix;

/** Q-3 qabul chegarasi — o'qituvchi hujjatlaridagi kabi +1. */
export const SORTING_ACCEPT_DELTA = 1;

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

/** Sayqal op tili — bu oilada BITTA amal: toifalar ro'yxatini almashtirish. */
export type SortingOp = { op: "setCategories"; categories: SortingCategory[] };

export type SortingRewriteDeps = { complete: CompleteFn; deadline?: number };

/* ────────────────────────── kontekst ────────────────────────── */

/** Dvigatel konteksti HUJJATDAN (forma qiymatlari endi yo'q). */
export function sortingContextOf(doc: AcademicDoc): SortingContext {
  const model = doc.game!;
  const cats = model.sorting?.categories ?? [];
  const language = model.language || doc.meta.language || "uz";
  const spec = gameTypeOf("sorting", model.type);
  const input: SortingInput = {
    type: spec.id,
    topic: model.topic || doc.meta.topic,
    subject: doc.meta.subject ?? "",
    language,
    lang: sortingLangOf(language),
    grade: Number(doc.meta.grade) || 0,
    categoryCount: cats.length || GAME_LIMITS.categoryCountDefault,
    itemsPerCategory: Math.max(...cats.map((c) => c.items.length), GAME_LIMITS.itemsPerCategoryDefault),
    extra: doc.meta.extra ?? "",
  };
  return { spec, input };
}

/* ────────────────────────── reja ────────────────────────── */

const rewriteFix = (target: string, instruction: string): SortingFix => ({ op: "rewrite", target, instruction });

/**
 * Past baholangan mezon → HALOL ko'rsatma. Baholovchi `fixes` bermasa
 * yoki hammasi Q-2 filtridan tushsa, sayqal bo'sh qolmasin.
 */
export function sortingCriterionFixes(review: DocReview, doc: AcademicDoc): SortingFix[] {
  const model = doc.game;
  if (!model?.sorting) return [];
  const level = (id: string) => review.checks.find((c) => c.id === `judge:${id}`)?.level;
  const low = (id: string) => level(id) === "red" || level(id) === "yellow";
  const out: SortingFix[] = [];
  const push = (instruction: string) => {
    if (!out.some((f) => f.instruction === instruction)) out.push(rewriteFix(SORTING_TARGET, instruction));
  };

  if (low("categoryClarity")) {
    push("Rename the unclear categories: each name must be a term the pupil already knows, short enough to read on a phone button, and clearly different from the others.");
  }
  if (low("itemFit")) {
    push("Replace the items a subject teacher would hesitate about with clear, textbook examples of the category they are listed under.");
  }
  if (low("unambiguity")) {
    push(
      "Go through the items once more against EVERY category, not only their own, and replace each item that could be defended in a second category. An ambiguous item makes the game unwinnable.",
    );
  }
  if (low("gradeLevel")) {
    push(`Replace the specialist examples with ones a pupil of ${Number(doc.meta.grade) > 0 ? `grade ${doc.meta.grade}` : "the stated level"} has actually met.`);
  }
  if (low("balance")) {
    push("Even out the categories: the same number of items in each, and no category filled with near-identical items.");
  }
  return out;
}

/**
 * Hisobot → fix rejasi.
 *
 * Avtomatik TUZATILMAYDI: `categoryCount` — bu MIQDOR bandi, uni
 * «tuzatish» yangi toifa o'ylab topish bo'lardi va `delivered`
 * allaqachon farqni qaytaradi; `answerKey` — bo'lim TUZILMASI
 * (nasr modeldan qayta yig'ilganda o'zi tiklanadi); `structure` — kod
 * xatosi, modelni qayta so'rash uni tuzatmaydi.
 */
const NOT_FIXABLE = new Set(["categoryCount", "answerKey", "structure"]);

export function planSortingPolish(review: DocReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  const instructions: string[] = [];
  if (!doc.game?.sorting) return { fixes: [], skipped: [{ id: "structure", reason: "manual" }] };

  const add = (instruction: string) => {
    if (!instructions.includes(instruction)) instructions.push(instruction);
  };

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  // Qizil avval — 60 % ulushda har qizil band butun yashilcha yo'qotadi.
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  for (const c of rules) {
    if (NOT_FIXABLE.has(c.id)) {
      skipped.push({ id: c.id, reason: c.id === "categoryCount" ? "user" : "manual" });
      continue;
    }
    if (!c.fix) {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    add(c.fix.instruction);
  }

  for (const c of review.checks) {
    if (!c.id.startsWith("judge:fix:") || !c.fix) continue;
    if (needsUserData(c.fix.instruction)) {
      skipped.push({ id: c.id, reason: "user" });
      continue;
    }
    add(c.fix.instruction);
  }
  for (const f of sortingCriterionFixes(review, doc)) add(f.instruction);

  if (!instructions.length) return { fixes: [], skipped };
  const capped = instructions.slice(0, POLISH_MAX_FIXES);
  for (const extra of instructions.slice(POLISH_MAX_FIXES)) skipped.push({ id: extra.slice(0, 40), reason: "limit" });
  return {
    fixes: [rewriteFix(SORTING_TARGET, capped.length === 1 ? capped[0] : capped.map((s, i) => `(${i + 1}) ${s}`).join(" "))],
    skipped,
  };
}

/* ────────────────────────── «Sizdan kutiladi» ────────────────────────── */

export function sortingUserNeeds(review: DocReview, doc: AcademicDoc): UserNeed[] {
  const out: UserNeed[] = [];
  if (!doc.game?.sorting) return out;

  const count = review.checks.find((c) => c.id === "categoryCount");
  if (count && count.level !== "green") {
    out.push({ id: "categoryCount", label: "Toifalar soni", hint: `${count.detail ?? ""} — mavzuni toraytiring yoki kamroq toifa tanlang` });
  }
  /*
   * Ikki ma'nolilik QIZIL qolgan bo'lsa — bu AI o'zi yopa olmaydigan
   * band: qaysi element qaysi toifaga tegishli ekani ko'pincha o'quv
   * dasturiga bog'liq (o'qituvchi qaysi tasnifni o'tgan). Sayqal
   * urinib ko'radi, lekin oxirgi so'z odamda.
   */
  const amb = review.checks.find((c) => c.id === "itemSingleCategory");
  if (amb && amb.level === "red") {
    out.push({
      id: "itemSingleCategory",
      label: "Ikki ma’noli elementlar",
      hint: `${amb.detail ?? ""} — qaysi tasnifni o‘tganingizni AI bilmaydi; elementni o‘zingiz almashtiring`,
    });
  }
  return out;
}

/* ────────────────────────── qayta yozish ────────────────────────── */

async function ask(deps: SortingRewriteDeps, system: string, user: string, maxTokens: number): Promise<string> {
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

/**
 * Bitta fix → op lar (hujjat O'ZGARMAYDI).
 *
 * Toifa soni ham, har toifadagi element soni ham SAQLANISHI shart: kam
 * qaytgan javob rad etiladi (`RewriteError`), chunki sayqal hech qachon
 * foydalanuvchi to'lagan elementni O'CHIRMASLIGI kerak — bu ballni
 * ko'tarib, mahsulotni kamaytirishning eng oson yo'li bo'lardi.
 */
export async function rewriteSortingFix(doc: AcademicDoc, fix: SortingFix, deps: SortingRewriteDeps): Promise<{ ops: SortingOp[] }> {
  const model = doc.game;
  if (!model?.sorting) throw new RewriteError("Saralash modeli yo‘q — qaytadan yarating", 409, "legacy");
  if (fix.target !== SORTING_TARGET) throw new RewriteError(`Nishon topilmadi: ${fix.target}`, 422, "target");

  const ctx = sortingContextOf(doc);
  const system = sortingSystemPrompt(ctx);
  const current = model.sorting.categories;
  const maxItems = Math.max(...current.map((c) => c.items.length));
  const raw = await ask(deps, system, sortingRewritePrompt(ctx, current, fix.instruction), Math.min(8000, 900 + current.length * maxItems * 45));
  const data = parseLlmObject<{ categories?: unknown; groups?: unknown }>(raw);
  const picked = pickCategories(data?.categories ?? data?.groups, {
    spec: ctx.spec,
    maxItems,
    seen: new Set<string>(),
    seenNames: new Set<string>(),
  });
  if (picked.length !== current.length) throw new RewriteError(RETRY_MSG, 422, "llm");
  for (const [i, c] of picked.entries()) {
    if (c.items.length !== current[i].items.length) throw new RewriteError(RETRY_MSG, 422, "llm");
  }
  // Barqaror id lar SAQLANADI — ball hisobi (`game_results.answers_json`) shularga tayanadi.
  const categories = numbered(picked).map((c, i) => ({ ...c, id: current[i].id }));
  return { ops: [{ op: "setCategories", categories }] };
}

/* ────────────────────────── op larni qo'llash ────────────────────────── */

/** `setCategories` — model VA nasr BIRGA almashadi. */
export function applySortingOps(doc: AcademicDoc, ops: SortingOp[]): ApplyOpsResult {
  const model = doc.game;
  if (!model?.sorting) return { ok: false, error: "saralash modeli yo‘q" };
  let categories = model.sorting.categories;
  for (const op of ops) {
    if (op.op !== "setCategories") return { ok: false, error: `noma'lum op: ${String((op as { op?: unknown }).op)}` };
    if (op.categories.length !== categories.length) return { ok: false, error: `toifa soni mos emas: ${op.categories.length} ≠ ${categories.length}` };
    const before = categories.reduce((n, c) => n + c.items.length, 0);
    const after = op.categories.reduce((n, c) => n + c.items.length, 0);
    if (after !== before) return { ok: false, error: `element soni mos emas: ${after} ≠ ${before}` };
    categories = op.categories;
  }
  const nextModel: GameModel = { ...model, sorting: { ...model.sorting, categories } };
  const L = gameLayoutLabels(nextModel.language || doc.meta.language);
  return { ok: true, doc: { ...doc, game: nextModel, sections: sortingSections(nextModel.sorting!, L) } };
}

/* ────────────────────────── ball ko'chirish ────────────────────────── */

/** Avvalgi hisobotdan baholovchi ballari — `judge:*` bandlaridan. */
export function sortingJudgeFromReview(prev: DocReview | undefined, model: GameModel): SortingJudgeResult | null {
  if (!prev) return null;
  const j = neutralSortingJudge(model);
  const criteria = gameTypeOf("sorting", model.type).judge.criteria as readonly string[];
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

export type SortingApplyPolishResult = ApplyPolishResultOf<SortingOp>;

const rewriteForCore = async (doc: AcademicDoc, fix: SortingFix, deps: SortingRewriteDeps) => {
  const r = await rewriteSortingFix(doc, fix, deps);
  return { ops: r.ops, unresolved: [], rewrittenSections: [SORTING_TARGET] };
};

export async function applySortingPolish(doc: AcademicDoc, fixes: SortingFix[], deps: SortingRewriteDeps & { concurrency?: number }): Promise<SortingApplyPolishResult> {
  return applyPolishWith<SortingOp>(doc, fixes, { concurrency: deps.concurrency, rewrite: (d, fix) => rewriteForCore(d, fix, deps) });
}

export type SortingPolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  judge?: boolean;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  concurrency?: number;
  acceptDelta?: number;
};

export type SortingPolishResult = RunPolishResult<SortingOp>;

export async function runSortingPolish(doc: AcademicDoc, review: DocReview, deps: SortingPolishDeps): Promise<SortingPolishResult> {
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const model = doc.game;
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  return runPolishWith<SortingOp, SortingJudgeResult>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    ...(deps.guard ? { guard: deps.guard } : {}),
    ...(deps.concurrency ? { concurrency: deps.concurrency } : {}),
    acceptDelta: deps.acceptDelta ?? SORTING_ACCEPT_DELTA,
    plan: planSortingPolish,
    userNeeds: sortingUserNeeds,
    rewrite: (d, fix, deadline) => rewriteForCore(d, fix, { complete, deadline }),
    apply: applySortingOps,
    review: (d) => reviewSorting(d, { complete, deadline: deps.deadline, judge, now }),
    judgeFromReview: (prev) => (model ? sortingJudgeFromReview(prev, model) : null),
    rescore: (fresh, j) => {
      if (!model) return fresh;
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      return { ...fresh, score: scoreSortingReview(rules, model, j), checks: [...rules, ...sortingJudgeChecks(model, j)], judgeNotes: [...j.notes, POLISH_JUDGE_NOTE] };
    },
  });
}
