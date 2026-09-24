# W4-B review — SCALE-16, DB-12/SCALE-13 (027), DB-14/CONC-15, BEB-07, W3-A nits, BEA-12/BEA-13

Reviewer: independent, read-only. Branch `worktree-agent-aa41c7a94ce008cf8` (`8910a18`…`5a6e0e1`, `b01c5c8`, merge `2ba40fe`) vs `audit/production-readiness`.

## Verdict: **CHANGES REQUESTED** (1 required change)

The queue core is sound:
- The lease cadence, the hard stop, the 027 indexes, HOT, the thumbnail version keying, the idempotency comparison and the progress floor all check out.
- I reproduced the EXPLAINs and the HOT ratio myself.

The one blocker is a liveness regression in the housekeeping leader lock. `reclaimStaleJobs` (and with it stale-job refunds, queue TTL and refund-reconcile) now runs **only** in the leader process. A leader that is wedged but still connected holds the lock forever. No other replica then rescues stuck jobs, and that includes the wedged leader's own jobs.

## Tests

All runs used `heavy2.sh -m 3G -t 900` from the worktree root against `:55439`.
- **The 12 requested files, 76/76 pass**: worker-housekeeping-lock, queue-indexes, worker-heartbeat-rate, thumb-version, progress-monotonic, worker-orphans, generations-idempotency-payload, generations-delete-status, generations-idempotency, cache-headers, worker-lease and migrations.
- **Neighbouring suites, 52/52 pass**: worker-heartbeat, worker-housekeeping, queue, admission, db-indexes, thumb, jobs-queued-ttl, worker-resilience and worker-user-error.

## Required changes

1. **A wedged housekeeping leader must not stop stale-job recovery for the whole cluster** (`lib/server/worker.ts` `housekeepingTick` / `loop`).
   - **How the lock is held.** It is a session-level lock on a dedicated `pg.Client` with `keepAlive: true`. The kernel answers TCP keepalives even when the Node event loop is blocked (CPU-bound build or parser, a runaway regex) or when `loop()` is stuck on some await. The process can also be `docker pause`d. In all these cases Postgres keeps the backend and the lock.
   - **What stops.** The follower's `pg_try_advisory_lock` returns false every minute, forever. So `reclaim` (with refunds), `queue-ttl` and `refund-reconcile` stop for **every** replica.
   - **Why nothing recovers.** The wedged leader's own IN_PROGRESS jobs stop heartbeating, and no one reclaims them. Before W4-B, the healthy replica reclaimed them within budget+30 s. `docker-compose.yml` has `restart: unless-stopped`, which does not restart an *unhealthy* container. So nothing recovers until someone intervenes by hand, while users watch a spinner with their money held.
   - **Fix, either one:**
     - (a) **Preferred, smallest.** Run the cheap, concurrency-safe steps outside the lock in every process: `reclaim` + reclaim-refund, `queue-ttl` and `refund-reconcile`. They are row-predicate UPDATEs, and a concurrent second UPDATE re-checks the predicate after the row lock. Refunds are idempotent on `(kind, reference)`, and TTL already uses `WHERE status='QUEUED'`. Gate only the duplicative, heavy purges (retention, sessions, sources, payment events…) behind the lock.
     - (b) **Leader takeover.** A follower that finds the lock busy looks up the holder's pid in `pg_locks` (advisory, `objid = HOUSEKEEPING_LOCK_ID`). If that backend's `pg_stat_activity.query_start` is older than about 5 × `HOUSEKEEPING_MS`, the follower calls `pg_terminate_backend(pid)` and takes the lock. The leader's `stillLeader` query runs on the lock connection every tick, so `query_start` already serves as a leader heartbeat. The same role may terminate its own backends.
   - **Test.** Hold the lock from a separate session that never queries again (a simulated wedge), backdate an IN_PROGRESS row's `locked_at`, and assert that the other process's tick still reclaims it: with (a) always, with (b) after the staleness window. The mutation to check is gating `reclaim` behind the lock again, which must turn the test red.

## Verified (no change needed)

**1. Lease vs staleness**
- **Threshold.** The reclaim threshold is `locked_at < now() − (budget + 30 s)`. It is measured from the last lease write and has not changed.
- **Fake curve.** The ticker runs every 2 s and writes when the value changed and the gap is ≥ 4 s, or when the gap is ≥ 10 s. The worst-case lease age is about 12 s plus any event-loop stall.
- **Live mode.** The heartbeat is skipped only when `max(lastLeaseAt, live.lastWriteAt)` is < 10 s old. `lastWriteAt` is set only after a *successful* `setLive`, which bumps `locked_at`. A stalled `putAssets` inside the reporter falls back to the heartbeat within 10 s.
- **Translation.** In `isLive` mode it heartbeats every 10 s in addition to `onStage` writes. That is harmless.
- **Stall headroom.** A crossword stall of ≤ 20 s gives a lease age of ≈ 32 s. The smallest threshold is 30 s + budget, so a healthy job never looks stale. The margin shrank by about 10 s compared with the old 2 s cadence, and it is still comfortable.
- **Hard stop, still correct.**
  - The hard stop is `max(30 s, budget − 15 s) + 30 s` from claim.
  - The ticker keeps refreshing the lease through the new `quiesce` (≤ 15 s), because `stop()` runs in `finally`, after `failAndCleanup`.
  - Reclaim therefore cannot pre-empt the hard-stop FAILED+refund path.
  - `failJob` clears `live_json`, so a final `live.stop()` flush is harmless.

