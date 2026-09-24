# test-coverage — findings

Scope actually covered: `tests/*.test.mts` (top-level, 215 files), `tests/viewer/`, `tests/ui/`, `tests/helpers/` (directory + grep survey of all); close reads of `tests/credits.test.mts`, `tests/payments.test.mts`, `tests/auth.test.mts`, `tests/telegram-bot-login.test.mts`, `tests/telegram-link.test.mts`, `tests/security.test.mts`, `tests/csp-headers.test.mts`, `tests/queue.test.mts`, `tests/jobs-cost.test.mts`, `tests/worker-housekeeping.test.mts`, `tests/delivered.test.mts`, `tests/source-upload.test.mts`, `tests/template-upload.test.mts`, `tests/photo.test.mts`, `tests/game-public.test.mts`, `tests/game-sessions.test.mts`, `tests/game-routes.test.mts`, `tests/compose-env.test.mts`, `tests/env-warnings.test.mts`, `tests/migrations.test.mts`, `tests/admin.test.mts`, `tests/accounts.test.mts`, `tests/form-draft.test.mts`, `tests/resume-draft.test.mts`, `tests/extract.test.mts`; paired reads of the corresponding `lib/server/*.ts` source (`credits.ts`, `payments.ts`, `auth.ts`, `session.ts`, `telegram.ts`, `ratelimit.ts`, `api.ts`, `jobs.ts`, `worker.ts`, `game-sessions.ts`, `db.ts`, `env.ts`, `migrations/`) to judge whether asserted behaviour matches real logic; grep sweep across all `tests/**` for `DATABASE_URL`, `pool(`, `query(`, `requireAdmin`, `\[id\]`, `assetId` to find DB-dependent vs pure-logic tests and IDOR coverage. Not covered in depth: `tests/ui/` and `tests/viewer/` internals beyond a directory/grep-level pass (document-quality/editor scope, owned by other audits per brief §1); the ~150 content-engine test files (article/essay/work/teacher/game/figures/etc.) were only inventoried by name, not read, since they are document-quality not production-critical per brief.

Summary: P0 0 · P1 7 · P2 5 · P3 0

No P0: this is a test-coverage audit, not a bug hunt — every finding below is an *absence* of a
regression test in a money/auth/queue/security-critical function, not a demonstrated live exploit.
Severity reflects blast radius if the underlying (today-correct-looking) code regresses without a
test catching it, per the brief's calibration rule ("theoretical issues with no reachable path are
P3... do not inflate"). Several P1s (TEST-03, TEST-04, TEST-07) describe mechanisms that already run
unverified in production today (queue claim concurrency, credit-charge concurrency, periodic purge
jobs), not just hypothetical future regressions.

