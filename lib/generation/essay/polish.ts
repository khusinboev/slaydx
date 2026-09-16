/**
 * INSHO AVTO-SAYQALI (AUDIT-19 WP-D) — neytral yadro ustidagi yupqa o'ram.
 *
 *   planEssayPolish(review, doc)  → hisobotdagi tuzatiladigan bandlar → ≤3 fix
 *   rewriteEssayFix(doc, fix)     → `writer` roli butun inshoni qayta yozadi
 *   runEssayPolish(doc, review)   → plan → apply → qayta hisobot → Q-3
 *
 * Mantiq `report/polish-core.ts` (`runPolishWith`) da — maqola va kurs
 * ishi bilan bitta yadro; bu yerda faqat inshoga XOS qism:
 *
 *   • NISHONLAR uchta: `essay` (butun matn), `intro`, `conclusion`.
 *     Insho kichik matn (250–1 400 so'z) — chekka bandni ham butun
 *     matnni qaytarib olib almashtirgan ishonchliroq: model paragraf
 *     chegarasini o'zi bilmaydi.
 *   • Q-2 HALOLLIK — `needsUserData` filtri: «tajriba natijalaringizni
 *     keltiring» kabi tavsiya bajarilmaydi (`reason: "user"`), aks holda
 *     model raqam O'YLAB TOPADI.
 *   • Q-3 QABUL CHEGARASI `ESSAY_ACCEPT_DELTA = 1`: insho bali kichik
 *     matnda shovqinli (bitta klişe ±3 ball), shuning uchun «bir ball
 *     oshdi» yetarli emas — X-5 naqshi.
 *   • ≤3 fix: bitta chaqiruv butun inshoni qayta yozadi, uchtadan ortiq
 *     to'lqin byudjetga sig'maydi va bir-birini bekor qiladi.
 */
import type { AcademicDoc, Block, DocMeta } from "../types";
import type { LlmUsage } from "../llm-roles";
import { remainingMs } from "../quality";
import { JUDGE_NO_ANSWER } from "../report/judge";
import {
  HONESTY_LIMIT,
  POLISH_JUDGE_NOTE,
  POLISH_SKIP,
  REWRITE_TIMEOUT_MS,
  RewriteError,
  needsUserData,
  runPolishWith,
  type ApplyOpsResult,
  type Fix,
  type PolishPlan,
  type PolishSkip,
  type RewriteOutOf,
  type RunPolishResult,
} from "../report/polish-core";
import type { DocReview, UserNeed } from "../report/types";
import { essayKindSpec } from "./registry";
import { essayBlocksFromLlm } from "./parse";
import { essayCtx, rewritePrompt, essaySystemPrompt, type EssayCtx, type EssayRewriteTarget } from "./prompts";
import { essayJudgeChecks, essayModelOf, essaySection, essayTextOf, reviewEssay, type CompleteFn } from "./review";
import { essayJudgeOf, essayRubric, essayScore, type EssayJudge } from "./rubric";
import type { EssayInput } from "./input";
import type { EssayJudgeCriterion, EssayModel } from "./types";

/* ────────────────────────── konstantalar ────────────────────────── */

/** Q-3: yangi ball eskisidan SHUNDAN ko'p oshsagina qabul qilinadi. */
export const ESSAY_ACCEPT_DELTA = 1;
/** Bir sayqalda ko'pi bilan shuncha tuzatish (butun matn qayta yoziladi). */
export const ESSAY_MAX_FIXES = 3;
/** Avto-sayqal: hisobot balli shundan past bo'lsa ishga tushadi. */
export const ESSAY_POLISH_BELOW = 90;
/** Sayqal uchun byudjetdan kamida shuncha qolishi kerak. */
export const ESSAY_POLISH_MIN_MS = 70_000;

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

/* ────────────────────────── op lar ────────────────────────── */

/** Insho tahriri — butun bo'lim bloklari almashadi (jadval/sxema yo'q). */
export type EssayOp = { op: "setEssay"; blocks: Block[] };

/**
 * Op larni hujjatga qo'llash — CHUQUR NUSXA ustida (kirish o'zgarmaydi).
 * Epigraf bloki (birinchi `quote`) saqlanadi: model uni qaytarmasa ham
 * insho epigrafsiz qolmasin.
 */
