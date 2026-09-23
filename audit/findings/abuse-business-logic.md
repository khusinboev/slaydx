# abuse & business-logic — findings
Scope actually covered: `lib/tools.ts` (`priceFor`, `defaultPages`, `missingRequired`, `preflightError`, `translationChars/Price`), `lib/generation/budget.ts`, `lib/generation/meta.ts`, `lib/generation/delivered.ts`, `lib/generation/slide-params.ts`, `lib/generation/work/{registry,input}.ts`, `lib/generation/essay/{input,registry}.ts`, `lib/generation/teacher/input.ts`, `lib/generation/image-studio.ts`, `lib/server/{credits,jobs,worker,payments,ratelimit,api,env,auth,telegram,session,game-sessions,source-upload,template-upload,photo,logo,storage,admin,admin-phones,validate}.ts`, `app/api/**` (generations, payments, o/[token], auth, uploads, outline, article/udk, admin, health, extract), migrations `001_init`/`012`/`016`/`017`/`021`, `docker-compose.yml`, `.env.example`, `.claude/deploy.md`.
Not covered (other auditors / out of abuse scope): TTS/audio provider internals, slide/article render correctness, viewer edit adapters beyond charge/refund, the LLM chain retry internals, non-money DoS of LibreOffice/sharp (infra scope).
Summary: P0 0 · P1 1 · P2 3 · P3 3

---

### ABUSE-01 — Free `outline`/`udk` LLM endpoints charge no credits and are the cheapest way to burn provider money without bound
- **Severity:** P1
- **Location:** `app/api/outline/route.ts:25-46` (`limit(outline:${user.id}, 12, 600)`, `draftOutline`), `app/api/article/udk/route.ts:63-76` (`limit(udk:${user.id}, 30, 3600)`), `lib/generation/write-llm.ts:344` (`draftOutline` → `buildOutline` = 1–2 real LLM calls up to 45 s each). Neither route references `priceFor`/`chargeInTx`/balance (grep confirmed empty).
- **Evidence:** `outline` allows 12 calls / 600 s = 72/hr = 1 728/day **per account**, each doing 1–2 Gemini-Flash generations (~500 in + ~1200 out tokens). At the project's own pricing (`llm-pricing.ts`: gemini-3.7-flash 0.75/3.75 USD-per-M) one call ≈ $0.006, so a single logged-in, **zero-balance** account can burn ≈ **$11/day of provider money indefinitely** with no revenue; `udk` adds 30/hr. There is no credit debit, no daily cap beyond the fixed window, and the limit is keyed by `user.id` so it resets per account (see ABUSE-02) and per spoofable IP is irrelevant here. The brief explicitly requires "a user with zero balance should not be able to burn provider money without bound" — they can. At 2 000 concurrently active users idly polling `outline`, this is a standing money-loss + a load multiplier on the single shared worker VPS.
- **Reproduction:**
  ```bash
  # authenticated session cookie C; loop the free endpoint
  for i in $(seq 1 12); do
    curl -s -b "$C" -H 'content-type: application/json' \
      -X POST https://HOST/api/outline \
      --data '{"slug":"coursework","values":{"topic":"Yalpi ichki mahsulot"}}' >/dev/null
  done   # 12 real coursework-outline LLM calls, 0 credits charged; repeat every 10 min forever
  ```
- **Proposed fix:** Either debit a small credit amount per `outline`/`udk` call, or add a hard per-account **daily** cap (e.g. `limit(outline:day:${user.id}, 40, 86400)`) in addition to the window, and gate the endpoint on `walletTotal > 0` (require a non-empty balance to use free helpers). Also cap `buildOutline` to a single LLM attempt when the caller has zero balance.
- **Effort:** S
- **Confidence:** high

---

