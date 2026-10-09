import "server-only";
import { Client } from "pg";
import { poolConfig, query } from "./db";
import { log } from "./log";
import { processIdFor } from "./heartbeat";
import { recordStep } from "./housekeeping-status";
import { botConfigured, callBot } from "./telegram";
import { contentOf, sendBroadcastContentOutcome, type BroadcastContent } from "./broadcast-content";
import { backoffSeconds, classify, isUnreachable, kindLabel, MAX_ATTEMPTS, type FailureKind, type SendOutcome } from "./broadcast-errors";
import { createLimiter, type Limiter } from "./send-limiter";
import { markBotBlocked } from "./bot-reachability";

/**
 * Telegram broadcast delivery engine (docs/admin/02-plan.md §6.9, docs/bonus/BONUS3.md C-Q5).
 *
 * The admin API snapshots recipients and sets a broadcast `queued`; a dedicated
 * loop in the worker process (`startBroadcastLoop`, NOT the 60 s housekeeping
 * tick) delivers it:
 *
 *   • CLAIM — a sender takes a short batch of `pending` recipients whose backoff
 *     has passed (`FOR UPDATE SKIP LOCKED`), marks them `sending` with a LEASE
 *     (`lease_until`) and commits BEFORE any HTTP call. No transaction is ever
 *     held across Telegram.
 *   • SEND — up to `senders` (8) concurrent senders, every message first passes
 *     one shared paced limiter (`send-limiter.ts`: even pacing, sliding-second
 *     cap of `perSecond` = 25, FIFO) so the total never exceeds 25 msg/s.
 *   • RECORD — each result is written in its own single statement:
 *       sent       → `sent`;
 *       429        → the limiter pauses ALL senders for retry_after + 1 s and the
 *                    recipient goes back to `pending` (not failed, no attempt used);
 *       network /
 *       5xx        → back to `pending` with `attempts + 1` and `next_attempt_at`
 *                    = now + LEAST(600, 10·2^attempts) s; after 6 attempts → `failed`;
 *       permanent  → `failed` with an `error_kind` (blocked, deactivated,
 *                    chat_not_found, bad_request, other — `broadcast-errors.ts`);
 *                    blocked / deactivated also set `users.bot_blocked_at`, so later
 *                    audiences skip that user (`bot-reachability.ts`).
 *   • EARLY ABORT — if 200 recipients failed with a CONTENT error (bad_request /
 *     other) and NOTHING was delivered, the broadcast is marked `failed` with a
 *     reason (a bad file_id / entities would otherwise burn the whole audience).
 *     Unreachable users (blocked, deactivated, chat not found — e.g. web-only
 *     Telegram logins that never started the bot) never count: they say nothing
 *     about the content.
 *   • CRASH SAFETY — a `sending` row whose lease expired returns to `pending` at the
 *     start of the next pass. A process that dies between Telegram accepting a
 *     message and the result being written therefore repeats AT MOST the messages
 *     that were in flight (one per sender, ≤ 8) to the same recipients; a sender never
 *     starts a send with less than `LEASE_MIN_LEFT_MS` of its lease left, so a
 *     stalled-but-alive process cannot double-send after its rows were re-claimed.
 *   • PAUSE / CANCEL — `paused` and `cancelled` are re-read before every message;
 *     unsent claimed rows are released straight back to `pending`.
 *
 * The stored text is plain text; it is HTML-escaped here because `sendMessage`
 * uses `parse_mode: "HTML"`. A broadcast composed in the bot (`content`, migration
 * 044) is sent as is instead — entities, photo / video by `file_id`, the optional
 * link button (`broadcast-content.ts`). Web broadcasts (plain text) are unchanged.
 */

