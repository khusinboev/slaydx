-- Remove admin phone numbers from user-visible ledger notes (docs/admin/02-plan.md
-- §5.4, analysis finding A1, plan §16 Q12).
--
-- The legacy admin wallet adjustment (`lib/server/credits.ts adminAdjustWallet`,
-- called from `app/api/admin/users/[id]/route.ts`) wrote
--   transactions.note = 'admin:<phone>' or 'admin:<userId>', plus ': <free text>'
-- and that note is shown to the user in their history, leaking the admin's
-- phone. This migration:
--   1. copies each such row into admin_audit_log (admin_id NULL = migration,
--      action 'legacy.wallet_adjust', target the user, at = the original
--      created_at, meta = {transaction_id, original_note}), so the actor is
--      kept in the audit trail;
--   2. rewrites the note to the neutral "Ma'muriy tuzatish", keeping the
--      admin's free text as "Ma'muriy tuzatish: <text>" when there is any.
-- A note is only rewritten when its audit copy exists (same transaction), so
-- the original text can never be lost.
--
-- Idempotent: step 1 skips transactions that already have a legacy audit row
-- and step 2 only matches notes that still start with 'admin:<digits>'. Notes
-- written by the new admin code never match. The NOT EXISTS lookup has no
-- index on meta, which is fine for the handful of admin rows involved.
--
-- ROLLBACK (restores the original notes from the audit copies; the audit rows
-- stay because the log is append-only, and re-applying 031 reuses them):
--   UPDATE transactions t
--      SET note = a.meta->>'original_note'
--     FROM admin_audit_log a
--    WHERE a.action = 'legacy.wallet_adjust'
--      AND a.meta->>'transaction_id' = t.id::text
--      AND t.kind IN ('admin_credit', 'admin_debit')
--      AND t.note LIKE 'Ma''muriy tuzatish%';
--   DELETE FROM schema_migrations WHERE name = '031_admin_legacy_notes.sql';
SET LOCAL lock_timeout = '5s';

INSERT INTO admin_audit_log (at, admin_id, action, target_type, target_id, outcome, meta)
SELECT t.created_at,
       NULL,
       'legacy.wallet_adjust',
       'user',
       t.user_id::text,
       'ok',
       jsonb_build_object('transaction_id', t.id::text, 'original_note', t.note)
  FROM transactions t
 WHERE t.kind IN ('admin_credit', 'admin_debit')
   AND t.note ~ '^admin:\+?[0-9]+(: |$)'
   AND NOT EXISTS (
         SELECT 1 FROM admin_audit_log a
          WHERE a.action = 'legacy.wallet_adjust'
            AND a.meta->>'transaction_id' = t.id::text)
 ORDER BY t.id;

-- `.` matches newlines here (Postgres AREs are not newline-sensitive by
-- default), so multi-line admin text is kept whole.
UPDATE transactions t
   SET note = CASE
                WHEN btrim(substring(t.note FROM '^admin:\+?[0-9]+: (.*)$'), E' \t\r\n') <> ''
                  THEN 'Ma''muriy tuzatish: ' || substring(t.note FROM '^admin:\+?[0-9]+: (.*)$')
                ELSE 'Ma''muriy tuzatish'
              END
 WHERE t.kind IN ('admin_credit', 'admin_debit')
   AND t.note ~ '^admin:\+?[0-9]+(: |$)'
   AND EXISTS (
         SELECT 1 FROM admin_audit_log a
          WHERE a.action = 'legacy.wallet_adjust'
            AND a.meta->>'transaction_id' = t.id::text);