### TEST-01 — Payment order state machine and JSON-RPC/webhook dispatch: zero test coverage beyond signature crypto
- **Severity:** P1
- **Location:** `lib/server/payments.ts:181` (`createOrder`), `:208` (`findOrderByTxn`), `:231` (`attachTransaction`), `:262` (`findOrderByPrepareId`), `:276` (`settleOrder`), `:313` (`cancelOrder`); `app/api/payments/click/route.ts:76-149` (full POST handler, Prepare/Complete state transitions); `app/api/payments/payme/route.ts:71-229` (full POST handler, 6 JSON-RPC methods)
- **Evidence:** `tests/payments.test.mts` (238 lines) imports only `clickSignatureValid`, `paymeAuthorized`, and `PRO_PLAN` — confirmed by `grep -rln "createOrder\|attachTransaction\|settleOrder\|cancelOrder\|findOrderByPrepareId\|findOrderByTxn" tests/*.test.mts` (no output) and `grep -rl "payments/click\|payments/payme" tests/` (no output). The parts of the code that decide whether money actually gets credited have no regression protection at all: idempotency across `CreateTransaction`→`PerformTransaction` (`payme/route.ts:103-147`), the `merchant_prepare_id` match check on Click Complete (`click/route.ts:121-126`), rejecting `CancelTransaction` on an already-paid order (`payme/route.ts:156`), the soum→tiyin conversion (`tiyin()`, `payme/route.ts:60-62`), and `settleOrder`'s `reference` construction that makes `topUp`/`activatePro` idempotent (`payments.ts:295`). Only the two pure crypto predicates gating the first line of defense are tested.
- **Reproduction:** `grep -rln "createOrder\|attachTransaction\|settleOrder\|cancelOrder" tests/*.test.mts` → no output; `grep -rl "payments/click\|payments/payme" tests/` → no output. A future refactor of `settleOrder`'s reference string, the Click `merchant_prepare_id` check, or the Payme `CreateTransaction` idempotency branch would ship without a single test failing.
- **Proposed fix:** add `tests/payments-orders.test.mts` (real Postgres, `DATABASE_URL`-gated like `credits.test.mts`): create→attach→settle credits exactly once; double `settleOrder` credits only once; `cancelOrder` after `paid` is a no-op; `findOrderByPrepareId`/`findOrderByTxn` return null for foreign/garbage input. Add a mocked-pool test (pattern from `jobs-cost.test.mts`) driving `POST click/route.ts` and `POST payme/route.ts` through amount-mismatch/unknown-order/already-paid/cancelled/prepare_id-mismatch and asserting the exact provider-protocol error/state codes.
- **Effort:** M
- **Confidence:** high

