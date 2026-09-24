# Design — generation capacity and backpressure (C22 + C16)

**Owner decision (2026-09-23):** on the current server, run 2 worker containers × `WORKER_CONCURRENCY=4` (8 slots). When the queue is full, return 429 with an ETA. Allow at most 2 concurrent jobs per user.

## Problem (verified, `audit/triage/verify-scale.md` SCALE-02)
- **Supply:** 2 slots. Jobs take about 150–240 s in a realistic mix, so **30–48 jobs/h**.
- **Target demand:** about 1 200–2 400 jobs/h.
- **No admission control:** every job is charged at enqueue and can then wait hours with no ETA. A QUEUED row never expires.
- **No fairness:** the claim is a global first-in-first-out, so one user can hold every slot.

## Decision → design
1. **Slots: 8** (2 workers × 4), which gives about 120–190 jobs/h, a 4× improvement.
   - Scaling is code-safe. The claim uses `SKIP LOCKED`, every write is fenced by `locked_by`, `WORKER_ID` is per process, migrations take an advisory lock, and the stale-job refund is exactly-once (reviewer R3).
   - Compose: `worker` gets `deploy.replicas` / `scale: 2`. Every service gets `mem_limit` and `cpus`, configurable through env (`WORKER_MEM_LIMIT`, default `2g`).
   - `DATABASE_POOL_MAX` is forwarded to all services: web 10 + 2 workers × 8 = 26, well under Postgres's `max_connections=100`.
2. **Admission control, before charging** (`POST /api/generations`):
   - `wait ≈ queued × meanServiceSec ÷ totalSlots` with `meanServiceSec` = 200 (env `QUEUE_MEAN_SERVICE_SEC`) and `totalSlots` = `QUEUE_TOTAL_SLOTS` (default 8).
   - If `wait > QUEUE_MAX_WAIT_SEC` (default 900 s), return **429**. The response carries `Retry-After` and the Uzbek message "Navbat to'la — taxminan N daqiqadan keyin qayta urinib ko'ring". **No charge, no row.**
   - The decision is a pure function `admissionDecision({queued, slots, meanServiceSec, limitSec})` so it can be unit-tested.
3. **Per-user in-flight cap:** a user with ≥ `USER_MAX_INFLIGHT` (default 2) jobs in QUEUED or IN_PROGRESS gets 429. The claim is also fair: it skips users who already hold ≥2 running jobs, so one user's QUEUED rows can't block everyone else's.
4. **QUEUED time-to-live:** a QUEUED job older than `QUEUE_TTL_SEC` (default 2 700 s = 45 min) becomes FAILED ("Navbat juda uzun edi — pul qaytarildi"). The refund runs **in the same transaction**, and it is refunded exactly once even when two housekeepers run concurrently.
5. **ETA for users:** `GET /api/generations/[id]` returns `queuePosition` and `etaSec` while QUEUED. The UI shows them in place of a silent progress bar (UX-07; the client side belongs to the frontend package).

## Not solved here (remaining risk → REPORT)
- 8 slots is still about 10× short of 2 000 jobs/h. Beyond this needs a separate or bigger worker host and higher provider quotas (Gemini RPM/TPM).
- Beyond about 8 processes, PgBouncer is needed.
- Per-job peak memory is unmeasured, so the Phase 5 load test measures RSS per tool before the 2g limit is trusted.

## Tests
- `tests/admission.test.mts` (Postgres):
  - A full queue gives 429 with `Retry-After`, the balance is unchanged, and no row is created.
  - A third in-flight job gives 429.
  - The fair claim skips a user who holds 2 running jobs.
- `tests/jobs-queued-ttl.test.mts`: an expired QUEUED job becomes FAILED and is refunded once, even with two concurrent housekeeping runs.
