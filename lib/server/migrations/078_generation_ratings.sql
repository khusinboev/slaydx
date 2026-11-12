-- Work ratings (owner request 2026-11-12, docs/ratings/GENERATION-RATING.md): the owner of a COMPLETED generation rates
-- THAT work with 1-5 stars (bot «⭐ Baholash» under the file message, or the web API). No bonus is paid for it; the admin
-- reads the averages per tool. A different feature from the APP rating of 053 (app_ratings), whose rules stay as they are.
--
--   generation_ratings  one row per (generation, user): a re-rate updates the row, the last value wins.
--     stars       1-5.
--     reason      what was wrong, from a fixed set (only for 1-3 stars; lib/generation-rating.ts RATING_REASONS).
--     comment     optional free text from the web (<= 500 characters); the bot never writes one.
--     source      where the current value was given: 'bot' | 'web'.
--     created_at  the first rating; updated_at  the current value (the admin windows read this one).
--   generation_ratings_created_idx  newest first (as asked by the plan).
--   generation_ratings_updated_idx  the admin summary window (`updated_at` range) and its latest-low list.
--   generation_ratings_user_idx     the user's ON DELETE CASCADE (the primary key starts with generation_id).
--
-- Ownership (a user rates only their OWN generation) and «only COMPLETED» are enforced in the service's SQL
-- (lib/server/generation-ratings.ts: INSERT ... SELECT ... WHERE g.id = $1 AND g.user_id = $2 AND g.status = 'COMPLETED').
--
-- Additive only: one new table, its CHECK constraints and indexes; nothing existing changes.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS generation_ratings;
--   DELETE FROM schema_migrations WHERE name = '078_generation_ratings.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS generation_ratings (
  generation_id  UUID         NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  user_id        BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars          SMALLINT     NOT NULL,
  reason         TEXT,
  comment        TEXT,
  source         TEXT         NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'generation_ratings'::regclass AND conname = 'generation_ratings_stars_check') THEN
    ALTER TABLE generation_ratings ADD CONSTRAINT generation_ratings_stars_check CHECK (stars BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'generation_ratings'::regclass AND conname = 'generation_ratings_reason_check') THEN
    ALTER TABLE generation_ratings ADD CONSTRAINT generation_ratings_reason_check
      CHECK (reason IS NULL OR (reason IN ('design', 'images', 'text', 'errors', 'other') AND stars <= 3));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'generation_ratings'::regclass AND conname = 'generation_ratings_comment_check') THEN
    ALTER TABLE generation_ratings ADD CONSTRAINT generation_ratings_comment_check CHECK (comment IS NULL OR char_length(comment) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'generation_ratings'::regclass AND conname = 'generation_ratings_source_check') THEN
    ALTER TABLE generation_ratings ADD CONSTRAINT generation_ratings_source_check CHECK (source IN ('bot', 'web'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS generation_ratings_created_idx ON generation_ratings (created_at DESC);
CREATE INDEX IF NOT EXISTS generation_ratings_updated_idx ON generation_ratings (updated_at DESC);
CREATE INDEX IF NOT EXISTS generation_ratings_user_idx ON generation_ratings (user_id);
