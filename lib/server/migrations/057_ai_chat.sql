-- AI chat assistant (owner request 8, docs/program-17/PLAN.md item 8).
--
--   chat_conversations  one thread per (user, channel web|bot). `active` is the bot's "chat mode" flag
--                       (/chat sets it, /stop clears it; `last_at` older than 15 minutes also ends it).
--   chat_messages       user / assistant turns. `client_id` is the client's per-send id: the unique index makes a
--                       retried send idempotent (one reply, one charge). `reply_to` links an assistant row to the user
--                       row it answers; `charged_points` is what the user row cost (0 = a free message). `meta` holds
--                       the confirmation card of a proposal (UI history). Rows older than 30 days are purged by the
--                       housekeeping step.
--   chat_proposals      a generation the assistant proposed. Only the SHA-256 of the single-use token is stored
--                       (`token_hash`); `values_hash` binds the token to the exact values; `used_at` is the claim.
--                       The model's text can never confirm a proposal -- only a user tap with the token does.
--
-- Backward compatible: new tables only; old code never reads them.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS chat_proposals;
--   DROP TABLE IF EXISTS chat_messages;
--   DROP TABLE IF EXISTS chat_conversations;
--   DELETE FROM schema_migrations WHERE name = '057_ai_chat.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS chat_conversations (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel    TEXT        NOT NULL CHECK (channel IN ('web', 'bot')),
  active     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_conversations_user_idx ON chat_conversations (user_id, channel, last_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT      NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT        NOT NULL,
  tokens          INTEGER     NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  charged_points  INTEGER     NOT NULL DEFAULT 0 CHECK (charged_points >= 0),
  client_id       TEXT,
  reply_to        BIGINT,
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_conv_idx ON chat_messages (conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS chat_messages_created_idx ON chat_messages (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_idx ON chat_messages (conversation_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_proposals (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  tool          TEXT        NOT NULL,
  values        JSONB       NOT NULL,
  values_hash   TEXT        NOT NULL,
  price         INTEGER     NOT NULL CHECK (price >= 0),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  generation_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_proposals_user_idx ON chat_proposals (user_id, created_at DESC);
