-- «Video yaratish» (program-17 item 5, video part): the table that lets a video job wait for its provider WITHOUT holding
-- a worker slot and without the 11-minute job timeout.
--
--   video_ops   one row per video generation (generation_id is the PRIMARY KEY: a job can own at most one provider
--               operation, so a re-claimed job never starts a second, paid one).
--               op_id         the provider's operation id (Gemini `interaction.id`, Kling `<kind>:<task_id>`);
--               status        'pending'   submitted, waiting for the provider (the poll step owns it);
--                             'succeeded' the MP4 was stored and the generation completed (exactly once);
--                             'failed'    the generation was failed and refunded (provider error, safety refusal, deadline);
--               next_poll_at  the next poll is due at this time; the poll step claims a row by pushing it forward,
--                             so a crashed poller's claim simply expires and another process picks the op up;
--               attempts      polls made so far (drives the backoff);
--               deadline_at   hard per-op deadline (20 minutes after the submit): past it the job fails and is refunded;
--               seconds       the clip length that was paid for (the delivered length is compared with it);
--               finished_at   when the row left 'pending'.
--
-- While a video waits, its `generations` row stays IN_PROGRESS with locked_by / locked_at NULL: `reclaimStaleJobs` only
-- looks at rows with a stale lease, so it never touches a waiting video; the poll step finishes the generation.
--
-- Strictly ADDITIVE (new table + indexes only): the deploy guard refuses DROP / RENAME / TRUNCATE / SET NOT NULL /
-- ALTER COLUMN TYPE in non-comment SQL.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS video_ops;
--   DELETE FROM schema_migrations WHERE name = '060_video_ops.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS video_ops (
  generation_id UUID        PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
  provider      TEXT        NOT NULL CHECK (provider IN ('veo', 'kling')),
  op_id         TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  next_poll_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      INTEGER     NOT NULL DEFAULT 0,
  deadline_at   TIMESTAMPTZ NOT NULL,
  seconds       INTEGER     NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

-- The poll step reads only the waiting rows, ordered by when they are due.
CREATE INDEX IF NOT EXISTS video_ops_due_idx ON video_ops (next_poll_at) WHERE status = 'pending';
