# W3-B review: C28 provider resilience and the chain side of C15

**Reviewer:** independent (read-only) · **Branch:** `worktree-agent-a253dcd8a7a77463b` (`085d6e7..7a7af66`) · **Date:** 2026-09-24

## Verdict: CHANGES REQUESTED

The overall design is sound:
- one per-process breaker and one limiter per provider, shared by `llm.ts` and `llm/chain.ts`;
- a FIFO semaphore with direct hand-off, with the wait deducted from the timeout;
- `DeadlineError` behaves as the contract says;
- capped `Retry-After` / `RetryInfo`;
- Anthropic `maxRetries: 0` (the adapter is the only SDK use in `lib/`, `app/` and `scripts/`, and it goes through the chain).

However, the chain breaker counts user-caused, non-transport failures, and this can take Gemini offline for everyone. There is also one retry regression in the legacy path.

## Tests run (worktree root, heavy2.sh 3G/900 s, no provider calls)
- **New suites:** llm-resilience, llm-chain-deadline, llm-retry-hygiene, tts-chain-deadline, telegram-429 and provider-quota-breaker → **46/46 pass**.
- **Existing suites, first run:** llm-chain, llm-anthropic, image-providers-free and slide-research → **79/79 pass**.
- **Existing suites, second run:** llm-roles, llm-stream, free-llm, research-pipeline, research-openalex, tts-chain, slide-images and telegram-bot-login → **83 pass, 0 fail**. That is 84 tests, one of them skipped or todo.
- **Scratch probe:** `scratchpad/w3b-probe.mts` confirms required change 1 below.

## Required changes

1. **The chain breaker trips on non-transport failures** (`lib/generation/llm/chain.ts:171`). The line is:
   ```ts
   if (res.status === undefined || res.status >= 500) breaker.failure();
   ```
   `status === undefined` also covers adapter results that are not transport errors, all with `retryable:false`:
   - Gemini/OpenRouter/OpenAI/xAI `"bo'sh javob"`, which covers a safety block, no candidates, or thinking that used up `max_tokens`;
   - Anthropic `"refusal"`;
   - Anthropic empty / `max_tokens`.

   **Probe:** a gemini adapter returning `{ok:false,error:"bo'sh javob",retryable:false}` five times puts `breakerFor("gemini")` into `open` (`[breaker] gemini → ochildi (5 ketma-ket xato)`). The sixth call never reaches the provider.

   **Impact:** for 30 s, every job in the process that uses Gemini as its only spec (the `defaultSpec()` case) gets `null`, then FAILED and a refund. One job whose paragraph pool keeps getting safety-blocked, or keeps using up its thinking budget, can cause this.

   **Fix:** match the legacy path (`llm.ts` `withRetry` already does this correctly):
   ```ts
   res.status === undefined ? res.retryable : res.status >= 500
   ```
   Add a chain test showing that N× refusal, empty or 4xx results leave the breaker `closed`, and a mutation test for it.

2. **Legacy `llm.ts`: network timeouts are no longer retried.** The catch blocks of `completeGemini`, `streamGemini` and `completeXai` changed from `/abort/i` to `/abort|timed?\s?out/i`.
   - The new regex matches `fetch failed (ETIMEDOUT)` and `fetch failed (UND_ERR_CONNECT_TIMEOUT)`, both checked.
   - These are the Wi-Fi/connect drops recorded in the AUDIT-19 smoke (`tests/work-engine.test.mts:566`). They are now `timedOut` → `retryable:false` → no retry. Before this branch they were retried.
   - Our own timer's abort already matches `/abort/`.

   **Fix:** set `timedOut` from `controller.signal.aborted` (or keep `/abort/i`), so that connect-level timeouts stay retryable network errors. Add a test for it.

   The chain's pre-existing `isTimeoutSignal` has the same false positive. It contradicts the chain's own comment, which says ETIMEDOUT gets a 2 s retry. Fixing it there too is strongly recommended now that a "timeout" also feeds the breaker and triggers fallback.

3. **TTS deadline is not wired.** `synthesizeAll` accepts `deadline`, but its only caller, `lib/generation/audio/engine.ts:308`, does not pass one. As a result, EXT-10's per-part clock check and the no-restart rule never run in production.
   - **Fix:** pass `deadline` there.
   - A `DeadlineError` then propagates like any other TTS failure (job FAILED + refund). This is the correct classification; add one engine-level test for it.

## Checked and OK
- **Breaker**
  - 4xx (except 429) → `success()`; 429 → neutral.
  - Timeouts count only when the granted attempt timeout is ≥ 15 s.
  - Half-open allows exactly one probe (`probeAt`). Concurrent callers skip to the next spec, or get `null` straight away if no other spec is left.
  - A probe that never reports back is renewed after `cooldownMs`, so the breaker cannot stay open forever.
  - All providers open → fast `null`, with no sleep, no spin and no `DeadlineError`. Callers already treat `null` as "no answer", which leads to FAILED + refund.
- **Limiter**
  - The slot is released in `finally` on every path. A timed-out waiter is spliced out and cannot take a slot.
  - The queue is FIFO and only as long as the number of in-process callers, so it cannot starve or deadlock.
  - Queue wait is deducted from the attempt timeout. If a slot is free, the timeout is exactly as configured (7a7af66).
  - The limits (Gemini 10, gemini-image 6, Anthropic 4) against 4 slots × `mapPool(3)` ≈ 12 means a short queue, not a cliff.
