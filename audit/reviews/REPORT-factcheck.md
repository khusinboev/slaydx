# REPORT.md fact-check

Independent verification of `audit/REPORT.md` against `audit/00-baseline.md`, `audit/02-triage.md` (§9 appendix),
`audit/03-progress.md`, `audit/reviews/*.md`, `audit/designs/*.md`, `audit/DEPLOY-RUNBOOK.md`, `.claude/deploy.md`,
`git log 76ddf91..HEAD`, and the code itself, on branch `audit/production-readiness` (baseline `76ddf91`,
current HEAD `2888842`). Read-only; no heavy commands were run.

Method for the appendix: every one of the 194 rows had its Cluster/Final-sev/Wave columns diffed
programmatically against `audit/02-triage.md` §9 (exact string match required), and all 117 unique commit
hashes cited in the appendix were checked for existence in the repo. A random sample of 50 rows (26%,
exceeds the >=40-row requirement together with the full-table structural check) was checked by hand: does the
cited commit's own message mention the finding ID, and does the message's own partial/deferred/documented
language (if any) match the REPORT's status glyph for that specific ID (not a neighbouring ID in the same
merge commit).

## Section 1 -- Executive summary

| Claim | Verdict | Evidence | Correction |
|---|---|---|---|
| All 6 P0 clusters closed (C01,C02,C03,C04,C06,C10) | OK | `audit/02-triage.md` §3 lists these as the P0 clusters; appendix shows all their member findings fixed/partial (none open) | -- |
| 15 P1 clusters closed, 4 P1 findings partial | OK | Counted appendix: P1 findings ABUSE-05, SECA-03, DB-06, SCALE-08 are the 4 partial rows among P1-severity findings | -- |
| Lease-fenced claims, file+assets+COMPLETED in one tx | OK | `lib/server/worker.ts` uses `job.lease` throughout claim/heartbeat/complete path; W3-A commit `01206ea` message: "per-claim lease fencing + owner-checked result commit" | -- |
| Hard deadline with exactly-once refund | OK | `lib/generation/deadline.ts` (`DeadlineError`), `worker.ts:470` `failAndCleanup` on deadline | -- |
| QUEUED TTL, 429+ETA admission, SIGTERM drain, bounded refund reconciler | OK | `lib/server/queue-ttl.ts` (`QUEUE_TTL_SEC`, default 2700s), `lib/server/refund-reconcile.ts`, `worker.ts:1157` `process.on("SIGTERM", shutdown)` | -- |
| 2 workers x 4 slots | OK | `docker-compose.yml:226` `replicas: 2`, `:311` `WORKER_CONCURRENCY: ${WORKER_CONCURRENCY:-4}` | -- |
| Charge+enqueue, cancel+refund, Pro activation each in one tx | OK | `lib/server/credits.ts`: `chargeInTx`, `topUpInTx`, `activateProInTx`, called via `transaction(...)` wrappers | -- |
| Payme/Click settle/cancel serialised per order, logged in `payment_events` | OK | `lib/server/payments.ts:251,331` `SELECT ... FOR UPDATE` on `payment_orders`; `lib/server/payment-events.ts`, migration `025_payment_events.sql` | -- |
| `Idempotency-Key` on `POST /api/generations` | OK | `app/api/generations/route.ts:144-187`, `lib/api-client.ts:452-486`, `lib/server/jobs.ts:188` | -- |
| LibreOffice behind process-wide semaphore + per-user limit | OK | W2-A merge `59f569f`: "LibreOffice gate (process-wide semaphore), per-user PDF limit" | -- |
| First-load JS 513->219 kB (`/uz/[slug]`) and 428->218 kB (`/uz/files/[id]`) | UNVERIFIABLE / likely inconsistent | `audit/reviews/W4-D.md:15`: reviewer states the source numbers as "517->219 kB and 442->217 kB first-load" and explicitly says "I did not rebuild to check ... myself". The W4-D merge commit `a10da35` message also says "517->219 kB, /uz/files 442->217 kB". `00-baseline.md` gives the true baseline as 513/428, matching REPORT's before-numbers, but REPORT's after-number for the second route (218) doesn't match the only source that measured it (217), and that source was never independently rebuilt-and-confirmed by the reviewer. | Change "428 -> 218 kB" to "428 -> 217 kB", or add a caveat that the post-W4-D figure is self-reported by the fixer and was not re-measured by the reviewer or this fact-check (a rebuild could not be run here per the no-heavy-commands rule) |
| Fail-fast boot | OK | `instrumentation.ts` / W2-D1 commit `4cbb6d4`: "exits on fatal boot config instead of zombie-throw" | -- |
| Structured JSON logs with request IDs and redaction | OK | W3-D merge `b4a9ff1`: "structured JSON logging with redaction + request ids" | -- |
| Deep health check, worker heartbeat, HEALTHCHECK | OK | W2-D1 `9c7d682`/`3ca25b2`: "worker HEALTHCHECK + deep health"; worker heartbeat file confirmed present at every gate in `03-progress.md` | -- |
| Container limits, log rotation, CI workflow, pinned images | OK | `docker-compose.yml` `mem_limit`/`cpus`/`logging`; `.github/workflows/ci.yml` exists; `Dockerfile:15` `ARG NODE_IMAGE=node:22.23.2-alpine3.24`, `docker-compose.yml:9` `postgres:16.15-alpine3.24` | -- |
| Daily backup + restore-check scripts, 180-day bonus-file retention, IP/phone removed from tracked docs | OK | `scripts/backup.sh`, `scripts/restore-check.sh` exist; `lib/server/env.ts:272` `bonusDays: int("RETENTION_BONUS_DAYS", 180)`; W3-I commit `a455603`: "server IP / owner phone / co-tenant layout removed from tracked docs" | -- |
| Status counts: 177 fixed, 13 partial, 2 documented, 1 deferred, 1 open (194 total) | OK -- exact | Programmatic count of the appendix table: 177/13/2/1/1, sums to 194 | -- |

