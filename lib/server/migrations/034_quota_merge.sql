-- Subscriptions are removed (docs/SUBS-REMOVAL.md §4, owner decisions §7):
-- every user's remaining Pro quota moves into the paid balance, 1 quota coin =
-- 1 balance coin, so no user loses value.
--
-- 1. `transactions_kind_check` is widened with the new kind 'quota_merge'.
--    The full list is 001 ('charge','refund','topup','bonus','subscription')
--    plus 008 ('admin_credit','admin_debit'); no later migration changed it.
--    A separate kind keeps the conversion out of revenue (topup/subscription),
--    admin adjustments (admin_credit/admin_debit) and cash sums. The constraint
--    is added NOT VALID and then validated: the widening is additive, so every
--    existing row passes (inside the migration transaction the ACCESS
--    EXCLUSIVE lock from the ADD is held for the scan anyway; the table is small).
-- 2. Every user with quota > 0 gets exactly ONE ledger row
--    (quota_delta = -q, balance_delta = +q, reference 'quota-merge:<user_id>'),
--    their wallet moves the same amounts, and one admin_audit_log row records
--    it (admin_id NULL = migration, as in 031). Each wallet column therefore
--    still equals the sum of its ledger column (`walletLedgerMismatch` compares
--    all three) and points + quota + balance is unchanged per user.
--    The consumer history shows the row's amount as 0 (quota and balance
--    cancel), so the note carries the sum.
--
-- Concurrency: the source rows are locked FOR UPDATE before they are read, so
-- a charge or refund running on an old container waits for this transaction;
-- `quota = quota - q` (not a literal 0) keeps the ledger row and the wallet in
-- step even so.
--
-- Idempotent: a re-run only sees users that still hold quota AND have no
-- 'quota-merge:<id>' row yet, so it never trips the UNIQUE(kind, reference)
-- index and never merges twice. Quota that reappears after the merge (an old
-- container refunding into quota during the deploy swap) is left for the
-- `admin:merge-quota` sweep, which uses 'quota-merge:<id>:<txid>' references.
-- Safe on a database with no quota holders (every statement touches 0 rows).
--
-- ROLLBACK (run inside one transaction; it aborts as a whole on the balance
-- >= 0 CHECK if a user has already spent the merged coins, in which case the
-- merge must stay). It moves each merged amount back from balance to quota and
-- deletes the 'quota_merge' ledger rows, so the per-column ledger sums match
-- again. admin_audit_log is append-only (028 triggers), so the merge audit rows
-- stay; a compensating 'users.wallet.quota_merge_revert' row is written per
-- reverted user instead (meta.transactionIds lists the deleted ledger rows).
-- Re-applying 034 then merges again with fresh audit rows.
--   CREATE TEMP TABLE quota_merge_revert ON COMMIT DROP AS
--   SELECT user_id, sum(quota_delta) AS quota_delta, sum(balance_delta) AS balance_delta,
--          jsonb_agg(id::text ORDER BY id) AS tx_ids
--     FROM transactions WHERE kind = 'quota_merge' GROUP BY user_id;
--   INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, outcome, reason, before, after, meta)
--   SELECT NULL, 'users.wallet.quota_merge_revert', 'user', r.user_id::text, 'ok', '034 rollback',
--          jsonb_build_object('quota', u.quota, 'balance', u.balance),
--          jsonb_build_object('quota', u.quota - r.quota_delta, 'balance', u.balance - r.balance_delta),
--          jsonb_build_object('via', 'migration 034 rollback', 'transactionIds', r.tx_ids)
--     FROM quota_merge_revert r JOIN users u ON u.id = r.user_id
--    ORDER BY r.user_id;
--   UPDATE users u
--      SET quota = u.quota - r.quota_delta, balance = u.balance - r.balance_delta, updated_at = now()
--     FROM quota_merge_revert r
--    WHERE u.id = r.user_id;
--   DELETE FROM transactions WHERE kind = 'quota_merge';
--   ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
--   ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
--     CHECK (kind IN ('charge', 'refund', 'topup', 'bonus', 'subscription', 'admin_credit', 'admin_debit'));
--   DELETE FROM schema_migrations WHERE name = '034_quota_merge.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
  CHECK (kind IN ('charge', 'refund', 'topup', 'bonus', 'subscription', 'admin_credit', 'admin_debit', 'quota_merge'))
  NOT VALID;
ALTER TABLE transactions VALIDATE CONSTRAINT transactions_kind_check;

WITH src AS (
  SELECT u.id, u.quota AS q
    FROM users u
   WHERE u.quota > 0
     AND NOT EXISTS (
           SELECT 1 FROM transactions t
            WHERE t.kind = 'quota_merge' AND t.reference = 'quota-merge:' || u.id::text)
   ORDER BY u.id
     FOR UPDATE OF u
),
moved AS (
  UPDATE users u
     SET quota = u.quota - s.q, balance = u.balance + s.q, updated_at = now()
    FROM src s
   WHERE u.id = s.id
  RETURNING u.id, s.q, u.quota AS quota_after, u.balance AS balance_after
),
led AS (
  INSERT INTO transactions (user_id, kind, quota_delta, balance_delta, reference, note)
  SELECT m.id, 'quota_merge', -m.q, m.q, 'quota-merge:' || m.id::text,
         'Kvota balansga o''tkazildi: ' || m.q::text || ' tanga'
    FROM moved m
   ORDER BY m.id
  RETURNING id, user_id
)
INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, outcome, reason, before, after, meta)
SELECT NULL, 'users.wallet.quota_merge', 'user', m.id::text, 'ok', 'Obuna olib tashlandi',
       jsonb_build_object('quota', m.quota_after + m.q, 'balance', m.balance_after - m.q),
       jsonb_build_object('quota', m.quota_after, 'balance', m.balance_after),
       jsonb_build_object('via', 'migration 034', 'transactionId', l.id::text)
  FROM moved m
  JOIN led l ON l.user_id = m.id
 ORDER BY m.id;