- **Deadline**
  - Without `deadline`, `leftMs = ∞`: no `DeadlineError`, and a timeout still stops the chain (the old rule).
  - The only callers that pass one are the research pipeline stages. They wrap the call in `withinStage`, which turns `DeadlineError` into the deterministic fallback, and rethrow everything else. There is no swallowed partial document.
  - `DeadlineError` is re-exported from `llm-roles`.
- **Retry**
  - Full jitter stays in `[0, base·2ⁿ)`.
  - `parseRetryAfter` handles seconds and HTTP-dates, and clamps negatives.
  - Gemini `RetryInfo` is parsed.
  - `Retry-After` over 30 s → next spec. In the legacy path it is bounded by the budget.
  - No sleep after the last attempt.
- **Image double cost**
  - `limitedProvider` never retries, and pro-slide Gemini images are not retried by this branch.
  - The stock breaker trips only on `rate`.

## Nits
1. Full jitter halves the average wait on network errors (2 s base → average 1 s, then 2 s). This could bring back the AUDIT-19 "three attempts in about 2 s" failure. Consider equal jitter (`cap/2 + rnd·cap/2`) for `status === undefined`.
2. `research/http.ts`: with no `Retry-After`, a second 429 blocks the whole host for **60 s** process-wide. This is harsh for per-second limits (OpenAlex 10 rps under burst) and may produce articles with no references. Consider about 10 s when no `Retry-After` is given.
3. `telegram.ts`: when `retry_after > 5`, the code still sleeps 5 s and retries, and that retry will almost certainly get another 429. Retry only when `retry_after ≤ 5`.
4. After a 429 with `retryable:false` (Anthropic spend limit) or `Retry-After > 30 s`, the provider is still attempted on every call. `breaker.trip(retryAfter)` there would skip it at once.
5. In half-open, a probe that took `allow()` and then received a 429 or hit the limiter-queue timeout keeps the probe slot for a full `cooldownMs`. This is harmless but slows recovery. `research/http.ts` has the same pattern: its own retry after the probe returns the synthetic 429.
6. **Tracking (orchestrator):** EXT-03 is only fixed for callers that pass `deadline`, which today means research only. Writers, judges and polish/rewrite still run `specs × 3 × timeoutMs` with no deadline. Wiring the job deadline into `complete()` belongs with the C15 caller work (W3-A/phase 2). Mark EXT-03 as partial until that is done.

## Re-review: `b3d327b` (2026-09-24)

### Verdict: APPROVE

- **R1 — fixed.**
  - `chain.ts` now counts a failure without a status only when it is `retryable`, and counts 5xx; this is the same rule as `withRetry`. Empty answers, refusals and 4xx are neutral.
  - Re-ran `scratchpad/w3b-probe.mts` with 6 empty Gemini answers: all 6 reached the adapter and the breaker stayed **closed**. Before the fix it opened after 5.
  - Regression test: `llm-chain-deadline` "bo'sh javob / refusal / 4xx … yopiq".
- **R2 — fixed.**
  - `llm.ts` is back to `/abort/i`.
  - The chain's `isTimeoutSignal` is now `/abort|\btimed?\s?out\b/i`. I checked it against these messages:

    | Error message | Counts as timeout? |
    |---|---|
    | `fetch failed (ETIMEDOUT)` | no |
    | `fetch failed (UND_ERR_CONNECT_TIMEOUT)` | no |
    | `Request timed out.` | yes |
    | `This operation was aborted` | yes |

  - Regression test added (llm-retry-hygiene).
- **R3 — fixed.**
  - `audio/engine.ts` passes `deadline` to `synthesizeAll`. `DeadlineError` propagates as a job error, which means FAILED + refund.
  - Test added in `audio-engine.test.mts`.
- **Nits**
  - **Nit 1 — done:** `equalJitterMs` gives network errors a wait in `[cap/2, cap)`.
  - **Nit 2 — done:** research's default 429 cooldown is 10 s.
  - **Nit 3 — done:** Telegram retries only when `retry_after ≤ 5`.
  - **Nit 4 — done:** a 429 that is a spend limit, or has `Retry-After > 30 s`, opens the breaker for `min(Retry-After or 30 s, 10 min)`. There is a test for it.
  - **Nit 5 (probe slot held after a neutral result):** still open, not blocking.
- **Tests (heavy2.sh 3G/900 s, no provider calls)**
  - New suites plus audio-engine: **67/67 pass**.
  - llm-chain, llm-anthropic, llm-roles, llm-stream, research-pipeline, research-openalex, tts-chain, slide-images, image-providers-free and telegram-bot-login: **125/125 pass**.
- **Remaining non-blocking notes**
  - A tripped Gemini breaker (for example a per-minute `RetryInfo` of 34 s) fails Gemini-only jobs quickly for that window. The outcome is the same as before the change, minus the wasted requests.
  - Engine-wide deadline plumbing for writers, judges and polish is a follow-up. Until then, EXT-03 stays partial.
