# external integrations (EXT) — findings
Scope actually covered: every outbound call site (`grep fetch(` / SDK clients / `https://` literals over `lib app scripts`) — `lib/generation/llm.ts`, `llm-roles.ts`, `llm-pricing.ts`, `llm/{chain,types,anthropic,gemini,openai,openrouter,xai}.ts`, `image-provider*.ts`, `image-studio.ts`, `slide-images.ts`, `slide-image-prompts.ts`, `slide-research.ts`, `slide-write.ts` (budget/stage logic), `research/{http,cache,openalex,crossref,googlebooks,lexuz,pipeline,verify}.ts`, `tts/{chain,azure,aisha,gemini,types}.ts`, `audio/engine.ts`, `translate/engine.ts`, `work/engine.ts`, `article/{polish,review}.ts`, `report/{polish-core,judge}.ts`, `delivered.ts`, `budget.ts`, `quality.ts`, `json.ts`, `index.ts`; `lib/server/{worker,jobs,telegram,payments,doc-polish,article-rewrite,env,credits,validate,slide-image}.ts`; routes `app/api/{payments/click,payments/payme,payments/orders,telegram/webhook,health,outline,article/udk,generations,generations/[id],generations/[id]/{polish,rewrite}}`; `scripts/bot.mts`; `docker-compose.yml`, `Dockerfile`, `.env.example`, `.claude/deploy.md`; `@anthropic-ai/sdk@0.125.0` retry code. Not covered: payment business logic beyond webhook verification (settle/cancel races, Payme 12-hour pending timeout — not implemented, Click cancel of an already-paid order) → abuse/business-logic auditor; Telegram login-widget / Mini-App signature checks → auth auditor; worker/queue capacity itself → scale/concurrency auditors; upload parsing → file-processing auditor. No provider was called; quota figures come from the repo's own `.env.example` notes.
Summary: P0 0 · P1 2 · P2 7 · P3 6

### EXT-01 — Payme webhook accepts the sandbox TEST key in production (test payments can credit real balance)
- **Severity:** P1 (escalate to P0 if the precondition below is confirmed)
- **Location:** `app/api/payments/payme/route.ts:75`, `lib/server/payments.ts:76-106` (`paymeAuthorized`), `lib/server/env.ts:189-193,227`, `docker-compose.yml:84` (`PAYME_TEST_KEY` passed to prod `web`)
- **Evidence:**
  ```ts
  if (!paymeAuthorized(req.headers.get("authorization"), [env.payme.key, env.payme.testKey])) {
  ```
  `paymeAuthorized` returns true if the Basic password equals **either** key (`valid.some(...)`, payments.ts:105). There is no
  test-mode switch: whenever `PAYME_TEST_KEY` is present in the environment, the production endpoint treats a request signed
  with the sandbox key exactly like a real Payme call, and `PerformTransaction` → `settleOrder` → `topUp(balance)` credits the
  user. `paymentsConfigured()` even reports Payme as enabled when *only* the test key is set (env.ts:227), and
  `.env.example:144` + compose list `PAYME_TEST_KEY` as a normal prod variable, so it is likely to be filled in during
  integration testing and left there.
  Payme's sandbox (`test.paycom.uz` / `checkout.test.paycom.uz`, public test cards) signs its Merchant-API calls with the
  cashbox's **test** key and sends them to the cashbox's endpoint URL. The merchant id is public (it is inside every
  `checkout.paycom.uz/<base64>` link the site hands out, `app/api/payments/orders/route.ts:65-72`) and the order id is the
  attacker's own order. If the sandbox dispatches to the same endpoint URL, any user can "pay" with a sandbox test card and
  receive real coins.
- **Reproduction:** (no Payme call needed to prove the code path) —
  `curl -X POST $APP/api/payments/payme -H "Authorization: Basic $(printf 'Paycom:%s' "$PAYME_TEST_KEY" | base64)" -H 'Content-Type: application/json' -d '{"id":1,"method":"CheckPerformTransaction","params":{"amount":500000,"account":{"order_id":"<own order uuid>"}}}'`
  → `{"result":{"allow":true}}`; then `CreateTransaction` / `PerformTransaction` with any `params.id` → balance +5 000.
  Unit sketch: `assert.equal(paymeAuthorized(basic("Paycom:"+TEST), [PROD, TEST]), false)` when not in test mode — fails today.
- **Proposed fix:** accept `testKey` only when an explicit `PAYME_TEST_MODE=true` is set, and make `assertRuntimeConfig()`
  refuse to boot with `NODE_ENV=production && PAYME_TEST_MODE=true`; `paymentsConfigured().payme` must require `PAYME_KEY`.
  Remove `PAYME_TEST_KEY` from the prod `web` service in `docker-compose.yml`.
- **Effort:** S
- **Confidence:** medium — code path is certain; the P0 precondition needs two checks: (1) `docker compose -p slaydx exec web sh -c 'test -n "$PAYME_TEST_KEY" && echo SET'` on the box; (2) confirm with Payme docs/support that sandbox/test-checkout transactions for the cashbox are delivered to the configured (production) endpoint URL.

### EXT-02 — No global/per-user LLM spend cap or kill switch; free LLM endpoints give any account ≈ $50–100/day of provider spend
- **Severity:** P1
- **Location:** `app/api/generations/[id]/rewrite/route.ts:31` (20 per 600 s), `lib/server/article-rewrite.ts:76-84` (client-supplied `fix.target`/`fix.instruction`), `lib/generation/article/polish.ts:516-526` (any section, any instruction ≤ 600 chars), `lib/generation/article/polish.ts:418` (`maxTokens` up to 8 000), `app/api/generations/[id]/polish/route.ts:30-31` (20/day/user, 3/doc/day, writer ×≤6 + Claude judge), `app/api/outline/route.ts:27` (12/600 s), `app/api/article/udk/route.ts:19` (30/h), `lib/server/auth.ts:15` (`SIGNUP_BONUS_POINTS = 3000`), `lib/generation/llm-pricing.ts:33` (Gemini 3.7 Flash $0.75/$3.75 per M)
- **Evidence:** request-path LLM calls are free and bounded only by per-user fixed windows:
  - rewrite: `limit(\`rewrite:${user.id}\`, 20, 600)` → 2 880 calls/day/account; the instruction and target are chosen by the
    client (`parseArticleFix` only checks length/charset), so this is a general "rewrite anything" LLM proxy; output up to
    8 000 tokens for article/teacher sections (`article/polish.ts:418`; Gemini's `maxOutputTokens` floor is 4 096 for every
    call, `llm.ts:235`) → ≈ $0.03–0.035 per call → **≈ $90–100/day per account**; a bonus-funded 20-card flashcards set
    allows ≈ 4 300 output tokens per call (`games/flashcards/polish.ts:264`) → ≈ $50/day per account (prices from
    `llm-pricing.ts`).
  - polish: 20/day × (≤ 6 writer calls + 1 Claude Sonnet 5 judge ≈ $0.05–0.1) ≈ $5–6/day/account.
  - outline 1 728/day, udk 720/day (small tokens).
  Rewrite works on articles, teacher docs and the crossword/flashcards games (`article-rewrite.ts:231-260,324-351`); a
  crossword or flashcards set costs 2 000 coins (`lib/tools.ts:757,788` `basePrice`), i.e. it is fully covered by the
  3 000-point signup bonus every new Telegram account receives — no payment is needed to unlock the endpoint (article and
  teacher docs, 4 000+ coins, give larger outputs per call). There is no per-day USD budget, no per-user token budget, no global
  circuit that stops spend when a threshold is crossed, and no kill switch other than `LLM_STREAM=false` (which only disables
  streaming). These calls are also invisible to cost telemetry (they never write `cost_json`, see EXT-11), so the spend is
  discovered only on the provider invoice.
