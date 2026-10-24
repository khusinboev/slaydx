import "server-only";
import { recordAiUsage } from "./ai-usage";
import { trackJobCost } from "../generation/job-cost";
import { deckText } from "../domla/deck-text";
import { cb } from "./bot/codes";
import { esc, inlineButton, rows } from "./bot/ui";
import {
  EXPIRED_TEXT,
  FAILED_TEXT,
  GREETING,
  HEARING_FAILED_TEXT,
  TOO_BIG_TEXT,
  finalMessage,
  questionCaption,
  reactionMessage,
  spokenQuestion,
} from "../domla/persona";
import type { DomlaAnswer } from "../domla/rules";
import type { SlideModel } from "../generation/slide-types";
import {
  JOB_MAX_ATTEMPTS,
  activate,
  claimJob,
  completeJob,
  expireIdle,
  failSession,
  failStuckPreparing,
  finishSession,
  markAsked,
  queueNext,
  recordAnswer,
  retryJob,
  type DomlaJob,
  type DomlaSession,
} from "./domla";
import { rowToSession } from "./domla";
import { DomlaFileError, defaultDeps, geminiAudioMime, type DomlaDeps } from "./domla-deps";
import { queryOne } from "./db";
import { log } from "./log";
import { TelegramTransientError } from "./telegram";

/**
 * The worker side of «Qattiqqo'l domla» (owner request 15). One job = one slow step, claimed with
 * `FOR UPDATE SKIP LOCKED` (`domla.ts claimJob`):
 *
 *   questions  read the deck, ask the LLM for 5 questions + ideal answers, open the defence, queue `ask 0`.
 *              Out of attempts -> the session FAILS and the whole charge is refunded (same transaction).
 *   ask        say question `idx` out loud (Gemini TTS, Charon, MP3 via sendAudio; the text is the caption and,
 *              when no voice can be made, the whole message).
 *   score      one Gemini call transcribes AND scores the answer (audio downloaded in memory, never stored),
 *              the reaction goes out, then the next `ask` or the final verdict.
 *
 * Every step tolerates a retry (the job may run twice after a crash): state moves forward only, through guarded
 * UPDATEs in `domla.ts`. Spend of each job is written to `ai_usage` as `free:domla`.
 */

const BACKOFF_SEC = [20, 60];

type Ctx = { deps: DomlaDeps; chatId: string | null; userId: string };

