# Review — W3-E (migration runner, pool config, 023 indexes)

- **Reviewer:** independent, read-only
- **Branch:** `worktree-agent-ab3d379f3626bc794` (`64bdb34`, `7ac4047`, `79bc214`)
- **Compared with:** `git diff audit/production-readiness...worktree-agent-ab3d379f3626bc794`
- **Date:** 2026-09-24

## Verdict: **CHANGES REQUESTED** (1 real bug, 2 small config gaps)

The migration runner is correct and safe to run on every prod boot. Each file runs in its own transaction and is retried only after a ROLLBACK. The advisory lock is released on every path. The dedicated connection is always closed. The five indexes are real, used by the queries they claim to serve, and none duplicates an existing index. What blocks approval is the new pool-exhaustion warning in C33: **it fires on an idle, healthy pool**, so in prod it would print "pool full" roughly once a minute and the signal would be useless.

**Tests.** I ran `tests/db-migrate.test.mts`, `tests/db-indexes.test.mts` and `tests/migrations.test.mts` from the worktree root through `heavy2.sh -m 3G -t 900`, with `DATABASE_URL=…:55439`. Result: **17 pass, 0 fail, 0 skipped**, 36 s (including the 31 s slow-migration test).

---

## Required changes

### 1. The pool-pressure warning fires on a warm, idle pool (false positive)

`notePoolPressure()` reads `p.waitingCount` straight after `p.query()` / `p.connect()`. In pg-pool 3.14 (`node_modules/pg-pool/index.js:200-232`), when an **idle client is available**, `connect()` still pushes the request onto `_pendingQueue` and only hands out the idle client on `process.nextTick`. So `waitingCount` is 1 at the moment you check it, even though nothing is waiting.

I reproduced it against the test DB: one `query("SELECT 1")`, then a second sequential `query("SELECT 1")` with `total 1, idle 1, waiting 0` beforehand. That printed:

```
[db] hovuz to'lgan: 1 so'rov ulanish kutmoqda (ulanishlar 1/10, bo'sh 1)
```

In prod, every process would log this about once a minute (the rate limit), no matter the load.

**Fix:** treat the pool as saturated only when the request cannot be served at once. Check `p.idleCount === 0 && p.totalCount >= env.databasePoolMax` (either before issuing the request, or together with `waitingCount > 0` after it). Then add a regression test: a sequential query on a warm pool must produce **no** warning. The existing burst test only checks that the warning is rate-limited, so the mutation list missed this bug.

### 2. The new env knobs cannot reach the containers

`DATABASE_STATEMENT_TIMEOUT_MS` and `DATABASE_CONNECT_TIMEOUT_MS` are read in `db.ts`, but they are not:
- in `docker-compose.yml` (web or worker),
- in `.env.example`,
- or in `env.ts`.

Compose passes only the variables it lists (see the 2026-09-12 lesson and `tests/compose-env.test.mts`), so in prod these knobs are decorative. That breaks the "every param must work" rule. `envMs` already treats an empty string as "use the default", so `${X:-}` is safe.

- **W3-E:** document both in `.env.example`.
- **W3-F** (it owns compose in W3 phase 1): add both to the `web` and `worker` environment blocks, and preferably to `compose-env.test.mts`.

State the hand-off explicitly in the package report so it is not lost.

### 3. `DATABASE_STATEMENT_TIMEOUT_MS=0` gives a 5 s client-side timeout

`query_timeout: statementTimeout + 5_000` evaluates to `5_000` when an operator sets `0` to mean "no limit". Every query would then be cancelled on the client after 5 s, which is the opposite of what they asked for.

**Fix:** use `query_timeout: statementTimeout > 0 ? statementTimeout + 5_000 : undefined`, and add a one-line assertion to the pool-config test.

---

## Point-by-point findings (what holds)

### 1. Retries

- **One transaction per file, retry only after rollback.** Each attempt runs `BEGIN → set_config('lock_timeout', …, true) → file SQL → INSERT schema_migrations → COMMIT`. On any error it runs `ROLLBACK` first, and only then decides whether to retry (`55P03` and `attempt < lockRetries`). A partially applied file is never re-run on top of its own partial state.
- **No file commits on its own.** I grepped 001–023 for `BEGIN`, `COMMIT` and `CONCURRENTLY`. The only `BEGIN` is the PL/pgSQL `DO $$ … BEGIN … END $$` in 008, which is not a transaction statement.
- **If ROLLBACK itself fails** (dead connection), the next `BEGIN` fails and the runner throws `Migratsiya xatosi`. No silent retry on a broken session.
- **021 and 022 are retry-safe.** They use `CREATE TABLE`, `CREATE INDEX` and `ADD COLUMN IF NOT EXISTS`, and every retry starts from a rolled-back state anyway. 008's `ADD CONSTRAINT` is not idempotent, but it is also atomic per transaction and is already applied in prod.
- **A file's own lock limit wins.** The per-file `SET LOCAL lock_timeout = '5s'` in 022/023 overrides the runner's `set_config(..., true)`, as the code comment says.
- **Worst case per file:** 5 × `lock_timeout` + backoff of 3 + 6 + 9 + 12 s. That is about 55 s for the 5 s files and about 80 s for 10 s files. After that the runner throws, the process exits (W2-D1), and Docker restarts it.
- **023 (non-`CONCURRENTLY` `CREATE INDEX`)** takes a SHARE lock on each table:
  - Reads keep working; INSERT, UPDATE and DELETE wait.
  - All five locks are held until the one COMMIT.
  - A partial index still scans the **whole heap**, not just the matching rows.
