import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { query, queryOne, transaction } from "./db";
import { topUpInTx } from "./credits";
import { getSetting, getSettingInTx } from "./settings";
import { log } from "./log";
import { DAILY_QUESTIONS, type DailyQuestion } from "../daily-quiz/questions";
import {
  DAILY_QUIZ_NOTE,
  DAILY_QUIZ_PER_DAY,
  DQ_BUDGET_KEY,
  DQ_CAP_KEY,
  DQ_ENABLED_KEY,
  DQ_REWARD_KEY,
  dailyQuizDayRefPattern,
  dailyQuizRef,
  isDayString,
  monthStart,
  questionIndexes,
  tashkentDay,
} from "../daily-quiz/rules";

/**
 * «Kunlik savollar» (owner request 16, docs/program-17/PLAN.md item 16, migration 055) — the ONE service of
 * the bot flow (CLAUDE.md «Bot va web — bitta servis qatlami»): today's three questions, the idempotent
 * answer step and the reward.
 *
 *  - Everybody gets the same three questions on a Tashkent day (`questionIndexes`: a seeded permutation per
 *    cycle, so nothing repeats within a cycle). The right answers never leave the server before the user has
 *    answered that question.
 *  - ONE attempt per (user, day): `daily_quiz_attempts` PRIMARY KEY. The FIRST answer to a question is final —
 *    the row only ever grows (`answers` is appended under the user's row lock); a replay of the same question
 *    returns the stored answer and changes nothing.
 *  - The 3rd answer finishes the attempt in the SAME transaction. 3/3 pays `daily_quiz.reward` through
 *    `credits.topUpInTx` (ledger reference `daily-quiz:<userId>:<day>`, kind `bonus`), unless the user's
 *    monthly cap (`daily_quiz.monthly_cap`, the sum of `rewarded_points` in the Tashkent month) or the day's
 *    global budget (`daily_quiz.daily_budget`, summed from the LEDGER by reference prefix) would be exceeded.
 *    The budget check runs under a per-day advisory lock, so concurrent winners cannot overshoot it.
 *  - `daily_quiz.enabled` is the kill switch: off => nothing starts, nothing is answered, nothing is paid.
 */

export type PublicQuestion = { index: number; id: string; q: string; options: [string, string, string, string] };

export type QuizOutcome = "lost" | "paid" | "cap" | "budget" | "none";

export type QuizResult = {
  /** Correct answers out of `DAILY_QUIZ_PER_DAY`. */
  correct: number;
  outcome: QuizOutcome;
  /** Bonus so'm credited (0 unless `outcome` is "paid"). */
  rewarded: number;
  /** The monthly cap, filled when `outcome` is "cap" (the message names it). */
  monthlyCap: number | null;
};

export type QuizState = {
  day: string;
  /** Chosen options so far (question order). */
  answers: number[];
  /** Correct answers so far. */
  correct: number;
  finished: boolean;
  /** The next unanswered question (null when finished). */
  next: PublicQuestion | null;
  result: QuizResult | null;
};

export type AnswerOutcome = {
  qIndex: number;
  /** What the user chose for this question (the stored first answer on a replay). */
  choice: number;
  /** Whether that choice is right. */
  correct: boolean;
  /** The right option (revealed only now that the question is answered). */
  right: number;
  explanation: string;
  /** True when this was a replay: the first answer stands, nothing changed. */
  locked: boolean;
  /** Public question text and options of the answered question (for the "✅/❌" message). */
  question: PublicQuestion;
  state: QuizState;
};

/* ───────────────────────── Questions ───────────────────────── */

/** The three questions of a Tashkent day (full items, with answers: server side only). */
export function todaysQuestions(day: string): DailyQuestion[] {
  if (!isDayString(day)) throw new ApiError("Sana noto'g'ri.", 400, { code: "bad_day" });
  return questionIndexes(day, DAILY_QUESTIONS.length).map((i) => DAILY_QUESTIONS[i]!);
}

function publicOf(q: DailyQuestion, index: number): PublicQuestion {
  return { index, id: q.id, q: q.q, options: q.options };
}

export async function isQuizEnabled(): Promise<boolean> {
  return getSetting(DQ_ENABLED_KEY);
}

async function requireEnabled(): Promise<void> {
  if (!(await isQuizEnabled())) {
    throw new ApiError("Kunlik savollar hozircha o'chiq.", 403, { code: "disabled" });
  }
}

/** The service only works on the current Tashkent day (a stale button of yesterday must not answer today's question). */
function requireToday(day: string, now: Date | undefined): void {
  if (!isDayString(day)) throw new ApiError("Sana noto'g'ri.", 400, { code: "bad_day" });
  if (day !== tashkentDay(now ?? new Date())) throw new ApiError("Bu savollar eskirgan.", 409, { code: "stale_day" });
}

