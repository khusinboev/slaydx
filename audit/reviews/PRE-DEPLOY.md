# Pre-deploy review: `audit/production-readiness` → prod

The reviewer was independent and the review was read-only, at HEAD `2888842`. Prod currently runs `main@76ddf91`, with code `e380940`.
Scope: `git diff 76ddf91..HEAD` of the Dockerfile, compose, .dockerignore, package*, next.config, instrumentation, env.ts and db.ts; migrations 022–027; the webhook, payments and file routes; and `audit/DEPLOY-RUNBOOK.md`.
Nothing was run against prod. The only commands executed were local and cheap:
- an esbuild bundle of the parse worker;
- an offline `docker run --network none` on the two pinned base images that already exist locally;
- a YAML parse of the compose file;
- a package.json ↔ lockfile comparison.

The deploy will run with the owner-supplied `ADMIN_PHONES` values. The fallback number hard-coded in `lib/server/admin-phones.ts:39` is one of them, so the current admin keeps access. No phone numbers are written in this file.

---

## BLOCKERS

**None found.** I found nothing in the code, compose, Dockerfile or migrations that would, as written, fail this deploy or break login, payments or downloads on prod. Every item below is a deploy-time check or a small hardening step. None requires a code change before the deploy.

---

## RISKS (deploy-time watch items)

### R1 — The final images have never been built. Build them once before prod does. (strongly recommended)
- In `audit/reviews/*` I found no `docker build` or `docker compose build` of the runner or worker targets at HEAD.
  - W3-F verified `npm ci --omit=dev` with a real install and a lockfile walk.
  - W2-D1 verified the esbuild step on W1-D's tip.
  - The P5 load test uses `next start`, not the images (`loadtests/stack.sh`).
- New build steps that the Docker path exercises for the first time:
  - `ARG NODE_IMAGE` pin (`Dockerfile:15`);
  - the esbuild parse-worker bundle (`Dockerfile:42`);
  - `npm ci --omit=dev` in the worker (`Dockerfile:129`);
  - sharp 0.35.4 on musl;
  - next 15.5.26;
  - a build with no `.env.local` and no `DATABASE_URL` (the local gate builds had one; W3-F N6).
- What I verified: esbuild bundles `lib/server/parse-worker.ts` cleanly. There are 163 inputs and no `server-only`, `next` or `react` module in the bundle. The bundle runs standalone in a `worker_thread` from a directory with no `node_modules`, answering a task with a typed error. package.json and `package-lock.json` agree exactly.
- Blast radius if the prod build fails: none. `deploy.sh` runs `build && up`, so the old containers keep serving. The only side effect is that the server checkout is already at the new commit.
- Blast radius if the image builds but misbehaves at runtime: an outage until rollback. See R3 for a fast rollback.
- Check, on the laptop after the load test ends (compose v2 is not installed locally, so use plain docker):
  ```bash
  docker build --target runner -t slaydx-pre-web . && docker build --target worker -t slaydx-pre-worker .
  docker run --rm --network none slaydx-pre-web sh -c 'ls -l /app/parse-worker.mjs /app/lib/server/migrations | tail -3 && node -e "require(\"sharp\"); console.log(\"sharp ok\")"'
  docker run --rm --network none -e NODE_ENV=development slaydx-pre-worker ./node_modules/.bin/tsx --conditions=react-server -e 'await import("./lib/server/worker.ts"); await import("sharp"); console.log("worker graph ok")'
  ```
  In the web image, `require("sharp")` must resolve from `/app/node_modules`, the standalone trace. If it fails there, only figure rendering in the web container is affected, because `figurePng` swallows the error. Figures are drawn in the worker.

### R2 — `init: true` needs `docker-init` on the host. (cheap pre-check)
- `docker-compose.yml:96` and `:220` are new. If the engine has no init binary, `web` and `worker` fail to be created, which is a full outage.
- Docker CE 29.x ships it, and so does Debian/Ubuntu `docker.io` (through tini). Confirm anyway:
  ```bash
  docker info --format '{{.InitBinary}}'; docker version | grep -A1 -i 'docker-init'
  ```

