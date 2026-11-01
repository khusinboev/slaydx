-- Media engine core (docs/studio/P0-SPEC.md §5): one row per provider operation of every media call.
--
-- media_jobs: written by lib/server/media/jobs.ts for each call the core makes (image, video, speech), sync or async.
--   generation_id    the caller's job (CASCADE: deleting a generation takes its media rows along); NULL for admin probes.
--   purpose          what the caller needed (`rasm.image`, `video.clip`, … lib/media/catalog.ts MEDIA_PURPOSES).
--   model_id         catalog id (`google/nano-banana`); provider + upstream_model = the route actually used.
--   idempotency_key  `<generationId>:<step>:<n>`: a retried step finds its row and never submits a second paid job.
--   op_id            the provider's operation id (async providers); next_poll_at / deadline_at drive the poll loop.
--   status           'submitting' → 'pending' (parked at the provider) → 'succeeded' | 'failed'. Sync calls go straight
--                    from 'submitting' to a final state.
--   params           the normalized parameters (no secrets, no bytes: uploaded inputs are asset ids).
--   cost_usd         the quoted provider cost of this call (the metered spend stays in ai_usage, as before).
--   outputs          [{mime, size, sha256}] of what was stored.
--   last_error       short scrubbed reason of the last failure (no keys: scrubSecrets before writing).
-- The P0 video path writes here instead of video_ops; video_ops stays (additive rule) and drains on its own deadline.
--
-- Additive only: one new table, no change to existing ones. Admin overrides, purpose defaults and provider balances
-- land with the phase that reads them (P1), not before.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS media_jobs;
--   DELETE FROM schema_migrations WHERE name = '065_media_jobs.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS media_jobs (
  -- Id is given by the code (`randomUUID`), the generations rule: no extension-dependent gen_random_uuid().
  id               UUID        PRIMARY KEY,
  generation_id    UUID        REFERENCES generations(id) ON DELETE CASCADE,
  purpose          TEXT        NOT NULL CHECK (length(purpose) BETWEEN 1 AND 60),
  model_id         TEXT        NOT NULL CHECK (length(model_id) BETWEEN 1 AND 80),
  provider         TEXT        NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
  upstream_model   TEXT        NOT NULL CHECK (length(upstream_model) BETWEEN 1 AND 120),
  idempotency_key  TEXT        NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  op_id            TEXT        CHECK (op_id IS NULL OR length(op_id) <= 500),
  status           TEXT        NOT NULL DEFAULT 'submitting' CHECK (status IN ('submitting', 'pending', 'succeeded', 'failed')),
  attempts         INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  errors           INTEGER     NOT NULL DEFAULT 0 CHECK (errors >= 0),
  next_poll_at     TIMESTAMPTZ,
  deadline_at      TIMESTAMPTZ,
  params           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  cost_usd         NUMERIC(12, 6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  outputs          JSONB,
  last_error       TEXT        CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS media_jobs_due_idx ON media_jobs (next_poll_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS media_jobs_generation_idx ON media_jobs (generation_id);
CREATE INDEX IF NOT EXISTS media_jobs_provider_idx ON media_jobs (provider, created_at);
