import "server-only";
import { randomUUID } from "node:crypto";
import { ApiError } from "./api";
import { chargeInTx } from "./credits";
import { query, queryOne, transaction } from "./db";
import { toJsonb } from "./jsonb";
import { refundInTx } from "./refund-tx";
import { getSetting } from "./settings";
import {
  DOMLA_ENABLED_KEY,
  DOMLA_IDLE_MINUTES,
  DOMLA_PRICE_KEY,
  DOMLA_QUESTIONS,
  DOMLA_SOURCE_TOOLS,
  DOMLA_TEXT_MAX_CHARS,
  DOMLA_VOICE_MAX_BYTES,
  DOMLA_VOICE_MAX_SECONDS,
  gradeOf,
  type DomlaAnswer,
  type DomlaQuestion,
  type DomlaStatus,
  type Grade,
} from "../domla/rules";

/**
 * «Qattiqqo'l domla» service (owner request 15, migration 057). Everything the web page AND the bot need, with
 * ownership in SQL (`user_id = $n`), money in one transaction with the state change, and NO heavy work: starting a
 * defence and receiving an answer only write rows (`domla_sessions`, `domla_jobs`); the worker
 * (`domla-engine.ts`) does the LLM / TTS / audio-scoring and sends the Telegram messages.
 *
 * States: `preparing` (questions being written) -> `active` (questions asked one by one; `asked` counts the
 * questions already sent, the one waiting for an answer is `answers.length`) -> `finished` (graded)
 * | `expired` (30 minutes idle) | `failed` (no questions could be written: full refund).
 * A user has at most one open session (partial unique index).
 */

export type DomlaSession = {
  id: string;
  userId: string;
  status: DomlaStatus;
  topic: string;
  sourceGenerationId: string | null;
  questions: DomlaQuestion[];
  answers: DomlaAnswer[];
  asked: number;
  grade: Grade | null;
  chargedPoints: number;
  lastActivityAt: string;
  createdAt: string;
  finishedAt: string | null;
};

type Row = {
  id: string;
  user_id: string;
  status: DomlaStatus;
  topic: string;
  source_generation_id: string | null;
  questions: DomlaQuestion[];
  answers: DomlaAnswer[];
  asked: number;
  grade: number | null;
  charged_points: string;
  last_activity_at: Date | string;
  created_at: Date | string;
  finished_at: Date | string | null;
};

const COLS = `id, user_id::text AS user_id, status, topic, source_generation_id, questions, answers, asked, grade,
  charged_points::text AS charged_points, last_activity_at, created_at, finished_at`;

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

export function rowToSession(r: Row): DomlaSession {
  return {
    id: r.id,
    userId: r.user_id,
    status: r.status,
    topic: r.topic,
    sourceGenerationId: r.source_generation_id,
    questions: Array.isArray(r.questions) ? r.questions : [],
    answers: Array.isArray(r.answers) ? r.answers : [],
    asked: r.asked,
    grade: r.grade === null ? null : (r.grade as Grade),
    chargedPoints: Number(r.charged_points),
    lastActivityAt: iso(r.last_activity_at)!,
    createdAt: iso(r.created_at)!,
    finishedAt: iso(r.finished_at),
  };
}

/** The ledger reference of a session's charge (and of its refund). */
export const chargeRef = (sessionId: string): string => `domla:${sessionId}`;

/**
 * What the page may see of a session. The ideal answers of questions the student has not answered yet NEVER
 * leave the server (they would give the defence away); a finished defence shows the weakest question's ideal.
 */
export type PublicSession = {
  id: string;
  status: DomlaStatus;
  topic: string;
  grade: Grade | null;
  chargedPoints: number;
  createdAt: string;
  finishedAt: string | null;
  progress: { answered: number; total: number };
  results: { question: string; score: number; verdict: string }[];
  weakest: { question: string; mistake: string; ideal: string } | null;
};

