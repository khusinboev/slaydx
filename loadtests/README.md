# loadtests — local load + chaos harness (Phase 5)

Reproducible, laptop-only load and chaos tests for SlaydX. The harness measures the **web
tier and the queue mechanics** (enqueue → claim → complete/fail → refund, leases, restarts),
not LLM speed. It never calls a real AI provider, payment provider or Telegram.

Target from `audit/AUDITOR-BRIEF.md` §1: 50 k users, 2 k concurrent, 10× bursts. A laptop
cannot reach that; the harness ramps to hundreds of VUs and is meant to **compare two commits
on the same machine** (`main@76ddf91` = before, `audit/production-readiness` = after).
All absolute numbers are laptop-relative: k6, Postgres, web and workers share 12 cores.

## Quick start

```bash
# whole pipeline for the checkout this harness lives in (≈ 25–35 min with PROFILE=full)
loadtests/run-all.sh after

# the "before" commit: a worktree of main, harness still from this checkout.
# It MUST live inside the main checkout (Turbopack rejects a node_modules symlink that
# points outside its workspace root; stack.sh refuses otherwise).
M=/home/adhambek/projects/pythons/slaydbot/slaydx
git worktree add --detach $M/.claude/worktrees/loadtest-main 76ddf91
REPO_DIR=$M/.claude/worktrees/loadtest-main loadtests/run-all.sh before
git worktree remove --force $M/.claude/worktrees/loadtest-main   # --force: node_modules symlink + .next

# quick validation (20 VUs × 30 s per scenario + every chaos experiment once, ≈ 15 min)
PROFILE=smoke loadtests/run-all.sh smoke-x
```

Results land in `loadtests/results/<label>/`: `summary.md` (tables), `k6-<scenario>.json`
(full k6 summaries), `metrics-<scenario>.csv`, `invariants-after-<scenario>.txt`,
`chaos-<experiment>.txt`, `chaos/` (k6 + health probes during chaos), `stack/` (events,
restart counters, jail log, process logs), `run.env` (exact parameters).

