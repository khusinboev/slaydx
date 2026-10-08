import { query } from "../db";
import { isProfileField, type ProfileField } from "../../profile/fields";

/**
 * Per-chat input state (`bot_chat_state`, migration 038): which profile field
 * the bot is waiting for after «Kafedra»-style prompts, and when the main
 * keyboard was last sent.
 *
 * Replay safety (the webhook may redeliver an update after a transient
 * failure, `telegram.ts handleUpdate`): the pending value is CLAIMED with the
 * update id, and only a claim by the same update id can be re-taken. So a
 * redelivered answer saves again (idempotent — an unchanged value writes
 * nothing) and re-sends «Saqlandi», while no other message can steal it.
 */

export const INPUT_TTL_MINUTES = 10;
/** «Profilim» re-sends the keyboard (fresh personal links, 7-day tokens) when older than this. */
export const KEYBOARD_REFRESH_DAYS = 3;
/** Keyboards sent before this moment have an older layout and are re-sent on the next tap (owner layout 2026-10-08). */
export const KEYBOARD_LAYOUT_SINCE = "2026-10-08T12:00:00Z";

export type PendingInput = { field: ProfileField; promptMessageId: number | null };

/** Waits for `field` in `chatId` (replaces any earlier pending field), prompt shown in `messageId`. */
export async function startInput(chatId: number, userId: string, field: ProfileField, messageId: number | null): Promise<void> {
  await query(
    `INSERT INTO bot_chat_state (chat_id, user_id, field, prompt_message_id, expires_at, claimed_update, updated_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5), NULL, now())
     ON CONFLICT (chat_id) DO UPDATE
        SET user_id = EXCLUDED.user_id, field = EXCLUDED.field, prompt_message_id = EXCLUDED.prompt_message_id,
            expires_at = EXCLUDED.expires_at, claimed_update = NULL, updated_at = now()`,
    [chatId, userId, field, messageId, INPUT_TTL_MINUTES],
  );
}

/**
 * Atomically takes the pending field for message `updateId` of `userId`.
 * `null`: nothing pending, expired, another user's state, or already taken by
 * a different update.
 */
export async function claimInput(chatId: number, userId: string, updateId: number): Promise<PendingInput | null> {
  const rows = await query<{ field: string; prompt_message_id: string | null }>(
    `UPDATE bot_chat_state
        SET claimed_update = $3, updated_at = now()
      WHERE chat_id = $1 AND user_id = $2 AND field IS NOT NULL AND expires_at > now()
        AND (claimed_update IS NULL OR claimed_update = $3)
      RETURNING field, prompt_message_id::text AS prompt_message_id`,
    [chatId, userId, updateId],
  );
  const r = rows[0];
  if (!r || !isProfileField(r.field)) return null;
  return { field: r.field, promptMessageId: r.prompt_message_id === null ? null : Number(r.prompt_message_id) };
}

/** An invalid answer: keep waiting (fresh 10 min) on the new prompt message, open for the next update. */
export async function repromptInput(chatId: number, updateId: number, messageId: number | null): Promise<void> {
  await query(
    `UPDATE bot_chat_state
        SET claimed_update = NULL, prompt_message_id = COALESCE($3, prompt_message_id),
            expires_at = now() + make_interval(mins => $4), updated_at = now()
      WHERE chat_id = $1 AND claimed_update = $2`,
    [chatId, updateId, messageId, INPUT_TTL_MINUTES],
  );
}

/** The value was saved and confirmed: nothing pending any more. */
export async function finishInput(chatId: number, updateId: number): Promise<void> {
  await query(
    `UPDATE bot_chat_state
        SET field = NULL, prompt_message_id = NULL, expires_at = NULL, claimed_update = NULL, updated_at = now()
      WHERE chat_id = $1 AND claimed_update = $2`,
    [chatId, updateId],
  );
}

/** Drops a pending field (cancel, a command, a keyboard button); returns what was pending. */
export async function cancelInput(chatId: number): Promise<PendingInput | null> {
  const rows = await query<{ field: string; prompt_message_id: string | null }>(
    `UPDATE bot_chat_state s
        SET field = NULL, prompt_message_id = NULL, expires_at = NULL, claimed_update = NULL, updated_at = now()
       FROM (SELECT chat_id, field, prompt_message_id FROM bot_chat_state WHERE chat_id = $1 FOR UPDATE) old
      WHERE s.chat_id = old.chat_id AND old.field IS NOT NULL
      RETURNING old.field AS field, old.prompt_message_id::text AS prompt_message_id`,
    [chatId],
  );
  const r = rows[0];
  if (!r || !isProfileField(r.field)) return null;
  return { field: r.field, promptMessageId: r.prompt_message_id === null ? null : Number(r.prompt_message_id) };
}

/** Records that the main keyboard was just sent to this chat. */
export async function markKeyboard(chatId: number, userId: string): Promise<void> {
  await query(
    `INSERT INTO bot_chat_state (chat_id, user_id, keyboard_at, updated_at) VALUES ($1, $2, now(), now())
     ON CONFLICT (chat_id) DO UPDATE SET user_id = EXCLUDED.user_id, keyboard_at = now(), updated_at = now()`,
    [chatId, userId],
  );
}

/** Whether the keyboard (and its personal links) should be re-sent. */
export async function keyboardStale(chatId: number): Promise<boolean> {
  const rows = await query<{ fresh: boolean }>(
    `SELECT keyboard_at > now() - make_interval(days => $2) AND keyboard_at > $3::timestamptz AS fresh FROM bot_chat_state WHERE chat_id = $1`,
    [chatId, KEYBOARD_REFRESH_DAYS, KEYBOARD_LAYOUT_SINCE],
  );
  return !rows[0]?.fresh;
}
