-- Paid tests, «Test ishlash» (owner request 7, docs/program-17/PLAN.md item 7; question bank imported from @BMB_testbot).
--
--   test_banks            one question bank (slug 'bmb' for the import). Several banks can coexist; the page plays the first active one.
--   test_subjects         subjects of a bank (math, ona_tili, tarix ...), `sort` = display order and the order of the «hammasi» blocks.
--   test_assets           the question images, PERMANENT (unlike generation_assets, nothing expires). Bytes live in Postgres, one row per
--                         distinct image (sha256 UNIQUE), so re-importing the same screenshot never stores it twice.
--   test_questions        a question is either an image (`image_asset_id`) or text (`question_text` + 4 `options`), or both. Image-only
--                         questions have NULL `options` (the A-D letters are the buttons). `answer` is 0..3 (A..D) and NEVER leaves the
--                         server before the attempt is finished. `variant` groups a subject's questions (BMB: one random variant per
--                         attempt). `legacy_ref` (e.g. 'bmb:math:11') makes the import idempotent. `active` = soft delete.
--   test_attempts         one attempt: frozen question order (`question_ids`), server deadline, price charged at start (ledger reference
--                         'test:<id>'), score snapshot (`points_per_correct` copied at start so a later settings change cannot move it).
--                         A user has at most ONE active attempt (partial unique index) and `client_key` makes a retried start idempotent.
--                         `key_snapshot` is the answer key (0..3 per question, in `question_ids` order) copied when the attempt is
--                         FINISHED: scoring and the review read only this copy, so a later correction of a question's key never
--                         changes a finished result. A running attempt is scored with the key as it is at the moment it finishes.
--   test_attempt_answers  the chosen letter per question. A row exists only for answered questions; rows after `deadline_at` are never
--                         written by the service and never counted by the scoring.
--
-- The feature ships dark: the setting `tests.enabled` defaults to false (lib/server/settings.ts).
--
-- Backward compatible: only new tables and indexes; old code never reads them.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS test_attempt_answers;
--   DROP TABLE IF EXISTS test_attempts;
--   DROP TABLE IF EXISTS test_questions;
--   DROP TABLE IF EXISTS test_assets;
--   DROP TABLE IF EXISTS test_subjects;
--   DROP TABLE IF EXISTS test_banks;
--   DELETE FROM schema_migrations WHERE name = '060_paid_tests.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS test_banks (
  id         BIGSERIAL PRIMARY KEY,
  slug       TEXT        NOT NULL UNIQUE,
  title      TEXT        NOT NULL,
  source     TEXT        NOT NULL DEFAULT '',
  active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_subjects (
  id      BIGSERIAL PRIMARY KEY,
  bank_id BIGINT  NOT NULL REFERENCES test_banks(id) ON DELETE CASCADE,
  code    TEXT    NOT NULL,
  name    TEXT    NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (bank_id, code)
);

CREATE TABLE IF NOT EXISTS test_assets (
  id         BIGSERIAL PRIMARY KEY,
  sha256     TEXT        NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime       TEXT        NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER     NOT NULL CHECK (size_bytes > 0),
  bytes      BYTEA       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_questions (
  id             BIGSERIAL PRIMARY KEY,
  subject_id     BIGINT      NOT NULL REFERENCES test_subjects(id) ON DELETE CASCADE,
  variant        INTEGER     NOT NULL CHECK (variant > 0),
  question_text  TEXT,
  image_asset_id BIGINT      REFERENCES test_assets(id),
  options        JSONB,
  answer         SMALLINT    NOT NULL CHECK (answer BETWEEN 0 AND 3),
  explanation    TEXT,
  legacy_ref     TEXT        UNIQUE,
  active         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT test_questions_has_stem CHECK (question_text IS NOT NULL OR image_asset_id IS NOT NULL),
  CONSTRAINT test_questions_options_four CHECK (options IS NULL OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4))
);
CREATE INDEX IF NOT EXISTS test_questions_pick_idx ON test_questions (subject_id, variant) WHERE active;
CREATE INDEX IF NOT EXISTS test_questions_asset_idx ON test_questions (image_asset_id) WHERE image_asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS test_attempts (
  id                UUID        PRIMARY KEY,
  user_id           BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_id           BIGINT      NOT NULL REFERENCES test_banks(id),
  subject_id        BIGINT      REFERENCES test_subjects(id),
  mode              TEXT        NOT NULL CHECK (mode IN ('subject', 'all')),
  question_ids      JSONB       NOT NULL,
  total             INTEGER     NOT NULL CHECK (total > 0),
  status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  finish_reason     TEXT        CHECK (finish_reason IN ('manual', 'timeout')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at       TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ,
  points_per_correct NUMERIC(6, 2) NOT NULL CHECK (points_per_correct >= 0),
  correct           INTEGER     CHECK (correct >= 0),
  score             NUMERIC(8, 2) CHECK (score >= 0),
  charged_points    BIGINT      NOT NULL DEFAULT 0 CHECK (charged_points >= 0),
  client_key        TEXT,
  key_snapshot      SMALLINT[],
  CONSTRAINT test_attempts_finished_has_key CHECK (status = 'active' OR (key_snapshot IS NOT NULL AND cardinality(key_snapshot) = total))
);
CREATE UNIQUE INDEX IF NOT EXISTS test_attempts_one_active_idx ON test_attempts (user_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS test_attempts_client_key_idx ON test_attempts (user_id, client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS test_attempts_user_idx ON test_attempts (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS test_attempts_due_idx ON test_attempts (deadline_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS test_attempt_answers (
  attempt_id  UUID        NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
  question_id BIGINT      NOT NULL REFERENCES test_questions(id),
  chosen      SMALLINT    NOT NULL CHECK (chosen BETWEEN 0 AND 3),
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);
