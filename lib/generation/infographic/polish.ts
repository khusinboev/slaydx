/**
 * INFOGRAFIKA AVTO-SAYQALI (AUDIT-21 WP-C) — `report/polish-core.ts` yadrosida.
 *
 *   planInfographicPolish(review, doc) → tuzatiladigan bandlar → ≤1 fix
 *   runInfographicPolish(doc, review)  → plan → qayta so'rov → qayta
 *                                        hisobot → ball `acceptDelta`
 *                                        (+1) dan ko'p OSHSA qabul
 *
 * BITTA FARQ boshqa oilalardan: NISHON BITTA (`spec`).
 *
 * `teacher`/`work` da sayqal bo'lim-bo'lim ishlaydi va olti fix ni
 * PARALLEL yuboradi. Plakatda «bo'lim» yo'q: uchta blok bir-biriga
 * bog'liq (jarayon zanjiri, taqqoslash juftlari, sabab-natija
 * muvozanati) va ularni alohida qayta yozish tuzilmani uzib qo'yardi —
 * masalan `compare` ning chap ustuni qayta yozilib, o'ng ustundagi
 * juftidan boshqa mezonga o'tib ketardi. Shuning uchun hisobotning
 * hamma tavsiyasi BITTA ko'rsatmaga birlashtiriladi va model butun
 * spetsifikatsiyani qayta yozadi (blok soni va id lar saqlangan holda).
 *
 * Halollik chegarasi (Q-2) o'zgarmaydi: `needsUserData` filtri +
 * promptdagi taqiq — sayqal o'ylab topilgan raqam QO'SHMAYDI.
 */
import type { AcademicDoc } from "../types";
import type { DocReview, ReviewGuardInput } from "../report/types";
import {
  POLISH_JUDGE_NOTE,
  POLISH_MAX_FIXES,
  POLISH_SKIP,
  REWRITE_TIMEOUT_MS,
  RewriteError,
  needsUserData,
  runPolishWith,
  type ApplyOpsResult,
  type Fix,
  type PolishPlan,
  type PolishSkip,
  type RunPolishResult,
} from "../report/polish-core";
import { parseLlmObject } from "../json";
import { remainingMs } from "../quality";
import type { LlmUsage } from "../llm-roles";
import type { CompleteFn } from "../research/pipeline";
import type { InfographicSpec } from "./types";
import { infographicTypeOf } from "./registry";
import { infographicCtx, infographicRewritePrompt, infographicSystemPrompt } from "./prompts";
import { infographicInputFromValues, normalizeSpec, type InfographicInput } from "./input";
import { SPEC_TARGET, infographicJudgeChecks, neutralInfographicJudge, reviewInfographic, scoreInfographicReview, type InfographicJudgeResult, type InfographicReviewOpts } from "./review";

export { POLISH_SKIP, RewriteError };
export type { PolishPlan, PolishSkip };

/** Q-3 qabul chegarasi — `teacher` bilan bir xil (+1): plakat qisqa. */
export const INFOGRAPHIC_ACCEPT_DELTA = 1;

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

/** Sayqal op i: butun spetsifikatsiyani ALMASHTIRISH. */
export type InfographicOp = { op: "setSpec"; spec: InfographicSpec };

/* ────────────────────────── kontekst ────────────────────────── */

/**
 * Dvigatel konteksti HUJJATDAN (forma qiymatlari endi yo'q) —
 * `teacherContextOf` naqshi. `extra` `doc.meta` da saqlanadi, ya'ni
 * halollik chegarasi sayqalda ham amal qiladi.
 */
export function infographicContextOf(doc: AcademicDoc): { input: InfographicInput; spec: InfographicSpec } | null {
  const spec = doc.infographic?.spec;
  if (!spec) return null;
  const input = infographicInputFromValues(doc.meta, {
    topic: doc.meta.topic,
    infographicType: spec.type,
    blockCount: spec.blocks.length,
    palette: spec.palette,
    size: spec.size,
    language: spec.language,
    extra: doc.meta.extra ?? "",
  });
  return { input, spec };
}

/* ────────────────────────── reja ────────────────────────── */

/**
 * Avtomatik TUZATILMAYDI:
 *   `contrast`  — palitra statik, «tuzatish» degani boshqa palitra
 *                 tanlash bo'lardi, bu esa FOYDALANUVCHI qarori;
 *   `iconKnown` — ikon allaqachon standartga tushirilgan, plakat to'g'ri;
 *   `blockCount`— MIQDOR bandi: kamaygan blokni «tuzatish» yangi
 *                 material o'ylab topish bo'lardi va `delivered`
 *                 allaqachon farqni qaytaradi.
 */
const NOT_FIXABLE = new Set(["contrast", "iconKnown", "blockCount", "statValue"]);

