-- Studio P7a «Solishtirish» (docs/studio/P7-SPEC.md): one prompt sent to 2–4 models at once. Every model is an
-- ordinary generation (own charge, own refund); the rows of one compare share a group id.
--
-- generations.compare_group: the compare batch the row belongs to (a UUID made by the app), NULL for every other job.
-- generations.compare_index: the row's place in the batch (0 = the first model ticked), so a replayed request answers
--   the models in the order they were bought. Both are set together or not at all.
-- generations_compare_group_idx: the batch lookup of the idempotent replay (user + group), only over compare rows.
--
-- Additive only: two nullable columns, one CHECK, one partial index; nothing existing changes.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS generations_compare_group_idx;
--   ALTER TABLE generations DROP CONSTRAINT IF EXISTS generations_compare_pair;
--   ALTER TABLE generations DROP COLUMN IF EXISTS compare_index;
--   ALTER TABLE generations DROP COLUMN IF EXISTS compare_group;
--   DELETE FROM schema_migrations WHERE name = '071_studio_compare.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE generations ADD COLUMN IF NOT EXISTS compare_group UUID;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS compare_index SMALLINT;

-- NOT VALID: every existing row has both NULL (true by construction), so the big table is not scanned under the lock;
-- every new or updated row is checked. Added only when missing (no DROP: the deploy guard refuses destructive lines).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'generations'::regclass AND conname = 'generations_compare_pair') THEN
    ALTER TABLE generations ADD CONSTRAINT generations_compare_pair
      CHECK ((compare_group IS NULL) = (compare_index IS NULL) AND (compare_index IS NULL OR compare_index BETWEEN 0 AND 3)) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS generations_compare_group_idx ON generations (user_id, compare_group, compare_index) WHERE compare_group IS NOT NULL;
