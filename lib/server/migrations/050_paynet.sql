-- Paynet (UZPAYNET) provider (owner decision 2026-10-16, docs/payments/PAYNET.md).
--
-- A Paynet top-up is a normal payment_orders row (provider 'paynet', purpose 'topup',
-- provider_txn = Paynet's transactionId, state 'paid'), inserted and settled in ONE transaction by
-- lib/server/payments.ts createPaidPaynetOrder. The existing unique index payment_orders_txn_idx
-- (provider, provider_txn) is the idempotency guard for a repeated / concurrent PerformTransaction.
--
--   payment_orders.provider CHECK   widened to include 'paynet' (DROP + ADD: the deploy guard flags it,
--   payment_events.provider CHECK   the owner deploys once with --allow-destructive, like 048).
--   paynet_trn_seq                  source of our numeric providerTrnId.
--   payment_orders.paynet_trn_id    our providerTrnId for the Paynet order (NULL for every other provider).
--   payment_orders_paynet_trn_idx   unique: one providerTrnId per order.
--   payment_orders_paynet_paid_idx  GetStatement: paid Paynet orders by perform_time.
--
-- ROLLBACK (only while no 'paynet' row exists, else the narrowed CHECKs fail):
--   DROP INDEX IF EXISTS payment_orders_paynet_paid_idx;
--   DROP INDEX IF EXISTS payment_orders_paynet_trn_idx;
--   ALTER TABLE payment_orders DROP COLUMN IF EXISTS paynet_trn_id;
--   DROP SEQUENCE IF EXISTS paynet_trn_seq;
--   ALTER TABLE payment_events DROP CONSTRAINT IF EXISTS payment_events_provider_check;
--   ALTER TABLE payment_events ADD CONSTRAINT payment_events_provider_check CHECK (provider IN ('click', 'payme'));
--   ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_provider_check;
--   ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_provider_check CHECK (provider IN ('click', 'payme'));
--   DELETE FROM schema_migrations WHERE name = '050_paynet.sql';
ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_provider_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_provider_check
  CHECK (provider IN ('click', 'payme', 'paynet'));

ALTER TABLE payment_events DROP CONSTRAINT IF EXISTS payment_events_provider_check;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_provider_check
  CHECK (provider IN ('click', 'payme', 'paynet'));

CREATE SEQUENCE IF NOT EXISTS paynet_trn_seq;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS paynet_trn_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_paynet_trn_idx
  ON payment_orders (paynet_trn_id) WHERE paynet_trn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_orders_paynet_paid_idx
  ON payment_orders (perform_time, paynet_trn_id) WHERE provider = 'paynet' AND state = 'paid';