### R3 — Rollback speed: tag the running images before deploying.
- The runbook rollback in §8 does `git reset` + `docker compose build`. That is a full rebuild of the old commit. It is mostly cached, but still takes minutes while prod is down.
- Before `deploy.sh`, run:
  ```bash
  docker tag slaydx-web:latest slaydx-web:pre-audit && docker tag slaydx-worker:latest slaydx-worker:pre-audit
  ```
- Fast rollback is then: `git reset --hard 76ddf91`, `docker tag slaydx-web:pre-audit slaydx-web:latest` (the same for worker), and `docker compose -p slaydx up -d --no-build`.

### R4 — The one-time Postgres recreate and in-flight jobs
- Postgres is recreated because the image tag, `command:` and `mem_limit` all change (`docker-compose.yml:9,39,58`). Every web and worker connection drops for about 10–20 s. The old worker's IN_PROGRESS jobs are killed without the new graceful release, because the old code exits about 2 s after SIGTERM. The new `reclaimStaleJobs` reclaims them only after their `budget_ms`, which can be up to 11 min.
- Deploy while the queue is idle:
  ```bash
  docker exec slaydx-postgres-1 psql -U slaydx -d slaydx -c "SELECT status, count(*) FROM generations WHERE status IN ('QUEUED','IN_PROGRESS') GROUP BY 1;"
  ```
- Data safety of the recreate:
  - The volume key `pgdata` and project `slaydx` are unchanged, so the volume is the same (`slaydx_pgdata`).
  - `PGDATA=/var/lib/postgresql/data` in `postgres:16.15-alpine3.24` (checked with `docker image inspect`).
  - The postgres uid is 70, as in 16-alpine.
  - Minor 16.14 → 16.15 means the same on-disk format, with no initdb.
  - musl/libc collation means the Alpine bump cannot reorder indexes.

### R5 — Health poll window
- Migrations 022–027 are small, but the migration advisory-lock wait can run up to 10 min (`lib/server/db.ts:249`). Add the PG recreate and the build time, and `deploy.sh`'s 2-minute `/api/health` poll can report failure on a deploy that is healthy.
- Poll for 5 min as runbook §6 says, and watch:
  ```bash
  docker compose -p slaydx logs -f --tail=50 web worker | grep -E '\[db\]|\[boot\]|\[config\]|fatal'
  ```
- Expected output: six `migratsiya qo'llandi: 02x_…` lines from one process. The other two processes log `migratsiya qulfi band … kutamiz` and then `qulfi olindi`.
- If you see `[boot] … process chiqmoqda`, the process has exited on a config or migration failure. Docker restarts it; read the listed problem.

### R6 — Memory limits are new, where before there were none
Limits per container:

| Container | Memory limit | CPU limit |
|---|---|---|
| web | 2g | 2 |
| each of 2 workers | 2g | 2 |
| postgres | 1g | 1 |
| **Total** | **7 GB** | **7 CPUs** |

The box has 23 GB and 8 cores. CPU limits are quotas, not reservations, so the totals are fine.

The web container now holds Next, up to 2 × `soffice` (`PDF_MAX_CONCURRENCY=2`) and up to 2 parse threads with 512 MB old-gen each (`lib/server/parse-pool.ts`). A burst can hit the 2 g cgroup. The OOM killer may then pick `node` rather than `soffice`, and the web container restarts.

Each worker now runs 4 concurrent jobs, up from 2.

Watch the first hour:
```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' | grep slaydx
docker inspect -f '{{.Name}} OOMKilled={{.State.OOMKilled}} Restarts={{.RestartCount}}' $(docker ps -aq -f name=slaydx-)
```
If you see OOMs, raise `WEB_MEM_LIMIT` to 3g in `.env`. Do not touch the other projects.