## Section 2 -- Verification (gate table + live smoke)

| Claim | Verdict | Evidence |
|---|---|---|
| Baseline row (76ddf91, 2637/2639, 248/248, 370/370, web serves 500s w/o token) | OK -- exact | `audit/00-baseline.md` matches verbatim |
| W1 row (5d09028, 2783/2785, 248/248, 373/373, ->022) | OK -- exact | `audit/03-progress.md` "W1 gate" line matches verbatim |
| W2 row (fa938a1, 2899/2901, 248/248, 401/401, ->022) | OK -- exact | `audit/03-progress.md` "W2 gate" line matches verbatim |
| W3 row (447c6a4, 3084/3085->15/15, 248/248, 432/432, ->026 + heartbeat) | OK -- exact | `audit/03-progress.md` "W3 gate" line matches verbatim |
| W4 row (f631257+cb7aee3, 3248/3254->"5 stale assertions updated, 21/21", 248/248, 453/453, ->027 + heartbeat) | WRONG (minor) | `audit/03-progress.md`'s own W4 gate entry says "All 6 failures were stale assertions" across 4 test files (telegram-429 x2, env-assert-runtime-config x1, credits-atomic x1, no-pii-in-repo x1-plus-a-subtest = 6), and "the 4 files pass 21/21". Commit `cb7aee3`'s title also says "5 stale assertions" but only touches 4 test files. REPORT's "5 stale assertions updated, 21/21" doesn't cleanly match either source number. | Say "4 stale-assertion test files (6 failing assertions) updated, 21/21" to match `03-progress.md`'s own count, or otherwise reconcile the "5" with the "6" already present in the audit's own log |
| Live smoke: 10/10 cases, cost_json.parts breakdown, 20s deadline -> DeadlineError after 13.7s, ~$0.7 of $5 budget | OK -- exact | `audit/03-progress.md` "Live smoke with real Gemini" section matches verbatim, including all 10 case names/times/calls, the cost_json breakdown ($0.0080/$0.028/$0.068), and the Google Books 403 fallback note |
| "+609 tests since the baseline" | WRONG (minor) | Baseline total 2639 -> W4 total 3254 = +615 total tests (or +611 using pass-count delta 3248-2637). No combination of the numbers already in `00-baseline.md`/`03-progress.md` yields 609. | Change to "+615 tests since the baseline" (using the total-test-count delta, the more natural reading) |

## Section 3

Placeholder (`<!-- P5 -->`) -- skipped per instructions.

## Section 4 -- What changed, by wave

Verified by sampling: for every package row (W1-A..E, W2-A..E, W3-A..J, W4-A..F), the cited cluster IDs and
finding IDs were cross-checked against the corresponding merge-commit message in `git log`. All matched. Examples:

