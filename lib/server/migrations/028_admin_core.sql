-- Admin panel core: admin identities, 2FA enrollment, recovery codes, admin
-- sessions and the append-only audit log (docs/admin/02-plan.md §3, §5.1, §8).
--
-- An admin is an existing `users` row plus an `admin_accounts` row (role,
-- TOTP state). Admin sessions are a second factor layered on top of the
-- normal user session: deleting the user session (the existing purge in
-- `lib/server/session.ts`) cascades to its admin sessions.
--
-- `admin_audit_log` is append-only. Two triggers reject UPDATE/DELETE (per
-- row) and TRUNCATE (per statement), so the trail holds even against an
-- application bug. These are the repo's first plpgsql function and triggers;
-- plpgsql is built into Postgres (no extension is required).
--
-- Backward compatible: new tables only, nothing existing is touched.
-- `admin_accounts.user_id` is ON DELETE RESTRICT (users are never deleted).
--
-- ROLLBACK (run 033/032 and 031..029 rollbacks first: their tables reference
-- admin_accounts; DROP TABLE is not blocked by the audit triggers):
--   DROP TABLE IF EXISTS admin_audit_log;
--   DROP FUNCTION IF EXISTS admin_audit_log_immutable();
--   DROP TABLE IF EXISTS admin_sessions;
--   DROP TABLE IF EXISTS admin_recovery_codes;
--   DROP TABLE IF EXISTS admin_enrollments;
--   DROP TABLE IF EXISTS admin_accounts;
--   DELETE FROM schema_migrations WHERE name = '028_admin_core.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS admin_accounts (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  role             TEXT NOT NULL CHECK (role IN ('owner','admin','finance','support','moderator','viewer')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
  totp_secret_enc  TEXT,                       -- admin-crypto seal(); NULL until enrolled
  totp_enabled_at  TIMESTAMPTZ,
  totp_last_step   BIGINT NOT NULL DEFAULT 0,  -- TOTP replay guard
  created_by       BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ,
  disabled_at      TIMESTAMPTZ,
  disabled_reason  TEXT
);

-- One-time enrollment links; only the hash of the token is stored.
CREATE TABLE IF NOT EXISTS admin_enrollments (
  token_hash   TEXT PRIMARY KEY,
  admin_id     BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  created_by   BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  attempts     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS admin_enrollments_admin_idx ON admin_enrollments(admin_id);

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at     TIMESTAMPTZ,
  UNIQUE (admin_id, code_hash)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id               BIGSERIAL PRIMARY KEY,
  admin_id         BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  user_session_id  BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash       TEXT NOT NULL UNIQUE,
  ip               TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at  TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  reauth_at        TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  revoke_reason    TEXT
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions(admin_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_id       BIGINT REFERENCES admin_accounts(id) ON DELETE RESTRICT,  -- NULL = CLI / system / migration
  actor_user_id  BIGINT,
  actor_role     TEXT,
  action         TEXT NOT NULL,          -- e.g. 'users.block', 'auth.login', 'users.wallet.adjust'
  target_type    TEXT,                   -- 'user' | 'generation' | 'order' | 'game_session' | 'setting' | 'admin' | ...
  target_id      TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('ok','denied','failed')),
  reason         TEXT,
  before         JSONB,
  after          JSONB,
  meta           JSONB,                  -- idempotency key, filters of an export, via:'cli', etc.
  request_id     TEXT,
  ip             TEXT,
  user_agent     TEXT
);
CREATE INDEX IF NOT EXISTS admin_audit_at_idx ON admin_audit_log(at DESC, id DESC);
CREATE INDEX IF NOT EXISTS admin_audit_admin_idx ON admin_audit_log(admin_id, at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit_log(target_type, target_id, at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit_log(action, at DESC);

-- Append-only: the application role cannot UPDATE/DELETE/TRUNCATE audit rows.
CREATE OR REPLACE FUNCTION admin_audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'admin_audit_log is append-only'; END $$;
DROP TRIGGER IF EXISTS admin_audit_log_no_update ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_update BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_immutable();
DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_truncate BEFORE TRUNCATE ON admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_log_immutable();
