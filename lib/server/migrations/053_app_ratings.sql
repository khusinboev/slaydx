-- App rating bonus (owner request 2026-10-22, docs/program-17/PLAN.md item 9).
--
-- A user rates the app (1-5 stars) and MUST leave written feedback; the first rating pays a one-time
-- bonus (setting `bonus.rating_points`, default 500) through credits.topUpInTx with the unique ledger
-- reference `rating:<userId>`. lib/server/ratings.ts submitRating does the whole thing in ONE transaction.
--
--   app_ratings            one row per user (PRIMARY KEY user_id => a second rating is impossible, even in a race).
--   app_ratings_created_idx  admin list: newest first.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS app_ratings_created_idx;
--   DROP TABLE IF EXISTS app_ratings;
--   DELETE FROM schema_migrations WHERE name = '053_app_ratings.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS app_ratings (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stars      SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  feedback   TEXT NOT NULL CHECK (length(btrim(feedback)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_ratings_created_idx ON app_ratings (created_at DESC, user_id);