| Row | Verdict | Evidence |
|---|---|---|
| W1-A / C01 | OK | `c0a3dec`: "forged Telegram contact can no longer grant admin ... (C01: SECA-01, DEPS-08, ABUSE-06, TEST-12 partial)" |
| W1-E / C10 | OK | `3368af3`: "free-LLM spend policy ... (C10: EXT-02, ABUSE-01, CONC-13, SCALE-14; CONC-11/BEA-11 partial)" |
| W2-A / C07 | OK | `59f569f`: "LibreOffice gate ... (C07: FILE-03, FILE-06, CONC-01, CONC-08, BEA-20, SCALE-04, SCALE-07)" |
| W2-D2 / C23,C27 | OK | `33c3591`: "bonus-only file retention (180 d, migration 022), QUEUED TTL ... (C23, C27, DB-10; FILE-01, DB-01, BEB-06, BEB-03, CONC-04, BEA-18)" |
| W3-A / C14,C15,C25,C26 | OK | `4a57589`/`01206ea`/`e5be1bf` messages cover lease fencing, hard deadline, SIGTERM drain, atomic cancel/Pro, Idempotency-Key |
| W3-I / C05 | OK | `a455603`: "server IP / owner phone / co-tenant layout removed from tracked docs ... ADMIN_PHONES env override" |
| W4-A / EXT-03,11,15 | OK | `f631257`: "every engine honours the job deadline ... full per-service cost_json telemetry, safeFetch for provider-supplied URLs ... (EXT-03, EXT-11, EXT-15)" |
| W4-C / SECA-04/05, EXT-14, DEPS-04 | OK | `04126b0`: "logout origin check ... magic link confirmed by POST ... separate TELEGRAM_WEBHOOK_SECRET ... next 15.5.26" |

No mismatches found in section 4.

## Section 5 -- Owner actions

| Claim | Verdict | Evidence |
|---|---|---|
| `ADMIN_PHONES` hardcoded fallback exists in `lib/server/admin-phones.ts`, meant to be removed after confirming | OK | `lib/server/admin-phones.ts:19-26`: comment explicitly describes this exact hardcode-fallback design and the owner step to remove it |
| `TELEGRAM_WEBHOOK_SECRET` falls back to `CRON_SECRET` with a startup warning | OK | `lib/server/env.ts:230-236,297-298,375`: "avval TELEGRAM_WEBHOOK_SECRET, u bo'lmasa zaxira sifatida CRON_SECRET"; warning text at line 375 |
| Payme/Click re-certify in sandbox; keep `PAYME_SANDBOX` empty in prod | OK | `lib/server/env.ts:222` `sandbox: bool("PAYME_SANDBOX", false)`; `.env.example:166` ships empty |
| Backups: install cron for `scripts/backup.sh` + `scripts/restore-check.sh`, off-box `BACKUP_REMOTE`, see `.claude/deploy.md` §1a | OK | Both scripts exist; `.claude/deploy.md:52` "### 1a. Kunlik avtomatik zaxira (C24, bir marta sozlanadi)"; `scripts/backup.sh:145-153` supports `BACKUP_REMOTE` |
| nginx: compare with `deploy/nginx/slaydx.conf.example` (ABUSE-05/SECA-03) | OK | Template file exists at that path |
| Historic refunds: query in `lib/server/refund-reconcile.ts` header, reconciler covers only jobs after migration 022 + 2 days | OK | `lib/server/refund-reconcile.ts` exists, mechanism confirmed |
| `purgeUnusedUploads` not wired in, by owner decision | OK | `lib/server/upload-quota.ts:65,249` and `worker.ts:904` all explicitly comment "ATAYIN ulanmagan" (intentionally not wired) |

## Section 6 -- Remaining risks

| Claim | Verdict | Evidence |
|---|---|---|
| ABUSE-02 bonus farming, owner kept the bonus | OK | Appendix row ABUSE-02: "open (owner decision: bonus kept ...)", matches `02-triage.md` §6 "Signup-bonus farming (ABUSE-02)" under Product decisions |
| Single box, no blue-green (INFRA-07) | OK | Appendix row INFRA-07: "documented (no blue-green deploy; short restart window)" |
| Files in Postgres `bytea` (DB-06/SCALE-08 partial) | OK | Both rows in appendix are partial; `bytea` column confirmed in `lib/server/migrations/001_init.sql:107` |
| XFF trust depends on nginx (ABUSE-05/SECA-03) | OK | Both rows partial, nginx template exists in repo per section 5 check |
| FE-10 Mini App auto-login off | OK | Appendix: "deferred (Mini App auto-login stays off; the HMAC needs a real initData capture)"; `03-progress.md` "W3 -- complete": "FE-10 ... deferred: reviving it opened a login-CSRF" |
| Provider quotas (EXT-06/07) | OK | Both "partial (per-source quota breakers; quotas themselves unchanged)" |
| DB-13 ledger CASCADE-deleted with user; no code path deletes users | OK | `grep -rn "DELETE FROM users"` returns nothing in `lib/`, `app/`, `scripts/`; appendix DB-13 is "documented" |
| Payment protocol not re-certified in sandbox | OK (consistent with section 5 owner action 3) | -- |

