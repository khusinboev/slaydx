-- Daily logic quiz (owner request 2026-10-22, docs/program-17/PLAN.md item 16, decision D5).
--
-- Every morning the bot offers 3 logic questions; 3/3 correct pays a small bonus (lib/server/daily-quiz.ts).
--
--   daily_quiz_attempts   one row per (user, Tashkent day): the chosen options so far (`answers`, in question order,
--                         the first answer to a question is final), the correct count, when the 3rd answer landed
--                         (`finished_at`) and the bonus paid (`rewarded_points`, 0 = none). The primary key makes
--                         a second attempt on the same day impossible, even in a race. Monthly cap = the sum of
--                         `rewarded_points` over the month.
--   daily_quiz_sends      the leader's per-day mark: the row is INSERTed (claimed) before the first message, so a
--                         restart or a second worker never starts a second send pass for the day. `last_user_id`
--                         is the paged cursor (recipients are taken in `users.id` order and the cursor moves BEFORE
--                         a batch is sent: at-most-once), `sent` counts accepted messages, `finished_at` is set when
--                         the cursor ran out of recipients.
--   users.daily_quiz_off  the user turned the morning message off (/obuna, «Obunani o'chirish»).
--
-- The feature itself is behind the setting `daily_quiz.enabled` (OFF on deploy); with it off nothing reads these.
--
-- ROLLBACK:
--   ALTER TABLE users DROP COLUMN IF EXISTS daily_quiz_off;
--   DROP TABLE IF EXISTS daily_quiz_sends;
--   DROP TABLE IF EXISTS daily_quiz_attempts;
--   DELETE FROM schema_migrations WHERE name = '055_daily_quiz.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS daily_quiz_attempts (
  user_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day             DATE        NOT NULL,
  answers         SMALLINT[]  NOT NULL DEFAULT '{}'
                  CHECK (cardinality(answers) <= 3 AND answers <@ ARRAY[0, 1, 2, 3]::smallint[]),
  correct         INTEGER     NOT NULL DEFAULT 0 CHECK (correct BETWEEN 0 AND 3),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  rewarded_points INTEGER     NOT NULL DEFAULT 0 CHECK (rewarded_points >= 0),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS daily_quiz_sends (
  day          DATE        PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  sent         INTEGER     NOT NULL DEFAULT 0,
  last_user_id BIGINT      NOT NULL DEFAULT 0
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_quiz_off BOOLEAN NOT NULL DEFAULT FALSE;
