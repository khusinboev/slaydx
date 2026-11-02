-- Studio P6 «Audio» (docs/studio/P6-SPEC.md): the audio a user uploads / records for the voice changer or the voice
-- isolator. Not the P5 clone samples: no consent record here (a voice-changer input is not a clone sample; the tab shows
-- the ToS line instead), a different length range and size.
--
-- studio_audio_inputs: one upload (WAV or MP3, type sniffed from the bytes and length measured by the app, 3–300 s,
--   ≤ 25 MB). `id` is 24 random hex characters made by the app (never the content hash: the same file uploaded by two
--   users is two rows). `seconds` is the measured length, `billed_seconds` the whole seconds the job is priced on
--   (rounded up). Reads are owner-only (SQL `user_id`). Housekeeping deletes rows older than 1 day.
--
-- Additive only: one new table, nothing existing changes.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS studio_audio_inputs;
--   DELETE FROM schema_migrations WHERE name = '069_studio_audio_inputs.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS studio_audio_inputs (
  id              TEXT         PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime            TEXT         NOT NULL CHECK (mime IN ('audio/wav', 'audio/mpeg')),
  size_bytes      INTEGER      NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
  seconds         NUMERIC(7,2) NOT NULL CHECK (seconds > 0),
  billed_seconds  INTEGER      NOT NULL CHECK (billed_seconds BETWEEN 3 AND 300),
  bytes           BYTEA        NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_audio_inputs_user_idx ON studio_audio_inputs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS studio_audio_inputs_age_idx ON studio_audio_inputs (created_at);
