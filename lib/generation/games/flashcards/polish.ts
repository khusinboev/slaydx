/**
 * AVTO-SAYQAL — FLESH KARTALAR (AUDIT-21 WP-B) — SOF, IZOMORF.
 *
 *   planFlashcardsPolish(review, doc) → hisobotdagi tuzatiladigan bandlar
 *   runFlashcardsPolish(doc, review)  → plan → apply → qayta hisobot →
 *                                       ball `acceptDelta` dan ko'p OSHSA qabul
 *   flashcardsUserNeeds(review, doc)  → «Sizdan kutiladi»
 *
 * Mantiq NEYTRAL yadroda (`report/polish-core.ts runPolishWith`) — bu
 * yerda faqat KARTAGA XOS qismlar.
 *
 * ── Karta MODEL shaklida qayta yoziladi (AUDIT-20 glossariy saboqi)
 *
 * Umumiy nasr yo'li (`blocksFromLlm` → `setSection`) bu yerda ATAYLAB
 * ishlatilmaydi. Glossariyda aynan shu yo'l `h3` atama sarlavhalarini
 * yeb qo'ygan edi (jonli sinovda 20 atamadan 18 tasining nomi
 * yo'qolgan). Kartada oqibat og'irroq: «old yuz» bilan «orqa yuz»
 * nasrda ajralmaydi, ya'ni butun to'plam bir paragrafga aylanar va
 * MAKET (u kartani `doc.game.cards` dan chizadi) eski kartalarni
 * ko'rsatishda davom etardi — matn bilan model jimgina ajralib ketardi.
 * Shuning uchun sayqal MODEL so'raydi (`cardsRewritePrompt`), model
 * almashadi va nasr o'sha ro'yxatdan QAYTA yig'iladi (`cardSections`).
 *
 * Nishon bu oilada BITTA (`cards`): hujjatning butun mazmuni shu
 * ro'yxatda va uni bo'laklarga bo'lishning ma'nosi yo'q.
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
import { GAME_LIMITS, type Flashcard, type GameModel } from "../types";
import { gameLayoutLabels } from "../layout";
import { cardSections, pickCards } from "./engine";
import { cardsLangOf, type FlashcardsInput } from "./input";
import { cardsRewritePrompt, cardsSystemPrompt, type FlashcardsContext } from "./prompts";
import {
  CARDS_TARGET,
  cardsJudgeChecks,
  neutralCardsJudge,
  reviewFlashcards,
  scoreCardsReview,
  type CardsJudgeResult,
} from "./review";

export { POLISH_SKIP, RewriteError };
export type { PolishPlan, PolishSkip };

export type FlashcardsFix = Fix;

/**
 * Q-3 qabul chegarasi — o'qituvchi hujjatlaridagi kabi +1.
 * To'plam qisqa va baholovchi ballari kamroq tebranadi.
 */
export const FLASHCARDS_ACCEPT_DELTA = 1;

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

/** Sayqal op tili — bu oilada BITTA amal: kartalar ro'yxatini almashtirish. */
export type CardsOp = { op: "setCards"; cards: Flashcard[] };

export type CardsRewriteDeps = { complete: CompleteFn; deadline?: number };

/* ────────────────────────── kontekst ────────────────────────── */

/**
 * Dvigatel konteksti HUJJATDAN (forma qiymatlari endi yo'q) —
 * `teacherContextOf` naqshi.
 */
export function flashcardsContextOf(doc: AcademicDoc): FlashcardsContext {
  const model = doc.game!;
  const m = model.cards;
  const language = model.language || doc.meta.language || "uz";
  const spec = gameTypeOf("flashcards", model.type);
  const input: FlashcardsInput = {
    type: spec.id,
    cardType: spec.cardType,
    topic: model.topic || doc.meta.topic,
    subject: doc.meta.subject ?? "",
    language,
    lang: cardsLangOf(language),
    grade: Number(doc.meta.grade) || 0,
    cardCount: m?.cards.length ?? GAME_LIMITS.countDefault,
    includeExample: m?.includeExample !== false,
    extra: doc.meta.extra ?? "",
  };
  return { spec, input };
}

/* ────────────────────────── reja ────────────────────────── */

const rewriteFix = (target: string, instruction: string): FlashcardsFix => ({ op: "rewrite", target, instruction });

/**
 * Past baholangan mezon → HALOL ko'rsatma. Baholovchi `fixes` bermasa
 * yoki hammasi Q-2 filtridan tushsa, sayqal bo'sh qolmasin
 * (`teacherCriterionFixes` naqshi).
 */
