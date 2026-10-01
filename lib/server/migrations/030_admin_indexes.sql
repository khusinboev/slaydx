-- Indexes behind the admin list endpoints (docs/admin/02-plan.md §5.3, §9).
--
-- Every admin list is keyset-paginated on (sort column, id) and every default
-- sort is backed by one of these indexes; user search uses prefix matching on
-- lower(username)/lower(name), hence `text_pattern_ops`.
--
-- Only indexes: no table or column changes, compatible with old code.
--
-- Locks: plain `CREATE INDEX` (SHARE lock, writes wait while it builds).
-- Migrations run inside a transaction, so `CONCURRENTLY` is impossible here.
-- At today's size this takes milliseconds; on a large database pre-create the
-- same indexes `CONCURRENTLY` by hand (same names) and this file becomes a
-- no-op. `lock_timeout` keeps it from queueing behind a long transaction and
-- stalling traffic (the runner retries).
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS game_sessions_created_idx;
--   DROP INDEX IF EXISTS payment_orders_paid_perform_idx;
--   DROP INDEX IF EXISTS payment_orders_state_created_idx;
--   DROP INDEX IF EXISTS payment_orders_created_idx;
--   DROP INDEX IF EXISTS transactions_kind_created_idx;
--   DROP INDEX IF EXISTS transactions_created_idx;
--   DROP INDEX IF EXISTS generations_tool_created_idx;
--   DROP INDEX IF EXISTS generations_status_created_idx;
--   DROP INDEX IF EXISTS generations_created_idx;
--   DROP INDEX IF EXISTS users_blocked_idx;
--   DROP INDEX IF EXISTS users_name_lower_idx;
--   DROP INDEX IF EXISTS users_username_lower_idx;
--   DROP INDEX IF EXISTS users_created_idx;
--   DELETE FROM schema_migrations WHERE name = '030_admin_indexes.sql';
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS users_created_idx           ON users(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS users_username_lower_idx    ON users(lower(username) text_pattern_ops) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_name_lower_idx        ON users(lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS users_blocked_idx           ON users(id) WHERE is_blocked;
CREATE INDEX IF NOT EXISTS generations_created_idx     ON generations(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS generations_status_created_idx ON generations(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS generations_tool_created_idx   ON generations(tool_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_created_idx    ON transactions(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_kind_created_idx ON transactions(kind, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS payment_orders_created_idx  ON payment_orders(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS payment_orders_state_created_idx ON payment_orders(state, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS payment_orders_paid_perform_idx  ON payment_orders(perform_time) WHERE state = 'paid';
CREATE INDEX IF NOT EXISTS game_sessions_created_idx   ON game_sessions(created_at DESC, id DESC);
