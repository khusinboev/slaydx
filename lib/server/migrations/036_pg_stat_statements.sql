-- Slow-query statistics (docs/ops/O3-robustness-ops.md §4, item 6).
--
-- docker-compose.yml already preloads the module
-- (`shared_preload_libraries=pg_stat_statements`), but the extension itself
-- was never created, so the `pg_stat_statements` view did not exist. Creating
-- it costs nothing at run time (the module is loaded either way); afterwards
-- the top statements can be read with
--   SELECT calls, round(mean_exec_time) AS ms, query
--   FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
--
-- The extension needs a superuser (production: the image's POSTGRES_USER).
-- Where it is not installable (a server without contrib) or the role lacks the
-- privilege, the migration only raises a NOTICE: statistics are diagnostics and
-- must never block a deploy. Additive and idempotent (IF NOT EXISTS).
--
-- ROLLBACK:
--   DROP EXTENSION IF EXISTS pg_stat_statements;
--   DELETE FROM schema_migrations WHERE name = '036_pg_stat_statements.sql';
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_stat_statements') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'pg_stat_statements: not created (role is not allowed to create extensions)';
    END;
  ELSE
    RAISE NOTICE 'pg_stat_statements: extension is not available on this server';
  END IF;
END
$$;
