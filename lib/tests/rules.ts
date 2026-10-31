/**
 * «Test ishlash» (paid tests, owner request 7) -- the rules that need no database: setting keys and defaults,
 * the seeded-RNG question selection, the answer letters and the score arithmetic. Isomorphic (the page and the
 * server read the same numbers; the importer reuses the letter parser).
 */

export const TESTS_ENABLED_KEY = "tests.enabled";
/** Price of one attempt by mode (owner 2026-10-31): one subject vs «hammasi» (every subject). */
export const TESTS_PRICE_SUBJECT_KEY = "tests.price_subject";
export const TESTS_PRICE_ALL_KEY = "tests.price_all";
export const TESTS_FIRST_FREE_KEY = "tests.first_attempt_free";
export const TESTS_PER_SUBJECT_KEY = "tests.questions_per_subject";
export const TESTS_MINUTES_SUBJECT_KEY = "tests.minutes_per_subject";
export const TESTS_MINUTES_ALL_KEY = "tests.minutes_all";
export const TESTS_POINTS_KEY = "tests.points_per_correct";

/** Ships dark: the owner switches it on after reviewing the bank. */
export const TESTS_ENABLED_DEFAULT = false;
export const TESTS_PRICE_SUBJECT_DEFAULT = 1500;
export const TESTS_PRICE_ALL_DEFAULT = 4000;
export const TESTS_PRICE_MAX = 1_000_000;
export const TESTS_FIRST_FREE_DEFAULT = false;
/** BMB: 10 random questions of one random variant per subject; «hammasi» = this x the number of subjects (30). */
export const TESTS_PER_SUBJECT_DEFAULT = 10;
export const TESTS_PER_SUBJECT_MAX = 50;
/** BMB: 20 minutes for one subject, 60 for «hammasi». */
export const TESTS_MINUTES_SUBJECT_DEFAULT = 20;
export const TESTS_MINUTES_ALL_DEFAULT = 60;
export const TESTS_MINUTES_MAX = 300;
/** BMB / DTM: +1.1 per correct answer, no negative marking. */
export const TESTS_POINTS_DEFAULT = 1.1;
export const TESTS_POINTS_MAX = 10;

export const OPTION_COUNT = 4;
/** Option letters; the stored answer is the index into this list. */
export const LETTERS = ["A", "B", "C", "D"] as const;

export type TestMode = "subject" | "all";

/** `a`..`d` in any case (the BMB data is mixed-case) -> 0..3; anything else -> null. */
export function parseAnswerLetter(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const i = "abcd".indexOf(raw.trim().toLowerCase());
  return raw.trim().length === 1 && i >= 0 ? i : null;
}

export const letterOf = (i: number): string => LETTERS[i] ?? "?";

/* ───────────────────────── RNG and selection ───────────────────────── */

/** A random source in [0, 1). The server uses `crypto`; the tests inject a seeded one. */
export type Rng = () => number;

/** mulberry32: a tiny deterministic generator (tests only; the product never seeds). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export type PoolQuestion = { id: number; variant: number };

/**
 * One subject's questions for an attempt: ONE random variant, then `want` random questions of it in random order
 * (the BMB mechanics). Variants with fewer than `want` questions are skipped while a complete variant exists; if
 * none is complete, the largest variant is played whole. `[]` when the pool is empty.
 * The variants are visited in ascending order before the random pick, so a given seed always gives the same result.
 */
export function pickSubjectQuestions(pool: readonly PoolQuestion[], want: number, rng: Rng): number[] {
  if (!pool.length || want < 1) return [];
  const byVariant = new Map<number, number[]>();
  for (const q of pool) byVariant.set(q.variant, [...(byVariant.get(q.variant) ?? []), q.id]);
  const variants = [...byVariant.keys()].sort((a, b) => a - b);
  const complete = variants.filter((v) => byVariant.get(v)!.length >= want);
  let variant: number;
  if (complete.length) variant = complete[Math.floor(rng() * complete.length)]!;
  else variant = variants.reduce((best, v) => (byVariant.get(v)!.length > byVariant.get(best)!.length ? v : best), variants[0]!);
  const ids = [...byVariant.get(variant)!].sort((a, b) => a - b);
  return shuffled(ids, rng).slice(0, want);
}

/* ───────────────────────── scoring and time ───────────────────────── */

/**
 * Score of `correct` answers at `pointsPerCorrect` each, in integer hundredths so 7 x 1.1 is exactly 7.7 (not
 * 7.700000000000001) and the stored NUMERIC(8,2) never drifts.
 */
export function scoreOf(correct: number, pointsPerCorrect: number): number {
  return Math.round(correct * Math.round(pointsPerCorrect * 100)) / 100;
}

/** The time limit is over strictly AFTER the deadline (an answer at the deadline instant still counts). */
export function isPastDeadline(deadline: Date | string, now: Date): boolean {
  return now.getTime() > new Date(deadline).getTime();
}

/** Price of an attempt of `mode` (single subject or «hammasi»), before the free-first-attempt rule. */
export const priceFor = (mode: TestMode, prices: { subject: number; all: number }): number => (mode === "all" ? prices.all : prices.subject);

/** Minutes allowed for an attempt of `mode` (single subject or «hammasi»). */
export const minutesFor = (mode: TestMode, subject: number, all: number): number => (mode === "all" ? all : subject);
