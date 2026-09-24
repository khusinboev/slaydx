# SlaydX — production-readiness audit: final report

- **Branch:** `audit/production-readiness`, from `main` @ `76ddf91`, dated 2026-09-23 → 2026-09-24
- **Scope:** 209 commits, 472 files, +45 111 / −2 971 lines, including 146 test files (+18 543 lines) and migrations 022–027
- **Method:** 16 auditors → 194 findings → triage into 68 fix units → 4 fix waves (W1 P0 … W4 P3)
- **Rules for every package:**
  - regression test first (red before the fix, green after) plus a mutation check
  - an independent reviewer, never the fixer; second rejections decided by the orchestrator and logged
  - a full wave gate after each wave: typecheck, lint, unit, viewer and UI tests, `next build`, and a start smoke on a fresh Postgres

## 1. Executive summary

- **All 6 P0 clusters are closed.** Their root causes are fixed and locked by regression tests:
  - **C01:** admin takeover through a forged Telegram contact.
  - **C02:** `returnTo` DOM-XSS / open redirect.
  - **C03:** an emoji or NUL character gave a free document plus a refund.
  - **C04:** quadratic regexes froze the web process for minutes to hours.
  - **C06:** PDF/OOXML parsing froze the web event loop or allowed zip bombs.
  - **C10:** free LLM endpoints could burn unbounded provider money.
- **All 15 P1 clusters are closed.** 4 P1 findings are partial, with their remaining risk listed in §6.
- **The queue is now safe under restarts and load:**
  - lease-fenced claims, with file, assets and COMPLETED in one transaction
  - a hard deadline with an exactly-once refund
  - QUEUED TTL, 429 + ETA admission, SIGTERM drain, and a bounded refund reconciler
  - 2 workers × 4 slots
- **Money paths are atomic:**
  - charge + enqueue, cancel + refund, and Pro activation each run in one transaction
  - Payme/Click settle/cancel is serialised per order and logged in `payment_events`
  - `Idempotency-Key` on `POST /api/generations`
  - the ledger invariant is checked by tests and by the load harness
- **Web tier:**
  - LibreOffice is behind a process-wide semaphore and a per-user limit
  - user files are parsed off the event loop in a worker pool
  - list and poll reads are lean and paginated; byte routes are cacheable per user
  - first-load JS is down from 513 → 219 kB on `/uz/[slug]` and 428 → 218 kB on `/uz/files/[id]` (baseline `next build` vs the W4 gate `next build` at `f631257`)
- **Operations:**
  - fail-fast boot, and structured JSON logs with request IDs and redaction
  - deep health check, worker heartbeat and HEALTHCHECK
  - container limits, log rotation, CI workflow and pinned images
  - daily backup and restore-check scripts, 180-day bonus-file retention, and the server IP / owner phone removed from tracked docs
- **Load and chaos (§3):**
  - every money invariant holds after every scenario;
  - all 4 chaos experiments pass (before, graceful SIGTERM failed);
  - under an enqueue burst the queue stays at 37 instead of growing to 2 377, because of the 429 admission check;
  - with a provider outage, jobs fail and refund in 4 s instead of 97 s.
  - The one latency regression the test found, a Postgres CPU cap, was fixed by setting `PG_CPUS=2`.
- **Status of all 194 findings:** 177 ✅ fixed · 13 ◐ partial · 2 📝 documented · 1 ⏭ deferred · 1 ⏸ open by owner decision. The full table is in the appendix.

## 2. Verification

| Gate | Commit | typecheck | lint | unit | viewer | UI | build | start smoke |
|---|---|---|---|---|---|---|---|---|
| Baseline | `76ddf91` | 0 | 0 | 2 637/2 639 (2 known env failures) | 248/248 | 370/370 | ✅ | ⚠ web without a bot token stays up and serves 500s |
| W1 | `5d09028` | 0 | 0 | 2 783/2 785 (same 2) | 248/248 | 373/373 | ✅ | ✅ migrations → 022 |
| W2 | `fa938a1` | 0 | 0 | 2 899/2 901 (same 2) | 248/248 | 401/401 | ✅ | ✅ → 022 |
| W3 | `447c6a4` | 0 | 0 | 3 084/3 085 → fixed, 15/15 | 248/248 | 432/432 | ✅ | ✅ → 026, worker heartbeat |
| W4 | `f631257` + `cb7aee3` | 0 | 0 | 3 248/3 254 → 6 stale assertions in 4 files updated, 21/21 | 248/248 | **453/453** | ✅ | ✅ → 027, worker heartbeat |

- **Unit tests:** +615 tests since the baseline (2 639 → 3 254), and the 2 historic env-dependent failures are gone (hermetic tests).
- **Live smoke with real Gemini:**
  - 10 of 10 engine cases pass: pro-slide with grounding and AI images, slide, translation, resume, referat, article (report score 92), essay, lesson plan, crossword and infographic.
  - `cost_json.parts` reports llm, grounding and image separately.
  - A 20 s deadline fails cleanly with `DeadlineError` after 13.7 s and produces no file.
  - Spend was about $0.7 of the $5 budget.
  - Details: `audit/03-progress.md`.