export function publicSession(s: DomlaSession): PublicSession {
  const done = s.status === "finished";
  const results = done ? s.questions.map((q, i) => ({ question: q.text, score: s.answers.find((a) => a.idx === i)?.score ?? 0, verdict: s.answers.find((a) => a.idx === i)?.verdict ?? "" })) : [];
  let weakest: PublicSession["weakest"] = null;
  if (done && results.length) {
    let w = 0;
    results.forEach((r, i) => {
      if (r.score < results[w]!.score) w = i;
    });
    weakest = { question: s.questions[w]!.text, mistake: s.answers.find((a) => a.idx === w)?.mistake ?? "", ideal: s.questions[w]!.ideal };
  }
  return {
    id: s.id,
    status: s.status,
    topic: s.topic,
    grade: s.grade,
    chargedPoints: s.chargedPoints,
    createdAt: s.createdAt,
    finishedAt: s.finishedAt,
    progress: { answered: s.answers.length, total: s.questions.length || DOMLA_QUESTIONS },
    results,
    weakest,
  };
}

/* ───────────────────────── settings ───────────────────────── */

export const domlaEnabled = (): Promise<boolean> => getSetting(DOMLA_ENABLED_KEY);
/** The only place the price is read (the client sends none). */
export const domlaPrice = (): Promise<number> => getSetting(DOMLA_PRICE_KEY);

/* ───────────────────────── the user's works ───────────────────────── */

export type Defendable = { id: string; toolId: string; topic: string; slides: number; createdAt: string };

/** The user's finished slide / pro-slide works, newest first (the list of «what to defend»). */
export async function listDefendable(userId: string, limit = 20): Promise<Defendable[]> {
  const rows = await query<{ id: string; tool_id: string; topic: string; slides: number; created_at: Date }>(
    `SELECT id, tool_id, topic, jsonb_array_length(doc_json->'slides') AS slides, created_at
       FROM generations
      WHERE user_id = $1 AND status = 'COMPLETED' AND tool_id = ANY($2::text[])
        AND jsonb_typeof(doc_json->'slides') = 'array' AND jsonb_array_length(doc_json->'slides') >= 3
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [userId, [...DOMLA_SOURCE_TOOLS], Math.max(1, Math.min(50, limit))],
  );
  return rows.map((r) => ({ id: r.id, toolId: r.tool_id, topic: r.topic, slides: r.slides, createdAt: new Date(r.created_at).toISOString() }));
}

/* ───────────────────────── sessions ───────────────────────── */

const OPEN = ["preparing", "active"] as const;

/** Expires `active` sessions idle for `DOMLA_IDLE_MINUTES`; returns them (the caller tells the user). */
export async function expireIdle(now: Date = new Date()): Promise<{ id: string; userId: string; telegramId: string | null }[]> {
  const rows = await query<{ id: string; user_id: string; telegram_id: string | null }>(
    `UPDATE domla_sessions s
        SET status = 'expired', finished_at = $1
       FROM users u
      WHERE u.id = s.user_id AND s.status = 'active' AND s.last_activity_at < $1::timestamptz - make_interval(mins => $2)
      RETURNING s.id, s.user_id::text AS user_id, u.telegram_id::text AS telegram_id`,
    [now, DOMLA_IDLE_MINUTES],
  );
  if (rows.length) await query("DELETE FROM domla_jobs WHERE session_id = ANY($1::uuid[])", [rows.map((r) => r.id)]);
  return rows.map((r) => ({ id: r.id, userId: r.user_id, telegramId: r.telegram_id }));
}

/**
 * Fails a session whose questions could not be written (or never arrived: stuck `preparing`) and refunds the
 * charge IN THE SAME TRANSACTION. Returns whether THIS call did it (a second call, a late job: no-op).
 */
export async function failSession(sessionId: string, note = "Domla: savollar tuzilmadi"): Promise<{ failed: boolean; userId: string | null }> {
  return transaction(async (client) => {
    const r = await client.query<{ user_id: string }>(
      `UPDATE domla_sessions SET status = 'failed', finished_at = now()
        WHERE id = $1 AND status = 'preparing' RETURNING user_id::text AS user_id`,
      [sessionId],
    );
    const row = r.rows[0];
    if (!row) return { failed: false, userId: null };
    await client.query("DELETE FROM domla_jobs WHERE session_id = $1", [sessionId]);
    await refundInTx(client, row.user_id, chargeRef(sessionId), note);
    return { failed: true, userId: row.user_id };
  });
}

/** `preparing` for longer than the idle window: the worker lost the job. Refund them. Returns the failed ones. */
export async function failStuckPreparing(now: Date = new Date()): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM domla_sessions WHERE status = 'preparing' AND last_activity_at < $1::timestamptz - make_interval(mins => $2)`,
    [now, DOMLA_IDLE_MINUTES],
  );
  const out: string[] = [];
  for (const { id } of rows) if ((await failSession(id)).failed) out.push(id);
  return out;
}

