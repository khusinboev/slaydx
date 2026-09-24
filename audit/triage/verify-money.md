# Reviewer R1 — money, abuse, pricing, uploads — verification

Reviewer: R1 (independent). Scope: EXT-01, EXT-02 + ABUSE-01, BEA-01 + ABUSE-03, DB-02.
Method: code re-read only (no heavy commands, no provider calls, no `.env*` opened). Line numbers re-read on 2026-09-23.

<!-- verdict blocks appended below as each is finished -->

### EXT-01 — Payme webhook accepts the sandbox TEST key in production
- **Verdict:** CONFIRMED. The code path is certain. Whether it can be exploited depends on prod config, which the owner must check.
- **Final severity:** P1. It is a conditional P0: it becomes P0 once the owner confirms `PAYME_TEST_KEY` is non-empty in the prod `web` container **and** Payme's test checkout (`checkout.test.paycom.uz`) sends to the cashbox's single endpoint URL. Then any logged-in user can mint up to 10 000 000 coins per order (`MAX_TOPUP_SOUM`) with a public test card. If the key is empty, this is P3 hardening.
- **Evidence:**
  - `app/api/payments/payme/route.ts:75`: `paymeAuthorized(req.headers.get("authorization"), [env.payme.key, env.payme.testKey])`. Both keys are passed unconditionally.
  - `lib/server/payments.ts:77,105`: `keys.filter(Boolean)` … `valid.some((k) => safeEqual(hash(k), hash(password)))`. The comment at :72 says "Test va prod kalitlari alohida — ikkalasi ham qabul qilinadi" (the two keys are separate; both are accepted).
  - `tests/payments.test.mts:201-202` locks this in as intended behaviour: "Test kaliti ham qabul qilinadi — sandbox shu bilan ishlaydi" (the test key is also accepted; the sandbox works with it).
  - **No environment gate exists.** `lib/server/env.ts:192` is `testKey: str("PAYME_TEST_KEY")`, with no `isProd`/test-mode flag. `assertRuntimeConfig` (env.ts:235-259) has no Payme check. `paymentsConfigured()` (env.ts:227) reports Payme as enabled with only the test key.
  - `docker-compose.yml:84` forwards `PAYME_TEST_KEY` to the prod `web` service. `.env.example:144` lists it beside the live key.
  - A sandbox-signed `PerformTransaction` goes to `settleOrder` → `topUp(balance)` (payments.ts:276-296).
  - The attacker can build the test-checkout link: `app/api/payments/orders/route.ts:66-72` hands every user `checkout.paycom.uz/<base64 "m=<merchant>;ac.order_id=…;a=…">`, and swapping the host gives the test checkout.
  - The key itself is a real secret (`security-secrets-deps.md:115`: never committed). So without the test-checkout routing there is no external path.
- **Owner must check (no code needed):**
  1. On the box, without printing the value: `cd /opt/slaydx && docker compose exec -T web sh -c 'test -n "$PAYME_TEST_KEY" && echo SET || echo EMPTY'`.
  2. In business.paycom.uz, check whether the cashbox has one endpoint URL shared by test and live. Or empirically: pay a staging order through `checkout.test.paycom.uz` with a test card and see whether the request reaches the configured URL.
  3. If step 1 prints SET, remove the key from `/opt/slaydx/.env` and `docker compose up -d web` now. This is a zero-code mitigation.
  4. `SELECT count(*) FROM payment_orders WHERE provider='payme' AND state='paid'` and compare with the Payme cabinet's real paid transactions. Any extra rows were sandbox payments that were credited.
- **Duplicates / related:** none share this root cause. Related payment findings:
  - BEA-05: protocol state machine, including item 6, no `order.provider` check.
  - DB-09 / CONC-02: settle/cancel are not serialized.
  - TEST-01: no tests for the order state machine.
  - OBS-09: raw webhooks are not logged, so past sandbox credits cannot be told apart.
