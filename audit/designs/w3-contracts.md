# Wave 3 — cross-package contracts

- **Deadline (C15 / C28):** the job deadline is the existing epoch-ms `opts.deadline` passed into `buildArtifact` and down to the writers.
  - **W3-B (LLM chain):** every provider attempt uses `timeout = min(configured, deadline - now - safetyMs)`. It never starts a retry or fallback once `deadline - now` drops below a minimum (e.g. 5 s), and throws `DeadlineError` (exported from `lib/generation/llm/chain.ts`). A caller without a deadline keeps today's behaviour.
  - **W3-A (worker, phase 2):** the worker enforces a hard stop. When `deadline + grace` passes, the job is FAILED and refunded exactly once (existing helpers), the slot is released, and the late result is discarded by the existing `locked_by` fencing.
- **Logging (W3-D, phase 2):** a new `lib/server/log.ts` exports `log(level, msg, fields)`, emitting one JSON line with `ts, level, msg, reqId?, jobId?, userId?, genId?, err?{message, stack}`. Packages in phase 1 must NOT add it; phase 2 applies it on money/queue paths.
- **Shared files in W3 phase 1:**
  - `Dockerfile`, `docker-compose.yml`, `package.json`, `.github/**` → W3-F only.
  - `lib/server/db.ts` → W3-E only.
  - `lib/tools.ts` → W3-J only.
  - `lib/server/env.ts` → nobody (the orchestrator does W2 wrap-up).
