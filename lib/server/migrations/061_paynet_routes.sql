-- Paynet shared with Bandlik.uz (vakant3): ONE Paynet service, payers `vk-…` belong to Bandlik (docs/payments/PAYNET.md «Shared service»).
-- A successful PerformTransaction forwarded to Bandlik leaves a route row here, so the follow-up CheckTransaction / CancelTransaction of the
-- same Paynet `transactionId` (which carry no payer) go to Bandlik too. Written only when PAYNET_SHARED_WITH_VAKANT is on. Additive; nothing
-- else reads it.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS paynet_routes;
--   DELETE FROM schema_migrations WHERE name = '061_paynet_routes.sql';
CREATE TABLE IF NOT EXISTS paynet_routes (
  transaction_id BIGINT PRIMARY KEY,
  target         TEXT NOT NULL CHECK (target IN ('vakant')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
