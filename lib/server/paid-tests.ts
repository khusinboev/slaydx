import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { chargeInTx } from "./credits";
import { query, queryOne, transaction } from "./db";
import { getSetting } from "./settings";
import {
  LETTERS,
  TESTS_ENABLED_KEY,
  TESTS_FIRST_FREE_KEY,
  TESTS_MINUTES_ALL_KEY,
  TESTS_MINUTES_SUBJECT_KEY,
  TESTS_PER_SUBJECT_KEY,
  TESTS_POINTS_KEY,
  TESTS_PRICE_KEY,
  isPastDeadline,
  letterOf,
  minutesFor,
  pickSubjectQuestions,
  scoreOf,
  type Rng,
  type TestMode,
} from "../tests/rules";

/**
 * «Test ishlash» -- paid tests (owner request 7, migration 060). The ONE service of the web page and the bot
 * (CLAUDE.md «Bot va web -- bitta servis qatlami»).
 *
 *  - An attempt = a frozen list of questions (BMB mechanics: one random variant per subject, N random questions,
 *    random order; «hammasi» = every subject), a SERVER deadline and a price charged at start in the SAME
 *    transaction (`chargeInTx`, reference `test:<attemptId>`).
 *  - THE ANSWER KEY NEVER LEAVES THE SERVER BEFORE THE ATTEMPT IS FINISHED. The active view is built by a query
 *    that does not select `answer` / `explanation`; the review (with the correct letter and the explanation) is
 *    built only for a finished attempt. Scoring happens here, from the stored choices.
 *  - The deadline is enforced here: an answer after it is refused (not stored, not counted), reading an attempt
 *    past its deadline finishes it ('timeout'), and the worker sweeps abandoned ones.
 *  - Ownership is checked in SQL (`user_id = $n`) on every call; a foreign attempt looks like a missing one.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const LEDGER_NOTE = "Test ishlash";

/** Ledger reference of an attempt's charge. */
export const testChargeRef = (attemptId: string): string => `test:${attemptId}`;

/* ───────────────────────── settings ───────────────────────── */

export const testsEnabled = (): Promise<boolean> => getSetting(TESTS_ENABLED_KEY);
/** The only place the price is read (the client sends none). */
export const testsPrice = (): Promise<number> => getSetting(TESTS_PRICE_KEY);

export type TestsConfig = {
  enabled: boolean;
  price: number;
  firstFree: boolean;
  perSubject: number;
  minutesSubject: number;
  minutesAll: number;
  pointsPerCorrect: number;
};

export async function testsConfig(): Promise<TestsConfig> {
  const [enabled, price, firstFree, perSubject, minutesSubject, minutesAll, pointsPerCorrect] = await Promise.all([
    getSetting(TESTS_ENABLED_KEY),
    getSetting(TESTS_PRICE_KEY),
    getSetting(TESTS_FIRST_FREE_KEY),
    getSetting(TESTS_PER_SUBJECT_KEY),
    getSetting(TESTS_MINUTES_SUBJECT_KEY),
    getSetting(TESTS_MINUTES_ALL_KEY),
    getSetting(TESTS_POINTS_KEY),
  ]);
  return { enabled, price, firstFree, perSubject, minutesSubject, minutesAll, pointsPerCorrect };
}

/* ───────────────────────── rows and views ───────────────────────── */

type AttemptRow = {
  id: string;
  user_id: string;
  bank_id: string;
  subject_id: string | null;
  mode: TestMode;
  question_ids: number[];
  total: number;
  status: "active" | "finished";
  finish_reason: "manual" | "timeout" | null;
  started_at: Date;
  deadline_at: Date;
  finished_at: Date | null;
  points_per_correct: string;
  correct: number | null;
  score: string | null;
  charged_points: string;
  subject_name: string | null;
};

const ATTEMPT_COLS = `a.id, a.user_id::text AS user_id, a.bank_id::text AS bank_id, a.subject_id::text AS subject_id, a.mode, a.question_ids, a.total,
  a.status, a.finish_reason, a.started_at, a.deadline_at, a.finished_at, a.points_per_correct::text AS points_per_correct, a.correct,
  a.score::text AS score, a.charged_points::text AS charged_points, s.name AS subject_name`;
const ATTEMPT_FROM = "test_attempts a LEFT JOIN test_subjects s ON s.id = a.subject_id";

const iso = (d: Date): string => new Date(d).toISOString();
const imageUrl = (attemptId: string, questionId: number): string => `/api/tests/attempts/${attemptId}/image/${questionId}`;