## 3. Load and chaos tests (Phase 5)

**Setup.** The harness is `loadtests/` (k6 in Docker, driven by `run-all.sh`).
- **Stacks:** each run gets its own throwaway local Postgres + `next start` + 2 workers × 4.
- **Seed:** 2 000 users, 400 of them with generations, about 1 570 COMPLETED documents.
- **Commits:** `before` = `main@76ddf91`, `after` = the branch at `cb7aee3`.
- **Provider isolation:** a jail proxy intercepts all outbound HTTP. No real provider, payment or Telegram call was made.
- **Postgres config:** `before` uses main's stock Postgres. `after` uses the branch's compose flags (`shared_buffers=256MB`, `pg_stat_statements`, …) and CPU cap.
- **Caveat:** the numbers are laptop-relative (12 cores shared by k6, Postgres, web and workers). Compare the two columns, not the absolutes.
- **Raw results:** `loadtests/results/{before,after,after-pgcpu2}/summary.md`.

### Latency and throughput

| Scenario | Load | before p50 / p95 / p99 ms | after p50 / p95 / p99 ms | req/s before → after | errors |
|---|---|---|---|---|---|
| browse (`/uz` + session) | ramp to 600 VUs | 1.5 / 3.7 / 6.0 | 1.5 / 3.6 / 5.6 | 513 → 514 | 0 % / 0 % |
| poll (`/api/generations/:id`, list) | 800 VUs | 3.4 / 5.8 / 8.8 | 3.6 / 6.3 / 10.7 | 243 → 243 | 0 % / 0 % |
| enqueue (`POST /api/generations`) | burst | 8.7 / 14.4 / 21.0 | 9.8 / 16.9 / 20.5 | 20.4 → 20.4 | 0 % / 0 % |
| downloads (file/thumb/asset bytes) | about 540 req/s | 3.5 / 9.2 / 15.0 | 11.7 / **77.1** / 90.0 → **4.1 / 11.8 / 23.9 with `PG_CPUS=2`** | 542 → 509 → **540** | 0 % / 0 % |
| uploads (photo) | burst | 4.9 / 10.0 / 16.5 | 5.5 / 17.5 / 24.1 | 33.9 → 33.8 | 0 % / 0 % |
| mixed (all of the above) | 650+ req/s | 2.8 / 9.9 / 18.1 | 3.2 / 12.1 / 22.6 | 659 → 657 | 0 % / 0 % |

**The downloads regression was found and fixed by the load test.** With the branch's new `cpus: ${PG_CPUS:-1}` limit, Postgres ran at 104 % of one CPU while serving `bytea`, and p95 rose 8×. A controlled rerun of the same code with 2 CPUs (`after-pgcpu2`) restored p95 to 11.8 ms. So the compose default is now `PG_CPUS=2` (`8e175bf`). The remaining gap (p95 +2.6 ms on downloads, +0.5 ms on poll) was not profiled. Candidates are the per-request log context and the added `status = 'COMPLETED'` / ownership checks.

### Behaviour under overload (the main goal)

| Signal | before | after |
|---|---|---|
| Enqueue burst: accepted / rejected | 3 870 accepted, 4 rate-limited; **the queue grew to 2 377 QUEUED** (oldest 91 s and rising, so hours of wait at real job times) | 1 526 accepted, **2 341 × 429 `queue_full`** + 1 × `user_inflight`, each with `Retry-After` and no charge. **QUEUED peak 37** |
| Byte caching (`thumb?v=`, assets) | 0 % cacheable (global `no-store`) | **100 %** cacheable (`private, immutable`); unversioned thumb stays `no-store` |
| Upload abuse | only the rate limit | rate limit + **per-user quota (413)** |
| 5xx in any scenario | 0 | 0 |

### Data invariants (after every scenario, both runs)

**11 / 11 PASS** in every scenario of both runs:
- the ledger equals the wallet
- no negative wallet, no double charge, no double refund
- a refund never exceeds its charge, and every refund has a charge
- every paid job has a charge, and every charge has a job
- every FAILED paid job is refunded
- every COMPLETED job has a file
- nothing is stuck IN_PROGRESS

### Chaos experiments

| Experiment | before | after |
|---|---|---|
| **pg-restart:** Postgres down 10 s under mixed load | 18/18 PASS | 18/18 PASS; health reports the DB outage, and everything recovers without restarts |
| **worker-sigkill:** kill -9 a worker holding 2 jobs | 17/17 PASS; reclaimed after the lease | 17/17 PASS; reclaimed after the lease; each job charged once and refunded once |
| **provider-down:** LLM/image provider rejects every call | 19/19 PASS, but **LLM jobs took p95 97 s to fail** (360 retried provider calls) | 19/19 PASS; **LLM jobs fail in p95 4.2 s** (10 provider calls: breaker + deadline), all 30 + 30 FAILED with exactly one refund |
| **worker-sigterm:** graceful stop with 4 jobs in flight | **16/17: `drained_or_released` FAIL**. The worker exited after 2 s and left 4 jobs leased, so they were re-run only after the lease expired | **17/17 PASS**. The worker waits ≤ 20 s, then returns unfinished jobs to QUEUED without counting an attempt, and another worker takes them at once |


