/**
 * KROSSVORD AVTO-SAYQALI (AUDIT-21 WP-A) — `report/polish-core.ts` ustida.
 *
 * ASOSIY QOIDA: sayqal TA'RIFNI qayta yozadi, SO'ZNI EMAS.
 *
 * Nega: so'z o'zgarsa to'r ham o'zgaradi — kataklar, kesishmalar,
 * raqamlar va javob varag'i qaytadan quriladi, ya'ni «sayqal» aslida
 * yangi krossvord bo'lardi va foydalanuvchi ekranda ko'rgan to'r
 * yo'qolardi. Shuning uchun op faqat `clue` ni almashtiradi; javob,
 * koordinata va raqam DAXLSIZ (`applyClueOps` buni tekshiradi).
 *
 * Shu sababli qoidalarning bir qismi sayqal bilan tuzatilmaydi:
 * `wordCount`, `gridSize`, `minCrossings`, `wordLength`, `uniqueWords`,
 * `gridMatchesWords`, `gridConnected` — hammasi TO'R bandlari. Ular
 * `skipped` ga `manual` sababi bilan tushadi va hisobot panelida
 * ko'rinadi; tuzatish yo'li — krossvordni qaytadan yaratish.
 */
import type { AcademicDoc } from "../../types";
import type { DocReview, UserNeed } from "../../report/types";
import { POLISH_MAX_FIXES, RewriteError, runPolishWith, type ApplyOpsResult, type Fix, type PolishPlan, type RewriteOutOf, type RunPolishResult } from "../../report/polish-core";
import { remainingMs } from "../../quality";
import { parseLlmObject } from "../../json";
import type { CompleteFn } from "../../research/pipeline";
import type { CostMeter, LlmUsage } from "../../llm-roles";
import { gameTypeOf, type CrosswordTypeSpec } from "../registry";
import { wordText, type CrosswordWord } from "./grid";
import { crosswordInputFromValues, type CrosswordInput } from "./input";
import { crosswordJudgeFromReview, rescoreCrossword, reviewCrossword, type CrosswordJudgeResult, type CrosswordReviewAsk, type CrosswordReviewOpts } from "./review";

/** Bitta tuzatish: shu `wordId` ning ta'rifi yangisiga almashadi. */
export type CrosswordPolishOp = { op: "clue"; wordId: string; clue: string };

/** Sayqal TUZATA OLADIGAN bandlar — hammasi TA'RIF bandlari. */
export const CLUE_RULE_IDS = new Set(["clueLength", "clueNotContainsAnswer"]);

/** To'r bandlari: sayqal ularni tuzata olmaydi (so'z o'zgarishi kerak bo'lardi). */
export const GRID_RULE_IDS = new Set(["wordCount", "gridSize", "minCrossings", "wordLength", "uniqueWords", "gridMatchesWords", "gridConnected", "answerSheet"]);

/**
 * Hisobot → tuzatish rejasi.
 *
 * Faqat sariq/qizil TA'RIF bandlari va baholovchining `clues` ga
 * tegishli tavsiyalari olinadi; to'r bandlari `manual` sababi bilan
 * o'tkazib yuboriladi.
 */
