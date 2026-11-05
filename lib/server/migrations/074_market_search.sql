-- «Ishlar bozori» search (docs/market/PLAN.md §8.2).
--
-- market_items.search_tsv: generated tsvector of the normalised Latin `search_text`, config 'simple' (Uzbek has no
--   stemmer in Postgres and the text is already normalised by `lib/market/normalize.ts`).
-- market_items_search_idx: GIN over search_tsv, the catalog FTS.
-- pg_trgm + market_items_topic_trgm_idx: the fuzzy fallback when FTS returns < 3 rows. Where the extension cannot be
--   created this migration only raises a NOTICE and the market stays FTS-only (the server detects it once at boot).
--
-- Additive only: one generated column on the new table (empty at this point), indexes, an optional extension.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS market_items_topic_trgm_idx;
--   DROP INDEX IF EXISTS market_items_search_idx;
--   ALTER TABLE market_items DROP COLUMN IF EXISTS search_tsv;
--   DELETE FROM schema_migrations WHERE name = '074_market_search.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE market_items ADD COLUMN IF NOT EXISTS search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED;
CREATE INDEX IF NOT EXISTS market_items_search_idx ON market_items USING GIN (search_tsv);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'pg_trgm: not created (role is not allowed to create extensions); market search stays FTS-only';
    END;
  ELSE
    RAISE NOTICE 'pg_trgm: extension is not available on this server; market search stays FTS-only';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS market_items_topic_trgm_idx ON market_items USING GIN (topic_norm gin_trgm_ops);
  END IF;
END
$$;