/* ───────────────────────── State ───────────────────────── */

type AttemptRow = {
  answers: number[];
  correct: number;
  finished_at: Date | null;
  rewarded_points: number;
  outcome: QuizOutcome | null;
};

function stateOf(day: string, row: AttemptRow, monthlyCap: number | null): QuizState {
  const qs = todaysQuestions(day);
  const answers = (row.answers ?? []).map(Number);
  const finished = row.finished_at != null || answers.length >= DAILY_QUIZ_PER_DAY;
  const outcome: QuizOutcome = row.outcome ?? (row.correct >= DAILY_QUIZ_PER_DAY ? "none" : "lost");
  return {
    day,
    answers,
    correct: Number(row.correct),
    finished,
    next: finished ? null : publicOf(qs[answers.length]!, answers.length),
    result: finished
      ? { correct: Number(row.correct), outcome, rewarded: Number(row.rewarded_points), monthlyCap: outcome === "cap" ? monthlyCap : null }
      : null,
  };
}

async function attemptRow(client: Pick<PoolClient, "query">, userId: string, day: string, lock: boolean): Promise<AttemptRow> {
  await client.query("INSERT INTO daily_quiz_attempts (user_id, day) VALUES ($1, $2) ON CONFLICT (user_id, day) DO NOTHING", [userId, day]);
  const r = await client.query<AttemptRow>(
    `SELECT answers, correct, finished_at, rewarded_points, outcome FROM daily_quiz_attempts
      WHERE user_id = $1 AND day = $2 ${lock ? "FOR UPDATE" : ""}`,
    [userId, day],
  );
  return r.rows[0]!;
}

/** Locks the user's row (serialises their own taps and a parallel top-up) and refuses a missing / blocked account. */
async function lockUser(client: PoolClient, userId: string): Promise<void> {
  const u = await client.query<{ is_blocked: boolean }>("SELECT is_blocked FROM users WHERE id = $1 FOR UPDATE", [userId]);
  if (!u.rows[0]) throw new ApiError("Foydalanuvchi topilmadi.", 404, { code: "no_user" });
  if (u.rows[0].is_blocked) throw new ApiError("Hisobingiz bloklangan.", 403, { code: "blocked" });
}

/** Today's attempt of a user: creates it on first use, returns the state (the next question, or the finished result). */
export async function startOrGet(userId: string, day: string, opts: { now?: Date } = {}): Promise<QuizState> {
  requireToday(day, opts.now);
  await requireEnabled();
  const row = await transaction(async (client) => {
    await lockUser(client, userId);
    return attemptRow(client, userId, day, true);
  });
  return stateOf(day, row, row.outcome === "cap" ? await getSetting(DQ_CAP_KEY) : null);
}

/* ───────────────────────── Answer ───────────────────────── */

type Reward = { outcome: QuizOutcome; rewarded: number };