export function cardsCriterionFixes(review: DocReview, doc: AcademicDoc): FlashcardsFix[] {
  const model = doc.game;
  if (!model?.cards) return [];
  const level = (id: string) => review.checks.find((c) => c.id === `judge:${id}`)?.level;
  const low = (id: string) => level(id) === "red" || level(id) === "yellow";
  const out: FlashcardsFix[] = [];
  const push = (instruction: string) => {
    if (!out.some((f) => f.instruction === instruction)) out.push(rewriteFix(CARDS_TARGET, instruction));
  };
  const qa = model.cards.type === "qa";

  if (low("termClarity")) {
    push(
      qa
        ? "Make every front ONE complete, self-contained question that a pupil can answer without seeing the back."
        : "Make every front a single unambiguous term — no article, no explanation, nothing that only makes sense next to the back side.",
    );
  }
  if (low("definitionCompleteness")) {
    push("Rewrite the weak backs so that each one fully answers or defines its front on its own: category first, then the distinguishing feature. Never open the back with the term itself.");
  }
  if (low("languageLevel")) {
    push(`Restate the cards in the vocabulary of ${Number(doc.meta.grade) > 0 ? `grade ${doc.meta.grade}` : "the stated level"}; explain or remove any jargon that the pupil has not met.`);
  }
  if (low("exampleRelevance") && model.cards.includeExample !== false) {
    push("Rewrite each example so that it USES the term in a natural sentence from this subject — not a second definition in other words.");
  }
  if (low("memorability")) {
    push("Shorten the backs that read like a paragraph: one or two sentences the pupil can recall, keeping the fact and dropping the padding.");
  }
  return out;
}

/**
 * Hisobot → fix rejasi.
 *
 * Avtomatik TUZATILMAYDI: `cardCount` — bu MIQDOR bandi, uni «tuzatish»
 * yangi material o'ylab topish bo'lardi va `delivered` allaqachon farqni
 * qaytaradi; `structure` — kod xatosi, modelni qayta so'rash uni
 * tuzatmaydi.
 *
 * Nishon bitta bo'lgani uchun barcha ko'rsatmalar BITTA fix ga
 * birlashadi (`(1) … (2) …`): ikki marta qayta yozish ikkinchi
 * so'rovda birinchisining natijasini buzardi.
 */
const NOT_FIXABLE = new Set(["cardCount", "structure"]);

