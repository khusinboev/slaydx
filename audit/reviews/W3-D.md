# Review — W3-D (C31 observability + wrap-up)

Branch `worktree-agent-af20eb28f64b247f8` (`225f532..4e1a881`, merged w/ audit/production-readiness @ 15cf902). Reviewer: read-only.

## Verdict: **CHANGES REQUESTED** (two small redaction fixes; everything else is approvable)

## Tests run
- Named suite (log, request-log, worker-user-error, payments-credit-swap, worker-payment-events-purge, env-db-timeouts, metrics-report, payments-orders, payments): **58/58 pass**.
- Regression sweep (admission, credits, credits-atomic, queue, jobs-live-edit, jsonb-writes, game-routes, refund-reconcile, pdf-limits-db, slide-doc-route, worker-lease): 137/139. The two failures are in `admission.test.mts` "Seq Scan yo'q" (planner-dependent). **They fail the same way on base `audit/production-readiness`**, so they are not caused by W3-D.

## 1. Money — OK
- **`topUpInTx` swap is equivalent** to the old `creditInTx`:
  - same `kind`/`reference`/`note` ("Pro obuna", "subscription"), with `points_delta = 0`;
  - same `≤ 0` early return;
  - same SELECT-then-INSERT idempotency with `transactions_ref_idx` as a backstop;
  - same Pro stacking SQL (`GREATEST(COALESCE(plan_expires_at, now()), now()) + days`), now reached through `activateProInTx`;
  - wallet CHECKs are untouched.
  - The swap test covers the ledger invariant, concurrent settle, and a pre-existing credit.
- **Lock order: no deadlock risk.**
  - `topUpInTx` takes one row lock (`users`). The `transactions` probe is a plain SELECT, so moving `FOR UPDATE` earlier adds no new lock edge.
  - Callers:
    - `topUp` and `activatePro` open a fresh tx with no prior locks.
    - `settleOrder` locks `payment_orders` → `users`, the same as the old `creditInTx`.
  - Other `users` lockers never touch `payment_orders`, so no cycle can form:
    - `chargeInTx`
    - `admitInTx` / `enqueueGeneration` (`NO KEY UPDATE`)
    - `refund-tx`
    - `refund-reconcile` (`generations` → `users`)
    - `adminAdjustWallet`
  - Concurrent duplicate `(kind, reference)` inserts now serialize on the user lock instead of hitting the unique index. That is strictly better.
- Money log lines are written after COMMIT (`settleOrder`, `refundRatio`, `topUp`). The outer `credited`/`amount` variables are reset per attempt. Good.

## 2. Redaction — two leaks
Verified with a probe script against `redact()`/`log()`.

What works:
- Bearer/Basic values (Payme `Authorization: Basic …`).
- `x-goog-api-key` as a key and as an `AIza…` value.
- `?key=`, `sign_string=`.
- Header objects (`Authorization`, `cookie`).
- `+998` phones.
- Newlines and U+2028 are JSON-escaped, so a single line cannot be broken or forged.
- Phone masking does not mangle UUIDs (the `-` lookbehind stops it), 13-digit ms timestamps, or normal amounts. It would only mask a bare 12-digit `998…` number, which is not a realistic id or amount here.

What leaks: see Required changes 1 and 2.

## 3. User-safe errors — OK
- I swept every `new *Error("…")` literal in `lib/generation` and `worker/jobs/queue-ttl` through `isUserSafeText`. These survive:
  - all quality-gate and engine Uzbek messages;
  - `QUEUE_TTL_MESSAGE`, "Ish vaqti tugadi", "Noma'lum vosita";
  - "Navbat to'la …", "Fayl bo'sh chiqdi …";
  - the `createOrder` range message.
- The only rejected Uzbek-looking texts are developer prefixes (`planWork:`, `slide-progress:`, `[llm]`), which is correct, plus one real user message: see Nit 1.
- pg, network, and library errors go to the generic message through `hasLibraryShape`.
- The orders route re-throws non-safe errors as 500 with `requestId`, so raw pg text no longer reaches the user.

## 4. Log volume — OK
- Steady state is about 3–5 lines per job (enqueue, claim, ready, refund/credits) at roughly 300–500 B each. Polls (`GET /generations/[id]`) do not log. Heartbeat and progress failures are throttled to 1 per job per minute.
- At several thousand jobs a day that is a few MB per day, so 20m×5 keeps weeks of history.
- Worst case is a DB outage: a `tick` error with stack every 5 s, plus about 10 housekeeping step errors per minute, adds up to roughly 30–50 MB/day. Rotation then keeps about 2 days. Acceptable.

## 5. `x-request-id` — OK
- The CSV `new Response(stream)` has mutable headers, and setting one does not touch the body.
- Immutable responses (redirect/fetch) are copied without being consumed.
- Byte routes only gain one extra header; ETag/304 behaviour is unaffected.
- The incoming id is validated against `^[A-Za-z0-9._:-]{8,128}$`.

## 6. `metrics-report` — OK
- It runs `SET TRANSACTION READ ONLY` as the first statement in `transaction()`. It does not call `ensureMigrated`, so it cannot trigger migrations.
- About 9 aggregate queries. The refund `EXISTS` uses `(kind, reference)`. See Nit 4 on indexes.

