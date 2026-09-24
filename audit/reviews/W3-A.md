# Review — W3-A (worker lease, hard stop, SIGTERM drain, atomic cancel/activatePro, Idempotency-Key)

Reviewer: independent, read-only · 2026-09-24
Branch: `worktree-agent-aeb69e3d512dfcba1` (`276c030`, `01206ea`, `e5be1bf`, `27fb3c6`) vs `audit/production-readiness`
Findings: INFRA-02, CONC-03, DB-05, BEB-02, FILE-05, SCALE-11, CONC-06, CONC-14, CONC-10, FE-06 (server side)

## Verdict: **APPROVE** (no required changes; nits below)

## Tests

- Suite from the brief (worker-lease, credits-atomic, generations-idempotency, queue, admission, refund-reconcile), run against the audit Postgres through heavy2.sh: **46/46 pass**. No tests were skipped, so the DB-backed tests ran for real.
- `tests/migrations.test.mts`: 7/8 pass. The one failure is the expected numbering test (`expected: 23, actual: 24`), because `023` lives in another branch. The new C34 test for the shape of `024` passes.
- `tsc --noEmit`: only one error, `tests/env-worker-inline-default.test.mts(13,52)`. That file comes from the W2 wrap-up and is not in this diff. W3-A adds no type errors, and the overload change to `enqueueGeneration` type-checks at every caller.

## Checklist

### 1. Lease fencing — OK
- `newLease` is `${WORKER_ID}:${uuid}` and is created for each claim (`claimNext`). The value is carried on `ClaimedJob.lease`. `locked_by` is `TEXT` (001), so the longer value fits.
- These writes all go through `job.lease`: `setProgress` (ticker and `onStage`), `heartbeat`, `LiveReporter` → `setLive`, `setCost`, `commitJobResult`, `failJob` (normal, unknown-tool and hard-stop paths), and `releaseJobs`. A grep finds no remaining `WORKER_ID` write.
- The `locked_by` format is opaque everywhere else:
  - `reclaimStaleJobs` only sets it to NULL.
  - `expireQueuedJobs` (W2-D2) only touches QUEUED rows.
  - The fair-claim SQL (W2-B) counts `IN_PROGRESS` rows per user and never reads `locked_by`.
  - The deep health SQL (W2-D1) reads only `status` and `locked_at`.
  - The refund reconciler (W2-D2) keys on `status='FAILED'` plus the `charge`/`refund` rows, so it is unaffected and still covers the non-atomic `failJob` → `refund` step on the hard-stop path.
- `commitJobResult` behaves correctly under concurrent completion and failure:
  - It locks the row with `SELECT … FOR UPDATE` on `id + lease + IN_PROGRESS`, then writes the file, the assets and COMPLETED in one transaction on the same client.
  - It does not write anything unless the claim is still ours, and the `!won` destructive delete is gone.
  - Under READ COMMITTED, EvalPlanQual re-checks the predicate, so COMPLETED and FAILED for the same claim are mutually exclusive in both orders.
  - The ABA test (same process re-claims its own job) passes.
- Accepted per the CONC-06 fix notes: two mid-run asset writes are not fenced. They are `putAssetBytes` (TTS) and the `putAssets` from `LiveReporter`. Both are content-addressed with `ON CONFLICT DO NOTHING`, and nothing deletes another claim's assets any more.

### 2. Hard stop — OK
- `Promise.race(work, timer at jobDeadlineMs + 30 s)` fires `ctl.abandoned = true`, then `failAndCleanup(lease)`.
  - The refund happens only if `failJob` wins the lease, and it is idempotent by `reference`.
  - A late finish returns at the `abandoned` check. Even past that check, `commitJobResult` is fenced (status is FAILED).
  - A late throw goes to `failAndCleanup`, where `failJob` returns false, so there is no second refund and no delete.
- Slot accounting:
  - Every `running++` in `tick` has exactly one `.finally(running--)` on `runJob`.
  - `runJob` settles when the hard-stop timer fires, whatever the build does.
  - If `failAndCleanup` throws (DB down), `runJob` rejects and is still decremented.
  - So `running` cannot go negative or leak.
  - In that DB-down case the row stays IN_PROGRESS with no heartbeat, and the reaper requeues it later. That is correct.
- Timing: the hard stop fires at budget + 15 s, before the reaper threshold (budget + 30 s since the last heartbeat).

### 3. SIGTERM — OK
- The drain sequence:
  - `stopped` blocks new claims, and a claim that was still in flight when the signal arrived is released at once (`tick` checks after `claimNext`).
  - The worker waits up to 20 s for in-flight jobs.
  - It then sets `abandoned` on the rest and calls `releaseJobs(leases)`, which returns only this process's claims to QUEUED with `attempts - 1` and `run_after = now()`.