export function applyEssayOps(doc: AcademicDoc, ops: EssayOp[]): ApplyOpsResult {
  const section = essaySection(doc);
  if (!section) return { ok: false, error: "insho bo'limi topilmadi" };
  const model = essayModelOf(doc);
  const text = essayTextOf(doc, model);
  const next: AcademicDoc = { ...doc, sections: doc.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => ({ ...b })) })) };
  for (const op of ops) {
    if (op.op !== "setEssay") return { ok: false, error: `noma'lum op: ${(op as { op: string }).op}` };
    if (!op.blocks.length) return { ok: false, error: "bo'sh matn" };
    const epigraph: Block[] = text.epigraph ? [{ kind: "quote", text: text.epigraph }] : [];
    const target = next.sections.find((s) => s.id === section.id)!;
    target.blocks = [...epigraph, ...op.blocks.map((b) => ({ ...b }))];
    // Insho bitta bo'limda — qolgan bo'limlar (eski hujjat) bo'shatiladi.
    for (const s of next.sections) if (s.id !== section.id) s.blocks = [];
  }
  return { ok: true, doc: next };
}

/* ────────────────────────── kontekst ────────────────────────── */

/** Dvigatel konteksti HUJJATDAN — forma qiymatlari endi yo'q. */
export function contextOf(doc: AcademicDoc): EssayCtx {
  const model: EssayModel = essayModelOf(doc);
  const kind = essayKindSpec(model.context, model.kind);
  const meta: DocMeta = doc.meta;
  const input: EssayInput = {
    topic: meta.topic,
    context: model.context,
    kind: model.kind,
    language: model.language,
    pages: Math.max(1, Math.min(5, Math.round(meta.targetPages || 2))),
    wordTarget: model.words.aim,
    workTitle: model.workTitle ?? "",
    epigraph: model.epigraph ?? null,
    userFacts: model.userFacts ?? "",
    design: model.design ?? meta.design ?? "",
    person: model.person ?? contextPerson(model),
    extra: meta.extra ?? "",
    sourceText: "",
  };
  const ctx = essayCtx(meta, input);
  // Hajm MODELDAN (hujjat qanday va'da bilan yozilgan bo'lsa shu bilan baholanadi).
  return { ...ctx, words: model.words, kind };
}

function contextPerson(model: EssayModel): "first" | "third" {
  return model.context === "academic" ? "third" : "first";
}

/* ────────────────────────── reja ────────────────────────── */

const fixOf = (target: string, instruction: string): Fix => ({ op: "rewrite", target, instruction });

/**
 * Hisobot → tuzatiladigan bandlar. Qizil bandlar avval (60/40 ulushda
 * har qizil band butun yashilchani yo'qotadi), keyin baholovchi
 * tavsiyalari (Q-2 filtri bilan). Bir NISHONGA bir nechta ko'rsatma
 * birlashtiriladi — insho ikki marta parallel qayta yozilmasin.
 */