export function planFlashcardsPolish(review: DocReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  const instructions: string[] = [];
  if (!doc.game?.cards) return { fixes: [], skipped: [{ id: "structure", reason: "manual" }] };

  const add = (instruction: string) => {
    if (!instructions.includes(instruction)) instructions.push(instruction);
  };

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  // Qizil avval — 60 % ulushda har qizil band butun yashilcha yo'qotadi.
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  for (const c of rules) {
    if (NOT_FIXABLE.has(c.id)) {
      skipped.push({ id: c.id, reason: c.id === "cardCount" ? "user" : "manual" });
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
  for (const f of cardsCriterionFixes(review, doc)) add(f.instruction);

  if (!instructions.length) return { fixes: [], skipped };
  const capped = instructions.slice(0, POLISH_MAX_FIXES);
  for (const extra of instructions.slice(POLISH_MAX_FIXES)) skipped.push({ id: extra.slice(0, 40), reason: "limit" });
  return {
    fixes: [rewriteFix(CARDS_TARGET, capped.length === 1 ? capped[0] : capped.map((s, i) => `(${i + 1}) ${s}`).join(" "))],
    skipped,
  };
}

/* ────────────────────────── «Sizdan kutiladi» ────────────────────────── */

/**
 * AI O'YLAB TOPMAYDIGAN narsalar (Q-2). Kartalarda ular ikkita: miqdor
 * kamomadi va foydalanuvchi `extra` da so'ragan darslik ma'lumoti.
 */
export function flashcardsUserNeeds(review: DocReview, doc: AcademicDoc): UserNeed[] {
  const out: UserNeed[] = [];
  if (!doc.game?.cards) return out;

  const count = review.checks.find((c) => c.id === "cardCount");
  if (count && count.level !== "green") {
    out.push({ id: "cardCount", label: "Kartalar soni", hint: `${count.detail ?? ""} — mavzuni toraytiring yoki kamroq karta tanlang` });
  }
  if (/darslik|sahifa|bet raqam|страниц|textbook page/i.test(String(doc.meta.extra ?? ""))) {
    out.push({
      id: "textbook",
      label: "Darslik ma’lumoti",
      hint: "Darslik sahifasi va bo‘lim raqamini AI bilmaydi — ularni o‘zingiz qo‘shing (uydirma raqam yozilmaydi)",
    });
  }
  return out;
}

/* ────────────────────────── qayta yozish ────────────────────────── */

async function ask(deps: CardsRewriteDeps, system: string, user: string, maxTokens: number): Promise<string> {
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
 * Karta soni SAQLANISHI shart: kam qaytgan javob rad etiladi
 * (`RewriteError`), chunki sayqal hech qachon foydalanuvchi to'lagan
 * kartani O'CHIRMASLIGI kerak — bu ballni ko'tarib, mahsulotni
 * kamaytirishning eng oson yo'li bo'lardi.
 */
export async function rewriteFlashcardsFix(doc: AcademicDoc, fix: FlashcardsFix, deps: CardsRewriteDeps): Promise<{ ops: CardsOp[] }> {
  const model = doc.game;
  if (!model?.cards) throw new RewriteError("Karta modeli yo‘q — qaytadan yarating", 409, "legacy");
  if (fix.target !== CARDS_TARGET) throw new RewriteError(`Nishon topilmadi: ${fix.target}`, 422, "target");

  const ctx = flashcardsContextOf(doc);
  const system = cardsSystemPrompt(ctx);
  const current = model.cards.cards;
  const raw = await ask(deps, system, cardsRewritePrompt(ctx, current, fix.instruction), Math.min(8000, 900 + current.length * 170));
  const data = parseLlmObject<{ cards?: unknown; items?: unknown }>(raw);
  const picked = pickCards(data?.cards ?? data?.items, {
    spec: ctx.spec,
    includeExample: ctx.input.includeExample,
    seen: new Set<string>(),
  });
  if (picked.length !== current.length) throw new RewriteError(RETRY_MSG, 422, "llm");
  // Barqaror id lar SAQLANADI — tahrir yo'llari (`game.cards.<k>`) siljimasin.
  const cards = picked.map((c, i) => ({ ...c, id: current[i].id }));
  return { ops: [{ op: "setCards", cards }] };
}

/* ────────────────────────── op larni qo'llash ────────────────────────── */

/**
 * `setCards` — model VA nasr BIRGA almashadi.
 *
 * Nasrni alohida qoldirish mumkin emas: hisobot va baholovchi modelni,
 * qidiruv esa nasrni o'qiydi, ya'ni ikkalasi ajralsa hujjat ikki xil
 * javob berardi.
 */
export function applyCardsOps(doc: AcademicDoc, ops: CardsOp[]): ApplyOpsResult {
  const model = doc.game;
  if (!model?.cards) return { ok: false, error: "karta modeli yo‘q" };
  let cards = model.cards.cards;
  for (const op of ops) {
    if (op.op !== "setCards") return { ok: false, error: `noma'lum op: ${String((op as { op?: unknown }).op)}` };
    if (op.cards.length !== cards.length) return { ok: false, error: `karta soni mos emas: ${op.cards.length} ≠ ${cards.length}` };
    cards = op.cards;
  }
  const nextModel: GameModel = { ...model, cards: { ...model.cards, cards } };
  const L = gameLayoutLabels(nextModel.language || doc.meta.language);
  return { ok: true, doc: { ...doc, game: nextModel, sections: cardSections(nextModel.cards!, L) } };
}

/* ────────────────────────── ball ko'chirish ────────────────────────── */

/** Avvalgi hisobotdan baholovchi ballari — `judge:*` bandlaridan. */
export function cardsJudgeFromReview(prev: DocReview | undefined, model: GameModel): CardsJudgeResult | null {
  if (!prev) return null;
  const j = neutralCardsJudge(model);
  const criteria = gameTypeOf("flashcards", model.type).judge.criteria as readonly string[];
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

export type FlashcardsApplyPolishResult = ApplyPolishResultOf<CardsOp>;

const rewriteForCore = async (doc: AcademicDoc, fix: FlashcardsFix, deps: CardsRewriteDeps) => {
  const r = await rewriteFlashcardsFix(doc, fix, deps);
  return { ops: r.ops, unresolved: [], rewrittenSections: [CARDS_TARGET] };
};

export async function applyFlashcardsPolish(doc: AcademicDoc, fixes: FlashcardsFix[], deps: CardsRewriteDeps & { concurrency?: number }): Promise<FlashcardsApplyPolishResult> {
  return applyPolishWith<CardsOp>(doc, fixes, { concurrency: deps.concurrency, rewrite: (d, fix) => rewriteForCore(d, fix, deps) });
}

export type FlashcardsPolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  judge?: boolean;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  concurrency?: number;
  acceptDelta?: number;
};

export type FlashcardsPolishResult = RunPolishResult<CardsOp>;

export async function runFlashcardsPolish(doc: AcademicDoc, review: DocReview, deps: FlashcardsPolishDeps): Promise<FlashcardsPolishResult> {
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const model = doc.game;
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  return runPolishWith<CardsOp, CardsJudgeResult>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    ...(deps.guard ? { guard: deps.guard } : {}),
    ...(deps.concurrency ? { concurrency: deps.concurrency } : {}),
    acceptDelta: deps.acceptDelta ?? FLASHCARDS_ACCEPT_DELTA,
    plan: planFlashcardsPolish,
    userNeeds: flashcardsUserNeeds,
    rewrite: (d, fix, deadline) => rewriteForCore(d, fix, { complete, deadline }),
    apply: applyCardsOps,
    review: (d) => reviewFlashcards(d, { complete, deadline: deps.deadline, judge, now }),
    judgeFromReview: (prev) => (model ? cardsJudgeFromReview(prev, model) : null),
    rescore: (fresh, j) => {
      if (!model) return fresh;
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      return { ...fresh, score: scoreCardsReview(rules, model, j), checks: [...rules, ...cardsJudgeChecks(model, j)], judgeNotes: [...j.notes, POLISH_JUDGE_NOTE] };
    },
  });
}
