-- Studio P11 §D (docs/studio/P11-SPEC.md): «Dublyaj» and «Transkripsiya» accept the user's OWN video upload, through the
-- same upload route and reader as the P6 audio inputs (`POST /api/media/audio-inputs` with `kind=video`,
-- `lib/server/media/audio-inputs.ts`), stored in a sibling table of `studio_audio_inputs` (069) with the same shape:
--
-- studio_video_inputs: one MP4 (type sniffed from the bytes, a picture track required, length read from `moov/mvhd`,
--   1 s – 3 min, ≤ 25 MB). `id` is 24 random hex characters made by the app (never the content hash). `seconds` is the
--   measured length, `billed_seconds` the whole seconds the job is priced on (rounded up). Reads are owner-only (SQL
--   `user_id`); the P6 audio modes never read this table, so a video can never become a voice-changer input.
--   Housekeeping deletes rows older than 1 day, as for the audio inputs.
--
-- Additive only: one new table and its indexes, nothing existing changes.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS studio_video_inputs;
--   DELETE FROM schema_migrations WHERE name = '075_studio_video_inputs.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS studio_video_inputs (
  id              TEXT         PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime            TEXT         NOT NULL CHECK (mime = 'video/mp4'),
  size_bytes      INTEGER      NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
  seconds         NUMERIC(7,2) NOT NULL CHECK (seconds > 0),
  billed_seconds  INTEGER      NOT NULL CHECK (billed_seconds BETWEEN 1 AND 180),
  bytes           BYTEA        NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_video_inputs_user_idx ON studio_video_inputs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS studio_video_inputs_age_idx ON studio_video_inputs (created_at);