Prerequisites: Docker (pulls `grafana/k6` pinned by digest and `postgres:16.15-alpine3.24`),
`psql`, `jq`, `curl`, Node 22 (≥ 22.21 for `NODE_USE_ENV_PROXY`), the heavy2 gate
(`HEAVY2=…`, default: the audit session's scratchpad `heavy2.sh`).

## Pieces

| File | What it does |
|---|---|
| `stack.sh up <label>` | Throwaway Postgres `slaydx-loadtest-pg` on `127.0.0.1:55441`; `next build` of `REPO_DIR` if `.next` is not from its HEAD (through heavy2, `-m 4G`); then ONE heavy2 slot (`-m 3G`) runs `lib/supervisor.sh`, which starts the jail proxy, `next start` on `:3300` and — immediately or after `stack.sh workers` when `WORKERS_DEFER=1` — `WORKERS` (2) workers with `WORKER_CONCURRENCY` (4). Waits for `/api/health` 200 and self-tests the jail. |
| `stack.sh down <label>` | Graceful supervisor stop (workers get their 20 s drain), then kills only PIDs from its own pidfiles whose cwd is `REPO_DIR`, removes only its own container (`--label slaydx-loadtest=1`), keeps logs in `results/<label>/stack/`. Never uses `pkill`. |
| `stack.sh provider-mode blank\|down\|tarpit` | Switches what workers see as the AI provider (rolling SIGTERM restart of workers). See below. |
| `stack.sh status` | PIDs, restart counters, health, queue, jail hits. |
| `seed.mts` / `seed.sh` | N users (`upsertLocalUser` → 3 000-point bonus), real sessions (`createSession`; the raw token is the cookie), balances via `topUp`, and COMPLETED generations through the app's own `enqueueGeneration` → `claimJob` → `putGenerationFile`/`putAssets` → `completeJob` (40 KB DOCX, ~20 KB thumbnail pre-stored as the thumb asset, 60 KB PNG asset). Writes `.state/tokens.json`. Imports the helpers from `REPO_DIR` at run time, so it works on `main` too (all helpers exist there with the same signatures). Must run while workers are stopped. |
| `k6run.sh <scenario> [out]` | Runs `k6/<scenario>.js` in Docker (`--network host`, `--cpus 3`, `--memory 2g`). |
| `metrics.sh <csv> [sec]` | Every `INTERVAL` s (5): RSS and cumulative CPU per process (from pidfiles), restart counters, `pg_stat_activity` by `application_name`/state, queue depth + oldest QUEUED age, Postgres container memory/CPU. Long CSV `ts,metric,key,value`. |
| `invariants.sh [--wait-idle s]` | SQL PASS/FAIL checks (below). Exit code = number of FAILs. |
| `chaos/*.sh` | Four experiments, each printing PASS/FAIL lines and running the invariants at the end. |
| `run-all.sh <label>` | up → seed → workers → for each scenario: metrics + k6 + invariants → chaos → `summary.md` → down. |
| `lib/jail-proxy.mjs` | The provider jail (below). |

### Scenarios (`k6/`)

| Scenario | Traffic | Full profile default | Measures |
|---|---|---|---|
| `browse` | `GET /uz` + `GET /api/auth/session`, half logged in, 1–3 s think | ramp to 600 VUs | SSR/static page + session lookup latency |
| `poll` | `GET /api/generations/:id?since=` every 1.2–5 s per VU (client cadence), `GET /api/generations` every 10th | 800 VUs (≈ 250 req/s) | the hottest authenticated read path, DB pool pressure |
| `enqueue` | `POST /api/generations` (70 % essay, 30 % image) at `BASE_RPS` (5/s), then ×`BURST_FACTOR` (10) for `BURST` (1 m), then back | arrival-rate | 202 / 429 (`queue_full`, `user_inflight`, rate limit) / 402 split, p95, then ledger invariants |
| `downloads` | `…/file`, `…/thumb?v=0`, `…/thumb`, `…/assets/:id` | 200 VUs | bytes served from Postgres BYTEA, cache headers (`cacheable_*` / `nostore_*` rates) |
| `uploads` | `POST /api/uploads/photo` (30 KB, unique bytes) from 50 users | 100 VUs | upload path, per-user rate limit (20/300 s) and count quota (50) — `upload_*` counters |
| `mixed` | browse 45 % · poll 35 % · downloads 12 % · uploads 3 % of `MIX_VUS` (800) + enqueue at `ENQ_RPS` (3/s) | 800 VUs | realistic blend, per-scenario p95 |

Knobs (env): `PROFILE=smoke|full`, `VUS`, `DURATION` (hold, full 3 m), `RAMP` (full 1 m),
`BASE_RPS`, `BURST_FACTOR`, `STEADY`, `BURST`, `MIX_VUS`, `ENQ_RPS`, `UPLOAD_KB`,
`UPLOAD_USERS`. Thresholds are informative targets (they never abort a run); a crossed
threshold shows as `crossed` in `summary.md` and k6 exits 99. 402/413/429 are declared
expected statuses where they are a correct answer, so `http_req_failed` counts only real
failures.

### Invariants (`invariants.sh`)

`ledger_matches_wallet` (points/quota/balance = Σ transactions for every user),
`no_negative_wallet`, `no_double_charge`, `no_double_refund`, `refund_le_charge`,
`refund_has_charge`, `paid_job_has_charge`, `charge_has_job`, `failed_job_refunded`,
`completed_has_file`, `no_stuck_in_progress` (no IN_PROGRESS row older than its lease =
budget + 30 s, + 90 s for the 60 s housekeeping tick). Mutation-checked: corrupting a
balance, a refund amount or a lease makes the matching check FAIL.

### Chaos (`chaos/`)

| Script | What happens | PASS means |
|---|---|---|
| `pg-restart.sh` | Under k6 mixed load, `docker stop -t 5` Postgres (every connection terminated), `DOWN_SEC` (10) later `docker start` | health 200 within 30 s of Postgres ready and stays 200; web/workers restart ≤ 1 time (no crash loop) and all run at the end; workers take new jobs; invariants |
| `worker-sigkill.sh` | `tarpit` mode, 6 slow jobs, `kill -KILL` worker-1 while it holds jobs; the supervisor restarts it | the killed jobs end after lease expiry + reclaim with exactly one charge and one refund; worker-1 restarted exactly once, worker-2 untouched; web healthy; invariants |
| `provider-down.sh` | Phase A blank keys: 30 image jobs. Phase B `down` mode: 30 essay jobs. k6 browse load throughout | all jobs FAILED (not faked) within `FAIL_SEC`, one charge + one refund each, fake-key calls intercepted by the jail, browse p95 < 500 ms and < 1 % errors; invariants |
| `worker-sigterm.sh` | `tarpit` mode under mixed load, `kill -TERM` worker-1 while it holds jobs | within grace (20 s) + 15 s no job is still leased by the stopped worker (finished or released to QUEUED, W3-A/C14), process exited, jobs end with one charge + one refund; invariants. On `main` `drained_or_released` is expected to FAIL (it exits after 2 s and leaves jobs to lease expiry). |

## Safety: no real provider is ever called

1. Every provider/payment key is set to an empty string for web and workers
   (`stack.sh app_env`), `TELEGRAM_BOT_TOKEN` is fake, LibreOffice/pdftoppm paths point
   nowhere (no `soffice` under load; thumbnails are pre-seeded assets).
2. **Jail proxy.** Node runs with `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY`/`HTTP_PROXY` =
   `127.0.0.1:3399` (`NO_PROXY=127.0.0.1,localhost`): every outbound `fetch` from web and
   workers — all provider adapters use `fetch` — goes to `lib/jail-proxy.mjs`, which never
   forwards; it logs the target to `.state/jail.csv` and answers 502 (`reject`) or holds the
   connection `TARPIT_SEC` (20) then 502 (`tarpit`). `stack.sh up` refuses to continue unless a
   self-test fetch is seen by the jail.
3. `stack.sh up` refuses to run when `REPO_DIR` has `.env`, `.env.local` or `.env.production*`
   (Next loads them under `next start`; unlink the worktree's `.env.local` symlink first).

This is also the **local provider mock** asked for, without app changes: `down` and `tarpit`
give workers a fake Gemini key so the LLM path really calls `fetch`, and the jail decides how
the "provider" behaves (instant failure or a hang). It cannot fake a *successful* LLM answer
(that would need TLS interception), so every provider-backed job ends FAILED + refunded.

Provider modes (`stack.sh provider-mode …`):

| Mode | Worker key | Jail | Effect |
|---|---|---|---|
| `blank` (default) | none | reject | Text tools (essay, crossword, …) render the built-in **offline template** and COMPLETE in ~40 ms (charged, real DOCX render + file write); the image tool fails in ~10 ms → refund. So the default load run exercises both the complete and the refund path. |
| `down` | fake Gemini | reject | LLM tools fail fast → refund (provider outage) |
| `tarpit` | fake Gemini | hold 20 s → 502 | LLM tools hang then fail → refund; used to hit workers mid-job |

## Caveats

- **Laptop-relative.** One machine runs everything; k6 is capped at 3 CPUs / 2 GB, the stack
  at 3 GB (cgroup), Postgres at 1 GB (+1 CPU in the `tuned` profile). Compare runs made with
  the same parameters on the same machine.
- **Postgres config follows the commit** (`PG_PROFILE=auto`): if `REPO_DIR/docker-compose.yml`
  has the W3 tuning (`shared_buffers=256MB` …, `mem_limit 1g`, `cpus 1`) the container gets it,
  otherwise stock settings (main). Force with `PG_PROFILE=tuned|default`.
- **Job budget is capped at 90 s** (`JOB_TIMEOUT_MS`, production 660 s) so lease-expiry chaos
  finishes in ≈ 4 min. It changes `budget_ms` of every job equally on both commits.
- **Process model differs from production.** `next start` (not the standalone `server.js`),
  workers run as `node --import tsx` (one process, so SIGKILL hits the real worker; the
  Docker image runs the `tsx` CLI). No nginx, no TLS, `TRUST_PROXY=false`: every k6 request
  comes from 127.0.0.1, so IP-keyed limits see one client (the tested routes are keyed by
  user, not IP).
- **Shared `node_modules`.** A checkout without `node_modules` gets a symlink to the main
  repo's (`SHARED_NODE_MODULES`), never `npm install`. For `main@76ddf91` that means it runs
  on the audit branch's lockfile (e.g. `sharp` 0.35 instead of 0.34) — a small confound.
- On `main` every process uses `application_name = slaydx`, so `pg_conn` rows cannot split
  web from workers there (the branch names them `slaydx-web@…` / `slaydx-worker@…`).
- **Expected before/after differences** seen in validation: on `main` the downloads
  scenario reports `cacheable_asset = 0` / `cacheable_thumb_versioned = 0` (config header
  overrode the route's cache header, C08), no `enq_429_queue_full` (no admission control,
  C22), and `worker-sigterm` `drained_or_released` should FAIL (2 s exit, C14).
- **Worker idle poll is 1.5 s** (`IDLE_POLL_MS`): at a 20 req/s burst the branch queued up
  to ~37 fast (40 ms) jobs and answered `queue_full` 429 for ~15 % of requests although
  8 slots were mostly idle — the admission estimate (200 s/job) is far above the real
  service time of offline-template jobs. Keep this in mind when reading the enqueue split.
- **Not covered:** real LLM latency/cost, LibreOffice PDF/thumbnail conversion under load
  (disabled on purpose — it is CPU heavy and would dominate the laptop), payments, Telegram
  login (sessions are minted directly with `createSession`), browser rendering.
- **Seed must precede workers.** Seeding completes its jobs with its own claims; running
  workers would steal and fail them (`seed.sh` refuses unless `--gen-users 0`).
- heavy2 has 2 machine-wide slots: the stack holds one for its whole life, `next build` /
  `seed` need the other. If other agents hold both, `stack.sh up` waits (`SLOT_WAIT`, 30 min).