### ABUSE-02 — Signup bonus (3 000 points) × unlimited Telegram accounts = free paid-document farming; no fraud/device/phone controls
- **Severity:** P2
- **Location:** `lib/server/auth.ts:15` (`SIGNUP_BONUS_POINTS = 3000`), `:125-135` (`upsertTelegramUser` grants it to every new `telegram_id`), `:227-239` (`upsertLocalUser`, same bonus — dev only). Points are spent first (`lib/server/credits.ts:28-36` `splitFor`: points→quota→balance).
- **Evidence:** A brand-new Telegram account immediately holds 3 000 spendable points. That exactly covers one **referat** (`priceFor` = 3000), one **slide deck** (3000), one **translation** (3000 base), or an **essay/image/game/infographic** (2000). Each of those runs the real generation pipeline (a referat is ~15–25 Gemini calls ≈ $0.1–0.3 of provider money + ~350 s of the 2-slot worker). Account creation has **no** device fingerprint, no phone/OTP verification (the Telegram widget/initData signature is the only gate — `verifyLoginWidget`/`verifyMiniAppInitData`), no per-account-creation throttle beyond route-level `limit(tg:${ip}, 20, 300)` in `app/api/auth/telegram/route.ts:33` (and that IP key is bypassable per ABUSE-06). Telegram accounts are cheap to farm at scale (virtual numbers), so N accounts = N free paid documents = direct provider-money loss and worker-queue saturation. The repo is public, so the exact bonus and per-tool prices are known to attackers.
- **Reproduction:** Register M Telegram accounts (or M Mini-App `initData` blobs), for each POST `/api/auth/telegram` then POST `/api/generations {slug:"referat",values:{topic:"…"}}`; each yields a full referat for 0 real money. No control blocks the M-th account.
- **Proposed fix:** Lower/stage the bonus (e.g. grant on first *payment* or make it quota that only unlocks cheap tools), and/or require phone verification before the bonus is spendable; add an account-creation velocity limit keyed to a trustworthy client identifier; consider requiring the bonus to be spent only alongside ≥1 paid top-up. Track new-account→immediate-spend as an abuse signal.
- **Effort:** M
- **Confidence:** high

---

### ABUSE-03 — Price/budget page-count default diverges from the generation engine's default → omit or near-miss `pages` to underpay (or force under-budgeted failure)
- **Severity:** P2
- **Location:** `lib/tools.ts:1377-1383` (`defaultPages`: referat/mustaqil-ish → `"10-15"`), `:1416-1465` (`priceFor` map lookups on the raw client `pages` string with `?? base`), `lib/generation/work/registry.ts:383-386` (`normalizeWorkPages` default → `"20-25"`, and snaps any non-exact value up to `"20-25"`), `lib/generation/budget.ts:314-364` (budget from `extractMeta.targetPages`), `lib/generation/meta.ts:130-160` (`extractMeta` also uses `defaultPages`). Same class: `lib/generation/essay/input.ts:76-81` (`pagesOf` clamps 1–5) vs `priceFor` essay map; `lib/tools.ts:1460-1463` glossary `termCount` map `{10,20,40}` vs `teacher/input.ts:213-215` which accepts any value up to 40.
- **Evidence:** `priceFor(referat, {})` uses `defaultPages("referat")="10-15"` → **3 000**, but the work engine's `normalizeWorkPages(kind, undefined)` returns **"20-25"** (its fallback is `find(p==="20-25")`), so the engine generates a 20–25-page referat that is priced 5 000. `pages` is **not** a required field (`referat.fields:[]`, `missingRequired` doesn't check it, `preflightError` doesn't either), so a direct API call omitting `pages` is undercharged by 2 000 while the provider does ~2× the work — or, because `budgetFor` computes only ~348 s for a 12-page target while a 20–25-page work needs ~438 s, the job instead fails the volume gate and refunds after burning ~348 s of LLM/worker time (cost-amplification either way). Near-miss strings hit the same seam on other tools: essay `pages="6"`→ price 2 000 but `pagesOf` clamps to 5 pages (should be 4 000); coursework `pages="40-44"`→ base 12 000 but engine snaps to "20-25" (16 000); glossary `termCount=39`→ base 6 000 but engine makes 39 terms (40-term tier is 15 000). The `*-params.ts` differential-probe tests only send *valid* tier strings, so they never catch this.
- **Reproduction:**
  ```bash
  curl -b "$C" -X POST https://HOST/api/generations \
    -H 'content-type: application/json' \
    --data '{"slug":"referat","values":{"topic":"Migratsiya"}}'   # no "pages"
  # → 202, price:3000; worker generates a 20-25pp referat (5000 tier) or fails+refunds after ~350s
  # glossary underpay:
  --data '{"slug":"glossary","values":{"topic":"Botanika","termCount":39}}'  # price 6000, 39 terms
  ```