### R7 — Postgres `/dev/shm` is 64 MB (compose sets no `shm_size`), while the load test used 256 MB
- `loadtests/stack.sh:37` runs the "tuned" Postgres with `--shm-size 256m`, but `docker-compose.yml` has no `shm_size`. That makes prod differ from what was load-tested.
- With `work_mem=16MB`, which is up from 4 MB, parallel hash joins allocate posix DSM in `/dev/shm`. On 64 MB they can fail with `could not resize shared memory segment … No space left on device`.
- The probability is low at 296 MB of mostly TOASTed data. Parallel plans need heaps larger than 8 MB.
- Optional one-line hardening: `shm_size: 256mb` under `postgres:`. Alternatively, grep the PG logs after deploy:
  ```bash
  docker logs slaydx-postgres-1 2>&1 | grep -i 'shared memory'
  ```

### R8 — Disk: 15 GB free, 80 % used
- The Node and Postgres base-image pins invalidate every layer. That means a new LibreOffice apk layer (~0.7 GB), full `npm ci` plus the builder (~2–3 GB), the runner and worker images, and a plain-SQL `pg_dump` (bytea in hex, about 2× the 296 MB). Expect 5–7 GB to be used.
- Check before and after:
  ```bash
  df -h /var/lib/docker /root; docker system df
  ```
- Never `docker system prune` or `docker image prune`, because the box is shared. Afterwards, remove only old `slaydx-*` image IDs by name.

### R9 — The Telegram webhook secret is fine now, but setting it later breaks login until `setWebhook` is re-run
- Old code checked `X-Telegram-Bot-Api-Secret-Token == CRON_SECRET`. The 76ddf91 README registered `secret_token=$CRON_SECRET`.
- New code uses `TELEGRAM_WEBHOOK_SECRET || CRON_SECRET` (`lib/server/env.ts:302-304`, `app/api/telegram/webhook/route.ts:28-37`). With the variable unset, as on prod today, behaviour is identical and the boot only warns.
- If anyone adds `TELEGRAM_WEBHOOK_SECRET` to `.env`, every Telegram update returns 401 until `setWebhook` is re-sent with the new `secret_token`. That breaks the bot login link.
- The value must match `[A-Za-z0-9_-]{1,256}`.
- Runbook §9.2 (`audit/DEPLOY-RUNBOOK.md:274`) is wrong. It says no such secret exists and that the webhook is verified by the bot token. Fix the text, or follow `.env.example` / README:106-113:
  1. Write the secret to `.env`.
  2. Run `docker compose -p slaydx up -d web`.
  3. Immediately re-run `setWebhook`.

  Updates received between steps 2 and 3 get 401 and Telegram re-delivers them.

### R10 — `.env` values that could silently diverge
Check only whether each is present; do not print values:
```bash
grep -cE '^(WORKER_CONCURRENCY|QUEUE_TOTAL_SLOTS|PAYME_TEST_KEY|PAYME_SANDBOX|TELEGRAM_WEBHOOK_SECRET|SESSION_COOKIE_SAMESITE|ADMIN_PHONES)=' /opt/slaydx/.env
```
- **`WORKER_CONCURRENCY` override:** if `.env` still has `WORKER_CONCURRENCY=2` from the old default, compose gives 2 × 2 = 4 slots. Admission still assumes `QUEUE_TOTAL_SLOTS=8`, so ETA and queue-full estimates would be off by 2×.
- **Queue settings only reach web:** `QUEUE_*` and `USER_MAX_INFLIGHT` are passed to web only (`docker-compose.yml` web env). Keep them at their defaults, or add them to the worker too if you override them.
- **Payme test key:** `PAYME_TEST_KEY` is now accepted only with `PAYME_SANDBOX=true` (`lib/server/payme-keys.ts`). The owner says `PAYME_TEST_KEY` is not set in prod, so there is no change. The checkout still requires `PAYME_KEY`.

### R11 — Provider load triples
Worker slots go from 1 × 2 = 2 to 2 × 4 = 8, so there are up to 8 concurrent Gemini generations. Watch for 429s and fallbacks in the first busy hour:
```bash
docker compose -p slaydx logs worker | grep -cE '429|RESOURCE_EXHAUSTED|breaker'
```