/** The user's open session (lazily expired when idle), or `null`. */
export async function openSession(userId: string, now: Date = new Date()): Promise<DomlaSession | null> {
  const r = await queryOne<Row>(`SELECT ${COLS} FROM domla_sessions WHERE user_id = $1 AND status = ANY($2::text[])`, [userId, [...OPEN]]);
  if (!r) return null;
  const s = rowToSession(r);
  if (s.status === "active" && now.getTime() - new Date(s.lastActivityAt).getTime() >= DOMLA_IDLE_MINUTES * 60_000) {
    await query("UPDATE domla_sessions SET status = 'expired', finished_at = now() WHERE id = $1 AND status = 'active'", [s.id]);
    await query("DELETE FROM domla_jobs WHERE session_id = $1", [s.id]);
    return null;
  }
  return s;
}

/** One session of this user (ownership in SQL), any status. */
export async function getSession(userId: string, sessionId: string): Promise<DomlaSession | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  const r = await queryOne<Row>(`SELECT ${COLS} FROM domla_sessions WHERE id = $1 AND user_id = $2`, [sessionId, userId]);
  return r ? rowToSession(r) : null;
}

/** The history list of the page / the bot (newest first). */
export async function listHistory(userId: string, limit = 20): Promise<DomlaSession[]> {
  const rows = await query<Row>(`SELECT ${COLS} FROM domla_sessions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [userId, Math.max(1, Math.min(50, limit))]);
  return rows.map(rowToSession);
}

export type StartResult = { session: DomlaSession; alreadyOpen: boolean; price: number };

function isOpenSessionViolation(e: unknown): boolean {
  const err = e as { code?: unknown; constraint?: unknown } | null;
  return err?.code === "23505" && err.constraint === "domla_sessions_one_open_idx";
}

/**
 * Starts a defence of one of the user's slide works: ownership check, session row, CHARGE and the
 * `questions` job in ONE transaction (a rejected charge leaves nothing behind). Idempotent: while a session
 * for the same work is open, the same session comes back and nothing more is charged (a double tap, a second
 * tab, a redelivered update); a session for ANOTHER work is a 409 `open_session`.
 */
export async function startDefence(userId: string, generationId: string): Promise<StartResult> {
  if (!(await domlaEnabled())) throw new ApiError("Qattiqqo‘l domla hozircha o‘chiq", 503, { code: "disabled" });
  const price = await domlaPrice();
  const attempt = () =>
    transaction(async (client): Promise<StartResult> => {
      const gen = await client.query<{ topic: string }>(
        `SELECT topic FROM generations
          WHERE id = $1 AND user_id = $2 AND status = 'COMPLETED' AND tool_id = ANY($3::text[])
            AND jsonb_typeof(doc_json->'slides') = 'array' AND jsonb_array_length(doc_json->'slides') >= 3`,
        [generationId, userId, [...DOMLA_SOURCE_TOOLS]],
      );
      if (!gen.rows[0]) throw new ApiError("Bu ish topilmadi yoki himoya uchun yaroqsiz", 404, { code: "not_found" });
      // The defence is spoken in the user's Telegram chat: a web-only account has nowhere to hear the questions.
      const tg = await client.query<{ telegram_id: string | null }>("SELECT telegram_id::text AS telegram_id FROM users WHERE id = $1", [userId]);
      if (!tg.rows[0]?.telegram_id) throw new ApiError("Himoya Telegram botda o‘tadi — avval Telegram akkauntini bog‘lang", 409, { code: "no_telegram" });

      const open = await client.query<Row>(
        `SELECT ${COLS} FROM domla_sessions WHERE user_id = $1 AND status = ANY($2::text[]) FOR UPDATE`,
        [userId, [...OPEN]],
      );
      const cur = open.rows[0];
      if (cur) {
        const s = rowToSession(cur);
        const idle = s.status === "active" && Date.now() - new Date(s.lastActivityAt).getTime() >= DOMLA_IDLE_MINUTES * 60_000;
        if (!idle) {
          if (s.sourceGenerationId === generationId) return { session: s, alreadyOpen: true, price };
          throw new ApiError("Avval boshlangan himoyani tugating", 409, { code: "open_session", sessionId: s.id });
        }
        await client.query("UPDATE domla_sessions SET status = 'expired', finished_at = now() WHERE id = $1", [s.id]);
        await client.query("DELETE FROM domla_jobs WHERE session_id = $1", [s.id]);
      }

      const id = randomUUID();
      const ins = await client.query<Row>(
        `INSERT INTO domla_sessions (id, user_id, source_generation_id, topic, charged_points)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
        [id, userId, generationId, gen.rows[0].topic.slice(0, 300), price],
      );
      const charged = await chargeInTx(client, userId, price, chargeRef(id), "Qattiqqo‘l domla");
      if (!charged.ok) {
        throw new ApiError("Hisobda mablag‘ yetarli emas", 402, { code: "insufficient", required: charged.required, available: charged.available });
      }
      await client.query("INSERT INTO domla_jobs (session_id, kind, idx) VALUES ($1, 'questions', 0)", [id]);
      return { session: rowToSession(ins.rows[0]!), alreadyOpen: false, price };
    });

  try {
    return await attempt();
  } catch (e) {
    // A parallel start won the race for the one-open-session index: its session is the answer (its charge stands).
    if (isOpenSessionViolation(e)) {
      const s = await openSession(userId);
      if (s && s.sourceGenerationId === generationId) return { session: s, alreadyOpen: true, price };
      throw new ApiError("Avval boshlangan himoyani tugating", 409, { code: "open_session", ...(s ? { sessionId: s.id } : {}) });
    }
    throw e;
  }
}

