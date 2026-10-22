-- Payment reminder (owner request 2026-10-22, docs/program-17/PLAN.md item 4).
--
--   payment_orders.reminded_at       set (atomically, BEFORE the DM) by the worker's `payment-reminder`
--                                    step the moment it claims an unpaid Click order older than 5 minutes
--                                    for the single «To'lovingiz yakunlanmadi» message. NULL = not yet.
--                                    The backfill stamps every EXISTING row, so the first run never
--                                    messages anyone about an old order.
--   payment_orders_unreminded_idx    partial index for the scan: only unpaid, not yet reminded orders.
--
-- Additive only: one nullable column, one small partial index. `lock_timeout` keeps the DDL from
-- queueing behind a long transaction.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS payment_orders_unreminded_idx;
--   ALTER TABLE payment_orders DROP COLUMN IF EXISTS reminded_at;
--   DELETE FROM schema_migrations WHERE name = '051_payment_reminder.sql';
SET LOCAL lock_timeout = '5s';
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
UPDATE payment_orders SET reminded_at = now() WHERE reminded_at IS NULL;
CREATE INDEX IF NOT EXISTS payment_orders_unreminded_idx
  ON payment_orders (created_at) WHERE reminded_at IS NULL AND state IN ('created', 'pending');
