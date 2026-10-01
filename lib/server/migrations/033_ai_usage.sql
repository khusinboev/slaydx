-- Append-only AI spend records that `generations.cost_json` cannot hold
-- (docs/admin/02-plan.md §17.3, §17.7): failed and abandoned jobs (the cost
-- meter is flushed in `finally`), the free-LLM endpoints and fal images.
--
-- `generation_id` has no FK on purpose: deleting a generation must not erase
-- money already spent. `ai_usage_job_once_idx` makes the per-job flush
-- idempotent (one row per job and outcome).
--
-- Backward compatible: new table only; old code never reads it.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS ai_usage;
--   DELETE FROM schema_migrations WHERE name = '033_ai_usage.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS ai_usage (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  source         TEXT NOT NULL CHECK (source IN ('job','free')),
  outcome        TEXT NOT NULL CHECK (outcome IN ('completed','failed','abandoned','free')),
  generation_id  UUID,            -- no FK: spend survives deletes
  user_id        BIGINT,
  tool_id        TEXT,            -- tool id, or 'free:outline' | 'free:udk' | 'free:rewrite' | 'free:polish'
  calls          INT NOT NULL DEFAULT 0,
  input_tokens   BIGINT NOT NULL DEFAULT 0,
  output_tokens  BIGINT NOT NULL DEFAULT 0,
  usd            NUMERIC(12,6) NOT NULL DEFAULT 0,
  parts          JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS ai_usage_at_idx ON ai_usage(at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_tool_at_idx ON ai_usage(tool_id, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_job_once_idx ON ai_usage(generation_id, outcome) WHERE generation_id IS NOT NULL;