## 4. What changed, by wave

**W1 — P0**

| Pkg | What changed | Clusters |
|---|---|---|
| W1-A | Admin comes only from the user's own private, non-forwarded contact. Phones are stored and compared exactly. | C01 |
| W1-B | `safeReturnTo` closes the `javascript:` XSS and the open redirect. | C02 |
| W1-C | JSONB/TEXT is surrogate- and NUL-safe. FAILED files are neither served nor kept. | C03 |
| W1-D | Linear scanners replace the quadratic regexes (fuzzed byte-identical). A `worker_threads` parse pool (timeout, heap cap), a 300-page PDF cap, a streamed zip-inflate budget and a streamed body cap. | C04, C06 |
| W1-E | Free-LLM policy: per-user daily caps, a global cap, the `FREE_LLM_DISABLED` kill switch, and AI edit only on paid documents. | C10 |

**W2 — P1**

| Pkg | What changed | Clusters |
|---|---|---|
| W2-A | LibreOffice semaphore, per-user PDF limit, on-disk PDF cache, process-group kill. | C07 |
| W2-B | Per-user cacheable byte routes, lean list/poll, cursor pagination, fair claim, 429 + `Retry-After` before any charge. | C08, C09, C16, C22 |
| W2-C | Payme sandbox gated, NAT-tolerant login limits, upload quotas. | C11, C13, C29 |
| W2-D1 | Exit on fatal boot, container limits, 2 × 4 workers, deep health check, backup scripts. | C17–C19, C22, C24 |
| W2-D2 | 180-day bonus-file retention, QUEUED TTL with refund, bounded reconciler, heartbeat. | C23, C27 |
| W2-E | Client polling never silently gives up; editor saves in chunks; PDF busy UI; load-more. | C20, C21 |

**W3 — P2**

| Pkg | What changed | Clusters |
|---|---|---|
| W3-A | Lease fencing, hard deadline, SIGTERM drain, atomic cancel/Pro, idempotency. | C14, C15, C25, C26 |
| W3-B | Deadline-aware LLM chain, circuit breaker, per-provider limiter, jittered retries. | C28 |
| W3-C | Payment settle/cancel serialised; Payme error codes per spec. | C30 |
| W3-D | Structured logs with redaction and request IDs; user-safe error texts. | C31 |
| W3-E | Migration runner hardening, pool config, indexes. | C32, C33 |
| W3-F | Lean worker image, pinned images, Postgres tuning, CI, nginx template, hermetic tests. | C35, C40 |
| W3-G | Game results survive link expiry; idempotent submit. | C36 |
| W3-H | Login and payment UX dead ends fixed; language switcher removed. | C37, C38 |
| W3-I | PII and server IP out of the repo; `ADMIN_PHONES` env; no-PII test. | C05 |
| W3-J | `priceFor`/`budgetFor` use the engines' own normalisers. | C12 |

**W4 — P3**

| Pkg | What changed | Findings |
|---|---|---|
| W4-A | Every engine honours the job deadline; per-service `cost_json`; `safeFetch` for provider URLs. | EXT-03, EXT-11, EXT-15 |
| W4-B | Housekeeping split, HOT heartbeats, migration 027, monotonic progress. | DB-12, SCALE-13, BEB-07, … |
| W4-C | Logout origin check, magic link confirmed by POST, separate webhook secret, next 15.5.26. | SECA-04/05, EXT-14, DEPS-04 |
| W4-D | Lazy composers and viewers (−57 % first-load JS), chunk-load recovery, aria labels. | FE-11, FE-13, FE-15, FE-17 |
| W4-E | Essay price follows the built word target; 400 on malformed input; photo purge respects drafts. | SECB-03, BEA-13/14, ABUSE-07 |
| W4-F | nginx template with static caching and gzip; LGPL note; deploy runbook. | SCALE-15, DEPS-07 |

## 5. Owner actions (not done by this branch)

1. **`ADMIN_PHONES`:** set it in prod `.env` (done at this deploy). After you confirm the admin panel opens, remove the hardcoded fallback number in `lib/server/admin-phones.ts`.
2. **`TELEGRAM_WEBHOOK_SECRET`:** set it, then re-run `setWebhook` with `secret_token`. Until then the webhook falls back to `CRON_SECRET` and logs a startup warning.
3. **Payme/Click:** re-certify in the sandbox before going live (W3-C changed the error codes to match the spec). Keep `PAYME_SANDBOX` empty in prod.
4. **Backups:** install the cron for `scripts/backup.sh` + `scripts/restore-check.sh` with an off-box `BACKUP_REMOTE` (see `.claude/deploy.md` §1a).
5. **nginx:** compare the prod site config with `deploy/nginx/slaydx.conf.example`: static caching, `proxy_read_timeout`, and `X-Forwarded-For` via `$proxy_add_x_forwarded_for` (ABUSE-05/SECA-03).
6. **Historic refunds:** check old FAILED jobs that were charged and never refunded, using the query in the `lib/server/refund-reconcile.ts` header. The reconciler covers only jobs after migration 022 plus 2 days, on purpose.
7. **`purgeUnusedUploads`** is not wired in, by owner decision.