### R12 — Payme/Click protocol responses changed (W3-C)
Payments are in test mode, so no money is at risk. Re-certify in the sandbox before going live. This is runbook §9.1; it is not a deploy blocker. Webhooks now also write `payment_events` (migration 025). Right after deploy, confirm:
```sql
SELECT provider, method, response_code, received_at FROM payment_events ORDER BY id DESC LIMIT 5;
```

### R13 — Runbook and compose-comment corrections (documentation only)
- **Runbook §3:** `audit/DEPLOY-RUNBOOK.md:99-118` says "022-028" and "027/028 agar mavjud bo'lsa". The actual set is 022–027. 027 creates `generations_running_user_idx`, drops `generations_stale_idx` and `generations_queue_idx`, and sets `fillfactor=90`. All of these are backward compatible (see OK §5).
- **Compose comment:** `docker-compose.yml:121` says an empty `ADMIN_PHONES` means "admin YO'Q (fail-closed)". The code does the opposite and falls back to the hard-coded list (`lib/server/admin-phones.ts:39-45`). The runbook describes it correctly. Only the comment is wrong.
- **Deleted docs on the server:** after `git reset --hard`, the server checkout loses the tracked `.claude/deploy.md`, `holat.md` and `structure.md` because of the W3-I untrack commit. They are docs only, but the runbook links to `.claude/deploy.md`, so keep the local copy.

---

## OK (verified)

### 1. Compose (compared with Compose v5.1.2 / Engine 29.4)
- The YAML parses and has no duplicate keys.
- There is no `container_name` anywhere. `deploy.replicas: 2` only applies to `worker`, which has no `ports`. The only host binding is web's `127.0.0.1:${PORT:-3000}:3000`, which is unchanged, so there are no port conflicts. The replicas will be named `slaydx-worker-1` and `slaydx-worker-2`.
- `mem_limit` and `cpus` are set at service level, with no `deploy.resources`, so there is no conflict with `deploy:`. Interpolated values like `"2"` and `"1g"` are valid.
- `logging` is json-file with 20m × 5 per container, about 400 MB worst case in total.
- Postgres `command:` flags are all valid for 16: `max_connections=100`, `shared_buffers=256MB`, `work_mem=16MB`, `log_min_duration_statement=500`, `autovacuum_vacuum_scale_factor=0.05` and `idle_in_transaction_session_timeout=60s`.
  - `pg_stat_statements.so` exists in `postgres:16.15-alpine3.24` at `/usr/local/lib/postgresql/`, checked offline.
  - `shared_buffers` uses mmap, not `/dev/shm`.
  - The expected number of connections is 3 processes × pool 10, plus migrate and housekeeping clients: about 35, well under 100.
- `idle_in_transaction_session_timeout=60s` is safe: every `transaction(...)` call site renders, runs the LLM or builds outside the transaction (`slide-commit.ts:155-160`, `doc-polish.ts:385-392` and the others). Migrations run one statement batch per transaction, and the load-test "tuned" profile used the same flag.
- The worker healthcheck works in `node:22.23.2-alpine3.24`, tested offline:
  - BusyBox `find -mmin` works: a fresh file passes and a stale one fails.
  - A missing file fails correctly, because `find` exits 0 but `grep -q .` fails.
  - The file is first written on the first healthy loop tick after `ensureMigrated()`, since `lastAliveAt=0` and then every 10 s (`lib/server/worker.ts:108-123,1034`). That is well inside `start_period: 30s`.
  - A long migration-lock wait only makes the container "unhealthy". Docker does not restart unhealthy containers, so this has no functional effect.
- Worker stop timing: `stop_grace_period: 30s` fits the 20 s drain plus release in `SHUTDOWN_GRACE_MS` (`worker.ts:314`). Web has 60 s.

