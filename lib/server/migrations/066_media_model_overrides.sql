-- Studio P1 (docs/studio/P1-SPEC.md «Admin»): the admin's per-model switch and markup for the media catalog.
--
-- media_model_overrides: one row per catalog model the admin touched (lib/server/media/overrides.ts).
--   model_id    catalog id (`google/nano-banana`, lib/media/catalog.ts); an id the code no longer knows is ignored.
--   enabled     FALSE hides the model from the Studio picker and the route refuses it (400 before any charge);
--               NULL / no row = on. Availability also needs the provider switched on and keyed
--               (lib/server/media/availability.ts — the catalog endpoint and the route read the same function).
--   markup      price = provider cost × this markup (rounded up to 100 so'm); NULL = the global `media.markup` setting.
--               Bounded 1–20 like the setting: never below cost, never absurd.
--   updated_by  admin_accounts.id of the last writer (the audit row holds the full before/after and the reason).
-- Writes go through the admin «Narxlar» page only (adminHandler + step-up + reason + audit in the same transaction).
--
-- Two indexes for the leader's housekeeping on media_jobs (M5, lib/server/media/jobs.ts):
--   media_jobs_submitting_idx  partial, rows still 'submitting' — the per-tick «stuck > 1 h» sweep reads only these;
--   media_jobs_created_idx     the 90-day retention DELETE (batched, oldest first).
--
-- Additive only: one new table and two new indexes, nothing existing changes.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS media_jobs_created_idx;
--   DROP INDEX IF EXISTS media_jobs_submitting_idx;
--   DROP TABLE IF EXISTS media_model_overrides;
--   DELETE FROM schema_migrations WHERE name = '066_media_model_overrides.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS media_model_overrides (
  model_id    TEXT          PRIMARY KEY CHECK (length(model_id) BETWEEN 1 AND 80),
  enabled     BOOLEAN,
  markup      NUMERIC(6, 3) CHECK (markup IS NULL OR markup BETWEEN 1 AND 20),
  updated_by  BIGINT        REFERENCES admin_accounts(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_jobs_submitting_idx ON media_jobs (created_at) WHERE status = 'submitting';
CREATE INDEX IF NOT EXISTS media_jobs_created_idx ON media_jobs (created_at);
