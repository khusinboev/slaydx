-- Server load history (owner 2026-10-10: "how busy was it, how heavy was the load, at how many
-- concurrent users did it slow down / run out of memory"). Additive only.
--
--   server_metrics      one row per sample. kind 'host' = written every 5 min by the root host cron
--                       (deploy/ops/slaydx-metrics.sh: load, memory, swap, disk, per-container CPU/memory,
--                       restarts/OOM, nginx request counts); kind 'app' = written every minute by the
--                       housekeeping leader (lib/server/server-metrics.ts: active users, queue depth,
--                       job wait/duration percentiles, DB connections, event loop lag, RSS). `data` is the
--                       sample as JSON. Retention 90 days (purge in the worker housekeeping pass).
--   server_alert_state  one row per alert rule (lib/server/server-alerts.ts): whether it is firing, since
--                       when, and when its last bot message went out, so a restart or a second worker never
--                       repeats an alert (cooldown + a single "recovered" message).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS server_alert_state;
--   DROP TABLE IF EXISTS server_metrics;
--   DELETE FROM schema_migrations WHERE name = '049_server_metrics.sql';
CREATE TABLE IF NOT EXISTS server_metrics (
  id    BIGSERIAL PRIMARY KEY,
  at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind  TEXT NOT NULL CHECK (kind IN ('host', 'app')),
  data  JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS server_metrics_at_idx ON server_metrics (at DESC);
CREATE INDEX IF NOT EXISTS server_metrics_kind_at_idx ON server_metrics (kind, at DESC);

CREATE TABLE IF NOT EXISTS server_alert_state (
  rule          TEXT PRIMARY KEY,
  firing        BOOLEAN NOT NULL DEFAULT false,
  since         TIMESTAMPTZ,
  last_sent_at  TIMESTAMPTZ,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
