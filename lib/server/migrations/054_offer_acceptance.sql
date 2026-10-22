-- Public offer (oferta) acceptance (owner decision D6, docs/program-17/PLAN.md item 12).
--
-- users.offer_version      the oferta version the user accepted (NULL = never accepted).
-- users.offer_accepted_at  when the latest acceptance happened.
--
-- The gate itself is behind the setting `oferta.gate_enabled` (OFF on deploy); with it off nothing reads
-- these columns. lib/server/oferta.ts compares offer_version with the setting `oferta.version`.
--
-- ROLLBACK:
--   ALTER TABLE users DROP COLUMN IF EXISTS offer_accepted_at;
--   ALTER TABLE users DROP COLUMN IF EXISTS offer_version;
--   DELETE FROM schema_migrations WHERE name = '054_offer_acceptance.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS offer_version     INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS offer_accepted_at TIMESTAMPTZ;