/* ───────────────────────── answers ───────────────────────── */

export type AnswerInput =
  | { via: "voice"; fileId: string; mime: string; size: number; seconds: number }
  | { via: "text"; text: string };

export type SubmitResult =
  | { ok: true; sessionId: string; idx: number }
  | { ok: false; reason: "no_session" | "preparing" | "expired" | "not_waiting" | "busy" | "too_big" | "too_long" | "empty" };

/**
 * A student's answer to the question that is waiting: validates it and enqueues the `score` job. NOTHING heavy
 * happens here (the Telegram webhook calls this and must answer fast); for a voice answer only the Telegram
 * `file_id` is stored, never audio.
 */
export async function submitAnswer(userId: string, input: AnswerInput, now: Date = new Date()): Promise<SubmitResult> {
  if (input.via === "voice") {
    if (!(input.size > 0) || input.size > DOMLA_VOICE_MAX_BYTES) return { ok: false, reason: "too_big" };
    if (input.seconds > DOMLA_VOICE_MAX_SECONDS) return { ok: false, reason: "too_long" };
    if (!input.fileId || input.fileId.length > 300) return { ok: false, reason: "empty" };
  } else if (!input.text.trim()) return { ok: false, reason: "empty" };

  return transaction(async (client): Promise<SubmitResult> => {
    const r = await client.query<Row>(`SELECT ${COLS} FROM domla_sessions WHERE user_id = $1 AND status = ANY($2::text[]) FOR UPDATE`, [userId, [...OPEN]]);
    const row = r.rows[0];
    if (!row) return { ok: false, reason: "no_session" };
    const s = rowToSession(row);
    if (s.status === "preparing") return { ok: false, reason: "preparing" };
    if (now.getTime() - new Date(s.lastActivityAt).getTime() >= DOMLA_IDLE_MINUTES * 60_000) {
      await client.query("UPDATE domla_sessions SET status = 'expired', finished_at = $2 WHERE id = $1", [s.id, now]);
      await client.query("DELETE FROM domla_jobs WHERE session_id = $1", [s.id]);
      return { ok: false, reason: "expired" };
    }
    const idx = s.answers.length;
    if (idx >= DOMLA_QUESTIONS || idx >= s.questions.length || s.asked <= idx) return { ok: false, reason: "not_waiting" };
    const payload =
      input.via === "voice"
        ? { via: "voice", fileId: input.fileId, mime: input.mime, seconds: Math.round(input.seconds) }
        : { via: "text", text: input.text.trim().slice(0, DOMLA_TEXT_MAX_CHARS) };
    const job = await client.query(
      `INSERT INTO domla_jobs (session_id, kind, idx, payload) VALUES ($1, 'score', $2, $3::jsonb)
       ON CONFLICT (session_id, kind, idx) DO NOTHING RETURNING id`,
      [s.id, idx, toJsonb(payload)],
    );
    if (job.rows.length === 0) return { ok: false, reason: "busy" };
    await client.query("UPDATE domla_sessions SET last_activity_at = $2 WHERE id = $1", [s.id, now]);
    return { ok: true, sessionId: s.id, idx };
  });
}