export function planCrosswordPolish(review: DocReview): PolishPlan {
  const fixes: Fix[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const c of review.checks) {
    if (c.level === "green") continue;
    const base = c.id.startsWith("judge:") ? c.id.slice(6) : c.id;
    if (GRID_RULE_IDS.has(base)) {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    if (!c.fix) {
      if (!CLUE_RULE_IDS.has(base) && !c.id.startsWith("judge:")) skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    // Sayqal faqat ta'riflar bo'limini qayta yozadi.
    if (c.fix.target !== "clues") {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    if (fixes.length >= POLISH_MAX_FIXES) {
      skipped.push({ id: c.id, reason: "limit" });
      continue;
    }
    fixes.push({ op: "rewrite", target: c.fix.target, instruction: c.fix.instruction });
  }
  return { fixes, skipped };
}

/**
 * «Sizdan kutiladi» (Q-2) — AI o'ylab topa olmaydigan qaror.
 *
 * To'rga sig'magan so'z — aynan shunday band: uni faqat o'qituvchi hal
 * qiladi (boshqa atama tanlash yoki so'z sonini kamaytirish).
 */
export function crosswordUserNeeds(place: { dropped: readonly { answer: string[]; reason: string }[] }, input: { wordCount: number }): UserNeed[] {
  const out: UserNeed[] = [];
  const noFit = place.dropped.filter((d) => d.reason === "no-fit");
  if (noFit.length) {
    out.push({
      id: "droppedWords",
      label: "To'rga sig'magan so'zlar",
      hint: `${noFit.map((d) => wordText(d.answer)).join(", ")} — kesishma topilmadi. Boshqa atama tanlang yoki so'z sonini kamaytiring (${input.wordCount} ta so'ralgan edi).`,
    });
  }
  return out;
}

/* ────────────────────────── qayta yozish ────────────────────────── */

export type ClueRewriteDeps = {
  complete: CompleteFn;
  input: CrosswordInput;
  spec: CrosswordTypeSpec;
  deadline: number;
  onUsage?: (u: LlmUsage) => void;
  meter?: CostMeter;
};

/** Qayta yozish uchun tizim prompti — javob O'ZGARMAYDI degan shart bilan. */
export function clueRewriteSystemPrompt(deps: ClueRewriteDeps): string {
  const [clueMin, clueMax] = deps.spec.limits.clueChars;
  return [
    `You rewrite CLUES for a printed school crossword (type: ${deps.spec.label.en}).`,
    "The ANSWERS ARE FIXED — the grid is already built. You may only rewrite the clue text.",
    `Every clue stays ${clueMin}–${clueMax} characters, is a direct definition or synonym, and must NOT contain the answer or its root.`,
    "Keep the same language as the input clues. Return ONLY JSON.",
    'JSON shape: {"clues":[{"id":"…","clue":"…"}]} — `id` is the word id given to you.',
  ].join("\n");
}

const clueUserPrompt = (words: readonly CrosswordWord[], instruction: string): string =>
  [
    `INSTRUCTION: ${instruction}`,
    "",
    "CLUES (id · answer · current clue):",
    ...words.map((w) => `— ${w.id} · ${wordText(w.answer)} · ${w.clue}`),
    "",
    "Rewrite every clue that the instruction applies to; return the others unchanged.",
  ].join("\n");

/**
 * Bitta `fix` → `clue` op lari. Model javobidagi noma'lum `id` va
 * javobni oshkor qiladigan ta'rif TASHLANADI (sayqal yomonlashtirmasin).
 */
export async function rewriteClues(doc: AcademicDoc, fix: Fix, deps: ClueRewriteDeps): Promise<RewriteOutOf<CrosswordPolishOp>> {
  const words = doc.game?.crossword?.words ?? [];
  if (!words.length) throw new RewriteError("Krossvord modeli yo'q", 409, "legacy");
  const timeoutMs = Math.min(30_000, remainingMs(deps.deadline));
  if (timeoutMs < 5_000) throw new RewriteError("Vaqt yetmadi", 422, "llm");

  const r = await deps.complete("writer", clueRewriteSystemPrompt(deps), clueUserPrompt(words, fix.instruction), {
    json: true,
    maxTokens: Math.min(4000, 300 + words.length * 120),
    timeoutMs,
  });
  if (r?.usage) {
    deps.meter?.add(r.usage);
    deps.onUsage?.(r.usage);
  }
  const parsed = r?.text ? parseLlmObject<{ clues?: unknown }>(r.text) : null;
  const list = Array.isArray(parsed?.clues) ? (parsed.clues as { id?: unknown; clue?: unknown }[]) : [];
  if (!list.length) throw new RewriteError("Model javob bermadi", 422, "llm");

  const byId = new Map(words.map((w) => [w.id, w]));
  const [clueMin, clueMax] = deps.spec.limits.clueChars;
  const ops: CrosswordPolishOp[] = [];
  for (const row of list) {
    const id = String(row?.id ?? "").trim();
    const clue = String(row?.clue ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const w = byId.get(id);
    if (!w || !clue || clue === w.clue) continue;
    if (clue.length < clueMin || clue.length > clueMax) continue;
    // Javobni oshkor qiladigan ta'rif qabul qilinmaydi (hisobot qoidasi).
    if (clue.toLowerCase().includes(wordText(w.answer).toLowerCase())) continue;
    ops.push({ op: "clue", wordId: id, clue });
  }
  if (!ops.length) throw new RewriteError("Qabul qilinadigan ta'rif chiqmadi", 422, "llm");
  return { ops, unresolved: [], rewrittenSections: ["across", "down"] };
}

/* ────────────────────────── qo'llash ────────────────────────── */

/**
 * Op larni hujjatga qo'llash: `words[].clue`, `clues.across/down[].text`
 * va `across`/`down` bo'limlarining `li` bloklari BIR VAQTDA yangilanadi
 * — model, matn va ko'ruvchi bir-biridan ajralib qolmasin.
 */
export function applyClueOps(doc: AcademicDoc, ops: CrosswordPolishOp[]): ApplyOpsResult {
  const model = doc.game?.crossword;
  if (!model) return { ok: false, error: "Krossvord modeli yo'q" };
  const byId = new Map(ops.map((o) => [o.wordId, o.clue]));
  if (!byId.size) return { ok: false, error: "Tuzatish yo'q" };

  const words = model.words.map((w) => (byId.has(w.id) ? { ...w, clue: byId.get(w.id) as string } : w));
  const patch = (list: typeof model.clues.across) => list.map((c) => (byId.has(c.wordId) ? { ...c, text: byId.get(c.wordId) as string } : c));
  const clues = { across: patch(model.clues.across), down: patch(model.clues.down) };

  const textOf = (c: { number: number; text: string; length: number }) => `${c.number}. ${c.text} (${c.length})`;
  const sections = doc.sections.map((s) => {
    if (s.id !== "across" && s.id !== "down") return s;
    const list = s.id === "across" ? clues.across : clues.down;
    return { ...s, blocks: list.map((c) => ({ kind: "li", text: textOf(c) }) as (typeof s.blocks)[number]) };
  });

  return { ok: true, doc: { ...doc, sections, game: { ...doc.game!, crossword: { ...model, words, clues } } } };
}

/* ────────────────────────── server sayqali (AUDIT-21 WP-D) ────────────────────────── */

/** Q-3 qabul chegarasi (oila bilan bir xil) — dvigatel ham shu konstantani oladi. */
export const CROSSWORD_ACCEPT_DELTA = 1;

/**
 * HUJJATDAN kontekst (`infographic/polish.ts infographicContextOf` naqshi).
 *
 * Dvigatelda `input`/`spec`/`ask` forma qiymatlaridan keladi; natija
 * sahifasida forma YO'Q — «Hammasini tuzatish» va bandma-band
 * «Tuzatish» faqat saqlangan hujjatni ko'radi. Shuning uchun uchalasi
 * shu yerda hujjatdan qayta tiklanadi.
 *
 * VA'DA QILINGAN so'z soni HISOBOTDAN o'qiladi (`wordCount` bandi
 * «7 / 10 so'z to'rga tushdi» deb yozib qo'ygan): uni `words.length`
 * dan hisoblasa, qayta hisobotda o'sha band O'ZI yashil bo'lib qolar,
 * ball soxta oshar va Q-3 darvozasi hech narsani ushlamasdi.
 */
export function crosswordContextOf(
  doc: AcademicDoc,
  review?: DocReview,
): { input: CrosswordInput; spec: CrosswordTypeSpec; ask: CrosswordReviewAsk } | null {
  const model = doc.game?.crossword;
  if (!model || doc.game?.kind !== "crossword") return null;
  const wordCount = askedWordCount(review, model.words.length + model.dropped.length);
  const input = crosswordInputFromValues(doc.meta, {
    topic: doc.meta.topic,
    crosswordType: doc.game.type,
    language: doc.game.language || doc.meta.language,
    wordCount,
    extra: doc.meta.extra ?? "",
  });
  return {
    input,
    spec: gameTypeOf("crossword", doc.game.type),
    ask: {
      wordCount,
      gridSize: input.gridSize,
      hasAnswers: doc.sections.some((s) => s.id === "answers" && s.blocks.length > 0),
      dropped: model.dropped,
    },
  };
}

/** `wordCount` bandi detalidagi «N / M so'z» — M (va'da qilingan son). */
function askedWordCount(review: DocReview | undefined, fallback: number): number {
  const detail = review?.checks.find((c) => c.id === "wordCount")?.detail ?? "";
  const m = /(\d+)\s*\/\s*(\d+)/.exec(detail);
  const want = m ? Number(m[2]) : NaN;
  return Number.isFinite(want) && want > 0 ? want : Math.max(1, fallback);
}

export type CrosswordPolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  judge?: boolean;
  onUsage?: (u: LlmUsage) => void;
  meter?: CostMeter;
  acceptDelta?: number;
  concurrency?: number;
};

export type CrosswordPolishResult = RunPolishResult<CrosswordPolishOp>;

/**
 * Butun sayqal — dvigateldagi chaqiruv bilan AYNAN bir xil sozlamada,
 * farqi faqat kontekst manbasida. Dvigatel o'z `place`/`input` ini
 * biladi va `runPolishWith` ni bevosita chaqiradi; server esa
 * hujjatdan boshqa hech narsa ko'rmaydi (`crosswordContextOf`).
 */
export async function runCrosswordPolish(doc: AcademicDoc, review: DocReview, deps: CrosswordPolishDeps): Promise<CrosswordPolishResult> {
  const ctx = crosswordContextOf(doc, review);
  if (!ctx) throw new RewriteError("Krossvord modeli yo'q", 409, "legacy");
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  const reviewOpts: CrosswordReviewOpts = { ask: ctx.ask, complete: complete as CrosswordReviewOpts["complete"], deadline: deps.deadline, judge, now };
  return runPolishWith<CrosswordPolishOp, CrosswordJudgeResult>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    ...(deps.concurrency ? { concurrency: deps.concurrency } : {}),
    acceptDelta: deps.acceptDelta ?? CROSSWORD_ACCEPT_DELTA,
    plan: (r) => planCrosswordPolish(r),
    userNeeds: () => crosswordUserNeeds({ dropped: doc.game?.crossword?.dropped ?? [] }, { wordCount: ctx.ask.wordCount ?? 0 }),
    rewrite: (d, fix, fixDeadline) =>
      rewriteClues(d, fix, { complete, input: ctx.input, spec: ctx.spec, deadline: fixDeadline, ...(deps.meter ? { meter: deps.meter } : {}) }),
    apply: (d, ops) => applyClueOps(d, ops),
    review: (d) => reviewCrossword(d, reviewOpts),
    judgeFromReview: (prev) => crosswordJudgeFromReview(prev),
    rescore: (fresh, j) => rescoreCrossword(fresh, j),
  });
}