## 6. Remaining risks

| Risk | Why it remains | Mitigation today |
|---|---|---|
| **ABUSE-02:** bonus farming with many Telegram accounts | Owner decision to keep the 3 000-point bonus | Free-LLM global cap and kill switch; per-user in-flight ≤ 2; queue admission 429 |
| Single box, no blue-green (INFRA-07) | Compose on one shared VPS | 2 workers drain on SIGTERM; the web restart window is short; health is polled for up to 5 min |
| Files in Postgres `bytea` (DB-06/SCALE-08 partial) | Streaming or object storage is an architecture change | 180-day bonus retention, per-user caching, PDF cache; watch disk use |
| XFF trust depends on nginx (ABUSE-05/SECA-03) | Infrastructure outside the repo | Template in repo; per-identity buckets don't depend on IP |
| FE-10: Mini App auto-login off | The HMAC needs a real `initData` capture to verify | Normal Telegram login works |
| Provider quotas (EXT-06/07) | External limits | Per-source breakers and fallbacks (OpenAlex/Crossref) |
| DB-13: ledger rows CASCADE-deleted with the user | Needs an owner data-retention decision | No code path deletes users (grep: no `DELETE FROM users`) |
| Payment protocol changes not re-certified in the sandbox | Needs the providers' sandbox | Payments are still in test mode |

## 7. Optimisation opportunities (not done)

- **Slide images are stored twice** (inside the PPTX and as assets). Rendering the PPTX from assets on download would roughly halve slide storage.
- **Stream `bytea` or move files to object storage** (DB-06). This removes the 4–6× memory copy per download.
- **`pg_stat_statements`:** the library is preloaded (W3-F); run `CREATE EXTENSION` and review the top queries monthly.
- **Cost report:** schedule `scripts/cost-report.mts` daily, since `cost_json` is now complete (OBS-07), and feed it into the planned admin panel.
- **Blue-green web:** run two web containers behind nginx `upstream` to remove the deploy window (INFRA-07).

## 8. Exact commands

```bash
# gates (every heavy command through the cgroup gate)
scripts/heavy.sh npx tsc --noEmit
npm run lint
DATABASE_URL=postgres://…@127.0.0.1:<throwaway>/slaydx scripts/heavy.sh -m 4G -t 3000 npm test
scripts/heavy.sh npm run test:viewer
scripts/heavy.sh npm run test:ui
scripts/heavy.sh -m 4G npm run build

# live engine smoke (real Gemini; costs money)
scripts/heavy.sh -m 3G -t 3600 npm run live -- pro-slide slide translation-text resume referat article-oak crossword infographic essay-dtm lesson

# load + chaos, before/after (local only; the provider jail blocks all outbound HTTP)
git worktree add --detach .claude/worktrees/loadtest-main 76ddf91
git worktree add --detach .claude/worktrees/loadtest-after <audit HEAD>
REPO_DIR=$PWD/.claude/worktrees/loadtest-main  loadtests/run-all.sh before
REPO_DIR=$PWD/.claude/worktrees/loadtest-after loadtests/run-all.sh after
# results: loadtests/results/{before,after}/summary.md

# deploy: see audit/DEPLOY-RUNBOOK.md and .claude/deploy.md (backup → .env → deploy.sh → 5-min health poll → smoke)
```

## Appendix — every finding

Status: ✅ fixed · ◐ partial (the remaining part is noted) · 📝 documented only · ⏭ deferred · ⏸ open (owner decision). Commit = the first commits whose message cites the finding (a merge commit or the fix commit), on `audit/production-readiness`.