- **Proposed fix:** Make `priceFor` (and `budgetFor`/`extractMeta`) derive the tier from the SAME normalizer the engine uses — call `normalizeWorkPages`/`normalizeArticlePages`/glossary clamp before the price map lookup, so raw/near-miss/omitted values are priced at the tier that is actually generated. Unify the referat/mustaqil-ish `defaultPages` with `normalizeWorkPages`'s default. Add a differential test that feeds out-of-tier and omitted `pages`/`termCount` and asserts price == delivered tier.
- **Effort:** M
- **Confidence:** high

---

### ABUSE-04 — Public game submit has no per-session result cap; a shared/leaked token lets anyone insert `game_results` rows (DB growth)
- **Severity:** P3
- **Location:** `app/api/o/[token]/submit/route.ts:26-61`, `lib/server/game-sessions.ts:231-267` (`addResult` — one INSERT per submission, only `slice(PLAYER_NAME_MAX)`/numeric clamps, no per-session count limit), rate limit `limit(o:submit:${ip}, 30, 60)`.
- **Evidence:** The submit endpoint is public (token is the only credential, by design). Each accepted submit writes a `game_results` row. The only throttle is 30/min **per IP**; there is no cap on rows per `session_id`. A leaked/viral class link (these are meant to be shared to students) plus a handful of IPs can accumulate large numbers of rows against one session. Growth is bounded by the 30-day session TTL (`purgeExpiredSessions`, cascade delete) and the per-IP limit, so it is slow, not catastrophic — but there is no ceiling per game and no dedupe. `ipHash` is stored but never used to limit duplicate submissions.
- **Reproduction:** With a known token, POST distinct `{name,answers}` from several IPs at 30/min each; rows accumulate in `game_results` unbounded until the 30-day purge.
- **Proposed fix:** Cap results per `session_id` (e.g. reject after N=1 000 rows, or one row per `ip_hash` per hour), and/or shorten TTL for high-volume sessions. Reuse the already-stored `ip_hash` to dedupe.
- **Effort:** S
- **Confidence:** high

---

