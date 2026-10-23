/**
 * Daily logic quiz (owner request 16, docs/program-17/PLAN.md item 16, decision D5): pure rules shared by the
 * service (`lib/server/daily-quiz.ts`, authoritative), the sender, the settings catalog, the bot callbacks
 * and the wallet. No I/O, no question text — the bank (`questions.ts`) is only reached through the bank SIZE,
 * so importing the ledger note into client code never pulls 150 questions into the bundle.
 *
 * "Day" is always the Asia/Tashkent calendar date as `YYYY-MM-DD` (UTC+5, no DST).
 */

export const DAILY_QUIZ_PER_DAY = 3;

/** `app_settings` keys. */
export const DQ_ENABLED_KEY = "daily_quiz.enabled";
export const DQ_REWARD_KEY = "daily_quiz.reward";
export const DQ_CAP_KEY = "daily_quiz.monthly_cap";
export const DQ_BUDGET_KEY = "daily_quiz.daily_budget";
export const DQ_HOUR_KEY = "daily_quiz.hour";

export const DQ_REWARD_DEFAULT = 500;
export const DQ_REWARD_MAX = 100_000;
export const DQ_CAP_DEFAULT = 5000;
export const DQ_BUDGET_DEFAULT = 300_000;
export const DQ_MONEY_MAX = 1_000_000_000;
export const DQ_HOUR_DEFAULT = 9;

/** Ledger note (`transactions.note`, kind `bonus`); the wallet and the bot title the row by it. */
export const DAILY_QUIZ_NOTE = "Kunlik savollar bonusi";

/** Ledger reference prefix; one reference per user and day => the bonus is paid at most once. */
export const DAILY_QUIZ_REF_PREFIX = "daily-quiz:";
export function dailyQuizRef(userId: string, day: string): string {
  return `${DAILY_QUIZ_REF_PREFIX}${userId}:${day}`;
}
/** SQL `LIKE` pattern of every reference of one day (`daily-quiz:<anyUser>:<day>`). */
export function dailyQuizDayRefPattern(day: string): string {
  return `${DAILY_QUIZ_REF_PREFIX}%:${day}`;
}

/* ───────────────────────── Tashkent calendar ───────────────────────── */

const TASHKENT_OFFSET_MS = 5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** The Tashkent calendar date (`YYYY-MM-DD`) of an instant. */
export function tashkentDay(now: Date | number = Date.now()): string {
  const ms = (typeof now === "number" ? now : now.getTime()) + TASHKENT_OFFSET_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** The Tashkent hour (0-23) of an instant. */
export function tashkentHour(now: Date | number = Date.now()): number {
  const ms = (typeof now === "number" ? now : now.getTime()) + TASHKENT_OFFSET_MS;
  return new Date(ms).getUTCHours();
}

export function isDayString(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Days since 1970-01-01 of a `YYYY-MM-DD` date (the compact day marker of bot callbacks). */
export function dayNumber(day: string): number {
  if (!isDayString(day)) throw new Error(`bad day: ${day}`);
  return Math.round(new Date(`${day}T00:00:00Z`).getTime() / DAY_MS);
}

export function dayFromNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** First day of the month of `day`, as `YYYY-MM-01`. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/* ───────────────────────── Selection ───────────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fixed permutation of 0..n-1 per cycle number (Fisher-Yates over a seeded PRNG). */
export function cyclePermutation(cycle: number, n: number): number[] {
  const rnd = mulberry32(Math.imul(cycle + 1, 0x9e3779b1) ^ 0x51ed270b);
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/**
 * The bank indexes of a day's questions. The bank is cut into cycles of `floor(size / 3)` days; each cycle
 * walks its own seeded permutation of the whole bank three at a time, so within a cycle no question repeats.
 * Everybody gets the same three that day, and any process computes them the same way (no state, no clock).
 */
export function questionIndexes(day: string, bankSize: number): number[] {
  const daysPerCycle = Math.floor(bankSize / DAILY_QUIZ_PER_DAY);
  if (daysPerCycle < 1) throw new Error("question bank is smaller than one day");
  const n = dayNumber(day);
  const cycle = Math.floor(n / daysPerCycle);
  const slot = n - cycle * daysPerCycle;
  return cyclePermutation(cycle, bankSize).slice(slot * DAILY_QUIZ_PER_DAY, (slot + 1) * DAILY_QUIZ_PER_DAY);
}