| Finding | Final sev | Cluster | Wave | Status | Commit(s) |
|---|---|---|---|---|---|
| ABUSE-01 | P0 | C10 | W1 | ✅ fixed | `3368af3`, `890ce4b` |
| ABUSE-06 | P0 | C01 | W1 | ✅ fixed | `c0a3dec`, `44aab5b` |
| BEA-02 | P0 | C03 | W1 | ✅ fixed | `5b15ad3`, `1e3e864` |
| BEA-11 | P0 | C10 | W1 | ◐ partial (buckets still consumed on engine-level 409/422) | `3368af3`, `0645c82` |
| BEB-01 | P0 | C03 | W1 | ✅ fixed | `5b15ad3`, `6bc1353` |
| CONC-09 | P0 | C06 | W1 | ✅ fixed | `5d09028`, `75631ab` |
| CONC-11 | P0 | C10 | W1 | ◐ partial (single-flight + fail-closed limiter; client disconnect not propagated to the LLM call) | `3368af3`, `0645c82` |
| CONC-13 | P0 | C10 | W1 | ✅ fixed | `3368af3`, `890ce4b` |
| DEPS-08 | P0 | C01 | W1 | ✅ fixed | `a455603`, `203b3b7` |
| EXT-02 | P0 | C10 | W1 | ✅ fixed | `3368af3`, `890ce4b` |
| FE-01 | P0 | C02 | W1 | ✅ fixed | `8da3314`, `73433e1` |
| FILE-02 | P0 | C06 | W1 | ✅ fixed | `5d09028`, `efd176e` |
| FILE-04 | P0 | C06 | W1 | ✅ fixed | `5d09028`, `3f5e398` |
| SCALE-14 | P0 | C10 | W1 | ✅ fixed | `3368af3`, `890ce4b` |
| SECA-01 | P0 | C01 | W1 | ✅ fixed | `c0a3dec`, `44aab5b` |
| SECA-02 | P0 | C02 | W1 | ✅ fixed | `8da3314`, `73433e1` |
| SECB-01 | P0 | C04 | W1 | ✅ fixed | `5d09028`, `117af40` |
| SECB-02 | P0 | C06 | W1 | ✅ fixed | `5d09028`, `cb425da` |
| SECB-04 | P0 | C06 | W1 | ✅ fixed | `5d09028`, `75631ab` |
| SECB-05 | P0 | C06 | W1 | ✅ fixed | `cf3bd1d`, `3b40afe` |
| TEST-11 | P0 | C06 | W1 | ✅ fixed | `5d09028`, `efd176e` |
| TEST-12 | P0 | C01 | W1 | ◐ partial (contact path covered; `requireAdmin` route composition only indirectly) | `c0a3dec`, `44aab5b` |
| ABUSE-05 | P1 | C29 | W2 | ◐ partial (NAT-tolerant buckets; still relies on nginx `$proxy_add_x_forwarded_for`; template in repo) | `cf3bd1d`, `51a28af` |
| BEA-06 | P1 | C09 | W2 | ✅ fixed | `01bf6ab`, `2ff2a9a` |
| BEA-07 | P1 | C08 | W2 | ✅ fixed | `01bf6ab`, `a285127` |
| BEA-15 | P1 | C29 | W2 | ✅ fixed | `cf3bd1d`, `51a28af` |
| BEA-20 | P1 | C07 | W2 | ✅ fixed | `59f569f`, `0175311` |
| BEB-06 | P1 | C23 | DESIGN | ✅ fixed | `33c3591` |
| CONC-01 | P1 | C07 | W2 | ✅ fixed | `59f569f`, `f61621a` |
| CONC-07 | P1 | C16 | W2 | ✅ fixed | `01bf6ab`, `2ff2a9a` |
| CONC-08 | P1 | C07 | W2 | ✅ fixed | `59f569f`, `0175311` |
| CONC-17 | P1 | C17 | W2 | ✅ fixed | `fa938a1`, `4cbb6d4` |
| CONC-18 | P1 | C09 | W2 | ✅ fixed | `01bf6ab`, `2ff2a9a` |
| DB-01 | P1 | C23 | DESIGN | ✅ fixed | `33c3591` |
| DB-02 | P1 | C13 | W2 | ✅ fixed | `cf3bd1d`, `46934d6` |
| DB-03 | P1 | C09 | W2 | ✅ fixed | `01bf6ab`, `2ff2a9a` |
| DB-06 | P1 | C08 | W2 | ◐ partial (byte routes cached per user; still reads whole `bytea`, no streaming) | `01bf6ab`, `5240fd9` |
| EXT-01 | P1 | C11 | W2 | ✅ fixed | `cf3bd1d`, `7a2094c` |
| EXT-08 | P1 | C13 | W2 | ✅ fixed | `cf3bd1d`, `7a2094c` |
| FE-02 | P1 | C20 | W2 | ✅ fixed | `0568292`, `f56ca68` |
| FE-03 | P1 | C21 | W2 | ✅ fixed | `0568292`, `72a9641` |
| FE-05 | P1 | C08 | W2 | ✅ fixed | `01bf6ab`, `a285127` |
| FE-08 | P1 | C09 | W2 | ✅ fixed | `4505f25`, `0568292` |
| FE-12 | P1 | C09 | W2 | ✅ fixed | `0568292`, `f56ca68` |
| FE-14 | P1 | C20 | W2 | ✅ fixed | `0568292`, `72a9641` |
| FE-16 | P1 | C19 | W2 | ✅ fixed | `3ca25b2` |
| FILE-01 | P1 | C23 | DESIGN | ✅ fixed | `33c3591` |
| FILE-03 | P1 | C07 | W2 | ✅ fixed | `59f569f`, `0175311` |
| FILE-06 | P1 | C07 | W2 | ✅ fixed | `59f569f`, `2245655` |
| INFRA-01 | P1 | C17 | W2 | ✅ fixed | `9c7d682`, `4cbb6d4` |
| INFRA-03 | P1 | C22 | DESIGN | ✅ fixed | `9c7d682` |
| INFRA-04 | P1 | C18 | W2 | ✅ fixed | `9c7d682`, `3ca25b2` |
| INFRA-05 | P1 | C24 | DESIGN | ✅ fixed | `9c7d682`, `e7a65b1` |
| INFRA-06 | P1 | C19 | W2 | ✅ fixed | `9c7d682`, `3ca25b2` |
| INFRA-15 | P1 | C18 | W2 | ✅ fixed | `9c7d682`, `3ca25b2` |
| OBS-01 | P1 | C19 | W2 | ✅ fixed | `7ab7626`, `9c7d682` |
| OBS-04 | P1 | C19 | W2 | ✅ fixed | `9c7d682`, `3ca25b2` |
| OBS-10 | P1 | C18 | W2 | ✅ fixed | `9c7d682`, `3ca25b2` |
| OBS-12 | P1 | C19 | W2 | ✅ fixed | `9c7d682`, `3ca25b2` |
| SCALE-01 | P1 | C08 | W2 | ✅ fixed | `01bf6ab`, `a285127` |
| SCALE-02 | P1 | C22 | DESIGN | ✅ fixed | `9c7d682` |
| SCALE-03 | P1 | C09 | W2 | ✅ fixed | `01bf6ab`, `2ff2a9a` |
| SCALE-04 | P1 | C07 | W2 | ✅ fixed | `59f569f`, `f61621a` |
| SCALE-05 | P1 | C16 | W2 | ✅ fixed | `01bf6ab`, `2ff2a9a` |
| SCALE-07 | P1 | C07 | W2 | ✅ fixed | `59f569f`, `f61621a` |
| SCALE-08 | P1 | C08 | W2 | ◐ partial (same as DB-06) | `01bf6ab`, `a285127` |
| SCALE-09 | P1 | C22 | DESIGN | ✅ fixed | `9c7d682` |
| SCALE-10 | P1 | C29 | W2 | ✅ fixed | `cf3bd1d`, `51a28af` |
| SCALE-12 | P1 | C09 | W2 | ✅ fixed | `da3c2f5`, `a04229a` |
| SECA-03 | P1 | C29 | W2 | ◐ partial (same as ABUSE-05) | `cf3bd1d`, `51a28af` |
| TEST-05 | P1 | C17 | W2 | ✅ fixed | `9c7d682`, `4cbb6d4` |
| UX-05 | P1 | C20 | W2 | ✅ fixed | `0568292`, `f56ca68` |
| UX-07 | P1 | C22 | DESIGN | ✅ fixed | `f56ca68` |
| UX-08 | P1 | C07 | W2 | ✅ fixed | `0568292`, `f56ca68` |
| ABUSE-02 | P2 | — | W3 | ⏸ open (owner decision: bonus kept; the free-LLM global cap and per-user in-flight cap bound the exposure) | — |
| ABUSE-03 | P2 | C12 | W3 | ✅ fixed | `c3f5e48`, `005780e` |
| ABUSE-04 | P2 | C36 | W3 | ✅ fixed | `15cf902`, `23c0597` |
| BEA-01 | P2 | C12 | W3 | ✅ fixed | `c3f5e48`, `005780e` |
| BEA-03 | P2 | C26 | W3 | ✅ fixed | `cf3bd1d`, `3b40afe` |
| BEA-04 | P2 | C25 | W3 | ✅ fixed | `4a57589` |
| BEA-05 | P2 | C30 | W3 | ✅ fixed | `20aeead`, `5268853` |
| BEA-08 | P2 | C36 | W3 | ✅ fixed | `15cf902`, `23c0597` |
| BEA-09 | P2 | C31 | W3 | ✅ fixed | `b4a9ff1`, `f8724b8` |
| BEA-10 | P2 | C36 | W3 | ✅ fixed | `15cf902`, `23c0597` |
| BEA-16 | P2 | C36 | W3 | ✅ fixed | `15cf902`, `2779083` |
| BEA-18 | P2 | C27 | W3 | ✅ fixed | `33c3591`, `68a4702` |
| BEB-02 | P2 | C15 | W3 | ✅ fixed | `01206ea` |
| BEB-03 | P2 | C27 | W3 | ✅ fixed | `33c3591`, `68a4702` |
| BEB-04 | P2 | C25 | W3 | ✅ fixed | `4a57589` |
| BEB-05 | P2 | C15 | W3 | ✅ fixed | `1f26384` |
| CONC-02 | P2 | C30 | W3 | ✅ fixed | `20aeead`, `807db84` |
| CONC-03 | P2 | C14 | W3 | ✅ fixed | `01206ea` |
| CONC-04 | P2 | C27 | W3 | ✅ fixed | `33c3591`, `68a4702` |
| CONC-05 | P2 | C25 | W3 | ✅ fixed | `4a57589` |
| CONC-06 | P2 | C26 | W3 | ✅ fixed | `01206ea` |
| CONC-10 | P2 | C34 | W3 | ✅ fixed | `56d56df`, `27fb3c6` |
| CONC-12 | P2 | C32 | W3 | ✅ fixed | `33d0ce4`, `7ac4047` |
| CONC-14 | P2 | C25 | W3 | ✅ fixed | `e5be1bf` |
| DB-04 | P2 | C25 | W3 | ✅ fixed | `4a57589` |
| DB-05 | P2 | C14 | W3 | ✅ fixed | `01206ea` |
| DB-07 | P2 | C32 | W3 | ✅ fixed | `33d0ce4`, `7ac4047` |
| DB-08 | P2 | C33 | W3 | ✅ fixed | `33d0ce4`, `7ac4047` |
| DB-09 | P2 | C30 | W3 | ✅ fixed | `20aeead`, `807db84` |
| DB-15 | P2 | C36 | W3 | ✅ fixed | `15cf902`, `2779083` |
| DEPS-01 | P2 | C05 | W3 | ✅ fixed | `a455603`, `a1e20a6` |
| DEPS-02 | P2 | — | W3 | ✅ fixed | `15cf902`, `23c0597` |
| DEPS-03 | P2 | — | W3 | ✅ fixed | `8f94120`, `7537601` |
| DEPS-05 | P2 | C35 | W3 | ✅ fixed | `8f94120`, `bd73244` |
| DEPS-06 | P2 | C35 | W3 | ✅ fixed | `8f94120`, `bd73244` |
| EXT-03 | P2 | C15 | W3 | ✅ fixed | `f631257`, `2d664a6` |
| EXT-04 | P2 | C28 | W3 | ✅ fixed | `1f26384`, `b3d327b` |
| EXT-05 | P2 | C28 | W3 | ✅ fixed | `04126b0`, `366b389` |
| EXT-06 | P2 | C28 | W3 | ◐ partial (per-source quota breakers; quotas themselves unchanged) | `1f26384`, `9751a41` |
| EXT-07 | P2 | C28 | W3 | ◐ partial (same as EXT-06) | `b3d327b`, `5873b41` |
| EXT-09 | P2 | C28 | W3 | ✅ fixed | `1f26384`, `7a7af66` |
| EXT-10 | P2 | C15 | W3 | ✅ fixed | `1f26384`, `b3d327b` |
| EXT-12 | P2 | C31 | W3 | ✅ fixed | `b4a9ff1`, `0f93568` |
| EXT-13 | P2 | C28 | W3 | ✅ fixed | `1f26384`, `b3d327b` |
| FE-04 | P2 | C37 | W3 | ✅ fixed | `447c6a4`, `b72cb52` |
| FE-06 | P2 | C34 | W3 | ✅ fixed | `447c6a4`, `56d56df` |
| FE-07 | P2 | — | W3 | ✅ fixed | `447c6a4`, `b72cb52` |
| FE-09 | P2 | C37 | W3 | ◐ partial (create/sidebar wait for the session check; other pages unchanged) | `447c6a4`, `4505f25` |
| FE-10 | P2 | C37 | W3 | ⏭ deferred (Mini App auto-login stays off; the HMAC needs a real `initData` capture) | `447c6a4`, `f8ba3db` |
| FE-18 | P2 | C12 | W3 | ✅ fixed | `c3f5e48` |
| FE-19 | P2 | C37 | W3 | ✅ fixed | `447c6a4`, `7448d72` |
| FE-21 | P2 | C38 | W3 | ✅ fixed | `447c6a4`, `4505f25` |
| FILE-05 | P2 | C15 | W3 | ✅ fixed | `01206ea` |
| INFRA-02 | P2 | C14 | W3 | ✅ fixed | `01206ea` |
| INFRA-07 | P2 | — | W3 | 📝 documented (no blue-green deploy; short restart window) | `8f94120`, `96cb33b` |
| INFRA-08 | P2 | C14 | W3 | ✅ fixed | `01206ea` |
| INFRA-09 | P2 | C35 | W3 | ✅ fixed | `8f94120`, `ebef8b7` |
| INFRA-10 | P2 | C05 | W3 | ✅ fixed | `a455603`, `1b8433f` |
| INFRA-11 | P2 | C35 | W3 | ✅ fixed | `8f94120`, `96cb33b` |
| INFRA-12 | P2 | C35 | W3 | ✅ fixed | `8f94120`, `bd73244` |
| INFRA-13 | P2 | C35 | W3 | ✅ fixed | `8f94120`, `d958920` |
| INFRA-14 | P2 | C35 | W3 | ✅ fixed | `8f94120`, `9d5d584` |
| OBS-02 | P2 | C31 | W3 | ✅ fixed | `b4a9ff1`, `f8724b8` |
| OBS-03 | P2 | C31 | W3 | ✅ fixed | `b4a9ff1`, `f8724b8` |
| OBS-05 | P2 | C25 | W3 | ✅ fixed | `0f93568` |
| OBS-06 | P2 | C31 | W3 | ✅ fixed | `b4a9ff1`, `0f93568` |
| OBS-07 | P2 | — | W3 | ◐ partial (`cost_json` covers every engine; no scheduled cost report/alert) | — |
| OBS-08 | P2 | C31 | W3 | ✅ fixed | `b4a9ff1`, `0f93568` |
| OBS-09 | P2 | C30 | W3 | ✅ fixed | `20aeead`, `807db84` |
| OBS-11 | P2 | C31 | W3 | ✅ fixed | `b4a9ff1`, `99cb05c` |
| OBS-13 | P2 | — | W3 | ✅ fixed | `b4a9ff1`, `99cb05c` |
| OBS-14 | P2 | C30 | W3 | ◐ partial (`payment_events` audit trail; `reference` column semantics unchanged) | `20aeead`, `807db84` |
| SCALE-06 | P2 | C28 | W3 | ✅ fixed | `1f26384`, `9751a41` |
| SCALE-11 | P2 | C15 | W3 | ✅ fixed | `01206ea` |
| SECB-03 | P2 | C26 | W3 | ✅ fixed | `da3c2f5`, `e44eefd` |
| TEST-01 | P2 | C30 | W3 | ✅ fixed | `20aeead`, `4fc1dea` |
| TEST-02 | P2 | C40 | W3 | ✅ fixed | `8f94120` |
| TEST-03 | P2 | C40 | W3 | ✅ fixed | `ebef8b7` |
| TEST-04 | P2 | C40 | W3 | ✅ fixed | `ebef8b7` |
| TEST-06 | P2 | C40 | W3 | ✅ fixed | `8f94120` |
| TEST-07 | P2 | C40 | W3 | ✅ fixed | `8f94120` |
| TEST-08 | P2 | C40 | W3 | ✅ fixed | `8f94120` |
| TEST-09 | P2 | C40 | W3 | ✅ fixed | `8f94120` |
| TEST-10 | P2 | C40 | W3 | ✅ fixed | `8f94120` |
| UX-01 | P2 | C37 | W3 | ✅ fixed | `447c6a4`, `38f2b16` |
| UX-02 | P2 | C37 | W3 | ✅ fixed | `4505f25` |
| UX-03 | P2 | C37 | W3 | ✅ fixed | `dc7d86f`, `4505f25` |
| UX-04 | P2 | C37 | W3 | ✅ fixed | `7448d72` |
| UX-06 | P2 | C36 | W3 | ✅ fixed | `15cf902`, `23c0597` |
| UX-09 | P2 | C38 | W3 | ✅ fixed | `447c6a4`, `4505f25` |
| ABUSE-07 | P3 | — | W4 | ✅ fixed | `da3c2f5`, `246f46e` |
| BEA-12 | P3 | — | W4 | ✅ fixed | `266e3af`, `8910a18` |
| BEA-13 | P3 | — | W4 | ✅ fixed | `da3c2f5`, `6620466` |
| BEA-14 | P3 | — | W4 | ✅ fixed | `da3c2f5`, `4ebeecc` |
| BEA-17 | P3 | — | W4 | ✅ fixed | `04126b0`, `2de82e6` |
| BEA-19 | P3 | C41 | W4 | ✅ fixed | `860476a`, `856f55b` |
| BEB-07 | P3 | — | W4 | ✅ fixed | `266e3af`, `dbc9928` |
| CONC-15 | P3 | C39 | W4 | ✅ fixed | `266e3af`, `5a6e0e1` |
| CONC-16 | P3 | — | W4 | ✅ fixed | `04126b0`, `ce914ab` |
| DB-10 | P3 | C39 | W4 | ✅ fixed | `33c3591`, `68a4702` |
| DB-11 | P3 | C39 | W4 | ◐ partial (indexes on the hot login/purge/claim paths; admin scans remain) | `33d0ce4`, `79bc214` |
| DB-12 | P3 | C39 | W4 | ✅ fixed | `266e3af`, `0a11398` |
| DB-13 | P3 | C39 | W4 | 📝 documented (CASCADE/CHECK changes need an owner data decision) | `266e3af` |
| DB-14 | P3 | C39 | W4 | ✅ fixed | `266e3af`, `5a6e0e1` |
| DEPS-04 | P3 | — | W4 | ✅ fixed | `04126b0`, `9d6efe7` |
| DEPS-07 | P3 | — | W4 | ✅ fixed | `05b5baf`, `4014095` |
| EXT-11 | P3 | — | W4 | ✅ fixed | `f631257`, `d60f4f4` |
| EXT-14 | P3 | — | W4 | ✅ fixed | `04126b0`, `2de82e6` |
| EXT-15 | P3 | — | W4 | ✅ fixed | `f631257`, `3bdfd03` |
| FE-11 | P3 | — | W4 | ✅ fixed | `a10da35`, `556971a` |
| FE-13 | P3 | — | W4 | ✅ fixed | `a10da35`, `910723b` |
| FE-15 | P3 | — | W4 | ✅ fixed | `a10da35`, `8c5a949` |
| FE-17 | P3 | — | W4 | ✅ fixed | `a10da35`, `ad428c1` |
| FE-20 | P3 | C41 | W4 | ✅ fixed | `860476a` |
| SCALE-13 | P3 | C39 | W4 | ✅ fixed | `266e3af`, `0a11398` |
| SCALE-15 | P3 | — | W4 | ✅ fixed | `05b5baf`, `21b2bfe` |
| SCALE-16 | P3 | C39 | W4 | ✅ fixed | `266e3af`, `178005f` |
| SECA-04 | P3 | — | W4 | ✅ fixed | `04126b0`, `5cffe73` |
| SECA-05 | P3 | — | W4 | ✅ fixed | `04126b0`, `2de82e6` |
| UX-10 | P3 | — | W4 | ✅ fixed | `a10da35`, `97261ca` |

