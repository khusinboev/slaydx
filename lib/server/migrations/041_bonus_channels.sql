-- Bonus tasks: Telegram channel subscriptions (docs/bonus/PLAN.md, owner decisions 2026-10-08).
--
--   bonus_channels         channels managed in the admin panel. `join_bonus` is paid once when the
--                          bot sees the user as a member (getChatMember); `stay_bonus` once more
--                          after `stay_days` days if the user is still a member (worker sweep).
--                          The bot must be an admin of the channel to check membership.
--   bonus_channel_claims   one row per (user, channel): the user can never be paid twice for the
--                          same channel (leaving and re-joining included). Leaving does NOT claw
--                          back a paid bonus (owner decision); it only forfeits an unpaid stay bonus.
--   Money goes through credits.topUpInTx with unique ledger references
--   `channel:<channel_id>:<user_id>:join` / `:stay` (idempotent).
--
-- Additive only.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS bonus_channel_claims;
--   DROP TABLE IF EXISTS bonus_channels;
--   DELETE FROM schema_migrations WHERE name = '041_bonus_channels.sql';
CREATE TABLE IF NOT EXISTS bonus_channels (
  id           BIGSERIAL PRIMARY KEY,
  chat_id      BIGINT NOT NULL UNIQUE,
  username     TEXT,
  title        TEXT NOT NULL,
  join_bonus   INTEGER NOT NULL DEFAULT 0 CHECK (join_bonus >= 0 AND join_bonus <= 1000000),
  stay_bonus   INTEGER NOT NULL DEFAULT 0 CHECK (stay_bonus >= 0 AND stay_bonus <= 1000000),
  stay_days    INTEGER NOT NULL DEFAULT 7 CHECK (stay_days >= 1 AND stay_days <= 365),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bonus_channel_claims (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id   BIGINT NOT NULL REFERENCES bonus_channels(id) ON DELETE CASCADE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  join_paid    INTEGER NOT NULL DEFAULT 0,
  stay_paid    INTEGER,
  stay_checked_at TIMESTAMPTZ,
  left_at      TIMESTAMPTZ,
  PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS bonus_channel_claims_stay_idx
  ON bonus_channel_claims (joined_at) WHERE stay_paid IS NULL AND left_at IS NULL;