- **Fix scope:**
  - `app/api/payments/payme/route.ts`: pass the test key only in test mode.
  - `lib/server/payments.ts`: add a pure helper `acceptedPaymeKeys({key, testKey, testMode})`.
  - `lib/server/env.ts` (**SHARED**): add `payme.testMode = bool("PAYME_TEST_MODE", false)`. Make `paymentsConfigured().payme` require `key`. Add a `runtimeWarnings` entry when prod runs in test mode.
  - `docker-compose.yml` (**SHARED**): drop `PAYME_TEST_KEY`, or forward `PAYME_TEST_MODE` next to it.
  - `.env.example`: document the new variable.
  - `tests/payments.test.mts`: rewrite the assertion at :201-202.
- **Fix notes:** The auditor's fix is correct. The simpler alternative is to drop `PAYME_TEST_KEY` entirely: during sandbox acceptance on staging, set `PAYME_KEY` to the test key. That leaves one key at a time, the usual Payme-library pattern. **OWNER DECISION** needed on where sandbox acceptance runs (staging, or a time-boxed test mode in prod). A hard boot failure in prod with test mode on would block the "sandbox against prod URL" workflow the code was built for, so choose that consciously.
- **Regression test:** `tests/payments.test.mts` (pure, no Postgres). Assert `paymeAuthorized(basic("Paycom", TEST), acceptedPaymeKeys({key: LIVE, testKey: TEST, testMode: false})) === false` and `=== true` with `testMode: true`. The live key must be accepted in both modes. Today the existing test asserts the opposite (TEST accepted with `[LIVE, TEST]`). Mutation check: pass `testKey` unconditionally again, and the new assertion must fail.

### EXT-02 + ABUSE-01 — Free request-path LLM endpoints with no daily cap, no spend guard, no kill switch
- **Verdict:** CONFIRMED-UPGRADE for the cluster. The rewrite path is what makes it P0; outline/udk on their own (ABUSE-01) are correctly P1.
- **Final severity:** P0. Money loss is reachable by an ordinary free user.
  - Precondition: one Telegram login (free; `SIGNUP_BONUS_POINTS = 3000`, `lib/server/auth.ts:15,125-135`) plus spending 2 000 of those bonus points on a flashcards/crossword set (`lib/tools.ts:757,788`). Points are spent first (`credits.ts:28-36`).
  - After that, `POST …/rewrite` is a general text generator. The client picks the instruction (≤ 600 chars). One free account costs about $50–100/day, and N accounts cost N× that. No global ceiling exists except the Gemini project quota. When that quota runs out, every paid generation fails and is refunded, which is itself an outage.
  - There is a real motive beyond griefing: free content. The rewritten section can be read back from `doc_json`.