- **Impact today:** the tables are small and heavy columns live in TOAST, so each build takes well under a second.
- **Impact at scale:** at around 1M+ `generations` rows (hundreds of MB to GBs of heap), the build could block `claimJob`, heartbeats and generation INSERTs for tens of seconds. Pool requests would then hit the 30 s `statement_timeout`.

  Not needed now. Before the next index on a big table, add a non-transactional path, for example `NNN_name.concurrent.sql`:
  - one statement per file, run outside `BEGIN`;
  - `CREATE INDEX CONCURRENTLY IF NOT EXISTS`;
  - on retry, first drop any **INVALID** index left by a failed attempt (check `pg_index.indisvalid`), because `IF NOT EXISTS` would silently keep the broken one.

### 2. Boot ordering

- **What happens at boot:** web and both worker replicas call `migrate()` at the same time. One takes the advisory lock with `pg_try_advisory_lock`. The others log "qulf band … kutamiz" and wait with `lock_timeout = lockWaitMs` (the test proves this bounds advisory-lock waits). Once they get the lock, they re-read `schema_migrations`, so nothing is applied twice (the test checks that `mig_probe` count is 1).
- **Health during a slow migration:** web `register()` awaits `ensureMigrated()`, so `/api/health` hangs or fails for as long as the migration runs.
  - The Dockerfile healthcheck (`start-period 20s`, 3 × 30 s) would mark the container unhealthy after about 110 s. That is cosmetic, because nothing restarts on unhealthy.
  - **deploy.sh's 2-minute health poll will report failure while a legitimate migration is still running.** With several lock-timeout rounds across three processes (up to about 80 s each), even a small DB can go past 2 min when traffic holds locks.
- **Recommended numbers:**
  - Keep `lockWaitMs` at 10 min. A loser that waits costs nothing. A loser that crashes only restarts and waits again.
  - Raise deploy.sh's health poll to **5 min**, and have it `grep` the logs for `[db] migratsiya` lines while waiting, so "progressing" and "stuck" can be told apart.
  - Better still, add an explicit `docker compose run --rm worker ./node_modules/.bin/tsx scripts/migrate.ts` step before `up -d`. The migration time is then visible and separate from the health check, and the new containers find nothing left to do.
  - Optionally raise web `start_period` to 120 s.
  - Both deploy changes belong to the owner or W3-F (deploy.sh is untracked, on the server). They are not W3-E code.

### 3. Connect timeout 10 s → 5 s

In pg-pool, `connectionTimeoutMillis` also covers **waiting for a free pool slot**, so a saturated pool now fails after 5 s instead of 10 s. For web this is the right trade: a user request queued for more than 5 s is already a bad experience, and a fast 5xx beats a hang behind nginx.

For the worker (4 jobs per replica, pool of 10), exhausting the pool would need more than 10 connections held at once. That is unlikely unless code nests `query()` inside `transaction()`.

Acceptable. Once change 1 is fixed, use the warning to tune. If it shows up, raise `DATABASE_POOL_MAX`; do not raise the timeout. The worst case is web 10 + 2 × 10 workers + migrate connections, about 33, well under Postgres's default 100.

### 4. The dedicated migration client

- **Closed on every path:** `client.end()` runs in `finally`. If `connect()` fails, it throws before `try`, and pg destroys the socket.
- **Unlock only when held:** `pg_advisory_unlock` runs only if `locked` is set. Nothing is awaited between a successful try-lock and `locked = true`.
- **On a killed process** the session lock dies with the connection. The test confirms that after a failed migration no `slaydx-%-migrate` backend remains and `pg_try_advisory_lock` succeeds.
- **Timeouts:** `statement_timeout` is `0ms` for the session, and the pool's 30 s no longer applies. The advisory wait and table-lock waits each have their own bound.
- **Errors:** an `error` event on the client does not crash the process.
- **Role detection:** confirmed empirically that `./node_modules/.bin/tsx scripts/worker.ts` (the Docker worker CMD) gives `argv[1] = …/worker.ts`, so the worker is labelled `worker`. Web gets `NEXT_RUNTIME`.