export type DeliveryDeps = {
  /** Plain text (already HTML-escaped). Default: Bot API `sendMessage`, no internal 429 wait. */
  send?: (chatId: string, html: string) => Promise<SendOutcome>;
  /** Rich (bot-composed) content. Default: `sendBroadcastContentOutcome`. */
  sendRich?: (chatId: string, text: string, content: BroadcastContent) => Promise<SendOutcome>;
  /** A rich broadcast with `notify` ended (done or aborted). Default: the bot panel's summary message. */
  notifyDone?: (id: string, notify: NonNullable<BroadcastContent["notify"]>) => Promise<void>;
  /**
   * Keeps the bot's progress message of a rich broadcast current (`content.notify.messageId`):
   * called about every `progressEveryMs` while it sends. Default: the bot panel's in-place edit.
   */
  editProgress?: (id: string, notify: { chatId: string; lang: string; messageId?: number }) => Promise<void>;
  /** At most one progress edit per broadcast per this many ms (default 10 s). */
  progressEveryMs?: number;
  /** Default: `botConfigured()`. */
  configured?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  perSecond?: number;
  /** Concurrent senders (default 8). */
  senders?: number;
  /** Recipients claimed per batch (default 10). */
  batchSize?: number;
  /** Lease of a claimed batch, ms (default 90 s). */
  leaseMs?: number;
  /** Stop after this many claimed recipients (tests; default: no limit). */
  maxPerTick?: number;
  /** Permanent failures with 0 delivered that abort a broadcast (default 200). */
  earlyAbortAfter?: number;
  /** Share a limiter across passes (the loop does; default: a fresh one from `now`/`sleep`/`perSecond`). */
  limiter?: Limiter;
};

export type DeliveryResult = {
  /** Recipients with a final result this pass (sent + failed). */
  rows: number;
  sent: number;
  failed: number;
  /** Recipients put back for another attempt (429 or transient error). */
  retried: number;
  /** Broadcasts that became `done` this pass. */
  finished: number;
  /** Broadcasts marked `failed` by the early abort this pass. */
  aborted: number;
};

export const BROADCAST_PER_SECOND = 25;
export const BROADCAST_SENDERS = 8;
export const BROADCAST_BATCH = 10;
export const BROADCAST_LEASE_MS = 90_000;
/** A send is never started with less lease than this left (HTTP timeout is 15 s). */
export const LEASE_MIN_LEFT_MS = 25_000;
export const EARLY_ABORT_AFTER = 200;
/** The bot's progress message is edited at most this often per broadcast. */
export const PROGRESS_EVERY_MS = 10_000;
/** Broadcasts looked at per pass (oldest first). */
const MAX_BROADCASTS = 20;

/** Legacy text of recipients refused before `error_kind` existed (migration 046). */
export const REJECTED_TEXT = "Telegram xabarni qabul qilmadi (bot bloklangan yoki chat topilmadi)";

/** Escapes plain text for Telegram `parse_mode: "HTML"`. */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const ACTIVE = ["queued", "sending"];

type Claimed = { userId: string; telegramId: string; attempts: number; lease: string };

type Ctx = {
  id: string;
  limiter: Limiter;
  deps: Required<Pick<DeliveryDeps, "senders" | "batchSize" | "leaseMs" | "earlyAbortAfter">>;
  now: () => number;
  /** Plain or rich sender, bound to this broadcast. */
  to: (chatId: string) => Promise<SendOutcome>;
  out: DeliveryResult;
  budget: { left: number };
  /** Set once the broadcast is no longer active (cancelled / paused / aborted) — every sender stops. */
  stopped: boolean;
  /** Set when a sender found nothing left to claim. */
  drained: boolean;
  /** Set when the early abort ended this broadcast. */
  aborted: boolean;
};

/* -------------------------------------------------------------------------- */
/* Claim / release / record — every statement is its own short transaction     */
/* -------------------------------------------------------------------------- */

async function claimBatch(id: string, n: number, leaseMs: number): Promise<Claimed[]> {
  if (n <= 0) return [];
  const rows = await query<{ user_id: string; telegram_id: string; attempts: number; lease: string }>(
    `WITH c AS (
       SELECT user_id FROM broadcast_recipients
        WHERE broadcast_id = $1 AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY user_id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     )
     UPDATE broadcast_recipients r
        SET status = 'sending', lease_until = now() + $3::int * interval '1 millisecond'
       FROM c
      WHERE r.broadcast_id = $1 AND r.user_id = c.user_id
      RETURNING r.user_id::text AS user_id, r.telegram_id::text AS telegram_id, r.attempts, r.lease_until::text AS lease`,
    [id, n, Math.floor(leaseMs)],
  );
  return rows
    .map((r) => ({ userId: r.user_id, telegramId: r.telegram_id, attempts: Number(r.attempts), lease: r.lease }))
    .sort((a, b) => (BigInt(a.userId) < BigInt(b.userId) ? -1 : 1));
}

