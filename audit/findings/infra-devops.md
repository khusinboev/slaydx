# infra & devops — findings
Scope actually covered: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.gitignore`, `instrumentation.ts`, `lib/server/env.ts`, `lib/server/db.ts`, `lib/server/jobs.ts`, `lib/server/worker.ts`, `scripts/worker.ts`, `scripts/dev.sh`, `scripts/heavy.sh`, `scripts/run-build.mts`, `scripts/migrate.ts`, `scripts/guard-build.mjs`, `app/api/health/route.ts`, `lib/brand.ts` + its call sites, `tests/compose-env.test.mts`, `.claude/deploy.md`, `.claude/structure.md` (skim), `README.md`, `CLAUDE.md`, `package.json`, and the relevant installed `next` runtime source (`node_modules/next/dist/server/lib/start-server.js`, `.../instrumentation-globals.external.js`) to verify claims about Next's standalone-server signal handling rather than assert them from memory.
Not covered: application-level business logic, generation engine internals (`lib/generation/**`), frontend/viewer code, nginx's actual live config and the prod box itself (no SSH, per rules) — those are inferred only from code comments and `.claude/deploy.md`, flagged as such below.

Summary: P0 1 · P1 5 · P2 7 · P3 2

---

### INFRA-01 — `instrumentation.ts` throws on prod misconfig instead of exiting: process stays alive, serves 500 to everything including its own healthcheck, and is never auto-restarted — **already caused a full production outage**
- **Severity:** P0
- **Location:** `instrumentation.ts:21-24` (config-validation throw), `instrumentation.ts:31-35` (migration-failure throw), `lib/server/env.ts:261-278` (the incident writeup, in the project's own comments), `app/api/health/route.ts:40-48` (unauthenticated health check depends only on DB), `docker-compose.yml:29` (`restart: unless-stopped`, no `healthcheck:`-based restart policy)
- **Evidence:** `instrumentation.ts` register() does:
  ```ts
  if (env.isProd && problems.length) {
    throw new Error(`Konfiguratsiya to'liq emas:\n  - ${problems.join("\n  - ")}`);
  }
  ```
  and, separately, rethrows any `ensureMigrated()` failure when `env.isProd`. Neither path calls `process.exit()`. Traced through the installed Next.js runtime (`node_modules/next/dist/server/lib/router-utils/instrumentation-globals.external.js:81-87`): `ensureInstrumentationRegistered()` memoizes `registerInstrumentation()`'s promise in a **module-level variable**. Once that promise rejects, it stays rejected forever — every subsequent request that calls `runInstrumentationHookIfAvailable()` re-awaits the same dead promise and gets the same error, which Next's per-request error boundary turns into a 500. The top-level HTTP listener never crashes (`server.listen()` already succeeded), so `docker ps` shows the container "Up" the whole time — Docker only restarts a container on **exit**, never on a failed `HEALTHCHECK` (confirmed via the image's `HEALTHCHECK` in `Dockerfile` — it can only ever flip the reported status to `unhealthy`, nothing in `docker-compose.yml` or `deploy.sh`'s poll loop watches for that ongoing).
  This is not theoretical — `lib/server/env.ts:265-270` documents the exact incident happening in prod: *"2026-09-17 saboq: TTS kaliti yo'qligi `problems`ga qo'shilgan edi va `instrumentation.ts` prod da ro'yxat bo'sh bo'lmasa `throw` qiladi — **AUDIT-22 deployidan keyin web konteyneri «unhealthy» bo'lib, 15 ta ishlaydigan vosita ham yotib qoldi**."* (translation: after the AUDIT-22 deploy, the web container went unhealthy and all 15 working tools went down with it.) That fix moved the *specific* TTS check to `runtimeWarnings()` (non-fatal), but the underlying mechanism — any future required-config or migration problem still `throw`s and still produces the same unrecoverable zombie — is untouched.
  Baseline run (`audit/00-baseline.md`) independently reproduced the same class of failure locally: missing `TELEGRAM_BOT_TOKEN` → process alive, `/api/health` → 500 for every request.
- **Reproduction:** `docker compose -p slaydx up -d` with any one currently-required env var missing (e.g. drop `TELEGRAM_BOT_TOKEN`, or ship a migration that fails on prod data) → `docker ps` shows `slaydx-web-1` running, health status flips to `unhealthy`, `curl 127.0.0.1:3000/api/health` returns 500/503 forever, `docker compose logs web` shows the thrown error once and then silence (no crash, no retry log) — the only way out is a human running `docker compose -p slaydx restart web` or fixing the env and redeploying.
- **Proposed fix:** In `instrumentation.ts`, replace both `throw`s (prod branch only) with an explicit `console.error(...); process.exit(1);`. That turns the zombie-hang into a real container exit, which `restart: unless-stopped` (already configured) will actually act on — converting a silent total outage into a visible crash-loop, which is at minimum observable via `docker ps` restart counts, matching how `scripts/worker.ts:12-15` already correctly does `process.exit(1)` on its fatal path. Pair with an external alert (see INFRA-06) since a crash-loop is still down, just visibly so.
- **Effort:** S
- **Confidence:** high — mechanism verified by reading the actual installed Next.js source (not assumed), corroborated by the baseline reproduction and by the project's own documented 2026-09-17 production incident.

---

### INFRA-02 — Worker's SIGTERM handler force-exits after a hardcoded 2s, abandoning in-flight jobs on every deploy; abandoned jobs then sit silently for up to ~11 minutes before retry
- **Severity:** P1
- **Location:** `lib/server/worker.ts:408-417` (`runWorkerProcess`), `lib/server/jobs.ts:481-521` (`reclaimStaleJobs`, stale threshold), `docker-compose.yml` (no `stop_grace_period:` on `worker`, default Docker grace = 10s), `.env.example`/`docker-compose.yml:156` (`WORKER_JOB_TIMEOUT_MS: ${WORKER_JOB_TIMEOUT_MS:-660000}`)
- **Evidence:**
  ```ts
  export async function runWorkerProcess(): Promise<void> {
    const shutdown = () => {
      console.log("[worker] to'xtatilmoqda...");
      stopWorker();                              // only stops claiming NEW jobs
      setTimeout(() => process.exit(0), 2000);   // unconditional, ignores `running`
    };
    process.on("SIGTERM", shutdown);
    ...
  ```
  `stopWorker()` just sets `stopped = true`, which stops the polling loop from calling `tick()` again — it does **not** wait for jobs already in flight (`tick()` fires `runJob()` with `void`, i.e. fire-and-forget; `running` can be >0 when `shutdown()` fires). Two seconds later the process exits unconditionally, mid-job if a job happens to be running. `WORKER_CONCURRENCY` defaults to 2, so up to 2 concurrent generations (course papers, articles etc. that legitimately take minutes — `WORKER_JOB_TIMEOUT_MS` defaults to 660000ms = 11 min precisely because real jobs need that long) are killed on every single `docker compose -p slaydx up -d` during a deploy.
  The abandoned job's row is left `IN_PROGRESS` with `locked_by`/`locked_at` frozen at the last heartbeat (heartbeats land every ~2s while healthy, so `locked_at` ≈ time of kill). `reclaimStaleJobs()` only requeues a row once `now() - locked_at > budget_ms/1000 + 30s` — for a job that had, say, 660s of budget, that means the user's progress bar sits frozen for **up to ~11 minutes** before the job is even noticed as stale and requeued (with `run_after = now() + 5s`), and it only gets one further attempt (`attempts < 2`) before landing on `FAILED` + refund.
- **Reproduction:** Start a long tool (course paper / pro-slide) against a local worker, `docker compose -p slaydx up -d --build` (or `kill -TERM <worker pid>`) while it's mid-job; observe the job's DB row stays `IN_PROGRESS` with a stale `locked_at`, and the user-visible progress freezes for the remainder of that job's `budget_ms` window before it re-queues.
- **Proposed fix:** In `shutdown()`, await in-flight jobs (poll `running === 0`) up to a bounded grace window before exiting, **and** set an explicit `stop_grace_period:` in `docker-compose.yml` for `worker` long enough to cover that window (or at least longer than the default 10s, which today is shorter than the app's own 2s timer anyway, so the app-level timer is what actually fires first — but neither is long enough for real jobs). If waiting out the full job isn't acceptable for deploy speed, proactively release the lock (`UPDATE generations SET status='QUEUED', locked_by=NULL ...`) for any job this worker is still holding, so the *replacement* worker can pick it up within its next poll cycle (1.5s) instead of waiting out the stale-lock timeout.
- **Effort:** M
- **Confidence:** high — read directly off the code; the interaction between the 2s timer and `reclaimStaleJobs`'s budget-based threshold is deterministic, not inferred.

---

### INFRA-03 — No backpressure: `WORKER_CONCURRENCY=2` (single worker container) against a 2 000-concurrent / 10× burst target means the queue grows without bound, with no cap, no per-QUEUED-job timeout, and no ETA
- **Severity:** P1
- **Location:** `docker-compose.yml:155` (`WORKER_CONCURRENCY: ${WORKER_CONCURRENCY:-2}`), `lib/server/jobs.ts:341-380` (`claimJob`, plain FIFO via `ORDER BY created_at`), `lib/server/jobs.ts:159-193` (`enqueueGeneration` — no queue-depth check before accepting/charging), `lib/server/jobs.ts:523-531` (`queueDepth()` returns only counts, no age of oldest item), `README.md` (rate limit is **per-user**: 5/min, 60/hour — no global cap)
- **Evidence:** The only throughput-limiting knob in the whole system is `WORKER_CONCURRENCY` (default 2, one process, one container, one VPS). `claimJob()` takes strictly the oldest `QUEUED` row; there is no priority, no queue-depth ceiling, and `enqueueGeneration()` accepts and charges a job regardless of how deep the backlog already is. At the brief's stated target (2 000 concurrently active users, 10× burst e.g. exam season / a Telegram post), even a modest fraction of users queuing a document at once produces an arrival rate the system cannot drain: with concurrency=2 and typical multi-minute jobs (the system's own default budget is 11 minutes for the *most expensive* tier, but even a mid-size job in the tens-of-seconds-to-few-minutes range caps steady-state throughput at roughly `2 / avg_job_seconds` jobs/sec). A burst of a few hundred requests in an hour already exceeds that; the backlog then grows monotonically for the duration of the burst, with **no mechanism that tells a queued user their position or ETA** (the UI only starts showing real progress once a worker actually claims the job) and **no timeout on the `QUEUED` state at all** — `reclaimStaleJobs()` only ever acts on rows already `IN_PROGRESS`. A user's wait time under a real burst is unbounded and invisible.
- **Reproduction (sketch, for orchestrator to run under `heavy.sh`, not here):** seed N `QUEUED` rows via direct enqueue calls with `WORKER_CONCURRENCY=2`, measure wall-clock until the queue drains; confirm `queueDepth()` grows monotonically while `N`'s arrival rate exceeds ~`2/avg_duration`, and confirm no query anywhere reports the age of the oldest `QUEUED` row.
- **Proposed fix:** Make `WORKER_CONCURRENCY` and worker replica count load-testable and tune them to the real target (this requires load data this audit doesn't have — flag as a capacity-planning task, not just a config bump, since a single worker container backed by a single Postgres with default tuning is also a ceiling — see SPOF note in "Checked and OK"). Shorter-term: add a queue-depth-aware backpressure response (reject new enqueues with a clear "system busy" once queue depth crosses a threshold, refunding immediately) so money isn't charged into a queue with no realistic ETA, and surface `queueDepth()`/oldest-QUEUED-age in the authenticated `/api/health` payload so it's at least observable (ties to INFRA-06).
- **Effort:** L (real fix is capacity + design work, not a one-line change)
- **Confidence:** high on the mechanism (FIFO, no cap, no backpressure — all directly read from code); medium on the exact scale at which it becomes user-visible, since that depends on real average job duration under prod traffic, which this audit did not measure (no live calls allowed, per rules).

---

### INFRA-04 — No resource limits on any container: one runaway LibreOffice/worker process can starve Postgres *and* the two other unrelated projects sharing the VPS
- **Severity:** P1
- **Location:** `docker-compose.yml` (entire file — no `mem_limit`, `cpus`, `deploy.resources`, or equivalent on `web`, `worker`, or `postgres`), `Dockerfile` (LibreOffice — `soffice --headless` — runs inside the `web`/runner image for PDF export and inside `worker` isn't needed but the `runner` image ships it; SVG→PNG rasterization via `sharp`/librsvg runs in `worker`)
- **Evidence:** `grep -n "mem_limit\|cpus\|logging\|shared_buffers\|max_connections" docker-compose.yml` returns nothing. None of the three services has any CPU or memory ceiling. This is not just an internal-fairness issue: `.claude/deploy.md` and `README.md` both state explicitly that this VPS is **shared with two unrelated projects** (`nodavlattalim`: 4 containers including its own Postgres+Redis, `mser`). Docker's default behavior with no `mem_limit` is to let a container consume host memory up to the point the kernel OOM-killer intervenes — at which point it can pick *any* process on the box, not necessarily the offending one. LibreOffice is a well-known memory/CPU spiker on malformed or very large documents, and `WORKER_CONCURRENCY=2` means two such conversions (or two heavy `sharp` rasterizations) can run concurrently with no ceiling. A single pathological job (e.g., an unusually large pro-slide/翻訳 file) can degrade or OOM-kill Postgres or a neighboring project's containers on the same host, which have nothing to do with this codebase.
- **Reproduction:** Not run (no heavy commands/containers per audit rules) — verified purely by absence of any limiting directive in the compose file, cross-referenced against the documented shared-tenancy constraint in `.claude/deploy.md`.
- **Proposed fix:** Add `mem_limit`/`cpus` (Compose v2 top-level fields, or `deploy.resources.limits` if using the Compose spec's newer schema) to all three services, sized from real observed peak RSS (needs a measurement pass, not a guess) plus headroom, and set Postgres's own `shared_buffers`/`work_mem`/`max_connections` explicitly (currently 100% image defaults) so its own footprint is predictable rather than whatever the alpine image ships.
- **Effort:** S (config-only) to add limits; M to right-size them safely without under-provisioning the LibreOffice path.
- **Confidence:** high — absence is directly verifiable; impact reasoning follows from documented shared-VPS constraint, not speculation.

---

### INFRA-05 — Backups are manual, pre-deploy-only, stored on the same box as the primary database, and restore has never been exercised
- **Severity:** P1
- **Location:** `.claude/deploy.md` §"1. Zaxira" and §"4. Orqaga qaytarish"
- **Evidence:** The only backup mechanism documented anywhere in the repo is:
  ```bash
  ssh root@194.163.136.239
  mkdir -p /root/slaydx-backups
  ts=$(date +%Y%m%d%H%M%S)
  docker exec slaydx-postgres-1 pg_dump -U slaydx slaydx > /root/slaydx-backups/slaydx-$ts.sql
  ```
  run **by hand, only immediately before a deploy**. There is no cron/systemd timer, no scheduled job anywhere in the repo or in `deploy.sh`'s documented steps, and the dump lands in a plain directory (`/root/slaydx-backups/`) on the **same VPS** as `slaydx-postgres-1`'s live volume — not copied off-box. `deploy.md` §4 itself admits restore is a break-glass, human-judgment operation ("bu YO'QOTISHGA olib keladigan amal" — "this is an operation that leads to LOSS", said about restoring from backup), which combined with no restore test anywhere in the repo means the actual recovery procedure is unverified. RPO is therefore bounded only by **how often a deploy happens** — if a week goes by with no deploy (plausible: this is feature work, not every day per the sprint cadence in project history) and the DB is corrupted or the disk fails the day before a deploy, up to that entire window of user data, paid transactions (Click/Payme), and generated documents is unrecoverable. Because primary and backup live on the same disk, a single VPS-level incident (the box is explicitly shared with two other projects and root is shared per `deploy.md`'s own warnings against `docker system prune -a`/`volume prune`, which exist *because* of the shared tenancy) can take out both simultaneously.
- **Reproduction:** N/A (process/documentation gap, not a code path to exercise) — confirmed by exhaustive read of `.claude/deploy.md`, the only place backups are documented, and absence of any backup-scheduling file elsewhere in the repo (`grep -rn "pg_dump\|cron\|systemd.timer" --include="*.sh" --include="*.md"` outside `deploy.md` returns nothing).
- **Proposed fix:** Add a scheduled (systemd timer or cron) `pg_dump`, independent of deploy cadence, with rotation; copy backups off-box (even a cheap object-storage push is enough to survive a VPS-level incident); actually perform and document one full restore-from-backup drill so the "kelishib bajaring" (do this carefully together) step in `deploy.md` §4 is a rehearsed procedure, not a first-time-under-pressure one.
- **Effort:** M
- **Confidence:** high for what's documented/missing in the repo; the actual backup file retention/rotation and disk headroom on the live box could not be verified (no SSH per rules) — orchestrator can confirm via `ls -la /root/slaydx-backups/ | wc -l` and `df -h` on the box.

---

### INFRA-06 — Worker has no `HEALTHCHECK`, and the health endpoint Docker/anyone unauthenticated actually sees never looks at worker liveness or queue staleness — a dead or hung worker is invisible until users complain
- **Severity:** P1
- **Location:** `Dockerfile` (worker stage, lines defining the `worker` target — no `HEALTHCHECK` instruction, unlike the `runner` stage a few lines above which has one), `docker-compose.yml` (`worker:` service — no `healthcheck:` block either), `app/api/health/route.ts:40-48` (the `healthy` boolean — and therefore the HTTP status code every unauthenticated caller, including Docker's own healthcheck on `web`, sees — is computed from `db === "up"` alone)
- **Evidence:** The `runner` (web) stage ends with:
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health')..."
  ```
  The `worker` stage that follows has **no equivalent** — Docker has no built-in signal at all for whether the worker process is alive, wedged, or has silently stopped polling (e.g. stuck inside a LibreOffice call with no timeout reached yet). Even if it did, or even for `web`'s own healthcheck: `route.ts`'s public branch (`isInternal(req)` false, which is every request without a valid `CRON_SECRET` bearer token — including Docker's own `node -e "fetch(...)"` check) computes `healthy` from DB connectivity only:
  ```ts
  const healthy = db === "up";
  if (!isInternal(req)) {
    return NextResponse.json({ status: healthy ? "ok" : "degraded" }, { status: healthy ? 200 : 503, ... });
  }
  ```
  Queue depth (`queueDepth()`) and config `problems` are computed *after* this branch and only returned to a caller presenting `CRON_SECRET` — they never affect the status code anyone (Docker, an uptime checker, nginx) actually acts on. So: worker dies → `web`'s healthcheck stays green (DB is fine) → `docker ps` shows worker container "Up" forever (no healthcheck to flip) → every queued generation silently piles up → the first signal anyone gets is a user reporting their document never finished. There is no alerting mechanism anywhere in the repo (no Sentry/webhook/Telegram-ops-alert integration found via repo-wide search for `sentry|alertmanager|webhook.*alert|ops.*telegram`).
- **Reproduction:** `docker compose -p slaydx stop worker` (or kill the process) while leaving `postgres`/`web` up — `docker ps` and `web`'s `/api/health` (unauthenticated) both continue to report healthy; only `GET /api/health` with a valid `CRON_SECRET` bearer token would show `queue.queued` climbing, and nothing polls that automatically.
- **Proposed fix:** Add a `HEALTHCHECK` to the `worker` stage (simplest: a liveness file/heartbeat the loop touches every tick, checked by the HEALTHCHECK `CMD`, e.g. `test $(($(date +%s) - $(stat -c %Y /tmp/worker-heartbeat))) -lt 30`). Fold `queueDepth()` and "oldest QUEUED row age" into the *unauthenticated* health status's degraded/down decision (or at minimum add a separate `/api/health/worker` that an external uptime monitor can poll), and wire up some external alert (even a simple periodic curl-and-Telegram-message cron job) since nothing currently notifies a human.
- **Effort:** M
- **Confidence:** high — both the missing `HEALTHCHECK` and the health-endpoint logic are read directly off the code.

---

### INFRA-07 — No rolling/blue-green deploy: `docker compose up -d` stops the only `web` container before the replacement is ready, producing a connection-refused window on every deploy
- **Severity:** P2
- **Location:** `docker-compose.yml` (`web:` service — single instance, no `deploy.replicas`, no companion orchestration), `.claude/deploy.md` §2 (`deploy.sh` does `docker compose -p slaydx build && up -d`)
- **Evidence:** With exactly one `web` replica and plain `docker compose up -d` (no Swarm, no `--scale`, no external LB doing connection draining across two instances), recreating the service necessarily stops the existing container before the new one can be started and pass its healthcheck's `start-period` (20s). nginx, sitting in front on the host, has exactly one upstream (`127.0.0.1:3000`) and no retry-to-a-second-upstream to fall back on during that gap — any request arriving between "old container stopped" and "new container listening" gets connection-refused (502 from nginx). Next's own graceful-shutdown handling (verified correct — see "Checked and OK") only controls *how the old container drains*, it does nothing about the gap before the *new* one is ready.
- **Reproduction:** Not run (would require a live container recreate, out of scope here) — architectural, inherent to "single service, plain `up -d`" with no orchestration layer; confirmable live via a tight polling loop against `/api/health` during a real `deploy.sh` run.
- **Proposed fix:** Either accept the brief downtime as a known tradeoff (document expected duration), or move to a two-step recreate (`docker compose up -d --no-deps --scale web=2 web`, wait for the new one healthy, then remove the old — doable without full orchestration), or put a second nginx upstream / a tiny lightweight LB in front that can hold requests a few seconds during recreate.
- **Effort:** M
- **Confidence:** high on the mechanism (standard Compose behavior); the actual observed downtime duration wasn't measured (would require a live deploy).

---

### INFRA-08 — `web` has no explicit `stop_grace_period`; Docker's 10s default is shorter than the service's own documented ~45s synchronous endpoints, so SIGKILL can truncate in-flight edit requests on every deploy
- **Severity:** P2
- **Location:** `docker-compose.yml` (`web:` service — no `stop_grace_period:` key; Compose/Docker default is 10s), `.claude/deploy.md` §2a: *"Tahrir routelari (`POST /api/generations/{id}/rebuild` — 30 slaydli PPTX qayta yasash, `…/image/regenerate` — Gemini rasm ~35–45 s) nginx ning standart `proxy_read_timeout 60s` ga sig'masligi mumkin."*
- **Evidence:** `deploy.md` itself documents that `rebuild`/`image/regenerate` are synchronous, in-request operations on the `web` container taking up to ~45 seconds (hence the manual nginx `proxy_read_timeout 120s` recommendation for that route). Next's standalone server does drain gracefully on SIGTERM (`server.close()`, waits for in-flight requests — verified in `node_modules/next/dist/server/lib/start-server.js`), but Docker will send **SIGKILL** after `stop_grace_period` regardless of whether the graceful drain finished — and that grace period is never set in `docker-compose.yml`, so it defaults to 10 seconds. Any `rebuild`/`image/regenerate` request in flight when a deploy's `up -d` recreates `web` has a good chance of being hard-killed well before completion.
- **Reproduction:** Trigger `POST /api/generations/{id}/rebuild` on a large deck, then within the same ~45s window run `docker compose -p slaydx up -d` for `web` — expect the client to see a dropped connection; the request's writes are transactional so no corruption is expected, but the user-visible edit is lost and must be retried.
- **Proposed fix:** Add `stop_grace_period: 60s` (or longer) to the `web` service in `docker-compose.yml` to match the documented worst-case request duration.
- **Effort:** S
- **Confidence:** high — the 45s figure is the project's own documented number, not an estimate; the missing compose key is directly verifiable.

---

### INFRA-09 — `NEXT_PUBLIC_BRAND_NAME`/`NEXT_PUBLIC_BRAND_LOGO` are not passed to the `worker` container, so a brand rename would silently keep stamping the old default into generated PPTX metadata
- **Severity:** P2
- **Location:** `docker-compose.yml:37,82` (only in `web:`'s environment block) vs. `docker-compose.yml:100-156` (`worker:`'s environment block — these two keys are absent), `lib/brand.ts:17-21` (`BRAND_NAME`/`BRAND_SHORT` read `process.env.NEXT_PUBLIC_BRAND_NAME` directly at import time — no Next.js build-time inlining applies here since the worker is a plain `tsx` process, not a Next.js runtime), `lib/generation/render-pptx.ts:187` (`pptx.author = doc.meta.author || BRAND_SHORT;`)
- **Evidence:** `buildArtifact()` (and therefore PPTX rendering, which stamps `BRAND_SHORT` into the file's `author` metadata) runs inside the **worker** process for every real generation job. `lib/brand.ts` resolves `BRAND_NAME`/`BRAND_SHORT` from `process.env.NEXT_PUBLIC_BRAND_NAME` at module-load time, exactly like any other server env var — there is no Next.js-specific build-time substitution for the worker, since `scripts/worker.ts` is run directly via `tsx`, never through the Next.js build/runtime pipeline. `docker-compose.yml`'s `worker:` environment block (lines 100-156) never sets `NEXT_PUBLIC_BRAND_NAME` or `NEXT_PUBLIC_BRAND_LOGO`, so inside that container `lib/brand.ts` always falls back to its hardcoded literal default `"SlaydX"` regardless of what `.env`/`web` are configured with. Today this is masked because the hardcoded fallback happens to equal the current real brand name — but `README.md`'s own "Ma'lum cheklovlar" section flags the brand/domain as still unsettled ("Domen hali olinmagan — ochilishdan oldin hal qilinishi kerak"), meaning a rename via env var is a plausible near-term operation, not a hypothetical. This is the same *class* of bug `tests/compose-env.test.mts` was written to catch after three prior incidents (LLM roles, OpenAlex keys, TTS chain vars, image model vars all separately fell into this exact web-has-it/worker-doesn't gap before) — but that test's `KEYS` list does not include the brand vars, so this instance isn't caught.
- **Reproduction:** Set `NEXT_PUBLIC_BRAND_NAME=Something Else` in `.env` on a compose stack, redeploy, generate a PPTX via the queue (worker path) and inspect its OOXML `docProps/core.xml` `<dc:creator>`/author field — it will still read "SlaydX", while the web UI (sidebar, page titles) correctly shows "Something Else".
- **Proposed fix:** Add `NEXT_PUBLIC_BRAND_NAME: ${NEXT_PUBLIC_BRAND_NAME:-SlaydX}` and `NEXT_PUBLIC_BRAND_LOGO: ${NEXT_PUBLIC_BRAND_LOGO:-/logo.png}` to the `worker:` environment block in `docker-compose.yml`, and add both keys to `tests/compose-env.test.mts`'s `KEYS` list so this class of regression is locked the same way the other four are.
- **Effort:** S
- **Confidence:** high — the import chain (`render-pptx.ts` → `lib/brand.ts` → `process.env`) and the compose env block contents were both read directly, not inferred.

---

### INFRA-10 — `.dockerignore` doesn't exclude `eval-out/`, `scratch-tmp/`, `.claude/`, `audit/`, or `docs/` — unlike `.gitignore`, which excludes the first three explicitly — so a build run against a working tree that has them (as this one currently does) bakes them into the `builder` stage's image layer
- **Severity:** P2
- **Location:** `.dockerignore` (full contents: `node_modules`, `.next`, `.git`, `.env`, `.env.*`, `!.env.example`, `*.log`, `*.tsbuildinfo`, `.data`, `namunalar`, `README.md`, `Dockerfile`, `docker-compose.yml`), `.gitignore` (excludes `/.data`, `eval-out/`, `/CLAUDE.md`, `/.claude/`, `scratch-tmp/` — a materially different, more cautious list), `Dockerfile` (`builder` stage: `COPY . .`)
- **Evidence:** The `builder` stage does an unqualified `COPY . .`, so everything **not** matched by `.dockerignore` enters that stage's build context and layer. Directly measured on this working tree: `.claude/` is **1.1 GB** (mostly `.claude/worktrees/`, 18 agent-session working copies — very likely a local/dev-machine-only artifact, not expected on the prod box's `/opt/slaydx` checkout, but nothing in `.dockerignore` would stop it from being picked up if it ever existed there too), `eval-out/` is 56 MB, `audit/` (this audit, including, once merged, every finding in every auditor's `findings/*.md` — a roadmap of exploitable weaknesses) is 188 KB and *is* git-tracked so *will* exist on the prod checkout after merge. None of `.claude`, `audit`, `eval-out`, `scratch-tmp`, or `docs` appear in `.dockerignore`, even though the project's own `README.md` explicitly states `.claude/`'s contents "serverga tegishli tafsilotlarni o'z ichiga oladi, umumiy repo'ga tushmasligi kerak" (contains server-related details that must not reach the shared repo) — yet nothing stops them from reaching a Docker image layer, which is a different but adjacent exposure surface (anyone with `docker history`/build-cache access on the shared box, e.g. an operator of one of the two other projects if root is shared, could recover it even though the *final* runner/worker images don't `COPY` these paths directly — they're only ever excluded by virtue of the final stages using targeted `COPY --from=builder <specific path>`, not `COPY . .`, so the intermediate `builder` layer/cache is the actual leak surface).
- **Reproduction:** `du -sh .claude eval-out scratch-tmp audit docs` on the current tree (already run: 1.1G / 56M / 52K / 188K / 1.1M) confirms these exist and are non-trivial; `docker build --target=builder .` (not run here, per no-heavy-commands rule) would confirm they land in that stage's layer.
- **Proposed fix:** Add `eval-out/`, `scratch-tmp/`, `.claude/`, `audit/` to `.dockerignore`, mirroring `.gitignore`'s intent (and note `docs/` is git-tracked/public anyway so lower priority). This is a pure config change with no behavior risk.
- **Effort:** S
- **Confidence:** high for the `.dockerignore` gap and directory sizes (directly measured); medium for whether `.claude/worktrees/` specifically would ever exist on the real prod checkout (that's a local-dev artifact from this audit's own environment, not confirmed present on `/opt/slaydx` — no SSH available to check) — the `audit/` case, however, is git-tracked and will exist there post-merge regardless.

---

### INFRA-11 — nginx (TLS termination, body-size limits, timeouts, rate limiting) lives entirely outside version control — unverifiable from the repo, and has already caused one documented misconfiguration
- **Severity:** P2
- **Location:** `.claude/deploy.md` (`/etc/nginx/sites-available/slaydx` referenced but not present in-repo, edited manually on the host), `lib/server/source-upload.ts:38-42` and `lib/server/template-upload.ts:38` (code comments asserting nginx's `client_max_body_size` is `32m` on prod — an un-enforced claim about infrastructure the repo cannot see or test)
- **Evidence:** Every nginx behavior the checklist for this audit asks about — `client_max_body_size` vs the app's 20 MB upload limits, `proxy_read_timeout` for the ~45s edit endpoints (INFRA-08), and any rate limiting at the proxy layer — is configured only by hand, directly on the shared production host, with no copy tracked anywhere in this repository (confirmed: no `nginx.conf`/`*.conf`/`sites-available` file exists in the repo tree). The only record of the *intended* value is a source-code comment (`source-upload.ts:41-42`: *"nginx `client_max_body_size` 32m — bu chegaradan yuqori"*) which nothing enforces or verifies stays true. `deploy.md` §2a itself is a first-hand account of this going wrong once already: a new long-running edit route shipped, nginx's default `proxy_read_timeout 60s` didn't cover it, and the fix required someone to remember to hand-edit the host config and reload — a manual, undiffed, unreviewed step that depends entirely on the operator remembering `deploy.md`'s instructions at the right time.
- **Reproduction:** N/A — absence confirmed by repo-wide search for nginx config files; the described past incident is documented first-hand in `deploy.md` itself, not inferred.
- **Proposed fix:** Bring the nginx site config into the repo (even just as a reference file deployed by `deploy.sh`, e.g. `infra/nginx/slaydx.conf` copied to `/etc/nginx/sites-available/slaydx` on deploy) so body-size/timeout/rate-limit settings are diffable, reviewable, and reproducible instead of tribal knowledge on one box.
- **Effort:** M
- **Confidence:** high that it's untracked (verifiable); medium on the *current* live values (can't be confirmed without SSH, which is out of scope — orchestrator can verify with `ssh root@194.163.136.239 'nginx -T'` if desired).

---

### INFRA-12 — Worker's production image ships the full `devDependencies` tree (eslint, jsdom, tailwindcss, testing-library, typescript, …) purely to get the `tsx` binary
- **Severity:** P2
- **Location:** `Dockerfile` (worker stage): `RUN npm ci --include=dev && npm cache clean --force`, `package.json` `devDependencies` (14 packages including `jsdom`, `tailwindcss`, `eslint`, `typescript`, `@testing-library/*`)
- **Evidence:** The Dockerfile's own comment explains *why* `--include=dev` is there (a real, already-fixed past incident where `npx tsx` tried to download `tsx` from the registry at container start if it wasn't locally installed, freezing the whole queue if the registry was unreachable) — that specific problem is correctly solved (the `CMD` invokes `./node_modules/.bin/tsx` directly, not `npx tsx`; verified). But the chosen fix (install *all* devDependencies) is broader than the actual need (just `tsx` + its own deps). The result is a production container — one that parses untrusted user-uploaded DOCX/PPTX/XLSX/PDF files and calls out to LibreOffice — running with `eslint`, `jsdom`, `tailwindcss`'s full dependency trees present on disk, none of which `scripts/worker.ts` ever executes. This is pure unnecessary attack surface (more installed code = more CVEs land in `npm audit`/image scans for packages that can never actually run) and image bloat, for zero runtime benefit.
- **Reproduction:** `docker run --rm --entrypoint sh slaydx-worker -c "ls node_modules/.bin/ | grep -c ."` (not run here — no container builds per audit rules) would show dozens of dev-only binaries present in the shipped image; inspectable statically already via `package.json`'s `devDependencies` list plus the Dockerfile's `--include=dev`.
- **Proposed fix:** Either (a) install only `tsx` (and its transitive deps) explicitly into the worker stage instead of the whole `devDependencies` set, or (b) better: precompile `scripts/` + `lib/` to plain JS at build time (`tsc`/esbuild) in the `builder` stage and run worker via plain `node`, matching how the `runner` stage already ships zero devDependencies. Option (b) also removes the `--conditions=react-server` `tsx` runtime-transform cost on every worker boot.
- **Effort:** M
- **Confidence:** high — directly read off `Dockerfile` and `package.json`.

---

### INFRA-13 — No CI: tests only ever run on a developer laptop, and the production build itself happens on the shared prod box at deploy time with no pre-merge gate
- **Severity:** P2
- **Location:** repo root (`.github/` absent), `.claude/deploy.md` §2 (`deploy.sh`: `git fetch → git reset --hard origin/main → docker compose -p slaydx build && up -d`)
- **Evidence:** `ls -la .github` confirms no workflows directory exists anywhere in the repo. `npm run check` (typecheck+lint+unit+viewer+UI tests) and `npm run build` are documented as local-only commands (`README.md` "Buyruqlar" section, `CLAUDE.md`'s heavy-command rules) — nothing enforces they were run, let alone passed, before a commit reaches `main`, and `main` is exactly what `deploy.sh` blindly `reset --hard`s to and builds. The `next build --turbopack` compilation step (CPU/memory-intensive — baseline measured 35s on a 12-core/14GB laptop) runs **on the live production VPS**, which is simultaneously serving traffic for this project and running four containers for a second, unrelated project (`nodavlattalim`) and a third (`mser`) — i.e., every deploy's build phase is a resource-contention event on a box that isn't provisioned as a build server.
- **Reproduction:** N/A — absence of `.github/` and the build-on-prod step are both directly confirmed facts, not behavior to reproduce.
- **Proposed fix:** Add a CI workflow (even a minimal one — `npm run check` + `npm run build` on push/PR) as a merge gate, and move the image build off the prod box (build in CI, push to a registry, have `deploy.sh` `pull` + `up -d` instead of `build && up -d`) so deploys stop competing with live traffic and the two neighboring projects for CPU/RAM.
- **Effort:** M
- **Confidence:** high.

---

### INFRA-14 — Base image `node:22-alpine` is pinned only to the major version, and the image is rebuilt from that floating tag on every deploy — builds are not reproducible and can drift silently
- **Severity:** P3
- **Location:** `Dockerfile:5,13,58` (`FROM node:22-alpine AS deps/builder/worker`, `FROM node:22-alpine AS runner` — no digest, no full version)
- **Evidence:** All four build stages pin only `node:22-alpine` (major version only, no `22.x.y` patch pin, no `@sha256:...` digest pin). Because the image is built **on the prod box, at deploy time** (not built once in CI and promoted as an immutable artifact — see INFRA-13), every `docker compose -p slaydx build` can silently pull a different underlying Node/Alpine patch release than the previous deploy did, even for an identical git commit. This makes builds non-reproducible (can't rebuild "exactly what's running" later for a security investigation) and exposes prod to upstream base-image regressions with zero code change on this project's side as the trigger.
- **Proposed fix:** Pin to a specific patch version at minimum (`node:22.<minor>.<patch>-alpine3.<x>`), ideally to a digest (`@sha256:...`) with a documented, deliberate bump process (e.g., Dependabot/Renovate for the Dockerfile).
- **Effort:** S
- **Confidence:** high.

---

### INFRA-15 — No log rotation configured for any container; default `json-file` driver grows unbounded on a long-running, disk-shared VPS
- **Severity:** P3
- **Location:** `docker-compose.yml` (no `logging:` block on any service)
- **Evidence:** With no `logging.driver`/`options.max-size`/`max-file` set, Docker uses its default `json-file` driver with **no size cap**, on a host already flagged (INFRA-04, INFRA-05) as disk-constrained and shared with two other projects. Over months of uptime (this is a long-lived VPS, not ephemeral infra — deploys happen via in-place `git reset --hard` on the same box, per `deploy.md`), `web`/`worker`/`postgres` stdout/stderr logs accumulate without bound, competing for the same disk that also holds the Postgres volume and the only backup copies (INFRA-05) — a slow-burn path to "disk full" that would break writes for the DB, backups, *and* the two neighboring projects simultaneously.
- **Proposed fix:** Add `logging: driver: json-file, options: {max-size: "10m", max-file: "5"}` (or similar) to each service in `docker-compose.yml`.
- **Effort:** S
- **Confidence:** high on the missing config; the actual current on-disk log size on the prod box could not be verified (no SSH).

---

## Checked and OK

- **Non-root runtime users** — both `runner` (`nextjs:1001`) and `worker` (`worker:1001`) stages create and switch to a dedicated non-root user before `CMD`. `Dockerfile` (both stages).
- **Postgres not published to the host** — `docker-compose.yml:17-19` uses `expose: ["5432"]`, not `ports:`; matches `deploy.md`'s claim.
- **Web bound to loopback only** — `docker-compose.yml:94-97`: `"127.0.0.1:${PORT:-3000}:3000"`. nginx is the only path in.
- **`.env*` correctly excluded from both git and the Docker build context** — `.dockerignore` has `.env`/`.env.*`/`!.env.example`, ruling out the specific "secrets baked into an image layer" scenario the brief asked about, independent of the broader `.dockerignore` gaps in INFRA-10.
- **Migration race between `web` and `worker` on cold boot is safe** — both call `ensureMigrated()` independently on startup (`instrumentation.ts:29-30`, `lib/server/worker.ts:369`), but `migrate()` (`lib/server/db.ts:102-136`) serializes via `pg_advisory_lock(727000001)`; the second caller blocks, then sees `schema_migrations` already populated and applies nothing. No double-apply path found.
- **Dockerfile `target:` is explicit for both services** (`docker-compose.yml:28` `target: runner`, `:103` `target: worker`) — the Dockerfile comment documents a *past* incident where an omitted target made `web` accidentally run the worker's default last stage; this is fixed and now guarded by an explicit target on both services.
- **All generated files and all user uploads (template PPTX, translation source, resume photo) are stored as Postgres `BYTEA`**, not on local container disk (`lib/server/template-upload.ts:135-136`, `source-upload.ts:177`, `photo.ts:59`, `README.md`'s own "Fayllar Postgres BYTEA da" note) — confirms `pg_dump` (however infrequently run, see INFRA-05) captures 100% of user-generated content; there is no separate disk-based storage path that a DB-only backup would miss. `env.ts:181`'s `STORAGE_DIR`/`.data/files` config is defined but never read anywhere else in `lib/` — dead configuration, not an active gap.
- **Next.js standalone `server.js` has correct built-in graceful shutdown** — verified by reading the installed runtime (`node_modules/next/dist/server/lib/start-server.js:326-366`): SIGTERM/SIGINT triggers `server.close()` (stop accepting new connections, let in-flight ones finish) before `process.exit(0)`, unless `NEXT_MANUAL_SIG_HANDLE` is set (it isn't). The remaining risk here is not "web ignores SIGTERM" but the *grace-period-too-short* and *no-second-instance-during-recreate* points captured separately as INFRA-08/INFRA-07.
- **Worker's own top-level fatal-error path is correct** — `scripts/worker.ts:12-15` does `process.exit(1)` on any error escaping `runWorkerProcess()` (e.g. a migration failure at boot), which *does* trigger `restart: unless-stopped` correctly — asymmetric with, and a useful contrast to, `web`'s broken behavior in INFRA-01.
- **`tests/compose-env.test.mts` correctly locks four separate previously-incident-causing env-passthrough classes** (LLM roles, OpenAlex/Crossref/Google Books, TTS voice chain, image model) across both `web` and `worker` compose blocks — good regression coverage for exactly the bug class INFRA-09 found a fifth (uncaught) instance of.
- **Credit/refund correctness for abandoned jobs** — `reclaimStaleJobs()` (`lib/server/jobs.ts:481-521`) ensures a job abandoned by a killed worker (INFRA-02) is retried once and then `FAILED` + refunded by the caller (`lib/server/worker.ts:324-334`), so the worst outcome of INFRA-02 is a bad wait-time experience, not silent money loss.
- **Rate limiting exists at the application layer** (documented in `README.md`: 5/min & 60/hour per user for generation, 20/5min for extract) — real, but per-user only, which is why it doesn't prevent the system-wide queue-growth scenario in INFRA-03.
- **`scripts/dev.sh`, `scripts/heavy.sh`, `scripts/migrate.ts`, `scripts/run-build.mts`, `scripts/guard-build.mjs`** — all reviewed; none are dangerous if accidentally run against prod (`migrate.ts` is idempotent via the same advisory-lock path; `dev.sh`/`heavy.sh` are explicitly local-tooling with no prod-reaching code paths; `guard-build.mjs` only *prevents* a footgun, doesn't create one).
