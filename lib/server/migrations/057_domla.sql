-- «Qattiqqo'l domla» (owner request 15, docs/program-17/PLAN.md): a spoken defence of the student's own slides.
--
--   domla_sessions   one defence. `questions` (the LLM's 5 questions + ideal answers) and `answers` (transcript, score
--                    0-5, verdict, mistake per question -- NEVER audio) are JSONB arrays in question order. `asked` is the
--                    number of questions already sent out loud; the question waiting for an answer is `answers[len]`.
--                    `charged_points` is what the start charged (ledger reference `domla:<id>`). `grade` is 2-5, set when
--                    the session finishes. `last_activity_at` drives the 30-minute idle expiry.
--                    A user has at most ONE open ('preparing' / 'active') session: that makes a voice message
--                    unambiguous AND makes a repeated start idempotent (the unique index is the guard, not the app).
--   domla_jobs       the worker's queue for this feature: the webhook only INSERTs a row (fast), the worker does the
--                    LLM / TTS / Gemini-audio work. UNIQUE (session_id, kind, idx) de-duplicates a replayed update.
--                    `payload` holds the Telegram file_id of a voice answer (not the audio); the row is deleted when the
--                    job is done.
--
-- The feature is behind the setting `domla.enabled` (default on); the price is `domla.price`.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS domla_jobs;
--   DROP TABLE IF EXISTS domla_sessions;
--   DELETE FROM schema_migrations WHERE name = '057_domla.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS domla_sessions (
  id                   UUID        PRIMARY KEY,
  user_id              BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_generation_id UUID        REFERENCES generations(id) ON DELETE SET NULL,
  status               TEXT        NOT NULL DEFAULT 'preparing'
                       CHECK (status IN ('preparing', 'active', 'finished', 'expired', 'failed')),
  topic                TEXT        NOT NULL DEFAULT '',
  questions            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  answers              JSONB       NOT NULL DEFAULT '[]'::jsonb,
  asked                INTEGER     NOT NULL DEFAULT 0 CHECK (asked >= 0),
  grade                SMALLINT    CHECK (grade BETWEEN 2 AND 5),
  charged_points       BIGINT      NOT NULL DEFAULT 0 CHECK (charged_points >= 0),
  last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at          TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS domla_sessions_one_open_idx ON domla_sessions (user_id) WHERE status IN ('preparing', 'active');
CREATE INDEX IF NOT EXISTS domla_sessions_user_idx ON domla_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domla_sessions_idle_idx ON domla_sessions (last_activity_at) WHERE status IN ('preparing', 'active');

CREATE TABLE IF NOT EXISTS domla_jobs (
  id           BIGSERIAL   PRIMARY KEY,
  session_id   UUID        NOT NULL REFERENCES domla_sessions(id) ON DELETE CASCADE,
  kind         TEXT        NOT NULL CHECK (kind IN ('questions', 'ask', 'score')),
  idx          INTEGER     NOT NULL DEFAULT 0,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  attempts     INTEGER     NOT NULL DEFAULT 0,
  run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, kind, idx)
);
CREATE INDEX IF NOT EXISTS domla_jobs_due_idx ON domla_jobs (run_after, id);
