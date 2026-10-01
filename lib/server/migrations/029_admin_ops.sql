-- Admin panel operational tables (docs/admin/02-plan.md §5.2):
--   app_settings          runtime overrides read by lib/server/settings.ts (§6.10);
--   error_log             deduplicated error sink (open rows unique per fingerprint);
--   process_heartbeats    liveness of web/worker processes for the system page;
--   housekeeping_status   last run/ok/error of every housekeeping step;
--   broadcasts(+recipients) Telegram announcements, one row per recipient;
--   payment_refunds       external refunds/chargebacks recorded by finance.
--
-- Backward compatible: new tables only. `error_log.user_id` and
-- `broadcast_recipients.user_id` deliberately have no FK — logging and
-- delivery bookkeeping must never block or be blocked by user rows.
-- `payment_refunds.order_id` is ON DELETE RESTRICT: a recorded refund keeps
-- its order.
--
-- ROLLBACK (run 033/032, 031 and 030 rollbacks first):
--   DROP TABLE IF EXISTS payment_refunds;
--   DROP TABLE IF EXISTS broadcast_recipients;
--   DROP TABLE IF EXISTS broadcasts;
--   DROP TABLE IF EXISTS housekeeping_status;
--   DROP TABLE IF EXISTS process_heartbeats;
--   DROP TABLE IF EXISTS error_log;
--   DROP TABLE IF EXISTS app_settings;
--   DELETE FROM schema_migrations WHERE name = '029_admin_ops.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS error_log (
  id             BIGSERIAL PRIMARY KEY,
  fingerprint    TEXT NOT NULL,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  count          INT NOT NULL DEFAULT 1,
  level          TEXT NOT NULL CHECK (level IN ('error','warn')),
  scope          TEXT NOT NULL DEFAULT '',
  message        TEXT NOT NULL,          -- already redacted by lib/server/log.ts
  stack          TEXT,                   -- truncated to 8 KB
  request_id     TEXT,
  user_id        BIGINT,                 -- no FK (logs must never block)
  job_id         TEXT,
  path           TEXT,
  process        TEXT,
  resolved_at    TIMESTAMPTZ,
  resolved_by    BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS error_log_open_fp_idx ON error_log(fingerprint) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS error_log_last_seen_idx ON error_log(last_seen_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS process_heartbeats (
  process_id    TEXT PRIMARY KEY,        -- '<role>@<hostname>:<pid>'
  role          TEXT NOT NULL CHECK (role IN ('web','worker')),
  hostname      TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  running       INT NOT NULL DEFAULT 0,
  concurrency   INT NOT NULL DEFAULT 0,
  breakers      JSONB NOT NULL DEFAULT '[]',
  limiters      JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS housekeeping_status (
  step           TEXT PRIMARY KEY,
  last_run_at    TIMESTAMPTZ,
  last_ok_at     TIMESTAMPTZ,
  last_error_at  TIMESTAMPTZ,
  last_error     TEXT,
  last_rows      INT,
  runs           BIGINT NOT NULL DEFAULT 0,
  failures       BIGINT NOT NULL DEFAULT 0,
  last_process   TEXT
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id           BIGSERIAL PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sending','done','cancelled')),
  text         TEXT NOT NULL,            -- plain text; HTML-escaped at send time
  audience     JSONB NOT NULL,           -- {kind:'all'|'paid'|'active_days', days?}
  total        INT NOT NULL DEFAULT 0,
  sent         INT NOT NULL DEFAULT 0,
  failed       INT NOT NULL DEFAULT 0,
  created_by   BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  queued_at    TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  broadcast_id  BIGINT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL,
  telegram_id   BIGINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  error         TEXT,
  sent_at       TIMESTAMPTZ,
  PRIMARY KEY (broadcast_id, user_id)
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_pending_idx ON broadcast_recipients(broadcast_id) WHERE status = 'pending';

-- External refunds / chargebacks recorded by finance (plan §16 Q7).
CREATE TABLE IF NOT EXISTS payment_refunds (
  id                BIGSERIAL PRIMARY KEY,
  order_id          UUID NOT NULL REFERENCES payment_orders(id) ON DELETE RESTRICT,
  amount_soum       BIGINT NOT NULL CHECK (amount_soum > 0),
  kind              TEXT NOT NULL CHECK (kind IN ('refund','chargeback')),
  reason            TEXT NOT NULL,
  clawback_wallet   TEXT CHECK (clawback_wallet IN ('balance','quota')),
  clawback_amount   BIGINT NOT NULL DEFAULT 0,  -- actually debited (cannot go below 0)
  shortfall         BIGINT NOT NULL DEFAULT 0,  -- requested - debited
  clawback_tx_id    BIGINT,                     -- transactions.id of the admin_debit row
  created_by        BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_refunds_order_idx ON payment_refunds(order_id);