- **Reproduction:** new Telegram account → create a 20-card flashcards set (2 000 pts from the bonus) → loop
  `POST /api/generations/<id>/rewrite {"baseVersion":v,"fix":{"op":"rewrite","target":"cards","instruction":"..."}}`
  20×/10 min (baseVersion taken from each response; `target:"clues"` for a crossword). With an article/teacher doc and a
  long section the per-call output approaches `maxTokens`. Multiply by N accounts.
- **Proposed fix:** (1) add a daily per-user budget for free LLM actions (e.g. `limit(\`free-llm:${user.id}\`, 60, 86_400)`
  shared by rewrite/polish/outline/udk) and lower rewrite to e.g. 5/10 min; (2) add a process-wide spend guard in
  `llm-roles.complete()`/`llm.ts runLlm()` that accumulates `costUsd` per UTC day in the DB (`llm_spend` row, updated per call)
  and refuses free (non-job) calls above `LLM_DAILY_FREE_USD`, and all calls above `LLM_DAILY_MAX_USD` (kill switch);
  (3) record request-path usage (see EXT-11).
- **Effort:** M
- **Confidence:** high for the limits/bonus/cost path; the $/call figure is an estimate from `llm-pricing.ts` and the token caps (actual output length depends on the instruction).

### EXT-03 — LLM role chain ignores the caller's time budget (per-attempt timeout × retries × specs, uncapped `Retry-After`, uncancellable calls)
- **Severity:** P2
- **Location:** `lib/generation/llm/chain.ts:60-88,114` (`runSpec`/`completeWithChain`), `lib/generation/llm/anthropic.ts:94` (`maxRetries: 1`), `node_modules/@anthropic-ai/sdk/client.js:739-767` (SDK sleeps any `retry-after` ≤ 2^31 ms), `lib/generation/report/judge.ts:28` (`JUDGE_TIMEOUT_MS = 60_000`), `lib/generation/article/review.ts:568-573` (judge call, no race), `lib/generation/{article,work,teacher}/polish.ts` + `games/*/polish.ts` (`bomb` races at article/polish.ts:379, work/polish.ts:305, …), `lib/server/doc-polish.ts:103,422`, `app/api/generations/[id]/polish/route.ts:7`, `app/api/article/udk/route.ts:8,27`, `lib/generation/research/http.ts:70-93`, `lib/generation/image-studio.ts:219`, `lib/server/worker.ts:104-116` + `lib/server/jobs.ts:492` (heartbeat vs reclaim)
- **Evidence:** `runSpec` gives **every** attempt the full budget and never subtracts elapsed time:
  ```ts
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await adapter.complete(spec.model, system, user, { ..., timeoutMs: opts.timeoutMs, ... });
    ...
    await sleep(res.retryAfterMs ?? (res.status === undefined ? 2_000 : 500) * 2 ** attempt);
  ```
  (`llm.ts withRetry` does track elapsed time; the chain used by article/work/essay/teacher/games/infographic/audio, all
  judges, research and the polish/rewrite/udk routes does not). A call with `timeoutMs = T` can therefore run
  `specs × 3 × T` plus sleeps; for Anthropic each attempt is itself up to `2 × T` because the SDK retries once
  (timeouts, 408/409/429/5xx). `retryAfterMs` is taken verbatim from the provider header with no cap and no deadline check,
  and SDK 0.125 also sleeps for any `retry-after` up to 2^31 ms before its internal retry.
  Worked example — judge call, `LLM_JUDGE=anthropic:claude-sonnet-5,gemini:…`, `timeoutMs = 60 s`:
  slow 5xx/529 from Anthropic → 3 × (2 × 60 s) + Gemini 3 × 60 s ≈ **9 min**; Anthropic 429 with `retry-after: 60` →
  ≈ 5 min of pure sleeping; Anthropic timeout → 2 × 60 s = 120 s (then the chain stops, see EXT-04).
  Callers know the budget is not honoured and wrap calls in a `Promise.race` "bomb" (e.g. `article/polish.ts:379-384`), but
  `complete()` takes no `AbortSignal`, so the abandoned call keeps retrying and spending tokens after the job/request has moved
  on, and its usage is never metered. The same per-attempt pattern exists in `research/http.ts` (a 15 s OpenAlex call can
  take 3 × 15 s + 2 s against a 30 s research stage), and the image tool calls `requestGeminiImage(..., undefined)` so a
  90 s job (`budget.ts:37`) can take 20 s + 2 × 120 s.
  Consequences: (a) **worker** — overruns are invisible to the queue: the progress ticker refreshes `locked_at` every 2 s
  and `reclaimStaleJobs` only looks at `locked_at`, so an overrunning job holds one of the 2 worker slots for as long as the
  code runs; two such jobs stall the whole queue. (b) **request path** — `maxDuration` is not enforced by self-hosted
  `next start` and no handler reads `req.signal`; polish runs to `POLISH_TIMEOUT_MS = 120 s` plus the un-raced judge
  (the judge gets the remaining 40–60 s and an Anthropic timeout doubles that to 80–120 s), so it crosses nginx `proxy_read_timeout 120s` (`.claude/deploy.md:74-81`):
  the client gets 504, the server later commits a new doc version (client's next edit → 409) and the 3/doc/day polish
  quota is consumed. udk: 3 × 20 s + 1.5 s = 61.5 s vs nginx's default 60 s.
- **Reproduction:** `tests/llm-chain-budget.test.mts` sketch:
  ```ts
  const slow503 = (id) => ({ id, complete: async (_m,_s,_u,o) => { await new Promise(r => setTimeout(r, o.timeoutMs - 50)); return { ok:false, error:"HTTP 503", retryable:true, status:503 }; } });
  process.env.GEMINI_API_KEY = process.env.XAI_API_KEY = "x";
  const t0 = Date.now();
  await completeWithChain("writer", [{provider:"gemini",model:"a"},{provider:"xai",model:"b"}], "s", "u",
    { maxTokens: 10, timeoutMs: 1000 }, { adapters: { gemini: slow503("gemini"), xai: slow503("xai") } });
  assert.ok(Date.now() - t0 < 1500); // fails today: ≈ 6 × 0.95 s + 3 s
  ```
  Second case: adapter returns `{ok:false, retryable:true, status:429, retryAfterMs: 3_600_000}` → the call does not return within the test timeout.
- **Proposed fix:** in `completeWithChain` compute `until = Date.now() + opts.timeoutMs` once; each attempt gets
  `min(opts.timeoutMs, until - now)`, stop when < 3 s; clamp every sleep to `min(retryAfter ?? backoff, 10 s, until - now - 3 s)`
  and skip the retry if it doesn't fit; construct the Anthropic client with `maxRetries: 0` (the chain already retries);
  add `signal?: AbortSignal` to `RoleOpts`/`AdapterOpts`, pass it to `fetch` and `client.messages.create(body, { signal })`,
  and have the `bomb` helpers abort it in `finally`. Apply the same overall-deadline rule to `research/http.ts request()`.
  Pass the job deadline into `buildImageArtifact`. For request routes pass `req.signal` down and keep polish (fixes + judge)
  ≤ 100 s so it always answers inside nginx's 120 s.
- **Effort:** M
- **Confidence:** high (code paths); the frequency of slow-5xx / long `Retry-After` responses in production is unmeasured — confirm with `grep -c "→ xato" ` on worker logs.

### EXT-04 — Fallback never engages for a slow/hung provider and there is no circuit breaker; Gemini is a hard single point of failure
- **Severity:** P2
- **Location:** `lib/generation/llm/chain.ts:82,114` (+ header comment lines 1-15: "TIMEOUT … keyingi specga O'TILMAYDI"), `lib/generation/llm.ts:8-12,144-156` (`llmProvider()` = Gemini whenever `GEMINI_API_KEY` is set; xAI only when it is absent), `lib/generation/llm-roles.ts:63-66`, `lib/generation/image-provider.ts:238-243` + `image-studio.ts:219` (images Gemini-only), `.env.example:162-165` (writer/researcher/fast chains are Gemini-only), `app/api/health/route.ts:68-70` (reports key presence only), `lib/generation/work/engine.ts:119-130,350-366`, `lib/generation/slide-write.ts:611-617,700-704`
- **Evidence:**
  - The most common degradation mode of an LLM API is latency (requests hang until our timeout), not fast errors. In the
    role chain a timeout ends the whole chain (`if (isTimeoutSignal(res.error)) return "timeout"` → `return null`), so the
    configured fallback `LLM_JUDGE=anthropic:…,gemini:…` is never reached when Anthropic is slow; it only helps for fast 429/5xx.
  - The legacy path used by slide, pro-slide, translation, resume, outline, image-prompt expansion and `write-llm`
    (`llmComplete`/`llmStream`/`llmGrounded`) has exactly one provider: `llmProvider()` picks Gemini whenever its key exists,
    so the xAI/Anthropic/OpenRouter adapters are never a runtime fallback. Pro-slide and image-tool images are Gemini-only.
    A revoked/suspended Gemini key (the repo is public; Google auto-revokes leaked keys) or a Gemini brownout stops every tool.
  - There is no health memory between calls or jobs (no module-level state in `llm.ts`/`chain.ts`): every call rediscovers
    the outage and waits its full timeout. Engines keep going after a failed call (e.g. work engine: outline 30 s → fallback
    outline → intro 45 s → paragraphs `mapPool(3)` each up to 90 s + one retry), so during a brownout each job burns its
    **entire** budget (slide-10 ≈ 230 s, pro-slide-16 ≈ 406 s, coursework up to 660 s) before failing and refunding
    (the user does end with FAILED + automatic refund — every fetch has a per-attempt timeout, so nothing hangs forever,
    only for the overruns described in EXT-03/EXT-10).
  - Scale: with one worker × `WORKER_CONCURRENCY=2`, throughput during a brownout drops to ≈ 2 jobs per 4–11 min
    (≈ 10–30 jobs/h) while users at the 2 000-concurrent target keep enqueueing; the backlog of QUEUED jobs (which never
    expire) keeps growing for the whole incident and drains slowly afterwards, and users wait tens of minutes only to get a
    failure. `/api/health` stays green (it only checks that keys are configured), so nothing alerts.
- **Reproduction:** chain: adapters `{anthropic: stub that waits timeoutMs then returns {ok:false,error:"Request timed out.",retryable:true}, gemini: stub returning ok}` → `completeWithChain("judge", [anthropic, gemini], …)` returns `null`; the Gemini stub is never called. Legacy: set both `GEMINI_API_KEY` and `XAI_API_KEY`, stub `fetch` so Gemini URLs hang until aborted and `api.x.ai` answers instantly → `buildSlideAcademicDoc(meta, Date.now()+60_000)` spends its whole text-stage budget waiting on Gemini, `writeSlidesWithLlm` returns `null` (too few slides) and it throws "Taqdimot matni yozilmadi"; the xAI stub is never called.
- **Proposed fix:** (1) in `completeWithChain`, on timeout move to the next spec if ≥ N s of the (now budget-aware, EXT-03)
  window remain — e.g. give the primary 60 % of the window; (2) add a small per-provider circuit breaker shared by `llm.ts`
  and `llm/chain.ts` (open after ~5 consecutive timeouts/5xx within 60 s, half-open probe after 30 s); while open, skip that
  spec, and have the worker stop *claiming* jobs whose tool depends only on the open provider (leave them QUEUED instead of
  burning and refunding them); (3) route `llmComplete`/`llmStream` through a spec list (e.g. `LLM_DEFAULT=gemini:…,openrouter:…`)
  so the existing adapters become a real fallback; (4) expose breaker state and last-N provider error rates in the
  authorized `/api/health` view so the operator gets alerted.
- **Effort:** M
- **Confidence:** high (code paths); the per-job durations are the budgets from `lib/generation/budget.ts`.

### EXT-05 — Telegram login replies: no 429/`retry_after` handling and updates are de-duplicated *before* the reply, so login links are silently lost under burst
- **Severity:** P2
- **Location:** `lib/server/telegram.ts:28-47` (`call`), `:49-62` (`sendMessage` result ignored by callers), `:226-232,337-338` (`isNewUpdate` runs first), `:269-273` (`sendLoginLink`), `app/api/telegram/webhook/route.ts:38-46` (exceptions swallowed, always 200), `scripts/bot.mts:46`
- **Evidence:**
  ```ts
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) { console.warn(`[telegram] ${method}:`, data.description ?? "xato"); return null; }
  ```
  A 429 (`"Too Many Requests: retry after N"`, `parameters.retry_after`) or any network error just returns `null`; nobody
  retries. Login is the only thing the bot does and it depends entirely on this one `sendMessage`: the site's
  "Telegram orqali kirish" opens `t.me/<bot>?start=<nonce>` and the session is created only when the user taps the link the
  bot sends back. `handleUpdate` first inserts `update_id` into `telegram_updates` (`isNewUpdate`), then does the DB work and
  the reply; the webhook swallows every exception and returns 200. So a transient failure (Telegram 429/5xx, 15 s timeout,
  DB error in `createBotLoginLink`) permanently drops that login attempt — Telegram will not redeliver it and a manual
  redelivery would be ignored as a duplicate.
  Scale: the Bot API allows ≈ 30 messages/s per bot. A viral Telegram post at the 10× burst target (thousands of new users
  within minutes) pushes `/start` above ~30/s at the peak; the excess users get no reply, retry, and add more load.
  Ops footgun on the same path: `scripts/bot.mts:46` unconditionally calls `deleteWebhook`; the script ships in the worker
  image (`Dockerfile:104`), so running `npm run bot` against the prod token silently disables production login.
- **Reproduction:** stub `fetch` for `api.telegram.org` to return `{"ok":false,"error_code":429,"description":"Too Many Requests: retry after 3","parameters":{"retry_after":3}}`; call `handleUpdate({update_id:1,message:{chat:{id:1},from:{id:1},text:"/start abc"}})` → no retry, returns normally; call it again with the same update → returns at `isNewUpdate` without replying.
- **Proposed fix:** in `call()`, on `error_code === 429` sleep `min(parameters.retry_after, 5)` s and retry once; put
  outbound sends behind a process-wide token bucket (~25 msg/s); mark the update processed only after the reply succeeded
  (insert into `telegram_updates` at the end, or store a status column) and return HTTP 500 from the webhook on transient
  errors so Telegram redelivers; make `scripts/bot.mts` refuse to run when `getWebhookInfo().result.url` is set unless `--force`.
- **Effort:** S
- **Confidence:** medium — mechanism is certain; the burst rate at which 429 starts depends on real traffic (≈ 30 msg/s is Telegram's documented guideline).

### EXT-06 — Stock-photo quotas (Pexels 200/h, Pixabay 100/min) are unmanaged; when exhausted every standard deck ships with 0 images and is refunded 100 %
- **Severity:** P2 (P1 once the worker is scaled toward the 2 000-concurrent target, or if `PIXABAY_API_KEY` is absent in prod)
- **Location:** `lib/generation/image-provider.ts:196-218,238-243` (standard `slide` = Pexels → Pixabay only; only `blocked` is sticky), `lib/generation/image-provider-pexels.ts:57-60`, `lib/generation/image-provider-pixabay.ts:55-64` (one search per slide image, no cache), `lib/generation/slide-images.ts:349-383` (429 → `failed`, no backoff), `lib/generation/delivered.ts:88-99,121` (`if (got <= 0) return 1;`), `lib/server/worker.ts:273-294` (`refundPartial`), `.env.example:82-87` (quotas)
- **Evidence:** every photo slot of a standard deck (≈ 8 per 10-slide deck, per the `plannedImageSlots` comment) triggers a
  fresh Pexels search, and on Pexels 429 a Pixabay search; results are never cached or shared between decks (Pixabay's API
  terms require caching responses for 24 h), there is no quota-aware limiter, and a 429 is not remembered between images or
  jobs. When both providers refuse, `report.got = 0` and `refundRatio()` returns 1 — the full deck price is refunded even
  though the LLM text (the expensive part) was generated and delivered. Scale: Pexels' 200/h (20 000/month) covers ≈ 25
  decks/h; after that Pixabay's 100/min ≈ 10–12 decks/min is the hard ceiling. A single worker (2 slots, ~1 deck/min)
  stays under it, but a worker scaled for the target load (≥ 10 standard decks/min) exceeds it and every further deck in that
  minute becomes free; without a Pixabay key the free-deck point is reached after ~25 decks/hour. Key revocation for ToS
  reasons (no caching, no Pexels attribution) gives `401/403 → blocked` → the same 100 % refunds for every deck.
- **Reproduction:** stub `fetch` so `api.pexels.com` and `pixabay.com/api` return 429; run `buildArtifact` for tool `slide` (10 slides) with an LLM stub → `doc.slideImages = {want: 8, got: 0, failed: 8}`, `file.delivered = {got:0,…,refundShare:0}`, `refundRatio(delivered) === 1` → worker calls `refundPartial(…, 1, …)`.
- **Proposed fix:** cache stock search results by normalized query in `source_cache` for 24 h; add a DB-backed token bucket
  per stock provider sized to its quota and make `rate` sticky for the deck (and for ~60 s process-wide) so lanes stop
  hammering; alert when the share of decks with `slideImages.got = 0` exceeds a threshold; decide explicitly whether a
  free-stock image shortfall on the standard slide should trigger a 100 % refund (the label promises no images and
  `IMAGE_PRICE_SHARE_STANDARD = 0`) — e.g. cap the standard-slide image refund at 0 or at a fixed small share.
- **Effort:** M
- **Confidence:** medium — quota numbers come from `.env.example` comments; images-per-deck is an estimate.

### EXT-07 — Research-source quotas (Google Books 1 000/day, OpenAlex daily allowance) run out at a few hundred jobs/day; paid documents then silently ship without verified sources
- **Severity:** P2
- **Location:** `lib/generation/research/pipeline.ts:329-352` (≤ 3 Google Books + ≤ 6 OpenAlex searches per job, plus one per user DOI/ISBN at `:129-143`), `lib/generation/research/http.ts:70-93` (429 retried after 0.5 s and 1.5 s), `lib/generation/research/cache.ts:100-117` (exact-query cache; failures not cached), `lib/generation/research/pipeline.ts:18-22` (empty list is not an error), `.env.example:176-186`
- **Evidence:** `.env.example` documents Google Books at 1 000 requests/day (and anonymous calls already returning 429) and
  OpenAlex at a $1/day free allowance. Each work job (coursework/referat/mustaqil ish, subjects with `book` kind) makes up to
  3 Books queries and up to 6 OpenAlex queries; the cache only helps for identical normalized queries. At ≈ 300 work
  jobs/day the Books quota is gone (exam season at 50 000 users easily exceeds that by midday); from then on every job
  gets 429 → two immediate retries (pointless against a daily quota) → empty list, and the document — priced 3 000–24 000
  coins — is delivered with fewer or no verified sources ("manba yetishmayapti" in the report), with no alert and no refund.
  Failed lookups are not cached, so every job re-hits the exhausted API.
- **Reproduction:** stub `fetch` so `googleapis.com/books` returns 429 and `api.openalex.org` returns 429; run `collectReferencesFor({kinds:["book","article"], research:true, …})` → `stats.books = 0`, `stats.failedQueries = 6`, result contains only user refs; total time includes 2 × (0.5 + 1.5 s) retry sleeps per query.
- **Proposed fix:** request a higher Google Books quota and budget OpenAlex before launch; treat 429 from these APIs as a
  provider-level circuit (skip the provider for N minutes; honour `Retry-After`) instead of retrying; cache negative results
  for ~10 min; persist `research.stats` (already computed) into `cost_json`/metrics and alert on `failedQueries`/`books = 0`
  rates; if sources are part of the promise for a tool, surface the shortfall via `delivered`.
- **Effort:** S
- **Confidence:** medium — quotas are taken from the project's own `.env.example` notes; jobs/day thresholds are estimates.

### EXT-08 — `source_cache` stores raw provider payloads and is never purged (unbounded Postgres growth on the shared VPS)
- **Severity:** P2
- **Location:** `lib/generation/research/cache.ts:100-117` (`cached` upserts, no delete), `lib/generation/research/openalex.ts:20,133-141,157-164` (raw `results[]` incl. full `authorships` and `abstract_inverted_index` cached), `lib/generation/research/crossref.ts:83-91` (full `/works/{doi}` `message`, incl. `reference[]`), `lib/generation/research/googlebooks.ts:129-137` (raw `items[]`), `lib/server/migrations/020_article.sql:32-37` (index on `fetched_at` but no purge), `lib/server/worker.ts:324-366` (`housekeeping` purges sessions/tickets/rate limits/sources/photos — not `source_cache`)
- **Evidence:** the cache writes the provider's raw JSON and only reads the fields it needs afterwards
  (`referenceFromWork` keeps ≤ 6 author names and a ≤ 600-char abstract, but it runs *after* `cached()`):
  ```ts
  const raw = await cached(key, CACHE_DAYS, async () => { … return Array.isArray(results) ? results : null; });
  return raw.map(referenceFromWork)…
  ```
  An OpenAlex work with `authorships` (nested author + institutions + affiliation strings) and an inverted-index abstract is
  typically several KB (multi-author papers far more); 25 per search → ≈ 100–250 KB per cached query before TOAST
  compression. A research job issues up to 6 OpenAlex + 3 Books searches with LLM-generated (hence almost always new)
  query strings, so practically every article/coursework/referat adds ≈ 0.3–1 MB. The TTL is enforced only on read
  (`now() - fetchedAt <= ttlDays`); expired rows stay forever because nothing deletes them. At 1 000–3 000 research jobs/day
  (exam season at the target user base) that is roughly 0.5–3 GB/day of JSONB on a VPS shared with two other projects —
  disk exhaustion takes the whole Postgres (and every tool) down, and `pg_dump` before each deploy grows accordingly.
- **Reproduction:** on prod (read-only): `SELECT count(*), pg_size_pretty(pg_total_relation_size('source_cache')), pg_size_pretty(avg(pg_column_size(payload))::bigint), min(fetched_at) FROM source_cache;` — size grows monotonically; rows older than 30 days exist. Locally: run `collectReferencesFor` twice with different topics against a stubbed OpenAlex returning a realistic page and compare `pg_total_relation_size`.
- **Proposed fix:** cache the *projected* records (`referenceFromWork` / `referenceFromCrossref` / `referenceFromVolume`
  output, ≈ 1 KB each) instead of raw payloads; add `DELETE FROM source_cache WHERE fetched_at < now() - interval '30 days'`
  (batched, `LIMIT`ed) to `housekeeping()` — the `source_cache_fetched_idx` index already exists for it; optionally cap a
  single payload (skip caching above ~64 KB).
- **Effort:** S
- **Confidence:** medium — the no-purge/raw-payload facts are certain; per-row size is an estimate, confirm with the query above.

### EXT-09 — No per-provider concurrency limit or backpressure: quota saturation turns into a failure cliff (failed + refunded jobs) instead of queueing
- **Severity:** P2 (at today's single worker with 2 slots the worker is the ceiling; breaks as soon as the worker is scaled toward the target load)
- **Location:** `lib/generation/quality.ts:131-147` (`mapPool` — per-job bound only), `lib/generation/slide-images.ts:69-70` (`PRO_IMAGE_LANES = 5`, `IMAGE_LANES = 3`), `lib/generation/translate/engine.ts:61` (`POOL = 4`), `lib/generation/work/engine.ts:366` (`mapPool(paragraphPlans, 3, …)`), `lib/generation/llm.ts:120-135` (429 → 3 tries in ≈ 3.5 s, then `null`), `lib/generation/llm/chain.ts:60-88`, `lib/generation/image-provider-gemini.ts:96-99` (429 → `rate`, never retried), `lib/generation/slide-write.ts:700-704,956-958`
- **Evidence:** concurrency toward providers is bounded only inside one job; there is no process-wide semaphore and no
  cross-process token bucket per provider, and no quota figures anywhere in config. Per worker process the fan-out is
  ≤ 2 jobs × 5 lanes, so today the worker (2 slots) is the bottleneck. To serve the 2 000-concurrent target the worker must be
  scaled to tens of concurrent jobs, and then the aggregate rate is unconstrained — e.g. 40 concurrent coursework jobs × 3
  paragraph lanes ≈ 120 concurrent Gemini text calls (each several k tokens), 20 concurrent pro-slide jobs × 5 lanes = 100
  concurrent image generations. When that exceeds the project's RPM/TPM/IPM quota, Gemini answers 429: the legacy path gives
  up after three attempts inside ≈ 3.5 s, the chain after ≈ 1.5 s (Gemini's `RetryInfo` delay is ignored, EXT-13), image
  requests fail immediately. Paragraphs/slides/images come back empty → volume gate or `if (!written && llmEnabled()) throw`
  → job FAILED + refund (text) or partial/100 % refund (images, EXT-06). So every job in flight during a saturated minute
  fails, instead of all jobs slowing down.
- **Reproduction:** stub Gemini `fetch` to return 429 whenever more than N requests are in flight; run 3 × ⌈N/3⌉ parallel
  `buildArtifact(coursework)` with a 600 s deadline → most jobs fail (volume gate or "Matn yozilmadi"); wrap the adapter in a semaphore of
  size N → all complete (slower).
- **Proposed fix:** add a per-provider limiter acquired inside `llm.ts` (`completeGemini`/`streamGemini`/`rawGemini`), the chain
  adapters and `requestGeminiImage` — process-level semaphore sized by env (`GEMINI_MAX_INFLIGHT`, `GEMINI_IMAGE_MAX_INFLIGHT`,
  `ANTHROPIC_MAX_INFLIGHT`) plus a DB-backed token bucket if several worker processes run; on 429 wait for `RetryInfo`
  (within the job budget) instead of failing; scale `WORKER_CONCURRENCY` together with these limits; record the production
  quota tier (AI Studio → Rate limits; Anthropic console) in `.claude/deploy.md`.
- **Effort:** M
- **Confidence:** low-medium — the mechanism is certain; the saturation point depends on the (unrecorded) quota tier of the Gemini project and Anthropic org.

### EXT-10 — TTS chain has no job deadline: sequential parts × 2 attempts × 30 s, uncapped `Retry-After`, full restart on the next provider
- **Severity:** P3 (latent: Azure/Aisha keys are not deployed yet; becomes P2 the day they are)
- **Location:** `lib/generation/tts/chain.ts:159-189,202-248` (`synthesizeAll`/`runGroup`, sleep at :235), `lib/generation/audio/engine.ts:308`, `lib/generation/tts/types.ts:270-287` (`chunkChars 900` :276, `maxChars 12 000` :278, `callTimeoutMs 30 000` :287), `lib/generation/tts/azure.ts:180-186` (timeouts marked retryable)
- **Evidence:** the engine computes one per-call timeout at the start (`timeoutMs: Math.min(TTS_LIMITS.callTimeoutMs, …remainingMs(deadline))`)
  and hands the whole script to `synthesizeAll`, which never looks at the clock again: up to 14 parts, sequentially, each
  with 2 attempts (timeouts retried), `await sleep(err?.retryAfterMs ?? 500 * 2 ** attempt)` with the provider's
  `Retry-After` uncapped, and when a part fails twice the next provider starts again from part 1. A degraded Azure whose
  calls run close to the 30 s timeout — or where the first attempt times out and the retry succeeds — gives up to
  14 × (30 + 0.5 + 30) s ≈ 14 min; if a late part then fails twice, Aisha repeats the whole script — versus a
  10-minute-podcast budget of 570 s. As with EXT-03 the heartbeat keeps the job alive, so it holds a worker slot throughout.
- **Reproduction:** mock provider whose `synthesize` alternates — odd calls wait `opts.timeoutMs` then throw `new TtsError("azure","timeout",{retryable:true})`, even calls wait `opts.timeoutMs - 10` then return audio; `makeTtsChain({providers:[mock]}).synthesizeAll(14 parts, {lang:"uz", timeoutMs: 1000})` runs ≈ 14 × 2.5 s ≈ 35 s with no deadline check (production scale ≈ 14 min).
- **Proposed fix:** pass `deadline` into `synthesizeAll`; before each part/attempt check the remaining time against an estimate
  and fail fast; cap `retryAfterMs` (e.g. ≤ 5 s); do not restart on the next provider when the remaining budget cannot cover
  the whole script; synthesize parts with 2–3 lanes (per-provider rate limits allowing).
- **Effort:** S
- **Confidence:** high (code); not reachable in prod until TTS keys are set.

### EXT-11 — `cost_json` misses the most expensive paths (images, grounding, slides, translation, resume, all request-path calls, failed/abandoned attempts)
- **Severity:** P3
- **Location:** `lib/generation/index.ts:508-535` (slide/pro-slide/image return without `cost`), `:576-578` (translation), `:590-605` (resume), `lib/generation/llm.ts:158-192,500-520` (`llmComplete`/`llmGrounded`/`llmStream` return text only, no usage), `lib/generation/llm.ts:649-650` (`candidatesTokenCount` only — Gemini `thoughtsTokenCount` is billed as output but ignored), `lib/generation/llm-pricing.ts:88-92` (unknown model → $0), `lib/server/worker.ts:240-244`, `lib/generation/llm/chain.ts:81-88` (failed attempts not metered), polish/rewrite/outline/udk routes (never write usage anywhere)
- **Evidence:** only the `writeWithLlm` family, infographic and audio produce `BuiltFile.cost`. Pro-slide — the priciest
  product — makes up to ~21 Gemini image calls ($0.034 each per `.env.example:106`) plus deck text plus optional grounding
  ($14/1 000 after 5 000/month, `slide-research.ts:55-56`) and records nothing; the image tool (up to 4 × $0.034),
  translation (≈ 60 batches for 200 k chars) and resume record nothing; request-path LLM spend (EXT-02) has no sink at all;
  usage of retries, timeouts and `bomb`-abandoned calls (EXT-03) is lost. The owner plans per-tool price/cost decisions on
  this telemetry (`scripts/cost-report.mts`), so margins of the most expensive tools would be computed from zero cost.
- **Reproduction:** after any `pro-slide` job: `SELECT cost_json FROM generations WHERE tool_id='pro-slide' ORDER BY created_at DESC LIMIT 5;` → `NULL`.
- **Proposed fix:** make `llm.ts` return usage (route the legacy calls through `runLlmRaw`), add image/grounding/TTS items to
  `CostMeter` (per-call fixed price), attach `cost` in the slide/image/translation/resume branches of `buildArtifact`,
  meter usage in the chain for failed attempts that returned usage, and write request-path usage to a small `llm_usage`
  table keyed by user/generation.
- **Effort:** M
- **Confidence:** high

### EXT-12 — Raw provider error text reaches end users (doc JSON, `generations.error`, transaction notes) and logs unredacted
- **Severity:** P3
- **Location:** `lib/generation/slide-images.ts:376,398` (`blockReason = res.detail` → `doc.slideImages.blockReason`, `types.ts:463`) + `lib/server/jobs.ts:229` (`doc` returned by `GET /api/generations/[id]`), `lib/generation/image-provider-gemini.ts:218` (`${status} ${errorDetail(body)}`), `lib/generation/tts/{azure.ts:190,aisha.ts:135,gemini.ts:106}` (≤ 200 chars of provider body in the error message) → `tts/chain.ts:188` → `lib/server/worker.ts:297-302` (`failJob(message)`, `refund(…, \`Xatolik: ${message}\`)`) → `components/files/ResultView.tsx:420` and `lib/server/credits.ts:355-369` (`note` returned by `/api/users/me`), `lib/generation/llm/chain.ts:81` (raw provider message logged)
- **Evidence:** provider error strings are stored and served verbatim. They leak internal state (billing/quota/account
  status, region, voice config) to ordinary users, and Google's error for a suspended key has the form
  "Permission denied: Consumer 'api_key:AIza…' has been suspended" — that full key string would be written to logs and,
  for the image path, into the user's `doc_json`. (Checked: no code path puts a request URL — where the OpenAlex/Books/Pixabay
  keys live as query params — into an error or log line.)
- **Reproduction:** stub the Gemini image endpoint to return `403 {"error":{"message":"Permission denied: Consumer 'api_key:AIzaTEST' has been suspended."}}`; run a pro-slide job → `GET /api/generations/<id>` body contains `"blockReason":"403 Permission denied: Consumer 'api_key:AIzaTEST'…"`.
- **Proposed fix:** store only the failure *reason code* (`blocked|rate|timeout|failed`) in `doc_json`, `generations.error`
  and refund notes (map to fixed Uzbek messages); keep raw details in server logs only after a redaction pass
  (`/AIza[0-9A-Za-z_-]{35}/`, `sk-ant-[\w-]+`, `sk-or-[\w-]+`, `xai-[\w-]+`, bot-token pattern).
- **Effort:** S
- **Confidence:** medium — the data flow is certain; the exact Google message format for suspended keys should be confirmed.

### EXT-13 — Retry hygiene: no jitter, Gemini `RetryInfo` ignored, 429-on-quota retried immediately, wasted 2 s sleep after the last attempt
- **Severity:** P3
- **Location:** `lib/generation/llm.ts:120-135` (sleep after the final attempt at :132), `lib/generation/llm.ts:264-271,625-637` (Gemini 429 body not parsed), `lib/generation/llm/chain.ts:88`, `lib/generation/research/http.ts:72`, `lib/generation/tts/chain.ts:235`
- **Evidence:** all four retry loops use fixed exponential delays without jitter, so parallel lanes (mapPool 3–5 per job ×
  2 jobs) retry in lock-step after a shared 429. Gemini reports the wait in the JSON body (`error.details[]`
  `google.rpc.RetryInfo.retryDelay`, e.g. "34s"), not in a `Retry-After` header, so a per-minute quota 429 is retried after
  0.5 s and 1 s — guaranteed to fail again, adding load exactly when the quota is saturated. `withRetry` runs
  `await sleep(500 * 2 ** attempt)` also after the third failed attempt, adding 2 s of dead time to every exhausted call.
  Research retries a daily-quota 429 twice (EXT-07).
- **Reproduction:** unit test: stub `fetch` → 429 three times; `await llmComplete(…, {timeoutMs: 40_000})` takes ≈ 3.5 s, of which the last 2 s happen after the final response.
- **Proposed fix:** `delay = base * 2 ** n * (0.5 + Math.random())`; parse `RetryInfo.retryDelay` in `rawGemini`/`completeGemini`
  and give up immediately if it exceeds the remaining budget; skip the sleep when `attempt === last`.
- **Effort:** S
- **Confidence:** high (code); medium for the Gemini 429 body/header format.

### EXT-14 — Telegram webhook secret is the same `CRON_SECRET` used as the `/api/health` bearer; that secret is equivalent to "log in as any user"
- **Severity:** P3
- **Location:** `app/api/telegram/webhook/route.ts:33-34`, `app/api/health/route.ts:22-25`, `lib/server/telegram.ts:337-389` (`handleUpdate` trusts `msg.from.id` and replies to `msg.chat.id`)
- **Evidence:** the secret-token check itself is correct (header compared with `safeEqual`, 503 when unset). But anyone who
  knows the value can post a forged update `{"message":{"from":{"id":<victim tg id>},"chat":{"id":<attacker chat>},"text":"/login"}}`:
  `createBotLoginLink` mints a login link for the victim's account and `sendLoginLink` delivers it to the attacker's chat
  → account takeover of any Telegram user. The same value is also sent as `Authorization: Bearer` to `/api/health` by
  whatever monitors the service, which widens its exposure (monitoring configs, shell history, proxy logs).
- **Reproduction:** with the secret: `curl -X POST $APP/api/telegram/webhook -H "X-Telegram-Bot-Api-Secret-Token: $CRON_SECRET" -H 'Content-Type: application/json' -d '{"update_id":99,"message":{"chat":{"id":<attacker>},"from":{"id":<victim>},"text":"/login"}}'` → the attacker's Telegram chat receives a one-time login link for the victim.
- **Proposed fix:** a dedicated `TELEGRAM_WEBHOOK_SECRET` used nowhere else (re-run `setWebhook` with it); restrict
  `location /api/telegram/webhook` in nginx to Telegram's published ranges (149.154.160.0/20, 91.108.4.0/22).
- **Effort:** S
- **Confidence:** high (requires the secret to leak first, hence P3)

### EXT-15 — Outbound URL hardening: provider-supplied URLs fetched without host checks; redirects not re-validated; unbounded HTML body
- **Severity:** P3
- **Location:** `lib/generation/slide-images.ts:152-158` (`https:` checked only for the first URL, then `redirect: "follow"`), `lib/generation/tts/aisha.ts:65-78,174` (any `http(s)` URL from the Aisha JSON is fetched), `lib/generation/slide-research.ts:155-167` (`s.uri.includes(REDIRECT_HOST)` substring test before `fetch(s.uri)`), `lib/generation/research/lexuz.ts:292` + `research/http.ts:106-107` (`res.text()` of a lex.uz page with no size cap)
- **Evidence:** all of these URLs come from providers (Pexels/Pixabay JSON, Aisha JSON, Gemini grounding metadata), not
  from users, so there is no reachable SSRF today; but a compromised/misbehaving provider response or redirect can make the
  worker fetch `http://169.254.169.254/…` or other internal hosts (the https-only guard does not apply after a redirect, the
  grounding check is a substring match, Aisha accepts plain `http`). lex.uz law pages can be several MB and are read fully
  into memory and regex-scanned (3 in parallel per job).
- **Reproduction:** unit: undici `MockAgent` via `setGlobalDispatcher` intercepts `https://images.pexels.com/x` and answers `302 Location: http://127.0.0.1:<port>/probe` (allow net connect to 127.0.0.1); a local HTTP listener on `<port>` receives the request issued by `fetchImageBytes("https://images.pexels.com/x")`.
- **Proposed fix:** `redirect: "manual"` + re-validate `Location` (https, public host allow-list per provider:
  `images.pexels.com`, `pixabay.com`/`cdn.pixabay.com`, Aisha's host); compare `new URL(uri).hostname === REDIRECT_HOST`;
  read lex.uz bodies through a size-capped reader (e.g. 2 MB) before `stripTags`.
- **Effort:** S
- **Confidence:** high (code); exploitation requires a hostile provider response.

## Checked and OK

**Verified outbound-call inventory** (replaces the scout's table; the scout's "4 research calls without timeout" is wrong — all research calls go through `research/http.ts` with a timeout):

| # | Call site | Provider | Timeout | Retry | Budget-aware |
|---|---|---|---|---|---|
| 1 | `lib/generation/llm.ts:255` `completeGemini` | Gemini generateContent | `opts.timeoutMs ?? 40 s`, AbortController covers body | `withRetry` 3 tries, 0.5/1 s | yes (elapsed tracked) |
| 2 | `llm.ts:398` `streamGemini` | Gemini SSE | `AbortSignal.timeout` | `withRetry`; 4xx → non-stream fallback | yes |
| 3 | `llm.ts:533` `completeXai` | xAI (only when no Gemini key) | 25 s default | `withRetry` | yes |
| 4 | `llm.ts:618/675` `rawGemini`/`rawXai` (role chain) | Gemini / xAI | per attempt | chain 3/spec | no — EXT-03 |
| 5 | `llm/anthropic.ts:94-109` | Anthropic SDK 0.125 | `timeout: timeoutMs` per request | SDK 1 + chain 3 | no — EXT-03 |
| 6 | `llm/openrouter.ts:33`, `llm/openai.ts:33` | OpenRouter / OpenAI (OpenAI key not bought → skipped) | per attempt | chain 3 | no — EXT-03 |
| 7 | `image-provider-gemini.ts:185` | Gemini interactions (image) | `min(remaining, 120 s)` | none | yes, except image tool (`image-studio.ts:219`) |
| 8 | `image-provider-pexels.ts:58`, `image-provider-pixabay.ts:58` | Pexels / Pixabay | `requestBudget` ≤ 45 s (`image-provider.ts:142`) | none | yes (quota: EXT-06) |
| 9 | `image-provider-fal.ts:79` | fal.ai | budget | none | dead path — only meta-less `attachSlideImages` (scripts) reach it |
| 10 | `slide-images.ts:158` `fetchImageBytes` | stock CDN / `data:` | 20 s, 12 MB cap, PNG/JPEG sniff | none | fixed 20 s (redirects: EXT-15) |
| 11 | `slide-research.ts:167` | Google grounding redirect (HEAD) | 3 s shared, skipped if < 3 s left | none | yes |
| 12 | `research/http.ts:74` (`getJson`/`getText`) | OpenAlex, Crossref, Google Books, lex.uz | 10 s default, lex.uz 8 s, pipeline ≤ 15 s | 2 retries (lex.uz 1), timeouts not retried | per call only (EXT-03/07) |
| 13 | `tts/azure.ts:168`, `tts/aisha.ts:123,174`, `tts/gemini.ts:87` | Azure / Aisha / Gemini TTS | 30 s `AbortSignal.timeout` | 2 per part | per part only (EXT-10) |
| 14 | `lib/server/telegram.ts:31` | Telegram Bot API | 15 s | none (EXT-05) | n/a |
| 15 | `scripts/bot.mts:46,63` | Telegram (dev long-poll) | 40 s getUpdates | loop | dev only (EXT-05 footgun) |
| 16 | `scripts/fetch-professions.mts:80` | ESCO / hh.ru | 25 s | 5 | offline data script, not runtime |

- No API key is placed in a URL for Gemini (`x-goog-api-key` header), Anthropic (SDK), OpenRouter/xAI/OpenAI (Bearer), Azure/Aisha (headers). OpenAlex `api_key`, Google Books `key` and Pixabay `key` are query params, but no log/error string contains the URL (`research/http.ts:85,90` → `HTTP <status>` / `e.message`; `image-provider-pixabay.ts:61-63` logs status only). The bot token is in the Telegram URL path, but `telegram.ts:39,44` log only `description` / `e.message`.
- No provider key reaches the client bundle (only `NEXT_PUBLIC_BRAND_*`, `NEXT_PUBLIC_TELEGRAM_BOT` are public); no boot-time provider calls in `instrumentation.ts`/`scripts/worker.ts`; the enqueue route and `/api/health` make no provider calls.
- Output bounds on every call: Gemini `maxOutputTokens = max(maxTokens, 4096)` (`llm.ts:235`), Anthropic `max(maxTokens, 4096)` (`anthropic.ts:104`), OpenAI-compatible `max_tokens` (`openrouter.ts:45`, `openai.ts:40`, `llm.ts:543,682`); callers pass ≤ 9 000.
- Input bounds: `sanitizeValues` 80 keys × 4 000 chars, JSON fields 24 000, `userGlossary` 8 000, `sourceText` 200 000 (fully used and priced only by translation); uploaded-source text sliced to 24 000 chars (`article/engine.ts:864`, `work/types.ts:167`, `teacher/types.ts:403`, audio/games 24 000; essay prompt 12 000); research shortlist ≤ 60 candidates (`research/pipeline.ts:90`); lex.uz ≤ 6 documents.
- Worst-case logical LLM calls per job are bounded by count caps and gated by `remainingMs` checks (e.g. coursework ≤ 24 paragraphs × ≤ 3 calls + outline/intro/conclusion/research/judge + ≤ 6 polish fixes ≈ 90); images bounded by slide count (pro ≤ 30 slides), image tool ≤ 4, TTS ≤ 12 000 chars per job. `json.ts` "8 attempts" (scout) is a local JSON-repair loop — no extra LLM calls; `research/verify.ts` makes no network calls.
- Failure → money: a throwing build → `failJob` + full `refund` (`worker.ts:296-303`); a dead worker → `reclaimStaleJobs` + refund (`worker.ts:324-334`); shortfalls → `refundPartial`. LLM-empty results are not silently shipped as template text (`index.ts` "Matn yozilmadi" / slide "Taqdimot matni yozilmadi" throw → refund).
- Telegram webhook: `x-telegram-bot-api-secret-token` compared with `safeEqual` (timing-safe, only length leaks), 503 when `CRON_SECRET` is unset, 401 before the body is parsed; `update_id` de-dup table purged daily (`telegram.ts:208-232`).
- Click: signature string matches Click's spec (`merchant_prepare_id` only for Complete), lowercase + `safeEqual`; `service_id`, amount and order state checked before any write; a replayed valid Complete cannot double-credit (`transactions` unique `(kind, reference)`, `reference = click:<click_trans_id|order id>`). `sign_time` freshness is not checked, but replays are idempotent → acceptable.
- Payme: Basic header parsed strictly (base64 regex, login `Paycom`), constant-time compare of SHA-256 digests; `PerformTransaction` idempotent via `payme:<txn>` reference (test-key issue aside, EXT-01).
- AI slide-image regeneration was removed from the request path (`lib/server/slide-image.ts:22-23`); `/api/outline` uses the budget-aware legacy path with a 45 s window (fits nginx's default 60 s).
- lex.uz candidate URLs are rebuilt as `https://lex.uz/docs/<digits>` from a strict regex (`research/lexuz.ts:104-110,132`) — no model-controlled host; grounding redirect resolution only targets Google-issued URIs (hardening note in EXT-15).
- Research cache never stores `null` (transient failures don't stick for 30 days); Anthropic `enforced_spend_limit_reached` 429 is non-retryable and skips to the next spec (`anthropic.ts:47-49,72-73`); Gemini-image 401/402/403 short-circuits the rest of the deck (`slide-images.ts:350-353`); stock-provider `blocked` is sticky per deck (`image-provider.ts:206-212`).
