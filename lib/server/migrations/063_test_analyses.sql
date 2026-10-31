-- «Test ishlash»: AI analysis of the wrong answers (owner 2026-10-31), shared cache.
--
-- test_analyses: ONE model explanation per question and answer key, generated the first time any user's finished attempt
-- needs it and then read by everyone (lib/server/test-analysis.ts). The model sees the question image (multimodal call).
--   question_id   the question (CASCADE: a deleted question takes its analysis along).
--   correct       the key (0..3 = A..D) the analysis was written for. A finished attempt reads the analysis of ITS
--                 key_snapshot entry, so a corrected key gets a new analysis and an old result keeps the old one.
--   stem_hash     sha256 of the stem (image sha256 + text + options): a corrected screenshot or text gets a new analysis.
--   status        'pending' (a process holds the lease and is calling the model), 'ready', 'failed' (retryable).
--   explanation   why the correct option is correct (Uzbek, short). NOT NULL when ready.
--   wrong         {"0": "...", "1": "...", ...}: why each OTHER option is wrong, keyed by option index. NOT NULL when ready.
--   model         the model that wrote it (the `tests.analysis` routing slot at that moment).
--   lease_until   while pending: after this moment another process may take the job over (a crashed call).
--   tries         model calls made for this row (telemetry and abuse visibility).
--   error         short reason of the last failure (no secrets: the provider message, clipped).
-- Concurrency: the row is claimed with INSERT ... ON CONFLICT DO UPDATE ... WHERE (failed and cooled down, or lease
-- expired) RETURNING, so two requests for the same key never call the model twice.
--
-- Additive only: one new table, no change to existing ones.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS test_analyses;
--   DELETE FROM schema_migrations WHERE name = '063_test_analyses.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS test_analyses (
  question_id  BIGINT      NOT NULL REFERENCES test_questions(id) ON DELETE CASCADE,
  correct      SMALLINT    NOT NULL CHECK (correct BETWEEN 0 AND 3),
  stem_hash    TEXT        NOT NULL CHECK (stem_hash ~ '^[0-9a-f]{64}$'),
  status       TEXT        NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  explanation  TEXT,
  wrong        JSONB,
  model        TEXT        CHECK (model IS NULL OR length(model) BETWEEN 1 AND 80),
  lease_until  TIMESTAMPTZ,
  tries        INTEGER     NOT NULL DEFAULT 0 CHECK (tries >= 0),
  error        TEXT        CHECK (error IS NULL OR length(error) <= 300),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, correct, stem_hash),
  CONSTRAINT test_analyses_ready_complete CHECK (status <> 'ready' OR (explanation IS NOT NULL AND wrong IS NOT NULL AND jsonb_typeof(wrong) = 'object'))
);
