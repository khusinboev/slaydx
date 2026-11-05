-- One row per job that ended on a provider's own error (incident 2026-11-05: an outage reached the owner through users).
-- Read by the `provider_fail:<provider>` rule of lib/server/server-alerts.ts and by the admin «Provayderlar» card (the
-- permissions a key was refused). Kept 30 days, deleted by the hourly metrics purge.
--
-- provider_failures.provider:  the provider id the failure came from (`gemini`, `elevenlabs`, ...).
-- provider_failures.signature: groups repeats: `<status>|<normalized text>`, or `missing_permission:<name>`.
-- provider_failures.message:   the first 120 characters of the provider's error, scrubbed of keys. Admin eyes only.
-- provider_failures.job_id:    the generation (no foreign key: a deleted job keeps its failure until the purge).
--
-- Additive only: one new table with two indexes; nothing existing changes.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS provider_failures;
--   DELETE FROM schema_migrations WHERE name = '072_provider_failures.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS provider_failures (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider   TEXT NOT NULL,
  signature  TEXT NOT NULL,
  message    TEXT NOT NULL,
  job_id     TEXT
);
CREATE INDEX IF NOT EXISTS provider_failures_at_idx ON provider_failures (at DESC);
CREATE INDEX IF NOT EXISTS provider_failures_provider_idx ON provider_failures (provider, at DESC);
