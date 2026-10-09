import "server-only";
import { query } from "./db";

/**
 * Can the bot still write to this user? (docs/bonus/BONUS3.md C-Q5, migration 046
 * `users.bot_blocked_at`.)
 *
 * SET   — the broadcast engine got a permanent «blocked» / «deactivated» refusal, or Telegram sent a
 *         private-chat `my_chat_member` update with status `kicked` (the user blocked the bot);
 * CLEAR — the user sent `/start` (they are talking to the bot again), or a private-chat
 *         `my_chat_member` update shows `member` (they unblocked it).
 * Broadcast audiences skip users with `bot_blocked_at` set (`admin-broadcasts.ts audienceWhere`),
 * so one blocked chat costs one failed send, not one per broadcast.
 *
 * The production webhook's `allowed_updates` must name `my_chat_member`, or only /start clears the flag.
 */

/** Marks the user unreachable (first time only: the original timestamp is kept). */
export async function markBotBlocked(by: { userId: string } | { telegramId: string }): Promise<void> {
  if ("userId" in by) await query("UPDATE users SET bot_blocked_at = now() WHERE id = $1 AND bot_blocked_at IS NULL", [by.userId]);
  else await query("UPDATE users SET bot_blocked_at = now() WHERE telegram_id = $1 AND bot_blocked_at IS NULL", [by.telegramId]);
}

/** The user can be written to again. */
export async function clearBotBlocked(by: { userId: string } | { telegramId: string }): Promise<void> {
  if ("userId" in by) await query("UPDATE users SET bot_blocked_at = NULL WHERE id = $1 AND bot_blocked_at IS NOT NULL", [by.userId]);
  else await query("UPDATE users SET bot_blocked_at = NULL WHERE telegram_id = $1 AND bot_blocked_at IS NOT NULL", [by.telegramId]);
}

/** Telegram's `my_chat_member` (the bot's own membership changed in some chat). */
export type MyChatMemberUpdate = {
  chat: { id: number; type?: string };
  from?: { id: number; is_bot?: boolean };
  old_chat_member?: { status?: string };
  new_chat_member?: { status?: string };
};

/**
 * Only the PRIVATE chat matters here: `kicked` = the user blocked the bot, `member` = they unblocked it
 * (or started it). Groups / channels (the bot added or removed) are not about a user's reachability.
 * Returns what was done, for tests.
 */
export async function handleMyChatMember(u: MyChatMemberUpdate): Promise<"blocked" | "unblocked" | "ignored"> {
  if (u.chat?.type !== "private" || !Number.isSafeInteger(u.chat.id)) return "ignored";
  const status = u.new_chat_member?.status;
  const telegramId = String(u.chat.id);
  if (status === "kicked" || status === "left") {
    await markBotBlocked({ telegramId });
    return "blocked";
  }
  if (status === "member") {
    await clearBotBlocked({ telegramId });
    return "unblocked";
  }
  return "ignored";
}