### 2. Boot-time env: fatal vs warn
- **What changed:** only the failure mode. It used to be `throw`, which gave a zombie process that returned 500s. It is now `process.exit(1)` followed by a Docker restart (`instrumentation.ts:47,60`). The check list itself is identical to 76ddf91 except that the webhook-secret check became more lenient.
- **FATAL in production** (web only; `assertRuntimeConfig`, `lib/server/env.ts:330-353`):
  - `DATABASE_URL` (compose builds it);
  - `APP_URL` non-empty;
  - `DEV_LOGIN_ENABLED` not true (compose never passes it, so it defaults to false);
  - `TELEGRAM_BOT_TOKEN`;
  - `NEXT_PUBLIC_TELEGRAM_BOT` when a bot token is set. This is read with a dynamic `process.env[name]`, so it is not build-inlined.
  - `TELEGRAM_WEBHOOK_SECRET` **or** `CRON_SECRET` when a bot token is set;
  - `SESSION_COOKIE_SAMESITE=none` requires an `https://` APP_URL;
  - `AZURE_SPEECH_KEY` requires `AZURE_SPEECH_REGION`;
  - a failed migration.
- **FATAL at import in web and worker:** `SESSION_SECRET` shorter than 32 characters. This is unchanged since 76ddf91 (`env.ts:66-78`). Compose `:?` only enforces non-empty.
- **WARN only:**
  - no TTS key;
  - `TELEGRAM_WEBHOOK_SECRET` unset, falling back to `CRON_SECRET`;
  - `FREE_LLM_DISABLED` typo;
  - `TRUST_PROXY=false`.
- **Result:** a `.env` that satisfied 76ddf91 satisfies HEAD.
- **Default flips that are harmless on prod:**
  - `WORKER_INLINE` now defaults to `!isProd`, but compose pins `"false"` for web and the worker does not read it.
  - `PAYME_SANDBOX` defaults to false, and there is no test key on prod.
  - `FILE_TTL_HOURS` was dropped and is ignored.

### 3. Migrations 022–027 on a 296 MB database, during a mixed old/new rollout
- **022, 024 and 026:** nullable columns with no default (metadata-only `ADD COLUMN`), plus partial or plain indexes.
  - The `UNIQUE (user_id, idempotency_key) WHERE NOT NULL` index is built over only NULLs.
  - `UNIQUE (session_id, submission_id)` is built over only NULL `submission_id` values. NULLs never collide, so there is no failure on existing data.
- **023:** five plain indexes. `login_tickets` is intentionally non-unique. Every referenced column exists (001/004/007/021).
- **025:** a new table and a view. `payment_orders.provider/provider_txn/amount_soum/state` and `transactions.kind/quota_delta/balance_delta/reference` all exist in 001.
- **027:** a small partial index on IN_PROGRESS rows, two `DROP INDEX` statements and `fillfactor=90`. No code references the dropped index names, and the 023 index covers `claimJob`.
- **Lock timeouts:** every file that touches an existing table uses `SET LOCAL lock_timeout='5s'`. The runner retries a `55P03` up to 5 times with 3, 6, 9 and 12 s backoff (`db.ts:249-340`).
- **Runner mechanics:**
  - It uses a dedicated non-pool client with `statement_timeout=0`.
  - `pg_try_advisory_lock`, then a bounded `pg_advisory_lock` wait of 10 min. `lock_timeout` does bound advisory waits.
  - The done-set is re-read after the lock is acquired, and each file runs in its own transaction.
  - Web plus 2 workers booting together: one process applies the files, the other two wait and then skip them.
- **Old code against the new schema:** old web or worker code alive during the rollout overlap, or after a rollback, is safe.
  - It never reads the new columns or tables.
  - It writes NULL `idempotency_key` and `submission_id`.
  - It only loses two redundant indexes, which on 95 rows is a no-op for performance.
  - None of 022–027 changes a CHECK constraint, so new code cannot write a status or kind that old code cannot read.
- **Retention and refund jobs cannot touch existing prod data:**
  - The retention purge needs `finished_at` older than 180 days, and the project's first commit is 2026-08-13.
  - The refund reconciler only considers FAILED rows finished after `022_retention.sql`'s `applied_at` (`refund-reconcile.ts:77-89`).

