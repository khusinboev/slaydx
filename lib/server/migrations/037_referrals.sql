-- Referral program (docs/todo-2026-10-07/PLAN.md T3, owner decisions D1–D3).
--
--   users.ref_code          the user's own invite code: random, never the Telegram id.
--                           Generated LAZILY (`referrals.ts ensureRefCode`) the first time
--                           a code is needed, so there is no backfill UPDATE that would
--                           hold row locks on every user; NULL until then.
--   login_tickets.ref_code  a web visitor's captured code (`/uz?ref=…` cookie) carried by
--                           the site-started login ticket into the bot's `/start <nonce>`,
--                           where the account is actually created.
--   referrals               who invited whom: one row per invited account, written in the
--                           same transaction that CREATES that account. `reward_ref` is the
--                           ledger reference (`transactions.reference`, kind 'bonus') of the
--                           inviter's reward; 0 points / NULL ref = recorded, not rewarded
--                           (blocked inviter).
--
-- «Never twice» is enforced by the schema as well as the code: `referee_user_id` and
-- `referee_telegram_id` are both UNIQUE, and the invited user's FK is ON DELETE SET NULL
-- so the Telegram-id record survives even if that user row were ever deleted and
-- re-created. The reward itself is idempotent through `transactions_ref_idx`
-- (UNIQUE kind + reference `referral:<referee user id>`).
--
-- Additive only: two nullable columns (metadata-only ALTERs), one small unique index on a
-- column that is entirely NULL at creation, one new table.
--
-- ROLLBACK (reward ledger rows stay: they are real money and keep balance == sum(ledger)):
--   DROP TABLE IF EXISTS referrals;
--   DROP INDEX IF EXISTS users_ref_code_idx;
--   ALTER TABLE users DROP COLUMN IF EXISTS ref_code;
--   ALTER TABLE login_tickets DROP COLUMN IF EXISTS ref_code;
--   DELETE FROM schema_migrations WHERE name = '037_referrals.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_ref_code_idx ON users (ref_code) WHERE ref_code IS NOT NULL;

ALTER TABLE login_tickets ADD COLUMN IF NOT EXISTS ref_code TEXT;

CREATE TABLE IF NOT EXISTS referrals (
  id                  BIGSERIAL PRIMARY KEY,
  -- The invited account. SET NULL (not CASCADE): the row keeps blocking a second
  -- reward through `referee_telegram_id` even without the user row.
  referee_user_id     BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  referee_telegram_id BIGINT NOT NULL UNIQUE,
  referrer_user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source              TEXT NOT NULL CHECK (source IN ('bot', 'web')),
  reward_points       INT NOT NULL DEFAULT 0 CHECK (reward_points >= 0),
  reward_ref          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referrals_not_self CHECK (referee_user_id IS DISTINCT FROM referrer_user_id)
);
-- The inviter's list / counters (`GET /api/referral`, admin) and the 24 h burst count.
CREATE INDEX IF NOT EXISTS referrals_referrer_created_idx ON referrals (referrer_user_id, created_at DESC);
