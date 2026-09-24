# Review — W4-F (nginx static caching, license note, deploy runbook)

Reviewer: orchestrator (Opus 5.5, not the writer). Branch `worktree-agent-aaa5ab72c1ca8bb9a` (`4014095`, `21b2bfe`, `958596b`).

## Verdict: **APPROVE**

- **SCALE-15:** `deploy/nginx/slaydx.conf.example` has these pieces:
  - a `location /_next/static/` block with `expires 1y` and `public, max-age=31536000, immutable`;
  - a `proxy_cache` zone;
  - gzip for text types (brotli is left commented out, since stock nginx has no brotli module);
  - `proxy_cache off` on `/api/`.

  4 new tests cover it, each mutation-checked by the writer.
- **DEPS-07:** a README license section (LGPL `@breezystack/lamejs`) that is factual and short.
- **`audit/DEPLOY-RUNBOOK.md`:**
  - pre-checks: ≥2 CPUs, Compose v2, disk space, and `pg_dump` + `ROLLBACK.txt` exactly as in `.claude/deploy.md`;
  - an env table built from `git diff 76ddf91`, with `ADMIN_PHONES` explicitly never written in the file;
  - migrations 022–028 with their locks and rollback;
  - the Postgres recreate on first deploy;
  - 2 worker replicas;
  - a 5-min health poll;
  - smoke steps and owner follow-ups.
- **PII scan of the diff:** 0 matches for the server IP or the phone pattern.
- **Note for deploy:** prefer `pg_dump -Fc` (smaller for bytea) if disk is tight. The plain dump shown matches the current documented procedure.