### ABUSE-05 — `TRUST_PROXY=true` trusts the *last* `X-Forwarded-For` element; IP rate-limits are spoofable if nginx doesn't append/overwrite XFF
- **Severity:** P2
- **Location:** `lib/server/ratelimit.ts:78-95` (`clientIp`: with `trustProxy`, returns the **last** comma element of `x-forwarded-for`, else falls back to attacker-suppliable `cf-connecting-ip`/`x-real-ip`), `lib/server/env.ts:142` (`trustProxy` default false, but `docker-compose.yml:90` sets `TRUST_PROXY=true` in prod). Affected IP buckets: `tg:${ip}` (Telegram login 20/5 min — gates ABUSE-02), `otp:ip:${ip}`, `ticket:new:${ip}`, `enter:${ip}`, `o:submit:${ip}`.
- **Evidence:** Taking the last XFF element is correct **only** if the reverse proxy *appends* the real peer (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) or overwrites it. The nginx config is not in the repo and `.claude/deploy.md` does not document the header directives; the code comment simply assumes "proxy appends the last value." If nginx forwards the client's `X-Forwarded-For` unchanged (or only sets `X-Real-IP`), a client sending `X-Forwarded-For: <random>` controls the bucket key and rotates it every request, nullifying every IP-based limit — which is exactly the throttle standing between an attacker and mass Telegram-account creation (ABUSE-02) and OTP/ticket/game-submit spam.
- **Reproduction:** `curl -H 'X-Forwarded-For: 9.9.9.<N>' … /api/auth/telegram/ticket` with N rotating; if each request lands in a fresh bucket the `ticket:new` limit never trips → nginx is not appending → spoofable.
- **Proposed fix:** Verify the production nginx uses `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (documented, and add an `nginx -t`-checked snippet to `.claude/deploy.md`). Prefer trusting a fixed number of hops from the *right* only when the immediate peer is the known proxy, or use nginx's `X-Real-IP` set by the proxy exclusively and ignore client XFF. Do not fall back to `cf-connecting-ip`/`x-real-ip` unless Cloudflare/'proxy is actually in front.
- **Effort:** S (config + doc) / M (code hardening)
- **Confidence:** medium — depends on the live nginx config, which is not in the repo; the code is safe *iff* the proxy appends. Confirm with the header test above.

---

### ABUSE-06 — Admin phone number hardcoded in the public repo
- **Severity:** P3
- **Location:** `lib/server/admin-phones.ts` (`ADMIN_PHONES = ["+998XXXXXXXXX"]`).
- **Evidence:** The repo is public (`khusinboev/slaydx`), so the admin's personal phone number is exposed. This is **not** a privilege-escalation path by itself: `requireAdmin` (`lib/server/admin.ts:21`) checks `isAdminPhone(user.phone)`, and `user.phone` is only set when the user shares their own Telegram contact (`telegram.ts:296-335`, verified `contact.user_id === from.id`), and `users.phone` is UNIQUE — an attacker cannot bind the admin's number to their own account. But it is a personal-data leak and a social-engineering target; if the admin ever logs in via the number through a future channel, it matters.
- **Reproduction:** Read the file on GitHub.
- **Proposed fix:** Move the admin identity to an env var (`ADMIN_PHONES` / `ADMIN_USER_IDS`) loaded via `env.ts`, and scrub the value from git history (it is already public — rotate expectations accordingly).
- **Effort:** S
- **Confidence:** high

---

### ABUSE-07 — `deleteGeneration` on a COMPLETED job never refunds, but the file is downloadable before deletion (no output+refund exploit; noting the boundary)
- **Severity:** P3
- **Location:** `lib/server/jobs.ts:234-255` (`deleteGeneration` matches `COMPLETED/FAILED/REVOKED`, no refund; `cancelGeneration` matches only `QUEUED` → REVOKED + refund), `app/api/generations/[id]/route.ts:57-72` (DELETE: cancel→refund for QUEUED, else delete without refund; IN_PROGRESS → 409).
- **Evidence:** I checked for the classic "get output AND a refund" abuse and it is **correctly prevented**: a COMPLETED job can be deleted but yields no refund; a QUEUED job refunds but produced no output; an IN_PROGRESS job can be neither cancelled nor deleted (409). Refund-once is guaranteed by the `transactions(kind, reference)` unique index (`001_init.sql:130`) plus the `SELECT … kind='refund'` pre-check in `refundRatio`. This entry documents the verified boundary (not a bug) so it is not re-audited; the only residual note is that there is no user-visible confirmation that deleting a completed doc forfeits nothing refundable — pure UX.
- **Proposed fix:** None required for security. Optionally surface "no refund for completed work" in the delete confirmation.
- **Effort:** S
- **Confidence:** high

---

## Checked and OK
- **`priceFor` cannot return ≤ 0 / NaN for any tool** — every branch floors at a base tier: image ≥2000, slide `slidePrice` ≥3000 (clamped 4–30), pro-slide `n*2000` n∈[4,30] ≥8000, essay/referat/coursework/glossary map `?? base`, translation `translationPrice` `Math.max(0,floor)` → ≥3000, default `tool.basePrice` ≥2000. `chargeInTx` also early-returns free on `amount<=0` but no tool reaches it (`lib/tools.ts:1392-1465`, `credits.ts:79`). String/float/negative counts are coerced/clamped in `clampInt`/`Number(...||default)`.
- **Translation price integrity** — `sourceChars` is re-derived server-side: file mode from `source_uploads.chars` measured at upload (`sourceCharsForRequest`, count = translatable segments only), text mode from `sourceText.length`; client `sourceChars` is overwritten (`app/api/generations/route.ts:63-85`, `tools.ts:1169-1182`). Cannot pay 3 000 for 200k chars.
- **Charge+enqueue atomic, single transaction; charge idempotent** — `enqueueGeneration` → `chargeInTx` in one tx, `transactions(kind='charge', reference=genId)` unique (`jobs.ts:159-193`, `credits.ts:72-119`).
- **Refund-once & partial-refund correctness** — `refundRatio` pre-checks existing refund + relies on unique index; `refundPartial` shares the same `reference` (so full XOR partial, never both); "nothing delivered" → full refund regardless of `refundShare` (`credits.ts:152-214`, `delivered.ts:117-125`).
- **`completeJob`/`failJob`/`setLive` all gated on `locked_by = workerId`** — a reclaimed/stolen job's stale worker can't overwrite results or double-refund; lost-lock path deletes its own written file/assets (`jobs.ts:405-473`, `worker.ts:258-308`).
- **Payment signature/auth + idempotency** — Click MD5 over the correct field order incl. conditional `merchant_prepare_id`, `safeEqual`; Payme `Basic Paycom:<key>` with strict base64 + timing-safe hash compare; both accept live+test keys but **still require the key to match** (`PAYME_TEST_KEY` is a real secret, not a bypass); amount checked in the right units (Click soum vs Payme tiyin), order state machine (`created→pending→paid/cancelled`), `payment_orders(provider, provider_txn)` unique, `settleOrder`→`topUp` idempotent on `reference` (`payments.ts`, `app/api/payments/{click,payme}/route.ts`).
- **CancelTransaction after paid is rejected** (`CANT_CANCEL`, `payme/route.ts:156`) — credits already granted are kept; no negative-balance path (wallet columns have `CHECK ≥0`, `adminAdjustWallet`/`chargeInTx` re-check).
- **Orders scoped to user; amount range enforced** — `createOrder` clamps `MIN_TOPUP_SOUM..MAX_TOPUP_SOUM`, `pro` forces fixed price; `listOrders` filters `user_id` (`payments.ts:181-222`).
- **Game endpoints**: scores computed server-side (`scoreAnswers`, client `score` ignored), answer key never sent to players (`publicGameView` strips answers; submit returns only score/total/percent), CSV injection neutralised (`csvCell` prefixes `=+-@\t` with `'`), results export ownership `WHERE s.user_id=$2`, public audio double-gated (token→session→asset + must be in `publicGameView`), 128-bit tokens (`game-sessions.ts`, `o/[token]/*`, `[id]/results/route.ts`).
- **Admin**: `requireAdmin` returns 404 (not 403) so panel existence is hidden; `is_admin` derived from `phone` (not user-writable), phone binding verified `contact.user_id===from.id` + UNIQUE; `adminAdjustWallet` writes separate `admin_credit/admin_debit` kinds and re-checks non-negative; admin scripts (`topup.mts`, `seed-*.mts`) are CLI-only, not HTTP-reachable (`admin.ts`, `credits.ts:297-343`).
- **`/api/users/me` PATCH** whitelists editable fields; points/quota/balance never updatable client-side (scout-confirmed; wallet only via `credits.ts`).
- **Upload IDOR/quota**: all upload tables PK `(user_id, asset_id)`, all reads `WHERE user_id=$1`, asset ids validated `^[0-9a-f]{24}$`; size checked from `content-length` before `formData()`; templates capped 12/user (`LIMIT 12`); sources/photos purged (30/90 days). Per-user *count* quota is unbounded for logo/source/photo but each is rate-limited and TTL-purged — low risk, not a finding.
- **Health endpoint**: detailed body gated behind `Bearer CRON_SECRET` (`safeEqual`), public body minimal (`health/route.ts`).
- **`safeEqual`** length-checks before `timingSafeEqual` (no throw / no bypass) (`session.ts:273-278`).
- **OTP brute-force**: `DEV_LOGIN_ENABLED` off in prod (endpoint 503s; `assertRuntimeConfig` errors if on), 5-attempt code lockout, per-identifier + per-IP limits (`auth.ts:180-208`, `app/api/auth/otp/route.ts`).
- **Telegram `/start` dedupe**: `telegram_updates(update_id)` `ON CONFLICT DO NOTHING` prevents replay; each new `telegram_id` writes one user row (signup bonus is the only per-account cost — see ABUSE-02) (`telegram.ts:226-232`).
