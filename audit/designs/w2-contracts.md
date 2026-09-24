# Wave 2 — cross-package contracts (fixed before fan-out)

Env seams (already in `lib/server/env.ts`, compose, `.env.example`; foundation commit):
- `env.queue.{totalSlots,meanServiceSec,maxWaitSec,userMaxInflight,ttlSec}`
- `env.retention.bonusDays`
- `env.pdf.maxConcurrency`
- `env.payme.sandbox`

No package edits `env.ts` in W2 except W2-D1, and W2-D1 only touches compose structure.

## W2-B (server reads + admission) → W2-E (frontend)
- `GET /api/generations` accepts optional `?cursor=<opaque string>&limit=<1..100, default 50>`.
  - The response keeps its **existing top-level shape and key** for the items.
  - It adds `nextCursor: string | null`.
  - It no longer includes `values_json`-derived heavy fields that the list doesn't use (keep every field the current client reads).
- `GET /api/generations/[id]` adds optional `queuePosition: number` (1-based) and `etaSec: number` while the status is `QUEUED`. The poll response no longer carries `values_json`, unless the client needs it (check `lib/api-client.ts` usages).
- `POST /api/generations` rejects before charging with **429**:
  - header `Retry-After: <sec>`
  - body `{ "error": "<Uzbek text>", "code": "queue_full" | "user_inflight", "retryAfterSec": <n> }`

## W2-D2 (worker/housekeeping) ↔ W2-D1 (infra)
- W2-D2 makes the worker loop touch the file `/tmp/slaydx-worker-alive` (mtime) at least every 30 s while the loop is healthy.
- W2-D1's worker `HEALTHCHECK` is `find /tmp/slaydx-worker-alive -mmin -2 | grep -q .`
- W2-D2 owns the new `lib/server/queue-ttl.ts` (`expireQueuedJobs()`: QUEUED older than `env.queue.ttlSec` → FAILED plus a refund in the same transaction, exactly once).
- W2-D2 owns the new `lib/server/retention.ts` (`purgeBonusFiles()`) and migration `022_retention.sql`. Both are called from `housekeeping()` in `lib/server/worker.ts`.
- W2-D1's deep health (`/api/health` with the CRON_SECRET bearer) computes the oldest QUEUED age, the IN_PROGRESS count, and the most recent `locked_at` among IN_PROGRESS rows with its own read-only SQL. It must not touch `jobs.ts`.

## W2-A (LibreOffice) → W2-E
- `GET …/file?format=pdf` returns 429 with `Retry-After` when the per-user PDF limit is hit, and 503 with `Retry-After` when every PDF slot is busy past the wait timeout. The Uzbek message is in `{ error }`.

## Free-LLM endpoints (merged in W1-E) → W2-E
- Read `lib/server/spend.ts` for the exact status codes and body codes: 402 `unpaid`, 429 daily caps, 503 kill switch or global cap, 409 `busy`.
- `lib/api-edit.ts` must show the server's `error` text rather than a generic "Juda tez-tez".