**2. Migration 027**
- **Idempotent.** It uses `IF [NOT] EXISTS` and a repeatable `SET (fillfactor)`.
- **Backward compatible.** No code references the dropped index names, and old code plans onto `generations_queued_created_idx`.
- **Rollback.** The documented rollback SQL is correct. I executed it on the scratch DB and then re-applied 027.
- **Locks.**
  - `CREATE INDEX` takes SHARE, which blocks writes to `generations` for the duration of a **full heap scan**. A partial index still scans every row.
  - Both `DROP INDEX` statements take ACCESS EXCLUSIVE until COMMIT, which is milliseconds. The acquisition is bounded by `lock_timeout = 5s`, the 023 pattern.
- **Build time, measured.** 300 k rows, 586 MB heap (1.5 KB inline html per row), PG 16:
  - `CREATE INDEX` 103 ms warm;
  - `DROP INDEX` 1.1 ms and 0.5 ms;
  - `ALTER` 0.4 ms.
- **Prod estimate.**
  - **Today:** dumps are 332–377 MB in total and mostly `bytea` in `generation_files`/`generation_assets`, so the `generations` heap is tens of MB and the build takes tens of ms. Fine.
  - **At the audit's 50 k-user scale:** a 2–6 GB heap would take roughly 5–30 s of cold I/O under SHARE lock. Enqueue, claim and heartbeats would pause, with no data loss. See nit 1.
- **Fillfactor.** `SET (fillfactor=90)` changes metadata only (SHARE UPDATE EXCLUSIVE) and affects new pages only. That is correct.
- **HOT.** After 027 the indexed columns on `generations` are:
  - `id`, `user_id`, `created_at`, `finished_at`, `files_purged_at`, `idempotency_key`;
  - plus `status` through the partial-index predicates.

  None of `locked_at`/`progress`/`step`/`live_json`/`live_seq` is among them. I measured **120/120 HOT** for 40 × (heartbeat, setProgress-style, setLive-style) autocommit updates on a freshly claimed row. Inside one transaction it is 31/60, because pruning cannot reclaim same-xact versions. Production writes are autocommit, so this doesn't matter.
- **EXPLAINs.** Scratch DB, 300 k COMPLETED/FAILED rows + 40 QUEUED + 8 IN_PROGRESS, ANALYZEd, planner defaults (no `enable_seqscan=off`):

  | Query | Plan | Time |
  |---|---|---|
  | claim | Index Scan `queued_created_idx` + SubPlan Index Only Scan `running_user_idx` | 0.12 ms |
  | admission | `queued_created_idx` ×2 + IOS `running_user_idx` | 0.15 ms |
  | reclaim | Index Scan `running_user_idx`, `locked_at` filtered on 8 rows | 0.10 ms |
  | queue TTL | `queued_created_idx` Index Cond `created_at <` | 0.02 ms |
  | queue position | `queued_created_idx` | 0.06 ms |
  | list-by-user | `generations_user_idx` + incremental sort | 0.30 ms |

  The only seq scan is `/api/health`, and it was already one before W4-B (see nit 2).

**3. Housekeeping lock: connection, recovery, correctness**
- **Dedicated client.** The follower's client is `end()`ed in `finally` when the lock isn't won. A failed `connect()` leaves no socket.
- **Timeouts.** `poolConfig()` is honoured by `pg.Client`: `connectionTimeoutMillis`, `query_timeout` = statement timeout + 5 s, `statement_timeout` and `keepAlive`. So `stillLeader` cannot hang on a half-open socket.
- **Connection loss.** A dropped connection is detected by `stillLeader`, then `dropLeader`, then a re-acquire.
- **Advisory keys.** `classid=0, objid=727000002` is right for a single-bigint key < 2³².
- **Pool vs dedicated client.** A dedicated client is the correct choice. A session lock taken through the pool would stick to an arbitrary pooled connection. `idleTimeoutMillis` would then drop it, or another checkout would inherit it. Shutdown calls `process.exit`, and the socket close frees the lock. The remaining problem is item 1.