async function loadSession(id: string): Promise<(DomlaSession & { chatId: string | null }) | null> {
  const r = await queryOne<Parameters<typeof rowToSession>[0] & { chat_id: string | null }>(
    `SELECT s.id, s.user_id::text AS user_id, s.status, s.topic, s.source_generation_id, s.questions, s.answers, s.asked, s.grade,
            s.charged_points::text AS charged_points, s.last_activity_at, s.created_at, s.finished_at, u.telegram_id::text AS chat_id
       FROM domla_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [id],
  );
  return r ? { ...rowToSession(r), chatId: r.chat_id } : null;
}

const finalButtons = () => rows([inlineButton(null, "Yana himoya qilish", { callback_data: cb.domlaList() }, "primary")]);

async function say(ctx: Ctx, text: string, markup?: unknown): Promise<void> {
  if (ctx.chatId) await ctx.deps.telegram.sendText(ctx.chatId, text, markup);
}

/* ───────────────────────── questions ───────────────────────── */

async function runQuestions(s: DomlaSession & { chatId: string | null }, ctx: Ctx): Promise<void> {
  if (s.status !== "preparing") return;
  const gen = s.sourceGenerationId
    ? await queryOne<{ topic: string; slides: SlideModel[] | null }>(
        "SELECT topic, doc_json->'slides' AS slides FROM generations WHERE id = $1 AND user_id = $2",
        [s.sourceGenerationId, s.userId],
      )
    : null;
  const deck = deckText(gen?.slides ?? null);
  if (!deck) throw new PermanentError("slayd mazmuni topilmadi");
  const questions = await ctx.deps.generateQuestions({ topic: gen?.topic ?? s.topic, deck });
  await activate(s.id, questions);
}

class PermanentError extends Error {}

/* ───────────────────────── ask ───────────────────────── */

async function runAsk(job: DomlaJob, s: DomlaSession & { chatId: string | null }, ctx: Ctx): Promise<void> {
  if (s.status !== "active") return;
  const idx = job.idx;
  const q = s.questions[idx];
  if (!q) return;
  const resend = job.payload.resend === true;
  // Already spoken (a retried job after the send succeeded): nothing to say again.
  if (s.asked > idx && !resend) return;
  const first = idx === 0 && !resend && s.asked === 0;
  const caption = (first ? `${esc(GREETING)}\n\n` : "") + questionCaption(idx, s.questions.length, q);
  if (!ctx.chatId) return;
  await ctx.deps.telegram.sendAction(ctx.chatId, "record_voice");
  let audio = null;
  try {
    audio = await ctx.deps.synthesize(spokenQuestion(idx, q, { greet: first, resume: resend }));
  } catch (e) {
    // The voice is an extra: the question still goes out as text.
    log("warn", "[domla] ovoz yaratilmadi, savol matn bilan yuboriladi", { err: e, sessionId: s.id });
  }
  let sent = false;
  if (audio) sent = await ctx.deps.telegram.sendAudio(ctx.chatId, audio, caption);
  if (!sent) await ctx.deps.telegram.sendText(ctx.chatId, caption);
  await markAsked(s.id, idx);
}

/* ───────────────────────── score ───────────────────────── */

async function runScore(job: DomlaJob, s: DomlaSession & { chatId: string | null }, ctx: Ctx): Promise<void> {
  if (s.status !== "active") return;
  const idx = job.idx;
  const q = s.questions[idx];
  if (!q) return;
  let answers = s.answers;

  if (answers.length <= idx) {
    if (ctx.chatId) await ctx.deps.telegram.sendAction(ctx.chatId, "typing");
    const via = job.payload.via === "voice" ? "voice" : "text";
    const gen = s.sourceGenerationId
      ? await queryOne<{ slides: SlideModel[] | null }>("SELECT doc_json->'slides' AS slides FROM generations WHERE id = $1 AND user_id = $2", [s.sourceGenerationId, s.userId])
      : null;
    const deck = deckText(gen?.slides ?? null);
    let result;
    if (via === "voice") {
      const mime = geminiAudioMime(String(job.payload.mime ?? ""));
      if (!mime) {
        await say(ctx, HEARING_FAILED_TEXT);
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = await ctx.deps.telegram.downloadFile(String(job.payload.fileId ?? ""));
      } catch (e) {
        if (e instanceof DomlaFileError) {
          await say(ctx, e.reason === "too_big" ? TOO_BIG_TEXT : HEARING_FAILED_TEXT);
          return;
        }
        throw e;
      }
      result = await ctx.deps.score({ question: q, topic: s.topic, deck, audio: { bytes, mime } });
      // bytes go out of scope here -- nothing audio is kept.
      if (!result.transcript) {
        await say(ctx, HEARING_FAILED_TEXT);
        return;
      }
    } else {
      const text = String(job.payload.text ?? "");
      result = await ctx.deps.score({ question: q, topic: s.topic, deck, text });
      result = { ...result, transcript: text };
    }
    const answer: DomlaAnswer = { idx, via, transcript: result.transcript, score: result.score, verdict: result.verdict, mistake: result.mistake };
    const stored = await recordAnswer(s.id, answer);
    if (stored) {
      answers = stored;
      await say(ctx, reactionMessage(answer));
    }
  }

  // Advance: the next question, or the verdict.
  if (answers.length >= s.questions.length) {
    const done = await finishSession(s.id);
    if (done) {
      await say(ctx, finalMessage(done.questions, done.answers), finalButtons());
    }
  } else {
    await queueNext(s.id, answers.length);
  }
}

/* ───────────────────────── dispatch ───────────────────────── */

/** Terminal failure of a job (out of attempts / permanent): what the user is told and what is rolled back. */
async function giveUp(job: DomlaJob, ctx: Ctx, err: unknown): Promise<void> {
  log("error", "[domla] job yiqildi", { err, jobId: job.id, kind: job.kind, sessionId: job.sessionId, attempts: job.attempts });
  if (job.kind === "questions") {
    const r = await failSession(job.sessionId);
    if (r.failed && ctx.chatId) await ctx.deps.telegram.sendText(ctx.chatId, FAILED_TEXT).catch(() => undefined);
    return;
  }
  if (job.kind === "score" && ctx.chatId) await ctx.deps.telegram.sendText(ctx.chatId, HEARING_FAILED_TEXT).catch(() => undefined);
  await completeJob(job.id);
}

/** Runs one claimed job. Never throws. */
export async function runJob(job: DomlaJob, deps: DomlaDeps = defaultDeps()): Promise<"done" | "retry" | "gave_up"> {
  const s = await loadSession(job.sessionId);
  if (!s) {
    await completeJob(job.id);
    return "done";
  }
  const ctx: Ctx = { deps, chatId: s.chatId, userId: s.userId };
  const tracked = trackJobCost(async () => {
    if (job.kind === "questions") await runQuestions(s, ctx);
    else if (job.kind === "ask") await runAsk(job, s, ctx);
    else await runScore(job, s, ctx);
  });
  try {
    await tracked.promise;
    await completeJob(job.id);
    return "done";
  } catch (e) {
    const permanent = e instanceof PermanentError;
    const transient = e instanceof TelegramTransientError;
    if (!permanent && job.attempts < JOB_MAX_ATTEMPTS) {
      log("warn", "[domla] job qayta uriladi", { err: e, jobId: job.id, kind: job.kind, attempts: job.attempts, transient });
      await retryJob(job.id, BACKOFF_SEC[Math.min(job.attempts - 1, BACKOFF_SEC.length - 1)] ?? 60);
      return "retry";
    }
    await giveUp(job, ctx, e);
    return "gave_up";
  } finally {
    try {
      void recordAiUsage({ source: "free", outcome: "free", userId: s.userId, toolId: "free:domla", cost: tracked.snapshot().toJson() });
    } catch {
      // Telemetry must never affect the job.
    }
  }
}

/** One worker step: claim and run a single job. `true` when there was one. */
export async function domlaTick(deps?: DomlaDeps): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;
  await runJob(job, deps);
  return true;
}

/**
 * Housekeeping (leader only): expire sessions idle for 30 minutes (the student is told once), refund the ones
 * stuck in `preparing`. Returns how many sessions changed.
 */
export async function domlaHousekeeping(deps: DomlaDeps = defaultDeps(), now: Date = deps.now()): Promise<number> {
  let n = 0;
  for (const e of await expireIdle(now)) {
    n++;
    if (e.telegramId) await deps.telegram.sendText(e.telegramId, EXPIRED_TEXT).catch(() => undefined);
  }
  for (const id of await failStuckPreparing(now)) {
    n++;
    const r = await queryOne<{ chat_id: string | null }>("SELECT u.telegram_id::text AS chat_id FROM domla_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1", [id]);
    if (r?.chat_id) await deps.telegram.sendText(r.chat_id, FAILED_TEXT).catch(() => undefined);
  }
  return n;
}
