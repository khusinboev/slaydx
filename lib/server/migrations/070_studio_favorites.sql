-- Studio P7b favourites (docs/studio/P7-SPEC.md «P7b»): the star on a Studio result / gallery item.
--
-- studio_favorites: one row per starred generation of a user. Only the user's OWN finished Studio generations are
--   starred (the app inserts through `SELECT ... FROM generations WHERE id = $2 AND user_id = $1`); the primary key
--   makes a second star a no-op. Both foreign keys cascade: a deleted user or generation takes its stars with it.
--   Free, no count limit; the gallery filter «Sevimlilar» reads it with the owner in the WHERE.
--
-- Additive only: one new table, nothing existing changes.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS studio_favorites;
--   DELETE FROM schema_migrations WHERE name = '070_studio_favorites.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS studio_favorites (
  user_id        BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_id  UUID         NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, generation_id)
);
-- The generation side of the cascade (a deleted generation finds its stars without a scan).
CREATE INDEX IF NOT EXISTS studio_favorites_generation_idx ON studio_favorites (generation_id);
