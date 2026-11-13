-- «Qattiqqo'l domla» on the website (owner decision 2026-11-13): the defence runs as a chat on /uz/domla as well as in
-- the bot, and the student can switch between the two at any moment, continuing from the same question.
--
--   domla_sessions.channel    'bot' | 'web': the ONE channel the questions and notices go to. A start from the web page
--                             is 'web', a start from the bot is 'bot'; an answer from the other channel (or its
--                             «Botda / Saytda davom etish» button) switches it. Old rows are bot defences: DEFAULT 'bot'.
--   domla_sessions.notice     the last notice of a web defence that is not visible from the state itself («Domla
--                             javobingizni eshita olmadi…»), with its time; cleared by the next accepted answer.
--   domla_sessions.notice_at
--   domla_audio               audio bytes of a session:
--                               kind 'question'  the examiner's spoken question (MP3), made ONCE per question and reused
--                                                when the defence moves between bot and web; deleted when it closes.
--                               kind 'answer'    a web voice answer waiting to be scored; deleted as soon as it is scored
--                                                (or given up on): audio is never kept, as in the bot.
--                             One row per (session, kind, idx); goes with its session (ON DELETE CASCADE).
--
-- Additive only: three new columns (with defaults / nullable), one CHECK guarded by a pg_constraint lookup, one new table.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS domla_audio;
--   ALTER TABLE domla_sessions DROP CONSTRAINT IF EXISTS domla_sessions_channel_check;
--   ALTER TABLE domla_sessions DROP COLUMN IF EXISTS notice_at;
--   ALTER TABLE domla_sessions DROP COLUMN IF EXISTS notice;
--   ALTER TABLE domla_sessions DROP COLUMN IF EXISTS channel;
--   DELETE FROM schema_migrations WHERE name = '079_domla_web.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE domla_sessions ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'bot';
ALTER TABLE domla_sessions ADD COLUMN IF NOT EXISTS notice TEXT;
ALTER TABLE domla_sessions ADD COLUMN IF NOT EXISTS notice_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'domla_sessions'::regclass AND conname = 'domla_sessions_channel_check') THEN
    ALTER TABLE domla_sessions ADD CONSTRAINT domla_sessions_channel_check CHECK (channel IN ('bot', 'web'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS domla_audio (
  session_id  UUID        NOT NULL REFERENCES domla_sessions(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind IN ('question', 'answer')),
  idx         INTEGER     NOT NULL CHECK (idx >= 0),
  mime        TEXT        NOT NULL,
  seconds     REAL,
  bytes       BYTEA       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, kind, idx)
);