**4. Thumbnail version guard**
- **One snapshot.** Bytes and `file_version` come from one statement, so they come from one snapshot. `slide-commit` and `doc-polish` write the file and `markFileVersion` in one transaction.
- **Keyed by that version.** The thumb is keyed by *that* version. Old bytes can therefore never land under a newer key.
- **Monotonic version.** `file_version` only increases (`markFileVersion … < $3`, retention `GREATEST`).
- **Write-once keys.** `ON CONFLICT DO NOTHING` makes each version key write-once, and v0 is exactly the legacy `THUMB_ASSET_ID`.
- **Cache check.** The route compares `?v=` with the version the thumb was built from.
- **Residual race, harmless.** An `EXISTS` evaluated just before a rebuild commits can still write a row under the *old* key. No reader ever reads that key (nit 3).

**5. Idempotency 422**
- **Canonical comparison.** It compares `values_json = toJsonb(values)::jsonb`, the exact value that was inserted. JSONB equality ignores key order and whitespace, and it compares numbers numerically (1 = 1.0).
- **No false 422 on a retry.** The client reuses a key only when the serialized body string is identical (`submitKey`), so a true retry has byte-identical values.
- **Deterministic server rewrites.** The server-side rewrite (the translation `sourceChars`/`fileName`/`sourceKind` from `source_uploads` keyed by content hash) and `cleanText` are deterministic.
- **Stored values never change.** `values_json` is never updated after insert.
- **Both paths.** The 23505 rival path compares too.

**6. The two edited tests**
- **`generations-idempotency`.** The 202 → 422 change for the same key with a different topic is the intended new contract (W3-A nit 4). The rival row now carries the same `values_json`, because a NULL payload would correctly be a conflict. The test still asserts no second job and no second charge.
- **`cache-headers`.** It only re-keys the seeded asset to `thumbAssetId(3)`, matching `file_version = 3`. The assertions for `immutable`, stale `v`, no `v` and 404 are unchanged.
- **Verdict.** Neither edit weakens an assertion.

**7. Other items**
- **BEA-12.** DELETE returns 404 when `generationStatus` is null, and 409 otherwise.
- **BEA-13.** `?since`: non-digit input → ignored, out-of-int4 → 400.
- **BEB-07.**
  - Claim uses `GREATEST(progress,5)` and sets «Qayta boshlandi» only when `started_at` is set.
  - All three writers (ticker, `onStage`, `LiveReporter`) go through `monotonicProgress`.
  - No path requeues a FAILED/COMPLETED row, so no row with progress 100 can be re-claimed.
- **Orphan cap.** Correct in the normal case.
- **`quiesce`.** It is bounded at 15 s.
- **`completeJob`.** It is marked `@deprecated` for tests only.

## Nits (non-blocking)

1. **027 header comment.** «qurilish millisekundlar» is only true at today's size. A partial index build still scans the whole heap under SHARE (write-blocking). Say so, and note that at a multi-GB heap this migration should become `CREATE INDEX CONCURRENTLY` outside a transaction, or run in a quiet window.
2. **027 header comment.** It says «/api/health shu kichik qisman indeks bo'ylab o'qib». That is wrong: the health query's `FILTER` aggregates run a **Parallel Seq Scan** over the whole table (113 ms at 300 k rows). The scan predates W4-B. Fix the comment, and consider a follow-up that rewrites health as subselects on the partial indexes, like `ADMISSION_COUNTS_SQL`.
3. **`storeThumb` GC.**
   - A stale-race row under an old key, written after the newer thumb's GC already ran, survives until the next version bump.
   - Version jumps > `THUMB_GC_VERSIONS` (1000) leave the older keys behind. `file_version` jumps to `doc_version`, and many edits can make that jump large.
   - Both leaks are tiny: one small JPEG each.
4. **Orphan cap liveness.** If a build promise never settles, which is exactly the case the hard stop exists for, `orphans` never drops. At `WORKER_CONCURRENCY` such builds the worker stops claiming for good, yet keeps touching the alive file and looks healthy.
   - Consider this rule: saturated for more than N minutes → stop touching alive, or `process.exit(1)`. `restart: unless-stopped` then brings the container back clean.
   - At minimum, include `orphans` in the alive/health output.
5. **Follower connection churn.** Each follower opens and closes one connection per minute. That is fine. Keeping the follower client open would also work, but it isn't needed.
6. **Session advisory locks and PgBouncer.** They are incompatible with PgBouncer transaction pooling. Add a one-line note next to `HOUSEKEEPING_LOCK_ID` for the future.
7. **Formatting.** `lib/server/live.ts` has `monotonicProgress(this.claim,liveProgress(...` with a missing space after the comma.

---

## Re-review — commit `51e3dc4`

### Verdict: **CHANGES REQUESTED** (R1 is fixed; one new required change, test-only)