### TEST-02 — `lib/server/ratelimit.ts` has zero test coverage
- **Severity:** P1
- **Location:** `lib/server/ratelimit.ts:21` (`rateLimit`), `:60` (`purgeRateLimits`), `:78` (`clientIp`)
- **Evidence:** `grep -rln "rateLimit\|clientIp\|ratelimit" tests/*.test.mts` returns nothing. This is the sole throttle between an ordinary user (or the audit's assumed 10× traffic burst) and unlimited Gemini/xAI/fal spend, and the sole defense against OTP/login brute-forcing (`/api/auth/otp` relies on `limit(otp:req:*, 3, 600)`). Nothing proves the fixed-window `INSERT … ON CONFLICT DO UPDATE SET hits = hits + 1` (lines 31-34) actually caps at `limit`, that `retryAfterSec` is sane at a window boundary, or that `clientIp` (lines 78-95) takes only the **last** `x-forwarded-for` hop when `TRUST_PROXY=true` and returns `"direct"` otherwise — a regression trusting the first (client-controlled) XFF hop would let one caller spoof unlimited distinct rate-limit buckets.
- **Reproduction:** `grep -rn "ratelimit" tests/` → no matches; no test calls `rateLimit` past its `limit` and asserts `.ok` flips to `false`.
- **Proposed fix:** add `tests/ratelimit.test.mts` (real Postgres): sequential calls up to `limit` all `ok:true`, the next `ok:false` with `retryAfterSec>0`; `clientIp` with `TRUST_PROXY` unset returns `"direct"` regardless of headers, with it set the last XFF hop wins over a spoofed first hop; `purgeRateLimits` deletes rows older than the interval and keeps newer ones.
- **Effort:** S
- **Confidence:** high

### TEST-03 — Queue `claimJob` concurrency (`FOR UPDATE SKIP LOCKED`) never exercised concurrently
- **Severity:** P1
- **Location:** `lib/server/jobs.ts:341-380` (`claimJob`), SQL at `:365` (`FOR UPDATE SKIP LOCKED`)
- **Evidence:** `tests/queue.test.mts` calls `claimJob` several times but always **sequentially** (lines 70, 86, 244) — never via `Promise.all`. `grep -rl "Promise.all" tests/*.test.mts` matches only `generation.test.mts` (an unrelated `mapPool` utility test) and `work-docx.test.mts`. This is the exact mechanism the deployment depends on: one worker process with `WORKER_CONCURRENCY=2` (per audit target-load description) means two claim loops race against the same `generations` table on every batch, in production, today — and no test proves two concurrent `claimJob("w1")`/`claimJob("w2")` calls against the same queued rows return two *different* job ids instead of the same one twice.
- **Reproduction:** Sketch (real Postgres): enqueue 2 jobs for a funded user; `await Promise.all([claimJob("w1"), claimJob("w2")])`; assert both results are non-null with different `id`s, and a third `claimJob("w3")` returns `null`. This scenario is absent from `tests/queue.test.mts`.
- **Proposed fix:** add this concurrent-claim case to `tests/queue.test.mts`'s `"navbat SQL i"` block (real-DB fixtures already present).
- **Effort:** S
- **Confidence:** high

### TEST-04 — Credits `chargeInTx` row-lock never exercised concurrently
- **Severity:** P1
- **Location:** `lib/server/credits.ts:38-40` (`walletOf`, `SELECT … FOR UPDATE`), `:65-121` (`chargeInTx`)
- **Evidence:** `tests/credits.test.mts` tests idempotency (same `reference` twice, sequentially) and insufficient-funds, but never fires two *different*-reference charges at the same user concurrently to prove the `FOR UPDATE` row lock serializes them and the total charged never exceeds the wallet. `grep -rl "Promise.all" tests/credits.test.mts` → no match. A regression dropping `FOR UPDATE` (e.g. "simplifying" `walletOf` to a plain `SELECT`) would let two simultaneous requests (double-click submit, client retry-on-timeout) both read the same pre-charge balance and both succeed, overdrawing the account — undetected by the suite.
- **Reproduction:** Sketch (real Postgres): fund a user with exactly 1000; `Promise.all([charge(uid,700,"a"), charge(uid,700,"b")])`; assert exactly one `ok:true` and one `ok:false reason:"insufficient"`, and `walletTotal(await wallet(uid))` never negative.
- **Proposed fix:** add this case to `tests/credits.test.mts`.
- **Effort:** S
- **Confidence:** high

### TEST-05 — `assertRuntimeConfig`'s auth/boot-safety branches are untested (only the TTS carve-out is)
- **Severity:** P1
- **Location:** `lib/server/env.ts:235-259`
- **Evidence:** `tests/env-warnings.test.mts` (44 lines) exercises exactly one branch — TTS-key-missing-is-a-warning-not-an-error (`env.ts:274-276`) — plus a static source-text check that `instrumentation.ts` throws only on `problems`. It does **not** exercise: `DATABASE_URL` missing (`:237`), `APP_URL` missing in prod (`:238`), **`DEV_LOGIN_ENABLED` true in prod** (`:239-241` — the comment literally says `"bu har kimga kirish beradi"`, i.e. this flag gives everyone access), `TELEGRAM_BOT_TOKEN` missing in prod (`:242-244`), `SESSION_COOKIE_SAMESITE=none` without HTTPS (`:249-251`), or `CRON_SECRET` missing while a bot token is set (`:252-254` — the exact condition that leaves the Telegram webhook unauthenticated). Six of seven `problems.push(...)` branches have no test proving they fire.
- **Reproduction:** `grep -n "assertRuntimeConfig" tests/env-warnings.test.mts` → only the TTS case calls it; no test sets `NODE_ENV=production` + `DEV_LOGIN_ENABLED=true` and asserts `problems` is non-empty.
- **Proposed fix:** extend `tests/env-warnings.test.mts` with one case per branch, following the subprocess-per-case import pattern already in `tests/security.test.mts:98-124` (env is read at module-import time, so each combination needs a fresh process).
- **Effort:** S
- **Confidence:** high

### TEST-06 — Session lifecycle and OTP brute-force guard have zero direct test coverage
- **Severity:** P1
- **Location:** `lib/server/session.ts:166` (`createSession`), `:214` (`currentUser`, `is_blocked` gate at `:228`), `:243` (`revokeCurrentSession`), `:250` (`revokeAllSessions`); `lib/server/auth.ts:159` (`issueLoginCode`), `:180` (`consumeLoginCode`, 5-attempt lockout at `:197-200`)
- **Evidence:** `grep -rln "createSession\|revokeCurrentSession\|revokeAllSessions\|currentUser()" tests/*.test.mts` and `grep -rln "consumeLoginCode\|issueLoginCode\|OTP_MAX_ATTEMPTS" tests/*.test.mts` both return nothing. By contrast, Telegram HMAC verification (`tests/auth.test.mts`) and the login-ticket flow (`tests/telegram-link.test.mts`, `tests/telegram-bot-login.test.mts`) are excellent — but everything downstream of a successful login (session creation, `is_blocked` rejection, expiry rejection, revoke-then-reuse rejection) and the entire OTP path (issue, 5-wrong-attempts lockout, expiry, reuse-after-consume) is unverified. `requireUser`/`requireAdmin` sit on top of `currentUser` for every authenticated request in the app.
- **Reproduction:** no test file imports any of the six named functions.
- **Proposed fix:** add `tests/session.test.mts` (real Postgres): create→resolve→revoke→null; a row with `is_blocked=true` resolves `null` even if unexpired. Add an OTP case to `tests/auth.test.mts` (already DB-gated elsewhere in the suite via the same pattern): `issueLoginCode` → 5× wrong `consumeLoginCode` → 6th attempt returns `{ok:false, reason:"attempts"}` even with the right code; expired code returns `"expired"`.
- **Effort:** M
- **Confidence:** high

### TEST-07 — Periodic purge functions' SQL is untested against a real database (only that they're *called* is tested)
- **Severity:** P1
- **Location:** `lib/server/photo.ts:179` (`purgeOldPhotos`), `lib/server/source-upload.ts:268` (`purgeOldSources`), `lib/server/telegram.ts:208` (`purgeExpiredTickets`), `lib/server/game-sessions.ts:271` (`purgeExpiredGameSessions`); called from `lib/server/worker.ts:324-364` (`housekeeping`)
- **Evidence:** `tests/worker-housekeeping.test.mts` mocks the pool entirely (`t.mock.method(p, "query", ...)`, comment at lines 14-17 says so explicitly) and only asserts the right `DELETE FROM …` SQL *text* was issued — it never touches a real database. No test inserts one fresh row and one expired row into `photo_uploads`/`source_uploads`/`login_tickets`/`game_sessions` against real Postgres and asserts the purge deletes exactly the expired one. These run unattended on every `housekeeping()` tick in production and delete real user data (resume photos, translation source files, game links); a reversed comparison or wrong interval unit in any of the four `WHERE created_at < now() - ($1 || ' days')::interval` clauses would silently mass-delete fresh data, and the existing housekeeping test would still pass (it only checks query *text*, not effect).
- **Reproduction:** `grep -rln "purgeOldSources\|purgeOldPhotos\|purgeExpiredTickets\|purgeExpiredGameSessions" tests/*.test.mts` → only `tests/worker-housekeeping.test.mts`, pool-mocked.
- **Proposed fix:** add one real-DB case per purge function, near their sibling files (`tests/photo.test.mts`, `tests/source-upload.test.mts`, `tests/telegram-link.test.mts`, `tests/game-sessions.test.mts` — the latter already has this exact pattern for the *auth*-session purge, `purgeExpiredSessions`; the *game*-session purge needs the equivalent): insert one stale + one fresh row, call the purge function, assert only the stale one is gone.
- **Effort:** S
- **Confidence:** high

### TEST-08 — `/api/health` route has zero test coverage (DB-down behaviour, internal/public split)
- **Severity:** P2
- **Location:** `app/api/health/route.ts:21` (`isInternal`), `:28-79` (`GET`)
- **Evidence:** no test file references `api/health` or `isInternal`. Nothing proves: (a) when `queryOne("SELECT 1")` throws, the route returns HTTP 503 with `{status:"degraded"}` to an anonymous caller (lines 43-46) rather than leaking `dbError`; (b) a request without a valid `Authorization: Bearer <CRON_SECRET>` never sees `problems`, `warnings`, `queue`, or `features` (the whole point of the `isInternal` split — deliberately locked down per the comment at lines 16-19, implying it was open before); (c) `queueDepth()` is skipped when `db` is down (line 55), avoiding a second failing query at exactly the moment a Docker healthcheck/load balancer is polling this endpoint hardest.
- **Reproduction:** `grep -rln "api/health\|isInternal" tests/*.test.mts` → no output.
- **Proposed fix:** add `tests/health-route.test.mts` mocking `lib/server/db.ts`'s `queryOne` (pattern from `worker-housekeeping.test.mts`) to throw; import and call the route's `GET`; assert 503 + minimal body without the header, and `problems`/`features` appear only with a correct `Authorization: Bearer` matching `CRON_SECRET`.
- **Effort:** S
- **Confidence:** high

### TEST-09 — IDOR regression coverage missing for several asset getters (pattern correct today, unguarded against regression)
- **Severity:** P2
- **Location:** `lib/server/photo.ts:87` (`getPhoto`), `lib/server/source-upload.ts:223` (`sourceForJob`), `lib/server/template-upload.ts:145,162` (`getTemplate`, `templateForJob`), `lib/server/thumb.ts:99` (`getOrBuildThumb`), `app/api/forms/[toolId]/draft/route.ts`
- **Evidence:** each function correctly parametrizes ownership (`WHERE user_id = $1 AND asset_id = $2` or equivalent) today, matching the project's documented convention (`CLAUDE.md`: *"Egalik SQL darajasida tekshiriladi... Route darajasidagi tekshiruv YETARLI EMAS"*, citing a real prior incident — AUDIT-4 N-1 — where exactly this class of function, `deleteGenerationFile`, was the one place the pattern was missed). `grep -c "stranger\|begona\|owner2\|otherUser\|user2"` across `tests/photo.test.mts tests/source-upload.test.mts tests/template-upload.test.mts tests/thumb.test.mts tests/form-draft.test.mts` → all zero, vs. `tests/storage.test.mts` and `tests/assets-article.test.mts`, which **do** carry this exact two-user regression test for the sibling functions `deleteGenerationFile`/`getGenerationFile`/asset-by-id. The project has already proven this bug class recurs here; roughly half the asset getters have the lock-in test and half don't.
- **Reproduction:** none of the five listed test files create a second ("stranger") user and assert their read of the owner's asset is rejected.
- **Proposed fix:** copy the two-user fixture pattern already in `tests/storage.test.mts:34-54` into each of the five files: one more `t.test` per file, create `owner`+`stranger`, assert `stranger`'s call with `owner`'s `assetId`/`generationId` returns `null`/`undefined`.
- **Effort:** M (mechanical, five small additions)
- **Confidence:** high

### TEST-10 — `enqueueGeneration`'s atomicity is only tested on the success path
- **Severity:** P2
- **Location:** `lib/server/jobs.ts:159-193` (`enqueueGeneration`)
- **Evidence:** `grep -rn "enqueueGeneration" tests/*.test.mts` finds exactly two call sites, both in `tests/queue.test.mts` (lines 43, 201), both against a user funded with 100,000 and both asserting `res.ok === true`. No test drives `enqueueGeneration` into its `{ok:false, reason:"insufficient", ...}` branch (`jobs.ts:169-171`) and confirms **no row was written to `generations`** — the atomicity guarantee the function's own docstring claims (line 156-158: "Ikkisini ajratib bo'lmaydi"). `chargeInTx`'s insufficient-funds behavior is well tested in isolation (`credits.test.mts`), but the composition (charge-fails ⇒ no orphan queue row) is not.
- **Reproduction:** `grep -n "res.ok, true" tests/queue.test.mts` — both `enqueueGeneration` assertions require success; none exercises a near-empty wallet.
- **Proposed fix:** add a case to `tests/queue.test.mts`: fund a user with 0, call `enqueueGeneration` with `price:100`, assert `ok:false`, then `SELECT count(*) FROM generations WHERE user_id=$1` is 0.
- **Effort:** S
- **Confidence:** high

### TEST-11 — OOXML zip-bomb budget (`MAX_UNZIPPED_BYTES`) has no test
- **Severity:** P2
- **Location:** `lib/generation/translate/xml-scan.ts:224` (`MAX_UNZIPPED_BYTES`), `:233-244` (`openOoxml` budget check)
- **Evidence:** this is the DoS guard for any authenticated user uploading a DOCX/PPTX/XLSX to `/api/uploads/source` or `/api/uploads/template` — it should reject an archive whose declared `uncompressedSize` exceeds 80 MB before fully inflating it. `grep -rn "xml-scan\|xmlScan\|XML_BUDGET\|totalBudget\|MAX_UNZIPPED_BYTES" tests/*.test.mts` → no output; none of `tests/translate-docx.test.mts`, `tests/translate-pptx.test.mts`, `tests/translate-xlsx.test.mts` mention a budget/size case. The sibling upload paths (`source-upload.test.mts`, `template-upload.test.mts`) *do* test `Content-Length`-based size rejection thoroughly — this specific defense (declared-vs-real zip entry size, the classic zip-bomb vector) is the one gap in an otherwise well-covered upload-validation area.
- **Reproduction:** no test constructs a zip archive with an entry whose declared/inflated size exceeds `MAX_UNZIPPED_BYTES` and asserts `openOoxml` throws.
- **Proposed fix:** add a case to `tests/translate-docx.test.mts` (or new `tests/xml-scan.test.mts`): build a zip whose one entry's declared/inflated size exceeds 80 MB, call `openOoxml`, assert it throws `"Hujjat ichidagi ma'lumot juda katta"` rather than allocating the full buffer.
- **Effort:** S
- **Confidence:** medium — faking a mismatched declared-size entry via JSZip's internals needs a small spike; if unreliable, an actual highly-compressed 80 MB+ payload (small on disk, large inflated) is the fallback.

### TEST-12 — `requireAdmin` guard itself is untested (composes two tested primitives, but the composition isn't)
- **Severity:** P2
- **Location:** `lib/server/admin.ts:15-23`
- **Evidence:** `grep -n "requireAdmin" tests/*.test.mts` → no output. `checkOrigin` (`tests/security.test.mts`) and `isAdminPhone` (`tests/admin.test.mts`) are each well tested standalone, but nothing proves `requireAdmin` combines them correctly: a non-admin authenticated user gets **404** not 403 (deliberate, to avoid revealing the admin panel exists — comment at `admin.ts:11-13`), and a mutating request without a valid `Origin` is rejected before the `isAdminPhone` check runs.
- **Reproduction:** no test calls `requireAdmin` with a mocked `Request`/session.
- **Proposed fix:** add a case to `tests/admin.test.mts`: valid session + non-admin phone → 404; cross-origin mutating request even with an admin session → 403 before reaching the phone check.
- **Effort:** S
- **Confidence:** high

## Checked and OK

- `checkOrigin` (CSRF) — same-origin/allowed-origin/cross-origin/malformed-origin/`Sec-Fetch-Site` all covered, `tests/security.test.mts`.
- Telegram Login Widget + Mini App HMAC verification (valid/tampered/missing-hash/expired `auth_date`) — `tests/auth.test.mts`.
- Telegram bot login-ticket flow (single-use, expiry, token-hash-only storage, replay) — `tests/telegram-link.test.mts`, `tests/telegram-bot-login.test.mts`, unusually thorough.
- Click/Payme signature primitives (`clickSignatureValid`, `paymeAuthorized`) call the real exported functions, not a reimplementation (the file's own comment documents a prior N-10 bug where the test reimplemented the formula and tested itself); cover tampering, missing-secret, case-insensitivity, prepare_id placement. `tests/payments.test.mts`.
- Credits idempotency, insufficient-funds, partial-refund double-block — real Postgres, `tests/credits.test.mts`.
- Admin wallet adjustment (`adminAdjustWallet`) incl. negative-clamp and journal `kind` separation from real payment kinds — real Postgres, `tests/admin.test.mts`.
- Account-namespace collision guard (OTP `local_id` vs. Telegram `username`, the AUDIT-4-era bug) — real Postgres, `tests/accounts.test.mts`.
- File/generation ownership at the data layer, including CASCADE delete of files+assets — real Postgres, two-user fixtures, `tests/storage.test.mts`.
- `doc`/`doc/restore` edit routes: 404 on foreign/missing generation, optimistic-lock (`doc_version`) conflict — `tests/slide-doc-route.test.mts`.
- Queue budget plumbing (`budgetFor`→row→`claimJob`), `reclaimStaleJobs` respecting per-job budget instead of a global timeout, `completeJob` format-label correction — real Postgres, `tests/queue.test.mts`.
- Partial-refund ratio formula shared between `worker.ts` and `lib/generation/delivered.ts`, regression-tested to not diverge — `tests/queue.test.mts`.
- Public game endpoints: token validation, CSRF, per-IP rate limit with `Retry-After`, CSV BOM/formula-injection protection, server-side scoring, per-`kind` answer-leak prevention, audio asset IDOR — `tests/game-routes.test.mts`, `tests/game-public.test.mts`, `tests/game-sessions.test.mts`. The single best-covered area in this whole scope.
- Upload magic-byte sniffing (PNG-renamed-as-DOCX/PPTX/photo), `Content-Length` pre-check before body read, scanned-PDF rejection — `tests/source-upload.test.mts`, `tests/template-upload.test.mts`, `tests/photo.test.mts`.
- Migration file naming/ordering/idempotency (`IF NOT EXISTS`) convention — `tests/migrations.test.mts`.
- `SESSION_SECRET` required-at-runtime-but-not-at-build distinction (subprocess-level test) — `tests/security.test.mts`.

## Minimal test plan

Ordered by leverage (money/auth/queue first). "Needs PG" = real Postgres, using the project's existing
`DATABASE_URL`/`hasDb` skip-gate pattern already established in `credits.test.mts`/`queue.test.mts`.

| # | File | Asserts | Kind | Effort |
|---|---|---|---|---|
| 1 | `tests/ratelimit.test.mts` (new) | Fixed-window cap enforced, `retryAfterSec>0` once over limit; `clientIp` trust-proxy toggle + last-XFF-hop-wins | `rateLimit`/`purgeRateLimits` need PG; `clientIp` pure | S |
| 2 | `tests/queue.test.mts` (extend) | Concurrent `claimJob` never double-claims (`Promise.all` of 2 → distinct ids) | Needs PG | S |
| 3 | `tests/credits.test.mts` (extend) | Concurrent `charge` on one wallet never overdraws (`Promise.all` of 2 → exactly one wins) | Needs PG | S |
| 4 | `tests/env-warnings.test.mts` (extend) | Each of the 6 untested `assertRuntimeConfig` branches fires, esp. `DEV_LOGIN_ENABLED` in prod | Pure-logic (subprocess import per case) | S |
| 5 | `tests/session.test.mts` (new) | create→resolve→revoke→null; `is_blocked` row resolves null even unexpired | Needs PG | M |
| 6 | `tests/auth.test.mts` (extend) | OTP: 5 wrong attempts locks the code out even on a correct 6th guess; expiry | Needs PG | S |
| 7 | `tests/payments-orders.test.mts` (new) | create→attach→settle credits once; double `settleOrder` credits once; `cancelOrder` after paid is a no-op | Needs PG | M |
| 8 | `tests/payments-routes.test.mts` (new) | Click Prepare/Complete + Payme's 6 methods return protocol-correct error/state codes for amount-mismatch/unknown/already-paid/cancelled/prepare_id-mismatch | Pure-logic (mocked pool, pattern from `jobs-cost.test.mts`) | M |
| 9 | extend `photo.test.mts`/`source-upload.test.mts`/`telegram-link.test.mts`/`game-sessions.test.mts` | one stale + one fresh row → purge deletes only the stale one, per purge fn | Needs PG | S |
| 10 | `tests/health-route.test.mts` (new) | DB down → 503 + minimal body (anon); `problems`/`features` gated by `CRON_SECRET` Bearer | Pure-logic (mocked `queryOne`) | S |
| 11 | `tests/queue.test.mts` (extend) | `enqueueGeneration` insufficient-funds leaves zero `generations` rows | Needs PG | S |
| 12 | extend `photo.test.mts`/`source-upload.test.mts`/`template-upload.test.mts`/`thumb.test.mts`/`form-draft.test.mts` | stranger's read of owner's asset returns null, one case each | Needs PG | M |
| 13 | `tests/admin.test.mts` (extend) | `requireAdmin`: non-admin → 404; cross-origin mutation → 403 before phone check | Pure-logic (mocked Request/session) | S |
| 14 | `tests/translate-docx.test.mts` (extend) or new `tests/xml-scan.test.mts` | oversized declared zip-entry size → rejected before full inflate | Pure-logic | S–M |

~10 new/extended files, roughly 6 need Postgres; none needs new harness beyond the existing `hasDb` pattern.

### Infrastructure gaps

- **No CI in the repo.** No `.github/workflows/` or other CI config exists. All unit/viewer/UI tests run only
  when a developer remembers to run them locally, further gated by the 14 GB-RAM `scripts/heavy.sh`
  constraint (`CLAUDE.md`) that caps concurrency to 2 heavy processes. There is no automated gate before
  merge or deploy.
- **No DB-backed integration harness for CI.** Every `DATABASE_URL`-gated test (`credits.test.mts`,
  `queue.test.mts`, `admin.test.mts`, `accounts.test.mts`, `storage.test.mts`, `game-sessions.test.mts` —
  precisely the tests covering money/auth/queue/IDOR) silently *skips* (`{ skip: hasDb ? false :
  "DATABASE_URL yo'q" }`) whenever `DATABASE_URL` is unset or contains `"unused"`. With no CI, this means
  the money/auth/queue tests only run on a machine that happens to have a local Postgres configured —
  nothing proves they run reliably anywhere, ever. The project already runs Postgres 16 in
  `docker-compose.yml`; wiring a throwaway `postgres:16-alpine` into a CI job (even just `docker run -d
  postgres:16-alpine` + `npm test` with `DATABASE_URL` pointed at it) would turn every "needs PG" item
  above into an actually-enforced gate instead of a local nice-to-have.
- **`.env.local` leaks into every unit-test run by design.** `package.json`'s `test` script is `tsx
  --env-file-if-exists=.env.local --conditions=react-server --test tests/*.test.mts` (line 11) — confirmed
  by reading `package.json` directly. Every `npm test` run auto-loads whatever `.env.local` a developer
  happens to have, including a real `DATABASE_URL` if one is configured for local dev. This is exactly why
  the DB-gated tests "just work" on one machine and silently skip on another, and it is the documented
  cause of 2 known env-dependent failures in `tests/document.test.mts` (per project history) — a
  developer's local `.env.local` state changes what that file asserts, making the suite not reproducible
  machine-to-machine. Recommended fix: DB-gated tests should read a dedicated `TEST_DATABASE_URL` (or CI
  should export `DATABASE_URL` explicitly pointing at a disposable container), decoupling "what my dev
  server uses" from "what the test suite uses" — the `.includes("unused")` sentinel already present in
  every DB-gated test file is a workaround for this same root cause and could be retired once the two are
  decoupled.
- **No concurrency-test scaffolding anywhere in the suite.** TEST-03/TEST-04 aren't isolated oversights:
  `grep -rl "Promise.all" tests/*.test.mts` across the full 215-file top-level suite returns exactly 2
  files, and neither is about money or the job queue. Not one "real Postgres" test file in the suite fires
  simultaneous requests with `Promise.all`. This is a suite-wide blind spot (no concurrent-request helper,
  no example to copy), not specific to any one function — fixing TEST-03/04 first would also give the next
  auditor a pattern to reuse for TEST-01/TEST-09's harder cases.