export function planInfographicPolish(review: DocReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  if (!doc.infographic?.spec) return { fixes: [], skipped: [{ id: "legacy", reason: "manual" }] };

  const instructions: string[] = [];
  const add = (s: string) => {
    if (s && !instructions.includes(s)) instructions.push(s);
  };

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  // Qizil avval — `noOverflow` va halollik bandlari birinchi navbatda.
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  for (const c of rules) {
    if (NOT_FIXABLE.has(c.id)) {
      skipped.push({ id: c.id, reason: c.id === "blockCount" ? "user" : "manual" });
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

  if (!instructions.length) return { fixes: [], skipped };
  if (instructions.length > POLISH_MAX_FIXES) {
    skipped.push({ id: "extra", reason: "limit" });
    instructions.length = POLISH_MAX_FIXES;
  }
  // BITTA nishon = BITTA fix: plakat bo'linmaydi (fayl boshidagi izoh).
  return { fixes: [{ op: "rewrite", target: SPEC_TARGET, instruction: instructions.map((s, i) => `(${i + 1}) ${s}`).join(" ") }], skipped };
}

/* ────────────────────────── qayta yozish ────────────────────────── */

export type InfographicRewriteDeps = { complete: CompleteFn; deadline?: number; onUsage?: (u: LlmUsage) => void };

export async function rewriteInfographicFix(doc: AcademicDoc, fix: Fix, deps: InfographicRewriteDeps): Promise<InfographicOp[]> {
  const ctx = infographicContextOf(doc);
  if (!ctx) throw new RewriteError("Eski hujjatda «Tuzatish» yo'q — qaytadan yarating", 409, "legacy");
  if (fix.target !== SPEC_TARGET && !ctx.spec.blocks.some((b) => b.id === fix.target)) {
    throw new RewriteError(`Nishon topilmadi: ${fix.target}`, 422, "target");
  }
  const c = infographicCtx(infographicTypeOf(ctx.spec.type), ctx.input);
  const timeoutMs = Math.max(1, Math.min(REWRITE_TIMEOUT_MS, remainingMs(deps.deadline)));
  const r = await deps
    .complete("writer", infographicSystemPrompt(c), infographicRewritePrompt(c, ctx.spec, [fix.instruction]), { json: true, deadline: deps.deadline, maxTokens: 2600, timeoutMs })
    .catch(() => null);
  if (r?.usage) deps.onUsage?.(r.usage);
  const raw = parseLlmObject<Record<string, unknown>>(r?.text ?? "");
  if (!raw) throw new RewriteError(RETRY_MSG, 422, "llm");
  const next = normalizeSpec(raw, ctx.input, { ids: ctx.spec.blocks.map((b) => b.id) });
  if (!next) throw new RewriteError(RETRY_MSG, 422, "llm");
  /*
   * Blok soni O'ZGARMASLIGI shart: aks holda qayta hisoblangan
   * `blockCount` bandi qizarib, sayqal hech qachon qabul qilinmasdi —
   * ya'ni chaqiruv puli behuda ketardi.
   */
  if (next.blocks.length !== ctx.spec.blocks.length) throw new RewriteError(RETRY_MSG, 422, "llm");
  return [{ op: "setSpec", spec: next }];
}

/* ────────────────────────── qo'llash ────────────────────────── */

export function applyInfographicOps(doc: AcademicDoc, ops: InfographicOp[]): ApplyOpsResult {
  if (!doc.infographic) return { ok: false, error: "plakat modeli yo'q" };
  let spec = doc.infographic.spec;
  for (const op of ops) {
    if (op.op !== "setSpec") return { ok: false, error: `noma'lum op: ${String((op as { op?: unknown }).op)}` };
    if (!op.spec.blocks.length) return { ok: false, error: "bo'sh spetsifikatsiya" };
    spec = op.spec;
  }
  return { ok: true, doc: { ...doc, infographic: { ...doc.infographic, spec } } };
}

/* ────────────────────────── ball ko'chirish ────────────────────────── */

/** Avvalgi hisobotdan baholovchi ballari — `judge:*` bandlaridan. */
export function infographicJudgeFromReview(prev: DocReview | undefined, spec: InfographicSpec): InfographicJudgeResult | null {
  if (!prev) return null;
  const j = neutralInfographicJudge(spec);
  const criteria = infographicTypeOf(spec.type).judge.criteria;
  let any = false;
  for (const c of criteria) {
    const m = /^(\d)\/3$/.exec(prev.checks.find((x) => x.id === `judge:${c}`)?.detail ?? "");
    if (!m) continue;
    (j as Record<string, unknown>)[c] = Math.max(0, Math.min(3, Number(m[1])));
    any = true;
  }
  if (!any) return null;
  j.notes = prev.judgeNotes.filter((n) => n !== POLISH_JUDGE_NOTE);
  j.fixes = prev.checks
    .filter((x) => x.id.startsWith("judge:fix:") && x.fix)
    .map((x) => ({ target: x.fix!.target, instruction: x.fix!.instruction }));
  return j;
}

/* ────────────────────────── run ────────────────────────── */

export type InfographicPolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  judge?: boolean;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  acceptDelta?: number;
  /** Formada so'ralgan blok soni — hisobot sayqaldan keyin ham SHU sonni ko'rsin. */
  want?: number;
};

export type InfographicPolishResult = RunPolishResult<InfographicOp>;

export async function runInfographicPolish(doc: AcademicDoc, review: DocReview, deps: InfographicPolishDeps): Promise<InfographicPolishResult> {
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const spec = doc.infographic?.spec;
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  const reviewOpts: InfographicReviewOpts = { complete, deadline: deps.deadline, judge, now, want: deps.want };
  return runPolishWith<InfographicOp, InfographicJudgeResult>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    guard: deps.guard,
    acceptDelta: deps.acceptDelta ?? INFOGRAPHIC_ACCEPT_DELTA,
    plan: planInfographicPolish,
    userNeeds: (r, d) => r.userNeeds ?? (d.infographic ? [] : []),
    rewrite: async (d, fix, deadline) => ({ ops: await rewriteInfographicFix(d, fix, { complete, deadline, onUsage: deps.onUsage }), unresolved: [], rewrittenSections: [SPEC_TARGET] }),
    apply: applyInfographicOps,
    review: (d) => reviewInfographic(d, reviewOpts),
    judgeFromReview: (prev) => (spec ? infographicJudgeFromReview(prev, spec) : null),
    rescore: (fresh, j) => {
      if (!spec) return fresh;
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      return { ...fresh, score: scoreInfographicReview(rules, spec, j), checks: [...rules, ...infographicJudgeChecks(spec, j)], judgeNotes: [...j.notes, POLISH_JUDGE_NOTE] };
    },
  });
}