/** A question as the client sees it DURING an attempt: no answer, no explanation. */
export type ActiveQuestion = {
  id: number;
  position: number;
  subject: string;
  text: string | null;
  /** `null` for an image-only question: the A-D letters are the buttons. */
  options: string[] | null;
  imageUrl: string | null;
};

export type ActiveView = {
  state: "active";
  id: string;
  mode: TestMode;
  subject: string | null;
  total: number;
  startedAt: string;
  deadlineAt: string;
  serverNow: string;
  questions: ActiveQuestion[];
  /** questionId -> chosen index 0..3 (the user's own choices). */
  answers: Record<string, number>;
};

export type ReviewItem = {
  position: number;
  id: number;
  subject: string;
  text: string | null;
  options: string[] | null;
  imageUrl: string | null;
  /** The user's choice, `null` = not answered. */
  chosen: number | null;
  chosenLetter: string | null;
  correct: number;
  correctLetter: string;
  isCorrect: boolean;
  explanation: string | null;
};

export type FinishedView = {
  state: "finished";
  id: string;
  mode: TestMode;
  subject: string | null;
  total: number;
  correct: number;
  score: number;
  pointsPerCorrect: number;
  reason: "manual" | "timeout";
  startedAt: string;
  finishedAt: string;
  bySubject: { subject: string; correct: number; total: number }[];
  review: ReviewItem[];
};

export type AttemptView = ActiveView | FinishedView;

export type HistoryItem = {
  id: string;
  mode: TestMode;
  subject: string | null;
  status: "active" | "finished";
  total: number;
  /** Present only once the attempt is finished (a running attempt exposes no result). */
  correct?: number;
  score?: number;
  startedAt: string;
  finishedAt: string | null;
};

const num = (s: string | null): number | null => (s === null ? null : Number(s));

/* ───────────────────────── finishing ───────────────────────── */

/**
 * Scores and closes a locked, still-active attempt. Only answers stored AT OR BEFORE the deadline count (the
 * service never writes later ones; the filter is the second line of defence). A timeout is dated at the
 * deadline, a manual finish at `now`.
 */
async function finalizeInTx(client: PoolClient, a: AttemptRow, reason: "manual" | "timeout", now: Date): Promise<void> {
  const r = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM test_attempt_answers x JOIN test_questions q ON q.id = x.question_id
      WHERE x.attempt_id = $1 AND x.chosen = q.answer AND x.answered_at <= $2`,
    [a.id, a.deadline_at],
  );
  const correct = r.rows[0]?.n ?? 0;
  const score = scoreOf(correct, Number(a.points_per_correct));
  const finishedAt = reason === "timeout" ? a.deadline_at : now;
  await client.query(
    `UPDATE test_attempts SET status = 'finished', finish_reason = $2, finished_at = $3, correct = $4, score = $5
      WHERE id = $1 AND status = 'active'`,
    [a.id, reason, finishedAt, correct, score],
  );
}

async function lockAttempt(client: PoolClient, userId: string, attemptId: string): Promise<AttemptRow | null> {
  if (!UUID_RE.test(attemptId)) return null;
  const r = await client.query<AttemptRow>(
    `SELECT ${ATTEMPT_COLS} FROM test_attempts a LEFT JOIN test_subjects s ON s.id = a.subject_id
      WHERE a.id = $1 AND a.user_id = $2 FOR UPDATE OF a`,
    [attemptId, userId],
  );
  return r.rows[0] ?? null;
}

/** Finishes one attempt because its time is up (idempotent; a finished one is left alone). */
export async function finishByTimeout(attemptId: string, now: Date = new Date()): Promise<boolean> {
  return transaction(async (client) => {
    const r = await client.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLS} FROM test_attempts a LEFT JOIN test_subjects s ON s.id = a.subject_id WHERE a.id = $1 FOR UPDATE OF a`,
      [attemptId],
    );
    const a = r.rows[0];
    if (!a || a.status !== "active" || !isPastDeadline(a.deadline_at, now)) return false;
    await finalizeInTx(client, a, "timeout", now);
    return true;
  });
}

/** Worker housekeeping: finishes abandoned attempts whose deadline passed. Returns how many. */
export async function sweepExpiredAttempts(now: Date = new Date(), batch = 200): Promise<number> {
  const rows = await query<{ id: string }>(
    "SELECT id FROM test_attempts WHERE status = 'active' AND deadline_at < $1 ORDER BY deadline_at LIMIT $2",
    [now, batch],
  );
  let n = 0;
  for (const { id } of rows) if (await finishByTimeout(id, now)) n++;
  return n;
}

