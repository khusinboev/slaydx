import "server-only";
import { markBotBlocked } from "./bot-reachability";
import { botConfigured, sendMessage, TelegramTransientError } from "./telegram";
import { langOf, type Lang } from "./bot/i18n";
import type { Screen } from "./bot/ui";

/** Who a worker-initiated DM goes to: the row fields every caller already selects. */
export type DmTarget = { userId: string; telegramId: string; language: string | null };

/**
 * Sends ONE bot message to a user in their `users.language` (uz when unknown), for worker features
 * that write first (payment reminder, daily quiz). The caller claims its "already sent" marker
 * BEFORE calling this (at-most-once): nothing here retries.
 *
 *  - "sent"      Telegram accepted it;
 *  - "blocked"   permanent refusal (user blocked the bot / chat gone): `users.bot_blocked_at` is set;
 *  - "transient" network / 429 / 5xx: logged, NOT resent;
 *  - "skipped"   the bot is not configured (nothing was tried, the user is not marked blocked).
 */
export async function sendUserDm(
  target: DmTarget,
  build: (lang: Lang) => Screen,
): Promise<"sent" | "blocked" | "transient" | "skipped"> {
  if (!botConfigured()) return "skipped";
  const screen = build(langOf(target.language));
  try {
    const ok = await sendMessage(target.telegramId, screen.text, screen.reply_markup ? { reply_markup: screen.reply_markup } : {});
    if (ok) return "sent";
    await markBotBlocked({ userId: target.userId });
    return "blocked";
  } catch (e) {
    if (e instanceof TelegramTransientError) {
      console.warn(`[bot-dm] transient failure for user ${target.userId}: ${e.message}`);
      return "transient";
    }
    throw e;
  }
}
