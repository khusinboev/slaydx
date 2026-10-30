-- Paynet shared with Bandlik.uz (vakant3): ONE Paynet service, payers `vk-…` belong to Bandlik (docs/payments/PAYNET.md «Shared service»).
-- This table makes ONE system the owner of every Paynet `transactionId`: the PRIMARY KEY is claimed atomically BEFORE a vk- Perform is relayed
-- (target 'vakant') and inside the transaction that credits a SlaydX payer (target 'slaydx'), so one Paynet payment can never be credited in both
-- systems, and the payer-less Check / Cancel of the same id follow the claim. Written only when PAYNET_SHARED_WITH_VAKANT is on. Additive.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS paynet_routes;
--   DELETE FROM schema_migrations WHERE name = '061_paynet_routes.sql';
CREATE TABLE IF NOT EXISTS paynet_routes (
  transaction_id BIGINT PRIMARY KEY,
  target         TEXT NOT NULL CHECK (target IN ('vakant', 'slaydx')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
