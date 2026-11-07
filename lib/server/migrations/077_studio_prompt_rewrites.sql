-- Studio package G (docs/studio/P11-SPEC.md «G. Templates and automatic prompts»): «AI yaxshilash» rewrites a job's prompt in
-- the worker, and a rewrite is made and paid for once, whatever happens to the job.
--
-- studio_prompt_rewrites: one row per rewrite, claimed BEFORE the LLM call (lib/server/media/prompt-rewrites.ts).
--   generation_id  the job that claimed it; the row goes with the generation.
--   compare_group  a «Solishtirish» batch shares ONE rewrite: every model of a batch gets the same prompt, or the comparison
--                  would compare prompts. The partial unique index is what makes one member the owner.
--   status         pending = the call is running; done = `prompt` holds the rewrite; failed = no rewrite, the job uses the
--                  user's own prompt. A pending row found by a re-claim is never called again: it waits, then gives up.
--   prompt         the English prompt, before each model's own limits are applied. The user's text stays in
--                  generations.values_json.
--
-- Additive only: one new table and its index, nothing existing changes.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS studio_prompt_rewrites;
--   DELETE FROM schema_migrations WHERE name = '077_studio_prompt_rewrites.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS studio_prompt_rewrites (
  generation_id  UUID         PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
  compare_group  UUID,
  kind           TEXT         NOT NULL CHECK (kind IN ('image', 'video', 'music', 'sfx')),
  status         TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  prompt         TEXT         CHECK (prompt IS NULL OR length(prompt) <= 4000),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_prompt_rewrites_group_idx ON studio_prompt_rewrites (compare_group) WHERE compare_group IS NOT NULL;
