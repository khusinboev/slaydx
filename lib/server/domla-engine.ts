import "server-only";
import { recordAiUsage } from "./ai-usage";
import { trackJobCost } from "../generation/job-cost";
import { deckText } from "../domla/deck-text";
import { cb } from "./bot/codes";
import { t } from "./bot/i18n";
import { appUrl, esc, inlineButton, rows } from "./bot/ui";
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
  deleteAnswerAudio,
  expireIdle,
  loadAudio,
  setNotice,
  storeQuestionAudio,
  failSession,
  failStuckPreparing,
  finishSession,
  markAsked,
  queueNext,
  recordAnswer,
  retryJob,
  type DomlaChannel,
  type DomlaJob,
  type DomlaSession,
} from "./domla";
import { rowToSession } from "./domla";
import { DomlaFileError, defaultDeps, geminiAudioMime, type DomlaDeps, type SpokenAudio } from "./domla-deps";
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
 *
 * Channels (migration 079): a session talks to ONE channel at a time, read fresh at every job. `bot` = the Telegram
 * chat as above. `web` = the /uz/domla chat, which reads the state by polling: an `ask` only makes and stores the
 * voice, reactions / the final verdict are the state itself, and the few notices the state cannot show («could not
 * hear you») are written to `domla_sessions.notice`. Nothing is sent to Telegram for a web session. Every question's
 * voice is stored (`domla_audio`, MP3) the first time it is made, so moving between bot and web never synthesizes a
 * question twice; a web voice answer is read from `domla_audio` and deleted as soon as it is scored or given up on.
 */

const BACKOFF_SEC = [20, 60];

type Ctx = { deps: DomlaDeps; chatId: string | null; userId: string; channel: DomlaChannel; sessionId: string };

type Loaded = DomlaSession & { chatId: string | null };