/* ───────────────────────── overview ───────────────────────── */

type BankRow = { id: string; slug: string; title: string };

async function activeBank(): Promise<BankRow | null> {
  return queryOne<BankRow>("SELECT id::text AS id, slug, title FROM test_banks WHERE active ORDER BY id LIMIT 1");
}

export type SubjectInfo = { code: string; name: string; questions: number; minutes: number; available: boolean };

export type Overview = {
  enabled: boolean;
  price: number;
  /** True when THIS user's next attempt is free (`tests.first_attempt_free` and no attempt yet). */
  firstFree: boolean;
  pointsPerCorrect: number;
  subjects: SubjectInfo[];
  all: { questions: number; minutes: number; available: boolean };
  open: { id: string; mode: TestMode; subject: string | null; deadlineAt: string } | null;
  history: HistoryItem[];
};

async function subjectCounts(bankId: string): Promise<{ id: string; code: string; name: string; sort: number; n: number }[]> {
  const rows = await query<{ id: string; code: string; name: string; sort: number; n: number }>(
    `SELECT s.id::text AS id, s.code, s.name, s.sort,
            (SELECT count(*)::int FROM test_questions q WHERE q.subject_id = s.id AND q.active) AS n
       FROM test_subjects s WHERE s.bank_id = $1 ORDER BY s.sort, s.id`,
    [bankId],
  );
  return rows;
}

export async function listHistory(userId: string, limit = 20): Promise<HistoryItem[]> {
  const rows = await query<AttemptRow>(
    `SELECT ${ATTEMPT_COLS} FROM ${ATTEMPT_FROM} WHERE a.user_id = $1 ORDER BY a.started_at DESC, a.id DESC LIMIT $2`,
    [userId, Math.max(1, Math.min(50, limit))],
  );
  return rows.map((a) => ({
    id: a.id,
    mode: a.mode,
    subject: a.subject_name,
    status: a.status,
    total: a.total,
    ...(a.status === "finished" ? { correct: a.correct ?? 0, score: num(a.score) ?? 0 } : {}),
    startedAt: iso(a.started_at),
    finishedAt: a.finished_at ? iso(a.finished_at) : null,
  }));
}

/** Everything the page shows before an attempt: switch, price, subjects, the open attempt and the history. Charges nothing. */
export async function overview(userId: string, now: Date = new Date()): Promise<Overview> {
  const cfg = await testsConfig();
  // An attempt past its deadline is closed first, so it neither blocks a new start nor shows as «open».
  const stale = await queryOne<{ id: string }>("SELECT id FROM test_attempts WHERE user_id = $1 AND status = 'active' AND deadline_at < $2", [userId, now]);
  if (stale) await finishByTimeout(stale.id, now);

  const bank = await activeBank();
  const counts = bank ? await subjectCounts(bank.id) : [];
  const subjects: SubjectInfo[] = counts.map((s) => ({
    code: s.code,
    name: s.name,
    questions: Math.min(cfg.perSubject, s.n),
    minutes: cfg.minutesSubject,
    available: s.n > 0,
  }));
  const ready = subjects.length > 0 && subjects.every((s) => s.available);
  const openRow = await queryOne<AttemptRow>(
    `SELECT ${ATTEMPT_COLS} FROM ${ATTEMPT_FROM} WHERE a.user_id = $1 AND a.status = 'active'`,
    [userId],
  );
  const prior = await queryOne<{ one: number }>("SELECT 1 AS one FROM test_attempts WHERE user_id = $1 LIMIT 1", [userId]);
  return {
    enabled: cfg.enabled,
    price: cfg.price,
    firstFree: cfg.firstFree && !prior,
    pointsPerCorrect: cfg.pointsPerCorrect,
    subjects,
    all: { questions: subjects.reduce((sum, s) => sum + s.questions, 0), minutes: cfg.minutesAll, available: ready },
    open: openRow ? { id: openRow.id, mode: openRow.mode, subject: openRow.subject_name, deadlineAt: iso(openRow.deadline_at) } : null,
    history: await listHistory(userId, 20),
  };
}

/* ───────────────────────── start ───────────────────────── */

export type StartInput = { mode: TestMode; subjectCode?: string | null; key?: string | null };
export type StartResult = { attemptId: string; alreadyOpen: boolean; price: number; deadlineAt: string };
export type StartOptions = { rng?: Rng; now?: Date };

const cryptoRng: Rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

