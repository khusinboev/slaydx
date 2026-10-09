import type { PoolClient } from "pg";
import { query } from "../db";
import type { BroadcastContent } from "../broadcast-content";
import type { BotAdminStatus } from "../admin-bonus-channels";
import type { AudienceCode, ChannelType } from "./admin-codes";

/**
 * Admin flow state per private chat (`bot_admin_state`, migration 044): the
 * pending input (`step`), the draft being prepared and the bot step-up time.
 * Never holds permissions — the account and role are re-read on every update.
 *
 * Replay safety (same rule as `state.ts`): a pending input is CLAIMED with the
 * update id; only a claim by the same update id can be re-taken, so a
 * Telegram redelivery repeats the step while no other message can steal it.
 * A row of another admin account (an account re-linked to the chat) is
 * ignored and overwritten.
 */

export const ADMIN_STATE_TTL_MINUTES = 10;
/** The bot step-up window (2FA mode), as the web's `ADMIN_REAUTH_MIN`. */
export const BOT_REAUTH_MINUTES = 10;

export type Step = "bc_msg" | "bc_btn" | "ch_ref" | "pb_val" | "totp";
const STEPS: readonly Step[] = ["bc_msg", "bc_btn", "ch_ref", "pb_val", "totp"];

export type BroadcastDraft = {
  t: "bc";
  text: string;
  content: BroadcastContent;
  audience?: AudienceCode;
  /** The draft broadcast row once created (lazily: at the first test or at the send). */
  broadcastId?: string;
};

export type ChannelDraft = {
  t: "ch";
  chatId: string;
  title: string;
  username: string | null;
  botAdmin: BotAdminStatus;
  /** «🔒 Majburiy» / «➕ Ixtiyoriy» (C-Q2); absent until picked (a draft from before is optional). */
  mandatory?: boolean;
  type?: ChannelType;
};

/** Nothing prepared (only a step-up `resume` to remember). */
export type NoDraft = { t: "none" };

export type Draft = (BroadcastDraft | ChannelDraft | NoDraft) & {
  /** 2FA mode: the confirm button that asked for the code; re-run after a valid code. */
  resume?: string;
};

export type AdminState = {
  adminId: string;
  /** Pending input, `null` when nothing is awaited (or it expired). */
  step: Step | null;
  draft: Draft | null;
  promptMessageId: number | null;
  reauthFresh: boolean;
};

type Row = {
  admin_id: string;
  step: string | null;
  draft: Draft | null;
  prompt_message_id: string | null;
  live: boolean;
  reauth_fresh: boolean;
};

/** The chat's state for `adminId` (an expired one reads as empty; another admin's row as none). */
export async function readState(chatId: number, adminId: string): Promise<AdminState> {
  const rows = await query<Row>(
    `SELECT admin_id::text AS admin_id, step, draft, prompt_message_id::text AS prompt_message_id,
            (expires_at IS NOT NULL AND expires_at > now()) AS live,
            (reauth_at IS NOT NULL AND reauth_at > now() - make_interval(mins => $2)) AS reauth_fresh
       FROM bot_admin_state WHERE chat_id = $1`,
    [chatId, BOT_REAUTH_MINUTES],
  );
  const r = rows[0];
  if (!r || r.admin_id !== adminId) return { adminId, step: null, draft: null, promptMessageId: null, reauthFresh: false };
  const step = r.live && r.step && (STEPS as readonly string[]).includes(r.step) ? (r.step as Step) : null;
  return {
    adminId,
    step,
    draft: r.live ? r.draft : null,
    promptMessageId: r.prompt_message_id === null ? null : Number(r.prompt_message_id),
    reauthFresh: Boolean(r.reauth_fresh),
  };
}

/**
 * Writes the flow state (fresh 10 minutes, claim cleared). `step` null = no
 * pending input; `draft` null = nothing prepared. The step-up time is kept
 * unless the row belonged to another admin.
 */
export async function writeState(
  chatId: number,
  adminId: string,
  s: { step: Step | null; draft: Draft | null; promptMessageId?: number | null },
): Promise<void> {
  await query(
    `INSERT INTO bot_admin_state (chat_id, admin_id, step, draft, prompt_message_id, expires_at, claimed_update, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, now() + make_interval(mins => $6), NULL, now())
     ON CONFLICT (chat_id) DO UPDATE
        SET step = EXCLUDED.step, draft = EXCLUDED.draft, prompt_message_id = EXCLUDED.prompt_message_id,
            expires_at = EXCLUDED.expires_at, claimed_update = NULL, updated_at = now(),
            reauth_at = CASE WHEN bot_admin_state.admin_id = EXCLUDED.admin_id THEN bot_admin_state.reauth_at END,
            admin_id = EXCLUDED.admin_id`,
    [chatId, adminId, s.step, s.draft === null ? null : JSON.stringify(s.draft), s.promptMessageId ?? null, ADMIN_STATE_TTL_MINUTES],
  );
}

/** Drops the pending input AND the draft (cancel, close, a command, a keyboard button). */
export async function clearState(chatId: number): Promise<void> {
  await query(
    `UPDATE bot_admin_state SET step = NULL, draft = NULL, prompt_message_id = NULL, expires_at = NULL, claimed_update = NULL, updated_at = now()
      WHERE chat_id = $1`,
    [chatId],
  );
}

/** Drops only a pending input (the profile flow took over the chat); the draft stays. */
export async function dropPendingStep(chatId: number): Promise<void> {
  await query(`UPDATE bot_admin_state SET step = NULL, claimed_update = NULL, updated_at = now() WHERE chat_id = $1 AND step IS NOT NULL`, [chatId]);
}

/** Whether the chat awaits an admin input right now (one PK read; no account check). */
export async function hasPendingStep(chatId: number): Promise<boolean> {
  const rows = await query<{ x: number }>(
    "SELECT 1 AS x FROM bot_admin_state WHERE chat_id = $1 AND step IS NOT NULL AND expires_at > now()",
    [chatId],
  );
  return rows.length > 0;
}

/** Atomically takes the pending input for update `updateId` of `adminId`; `false` when none or taken by another update. */
export async function claimStep(chatId: number, adminId: string, updateId: number): Promise<boolean> {
  const rows = await query<{ x: number }>(
    `UPDATE bot_admin_state SET claimed_update = $3, updated_at = now()
      WHERE chat_id = $1 AND admin_id = $2 AND step IS NOT NULL AND expires_at > now()
        AND (claimed_update IS NULL OR claimed_update = $3)
      RETURNING 1 AS x`,
    [chatId, adminId, updateId],
  );
  return rows.length > 0;
}

/** An invalid answer: keep waiting (fresh 10 min), open for the next update. */
export async function releaseStep(chatId: number, updateId: number, promptMessageId: number | null): Promise<void> {
  await query(
    `UPDATE bot_admin_state
        SET claimed_update = NULL, prompt_message_id = COALESCE($3, prompt_message_id),
            expires_at = now() + make_interval(mins => $4), updated_at = now()
      WHERE chat_id = $1 AND claimed_update = $2`,
    [chatId, updateId, promptMessageId, ADMIN_STATE_TTL_MINUTES],
  );
}

/** Records a valid bot step-up (inside the TOTP verification transaction). */
export async function markBotReauth(client: Pick<PoolClient, "query">, chatId: number, adminId: string): Promise<void> {
  await client.query(`UPDATE bot_admin_state SET reauth_at = now(), updated_at = now() WHERE chat_id = $1 AND admin_id = $2`, [chatId, adminId]);
}
