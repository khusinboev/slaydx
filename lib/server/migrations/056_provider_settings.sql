-- Provider key store (owner decision D7, docs/program-17/PLAN.md phase C).
--
-- provider_settings: one row per AI provider the admin touched (the registry is lib/server/providers/registry.ts).
--   provider         registry id ('gemini', 'fal', 'elevenlabs', ...). No FK: the registry is code.
--   enabled          the admin's on/off switch. A provider WITHOUT a row is enabled; a disabled one is unavailable
--                    even when an env var holds a key.
--   key_ciphertext   the API key sealed with AES-256-GCM (lib/server/providers/crypto.ts, format 'pk1.' + base64url,
--                    AAD = provider id). NULL = no key stored, the env var applies. Never plaintext.
--   key_hint         '…a1B2', the last four characters, so the admin can tell which key is stored. NULL with the key.
--   updated_at/by    last writer (admin_accounts.id); SET NULL if the admin account is ever deleted.
--
-- With no rows nothing changes: every provider is enabled and keys come from the environment.
-- Additive only: one new table, no change to existing ones.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS provider_settings;
--   DELETE FROM schema_migrations WHERE name = '056_provider_settings.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS provider_settings (
  provider        TEXT PRIMARY KEY CHECK (length(provider) BETWEEN 1 AND 40),
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  key_ciphertext  BYTEA,
  key_hint        TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  CONSTRAINT provider_settings_key_pair CHECK ((key_ciphertext IS NULL) = (key_hint IS NULL))
);