export function planEssayPolish(review: DocReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  const candidates: Fix[] = [];
  const section = essaySection(doc);
  if (!section) return { fixes: [], skipped: [{ id: "legacy", reason: "manual" }] };

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  for (const c of rules) {
    if (!c.fix) {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    if (needsUserData(c.fix.instruction)) {
      skipped.push({ id: c.id, reason: "user" });
      continue;
    }
    candidates.push(fixOf(c.fix.target, c.fix.instruction));
  }
  for (const c of review.checks) {
    if (!c.id.startsWith("judge:fix:") || !c.fix) continue;
    if (needsUserData(c.fix.instruction)) {
      skipped.push({ id: c.id, reason: "user" });
      continue;
    }
    candidates.push(fixOf(c.fix.target, c.fix.instruction));
  }

  const valid = (t: string) => t === "essay" || t === "intro" || t === "conclusion";
  const merged = new Map<string, string[]>();
  for (const f of candidates) {
    const target = valid(f.target) ? f.target : "essay";
    const list = merged.get(target) ?? [];
    if (!list.includes(f.instruction)) list.push(f.instruction);
    merged.set(target, list);
  }
  const fixes: Fix[] = [];
  for (const [target, list] of merged) {
    if (fixes.length >= ESSAY_MAX_FIXES) {
      skipped.push({ id: target, reason: "limit" });
      continue;
    }
    fixes.push(fixOf(target, list.length === 1 ? list[0] : list.map((s, i) => `(${i + 1}) ${s}`).join(" ")));
  }
  return { fixes, skipped };
}

/* ────────────────────────── «Sizdan kutiladi» ────────────────────────── */

/**
 * AI O'YLAB TOPMAYDIGAN narsalar (Q-2):
 *   • adabiy insho — asar nomi va tahlil qilinadigan parcha;
 *   • akademik esse — o'z dalillari, agar «dalil» mezoni past bo'lsa;
 *   • epigraf — foydalanuvchi tanlashi kerak (AI iqtibos o'ylab topmaydi).
 */
export function essayUserNeeds(review: DocReview, doc: AcademicDoc): UserNeed[] {
  const model = essayModelOf(doc);
  const out: UserNeed[] = [];
  const find = (id: string) => review.checks.find((c) => c.id === id);
  const kind = essayKindSpec(model.context, model.kind);
  if (kind.needsWork && !model.workTitle?.trim()) {
    out.push({ id: "work", label: "Asar nomi va parcha", hint: "Tahlil qilinadigan asar nomini va undan olingan parchani kiriting — AI iqtibos o‘ylab topmaydi" });
  }
  const epigraph = find("epigraph");
  if (epigraph && epigraph.level !== "green") {
    out.push({ id: "epigraph", label: "Epigraf", hint: "Inshoga mos iqtibosni o‘zingiz tanlang (shoir/yozuvchi nomi bilan) — uydirma epigraf yozilmaydi" });
  }
  const weakEvidence = find("judge:evidence")?.level === "red" || find("judge:content")?.level === "red" || find("judge:tr")?.level === "red";
  const dataFix = review.checks.some((c) => c.id.startsWith("judge:fix:") && c.fix && needsUserData(c.fix.instruction));
  if (!model.userFacts?.trim() && (weakEvidence || dataFix)) {
    out.push({ id: "facts", label: "O‘z dalillaringiz", hint: "O‘z fikringiz, hayotiy misolingiz yoki dalillaringizni formadagi «O‘z fikrlarim» maydoniga yozing — AI ularni o‘ylab topmaydi" });
  }
  return out;
}

/* ────────────────────────── qayta yozish ────────────────────────── */

export type EssayRewriteDeps = {
  complete: CompleteFn;
  deadline?: number;
  onUsage?: (u: LlmUsage) => void;
};

async function ask(deps: EssayRewriteDeps, system: string, user: string, maxTokens: number): Promise<string> {
  const timeoutMs = Math.max(1, Math.min(REWRITE_TIMEOUT_MS, remainingMs(deps.deadline)));
  const r = await deps.complete("writer", system, user, { json: true, maxTokens, timeoutMs }).catch(() => null);
  if (r?.usage) deps.onUsage?.(r.usage);
  if (!r?.text) throw new RewriteError(RETRY_MSG, 422, "llm");
  return r.text;
}

function targetOf(raw: string): EssayRewriteTarget {
  return raw === "intro" || raw === "conclusion" ? raw : "essay";
}

/**
 * `fix` → tahrir oplari (hujjat O'ZGARMAYDI). Model butun inshoni
 * qaytaradi; bo'sh yoki juda qisqa javob — 422 (eski matn qoladi).
 */
export async function rewriteEssayFix(doc: AcademicDoc, fix: Fix, deps: EssayRewriteDeps): Promise<RewriteOutOf<EssayOp>> {
  const section = essaySection(doc);
  if (!section) throw new RewriteError("Eski inshoda «Tuzatish» yo'q — qaytadan yarating", 409, "legacy");
  const ctx = contextOf(doc);
  const model = essayModelOf(doc);
  const current = essayTextOf(doc, model).paragraphs.join("\n\n");
  const user = [rewritePrompt(ctx, targetOf(fix.target), fix.instruction, current), HONESTY_LIMIT].join("\n");
  const maxTokens = Math.min(8000, Math.max(1500, Math.round(ctx.words.max * 2.6)));
  const blocks = essayBlocksFromLlm(await ask(deps, essaySystemPrompt(ctx), user, maxTokens));
  if (!blocks.length) throw new RewriteError(RETRY_MSG, 422, "llm");
  return { ops: [{ op: "setEssay", blocks }], unresolved: [], rewrittenSections: [section.id] };
}

/* ────────────────────────── baholovchi ballarini ko'chirish ────────────────────────── */

/**
 * Avvalgi hisobotdan baholovchi natijasi — `judge:*` bandlaridan.
 * IELTS da detal «Band 7 · 2/3» ko'rinishida, shuning uchun qolip
 * ANCHORSIZ: xom 0–3 ball har ikki shaklda ham o'qiladi.
 */
export function judgeFromReview(prev: DocReview | undefined, context = essayContextOfReview(prev)): EssayJudge | null {
  if (!prev || !context) return null;
  const rubric = essayRubric(context);
  const scores: Record<string, number> = {};
  let any = false;
  for (const c of rubric.criteria) {
    const m = /(\d)\/3/.exec(prev.checks.find((x) => x.id === `judge:${c}`)?.detail ?? "");
    if (!m) continue;
    scores[c] = Math.max(0, Math.min(3, Number(m[1])));
    any = true;
  }
  if (!any) return null;
  const j = essayJudgeOf(context, scores as Partial<Record<EssayJudgeCriterion, number>>);
  j.notes = prev.judgeNotes.filter((n) => n !== JUDGE_NO_ANSWER && n !== POLISH_JUDGE_NOTE && !rubric.notes.includes(n));
  j.fixes = prev.checks
    .filter((c) => c.id.startsWith("judge:fix:") && c.fix)
    .map((c) => ({ target: c.fix!.target, instruction: c.fix!.instruction }));
  return j;
}

/** Hisobotdagi `judge:*` bandlaridan kontekstni topadi (mezon nomlari noyob). */
export function essayContextOfReview(prev: DocReview | undefined): "school_dtm" | "academic" | "ielts_task2" | null {
  if (!prev) return null;
  const has = (id: string) => prev.checks.some((c) => c.id === `judge:${id}`);
  if (has("tr") || has("gra")) return "ielts_task2";
  if (has("thesis") || has("evidence")) return "academic";
  if (has("content") || has("creativity")) return "school_dtm";
  return null;
}

/* ────────────────────────── run ────────────────────────── */

export type EssayPolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  /** `false` — baholovchi chaqirilmaydi (testlar); standart `true`. */
  judge?: boolean;
  onUsage?: (u: LlmUsage) => void;
  concurrency?: number;
  /** Q-3 chegarasi; standart `ESSAY_ACCEPT_DELTA` (1). */
  acceptDelta?: number;
};

export type EssayPolishResult = RunPolishResult<EssayOp>;

export async function runEssayPolish(doc: AcademicDoc, review: DocReview, deps: EssayPolishDeps): Promise<EssayPolishResult> {
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const model = essayModelOf(doc);
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  return runPolishWith<EssayOp, EssayJudge>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    concurrency: deps.concurrency ?? 2,
    acceptDelta: deps.acceptDelta ?? ESSAY_ACCEPT_DELTA,
    plan: planEssayPolish,
    userNeeds: essayUserNeeds,
    rewrite: (d, fix, deadline) => rewriteEssayFix(d, fix, { complete, deadline }),
    apply: (d, ops) => applyEssayOps(d, ops),
    review: (d) => reviewEssay(d, { complete, deadline: deps.deadline, judge, now }),
    judgeFromReview: (prev) => judgeFromReview(prev, model.context),
    rescore: (fresh, j) => {
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      return {
        ...fresh,
        score: essayScore(rules, j, model.context),
        checks: [...rules, ...essayJudgeChecks(model.context, j)],
        judgeNotes: [...essayRubric(model.context).notes, ...j.notes, POLISH_JUDGE_NOTE],
      };
    },
  });
}

export { POLISH_SKIP };