/**
 * Starts an attempt: picks the questions, writes the attempt and CHARGES in ONE transaction (a refused charge
 * leaves nothing behind). The user row is locked first, so two taps / two tabs are serialised and the second
 * one gets the first attempt back (`alreadyOpen`) without a second charge. A retried start with the same `key`
 * does the same even after the first attempt ended. A different open attempt is a 409 `open_attempt`.
 */
export async function startAttempt(userId: string, input: StartInput, opts: StartOptions = {}): Promise<StartResult> {
  if (input.mode !== "subject" && input.mode !== "all") throw new ApiError("Noto‘g‘ri rejim", 400, { code: "bad_request" });
  const key = input.key ?? null;
  if (key !== null && !KEY_RE.test(key)) throw new ApiError("Noto‘g‘ri kalit", 400, { code: "bad_request" });
  const cfg = await testsConfig();
  if (!cfg.enabled) throw new ApiError("Test ishlash hozircha o‘chiq", 503, { code: "disabled" });
  const rng = opts.rng ?? cryptoRng;
  const now = opts.now ?? new Date();

  return transaction(async (client): Promise<StartResult> => {
    await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);

    if (key) {
      const again = await client.query<AttemptRow>(
        `SELECT ${ATTEMPT_COLS} FROM ${ATTEMPT_FROM} WHERE a.user_id = $1 AND a.client_key = $2`,
        [userId, key],
      );
      const a = again.rows[0];
      if (a) return { attemptId: a.id, alreadyOpen: true, price: Number(a.charged_points), deadlineAt: iso(a.deadline_at) };
    }

    const bankRes = await client.query<BankRow>("SELECT id::text AS id, slug, title FROM test_banks WHERE active ORDER BY id LIMIT 1");
    const bank = bankRes.rows[0];
    if (!bank) throw new ApiError("Savollar hali tayyor emas", 409, { code: "not_ready" });
    const subjRes = await client.query<{ id: string; code: string; name: string }>(
      "SELECT id::text AS id, code, name FROM test_subjects WHERE bank_id = $1 ORDER BY sort, id",
      [bank.id],
    );
    let chosenSubjects = subjRes.rows;
    if (input.mode === "subject") {
      chosenSubjects = chosenSubjects.filter((s) => s.code === input.subjectCode);
      if (!chosenSubjects.length) throw new ApiError("Fan topilmadi", 404, { code: "not_found" });
    }
    const subjectId = input.mode === "subject" ? chosenSubjects[0]!.id : null;

    const open = await client.query<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM ${ATTEMPT_FROM} WHERE a.user_id = $1 AND a.status = 'active' FOR UPDATE OF a`, [userId]);
    const cur = open.rows[0];
    if (cur) {
      if (isPastDeadline(cur.deadline_at, now)) await finalizeInTx(client, cur, "timeout", now);
      else if (cur.mode === input.mode && (cur.subject_id ?? null) === subjectId) {
        return { attemptId: cur.id, alreadyOpen: true, price: Number(cur.charged_points), deadlineAt: iso(cur.deadline_at) };
      } else throw new ApiError("Avval boshlangan testni tugating", 409, { code: "open_attempt", attemptId: cur.id });
    }

    const ids: number[] = [];
    for (const s of chosenSubjects) {
      const pool = await client.query<{ id: string; variant: number }>(
        "SELECT id::text AS id, variant FROM test_questions WHERE subject_id = $1 AND active ORDER BY id",
        [s.id],
      );
      const picked = pickSubjectQuestions(
        pool.rows.map((r) => ({ id: Number(r.id), variant: r.variant })),
        cfg.perSubject,
        rng,
      );
      if (!picked.length) throw new ApiError("Savollar hali tayyor emas", 409, { code: "not_ready" });
      ids.push(...picked);
    }

    const prior = await client.query("SELECT 1 FROM test_attempts WHERE user_id = $1 LIMIT 1", [userId]);
    const price = cfg.firstFree && !prior.rows[0] ? 0 : cfg.price;
    const minutes = minutesFor(input.mode, cfg.minutesSubject, cfg.minutesAll);
    const deadline = new Date(now.getTime() + minutes * 60_000);
    const id = randomUUID();
    await client.query(
      `INSERT INTO test_attempts (id, user_id, bank_id, subject_id, mode, question_ids, total, started_at, deadline_at, points_per_correct, charged_points, client_key)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
      [id, userId, bank.id, subjectId, input.mode, JSON.stringify(ids), ids.length, now, deadline, cfg.pointsPerCorrect, price, key],
    );
    const charged = await chargeInTx(client, userId, price, testChargeRef(id), LEDGER_NOTE);
    if (!charged.ok) {
      throw new ApiError("Hisobda mablag‘ yetarli emas", 402, { code: "insufficient", required: charged.required, available: charged.available });
    }
    return { attemptId: id, alreadyOpen: false, price, deadlineAt: iso(deadline) };
  });
}