- **Evidence (every request-path provider call; grep of `app/api` + `lib/server` imports):** No other route reaches an LLM or image provider. `slides/[index]/image` and `[id]/photo` are user uploads (`lib/server/slide-image.ts` imports no provider). No "AI image regenerate" endpoint exists. `extract`, `curriculum` and `rebuild` make no provider calls.

  | endpoint | limit (fixed window, `ratelimit.ts:21-50`) | needs | calls / caps | worst $/call* | $/day/account |
  |---|---|---|---|---|---|
  | `POST /api/outline` (`app/api/outline/route.ts:27,42`) | `outline:${uid}` 12/600 s → 1 728/day | login only, zero balance OK | `draftOutline` → `rawOutline` 1–2 Gemini calls (`write-llm.ts:278-286`); attacker-controlled `extra` ≤ 4 000 chars goes into the prompt; maxOutputTokens floored at 4 096 (`llm.ts:235`) | ≈ $0.005 typical, ≈ $0.018 long output, ≤ $0.036 with retry | ≈ $9 typical, ≈ $31 long, ≤ $60 |
  | `POST /api/article/udk` (`app/api/article/udk/route.ts:19,27`) | 30/3 600 s → 720/day | login only | 1 `fast` call, `maxTokens: 200` but the Gemini adapter floor is 4 096 (`llm/gemini.ts:19` → `runLlmRaw`); topic ≤ 300 chars | ≈ $0.001, ≤ $0.016 | ≈ $0.7, ≤ $11 |
  | `POST /api/generations/[id]/rewrite` (`route.ts:31`) | 20/600 s → 2 880/day | COMPLETED own article / teacher (test 3 000) / crossword or flashcards (2 000), all bonus-affordable (`doc-polish.ts:332-351`) | 1 `writer` call, 30 s timeout (`report/polish-core.ts:33`). maxTokens: article `min(8000, words×2.4+700)` (`article/polish.ts:418`), teacher section `min(8000, max(1500, chars))` (`teacher/polish.ts:369`), cards `min(8000, 900+n×170)` (`flashcards/polish.ts:264`), all floored at 4 096. The instruction is client-chosen (`article-rewrite.ts:76-84`); parallel requests are billed even when they later lose the version race with 409 | ≈ $0.018 (cards) to ≈ $0.035 (long article section, capped by the 30 s timeout) | **≈ $52 (bonus-only) to ≈ $100** |
  | `POST /api/generations/[id]/polish` (`route.ts:30-31`) | 20/day/user **and 3/day/doc** | COMPLETED doc with a review and planned items (`doc-polish.ts:414-418`) | ≤ 6 writer calls + 1 judge (Claude Sonnet 5 in prod per AUDIT-17) | ≈ $0.05–0.25 | ≤ $0.75 bonus-only (1 doc), ≤ $5 |

  \*Rates are gemini-3.7-flash at $0.75/$3.75 per M tokens (`llm-pricing.ts:33`); the default model is `llm.ts:20`. The price doubles on 2027-01-01 (`llm-pricing.ts:34`).
  - **One free account, sustained:** about $60–110/day (rewrite dominates), about $2–3 k/month.
  - **1 000 accounts:** about $60–110 k/day in theory. In practice the Gemini project TPM/RPM quota caps it first: roughly 200 rewrite RPM and millions of output tokens/min. At that point production goes down for everyone, and the attacker's cost is still zero.
  - The only brake is per-user fixed windows. That brake **fails open** on DB error (`ratelimit.ts:45-48`).
  - `grep` finds no USD/day budget, no per-user token budget, no global circuit, and no kill switch. The only switch is `LLM_STREAM=false` (`llm.ts:495`), which only disables streaming. The only provider-side ceiling would be an owner-configured Anthropic org spend limit (`llm/anthropic.ts:47`) or a Google billing cap. **The owner should confirm whether those caps exist.**
  - Request-path calls write no `cost_json`, so the spend shows up only on the invoice (EXT-11).
- **Duplicates / related:** EXT-02 = ABUSE-01 (same root: free LLM routes bounded only by per-user windows). Related:
  - ABUSE-02: the bonus × free accounts multiplier.
  - EXT-11: request-path spend is invisible.
  - BEA-11: buckets are consumed before validation.
  - ABUSE-05: IP buckets on Telegram login gate account creation.
  - EXT-04 / EXT-09: no circuit breaker, so quota exhaustion becomes an outage.
- **Fix scope (minimal, no migration):**
  - `app/api/outline/route.ts`, `app/api/article/udk/route.ts`, `app/api/generations/[id]/rewrite/route.ts`, `app/api/generations/[id]/polish/route.ts`: add one shared daily bucket, e.g. `limit(\`free-llm:${uid}\`, 60, 86_400)`, consumed alongside the existing window. Lower rewrite to about 5/600 s.
  - New `lib/server/free-llm.ts`: a helper holding the caps and the kill switch.
  - `lib/server/env.ts` (**SHARED**): `FREE_LLM_ENABLED` kill switch.
  - `docker-compose.yml` (**SHARED**) and `.env.example`: forward and document it.
  - `lib/server/ratelimit.ts`: fail **closed** for `free-llm:*` buckets.
  - Global USD guard (second step): a new migration (**SHARED**, `lib/server/migrations/`) for an `llm_spend(day, usd)` row, updated from `llm-roles.complete` and `llm.ts runLlm`. `lib/generation/llm*.ts` is isomorphic (no server import), so this needs an injected hook, not a direct DB call.
