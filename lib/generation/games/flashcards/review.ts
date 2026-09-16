/**
 * TAYYORLIK HISOBOTI — FLESH KARTALAR (AUDIT-21 WP-B) — `reviewFlashcards`.
 *
 * Ikki qatlam (`teacher/review.ts` bilan bir xil naqsh, mantiq NEYTRAL
 * qatlamda `report/`):
 *   1. QOIDALAR — deterministik bandlar, id lari `registry.ts`
 *      `GAME_RULE_IDS.flashcards` da QULFLANGAN (R5 §4).
 *   2. BAHOLOVCHI — `judge` rol, turning `JudgeSpec` i bo'yicha 5 mezon
 *      × 0–3 (`CARDS_JUDGE_CRITERIA`).
 *
 * BALL = `report/score.ts scoreReviewFor` (60 % qoidalar + 40 %
 * baholovchi).
 *
 * Bandlar MODELDAN o'qiladi (`doc.game.cards`), bo'lim matnidan emas:
 * kartaning old va orqa yuzi nasrda `h3`/`p` bo'lib yotadi va ularni
 * qaytadan ajratish (qaysi paragraf qaysi kartaniki) faqat xato beradi.
 * Sayqal ham aynan MODELNI qayta yozadi (`polish.ts`), ya'ni hisobot
 * tuzatishdan keyin haqiqatan ham o'zgargan narsani o'lchaydi.
 */