/* ───────────────────────── answering and finishing ───────────────────────── */

export type AnswerResult =
  | { ok: true; answered: number }
  | { ok: false; reason: "not_found" | "finished" | "expired" | "not_in_attempt" | "bad_choice" };

/**
 * Stores the user's choice for a question (the last choice before the deadline wins). Past the deadline the
 * answer is NOT stored or counted and the attempt is finished on the spot. Nothing about correctness is returned.
 */
export async function answerQuestion(userId: string, attemptId: string, questionId: number, choice: number, now: Date = new Date()): Promise<AnswerResult> {
  if (!Number.isInteger(choice) || choice < 0 || choice >= LETTERS.length) return { ok: false, reason: "bad_choice" };
  return transaction(async (client): Promise<AnswerResult> => {
    const a = await lockAttempt(client, userId, attemptId);
    if (!a) return { ok: false, reason: "not_found" };
    if (a.status === "finished") return { ok: false, reason: "finished" };
    if (isPastDeadline(a.deadline_at, now)) {
      await finalizeInTx(client, a, "timeout", now);
      return { ok: false, reason: "expired" };
    }
    if (!a.question_ids.includes(questionId)) return { ok: false, reason: "not_in_attempt" };
    await client.query(
      `INSERT INTO test_attempt_answers (attempt_id, question_id, chosen, answered_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET chosen = EXCLUDED.chosen, answered_at = EXCLUDED.answered_at`,
      [a.id, questionId, choice, now],
    );
    const n = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM test_attempt_answers WHERE attempt_id = $1", [a.id]);
    return { ok: true, answered: n.rows[0]?.n ?? 0 };
  });
}

/**
 * «Tugatish». Idempotent: a finished attempt stays as it is. Called after the deadline it finishes as 'timeout'.
 * Returns whether the attempt exists for this user.
 */
export async function finishAttempt(userId: string, attemptId: string, now: Date = new Date()): Promise<boolean> {
  return transaction(async (client) => {
    const a = await lockAttempt(client, userId, attemptId);
    if (!a) return false;
    if (a.status === "active") await finalizeInTx(client, a, isPastDeadline(a.deadline_at, now) ? "timeout" : "manual", now);
    return true;
  });
}

/* ───────────────────────── views ───────────────────────── */

