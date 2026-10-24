/**
 * «Qattiqqo'l domla» -- the rules that do not need a database (owner request 15): constants, the grade table,
 * the question / answer shapes and the defensive parsers of what the LLM returns. Isomorphic (the page and the
 * server read the same numbers).
 */

export const DOMLA_ENABLED_KEY = "domla.enabled";
export const DOMLA_PRICE_KEY = "domla.price";
export const DOMLA_PRICE_DEFAULT = 3000;
export const DOMLA_PRICE_MAX = 1_000_000;

/** Questions per defence. */
export const DOMLA_QUESTIONS = 5;
/** A score per answer: 0 (nothing / wrong) ... 5 (complete). */
export const DOMLA_MAX_SCORE = 5;
/** A session with no activity for this long expires (it can be resumed inside the window). */
export const DOMLA_IDLE_MINUTES = 30;
/** A voice answer: at most this big / this long (Telegram sends both numbers with the message). */
export const DOMLA_VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const DOMLA_VOICE_MAX_SECONDS = 120;
/** A typed answer. */
export const DOMLA_TEXT_MAX_CHARS = 2000;
/** The tools whose works can be defended. */
export const DOMLA_SOURCE_TOOLS = ["slide", "pro-slide"] as const;

export const QUESTION_KINDS = ["why", "method", "definition", "number", "practice"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** One defence question: the spoken text, the ideal answer (the rubric the answer is scored against). */
export type DomlaQuestion = { kind: QuestionKind; text: string; ideal: string };

/** One scored answer. `transcript` is the ONLY trace of a voice answer -- no audio is kept. */
export type DomlaAnswer = {
  idx: number;
  via: "voice" | "text";
  transcript: string;
  score: number;
  verdict: string;
  mistake: string;
};

export type DomlaStatus = "preparing" | "active" | "finished" | "expired" | "failed";
export type Grade = 2 | 3 | 4 | 5;

/**
 * Grade (Uzbek 5-point scale) from the per-question scores: the share of the maximum, thresholds 86 / 71 / 55 %
 * (the usual 5 / 4 / 3 bands of the Uzbek rating system). A question never answered counts 0. Integer arithmetic
 * only, so a boundary is exact: with 5 questions 22/25 -> 5, 18/25 -> 4, 14/25 -> 3.
 */
export function gradeOf(scores: readonly number[], questions: number = DOMLA_QUESTIONS): Grade {
  const max = questions * DOMLA_MAX_SCORE;
  let sum = 0;
  for (let i = 0; i < questions; i++) sum += clampScore(scores[i]);
  const pct = sum * 100;
  if (pct >= 86 * max) return 5;
  if (pct >= 71 * max) return 4;
  if (pct >= 55 * max) return 3;
  return 2;
}

export function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(DOMLA_MAX_SCORE, Math.round(n))) : 0;
}

/** A section key of a defence in the history list. */
export const GRADE_WORD: Record<Grade, string> = { 2: "2 (qoniqarsiz)", 3: "3 (qoniqarli)", 4: "4 (yaxshi)", 5: "5 (a'lo)" };

const isKind = (v: unknown): v is QuestionKind => (QUESTION_KINDS as readonly string[]).includes(String(v));
const clean = (v: unknown, max: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The LLM's question list, defensively: tolerates a wrapper object, a missing / unknown `kind` (taken from the
 * slot's position), extra items. Returns `null` unless there are exactly `DOMLA_QUESTIONS` usable items (a question
 * and an ideal answer, both non-trivial) -- a short list is a failed generation, never a shorter defence.
 */
export function parseQuestions(raw: unknown): DomlaQuestion[] | null {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { questions?: unknown } | null)?.questions) ? (raw as { questions: unknown[] }).questions : null;
  if (!list) return null;
  const out: DomlaQuestion[] = [];
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>;
    const text = clean(o.text ?? o.question ?? o.q, 400);
    const ideal = clean(o.ideal ?? o.answer ?? o.rubric, 900);
    if (text.length < 8 || ideal.length < 8) continue;
    out.push({ kind: isKind(o.kind) ? o.kind : QUESTION_KINDS[out.length % QUESTION_KINDS.length]!, text, ideal });
    if (out.length === DOMLA_QUESTIONS) break;
  }
  return out.length === DOMLA_QUESTIONS ? out : null;
}

export type ScoreResult = { transcript: string; score: number; verdict: string; mistake: string };

/** The scorer's JSON, defensively. `null` when it is not an object with a usable score. */
export function parseScore(raw: unknown): ScoreResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const n = typeof o.score === "number" ? o.score : Number(o.score);
  if (!Number.isFinite(n)) return null;
  return {
    transcript: clean(o.transcript, DOMLA_TEXT_MAX_CHARS),
    score: clampScore(n),
    verdict: clean(o.verdict, 200),
    mistake: clean(o.mistake, 300),
  };
}
