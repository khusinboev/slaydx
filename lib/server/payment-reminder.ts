import "server-only";
import { query } from "./db";
import { env } from "./env";
import { sendUserDm } from "./bot-dm";
import { t, type Lang } from "./bot/i18n";
import { appUrl, esc, inlineButton, isPublicHttps, rows, type Screen } from "./bot/ui";

/**
 * «To'lovingiz yakunlanmadi» (owner request 2026-10-22, migration 051): a Click order that stayed
 * unpaid for 5 minutes gets ONE bot message with a support button and «Qayta to'lash». Called by the
 * leader-only `payment-reminder` housekeeping step every tick.
 */
export const REMIND_AFTER_MIN = 5;
/** Older orders are abandoned, not "just left the checkout": never message about them. */
export const REMIND_WINDOW_MIN = 60;
const BATCH = 50;

type Claimed = { user_id: string; telegram_id: string; language: string | null };

/**
 * Claims up to BATCH due orders atomically (`reminded_at = now()` in the same statement, SKIP LOCKED so
 * two workers never take the same row) and returns who to message. The claim happens BEFORE the send:
 * at-most-once, a crash never produces a second reminder.
 */
async function claimDue(): Promise<Claimed[]> {
  return query<Claimed>(
    `UPDATE payment_orders o SET reminded_at = now()
      FROM users u
      WHERE u.id = o.user_id
        AND o.id IN (
          SELECT p.id FROM payment_orders p
            JOIN users pu ON pu.id = p.user_id
           WHERE p.provider = 'click'
             AND p.state IN ('created', 'pending')
             AND p.reminded_at IS NULL
             AND p.created_at <= now() - make_interval(mins => $1::int)
             AND p.created_at >  now() - make_interval(mins => $2::int)
             AND pu.telegram_id IS NOT NULL
             AND pu.bot_blocked_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM payment_orders l
                WHERE l.user_id = p.user_id AND l.state = 'paid' AND l.created_at > p.created_at)
           ORDER BY p.created_at
           LIMIT ${BATCH}
           FOR UPDATE OF p SKIP LOCKED)
      RETURNING o.user_id::text AS user_id, u.telegram_id::text AS telegram_id, u.language AS language`,
    [REMIND_AFTER_MIN, REMIND_WINDOW_MIN],
  );
}

/** The reminder message: text, «support» url button and «Qayta to'lash» (wallet in the Mini App). */
export function paymentReminderScreen(lang: Lang): Screen {
  const wallet = appUrl("/uz/wallet");
  const support = env.supportUrl;
  return {
    text: esc(t(lang, "payReminder.text")),
    reply_markup: rows(
      [support && isPublicHttps(support) ? inlineButton("support", t(lang, "payReminder.help"), { url: support }) : null],
      [wallet ? inlineButton("card", t(lang, "payReminder.retry"), { web_app: { url: wallet } }, "primary") : null],
    ),
  };
}

/** One tick: returns how many reminders were accepted by Telegram. */
export async function remindUnpaidOrders(): Promise<number> {
  const due = await claimDue();
  let sent = 0;
  for (const d of due) {
    const r = await sendUserDm({ userId: d.user_id, telegramId: d.telegram_id, language: d.language }, paymentReminderScreen);
    if (r === "sent") sent++;
  }
  return sent;
}