### 4. Build and runtime contents
- **Lockfile:** `package-lock.json` (v3) matches package.json exactly. `tsx` and `esbuild` are prod deps. The musl `@img/sharp-linuxmusl-x64@0.35.4` and `@img/sharp-libvips-linuxmusl-x64@1.3.3` and `@esbuild/linux-x64` are in the lock.
- **Worker imports:**
  - Every relative or `@/` import in `lib/` and `scripts/` stays inside `lib`, `scripts` or `data`, which are the dirs the worker image copies. I checked with a script.
  - No `lib/` code reads `public/`, `docs/` or `audit/`.
  - Bare packages used from `lib/` are all in `dependencies`.
- **`.dockerignore`:** the newly excluded dirs (`docs`, `audit`, `.claude`, `eval-out`, `scratch-tmp`) contain no `.ts`, `.mts` or `.d.ts` files, and nothing imports from them. The Docker `next build` typecheck set is therefore a strict subset of the local one.
- **Parse worker:**
  - The runner copies `.next/standalone`, including `parse-worker.mjs` at `/app`, the cwd of `node server.js`. It also copies `static`, `public` and `lib/server/migrations`.
  - In the worker, the parse pool falls back to `lib/server/parse-worker.ts` + `--import tsx`, and `tsx` is present.
- **LibreOffice:** it stays only in the web image, as before. Worker `pdfAvailable()` still returns false, the same code path as at 76ddf91.
- **Unchanged since 76ddf91:** `scripts/guard-build.mjs` (it connects to container-local 127.0.0.1:3000 during the build, where nothing listens). App pages are unchanged too, apart from `error.tsx` and `global-error.tsx`. So build-time prerendering behaviour without a DB is unchanged.
- **Build-time secrets:** the `isBuildPhase` guard (`env.ts:51`) keeps the build free of secrets.

### 5. Rollback to 76ddf91/e380940 after 022–027
- **Safe.** The old runner (`git show 76ddf91:lib/server/db.ts:113-124`) skips files already in `schema_migrations` and ignores unknown rows. See §3 for schema compatibility.
- **Compose side of a rollback:**
  - Postgres returns to `postgres:16-alpine`, the local 16.14 image. That is a same-major minor downgrade, so the on-disk format is compatible, and it triggers one more brief PG recreate.
  - Workers scale back to 1.
  - `init` and the resource limits disappear.
- **Retention:** nothing was purged, so no files are missing for the old code.
- **Sessions:** `lib/server/session.ts` is unchanged, so users are not logged out in either direction.

### 6. Login, payments and downloads right after deploy
- **Telegram webhook:** it still accepts `CRON_SECRET`, so the existing registration keeps working (R9). Transient errors now return 500 so that Telegram retries.
- **Bot login link:** it now goes GET confirm page → POST (SECA-05).
  - `checkOrigin` is byte-identical to 76ddf91 and already guards all prod POSTs.
  - The POST redirects are relative.
  - CSP allows `form-action 'self'` and inline styles.
- **User upsert:** `ON CONFLICT (telegram_id)` relies on the plain `UNIQUE` in 001, which is not partial, so it works.
- **Admin phone match:** it is now exact-digit. Stored phones have always been `+<full intl digits>` (76ddf91 `telegram.ts:305`), so current admins still match.
- **Payments:**
  - Click and Payme use the same env keys as before.
  - `paymentsConfigured` only changed for the test-key case, which prod does not use.
- **Downloads:**
  - `getGenerationFile` now also requires `status='COMPLETED'`, and every existing downloadable row is COMPLETED.
  - Thumbnails keep the same asset id at `file_version=0` (`thumb.ts:43-56`), so the existing thumbnail caches stay valid.
  - The PDF cache lives under `/tmp`, is writable by `nextjs`, and is capped at 500 MB / 24 h.
  - Next 15 GET route handlers are dynamic.
  - There are no Server Actions, so stale browser tabs cannot hit "unknown action". Old clients without `Idempotency-Key` just get a NULL key.

---

**Verdict: GO.** There are no blockers. Before running `deploy.sh`, do the pre-flight checks R1 (image build), R2 (docker-init), R3 (tag rollback images) and R4 (idle queue). During the deploy, watch R5 and R6.