/** Claimed but not sent (cancel / pause / lease nearly gone / 429): straight back to `pending`. */
async function release(id: string, rows: Claimed[]): Promise<void> {
  if (rows.length === 0) return;
  await query(
    `UPDATE broadcast_recipients SET status = 'pending', lease_until = NULL
      WHERE broadcast_id = $1 AND status = 'sending' AND user_id = ANY($2::bigint[]) AND lease_until = ANY($3::timestamptz[])`,
    [id, rows.map((r) => r.userId), [...new Set(rows.map((r) => r.lease))]],
  );
}

async function recordSent(id: string, r: Claimed): Promise<boolean> {
  const res = await query<{ n: number }>(
    `WITH r AS (
       UPDATE broadcast_recipients
          SET status = 'sent', sent_at = now(), done_at = now(), lease_until = NULL, error = NULL, error_kind = NULL, attempts = attempts + 1
        WHERE broadcast_id = $1 AND user_id = $2 AND status = 'sending' AND lease_until = $3::timestamptz
        RETURNING 1)
     UPDATE broadcasts SET sent = sent + (SELECT count(*) FROM r)::int, heartbeat_at = now() WHERE id = $1
     RETURNING (SELECT count(*) FROM r)::int AS n`,
    [id, r.userId, r.lease],
  );
  return Number(res[0]?.n ?? 0) > 0;
}

async function recordFailed(id: string, r: Claimed, kind: FailureKind, reason: string): Promise<boolean> {
  const res = await query<{ n: number }>(
    `WITH r AS (
       UPDATE broadcast_recipients
          SET status = 'failed', error = $4, error_kind = $5, done_at = now(), lease_until = NULL, attempts = attempts + 1
        WHERE broadcast_id = $1 AND user_id = $2 AND status = 'sending' AND lease_until = $3::timestamptz
        RETURNING 1)
     UPDATE broadcasts SET failed = failed + (SELECT count(*) FROM r)::int, heartbeat_at = now() WHERE id = $1
     RETURNING (SELECT count(*) FROM r)::int AS n`,
    [id, r.userId, r.lease, reason.slice(0, 300), kind],
  );
  return Number(res[0]?.n ?? 0) > 0;
}

/**
 * Back to `pending`. `attemptUsed`: a transient error costs an attempt and waits `delayS`;
 * a 429 costs nothing and may be retried at once (the limiter is paused anyway).
 */
async function requeue(id: string, r: Claimed, opts: { attemptUsed: boolean; delayS: number | null; error: string }): Promise<void> {
  await query(
    `WITH r AS (
       UPDATE broadcast_recipients
          SET status = 'pending', lease_until = NULL, attempts = attempts + $4::int, error = $6,
              next_attempt_at = CASE WHEN $5::int IS NULL THEN NULL ELSE now() + $5::int * interval '1 second' END
        WHERE broadcast_id = $1 AND user_id = $2 AND status = 'sending' AND lease_until = $3::timestamptz
        RETURNING 1)
     UPDATE broadcasts SET heartbeat_at = now() WHERE id = $1`,
    [id, r.userId, r.lease, opts.attemptUsed ? 1 : 0, opts.delayS, opts.error.slice(0, 300)],
  );
}

/** Failure kinds that indict the CONTENT (a bad file_id, broken entities) rather than the recipient. */
const isContentFailure = (kind: FailureKind): boolean => kind === "bad_request" || kind === "other";

