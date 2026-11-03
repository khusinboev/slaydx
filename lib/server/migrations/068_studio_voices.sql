-- Studio P5 «Ovoz» (docs/studio/P5-SPEC.md): users' own ElevenLabs voice clones, the recordings they are made from,
-- and the cached Uzbek previews of the voice library.
--
-- studio_voice_samples: one uploaded / recorded sample (WAV or MP3, 30–180 s, ≤ 10 MB, type sniffed and length measured
--   by the app). The consent checkbox is recorded HERE, at upload (consent_at, consent_ip_hash = HMAC of the client IP,
--   consent_version = the exact wording's version), and copied to the clone. Bytes are cleared once the clone is made
--   (cleared_at); an unused sample is deleted by housekeeping after 1 day.
-- studio_voices: one clone. Created by the worker in status 'creating' BEFORE the provider call, so the partial unique
--   index (one row per user WHERE deleted_at IS NULL) makes «one active clone per user» a database rule even for two
--   concurrent jobs; 'ready' once ElevenLabs answered with its voice id. Deleting (the user, the 30-day unused purge, a
--   failed job) sets deleted_at + delete_reason at once — the user may make a new clone right away — and housekeeping
--   retries the provider delete until provider_deleted_at is set (frees the ElevenLabs voice slot).
-- studio_voice_previews: the library voices' preview audio (one fixed Uzbek sentence), generated once per voice and
--   served from here (no provider call per click). A clone's preview row is keyed `clone:<id>` and deleted with it.
--
-- Additive only: three new tables, nothing existing changes.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS studio_voice_previews;
--   DROP TABLE IF EXISTS studio_voices;
--   DROP TABLE IF EXISTS studio_voice_samples;
--   DELETE FROM schema_migrations WHERE name = '068_studio_voices.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS studio_voice_samples (
  id               TEXT        PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime             TEXT        NOT NULL CHECK (mime IN ('audio/wav', 'audio/mpeg')),
  size_bytes       INTEGER     NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  seconds          NUMERIC(7,2) NOT NULL CHECK (seconds > 0),
  sha256           TEXT        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes            BYTEA,
  consent_at       TIMESTAMPTZ NOT NULL,
  consent_ip_hash  TEXT        NOT NULL CHECK (length(consent_ip_hash) BETWEEN 16 AND 128),
  consent_version  TEXT        NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 40),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS studio_voice_samples_user_idx ON studio_voice_samples (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS studio_voices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_id       UUID        REFERENCES generations(id) ON DELETE SET NULL,
  provider            TEXT        NOT NULL DEFAULT 'elevenlabs' CHECK (provider IN ('elevenlabs')),
  provider_voice_id   TEXT        CHECK (provider_voice_id ~ '^[A-Za-z0-9]{8,64}$'),
  name                TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  status              TEXT        NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'ready')),
  sample_id           TEXT,
  sample_sha256       TEXT        NOT NULL CHECK (sample_sha256 ~ '^[0-9a-f]{64}$'),
  sample_seconds      NUMERIC(7,2) NOT NULL,
  consent_at          TIMESTAMPTZ NOT NULL,
  consent_ip_hash     TEXT        NOT NULL,
  consent_version     TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  warned_at           TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  delete_reason       TEXT        CHECK (delete_reason IN ('user', 'unused', 'failed')),
  provider_deleted_at TIMESTAMPTZ,
  CHECK ((deleted_at IS NULL) = (delete_reason IS NULL)),
  CHECK (status = 'creating' OR provider_voice_id IS NOT NULL)
);
-- One active clone per user, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS studio_voices_one_active ON studio_voices (user_id) WHERE deleted_at IS NULL;
-- The 30-day unused purge and its warning.
CREATE INDEX IF NOT EXISTS studio_voices_unused_idx ON studio_voices (last_used_at) WHERE deleted_at IS NULL AND status = 'ready';
-- Provider deletes still owed (slot not freed yet).
CREATE INDEX IF NOT EXISTS studio_voices_owed_idx ON studio_voices (deleted_at) WHERE deleted_at IS NOT NULL AND provider_deleted_at IS NULL AND provider_voice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS studio_voice_previews (
  voice_key   TEXT        PRIMARY KEY CHECK (length(voice_key) BETWEEN 3 AND 120),
  mime        TEXT        NOT NULL CHECK (mime = 'audio/mpeg'),
  size_bytes  INTEGER     NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  bytes       BYTEA       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