- **Fix notes:** The auditors' fixes are right in direction. The global guard is M effort because of the isomorphic `llm.ts` boundary, so ship the per-user daily cap and the env kill switch first (S). ABUSE-01's "gate on `walletTotal > 0`" does not help: the bonus makes every account non-zero. A cap below the provider quota also stops the outage path. **OWNER DECISION:**
  1. The daily free-edit allowance (the "tahrir bepul" — edits are free — rule is a product decision, `article-rewrite.ts:48`).
  2. Whether rewrite should cost coins after N per doc.
  3. The `LLM_DAILY_MAX_USD` figure.
  4. Whether to make the signup bonus unusable for rewrite-unlocking tools.
- **Regression test:** `tests/free-llm.test.mts`.
  - Pure part: `consumeFreeLlm(uid, {limiter})` with a stub limiter must throw `ApiError` 429 on call 61 within a day, and must throw 503 when `FREE_LLM_ENABLED=false`.
  - Static probe, same style as `tests/compose-env.test.mts`: each of the 4 route files must call `consumeFreeLlm`.
  - Needs-Postgres variant: 61 real `rateLimit` hits → `ok:false`.
  - Today all of this fails: the helper does not exist, and the routes have no daily bucket.
  - Mutation: remove the call from `rewrite/route.ts`, and the probe must fail.

### BEA-01 + ABUSE-03 — `priceFor` reads raw package strings; the engines trim, clamp or default differently
- **Verdict:** CONFIRMED-DOWNGRADE. The mechanism is exactly as filed. BEA-01's P1 is too high: the gain per request is bounded (≤ 12 000 coins) and the output is generated normally.
- **Final severity:** P2. It is a real underpayment reachable by any logged-in user with DevTools or curl (the form always sends a valid tier). The loss per job is at most the tier difference, the attacker still pays ≥ 50 % of list, and the COGS of every underpaid tier stays below the price paid (article COGS ≈ 4 000 soum on 12 000, `tools.ts:106-110`). So it is revenue leakage, not provider-money loss without bound. The under-budget case only wastes about 6 min of a worker slot plus one failed LLM run, and then refunds.
- **Evidence (re-read):**
  - `lib/server/validate.ts:84-87`: `sanitizeValues` does **not** trim strings. Only NUL is stripped and the length sliced.
  - `lib/tools.ts:1409-1439,1460-1463`: `priceFor` looks up the raw `String(values.pages ?? defaultPages(id))` / `String(values.termCount ?? "10")` in an exact map, with `?? 3000` / `?? tool.basePrice` / `?? 2000` fallbacks.
  - Engines normalise differently:
    - `work/registry.ts:383-386` `normalizeWorkPages`: `.trim()`, and an unknown or missing value becomes **"20-25"**. The work engine overrides meta with it (`work/engine.ts:302-313`, `pagesLabel: input.pages`).
    - `essay/input.ts:76-82` `pagesOf`: trim, `Number`, `Math.round`, clamp 1..5.
    - `teacher/input.ts:103-106,213-215` `num`: any integer, clamped to the type minimum..40.
  - Budget: `budget.ts:357-370` uses `extractMeta().targetPages`. `meta.ts:36-40` `s()` **trims**, and it defaults to `defaultPages` = "10-15" for referat/mustaqil-ish (`tools.ts:1377-1383`). Glossary budget `teacherSize` = `min(40, Number(termCount))` (`budget.ts:182`).
  - No gate rejects these values: `app/api/generations/route.ts:94-103` runs only `missingRequired` and `preflightError`.
