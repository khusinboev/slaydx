-- Broadcast engine (docs/bonus/BONUS3.md C-Q5, package D3). Additive only.
--
--   users.bot_blocked_at        set when Telegram says the bot is blocked / the account is deactivated
--                               (a permanent send failure); cleared on /start or a `my_chat_member`
--                               update that shows the user unblocked the bot. Audiences skip such users.
--   broadcasts.started_at       first delivery attempt of the broadcast.
--   broadcasts.heartbeat_at     last time the delivery loop recorded a result (liveness for the progress view).
--   broadcasts.fail_reason      why the engine marked the broadcast `failed` (early abort), shown to the admin.
--   broadcasts.status           + 'paused' (honoured by the loop; resumed by an admin) and 'failed'.
--   broadcast_recipients.status + 'sending' (claimed by a delivery sender under a lease).
--   broadcast_recipients.attempts        failed delivery attempts so far (transient errors; max 6).
--   broadcast_recipients.next_attempt_at earliest next attempt of a re-queued recipient (backoff).
--   broadcast_recipients.lease_until     a `sending` row whose lease passed returns to `pending` (crash safety).
--   broadcast_recipients.error_kind      blocked | deactivated | chat_not_found | bad_request | other.
--   broadcast_recipients.done_at         when the recipient got its final status (speed / ETA).
--
-- ROLLBACK (run in this order):
--   UPDATE broadcast_recipients SET status = 'pending' WHERE status = 'sending';
--   UPDATE broadcasts SET status = 'cancelled', finished_at = COALESCE(finished_at, now()) WHERE status IN ('paused', 'failed');
--   ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;
--   ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_recipients_status_check CHECK (status IN ('pending','sent','failed'));
--   ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
--   ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_status_check CHECK (status IN ('draft','queued','sending','done','cancelled'));
--   DROP INDEX IF EXISTS broadcast_recipients_lease_idx;
--   ALTER TABLE broadcast_recipients DROP COLUMN IF EXISTS attempts, DROP COLUMN IF EXISTS next_attempt_at,
--     DROP COLUMN IF EXISTS lease_until, DROP COLUMN IF EXISTS error_kind, DROP COLUMN IF EXISTS done_at;
--   ALTER TABLE broadcasts DROP COLUMN IF EXISTS started_at, DROP COLUMN IF EXISTS heartbeat_at, DROP COLUMN IF EXISTS fail_reason;
--   ALTER TABLE users DROP COLUMN IF EXISTS bot_blocked_at;
--   DELETE FROM schema_migrations WHERE name = '046_broadcast_engine.sql';

ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_blocked_at TIMESTAMPTZ;

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fail_reason  TEXT;
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_status_check
  CHECK (status IN ('draft','queued','sending','paused','done','cancelled','failed'));

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS attempts        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_until     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_kind      TEXT,
  ADD COLUMN IF NOT EXISTS done_at         TIMESTAMPTZ;
ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;
ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status IN ('pending','sending','sent','failed'));
CREATE INDEX IF NOT EXISTS broadcast_recipients_lease_idx ON broadcast_recipients(lease_until) WHERE status = 'sending';