- The old process's leftover writes then fail on `locked_by` (the test shows a new owner keeps its row and no file is written).
- A job that completes at the same moment the release runs is handled correctly: the row lock serialises them, and the release is a no-op on a COMPLETED row.
- Attempts: `GREATEST(attempts - 1, 0)` exactly undoes the claim's increment, so a deploy never exhausts retries. That matches the INFRA-02 option. The owner decision on whether a deploy should count as an attempt is still recorded as open in the verify queue.
- Timing: 20 s wait + one UPDATE + exit fits inside `stop_grace_period: 30s`. The container runs `init: true` (tini) → tsx CLI (relays the signal) → node, and the handler is registered, so the child does not exit early. If the release fails, the process still exits and the reaper covers the jobs.

### 4. Lock order — no new deadlock
- The order is generations row → users in all of these:
  - cancel (`UPDATE generations` then `refundInTx` users FOR UPDATE)
  - `expireQueuedJobs`
  - the reconciler
- W3-C settle takes `payment_orders` → users. `activateProInTx` / `topUpInTx` lock only users.
- Enqueue takes users (`FOR NO KEY UPDATE` → `chargeInTx` FOR UPDATE), then INSERTs a new generations row.
- None of these transactions forms a cycle on the same rows. There are two theoretical edge cases (nit 3).

### 5. Idempotency — OK
- A replay returns the original `id` and the original `price` with the same 202 body. It takes no charge and does not run the admission check again. It adds the header `Idempotent-Replayed: true`.
- Scope:
  - Keys are per user: the lookup filters on `user_id`, the unique index is `(user_id, idempotency_key)`, and there is a test for it.
  - The 24 h window is enforced in SQL (`created_at >= now() - 24h`). Under the user lock, an older row is un-keyed first so the unique index frees up.
- Concurrency: parallel duplicates are serialised by the user-row lock, which makes the READ COMMITTED re-read see the committed row. The 23505 fallback is matched on the constraint name and tested.
- A 429 (admission) or `insufficient` result stores no row, so a retry with the same key is a fresh attempt. The key is never logged or echoed back.
- Migration 024 is backward compatible: a nullable column with no default, a partial unique index `WHERE idempotency_key IS NOT NULL`, `lock_timeout` set, and the rollback steps in the comments.
- FE-06 is only half closed. No client code sends the header yet (a grep finds none), so the client side must land in another package before FE-06 can be marked fixed.

## Nits (non-blocking)

1. **Orphan builds are unbounded.** After a hard stop the orphan keeps its CPU, memory and provider spend (and soffice/sharp), and the slot is reused at once. A systemic hang, such as a stuck provider, can pile up orphans until the container hits its 2 GB OOM. Suggestions:
   - Count orphans, and pause claiming (or exit for a Docker restart) when the count reaches `concurrency`.
   - Log the orphan count.
   - W3-B's deadline enforcement is the real mitigation.
2. **Cleanup runs before `live.stop()`.** On the hard-stop path (and, as before, on the catch path), `failAndCleanup` runs `deleteAssets` before the `finally` awaits `live.stop()`. `live.stop()` drains `assetQueue`, so queued slide-image `putAssets`, or an in-flight TTS `putAssetBytes`, can land after the delete. The result is stray asset rows on a FAILED job: a storage leak, with no effect on money. Stop the reporter before `failAndCleanup`.
3. **Two theoretical lock-order edge cases.** Neither is new in practice, but both are cheap to remove:
   - The key path takes `FOR NO KEY UPDATE`, and `chargeInTx` later upgrades it to `FOR UPDATE`. That upgrade can deadlock against a transaction that holds `KEY SHARE` from an FK insert and then wants the user lock. The pattern already exists via `admitInTx`. Taking `FOR UPDATE` up front removes it.
   - The UPDATE that un-keys rows older than 24 h locks old generations rows *after* locking users. That is the reverse of the reconciler's order, but a cycle needs the same key reused after 24 h on a row that is being reconciled at that moment. Negligible.
4. **Same key, same tool, different payload replays silently.** Stripe-style APIs return 422 here. Consider storing a hash of `(tool, values)`. Also, the replay body always says `status: "QUEUED"`, even when the original has since been REVOKED or FAILED. The contract asks for an identical body, so this is accepted, but it is worth documenting for the client.
5. **Test gaps.** None of these paths is covered:
   - A late *throw* after the hard stop (no second refund).
   - 429 admission, then a retry with the same key, gives a fresh 202 with one charge.
   - The `tick` path where a claim arrives after `stopped` and is released.
   - The logic reads correctly for all three.
6. **`completeJob` looks dead.** It is still exported without the owner-checked transaction and only tests use it. Mark it test-only or remove it, so a future caller does not bypass `commitJobResult`.
7. **The inline worker has no graceful drain.** Its SIGTERM goes to Next. It is off in production (CONC-17), so this is acceptable. Note it in the docs.