async function attemptRow(userId: string, attemptId: string): Promise<AttemptRow | null> {
  if (!UUID_RE.test(attemptId)) return null;
  return queryOne<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM ${ATTEMPT_FROM} WHERE a.id = $1 AND a.user_id = $2`, [attemptId, userId]);
}

/** The questions of an attempt in the frozen order. `withKey` selects the answer + explanation: ONLY for a finished attempt. */
async function loadQuestions(ids: number[], withKey: false): Promise<Map<number, { text: string | null; options: string[] | null; hasImage: boolean; subject: string }>>;
async function loadQuestions(
  ids: number[],
  withKey: true,
): Promise<Map<number, { text: string | null; options: string[] | null; hasImage: boolean; subject: string; answer: number; explanation: string | null }>>;
async function loadQuestions(ids: number[], withKey: boolean) {
  const sql = withKey
    ? `SELECT q.id::int AS id, q.question_text, q.options, q.image_asset_id IS NOT NULL AS has_image, s.name AS subject, q.answer, q.explanation
         FROM test_questions q JOIN test_subjects s ON s.id = q.subject_id WHERE q.id = ANY($1::bigint[])`
    : `SELECT q.id::int AS id, q.question_text, q.options, q.image_asset_id IS NOT NULL AS has_image, s.name AS subject
         FROM test_questions q JOIN test_subjects s ON s.id = q.subject_id WHERE q.id = ANY($1::bigint[])`;
  const rows = await query<{
    id: number;
    question_text: string | null;
    options: string[] | null;
    has_image: boolean;
    subject: string;
    answer?: number;
    explanation?: string | null;
  }>(sql, [ids]);
  return new Map(
    rows.map((r) => [
      r.id,
      { text: r.question_text, options: r.options, hasImage: r.has_image, subject: r.subject, ...(withKey ? { answer: r.answer!, explanation: r.explanation ?? null } : {}) },
    ]),
  );
}

/**
 * The attempt as the owner may see it NOW: an active one without any key, or a finished one with the full
 * review. An attempt past its deadline is finished first. `null` = not found (or not the caller's).
 */
export async function getAttemptView(userId: string, attemptId: string, now: Date = new Date()): Promise<AttemptView | null> {
  let a = await attemptRow(userId, attemptId);
  if (!a) return null;
  if (a.status === "active" && isPastDeadline(a.deadline_at, now)) {
    await finishByTimeout(a.id, now);
    a = await attemptRow(userId, attemptId);
    if (!a) return null;
  }

  const ids = a.question_ids.map(Number);
  if (a.status === "active") {
    const qs = await loadQuestions(ids, false);
    const ans = await query<{ question_id: string; chosen: number }>("SELECT question_id::text AS question_id, chosen FROM test_attempt_answers WHERE attempt_id = $1", [a.id]);
    return {
      state: "active",
      id: a.id,
      mode: a.mode,
      subject: a.subject_name,
      total: a.total,
      startedAt: iso(a.started_at),
      deadlineAt: iso(a.deadline_at),
      serverNow: now.toISOString(),
      questions: ids.map((id, i): ActiveQuestion => {
        const q = qs.get(id);
        return {
          id,
          position: i + 1,
          subject: q?.subject ?? "",
          text: q?.text ?? null,
          options: q?.options ?? null,
          imageUrl: q?.hasImage ? imageUrl(a!.id, id) : null,
        };
      }),
      answers: Object.fromEntries(ans.map((r) => [r.question_id, r.chosen])),
    };
  }

  const qs = await loadQuestions(ids, true);
  const ans = await query<{ question_id: string; chosen: number; answered_at: Date }>(
    "SELECT question_id::text AS question_id, chosen, answered_at FROM test_attempt_answers WHERE attempt_id = $1",
    [a.id],
  );
  // Same rule as the scoring: only answers given up to the deadline count.
  const chosenOf = new Map(ans.filter((r) => new Date(r.answered_at).getTime() <= new Date(a!.deadline_at).getTime()).map((r) => [Number(r.question_id), r.chosen]));
  const review = ids.map((id, i): ReviewItem => {
    const q = qs.get(id);
    const chosen = chosenOf.get(id) ?? null;
    const correct = q?.answer ?? 0;
    return {
      position: i + 1,
      id,
      subject: q?.subject ?? "",
      text: q?.text ?? null,
      options: q?.options ?? null,
      imageUrl: q?.hasImage ? imageUrl(a!.id, id) : null,
      chosen,
      chosenLetter: chosen === null ? null : letterOf(chosen),
      correct,
      correctLetter: letterOf(correct),
      isCorrect: chosen !== null && chosen === correct,
      explanation: q?.explanation ?? null,
    };
  });
  const by = new Map<string, { subject: string; correct: number; total: number }>();
  for (const item of review) {
    const e = by.get(item.subject) ?? { subject: item.subject, correct: 0, total: 0 };
    e.total++;
    if (item.isCorrect) e.correct++;
    by.set(item.subject, e);
  }
  return {
    state: "finished",
    id: a.id,
    mode: a.mode,
    subject: a.subject_name,
    total: a.total,
    correct: a.correct ?? 0,
    score: num(a.score) ?? 0,
    pointsPerCorrect: Number(a.points_per_correct),
    reason: a.finish_reason ?? "manual",
    startedAt: iso(a.started_at),
    finishedAt: iso(a.finished_at ?? a.deadline_at),
    bySubject: [...by.values()],
    review,
  };
}

/** The image of one question of the caller's own attempt (active or finished), or `null`. */
export async function attemptImage(userId: string, attemptId: string, questionId: number): Promise<{ bytes: Buffer; mime: string; sha256: string } | null> {
  if (!UUID_RE.test(attemptId) || !Number.isSafeInteger(questionId) || questionId < 1) return null;
  const r = await queryOne<{ bytes: Buffer; mime: string; sha256: string }>(
    `SELECT s.bytes, s.mime, s.sha256
       FROM test_attempts t
       JOIN test_questions q ON q.id = $3
       JOIN test_assets s ON s.id = q.image_asset_id
      WHERE t.id = $1 AND t.user_id = $2 AND t.question_ids @> jsonb_build_array($3::bigint)`,
    [attemptId, userId, questionId],
  );
  return r ?? null;
}