async function loadSession(id: string): Promise<Loaded | null> {
  const r = await queryOne<Parameters<typeof rowToSession>[0] & { chat_id: string | null }>(
    `SELECT s.id, s.user_id::text AS user_id, s.status, s.topic, s.source_generation_id, s.questions, s.answers, s.asked, s.grade,
            s.charged_points::text AS charged_points, s.last_activity_at, s.created_at, s.finished_at, s.channel, s.notice,
            u.telegram_id::text AS chat_id
       FROM domla_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [id],
  );
  return r ? { ...rowToSession(r), chatId: r.chat_id } : null;
}

const finalButtons = () => rows([inlineButton(null, "Yana himoya qilish", { callback_data: cb.domlaList() }, "primary")]);

/** «Saytda davom etish» under a bot question: opens /uz/domla, which moves the defence to the web (`?davom=web`). */
export function webButtonMarkup(): ReturnType<typeof rows> | undefined {
  const url = appUrl("/uz/domla?davom=web");
  return url ? rows([inlineButton(null, t("uz", "domla.webBtn"), { web_app: { url } })]) : undefined;
}

/** A bot-only message (reactions, the final verdict: the web chat shows them from the state). */
async function say(ctx: Ctx, text: string, markup?: unknown): Promise<void> {
  if (ctx.channel === "bot" && ctx.chatId) await ctx.deps.telegram.sendText(ctx.chatId, text, markup);
}

/** A notice the student must see on either channel: a bot message, or the web chat's notice line. */
async function notify(ctx: Ctx, text: string): Promise<void> {
  if (ctx.channel === "web") await setNotice(ctx.sessionId, text);
  else if (ctx.chatId) await ctx.deps.telegram.sendText(ctx.chatId, text);
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
  // A move between channels re-sends the question with the voice made the first time (`reuse`): never synthesized twice.
  const reuse = job.payload.reuse === true;
  const stored = await loadAudio(s.id, "question", idx);

  const speak = async (): Promise<SpokenAudio | null> => {
    if (stored && (reuse || !resend)) return { bytes: stored.bytes, seconds: stored.seconds };
    try {
      return await ctx.deps.synthesize(spokenQuestion(idx, q, { greet: first, resume: resend }), { generationId: s.sourceGenerationId, scope: `domla:${job.id}` });
    } catch (e) {
      // The voice is an extra: the question still goes out as text.
      log("warn", "[domla] ovoz yaratilmadi, savol matn bilan yuboriladi", { err: e, sessionId: s.id });
      return null;
    }
  };

  if (ctx.channel === "web") {
    // The web chat reads the question from the state and plays the stored voice: make it once, nothing is sent.
    if (resend && s.asked > idx) return;
    const audio = await speak();
    if (audio && !stored) await storeQuestionAudio(s.id, idx, audio);
    await markAsked(s.id, idx);
    return;
  }

  const caption = (first ? `${esc(GREETING)}\n\n` : "") + questionCaption(idx, s.questions.length, q);
  if (!ctx.chatId) return;
  await ctx.deps.telegram.sendAction(ctx.chatId, "record_voice");
  const audio = await speak();
  // Kept for a move to the web (the first voice made for a question wins, a later take never replaces it).
  if (audio && !stored) await storeQuestionAudio(s.id, idx, audio);
  const markup = webButtonMarkup();
  let sent = false;
  if (audio) sent = await ctx.deps.telegram.sendAudio(ctx.chatId, audio, caption, markup);
  if (!sent) await ctx.deps.telegram.sendText(ctx.chatId, caption, markup);
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
    if (ctx.channel === "bot" && ctx.chatId) await ctx.deps.telegram.sendAction(ctx.chatId, "typing");
    const via = job.payload.via === "voice" ? "voice" : "text";
    const gen = s.sourceGenerationId
      ? await queryOne<{ slides: SlideModel[] | null }>("SELECT doc_json->'slides' AS slides FROM generations WHERE id = $1 AND user_id = $2", [s.sourceGenerationId, s.userId])
      : null;
    const deck = deckText(gen?.slides ?? null);
    let result;
    if (via === "voice") {
      // A web answer (`stored`) waits in domla_audio; a bot answer is a Telegram file id.
      const stored = job.payload.stored === true;
      const mime = geminiAudioMime(String(job.payload.mime ?? ""));
      if (!mime) {
        if (stored) await deleteAnswerAudio(s.id, idx);
        await notify(ctx, HEARING_FAILED_TEXT);
        return;
      }
      let bytes: Uint8Array;
      if (stored) {
        const a = await loadAudio(s.id, "answer", idx);
        if (!a) {
          await notify(ctx, HEARING_FAILED_TEXT);
          return;
        }
        bytes = a.bytes;
      } else {
        try {
          bytes = await ctx.deps.telegram.downloadFile(String(job.payload.fileId ?? ""));
        } catch (e) {
          if (e instanceof DomlaFileError) {
            await notify(ctx, e.reason === "too_big" ? TOO_BIG_TEXT : HEARING_FAILED_TEXT);
            return;
          }
          throw e;
        }
      }
      result = await ctx.deps.score({ question: q, topic: s.topic, deck, audio: { bytes, mime } });
      // Scored: the stored web answer goes NOW (a transient scoring failure above keeps it for the retry). The bot's
      // bytes go out of scope here -- nothing audio is kept.
      if (stored) await deleteAnswerAudio(s.id, idx);
      if (!result.transcript) {
        await notify(ctx, HEARING_FAILED_TEXT);
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
    // A web session shows `failed` (and the refund) from the state itself.
    if (r.failed && ctx.channel === "bot" && ctx.chatId) await ctx.deps.telegram.sendText(ctx.chatId, FAILED_TEXT).catch(() => undefined);
    return;
  }
  if (job.kind === "score") {
    // Given up on: a stored web answer goes too (never kept), and the student is asked to answer again.
    await deleteAnswerAudio(job.sessionId, job.idx).catch(() => undefined);
    await notify(ctx, HEARING_FAILED_TEXT).catch(() => undefined);
  }
  await completeJob(job.id);
}

/** Runs one claimed job. Never throws. */
export async function runJob(job: DomlaJob, deps: DomlaDeps = defaultDeps()): Promise<"done" | "retry" | "gave_up"> {
  const s = await loadSession(job.sessionId);
  if (!s) {
    await completeJob(job.id);
    return "done";
  }
  const ctx: Ctx = { deps, chatId: s.chatId, userId: s.userId, channel: s.channel, sessionId: s.id };
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
    // A web defence shows `expired` from the state: the bot is told only when the defence lives there.
    if (e.channel === "bot" && e.telegramId) await deps.telegram.sendText(e.telegramId, EXPIRED_TEXT).catch(() => undefined);
  }
  for (const id of await failStuckPreparing(now)) {
    n++;
    const r = await queryOne<{ chat_id: string | null; channel: string }>(
      "SELECT u.telegram_id::text AS chat_id, s.channel FROM domla_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1",
      [id],
    );
    if (r?.chat_id && r.channel === "bot") await deps.telegram.sendText(r.chat_id, FAILED_TEXT).catch(() => undefined);
  }
  return n;
}