/** Whether the user has an `active` session with a question waiting for an answer (cheap: the webhook's gate for plain text). */
export async function awaitingAnswer(userId: string, now: Date = new Date()): Promise<boolean> {
  const r = await queryOne<{ ok: boolean }>(
    `SELECT true AS ok FROM domla_sessions
      WHERE user_id = $1 AND status = 'active' AND asked > jsonb_array_length(answers)
        AND jsonb_array_length(answers) < $3 AND last_activity_at >= $2::timestamptz - make_interval(mins => $4)`,
    [userId, now, DOMLA_QUESTIONS, DOMLA_IDLE_MINUTES],
  );
  return Boolean(r);
}

export type ResumeResult = { ok: true; session: DomlaSession } | { ok: false; reason: "not_found" | "expired" | "preparing" | "finished" };

/**
 * «Davom ettirish» inside the 30-minute window: asks the current question again (an `ask` job with `resend`).
 * The session must be the caller's own (a forged id is `not_found`).
 */
export async function resumeSession(userId: string, sessionId: string, now: Date = new Date()): Promise<ResumeResult> {
  if (!(await domlaEnabled())) throw new ApiError("Qattiqqo‘l domla hozircha o‘chiq", 503, { code: "disabled" });
  return transaction(async (client): Promise<ResumeResult> => {
    const r = await client.query<Row>(`SELECT ${COLS} FROM domla_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE`, [sessionId, userId]);
    const row = r.rows[0];
    if (!row) return { ok: false, reason: "not_found" };
    const s = rowToSession(row);
    if (s.status === "finished" || s.status === "failed") return { ok: false, reason: "finished" };
    if (s.status === "expired") return { ok: false, reason: "expired" };
    if (s.status === "preparing") return { ok: false, reason: "preparing" };
    if (now.getTime() - new Date(s.lastActivityAt).getTime() >= DOMLA_IDLE_MINUTES * 60_000) {
      await client.query("UPDATE domla_sessions SET status = 'expired', finished_at = $2 WHERE id = $1", [s.id, now]);
      return { ok: false, reason: "expired" };
    }
    const idx = s.answers.length;
    await client.query(
      `INSERT INTO domla_jobs (session_id, kind, idx, payload) VALUES ($1, 'ask', $2, '{"resend":true}'::jsonb)
       ON CONFLICT (session_id, kind, idx) DO NOTHING`,
      [s.id, idx],
    );
    await client.query("UPDATE domla_sessions SET last_activity_at = $2 WHERE id = $1", [s.id, now]);
    return { ok: true, session: s };
  });
}

/* ───────────────────────── worker side: state changes ───────────────────────── */

/** Stores the questions and opens the defence (`preparing` -> `active`) and queues the first `ask`. */
export async function activate(sessionId: string, questions: DomlaQuestion[]): Promise<boolean> {
  return transaction(async (client) => {
    const r = await client.query(
      `UPDATE domla_sessions SET status = 'active', questions = $2::jsonb, last_activity_at = now()
        WHERE id = $1 AND status = 'preparing' RETURNING id`,
      [sessionId, toJsonb(questions)],
    );
    if (r.rows.length === 0) return false;
    await client.query("INSERT INTO domla_jobs (session_id, kind, idx) VALUES ($1, 'ask', 0) ON CONFLICT (session_id, kind, idx) DO NOTHING", [sessionId]);
    return true;
  });
}

