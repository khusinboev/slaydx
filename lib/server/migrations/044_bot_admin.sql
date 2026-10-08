-- In-bot admin panel (docs/bot-admin/PLAN.md). Additive only.
--
-- 1. broadcasts.content — a broadcast composed in the bot keeps the admin's message as is:
--      {kind: 'text'|'photo'|'video', fileId?, entities?, button?: {text, url}, notify?: {chatId, lang}}
--    NULL (every web broadcast) = the historical plain-text path (`text` HTML-escaped at send time).
--    For a rich broadcast `text` holds the message text / caption ('' for a photo or video without one),
--    so the web list and detail keep showing it.
--
-- 2. bot_admin_state — one row per private chat of an admin with the bot: the admin flow's pending
--    input (`step`), its draft (broadcast or channel being prepared), the prompt message, the replay
--    claim (same rule as bot_chat_state: only the update that claimed the input may re-take it) and
--    the bot step-up time (`reauth_at`, 2FA mode only). The admin's permissions are NEVER stored here:
--    they are re-read from admin_accounts on every message and button.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS bot_admin_state;
--   ALTER TABLE broadcasts DROP COLUMN IF EXISTS content;
--   DELETE FROM schema_migrations WHERE name = '044_bot_admin.sql';

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS content JSONB;

CREATE TABLE IF NOT EXISTS bot_admin_state (
  chat_id            BIGINT PRIMARY KEY,
  admin_id           BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  step               TEXT,
  draft              JSONB,
  prompt_message_id  BIGINT,
  expires_at         TIMESTAMPTZ,
  claimed_update     BIGINT,
  reauth_at          TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_admin_state_admin_idx ON bot_admin_state(admin_id);