- **Concrete combos** (1 coin = 1 soum; the budget column says whether the job survives):

  | tool | value sent | charged | engine makes (list price) | underpay | budget vs engine |
  |---|---|---|---|---|---|
  | coursework | `"40-45 "` / `"\t40-45"` | 12 000 | 40-45 pp (24 000) | **12 000 (50 %)** | trims → 43 pp, 627 s = matches, **completes** |
  | coursework | `"zzz"`, or number `43` | 12 000 | 20-25 pp (16 000) | 4 000 | 23 pp / 43 pp, ≥ engine, completes |
  | referat / mustaqil-ish | `"25-30 "` | 3 000 | 25-30 pp (6 000) | 3 000 (50 %) | 28 pp, 492 s, matches, completes |
  | referat / mustaqil-ish | `pages` **omitted** or `"zzz"` | 3 000 | **20-25 pp** (5 000) | 2 000 | budget 13 pp = 150+90+13×9 = **357 s** (deadline 342 s, `worker.ts:137-139`) vs 447 s needed for 20-25 pp → **either completes underpaid or fails the volume gate (`index.ts:78`, gate uses the engine's 20-25 meta) and refunds in full**. Which one needs a runtime check |
  | essay | `"5 "`, `"4.6"`, `"99"` | 2 000 | 5 pages (4 000) | 2 000 (50 %) | 135 s / 660 s ≥ engine, completes |
  | glossary | `"39"`, `"40 "` | 6 000 | 39–40 terms (15 000 tier) | **up to 9 000 (60 %)** | `min(40, n)` matches, completes |
  | image (same class, minor) | `imageCount: 3` (form offers 1/2/4) | 3 500 | 3 images | ≈ 430 soum COGS extra | fine |

  Not affected: article/thesis (`priceFor` calls `normalizeArticlePages`, `tools.ts:1448-1453`) and slide/pro-slide (the same `clampInt` in price and meta).
- **Duplicates / related:** BEA-01 = ABUSE-03 (one root: price and engine read the field through different normalisers). Related: the AUDIT-5 P1-7 history (`tools.ts:1359-1375` fixed the same seam for article/essay defaults). ABUSE-02 (the bonus pays for cheap tiers).
- **Fix scope:**
  - `lib/tools.ts`: `priceFor` (and `defaultPages` for referat/mustaqil-ish; or leave `defaultPages` and make the engine default match) must call the same normalisers: `normalizeWorkPages(workKindOf(genre, values.workKind ?? values.kind), values.pages)`, essay `pagesOf` (export it), and the glossary `num` clamp mapped to the next tier (≤ 10 → 10, ≤ 20 → 20, else 40).
  - `lib/generation/essay/input.ts`: export `pagesOf`.
  - `lib/generation/teacher/input.ts`: export a `glossaryTermCount(values)` helper.
  - `lib/generation/budget.ts`: work tools should size from `normalizeWorkPages` instead of `extractMeta`.
  - `lib/generation/work/registry.ts`: default "20-25" vs form "10-15". **OWNER DECISION** on which default is canonical; the form uses `normalizeWorkPages(kind, defaultPages(id))` = "10-15" (`WorkComposer.tsx:195`).
  - Optionally `preflightError` in `lib/tools.ts` → 400 for off-tier values.
  - Import-cycle check needed: `lib/tools.ts` already imports article normalisers, and `work/registry` must not import `tools.ts`.
  - No SHARED files touched.
- **Fix notes:** The auditors' fix is correct. The more robust variant is to **reject** values that are not in the tier list in `preflightError` (400). Then no fallback is ever billed, and any future engine clamp change cannot reopen the seam. Price-via-normaliser alone still leaves glossary 39 vs a 40 tier ambiguous. Keep the normaliser for number and string equivalence (`43`/`"40-45"`).
- **Regression test:** extend `tests/pricing.test.mts` (pure). Iterate the table above: `priceFor(tool, {pages:v})` must equal `priceFor(tool, {pages: <tier the engine picks>})`, where the engine tier comes from calling the engine normaliser (`normalizeWorkPages` / `pagesOf` / glossary clamp). Also assert that `budgetFor(referat, {})` ≥ `workBudgetMs(pagesMid(normalizeWorkPages(kind, undefined)))`. Today this fails: coursework `"40-45 "` → 12 000 vs 24 000; referat `{}` budget 357 000 < 447 000. Mutation: drop the `.trim()`-equivalent normalisation in `priceFor`, and the test must go red.

### DB-02 — Upload tables have no per-user quota (≈ 5.5 GB/hour per free account; logos and templates kept forever)
- **Verdict:** CONFIRMED. The auditor's per-hour figure holds once the photo "original" copy is counted. The orchestrator's ≈ 4.6 GB/h left that copy out.
- **Final severity:** P1.
  - Precondition: one free Telegram account and an upload script. The four upload routes have no plan or balance check.
  - Effect: about 5.5 GB/h per account. The shared VPS disk fills in hours with around 10 accounts, and in about a day with one. Postgres then stops accepting writes and the two co-hosted projects are hit too.
  - Kept at P1, not P0: it is pure griefing with no attacker gain, needs hours of sustained upload, and is recoverable without data loss (delete rows, then `VACUUM`). On the letter of §4 ("total outage reachable by an ordinary user") the owner may choose to treat it as P0.
- **Evidence — what is actually STORED per accepted upload (re-read):**

  | route (limit, `app/api/uploads/*/route.ts`) | stored row | bytes/upload | max rate | retention |
  |---|---|---|---|---|
  | source `source:${uid}` 20/600 s (`source/route.ts:27`) | the **raw file** `bytes` (≤ 20 MB, `source-upload.ts:44,177-181`) **plus** extracted `text` (≤ 200 000 chars, TOASTed). Must contain `TRANSLATION_MIN_CHARS`..`MAX_CHARS` of text (`:345-350`), so a DOCX with a large media part passes | ≈ 20 MB | **2.4 GB/h** | 30 d (`purgeOldSources`, `:268-271`) |
  | photo `photo:${uid}` 20/300 s (`photo/route.ts:18`) | the **raw crop** (≤ 5 MB, ≤ 1200 px side, `photo.ts:144-151`) **plus** an optional **raw original** (≤ 5 MB, a second row, `:159-163`). No resize or re-encode; each has its own hash PK | ≈ 4.3 MB (1200² noise PNG) + 5 MB ≈ 9 MB | **≈ 2.2 GB/h** | 90 d (`purgeOldPhotos`, `:179-181`) |
  | template `template:${uid}` 5/600 s (`template/route.ts:20`) | the **raw PPTX** (≤ 20 MB, `template-upload.ts:136-139`) plus `previews` JSONB holding base64 72-dpi PNGs, one per layout page (`:79-110`, `RASTER_DPI = 72`, ≈ 0.1–0.3 MB each ×1.33 base64) | ≈ 20–21 MB | 0.6 GB/h | **never** |
  | logo `logo:${uid}` 10/300 s (`logo/route.ts:18`) | the **raw PNG/JPEG** (≤ 2 MB, `logo.ts:17,34-37`) | 2 MB | 0.24 GB/h | **never** |
  | slide image / resume photo `imgup:${uid}` 30/3 600 s (`generations/[id]/slides/[index]/image`, `[id]/photo`) | raw image into `generation_assets` (≤ 5 MB, `SLIDE_IMAGE_MAX_BYTES`), written **before** the ownership check (BEA-03) | 5 MB | 0.15 GB/h | **never** |

  - **Total ≈ 5.6 GB/h per account**, of which about 1 GB/h is never purged.
  - Every PK is `(user_id, asset_id = sha256(bytes)[:24])`, so changing one byte makes a new row. No code counts rows or bytes per user.
  - The media is already compressed, so TOAST gains nothing.
  - `rateLimit` fails **open** on DB error (`ratelimit.ts:45-48`).
  - Side cost, not DB: every template upload runs LibreOffice plus `pdftoppm` (`template-upload.ts:86-93`), a CPU amplifier in `web`.
- **Duplicates / related:**
  - DB-01 and FILE-01: the same disk-full outcome from generated files kept forever.
  - BEA-03: orphaned asset rows written before the checks, same growth path through `imgup`.
  - EXT-08 / DB-10: `source_cache` is never purged.
  - BEA-19: the photo purge vs drafts.
  - INFRA backups / disk alerting.
- **Fix scope:**
  - New `lib/server/upload-quota.ts`: a per-user byte budget summed across the 4 tables plus `generation_assets` uploads. The existing PK prefix `(user_id, …)` serves the scan, so no index is needed.
  - Call it inside the insert transaction in `putSource` (`source-upload.ts`), `putPhoto` (`photo.ts`, counting the original too), `putTemplate` (`template-upload.ts`) and `putLogo` (`logo.ts`).
  - Also call it in `lib/server/slide-image.ts` and `lib/server/resume-photo-commit.ts`, together with the BEA-03 reorder.
  - Or use keep-newest-K per table (auditor's variant).
  - `lib/server/ratelimit.ts`: fail closed for `photo|logo|template|source|imgup` buckets.
  - `lib/server/worker.ts` housekeeping: purge unused logos and templates. A true "unused for 180 d" rule needs a `last_used_at` column, which means a new migration (**SHARED** `lib/server/migrations/`). Without it, keep-newest-K needs no migration.
- **Fix notes:** The auditor's fix is correct and minimal. Prefer **keep-newest-K + a total-byte cap** (e.g. logos 5, templates 10, photos 10 pairs, sources 20, and 300 MB/user overall). K alone still allows 20 × 20 MB of sources. Do the size check before the expensive work (`count`/rasterize) so an over-quota upload costs no CPU. Use a SQL `SUM(size_bytes)` inside the transaction with `pg_advisory_xact_lock(hashtext(user_id))`, so parallel uploads cannot race past the cap. **OWNER DECISION:** the per-user quota numbers and the template/logo retention policy (users may expect "O'z shablonim" (my own template) to live forever).
- **Regression test:** `tests/upload-quota.test.mts` (**needs Postgres**, `DATABASE_URL`-gated like `credits.test.mts`). Insert K+1 distinct logos for one user through `putLogo`, then assert `count(*) ≤ K`. Push `sum(size_bytes)` over the budget through `putSource` and expect `ApiError` 413. Run two concurrent `putTemplate` calls at the edge and assert only one succeeds. Today all of these fail (unbounded). Pure companion: `rateLimit` with a throwing `queryOne` stub must return `ok:false` for an upload bucket.

## Summary
- Verdicts: CONFIRMED 2 (EXT-01, DB-02) · CONFIRMED-UPGRADE 1 (EXT-02+ABUSE-01 → P0) · CONFIRMED-DOWNGRADE 1 (BEA-01+ABUSE-03 → P2) · REJECTED 0 · UNCERTAIN 0. One sub-question in BEA-01 needs runtime proof: whether an omitted-`pages` referat completes underpaid or fails and refunds.
- Final severities: EXT-02+ABUSE-01 **P0** · EXT-01 **P1 (conditional P0)** · DB-02 **P1** · BEA-01+ABUSE-03 **P2**.
- OWNER CHECK before launch (EXT-01): is `PAYME_TEST_KEY` set in the prod `web` env, and does Payme's test checkout call the same endpoint? If SET, remove it from `.env` now.
- OWNER DECISIONS: the daily free-edit/outline allowance, the global `LLM_DAILY_MAX_USD`, and whether the signup bonus may unlock rewrite (EXT-02). Where Payme sandbox acceptance runs (EXT-01). Upload quotas and template/logo retention (DB-02). The canonical referat default "10-15" vs "20-25" (BEA-01).
- Owner should also confirm whether any provider-side spend cap exists (Anthropic org limit, Google billing cap). Today it is the only ceiling on EXT-02.
