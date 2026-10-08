-- Index of bonus channel claims by channel (docs/bonus/PLAN.md, review fixes 2026-10-08).
--
--   bonus_channel_claims_channel_idx  the claims PK is (user_id, channel_id), so every per-channel
--                                     read scanned the whole table: the admin «Bonus kanallar»
--                                     stats (GROUP BY channel_id), the channel delete check
--                                     (count by channel_id) and the FK's ON DELETE CASCADE.
--
-- Additive only: one index, no table or column change, compatible with old code. Plain
-- `CREATE INDEX` (migrations run in a transaction); the table is small, so it builds in
-- milliseconds. `lock_timeout` keeps it from queueing behind a long transaction.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS bonus_channel_claims_channel_idx;
--   DELETE FROM schema_migrations WHERE name = '043_bonus_claims_channel_idx.sql';
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS bonus_channel_claims_channel_idx ON bonus_channel_claims (channel_id);