/** Marks question `idx` as spoken (idempotent: `asked` only grows). */
export async function markAsked(sessionId: string, idx: number): Promise<void> {
  await query("UPDATE domla_sessions SET asked = GREATEST(asked, $2), last_activity_at = now() WHERE id = $1 AND status = 'active'", [sessionId, idx + 1]);
}

/** Appends the scored answer `idx` (only if it is the next one: a retried job cannot add it twice). Returns the answers after the call. */
export async function recordAnswer(sessionId: string, answer: DomlaAnswer): Promise<DomlaAnswer[] | null> {
  const r = await queryOne<{ answers: DomlaAnswer[] }>(
    `UPDATE domla_sessions SET answers = answers || $3::jsonb, last_activity_at = now()
      WHERE id = $1 AND status = 'active' AND jsonb_array_length(answers) = $2 RETURNING answers`,
    [sessionId, answer.idx, toJsonb([answer])],
  );
  return r ? r.answers : null;
}

/** After an answer: ask the next question or, when all are answered, finish. */
export async function queueNext(sessionId: string, nextIdx: number): Promise<void> {
  await query("INSERT INTO domla_jobs (session_id, kind, idx) VALUES ($1, 'ask', $2) ON CONFLICT (session_id, kind, idx) DO NOTHING", [sessionId, nextIdx]);
}

/** Grades and closes the session; `false` when it was already closed (a retried job). */
export async function finishSession(sessionId: string): Promise<DomlaSession | null> {
  return transaction(async (client) => {
    const r = await client.query<Row>(`SELECT ${COLS} FROM domla_sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
    const row = r.rows[0];
    if (!row || row.status !== "active") return null;
    const s = rowToSession(row);
    const scores = s.questions.map((_, i) => s.answers.find((a) => a.idx === i)?.score ?? 0);
    const grade = gradeOf(scores, s.questions.length || DOMLA_QUESTIONS);
    const u = await client.query<Row>(
      `UPDATE domla_sessions SET status = 'finished', grade = $2, finished_at = now() WHERE id = $1 RETURNING ${COLS}`,
      [sessionId, grade],
    );
    return rowToSession(u.rows[0]!);
  });
}

/* ───────────────────────── worker side: the job queue ───────────────────────── */

export type DomlaJob = { id: string; sessionId: string; kind: "questions" | "ask" | "score"; idx: number; payload: Record<string, unknown>; attempts: number };

/** Lease: a job claimed by a worker that dies is picked up again after this. */
export const JOB_LEASE_SEC = 180;
export const JOB_MAX_ATTEMPTS = 3;

export async function claimJob(): Promise<DomlaJob | null> {
  const r = await queryOne<{ id: string; session_id: string; kind: DomlaJob["kind"]; idx: number; payload: Record<string, unknown>; attempts: number }>(
    `UPDATE domla_jobs SET attempts = attempts + 1, locked_until = now() + make_interval(secs => $1)
      WHERE id = (SELECT id FROM domla_jobs
                   WHERE run_after <= now() AND (locked_until IS NULL OR locked_until < now())
                   ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id::text AS id, session_id, kind, idx, payload, attempts`,
    [JOB_LEASE_SEC],
  );
  return r ? { id: r.id, sessionId: r.session_id, kind: r.kind, idx: r.idx, payload: r.payload ?? {}, attempts: r.attempts } : null;
}

export async function completeJob(id: string): Promise<void> {
  await query("DELETE FROM domla_jobs WHERE id = $1", [id]);
}

/** Back to the queue after a transient failure (`delaySec` backoff). */
export async function retryJob(id: string, delaySec: number): Promise<void> {
  await query("UPDATE domla_jobs SET locked_until = NULL, run_after = now() + make_interval(secs => $2) WHERE id = $1", [id, delaySec]);
}

/** Pending job count (admin/tests). */
export async function pendingJobs(): Promise<number> {
  return Number((await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM domla_jobs"))!.n);
}