/** Sum of the user's bonus so'm from this quiz in the Tashkent month of `day`. */
async function monthlyPaid(client: PoolClient, userId: string, day: string): Promise<number> {
  const r = await client.query<{ n: string }>(
    `SELECT coalesce(sum(rewarded_points), 0)::text AS n FROM daily_quiz_attempts
      WHERE user_id = $1 AND day >= $2::date AND day < ($2::date + interval '1 month')`,
    [userId, monthStart(day)],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Bonus so'm already credited to everybody for `day`, read from the LEDGER (kind bonus, reference prefix). */
async function budgetSpent(client: PoolClient, day: string): Promise<number> {
  const r = await client.query<{ n: string }>(
    `SELECT coalesce(sum(points_delta), 0)::text AS n FROM transactions
      WHERE kind = 'bonus' AND reference LIKE $1
        AND created_at >= (($2::date)::timestamp AT TIME ZONE 'Asia/Tashkent')`,
    [dailyQuizDayRefPattern(day), day],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Decides and applies the reward of a 3/3 attempt. Runs inside the answering transaction, after the user's row
 * lock. Order: reward setting -> monthly cap (cheap, per user) -> per-day advisory lock -> global budget ->
 * credit. Each limit is "would exceed", so the cap / budget are never overshot by a partial payment.
 */
async function applyReward(client: PoolClient, userId: string, day: string): Promise<Reward & { monthlyCap: number | null }> {
  const reward = await getSettingInTx(client, DQ_REWARD_KEY);
  if (reward <= 0) return { outcome: "none", rewarded: 0, monthlyCap: null };

  const cap = await getSettingInTx(client, DQ_CAP_KEY);
  if ((await monthlyPaid(client, userId, day)) + reward > cap) return { outcome: "cap", rewarded: 0, monthlyCap: cap };

  // Concurrent winners queue here: the second one reads the budget AFTER the first one's credit is in the ledger.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`daily-quiz-budget:${day}`]);
  const budget = await getSettingInTx(client, DQ_BUDGET_KEY);
  if ((await budgetSpent(client, day)) + reward > budget) return { outcome: "budget", rewarded: 0, monthlyCap: null };

  const credited = await topUpInTx(client, userId, { points: reward }, dailyQuizRef(userId, day), "bonus", DAILY_QUIZ_NOTE);
  // `false` only when the reference already exists (cannot happen with the attempt's primary key): pay nothing twice.
  return credited ? { outcome: "paid", rewarded: reward, monthlyCap: null } : { outcome: "none", rewarded: 0, monthlyCap: null };
}

function intIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}

/**
 * Records the user's answer to question `qIndex` of `day`. Idempotent per question: the first answer is final
 * (a replay — double tap, redelivered update — returns it with `locked: true`). Answers must come in order.
 * Errors (`ApiError`, Uzbek message, `code`): 400 `bad_question` / `bad_choice` / `bad_day`, 403 `disabled` /
 * `blocked`, 404 `no_user`, 409 `stale_day` / `out_of_order`.
 */
export async function answer(userId: string, day: string, qIndex: unknown, choice: unknown, opts: { now?: Date } = {}): Promise<AnswerOutcome> {
  if (!intIn(qIndex, 0, DAILY_QUIZ_PER_DAY - 1)) throw new ApiError("Savol raqami noto'g'ri.", 400, { code: "bad_question" });
  if (!intIn(choice, 0, 3)) throw new ApiError("Javob varianti noto'g'ri.", 400, { code: "bad_choice" });
  requireToday(day, opts.now);
  await requireEnabled();
  const qs = todaysQuestions(day);
  const q = qs[qIndex]!;

  const done = await transaction(async (client) => {
    await lockUser(client, userId);
    const row = await attemptRow(client, userId, day, true);
    const answers = (row.answers ?? []).map(Number);

    if (qIndex < answers.length) return { row, locked: true, chosen: answers[qIndex]!, monthlyCap: null as number | null };
    if (qIndex > answers.length) throw new ApiError("Avval oldingi savolga javob bering.", 409, { code: "out_of_order" });

    const isRight = choice === q.answer;
    const next = [...answers, choice];
    const correct = Number(row.correct) + (isRight ? 1 : 0);
    if (next.length < DAILY_QUIZ_PER_DAY) {
      await client.query("UPDATE daily_quiz_attempts SET answers = $3::smallint[], correct = $4 WHERE user_id = $1 AND day = $2", [userId, day, next, correct]);
      return { row: { ...row, answers: next, correct }, locked: false, chosen: choice, monthlyCap: null as number | null };
    }
    const reward: Reward & { monthlyCap: number | null } =
      correct === DAILY_QUIZ_PER_DAY ? await applyReward(client, userId, day) : { outcome: "lost", rewarded: 0, monthlyCap: null };
    await client.query(
      `UPDATE daily_quiz_attempts
          SET answers = $3::smallint[], correct = $4, finished_at = now(), rewarded_points = $5, outcome = $6
        WHERE user_id = $1 AND day = $2`,
      [userId, day, next, correct, reward.rewarded, reward.outcome],
    );
    return {
      row: { ...row, answers: next, correct, finished_at: new Date(), rewarded_points: reward.rewarded, outcome: reward.outcome },
      locked: false,
      chosen: choice,
      monthlyCap: reward.monthlyCap,
    };
  });

  if (!done.locked && done.row.finished_at) {
    log("info", "[daily-quiz] yakunlandi", { userId, day, correct: done.row.correct, outcome: done.row.outcome, points: done.row.rewarded_points });
  }
  const cap = done.row.outcome === "cap" ? (done.monthlyCap ?? (await getSetting(DQ_CAP_KEY))) : null;
  return {
    qIndex,
    choice: done.chosen,
    correct: done.chosen === q.answer,
    right: q.answer,
    explanation: q.explain,
    locked: done.locked,
    question: publicOf(q, qIndex),
    state: stateOf(day, done.row, cap),
  };
}

/* ───────────────────────── Opt-out ───────────────────────── */

/** Turns the morning message off / on for a user. Returns the stored flag. */
export async function setQuizOptOut(userId: string, off: boolean): Promise<boolean> {
  const row = await queryOne<{ off: boolean }>("UPDATE users SET daily_quiz_off = $2 WHERE id = $1 RETURNING daily_quiz_off AS off", [userId, off]);
  if (!row) throw new ApiError("Foydalanuvchi topilmadi.", 404, { code: "no_user" });
  return row.off;
}

export async function isQuizOptedOut(userId: string): Promise<boolean> {
  const rows = await query<{ off: boolean }>("SELECT daily_quiz_off AS off FROM users WHERE id = $1", [userId]);
  return rows[0]?.off === true;
}
