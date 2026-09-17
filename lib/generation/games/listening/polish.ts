/**
 * AVTO-SAYQAL — TINGLASH O'YINI (AUDIT-22 WP-D) — SOF, IZOMORF.
 *
 *   planListeningPolish(review, doc) → tuzatiladigan bandlar
 *   runListeningPolish(doc, review)  → plan → apply → qayta hisobot →
 *                                      ball `acceptDelta` dan ko'p OSHSA qabul
 *   listeningUserNeeds(review, doc)  → «Sizdan kutiladi»
 *
 * Mantiq NEYTRAL yadroda (`report/polish-core.ts runPolishWith`).
 *
 * ── AUDIO qayta yozilmaydi (bu oilaning o'ziga xos qarori)
 *
 * Sayqal `text` ni o'zgartirishi mumkin, lekin TTS parchasi eski matnga
 * tegishli. Shuning uchun matn o'zgargan topshiriqning `audioAssetId` i
 * TASHLANADI: noto'g'ri audio audio yo'qligidan YOMONROQ — o'quvchi bir
 * so'zni eshitib, boshqasining variantlarini ko'rardi va buni hech kim
 * hisobotdan bilmasdi. Matni o'zgarmagan topshiriq parchasini saqlaydi
 * (qayta sintez — bekorga sarf).
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
import { langInfo } from "../../i18n";
import type { LlmUsage } from "../../llm-roles";
import type { CompleteFn } from "../../research/pipeline";
import { gameTypeOf } from "../registry";
import { GAME_LIMITS, type GameModel, type ListeningItem } from "../types";
import { gameLayoutLabels } from "../layout";
import { listeningSections, pickItems, textKey } from "./engine";
import { listeningLangOf, type ListeningInput } from "./input";
import { listeningRewritePrompt, listeningSystemPrompt, type ListeningContext } from "./prompts";
import {
  LISTENING_TARGET,
  listeningJudgeChecks,
  neutralListeningJudge,
  reviewListening,
  scoreListeningReview,
  type ListeningJudgeResult,
} from "./review";

export { POLISH_SKIP, RewriteError };
export type { PolishPlan, PolishSkip };

export type ListeningFix = Fix;

/** Q-3 qabul chegarasi — o'qituvchi hujjatlaridagi kabi +1. */
export const LISTENING_ACCEPT_DELTA = 1;

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

/** Sayqal op tili — bu oilada BITTA amal: topshiriqlar ro'yxatini almashtirish. */
export type ListeningOp = { op: "setItems"; items: ListeningItem[] };

export type ListeningRewriteDeps = { complete: CompleteFn; deadline?: number };

/* ────────────────────────── kontekst ────────────────────────── */

export function listeningContextOf(doc: AcademicDoc): ListeningContext {
  const model = doc.game!;
  const m = model.listening;
  const nativeLanguage = m?.nativeLanguage || model.language || doc.meta.language || "uz";
  const spec = gameTypeOf("listening", model.type);
  const input: ListeningInput = {
    type: spec.id,
    topic: model.topic || doc.meta.topic,
    subject: doc.meta.subject ?? "",
    nativeLanguage,
    targetLanguage: m?.targetLanguage || "en",
    lang: listeningLangOf(nativeLanguage),
    grade: Number(doc.meta.grade) || 0,
    itemCount: m?.items.length ?? GAME_LIMITS.listeningCountDefault,
    optionCount: Math.max(...(m?.items ?? []).map((i) => i.options.length), spec.limits.optionsDefault),
    extra: doc.meta.extra ?? "",
  };
  return { spec, input };
}

/* ────────────────────────── reja ────────────────────────── */

const rewriteFix = (target: string, instruction: string): ListeningFix => ({ op: "rewrite", target, instruction });

export function listeningCriterionFixes(review: DocReview, doc: AcademicDoc): ListeningFix[] {
  const model = doc.game;
  if (!model?.listening) return [];
  const level = (id: string) => review.checks.find((c) => c.id === `judge:${id}`)?.level;
  const low = (id: string) => level(id) === "red" || level(id) === "yellow";
  const out: ListeningFix[] = [];
  const push = (instruction: string) => {
    if (!out.some((f) => f.instruction === instruction)) out.push(rewriteFix(LISTENING_TARGET, instruction));
  };
  const target = langInfo(model.listening.targetLanguage).name;

  if (low("wordChoice")) push(`Replace the rare dictionary entries with everyday ${target} words a learner will actually meet again, keeping them on the stated topic.`);
  if (low("distractorQuality")) {
    push("Rewrite the wrong options so that all of them come from the SAME semantic field as the correct meaning — plausible at a glance, but none of them a second possible translation of the heard item.");
  }
  if (low("translationAccuracy")) push("Correct the marked meanings so that each one is the normal, context-free translation a teacher would accept, not a loose association.");
  if (low("gradeLevel")) push(`Level out the set: the vocabulary must stay consistently ${Number(doc.meta.grade) > 0 ? `at grade ${doc.meta.grade}` : "beginner-to-intermediate"}, without mixing trivial and advanced items.`);
  if (low("pronounceability")) push("Replace the items a speech synthesiser cannot say unambiguously: no abbreviations, no digits, no spelling-out, nothing longer than one breath.");
  return out;
}

