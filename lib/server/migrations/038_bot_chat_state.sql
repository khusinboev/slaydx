-- Bot chat state (docs/bot/PLAN.md, package B2): one row per private chat with the bot.
--
--   field              the profile field the bot is waiting for (the user tapped «Kafedra»
--                      and the bot asked for the value); NULL = nothing pending.
--   prompt_message_id  the bot message that shows the prompt (edited back on cancel).
--   expires_at         the prompt is valid 10 minutes; after that the next text is ordinary.
--   claimed_update     the update_id that took the pending value. The claim is atomic
--                      (`UPDATE … WHERE claimed_update IS NULL OR claimed_update = $update`),
--                      so a Telegram redelivery of the SAME update re-takes it (idempotent
--                      replay) while any other message cannot.
--   keyboard_at        when the main reply keyboard (personal WebApp links, 7-day tokens)
--                      was last sent to this chat — «Profilim» refreshes it when stale.
--
-- No PII beyond the Telegram chat id (= the user's Telegram id in a private chat).
-- Additive only: one new table.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS bot_chat_state;
--   DELETE FROM schema_migrations WHERE name = '038_bot_chat_state.sql';

CREATE TABLE IF NOT EXISTS bot_chat_state (
  chat_id            BIGINT PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field              TEXT,
  prompt_message_id  BIGINT,
  expires_at         TIMESTAMPTZ,
  claimed_update     BIGINT,
  keyboard_at        TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_chat_state_user_idx ON bot_chat_state(user_id);