/** Nothing delivered and `after` content refusals: the content itself is bad. Returns whether it aborted. */
async function abortIfHopeless(id: string, after: number): Promise<boolean> {
  const hit = await query<{ id: string }>(
    `UPDATE broadcasts SET status = 'failed', finished_at = now(),
            fail_reason = 'Birinchi ' || $2::text || ' ta yuborishning hammasi doimiy xato bilan tugadi — xabar tarkibini (fayl, format) tekshiring. Yuborish to''xtatildi.'
      WHERE id = $1 AND status IN ('queued', 'sending') AND sent = 0
        AND (SELECT count(*) FROM broadcast_recipients
              WHERE broadcast_id = $1 AND status = 'failed' AND error_kind IN ('bad_request', 'other')) >= $2
      RETURNING id`,
    [id, after],
  );
  if (hit.length === 0) return false;
  const top = await query<{ error_kind: string | null }>(
    `SELECT error_kind FROM broadcast_recipients WHERE broadcast_id = $1 AND status = 'failed'
      GROUP BY error_kind ORDER BY count(*) DESC LIMIT 1`,
    [id],
  );
  await query("UPDATE broadcasts SET fail_reason = fail_reason || ' Asosiy sabab: ' || $2::text || '.' WHERE id = $1", [id, kindLabel(top[0]?.error_kind)]);
  return true;
}