### 5. Indexes

| Index | Query (verified in code) | Existing overlap |
|---|---|---|
| `login_tickets_token_idx` (partial, not NULL) | `telegram.ts:188` `WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE` | none (only `nonce` PK and `expires_idx`) |
| `sessions_revoked_idx` (partial) | `session.ts:262-263` purge `expires_at < … OR (revoked_at IS NOT NULL AND revoked_at < …)`, which gives BitmapOr with `sessions_expires_idx` | none |
| `login_codes_expires_idx` | `session.ts:268` `DELETE … WHERE expires_at < now() - '1 day'` | `login_codes_ident_idx (identifier, created_at)` does not help |
| `game_sessions_expires_idx` (partial) | `game-sessions.ts:274` | `game_sessions_user_idx` does not help |
| `generations_queued_created_idx` (partial QUEUED) | `jobs.ts claimJob` `status='QUEUED' AND run_after <= now() ORDER BY created_at LIMIT 1` | `generations_queue_idx` is on `run_after`, so it cannot give `created_at` order; this one is complementary |

- **Planner:** EXPLAIN tests with `enable_seqscan=off` show each index is picked.
- **Write cost:** no new HOT-update cost. `status` is already in the predicates of partial indexes, `revoked_at` is set only on logout, and `last_seen_at` is still unindexed.
- **Names:** match the existing `<table>_<col>_idx` style.
- **Rollback:** the header rollback (5 × `DROP INDEX IF EXISTS` plus the `schema_migrations` delete) is correct and complete.

---

## Nits (non-blocking)

1. **Retry on deadlock too.** Retry on `40P01` (deadlock_detected) as well as `55P03`. A multi-table SHARE-lock migration like 023 can be chosen as the deadlock victim. Today that crashes the process and relies on a Docker restart, which works, but an in-process retry is cleaner.
2. **Server-side dead-client check.** Set `client_connection_check_interval = '10s'` (PG14+, and prod runs 16) on the migration session. Without it, if the process is SIGKILLed mid-`CREATE INDEX`, the orphaned backend keeps building while holding the advisory lock and the SHARE locks until the statement finishes, because `statement_timeout` is 0. Client-side `keepAlive` does not cover this.
3. **Lower the default `lockTimeoutMs` to 5 s**, to match the `SET LOCAL '5s'` convention in 022/023. A 10 s ACCESS EXCLUSIVE queue stalls every request to that table for 10 s.
4. **`scripts/migrate.ts`** now calls `pool().end()` on a pool that `migrate()` never creates. It is harmless (constructing a Pool does not connect), but the line can go.
5. **Rollback comment:** mention that `DROP INDEX CONCURRENTLY` (run outside a transaction, one per statement) avoids ACCESS EXCLUSIVE on `generations` and `sessions` when rolling back on a live system.
6. **`processRole`:** the `/next/i` match is broad, so any CLI script with "next" in its name is labelled `web`. It only affects the label. Consider `/^next(-server)?\b/`.

---

## Re-review — 2026-09-24 (`c4e0d32`, `afbe09c`)

### Verdict: **APPROVE**

- **R1 (false "pool full" warning): fixed.**
  - The check now runs in `setImmediate`, which fires after pg-pool has handed idle clients out on `nextTick`. It warns only when `waiting > 0 && idle === 0 && total >= max`.
  - My original repro now prints `warnings: []`. The repro is a second sequential `SELECT 1` on a warm pool with `total 1, idle 1, waiting 0`.
  - The saturation burst test (max 3, 8 parallel) still warns exactly once, and the rate limit still holds.
  - New regression test "iliq hovuz" covers sequential queries, a transaction, and parallel queries below max.
  - The cost is one `setImmediate` per query, which is negligible.
- **R3 (`DATABASE_STATEMENT_TIMEOUT_MS=0`): fixed.** A value of 0 now gives `query_timeout: undefined`. A live 5.5 s `pg_sleep` passes on a pool built from that config.
- **R2 (compose / `.env.example` passthrough):** accepted as a hand-off to W3-F and the orchestrator, not blocking this package. It must still land before deploy, or the two knobs stay decorative in prod.
- **Tests:** `db-migrate`, `db-indexes` and `migrations` through `heavy2.sh -m 3G -t 900` gave **19 pass, 0 fail, 0 skipped**.
- **Nits 1–6 from the first review:** still open and optional. Nits 1 (deadlock retry) and 2 (`client_connection_check_interval`) are the most worthwhile. The deploy.sh health-poll change (5 min, or a separate migrate step) remains a recommendation for the owner.