## Required changes
1. **The Telegram bot token inside API URLs is not redacted.** The rule `/\b\d{6,12}:[A-Za-z0-9_-]{30,}/` needs a word boundary, but `bot7123…` has none between `t` and `7`. As a result:
   - `https://api.telegram.org/bot7123456789:AAH…/sendMessage` passes through untouched, both in `redact()` and in a `url` field of `log()`.
   - `lib/server/telegram.ts` builds exactly this URL, and URL-parse or fetch errors can echo it.
   - Fix: use `(?<![0-9])` instead of `\b`, or add an explicit `/bot\d+:[\w-]{30,}/` rule. Add a test with the `/bot<TOKEN>/` shape.
2. **Credentials in a DB URL are not redacted.** `postgres://slaydx:S3cr3tPass@db:5432/slaydx` and a `databaseUrl` field both pass through verbatim. Add a userinfo rule such as `/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi → "$1[REDACTED]@"`, plus a test.

## Nits (non-blocking)
1. `image-studio.ts` "Rasm uchun tavsif yozing" is a real user validation message, but it becomes the generic message because no UZBEK word matches. Either throw a `UserFacingError` there or add `yozing`/`tavsif` to the word list.
2. **Text-form secrets are not covered:**
   - `Cookie: slaydx_session=…`
   - `password: x` (colon form)
   - JSON-in-string `"token":"…"`
   
   Also consider adding `session`/`sessionId` to `SECRET_FIELD` and `session` to the `=` param rule.
3. `startInlineWorker()` can be first called from inside `POST /api/generations`. This happens in dev, or when `register()` returned early on a migration failure in non-prod. In that case the worker loop inherits that request's ALS context, so every later job line carries a stale `reqId`/`userId`. Start the loop under a fresh context: `store.exit(...)` or `store.run({}, ...)`.
4. The `metrics-report` window filters (`created_at`/`updated_at`) have no leading index on `generations`, `transactions` or `payment_orders`, so they seq-scan. That is fine at current size and bounded by the 30 s statement timeout. Consider `SET LOCAL statement_timeout` explicitly and add a note for later.
5. The `csvStream` `onError` log likely runs outside the request ALS context (it is pulled after `handler` returns), so the line may lack `reqId`. Capture `currentLogContext()` when the stream is created.
6. `isUserSafeText` passes mixed strings like `"Rasm yaratilmadi: Resource has been exhausted (quota)"`. This leaks no secrets, but English text can reach the user if an engine interpolates a provider message. No such interpolation was found today.

---

## Re-review — commit `f2df490`

### Verdict: **APPROVE**

### Required changes
- **R1: fixed.** The Telegram token rule now uses `(?<![0-9])`. Probes: `…/bot<TOKEN>/sendMessage`, `…/file/bot<TOKEN>/…`, `Failed to parse URL from …bot<TOKEN>…`, and `bot|x|_<TOKEN>` all come out as `[REDACTED]`. The userinfo rule runs first but does not match `api.telegram.org/…`, so the two rules do not interfere.
- **R2: fixed.** `postgres://u:[REDACTED]@…` is redacted, including `postgresql://…%40…%2F…@` (percent-encoded password) and `DATABASE_URL=…`. These are left untouched, as they should be: `http://host:8080/path`, and `https://example.com/a:b@c` (the `/` stops the match).

### Nits
- **Text-form secrets:** `Cookie:` and `Set-Cookie:` redact the whole value. `password:`, `secret:`, `token:`, `session=`, `sessionId=` and JSON `"token"/"password"/"key":"…"` are all redacted. `SECRET_FIELD` now also covers `session`/`sessionid`.
- **No false positives:** UUIDs, 13-digit timestamps, Payme ids, amounts, `step: Slayd 3/10` and `Idempotency-Key:` all come through unchanged.
- **image-studio message:** `yozing`/`tavsif*` were added to the UZBEK list, so "Rasm uchun tavsif yozing" is now kept.
- **Worker context:** `withFreshLogContext` is used for `runJob` and for the inline `loop()`, so worker lines no longer inherit a request's `reqId`.
- **metrics-report:** `SET LOCAL statement_timeout = '60s'` now runs after `READ ONLY`. It is transaction-scoped, so it does not leak into the pool.

### Tests (heavy2.sh)
- **W3-D suite: 62/62 pass.** Four new tests since the first review.
- **Regression batch** (credits, credits-atomic, queue, jobs-live-edit, jsonb-writes, game-routes, refund-reconcile, pdf-limits-db, slide-doc-route, worker-lease): 128/130.
  - The 2 failures are `queue.test.mts` "navbat SQL i / completeJob format yorlig'i".
  - Run alone on this branch, `queue.test.mts` passes 13/13, twice. It also passed in the first-review batch.
  - The likely cause is several test files sharing one DB in a single run: another file's QUEUED jobs get claimed. W3-D's `jobs.ts` changes only add logging, so this is not caused by W3-D. Worth checking under the CI runner.
- The admission EXPLAIN failures are acknowledged as fixed on base (`c38a1fd`), so I did not re-run them here.

### Residual (non-blocking, low likelihood)
- Leaks not caught by the current rules:
  - a token that is percent-encoded (`%3A`);
  - `redis://:pass@` (empty user; no redis in this stack);
  - a raw `/` inside a URL password (that is an invalid URL anyway);
  - double-escaped JSON (`\"token\":\"…\"`).
- The `csvStream` `onError` line may still lack `reqId` (nit 5 from the first review; not addressed).