/** `done` once nothing is pending / in flight any more. Returns whether it changed. */
async function finishIfDrained(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE broadcasts SET status = 'done', finished_at = now()
      WHERE id = $1 AND status IN ('queued', 'sending')
        AND NOT EXISTS (SELECT 1 FROM broadcast_recipients WHERE broadcast_id = $1 AND status IN ('pending', 'sending'))
      RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

async function isActive(id: string): Promise<boolean> {
  const rows = await query<{ status: string }>("SELECT status FROM broadcasts WHERE id = $1", [id]);
  const s = rows[0]?.status;
  return s !== undefined && ACTIVE.includes(s);
}

/* -------------------------------------------------------------------------- */
/* One broadcast                                                               */
/* -------------------------------------------------------------------------- */

async function sender(ctx: Ctx): Promise<void> {
  while (!ctx.stopped && ctx.budget.left > 0) {
    // Nobody claims new work during a global 429 pause.
    await ctx.limiter.whenResumed();
    // Reserve the budget BEFORE awaiting the claim: eight senders must not all read the same remainder.
    const take = Math.min(ctx.deps.batchSize, ctx.budget.left);
    ctx.budget.left -= take;
    const batch = await claimBatch(ctx.id, take, ctx.deps.leaseMs);
    ctx.budget.left += take - batch.length;
    if (batch.length === 0) {
      ctx.drained = take > 0;
      return;
    }
    const claimedAt = ctx.now();
    for (let i = 0; i < batch.length; i++) {
      const rec = batch[i]!;
      const rest = batch.slice(i);
      if (ctx.stopped) return release(ctx.id, rest);
      await ctx.limiter.acquire();
      if (ctx.stopped || !(await isActive(ctx.id))) {
        ctx.stopped = true;
        return release(ctx.id, rest);
      }
      // Waited too long (a pause, a slow limiter): another sender may be about to reclaim these rows. Do not send.
      if (ctx.now() - claimedAt > ctx.deps.leaseMs - LEASE_MIN_LEFT_MS) {
        await release(ctx.id, rest);
        break;
      }
      let outcome: SendOutcome;
      try {
        outcome = await ctx.to(rec.telegramId);
      } catch (e) {
        outcome = { ok: false, code: 0, description: e instanceof Error ? e.message : "yuborishda kutilmagan xato" };
      }
      const v = classify(outcome);
      if (v.type === "sent") {
        if (await recordSent(ctx.id, rec)) {
          ctx.out.rows++;
          ctx.out.sent++;
        }
      } else if (v.type === "rate_limit") {
        // One 429 stops everyone: pause the shared limiter, put this recipient and the unsent rest of the batch back.
        ctx.limiter.pauseFor((v.retryAfterS + 1) * 1000);
        log("warn", "[broadcast] Telegram 429 — barcha yuboruvchilar to'xtatildi", { broadcastId: ctx.id, retryAfterS: v.retryAfterS });
        await requeue(ctx.id, rec, { attemptUsed: false, delayS: null, error: "429 Too Many Requests" });
        ctx.out.retried++;
        await release(ctx.id, batch.slice(i + 1));
        break;
      } else if (v.type === "transient") {
        if (rec.attempts + 1 >= MAX_ATTEMPTS) {
          if (await recordFailed(ctx.id, rec, "other", `Telegram javob bermadi (${MAX_ATTEMPTS} urinish): ${v.reason}`)) {
            ctx.out.rows++;
            ctx.out.failed++;
          }
        } else {
          await requeue(ctx.id, rec, { attemptUsed: true, delayS: backoffSeconds(rec.attempts), error: v.reason });
          ctx.out.retried++;
        }
      } else {
        if (await recordFailed(ctx.id, rec, v.kind, v.reason)) {
          ctx.out.rows++;
          ctx.out.failed++;
          if (isUnreachable(v.kind)) await markBotBlocked({ userId: rec.userId });
        }
        if (isContentFailure(v.kind) && (await abortIfHopeless(ctx.id, ctx.deps.earlyAbortAfter))) {
          ctx.stopped = true;
          ctx.aborted = true;
          ctx.out.aborted++;
          log("error", "[broadcast] erta to'xtatildi — hammasi doimiy xato", { broadcastId: ctx.id });
          return release(ctx.id, batch.slice(i + 1));
        }
      }
    }
  }
}

/** When each broadcast's progress message was last edited (real clock: the interval above is real too). */
const lastProgressEdit = new Map<string, number>();

/** One progress edit, if the broadcast has a bot progress message and the last edit is old enough. Never throws. */
async function progressTick(id: string, shared: SharedPass): Promise<void> {
  try {
    if (Date.now() - (lastProgressEdit.get(id) ?? 0) < shared.progressEveryMs) return;
    // Re-read: the admin may have tapped «Yangilash» on another message since the pass started.
    const rows = await query<{ notify: { chatId?: unknown; lang?: unknown; messageId?: unknown } | null }>("SELECT content -> 'notify' AS notify FROM broadcasts WHERE id = $1", [id]);
    const n = rows[0]?.notify;
    if (!n || typeof n.chatId !== "string" || typeof n.lang !== "string" || typeof n.messageId !== "number") return;
    lastProgressEdit.set(id, Date.now());
    await shared.editProgress(id, { chatId: n.chatId, lang: n.lang, messageId: n.messageId });
  } catch (err) {
    log("warn", "[broadcast] progress xabari yangilanmadi", { broadcastId: id, err });
  }
}

async function runBroadcast(b: { id: string; text: string; content: unknown }, shared: SharedPass): Promise<void> {
  await query(
    "UPDATE broadcasts SET status = 'sending', started_at = COALESCE(started_at, now()) WHERE id = $1 AND status IN ('queued', 'sending')",
    [b.id],
  );
  const content = contentOf(b.content, b.text);
  const html = escapeTelegramHtml(b.text);
  const ctx: Ctx = {
    id: b.id,
    limiter: shared.limiter,
    deps: shared.deps,
    now: shared.now,
    to: content ? (chatId) => shared.sendRich(chatId, b.text, content) : (chatId) => shared.send(chatId, html),
    out: shared.out,
    budget: shared.budget,
    stopped: false,
    drained: false,
    aborted: false,
  };
  // The admin's bot message follows the numbers while this broadcast sends (~every 10 s, never faster).
  const timer = setInterval(() => void progressTick(b.id, shared), Math.max(5, shared.progressEveryMs));
  timer.unref?.();
  try {
    await Promise.all(Array.from({ length: ctx.deps.senders }, () => sender(ctx)));
  } finally {
    clearInterval(timer);
    lastProgressEdit.delete(b.id);
  }
  // Liveness while idle (everything in backoff / paused): at most one write per 10 s.
  await query("UPDATE broadcasts SET heartbeat_at = now() WHERE id = $1 AND (heartbeat_at IS NULL OR heartbeat_at < now() - interval '10 seconds')", [b.id]);
  if (ctx.stopped) {
    if (ctx.aborted && content?.notify) await shared.notify(b.id, content.notify);
    return;
  }
  if (ctx.drained && (await finishIfDrained(b.id))) {
    shared.out.finished++;
    log("info", "[broadcast] yuborish tugadi", { broadcastId: b.id });
    if (content?.notify) await shared.notify(b.id, content.notify);
  }
}

type SharedPass = {
  limiter: Limiter;
  deps: Ctx["deps"];
  now: () => number;
  send: (chatId: string, html: string) => Promise<SendOutcome>;
  sendRich: (chatId: string, text: string, content: BroadcastContent) => Promise<SendOutcome>;
  notify: (id: string, notify: NonNullable<BroadcastContent["notify"]>) => Promise<void>;
  editProgress: (id: string, notify: NonNullable<BroadcastContent["notify"]>) => Promise<void>;
  progressEveryMs: number;
  out: DeliveryResult;
  budget: { left: number };
};

const defaultSend = async (chatId: string, html: string): Promise<SendOutcome> =>
  callBot("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }, { noRetry: true });

// One limiter for the whole process, so the 429 pause and the 25/s pace span successive passes.
let sharedLimiter: Limiter | null = null;
function processLimiter(): Limiter {
  return (sharedLimiter ??= createLimiter({ perSecond: BROADCAST_PER_SECOND }));
}

/**
 * One delivery pass: recover expired leases, then work the active broadcasts (oldest
 * first) until nothing is claimable right now (rows in backoff wait for a later pass) or
 * `maxPerTick` recipients were claimed. Throws only on database errors; Telegram errors
 * never throw. The loop calls it again immediately while it is making progress.
 */
export async function deliverBroadcasts(deps: DeliveryDeps = {}): Promise<DeliveryResult> {
  const out: DeliveryResult = { rows: 0, sent: 0, failed: 0, retried: 0, finished: 0, aborted: 0 };
  if (!(deps.configured ?? botConfigured)()) return out;
  const active = await query<{ id: string; text: string; content: unknown }>(
    `SELECT id::text AS id, text, content FROM broadcasts
      WHERE status IN ('queued', 'sending')
      ORDER BY queued_at NULLS LAST, id
      LIMIT ${MAX_BROADCASTS}`,
  );
  if (active.length === 0) return out;

  const recovered = await query<{ n: string }>(
    `WITH r AS (
       UPDATE broadcast_recipients SET status = 'pending', lease_until = NULL
        WHERE broadcast_id = ANY($1::bigint[]) AND status = 'sending' AND lease_until < now()
        RETURNING 1)
     SELECT count(*)::text AS n FROM r`,
    [active.map((b) => b.id)],
  );
  if (Number(recovered[0]?.n ?? 0) > 0) log("warn", "[broadcast] muddati o'tgan lease'lar qaytarildi", { rows: Number(recovered[0]!.n) });

  const now = deps.now ?? Date.now;
  const limiter =
    deps.limiter ??
    (deps.now || deps.sleep || deps.perSecond !== undefined
      ? createLimiter({ perSecond: deps.perSecond ?? BROADCAST_PER_SECOND, ...(deps.now ? { now: deps.now } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) })
      : processLimiter());
  const shared: SharedPass = {
    limiter,
    now,
    deps: {
      senders: Math.max(1, Math.floor(deps.senders ?? BROADCAST_SENDERS)),
      batchSize: Math.max(1, Math.floor(deps.batchSize ?? BROADCAST_BATCH)),
      leaseMs: Math.max(LEASE_MIN_LEFT_MS * 2, Math.floor(deps.leaseMs ?? BROADCAST_LEASE_MS)),
      earlyAbortAfter: Math.max(1, Math.floor(deps.earlyAbortAfter ?? EARLY_ABORT_AFTER)),
    },
    send: deps.send ?? defaultSend,
    sendRich: deps.sendRich ?? sendBroadcastContentOutcome,
    notify: async (id, notify) => {
      // Best effort: the broadcast already ended; a failed notice must not fail the pass.
      const fn =
        deps.notifyDone ??
        (async (i: string, n: NonNullable<BroadcastContent["notify"]>) => {
          // Loaded lazily: the bot screens are not needed by the plain-text path.
          const { notifyBroadcastDone } = await import("./bot/admin");
          await notifyBroadcastDone(i, n);
        });
      await fn(id, notify).catch((err) => log("warn", "[broadcast] admin xabarnomasi yuborilmadi", { broadcastId: id, err }));
    },
    editProgress:
      deps.editProgress ??
      (async (i, n) => {
        const { editBroadcastProgress } = await import("./bot/admin");
        await editBroadcastProgress(i, n);
      }),
    progressEveryMs: Math.max(1, Math.floor(deps.progressEveryMs ?? PROGRESS_EVERY_MS)),
    out,
    budget: { left: deps.maxPerTick === undefined ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.floor(deps.maxPerTick)) },
  };

  for (const b of active) {
    if (shared.budget.left <= 0) break;
    await runBroadcast(b, shared);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The loop (worker process)                                                   */
/* -------------------------------------------------------------------------- */

/** Postgres advisory lock of the broadcast loop leader (housekeeping uses …002). */
export const BROADCAST_LOCK_ID = 727_000_003;
const IDLE_MS = 1_000;
const LOCK_RETRY_MS = 5_000;
const ERROR_RETRY_MS = 5_000;
const LEADER_CHECK_MS = 15_000;
const STATUS_EVERY_MS = 60_000;

export type BroadcastLoopOptions = {
  /** Test seam: the pass (default `deliverBroadcasts` with the process limiter). */
  pass?: () => Promise<DeliveryResult>;
  /** Test seam: open the lock connection. */
  connect?: () => Promise<Client>;
  idleMs?: number;
  /** Test seam: skip the advisory lock (instances then rely on SKIP LOCKED only). */
  noLock?: boolean;
};

export type BroadcastLoop = { stop: () => Promise<void> };

/**
 * Starts the delivery loop in this process. Only the process holding the advisory lock
 * (one per cluster, like housekeeping) delivers — so the 25/s pace and the 429 pause are
 * global; a lost lock (dropped connection) is re-acquired by any process. Timers are
 * `unref`ed: the loop never keeps a process alive.
 */
export function startBroadcastLoop(opts: BroadcastLoopOptions = {}): BroadcastLoop {
  let stopped = false;
  let wake: (() => void) | null = null;
  let leader: Client | null = null;
  let leaderCheckedAt = 0;
  let handled = 0;
  let statusAt = Date.now();
  const processId = processIdFor("worker");
  const pass = opts.pass ?? (() => deliverBroadcasts());

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      t.unref?.();
      function done() {
        clearTimeout(t);
        wake = null;
        resolve();
      }
      wake = done;
    });

  async function dropLeader(): Promise<void> {
    const c = leader;
    leader = null;
    await c?.end().catch(() => undefined);
  }

  async function ensureLeader(): Promise<boolean> {
    if (opts.noLock) return true;
    if (leader && Date.now() - leaderCheckedAt >= LEADER_CHECK_MS) {
      leaderCheckedAt = Date.now();
      try {
        const r = await leader.query(
          "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND classid = 0 AND objid = $1 AND granted",
          [BROADCAST_LOCK_ID],
        );
        if (r.rows.length === 0) await dropLeader();
      } catch {
        await dropLeader();
      }
    }
    if (leader) return true;
    const c = await (opts.connect ?? (async () => {
      const k = new Client(poolConfig());
      k.on("error", (err) => log("warn", "[broadcast] qulf ulanishi uzildi", { err }));
      await k.connect();
      return k;
    }))();
    let got = false;
    try {
      const r = await c.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [BROADCAST_LOCK_ID]);
      got = r.rows[0]?.ok === true;
    } finally {
      if (!got) await c.end().catch(() => undefined);
    }
    if (!got) return false;
    leader = c;
    leaderCheckedAt = Date.now();
    log("info", "[broadcast] yuborish yetakchisi — shu process");
    return true;
  }

  const running = (async () => {
    while (!stopped) {
      try {
        if (!botConfigured()) {
          await wait(LOCK_RETRY_MS);
          continue;
        }
        if (!(await ensureLeader())) {
          await wait(LOCK_RETRY_MS);
          continue;
        }
        const r = await pass();
        handled += r.rows;
        if (Date.now() - statusAt >= STATUS_EVERY_MS) {
          statusAt = Date.now();
          const rows = handled;
          handled = 0;
          // The admin system page's «broadcasts» row: alive, and how much was delivered since the last write.
          await recordStep("broadcasts", processId, async () => rows).catch(() => undefined);
        }
        // Progress (or work waiting out a backoff) → straight back; idle → poll once a second.
        if (r.rows === 0 && r.retried === 0) await wait(opts.idleMs ?? IDLE_MS);
        else await new Promise<void>((resolve) => setImmediate(resolve));
      } catch (e) {
        log("error", "[broadcast] yuborish sikli xatosi", { err: e });
        await dropLeader();
        await wait(ERROR_RETRY_MS);
      }
    }
    await dropLeader();
  })();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await running;
    },
  };
}
