import "server-only";
import { query, queryOne } from "./db";
import { botConfigured } from "./telegram";
import { sendUserDm, type DmTarget } from "./bot-dm";
import { processLimiter } from "./broadcast-delivery";
import type { Limiter } from "./send-limiter";
import { getSetting } from "./settings";
import { log } from "./log";
import { inviteScreen } from "./bot/daily-quiz-screens";
import { DQ_ENABLED_KEY, DQ_HOUR_KEY, DQ_REWARD_KEY, tashkentDay, tashkentHour } from "../daily-quiz/rules";

/**
 * The morning «Kunlik savollar» message (owner request 16, migration 055). A leader-only housekeeping step
 * (`daily-quiz` in `worker.ts purgeHousekeeping`) calls `runDailyQuizSend` every tick.
 *
 * Once per Tashkent day, when the feature is enabled and the Tashkent hour has reached `daily_quiz.hour`:
 *
 *  1. CLAIM — `INSERT INTO daily_quiz_sends (day) … ON CONFLICT DO NOTHING`. The row is the day's mark: a
 *     restart, a second tick or a second worker finds it and never starts another pass.
 *  2. PAGE — recipients are taken in `users.id` order after the row's `last_user_id` cursor, a small batch at
 *     a time. The cursor moves BEFORE a batch is sent, with a compare-and-set (`WHERE last_user_id = <seen>`):
 *     at-most-once (a crash loses at most one batch, never double-sends) and two overlapping runs cannot take
 *     the same batch. A tick stops after `budgetMs`; the next tick continues from the cursor.
 *  3. SEND — `sendUserDm` (the shared bot-DM helper) behind the broadcast engine's process-wide 25 msg/s
 *     limiter, so the quiz and a running broadcast share Telegram's rate budget. A permanent refusal marks
 *     `users.bot_blocked_at`; nothing is retried.
 *  4. FINISH — when the cursor runs out of recipients `finished_at` is set; later ticks do nothing that day.
 *
 * Recipients: has a Telegram id, not blocked by an admin, bot not blocked, not opted out (`daily_quiz_off`),
 * not already finished today's quiz, and active in the last `ACTIVE_DAYS` days (a generation, a web session or
 * any account update — `/start`, login, profile edit, top-up — in the window).
 */

export const ACTIVE_DAYS = 30;
export const SEND_BATCH = 25;
/** A tick sends for at most this long, so housekeeping (and the leader lock heartbeat) is never held for minutes. */
export const SEND_TICK_BUDGET_MS = 20_000;

export type SendDeps = {
  /** Test clock. */
  now?: Date;
  /** Test seam: default is the broadcast engine's shared 25 msg/s limiter. */
  limiter?: Limiter;
  /** Test seam: default `sendUserDm`. */
  send?: typeof sendUserDm;
  batch?: number;
  budgetMs?: number;
  /** Monotonic ms clock for the tick budget (tests). */
  clock?: () => number;
};

type Recipient = { id: string; telegram_id: string; language: string | null };

/** Eligible recipients after the cursor (see the module comment). `$1` = cursor, `$2` = day, `$3` = limit. */
const NEXT_BATCH_SQL = `
  SELECT u.id::text AS id, u.telegram_id::text AS telegram_id, u.language
    FROM users u
   WHERE u.id > $1::bigint
     AND u.telegram_id IS NOT NULL
     AND NOT u.is_blocked
     AND u.bot_blocked_at IS NULL
     AND NOT u.daily_quiz_off
     AND NOT EXISTS (SELECT 1 FROM daily_quiz_attempts a WHERE a.user_id = u.id AND a.day = $2::date AND a.finished_at IS NOT NULL)
     AND (u.updated_at >= now() - ${ACTIVE_DAYS} * interval '1 day'
          OR EXISTS (SELECT 1 FROM generations g WHERE g.user_id = u.id AND g.created_at >= now() - ${ACTIVE_DAYS} * interval '1 day')
          OR EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id
                      AND (s.created_at >= now() - ${ACTIVE_DAYS} * interval '1 day' OR s.last_seen_at >= now() - ${ACTIVE_DAYS} * interval '1 day')))
   ORDER BY u.id
   LIMIT $3`;

/**
 * One housekeeping tick. Returns how many messages Telegram accepted in this tick (0 when disabled, too early,
 * already finished, or the bot is not configured). Never throws because of Telegram; database errors propagate
 * (the worker's `step` logs them and the next tick resumes from the cursor).
 */
export async function runDailyQuizSend(deps: SendDeps = {}): Promise<number> {
  if (!botConfigured()) return 0;
  if (!(await getSetting(DQ_ENABLED_KEY))) return 0;
  const now = deps.now ?? new Date();
  if (tashkentHour(now) < (await getSetting(DQ_HOUR_KEY))) return 0;
  const day = tashkentDay(now);

  // 1. CLAIM the day. The row exists after the first tick (read first: no write per minute all day); the INSERT
  // is the claim itself, and a conflict means another tick / worker got there first and its row decides.
  const markOf = () => queryOne<{ finished: boolean }>("SELECT finished_at IS NOT NULL AS finished FROM daily_quiz_sends WHERE day = $1::date", [day]);
  let mark = await markOf();
  if (!mark) {
    await query("INSERT INTO daily_quiz_sends (day) VALUES ($1::date) ON CONFLICT (day) DO NOTHING", [day]);
    mark = await markOf();
  }
  if (!mark || mark.finished) return 0;

  const reward = await getSetting(DQ_REWARD_KEY);
  const send = deps.send ?? sendUserDm;
  const limiter = deps.limiter ?? processLimiter();
  const batchSize = Math.max(1, Math.floor(deps.batch ?? SEND_BATCH));
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budgetMs = deps.budgetMs ?? SEND_TICK_BUDGET_MS;
  let sentTotal = 0;

  for (;;) {
    const cur = await queryOne<{ last_user_id: string }>("SELECT last_user_id::text AS last_user_id FROM daily_quiz_sends WHERE day = $1::date", [day]);
    if (!cur) return sentTotal;
    const batch = await query<Recipient>(NEXT_BATCH_SQL, [cur.last_user_id, day, batchSize]);

    if (batch.length === 0) {
      // 4. FINISH: nobody is left after the cursor.
      await query("UPDATE daily_quiz_sends SET finished_at = now() WHERE day = $1::date AND finished_at IS NULL", [day]);
      log("info", "[daily-quiz] yuborish tugadi", { day });
      return sentTotal;
    }

    // 2. Move the cursor first (compare-and-set): another run that advanced it already owns this batch.
    const moved = await query(
      "UPDATE daily_quiz_sends SET last_user_id = $3::bigint WHERE day = $1::date AND last_user_id = $2::bigint AND finished_at IS NULL RETURNING day",
      [day, cur.last_user_id, batch[batch.length - 1]!.id],
    );
    if (moved.length === 0) return sentTotal;

    // 3. Send, paced.
    let sent = 0;
    for (const r of batch) {
      await limiter.acquire();
      const target: DmTarget = { userId: r.id, telegramId: r.telegram_id, language: r.language };
      const out = await send(target, (lang) => inviteScreen(lang, reward));
      if (out === "sent") sent++;
    }
    sentTotal += sent;
    if (sent > 0) await query("UPDATE daily_quiz_sends SET sent = sent + $2 WHERE day = $1::date", [day, sent]);

    if (clock() - started >= budgetMs) return sentTotal;
  }
}
