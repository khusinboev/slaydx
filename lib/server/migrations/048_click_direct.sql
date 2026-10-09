-- Click direct payment methods (owner decision 2026-10-09). Additive only.
--
-- A Click order can now be started from our own UI through the Click Merchant API; money is
-- STILL credited only by the Shop API Complete (`settleOrder`) -- these columns just record how
-- the payment was started and let the verify step find its card token.
--
--   payment_orders.click_method      how the user chose to pay: page (my.click.uz page, the fallback),
--                                    card (our card form), phone (invoice to the Click app by phone),
--                                    app (deeplink to the Click app). NULL = created before this migration.
--   payment_orders.click_invoice_id  Merchant API `invoice_id` of the invoice sent for the order.
--   payment_orders.click_card_token  one-time (temporary=1) card token between "SMS sent" and "paid".
--                                    Cleared as soon as the payment is submitted or fails. The card number,
--                                    expiry and SMS code are NEVER stored.
--   payment_orders.click_payment_id  Merchant API `payment_id` of the card payment.
--
-- ROLLBACK:
--   ALTER TABLE payment_orders
--     DROP COLUMN IF EXISTS click_method, DROP COLUMN IF EXISTS click_invoice_id,
--     DROP COLUMN IF EXISTS click_card_token, DROP COLUMN IF EXISTS click_payment_id;
--   DELETE FROM schema_migrations WHERE name = '048_click_direct.sql';
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS click_method TEXT
  CHECK (click_method IN ('page', 'card', 'phone', 'app'));
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS click_invoice_id BIGINT;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS click_card_token TEXT;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS click_payment_id BIGINT;
