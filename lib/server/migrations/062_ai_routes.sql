-- Admin «Provayderlar» redesign: per-purpose routing and free-provider usage counters.
--
-- ai_routes: the admin's choice for ONE routing slot (lib/server/providers/routes.ts is the registry of slots):
--   route        slot id ('llm.writer', 'llm.judge', 'tts.order', ...). No FK: the registry is code.
--   entries      JSON array of {provider, model?} in priority order. Validated by the API against the slot's spec
--                (allowed providers, priced models); the loader re-validates and ignores a row it cannot read.
--   updated_at/by last writer (admin_accounts.id); SET NULL if the admin account is ever deleted.
-- A slot WITHOUT a row keeps today's behaviour (the LLM_*/TTS_* env value, else the built-in default).
--
-- provider_calls: how often the keyless-priced (free) providers were called, per Tashkent day. Paid usage lives in
-- ai_usage; stock photo and research APIs spend no money, so they were invisible. Written best-effort in batches by
-- lib/server/provider-usage.ts (telemetry: a lost increment is acceptable, a failing write never fails a job).
--   day / provider   primary key, provider = registry id ('pexels', 'pixabay', 'openalex', 'googlebooks').
--   calls / errors   requests made and the ones that failed (HTTP error, timeout, quota).
--
-- Additive only: two new tables, no change to existing ones.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS provider_calls;
--   DROP TABLE IF EXISTS ai_routes;
--   DELETE FROM schema_migrations WHERE name = '062_ai_routes.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS ai_routes (
  route       TEXT PRIMARY KEY CHECK (length(route) BETWEEN 1 AND 40),
  entries     JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  CONSTRAINT ai_routes_entries_array CHECK (jsonb_typeof(entries) = 'array' AND jsonb_array_length(entries) BETWEEN 1 AND 8)
);

CREATE TABLE IF NOT EXISTS provider_calls (
  day       DATE   NOT NULL,
  provider  TEXT   NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
  calls     BIGINT NOT NULL DEFAULT 0 CHECK (calls >= 0),
  errors    BIGINT NOT NULL DEFAULT 0 CHECK (errors >= 0),
  PRIMARY KEY (day, provider)
);