/**
 * Hisobot → fix rejasi.
 *
 * Avtomatik TUZATILMAYDI: `itemCount` — MIQDOR bandi (`delivered`
 * farqni qaytaradi); `languagePair` — bu FORMA tanlovi, matnni qayta
 * yozish uni o'zgartirmaydi; `structure` — kod xatosi.
 */
const NOT_FIXABLE = new Set(["itemCount", "languagePair", "structure"]);

export function planListeningPolish(review: DocReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  const instructions: string[] = [];
  if (!doc.game?.listening) return { fixes: [], skipped: [{ id: "structure", reason: "manual" }] };

  const add = (instruction: string) => {
    if (!instructions.includes(instruction)) instructions.push(instruction);
  };

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  for (const c of rules) {
    if (NOT_FIXABLE.has(c.id)) {
      skipped.push({ id: c.id, reason: c.id === "itemCount" || c.id === "languagePair" ? "user" : "manual" });
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
  for (const f of listeningCriterionFixes(review, doc)) add(f.instruction);

  if (!instructions.length) return { fixes: [], skipped };
  const capped = instructions.slice(0, POLISH_MAX_FIXES);
  for (const extra of instructions.slice(POLISH_MAX_FIXES)) skipped.push({ id: extra.slice(0, 40), reason: "limit" });
  return {
    fixes: [rewriteFix(LISTENING_TARGET, capped.length === 1 ? capped[0] : capped.map((s, i) => `(${i + 1}) ${s}`).join(" "))],
    skipped,
  };
}

/* ────────────────────────── «Sizdan kutiladi» ────────────────────────── */

export function listeningUserNeeds(review: DocReview, doc: AcademicDoc): UserNeed[] {
  const out: UserNeed[] = [];
  const m = doc.game?.listening;
  if (!m) return out;

  const count = review.checks.find((c) => c.id === "itemCount");
  if (count && count.level !== "green") {
    out.push({ id: "itemCount", label: "Topshiriqlar soni", hint: `${count.detail ?? ""} — mavzuni kengaytiring yoki kamroq so‘z tanlang` });
  }
  /*
   * AUDIO — «Sizdan kutiladi» ning eng halol bandi: TTS kalitlari hali
   * yo'q (`tts.md` §6), ya'ni parcha ham yo'q. O'qituvchi buni FAYLNI
   * ochgandan keyin emas, hisobotdan bilishi kerak.
   */
  if (m.items.some((it) => !it.audioAssetId)) {
    const n = m.items.filter((it) => !it.audioAssetId).length;
    out.push({
      id: "audio",
      label: "Audio parchalar",
      hint: `${n} ta so‘z uchun audio yo‘q — matnni darsda o‘zingiz o‘qib bering (javob kalitida yozilgan)`,
    });
  }
  return out;
}

/* ────────────────────────── qayta yozish ────────────────────────── */

async function ask(deps: ListeningRewriteDeps, system: string, user: string, maxTokens: number): Promise<string> {
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
 * Topshiriq soni SAQLANISHI shart: kam qaytgan javob rad etiladi —
 * sayqal hech qachon foydalanuvchi to'lagan topshiriqni O'CHIRMASLIGI
 * kerak.
 */
export async function rewriteListeningFix(doc: AcademicDoc, fix: ListeningFix, deps: ListeningRewriteDeps): Promise<{ ops: ListeningOp[] }> {
  const model = doc.game;
  if (!model?.listening) throw new RewriteError("Tinglash modeli yo‘q — qaytadan yarating", 409, "legacy");
  if (fix.target !== LISTENING_TARGET) throw new RewriteError(`Nishon topilmadi: ${fix.target}`, 422, "target");

  const ctx = listeningContextOf(doc);
  const system = listeningSystemPrompt(ctx);
  const current = model.listening.items;
  const raw = await ask(deps, system, listeningRewritePrompt(ctx, current, fix.instruction), Math.min(8000, 900 + current.length * 140));
  const data = parseLlmObject<{ items?: unknown; pairs?: unknown }>(raw);
  const picked = pickItems(data?.items ?? data?.pairs, { spec: ctx.spec, optionCount: ctx.input.optionCount, seen: new Set<string>() });
  if (picked.length !== current.length) throw new RewriteError(RETRY_MSG, 422, "llm");
  /*
   * Barqaror id lar SAQLANADI (ball hisobi shularga tayanadi), AUDIO esa
   * faqat MATN o'zgarmagan topshiriqda qoladi — fayl boshidagi izoh.
   */
  const items = picked.map((it, i) => {
    const old = current[i];
    const same = textKey(it.text) === textKey(old.text);
    return { ...it, id: old.id, ...(same && old.audioAssetId ? { audioAssetId: old.audioAssetId } : {}) };
  });
  return { ops: [{ op: "setItems", items }] };
}

/* ────────────────────────── op larni qo'llash ────────────────────────── */

/** `setItems` — model VA nasr BIRGA almashadi. */
export function applyListeningOps(doc: AcademicDoc, ops: ListeningOp[]): ApplyOpsResult {
  const model = doc.game;
  if (!model?.listening) return { ok: false, error: "tinglash modeli yo‘q" };
  let items = model.listening.items;
  for (const op of ops) {
    if (op.op !== "setItems") return { ok: false, error: `noma'lum op: ${String((op as { op?: unknown }).op)}` };
    if (op.items.length !== items.length) return { ok: false, error: `topshiriq soni mos emas: ${op.items.length} ≠ ${items.length}` };
    items = op.items;
  }
  const nextModel: GameModel = { ...model, listening: { ...model.listening, items } };
  const L = gameLayoutLabels(nextModel.listening!.nativeLanguage || nextModel.language || doc.meta.language);
  return { ok: true, doc: { ...doc, game: nextModel, sections: listeningSections(nextModel.listening!, L, langInfo(nextModel.listening!.targetLanguage).native) } };
}

/* ────────────────────────── ball ko'chirish ────────────────────────── */

export function listeningJudgeFromReview(prev: DocReview | undefined, model: GameModel): ListeningJudgeResult | null {
  if (!prev) return null;
  const j = neutralListeningJudge(model);
  const criteria = gameTypeOf("listening", model.type).judge.criteria as readonly string[];
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

export type ListeningApplyPolishResult = ApplyPolishResultOf<ListeningOp>;

const rewriteForCore = async (doc: AcademicDoc, fix: ListeningFix, deps: ListeningRewriteDeps) => {
  const r = await rewriteListeningFix(doc, fix, deps);
  return { ops: r.ops, unresolved: [], rewrittenSections: [LISTENING_TARGET] };
};

export async function applyListeningPolish(
  doc: AcademicDoc,
  fixes: ListeningFix[],
  deps: ListeningRewriteDeps & { concurrency?: number },
): Promise<ListeningApplyPolishResult> {
  return applyPolishWith<ListeningOp>(doc, fixes, { concurrency: deps.concurrency, rewrite: (d, fix) => rewriteForCore(d, fix, deps) });
}

export type ListeningPolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  judge?: boolean;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  concurrency?: number;
  acceptDelta?: number;
};

export type ListeningPolishResult = RunPolishResult<ListeningOp>;

export async function runListeningPolish(doc: AcademicDoc, review: DocReview, deps: ListeningPolishDeps): Promise<ListeningPolishResult> {
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const model = doc.game;
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  return runPolishWith<ListeningOp, ListeningJudgeResult>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    ...(deps.guard ? { guard: deps.guard } : {}),
    ...(deps.concurrency ? { concurrency: deps.concurrency } : {}),
    acceptDelta: deps.acceptDelta ?? LISTENING_ACCEPT_DELTA,
    plan: planListeningPolish,
    userNeeds: listeningUserNeeds,
    rewrite: (d, fix, deadline) => rewriteForCore(d, fix, { complete, deadline }),
    apply: applyListeningOps,
    review: (d) => reviewListening(d, { complete, deadline: deps.deadline, judge, now }),
    judgeFromReview: (prev) => (model ? listeningJudgeFromReview(prev, model) : null),
    rescore: (fresh, j) => {
      if (!model) return fresh;
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      return { ...fresh, score: scoreListeningReview(rules, model, j), checks: [...rules, ...listeningJudgeChecks(model, j)], judgeNotes: [...j.notes, POLISH_JUDGE_NOTE] };
    },
  });
}