## Section 7 -- Optimisation opportunities

| Claim | Verdict | Evidence |
|---|---|---|
| Slide images stored twice (inside PPTX + as assets) | OK | `audit/designs/retention.md:7`: "slide images are stored twice: inside the PPTX and again as assets" -- same language as `02-triage.md` C23 |
| Stream `bytea` / object storage removes 4-6x memory copy | OK | `02-triage.md` appendix DB-06/SCALE-08: "4-6x the file size" language matches |
| `pg_stat_statements` preloaded (W3-F) | OK | `docker-compose.yml:48` `shared_preload_libraries=pg_stat_statements` |
| `scripts/cost-report.mts` exists, `cost_json` complete (OBS-07) | OK | File exists; appendix OBS-07 is "partial (cost_json covers every engine; no scheduled cost report/alert)" -- consistent with "not done" framing of section 7 |
| Blue-green web via nginx `upstream` (INFRA-07) | OK | Matches section 6/appendix framing that this is undone/documented only |

## Appendix -- full-table structural check (194 rows) + 50-row sample

- Cluster + Final-sev + Wave columns: programmatically diffed against `audit/02-triage.md` section 9 for all 194
  findings -- 0 mismatches.
- Commit existence: all 117 unique commit hashes cited across the appendix resolve with `git cat-file -e`
  -- 0 missing.
- Status-vs-commit-message consistency: random sample of 50 rows (26%) checked that (a) the cited commit's
  message mentions the finding ID verbatim, and (b) any "partial"/"deferred"/"documented" language in that
  commit message attached to that specific ID matches the REPORT's status glyph. 0 mismatches -- every
  status exactly mirrors what the commit message says about that ID (including cases where a single
  merge commit fixes several findings but marks specific sibling IDs as partial, e.g. `3368af3` fixes EXT-02/
  ABUSE-01/CONC-13/SCALE-14 as fixed while marking sibling CONC-11/BEA-11 partial -- REPORT reflects this
  distinction correctly for both sides).
- Spot-checked additionally (outside the random sample, for named rows worth extra care): BEA-11, CONC-11,
  DB-06, SCALE-08, ABUSE-05/SECA-03, EXT-06/EXT-07, FE-09, DB-11, DB-13, OBS-07, OBS-14, INFRA-07 -- all OK,
  statuses and evidence align with `02-triage.md`, `03-progress.md`, and commit messages.

No appendix row was found where "fixed" should be "partial" or vice versa.

## Diff-stat / commit-count claims (report header)

| Claim | Verdict | Evidence |
|---|---|---|
| 209 commits | OK (with a defensible reading) | `git log --oneline --no-merges 76ddf91..HEAD \| wc -l` = 209 exactly. (`git log --oneline 76ddf91..HEAD` including merges = 248; the report's number only works if "commits" means non-merge commits, which it does not state explicitly.) |
| 472 files, +45 111/-2 971 lines | OK -- exact | `git diff --stat 76ddf91..HEAD` tail line: "472 files changed, 45111 insertions(+), 2971 deletions(-)" |
| 146 test files (+18 543 lines) | OK -- exact | `git diff --stat 76ddf91..HEAD -- tests/` tail line: "146 files changed, 18543 insertions(+), 101 deletions(-)" |
| Migrations 022-027 | OK | `lib/server/migrations/022_retention.sql` and `027_queue_indexes.sql` both exist |

---

## Summary

Total items checked: sections 1, 2, 4, 5, 6, 7 (about 60 discrete claims) plus the full 194-row appendix
structural check plus a 50-row detailed sample.

Counts: 2 WRONG (both minor, both numeric footnotes in Section 1/2), 1 flagged UNVERIFIABLE/likely
inconsistent (also Section 1), 0 appendix-row status errors, everything else OK.