import type { AcademicDoc } from "../../types";
import type { DocReview, JudgeResult, JudgeSpec, ReviewCheck } from "../../report/types";
import { check, rewrite, scoreReviewFor } from "../../report/score";
import { JUDGE_MIN_MS, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../../report/judge";
import { sampleForJudge } from "../../report/text";
import { remainingMs } from "../../quality";
import type { LlmUsage } from "../../llm-roles";
import type { CompleteFn } from "../../research/pipeline";
import { GAME_RULE_IDS, gameTypeOf, type CardsTypeSpec } from "../registry";
import { GAME_LIMITS, type FlashcardsModel, type GameModel } from "../types";
import { frontKey } from "./engine";

/* ────────────────────────── tiplar ────────────────────────── */

export type CardsJudgeResult = JudgeResult<string>;

export type FlashcardsReviewOpts = {
  complete?: CompleteFn;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (testlar). */
  judge?: boolean;
  now?: Date;
  onUsage?: (u: LlmUsage) => void;
};

/** Baholovchiga beriladigan matn shu belgidan oshmaydi. */
export const JUDGE_TEXT_CHARS = 12_000;

/** Sayqal nishoni — bu oilada bitta bo'lim (kartalar). */
export const CARDS_TARGET = "cards";

const EMPTY_JUDGE = { notes: [], fixes: [] } as unknown as CardsJudgeResult;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

function specOf(model: GameModel): CardsTypeSpec {
  return gameTypeOf("flashcards", model.type);
}

/** Savol shaklidagi old yuz («… ?», yoki savol so'zi bilan boshlanadi). */
function looksLikeQuestion(front: string): boolean {
  return /[?？]\s*$/.test(front.trim());
}

/* ══════════════════════════ qoidalar ══════════════════════════ */

export function cardsRuleChecks(doc: AcademicDoc): ReviewCheck[] {
  const model = doc.game;
  if (!model || model.kind !== "flashcards" || !model.cards) {
    return [check("structure", "red", "Tuzilma", "Karta modeli hujjatda yo‘q — qaytadan yarating")];
  }
  const spec = specOf(model);
  const m: FlashcardsModel = model.cards;
  const cards = m.cards;
  const out: ReviewCheck[] = [];
  const fix = (instruction: string) => rewrite(CARDS_TARGET, instruction);

  /* ── 1. cardCount ── */
  {
    const n = cards.length;
    /*
     * VA'DA qilingan son hujjatda saqlanmaydi (forma qiymatlari
     * hisobot vaqtida yo'q — u tahrirdan keyin ham qayta hisoblanadi).
     * Lekin u har doim reyestr chipi (5/10/15/20), ya'ni chip bo'lmagan
     * son — YETKAZILMAGANLIK belgisi va uning eng yaqin YUQORI chipi
     * so'ralgan son bo'ladi. `delivered` farqni allaqachon qaytaradi;
     * bu band foydalanuvchiga SABABINI ko'rsatadi.
     */
    const chips = GAME_LIMITS.counts;
    const exact = chips.includes(n);
    const promised = chips.find((c) => c >= n) ?? GAME_LIMITS.countMax;
    out.push(
      exact
        ? check("cardCount", "green", "Kartalar soni", `${n} ta`)
        : check("cardCount", n >= GAME_LIMITS.countMin ? "yellow" : "red", "Kartalar soni", `${n} ta (so‘ralgani ${promised} ta bo‘lishi mumkin — farq qaytariladi)`),
    );
  }

  /* ── 2. frontLength ── */
  {
    const [lo, hi] = spec.limits.frontChars;
    const bad = cards.filter((c) => c.front.length < lo || c.front.length > hi);
    const d = `${cards.length} tadan ${bad.length} tasi ${lo}–${hi} belgidan tashqarida`;
    out.push(
      bad.length === 0
        ? check("frontLength", "green", "Old yuz uzunligi", `hammasi ${lo}–${hi} belgi`)
        : check(
            "frontLength",
            bad.length > cards.length / 4 ? "red" : "yellow",
            "Old yuz uzunligi",
            `${d}: ${list(bad.map((c) => c.front))}`,
            fix(`Rewrite the fronts that are too short or too long so that every front is ${lo}–${hi} characters. Keep each card about the same thing.`),
          ),
    );
  }

  /* ── 3. backLength ── */
  {
    const [lo, hi] = spec.limits.backChars;
    const bad = cards.filter((c) => c.back.length < lo || c.back.length > hi);
    const d = `${cards.length} tadan ${bad.length} tasi ${lo}–${hi} belgidan tashqarida`;
    out.push(
      bad.length === 0
        ? check("backLength", "green", "Orqa yuz uzunligi", `hammasi ${lo}–${hi} belgi`)
        : check(
            "backLength",
            bad.length > cards.length / 4 ? "red" : "yellow",
            "Orqa yuz uzunligi",
            `${d}: ${list(bad.map((c) => c.front))}`,
            fix(
              `Rewrite the backs that are too short or too long so that every back is ${lo}–${hi} characters — that is what fits on the printed card. Keep the facts, drop the padding.`,
            ),
          ),
    );
  }

  /* ── 4. noDuplicate ── */
  {
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const c of cards) {
      const k = frontKey(c.front);
      if (seen.has(k)) dup.push(c.front);
      else seen.add(k);
    }
    out.push(
      dup.length === 0
        ? check("noDuplicate", "green", "Takrorlanmaydi", "bir xil old yuz yo‘q")
        : check("noDuplicate", "red", "Takrorlanmaydi", `${dup.length} ta takror: ${list(dup)}`, fix("Replace the duplicated cards with different terms or questions from the same topic; keep the other cards unchanged.")),
    );
  }

  /* ── 5. examplePresence ── */
  {
    const withExample = cards.filter((c) => Boolean(c.example?.trim())).length;
    const share = cards.length ? withExample / cards.length : 0;
    if (m.includeExample === false) {
      // Misol SO'RALMAGAN — yo'qligi nuqson emas (`GlossaryModel` saboqi).
      out.push(check("examplePresence", "green", "Misol qatori", "so‘ralmagan"));
    } else if (share >= GAME_LIMITS.exampleCoverage) {
      out.push(check("examplePresence", "green", "Misol qatori", `${withExample}/${cards.length} kartada (${pct(share)})`));
    } else {
      out.push(
        check(
          "examplePresence",
          share > 0 ? "yellow" : "red",
          "Misol qatori",
          `${withExample}/${cards.length} kartada (${pct(share)}, kerak ${pct(GAME_LIMITS.exampleCoverage)})`,
          fix(`Add the missing «example» line: one short sentence (at most ${GAME_LIMITS.cardExampleCharsMax} characters) that USES the term in a real subject context, not a restatement of the back side.`),
        ),
      );
    }
  }

  /* ── 6. cardTypeMatch ── */
  {
    const qa = m.type === "qa";
    const bad = cards.filter((c) => (qa ? !looksLikeQuestion(c.front) : looksLikeQuestion(c.front)));
    const want = qa ? "savol belgisi bilan tugashi" : "savol EMAS, atama bo‘lishi";
    out.push(
      bad.length === 0
        ? check("cardTypeMatch", "green", "Tur mosligi", qa ? "har old yuz — to‘liq savol" : "har old yuz — atama")
        : check(
            "cardTypeMatch",
            bad.length > cards.length / 4 ? "red" : "yellow",
            "Tur mosligi",
            `${bad.length} ta old yuz ${want} kerak: ${list(bad.map((c) => c.front))}`,
            fix(
              qa
                ? "Rewrite the fronts that are not questions into ONE complete question each, ending in a question mark, answerable without seeing the back."
                : "Rewrite the fronts that are phrased as questions into the TERM itself — no question mark, no article, no explanation.",
            ),
          ),
    );
  }

  return out;
}