### R1: resolved
- **The split.** `housekeepingTick` now runs `recoverJobs()` first, in every process and without the lock:
  - `reclaim` + per-job refund/cleanup;
  - `queue-ttl`;
  - `refund-reconcile`.

  Only `purgeHousekeeping()` stays behind the advisory lock. `step()` swallows errors from each recovery step, so a failing step can't skip the purge or throw out of the loop.
- **Behaviour.** A wedged-but-connected lock holder now delays only the purges. Money and queue state are no longer affected.

### Exactly-once under concurrency, all three recovery steps
- **reclaim.** It is a pair of row-predicate `UPDATE … WHERE status='IN_PROGRESS' AND attempts … AND locked_at < …` statements in one transaction.
  - A concurrent second process blocks on the row lock. It then re-evaluates the predicate (EvalPlanQual), sees QUEUED/FAILED and gets 0 rows. So a dead job is returned in `dead` by exactly one process.
  - The refund goes through `refund()` → `refundRatio`: a check, then an INSERT guarded by the unique `transactions_ref_idx (kind, reference)`.
  - Even if two paths raced past the check, one INSERT hits 23505 and its whole transaction, including the `users` UPDATE, rolls back. Money moves once.
  - Cleanup runs in `finally`, so it happens either way.
- **queue-ttl.** A per-row transaction runs `UPDATE … WHERE id=$1 AND status='QUEUED' AND created_at < …` and calls `refundInTx` in the **same** transaction. Only the winner of the row update refunds; the loser gets 0 rows and returns `false`.
- **refund-reconcile.**
  - Candidates need `NOT EXISTS refund`. Each one takes `SELECT … FOR UPDATE` on the generation row, which serialises reconcile against reconcile. `refundInTx` then re-checks inside the transaction, and the unique index is the final guard.
  - The 120 s grace keeps it off a fresh reclaim or failure refund. If they ever overlap, the unique index still keeps it to one refund.
- **The new test.** `tests/worker-housekeeping-wedge.test.mts` covers this.
  - Setup: a separate session holds the lock and never speaks. There is one stale IN_PROGRESS job at attempts 2, one expired QUEUED job and one unrefunded FAILED job.
  - Action: three parallel `housekeepingTick`s.
  - Asserts:
    - all three jobs are FAILED;
    - exactly one refund each;
    - the balance is restored exactly;
    - no purge ran;
    - a fourth tick adds no refund.

  Its stated mutation, gating `recoverJobs` behind the lock again, would leave all three rows unrecovered.

### Tests (`heavy2.sh -m 3G -t 900`, `DATABASE_URL=…:55439/slaydx`)
- **Combined run.** 23 files: all W4-B tests, the new wedge test, and the worker/queue/admission/thumb/ttl/resilience/payment-events neighbours.
  - **130/131 pass.** The one failure is `worker-housekeeping-wedge`: `uncaughtException 57P01 terminating connection due to administrator command`.
- **Isolation check.**
  - wedge + lock run **sequentially** (`--test-concurrency=1`): 7/7 pass, 3 out of 3 runs.
  - The same two files run **in parallel**, the runner default: they fail 3 out of 3 runs with the same 57P01.

## Re-review required change

R2. **Scope the lock test's backend kill to its own database, and give the wedge test's client an error listener.**
- **Cause.** The kill is in `tests/worker-housekeeping-lock.test.mts:97`: `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND granted AND pid <> pg_backend_pid()`.
  - It has no `database` filter. `pg_locks` is cluster-wide, and every test file uses its own isolated database on the same cluster.
  - So when the files run in parallel, it also kills the wedge test's «wedged» session in another database.
  - That `pg.Client` has no `'error'` listener, so the kill becomes an uncaughtException and the file goes red.
- **Impact.** Deterministic red in any parallel `node --test` run over both files, which includes the full suite and CI.
- **Fix.**
  - Add `AND database = (SELECT oid FROM pg_database WHERE datname = current_database())` to the lock test's kill.
  - Add `wedged.on("error", () => {})` in the wedge test.
  - Optional: give the lock test's own `pg.Client`s the same listener.
- **Product code is fine.** Advisory keys are per-database, and `stillLeader` filters on `pid = pg_backend_pid()`.

### Nits carried over
Nits 1–7 from the first review still apply. Nit 1 (the 027 comment «millisekundlar»/heap scan) and nit 2 (the `/api/health` seq-scan comment) are still unaddressed; neither is blocking.

## Orchestrator verification (5b190c4): **APPROVE**
R2 (test-only) fixed: `pg_terminate_backend` filtered by `current_database()`; side sessions have error listeners. Ran worker-housekeeping-lock + worker-housekeeping-wedge together (concurrency 2) twice via heavy2.sh: 7/7 each.