/** Kindning qoida id lari — reyestr bilan MOS ekanini test qulflaydi. */
export function flashcardsRuleIds(): readonly string[] {
  return GAME_RULE_IDS.flashcards;
}

/* ══════════════════════════ baholovchi ══════════════════════════ */

function judgeSpecOf(model: GameModel): JudgeSpec<string> {
  return specOf(model).judge as JudgeSpec<string>;
}

export function cardsJudgeSystemPrompt(model: GameModel, targets: string[]): string {
  return judgeSystemPromptFor(judgeSpecOf(model), targets);
}

export function parseCardsJudge(model: GameModel, raw: string | null | undefined, targets: string[]): CardsJudgeResult | null {
  return parseJudgeFor(judgeSpecOf(model), raw, targets);
}

export function neutralCardsJudge(model: GameModel): CardsJudgeResult {
  return neutralJudgeFor(judgeSpecOf(model));
}

export function cardsJudgeChecks(model: GameModel, j: CardsJudgeResult): ReviewCheck[] {
  return judgeChecksFor(judgeSpecOf(model), j);
}

export function scoreCardsReview(rules: ReviewCheck[], model: GameModel, j: CardsJudgeResult): number {
  return scoreReviewFor(rules, j, judgeSpecOf(model).criteria);
}

/**
 * Baholovchiga beriladigan matn — KARTA JUFTLIKLARI shaklida.
 *
 * Nasr bo'limini (`sections`) uzatish ham mumkin edi, lekin u yerda
 * old yuz `h3`, orqa yuz `p` bo'lib yotadi va baholovchi «bu ikkisi
 * bitta kartami?» degan savolga o'zi javob topishi kerak bo'lardi —
 * `termClarity`/`definitionCompleteness` mezonlari aynan shu juftlikka
 * qaraydi.
 */
export function cardsJudgeUserPrompt(doc: AcademicDoc, maxChars = JUDGE_TEXT_CHARS): string {
  const model = doc.game;
  const cards = model?.cards?.cards ?? [];
  const lines = cards.map((c, i) => `${i + 1}. FRONT: ${c.front} | BACK: ${c.back}${c.example ? ` | EXAMPLE: ${c.example}` : ""}`);
  const body = sampleForJudge([{ id: CARDS_TARGET, title: "cards", lines }], maxChars)
    .map((g) => `## ${g.id}\n${g.text}${g.truncated ? "\n[…truncated]" : ""}`)
    .join("\n\n");
  return [
    `TOOL: flashcards · TYPE: ${model?.type ?? "?"}`,
    `SUBJECT: ${doc.meta.subject ?? "—"} · GRADE: ${doc.meta.grade || "—"} · LANGUAGE: ${model?.language ?? doc.meta.language}`,
    `TOPIC: ${model?.topic ?? doc.meta.topic}`,
    "",
    "CARD SET:",
    body,
  ].join("\n");
}

/* ══════════════════════════ asosiy ══════════════════════════ */

/** Baholovchi nishonlari — bu oilada bitta bo'lim. */
export function flashcardsTargets(): string[] {
  return [CARDS_TARGET];
}

export async function reviewFlashcards(doc: AcademicDoc, opts: FlashcardsReviewOpts = {}): Promise<DocReview> {
  const now = opts.now ?? new Date();
  const model = doc.game;
  const rules = cardsRuleChecks(doc);
  const ok = Boolean(model && model.kind === "flashcards" && model.cards);

  let judge: CardsJudgeResult | null = null;
  const judgeNotes: string[] = [];
  if (ok && model && opts.judge !== false && opts.complete) {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, remainingMs(opts.deadline));
    if (timeoutMs >= JUDGE_MIN_MS) {
      const ids = flashcardsTargets();
      try {
        const r = await opts.complete("judge", cardsJudgeSystemPrompt(model, ids), cardsJudgeUserPrompt(doc), { json: true, maxTokens: 1200, timeoutMs });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseCardsJudge(model, r?.text, ids);
      } catch (e) {
        console.warn("[games] kartalar baholovchisi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push(JUDGE_NO_ANSWER);
  }

  const j = judge ?? (ok && model ? neutralCardsJudge(model) : EMPTY_JUDGE);
  judgeNotes.push(...j.notes);

  return {
    score: ok && model ? scoreCardsReview(rules, model, j) : 0,
    checks: [...rules, ...(ok && model ? cardsJudgeChecks(model, j) : [])],
    judgeNotes,
    // Bu oilada manba ro'yxati yo'q — ko'rsatkichlar 0 (panel ularni ko'rsatmaydi).
    verifiedShare: 0,
    recentShare: 0,
    builtAt: now.toISOString(),
  };
}
