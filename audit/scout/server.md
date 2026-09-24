# SlaydX Server Infrastructure Audit

## 1. Module Inventory

| Module | Purpose | Key Tables | Exported Functions |
|--------|---------|-----------|-------------------|
| `db.ts` | Connection pool, migrations, transaction helper | `schema_migrations` | `pool()`, `query()`, `transaction()`, `migrate()`, `ensureMigrated()` |
| `jobs.ts` | Job queue claiming, progress tracking, completion | `generations` | `enqueueGeneration()`, `claimJob()`, `completeJob()`, `failJob()`, `setProgress()`, `setLive()`, `reclaimStaleJobs()`, `listGenerations()`, `getGeneration()` |
| `worker.ts` | Job execution loop, progress ticker, asset extraction | — | `progressTicker()`, `jobBudget()`, `jobDeadlineMs()`, `housekeeping()` |
| `credits.ts` | Three-tier wallet (points/quota/balance), charge/refund | `transactions` (immutable log) | `charge()`, `chargeInTx()`, `refund()`, `refundPartial()`, `walletOf()` |
| `payments.ts` | Click/Payme webhook handlers, order creation | `payment_orders` | `createPaymentOrder()`, `handleClickWebhook()`, `handlePaymeWebhook()` |
| `session.ts` | Cookie-based sessions, token hashing (SHA-256) | `sessions`, `login_codes` | `createSession()`, `validateSession()`, `refreshSession()`, `revokeSession()`, `createLoginCode()` |
| `auth.ts` | Telegram OAuth, local OTP, dev login | `users`, `login_codes` | `upsertLocalUser()`, `handleTelegramLogin()`, `verifyTelegramHash()` |
| `telegram.ts` | Telegram bot webhook/polling handler, login ticket flow | `login_tickets` | `handleTelegramWebhook()`, `createLoginTicket()`, `consumeLoginTicket()` |
| `assets.ts` | Media (images, audio) asset storage & retrieval | `generation_assets` | `putAssetBytes()`, `getAsset()`, `putAssets()`, `deleteAssets()`, `extractAssets()` |
| `storage.ts` | Generated file (DOCX/PPTX/PNG) persistence | `generation_files` | `putGenerationFile()`, `getGenerationFile()`, `deleteGenerationFile()` |
| `ratelimit.ts` | Fixed-window rate limiting, IP-based bucketing | `rate_limits` | `rateLimit()`, `clientIp()`, `purgeRateLimits()` |
| `photo.ts` | Resume photo upload, crop, versioning | `user_photos` | `uploadPhoto()`, `photoDataUrl()`, `purgeOldPhotos()` |
| `template-upload.ts` | Custom PPTX template upload & rasterization | `template_uploads` | `uploadTemplate()`, `getTemplate()`, `listTemplates()`, `templateForJob()` |
| `source-upload.ts` | Translation source file (DOCX/PPTX/PDF/TXT) | `source_uploads` | `uploadSource()`, `sourceForJob()`, `sourceCharsForRequest()`, `purgeOldSources()` |
| `logo.ts` | User-uploaded slide logo (`data:` URL conversion) | `logo_uploads` | `uploadLogo()`, `logoDataUrl()`, `deleteLogo()` |
| `resume-draft.ts` | Resume form draft persistence | `resume_drafts` | `getDraft()`, `putDraft()`, `clearDraft()` |
| `form-draft.ts` | General form draft (article, teacher tools) | `form_drafts` | `getDraft()`, `putDraft()`, `clearDraft()` |
| `live.ts` | Live generation progress reporting (slides) | `generations.live_json` | `LiveReporter` class, `setLive()` |
| `preview.ts` | Lightweight preview for gallery cards | — | `buildPreview()` |
| `slide-commit.ts` | Editor operations (DocOps) for slides | `generations` (doc_version, file_version) | `commitDocOps()`, `rebuildFile()` |
| `edit-adapters.ts` | Unified edit dispatch (slide/resume/work/article) | — | `slideAdapter()`, `resumeAdapter()`, `workAdapter()`, `articleAdapter()` |
| `article-rewrite.ts` | Article rewriting after auto-polish | — | `rewriteArticle()` |
| `doc-polish.ts` | Post-generation polish/refinement routing | — | `POLISHERS` registry, dispatch to polish engines |
| `article-polish.ts` | Article-specific polish (AUDIT-18) | — | `handleArticlePolish()` route handler |
| `game-sessions.ts` | Game link tokens, results persistence | `game_sessions`, `game_results` | `createSession()`, `recordResult()`, `purgeExpiredSessions()` |
| `env.ts` | Configuration loading & validation | — | `env` object, `assertRuntimeConfig()`, `paymentsConfigured()` |
| `admin.ts`, `admin-phones.ts` | Admin identification (hardcoded in code) | — | `isAdminPhone()` |
| `validate.ts` | Input validation helpers | — | `validateEmail()`, `validatePhoneUz()` |

## 2. Database Schema

### Core Tables (001_init.sql)

**users** (row-level ownership check: `WHERE user_id=$2`)
- `id` BIGSERIAL PK
- `telegram_id` BIGINT UNIQUE (nullable)
- `username`, `name`, `photo_url`
- `language` TEXT DEFAULT 'uz'
- `points` BIGINT CHECK ≥0 (bonus credits)
- `quota` BIGINT CHECK ≥0 (Pro subscription pool)
- `balance` BIGINT CHECK ≥0 (paid balance)
- `plan` TEXT ('free'|'pro'), `plan_expires_at` TIMESTAMPTZ
- Profile fields: `university`, `faculty`, `department`, `group`, `course`, `author`, `subject`, `teacher`, `city`
- Position/org (015): `position`, `organization` (TEXT, both added in migration 015)
- `is_blocked` BOOLEAN
- `created_at`, `updated_at` TIMESTAMPTZ

**sessions** (auth)
- `id` BIGSERIAL PK
- `user_id` BIGINT FK → users(id) CASCADE
- `token_hash` TEXT UNIQUE (SHA-256 of token)
- `user_agent`, `ip_hash` TEXT
- `created_at`, `last_seen_at`, `expires_at`, `revoked_at` TIMESTAMPTZ
- Indexes: `(user_id)`, `(expires_at)` for purge

**login_codes**
- `id` BIGSERIAL PK
- `identifier` TEXT (phone or email)
- `code_hash` TEXT (SHA-256)
- `attempts` INT DEFAULT 0
- `consumed_at`, `expires_at`, `created_at` TIMESTAMPTZ
- Index: `(identifier, created_at DESC)` for lookup

**generations** (job queue)
- `id` UUID PK
- `user_id` BIGINT FK → users(id) CASCADE
- `tool_id` TEXT (references `TOOL_BY_ID` registry)
- `topic` TEXT, `status` TEXT ('QUEUED'|'IN_PROGRESS'|'COMPLETED'|'FAILED'|'REVOKED')
- `price` BIGINT (in smallest units)
- `format` TEXT (docx/pptx/png/etc)
- `progress` INT (0–100), `step` TEXT (human label)
- `values_json` JSONB (form input)
- `doc_json` JSONB (AcademicDoc structure, nullable)
- `html` TEXT (rendered preview)
- `file_name` TEXT, `error` TEXT
- Queue fields: `attempts` INT, `locked_by` TEXT (worker ID), `locked_at`, `run_after` TIMESTAMPTZ
- Dates: `created_at`, `started_at`, `finished_at`, `expires_at` (all TIMESTAMPTZ)
- Edit fields (013): `doc_version` INT, `file_version` INT, `image_redraws` INT, `edited_at`, `live_seq` INT, `live_json` JSONB (nullable, only during IN_PROGRESS)
- `doc_prev` JSONB (014) — first edit snapshot, COALESCE guard against double-write
- `delivered_json` JSONB (010) — partial delivery info `{got, want, unit}`
- `cost_json` JSONB (020) — LLM telemetry
- `preview` JSONB (03) — lightweight card data
- Indexes: `(user_id, created_at DESC)`, `(run_after) WHERE status='QUEUED'`, `(locked_at) WHERE status='IN_PROGRESS'`
- `budget_ms` INT (009) — per-job timeout budget

**generation_files**
- `generation_id` UUID PK FK → generations(id) CASCADE
- `file_name`, `mime` TEXT
- `size_bytes` BIGINT
- `bytes` BYTEA (file content in DB, not disk)
- `downloads` INT, `created_at`, `expires_at` TIMESTAMPTZ
- Index: `(expires_at)` for purge (though 011 stopped expiring)

**transactions** (immutable credit log)
- `id` BIGSERIAL PK
- `user_id` BIGINT FK → users(id) CASCADE
- `kind` TEXT CHECK ('charge'|'refund'|'topup'|'bonus'|'subscription')
- `points_delta`, `quota_delta`, `balance_delta` BIGINT (signed)
- `reference` TEXT (UUID of generation or webhook ID, nullable)
- `note` TEXT
- `created_at` TIMESTAMPTZ
- Indexes: `(user_id, created_at DESC)`, **UNIQUE** `(kind, reference) WHERE reference IS NOT NULL` (idempotency)

**payment_orders** (Click/Payme)
- `id` UUID PK
- `user_id` BIGINT FK → users(id) CASCADE
- `provider` TEXT ('click'|'payme')
- `purpose` TEXT ('topup'|'pro')
- `amount_soum` BIGINT (in soums, not tiyin)
- `state` TEXT ('created'|'pending'|'paid'|'cancelled')
- `provider_txn` TEXT (webhook transaction ID, nullable)
- `perform_time`, `cancel_time` BIGINT (Unix timestamps from provider)
- `cancel_reason` INT
- Dates: `created_at`, `updated_at`
- Indexes: `(user_id, created_at DESC)`, **UNIQUE** `(provider, provider_txn) WHERE provider_txn IS NOT NULL`

**rate_limits** (fixed-window)
- `bucket` TEXT (IP or user key), `window_start` TIMESTAMPTZ
- `hits` INT DEFAULT 0
- PK: `(bucket, window_start)`
- Index: `(window_start)` for purge

### Extension Tables (migrations 002+)

**generation_assets** (002): Media associated with generation
- `id` UUID PK, `generation_id` UUID FK, `mime`, `bytes` BYTEA, `created_at`

**preview** (003): Gallery card data (lightweight alternative to full doc_json)
- Normalized into `generations.preview` JSONB in 013

**login_tickets** (004): Telegram login link, one-time tokens
- `id` BIGSERIAL PK, `token` TEXT UNIQUE, `telegram_user_id` BIGINT, `expires_at`, `consumed_at`

**login_links** (007): OTP → one-time link upgrade
- `id`, `identifier`, `link_hash` TEXT UNIQUE, `attempts`, `expires_at`, `consumed_at`

**logo_uploads** (012): User logos for slides
- `user_id` BIGINT PK FK, `asset_id` UUID, `bytes` BYTEA, `created_at`

**template_uploads** (016): Custom PPTX templates
- `user_id` BIGINT PK FK, `asset_id` UUID, `bytes` BYTEA, `profile` JSONB (TemplateProfile), `previews` JSONB, `created_at`

**source_uploads** (017): Translation source files
- `user_id` BIGINT PK FK, `asset_id` UUID, `mime`, `bytes` BYTEA, `chars` INT (translatable segment count), `created_at`

**user_photos** (019): Resume photos
- `user_id` BIGINT PK FK, `asset_id` UUID, `bytes` BYTEA, `created_at`

**resume_drafts** (019): Resume form state
- `user_id` BIGINT PK FK, `values_json` JSONB, `updated_at`

**form_drafts** (020): Article/teacher draft forms
- `user_id` + `tool_id` composite key, `values_json` JSONB, `updated_at`

**game_sessions** (021): Game link tokens
- `id` UUID PK, `user_id` BIGINT FK, `title`, `link_slug`, `created_by_user_id`, `created_at`, `expires_at`

**game_results** (021): Student answers
- `id` UUID PK, `session_id` UUID FK CASCADE, `name`, `answers_json` JSONB, `score` INT, `created_at`

### Key Constraints & Invariants
- **Wallet balance**: `users.(points + quota + balance)` MUST equal `SUM(transactions.{points,quota,balance}_delta)` per user
- **Job ownership**: All queries use `WHERE id=$1 AND user_id=$2` pattern (row-level auth)
- **Idempotency**: `transactions(kind, reference)` UNIQUE prevents double-charge
- **Payment idempotency**: `payment_orders(provider, provider_txn)` UNIQUE
- **Advisory lock**: Migration runner (727_000_001) prevents concurrent schema changes
- **Expiry**: Files/sessions/photos purged by cron via `expires_at` (011 stopped expiring generation files)

## 3. Job Queue & Worker

### Enqueue Path (jobs.ts:159)
```typescript
// In single transaction:
1. chargeInTx(client, userId, price, generationId, note)
   - Splits amount across [points → quota → balance]
   - Writes ONE transaction row with reference=generationId (idempotent via UNIQUE index)
   - Returns {ok: true, split, alreadyCharged} or {ok: false, reason: "insufficient"}
2. INSERT INTO generations (...) VALUES (id, userId, toolId, ..., budget_ms)
   - budget_ms = budgetFor(tool, values) from lib/generation/budget.ts
```
**Invariant**: Both succeed or both fail atomically. `enqueueGeneration()` returns `{ok, id}` or `{ok: false, required, available}`.

### Claiming (jobs.ts:341)
```sql
UPDATE generations g
  SET status='IN_PROGRESS', locked_by=$1, locked_at=now(), 
      started_at=COALESCE(started_at, now()), 
      attempts=attempts+1, progress=5, step='Boshlandi', live_json=NULL
  WHERE g.id = (
    SELECT id FROM generations
     WHERE status='QUEUED' AND run_after <= now()
     ORDER BY created_at LIMIT 1
     FOR UPDATE SKIP LOCKED  ← CRITICAL: prevents double-claim
  )
```
- `SKIP LOCKED` ensures parallel workers never claim the same job
- `locked_by` = WORKER_ID (PID + UUID snippet)
- `locked_at = now()` starts timeout counter

### Progress & Heartbeat
- **setProgress(id, workerId, progress, step)**: Updates `progress`, `step`, `locked_at` (heartbeat). ONLY if `locked_by` matches (ownership check).
- **setLive(id, workerId, live, progress, step)**: For slides/pro-slides, writes `live_json` (streaming), increments `live_seq`, heartbeats `locked_at`. Returns new `live_seq` or `null` if lock lost.
- **heartbeat(id, workerId)**: Refreshes `locked_at` during LLM waits (e.g., Gemini inference). No progress update.

### Timeout & Recovery (jobs.ts:481)
**reclaimStaleJobs()** (cron, housekeeping, 60 s interval):
```sql
-- Reclaim (retry): attempts < 2, timeout exceeded
UPDATE generations
  SET status='QUEUED', locked_by=NULL, locked_at=NULL,
      run_after = now() + 5 seconds, step='Qayta navbatga qo''yildi', live_json=NULL
  WHERE status='IN_PROGRESS' AND attempts < 2
    AND locked_at < now() - ((CASE WHEN budget_ms > 0 
                              THEN budget_ms / 1000 
                              ELSE $1 (global timeout) END) + 30 seconds)

-- Final failure: attempts >= 2, timeout exceeded
UPDATE generations
  SET status='FAILED', progress=100, step='Xatolik', error='Ish vaqti tugadi',
      finished_at=now(), locked_by=NULL, locked_at=NULL, live_json=NULL
  WHERE status='IN_PROGRESS' AND attempts >= 2
    AND locked_at < now() - [SAME TIMEOUT]
  RETURNING id
```
- **budget_ms**: Per-generation timeout (set at enqueue time), 0 for old rows
- **+30 seconds**: Grace period for worker to save results
- **Max 2 attempts**: After second timeout, job fails permanently and credit is refunded
- **Returned dead IDs**: Worker housekeeping refunds credit for each

### Configuration
| Param | Default | Source | Purpose |
|-------|---------|--------|---------|
| `WORKER_CONCURRENCY` | 2 | env.ts:200 | Max parallel jobs per process |
| `WORKER_JOB_TIMEOUT_MS` | 660_000 (11 min) | env.ts:91 | **Global fallback** for pre-009 rows; 0 uses per-job budget |
| `WORKER_INLINE` | true | env.ts:204 | Run worker in web process? |
| Poll interval (idle) | 1500 ms | worker.ts:48 | IDLE_POLL_MS (no jobs) |
| Poll interval (busy) | 150 ms | worker.ts:49 | BUSY_POLL_MS (jobs waiting) |
| Housekeeping | 60_000 ms | worker.ts:50 | Purge + stale recovery + file cleanup |

## 4. Auth & Sessions

### Session Creation
**createSession(userId, expiryDays)** → token (random bytes)
1. Generate random 32-byte token
2. Hash token: `SHA256(token)` → token_hash
3. INSERT sessions row with token_hash (UNIQUE), expires_at = now() + TTL
4. Return `{token}` (raw, not hashed) → sent as httpOnly cookie `slaydx_session`

### Session Validation
**validateSession(req)** → SessionUser | null
1. Extract `slaydx_session` cookie (httpOnly, browser cannot access)
2. Hash it: `SHA256(tokenFromCookie)`
3. Query `sessions WHERE token_hash = $1 AND expires_at > now() AND revoked_at IS NULL`
4. If found, load full user profile from users table
5. `timingSafeEqual()` prevents timing-based token guessing

### OTP Login (Local)
**createLoginCode(identifier, expiryMin)** → code
1. Generate random 5-digit code
2. Hash: `SHA256(code)`
3. INSERT login_codes(identifier, code_hash, expires_at)
4. Return `code` to user (SMS/Telegram)

**verifyLoginCode(identifier, code)** → userId | null
- Hash incoming code, query WHERE identifier + code_hash match
- If found and fresh: upsertLocalUser(identifier) → create or find user
- Consume code: `UPDATE login_codes SET consumed_at = now()`

### Telegram Login
**verifyTelegramHash(data, botToken)** (auth.ts)
- Telegram sends login widget with signed data: `id`, `username`, `first_name`, `photo_url`, `auth_date`, `hash`
- Reconstruct: sort key-value pairs, concatenate as `key=val\nkey=val…`
- HMAC-SHA256 with `botToken` as key
- Compare HMAC to `hash` (timing-safe)
- If valid, extract `id` (telegram_id) and link or create user

**handleTelegramLogin(tgData, botToken)** → SessionUser
- Verify hash
- upsertLocalUser(tgData.id) → find or create by telegram_id
- createSession(userId)

### Telegram Login Link (Web)
**createLoginTicket(telegramUserId)** → token (one-time)
- INSERT login_tickets(token, telegram_user_id, expires_at)
- Return link: `?start=<token>` to user (via QR or share)

**consumeLoginTicket(token)** → SessionUser | null
- Find ticket by token, check freshness
- Load user by telegram_user_id
- CREATE session
- Mark ticket consumed

### Admin Detection
**isAdminPhone(phone)** (admin-phones.ts)
- Hardcoded list in code (source of truth)
- Checked during Telegram login flow
- Sets `isAdmin` flag in SessionUser

### Session TTL & Cookie Flags
| Setting | Default | Notes |
|---------|---------|-------|
| SESSION_TTL_DAYS | 30 | Lifetime for token (expires_at) |
| SESSION_SECRET | — | ≥32 chars, used for session signing (if applicable) |
| SESSION_COOKIE_SAMESITE | lax | 'lax' (CSRF safe) or 'none' (Telegram iframe, requires HTTPS) |
| httpOnly | true | JS cannot read token |
| Secure | (HTTPS only) | Prod: yes, dev: conditional |

### Dev Login (DEV_LOGIN_ENABLED)
- Bypasses Telegram: form accepts any username, creates/logs in user
- Prod: disables with hard error in assertRuntimeConfig()
- Dev: useful for local testing

## 5. Credits, Pricing & Payments

### Three-Tier Wallet (users table)
```
points      — bonus credits, earliest expiry (free bonus from referrals/promotions)
quota       — Pro subscription pool (expires when plan ends)
balance     — paid balance (no expiry)
```
When charging `price`:
1. `splitFor(price, {points, quota, balance})` iterates in order
2. Take from points until exhausted, then quota, then balance
3. Each hamyon (`points_delta`, `quota_delta`, `balance_delta`) written to transactions

### chargeInTx (credits.ts:72)
```typescript
// Called inside enqueueGeneration transaction:
1. Check if already charged: SELECT FROM transactions WHERE kind='charge' AND reference=$1
   - If found, return {ok: true, alreadyCharged: true} with split (idempotent)
2. Load user wallet WITH lock: SELECT points, quota, balance FROM users WHERE id=$1 FOR UPDATE
3. Calculate split
4. If total < amount: return {ok: false, reason: "insufficient", required, available}
5. Deduct from wallet: UPDATE users SET {points, quota, balance} -= delta WHERE id=$1
6. Log transaction: INSERT transactions(user_id, kind='charge', reference, deltas)
7. Return {ok: true, split}
```
**Invariant**: Wallet total always = sum of transaction deltas. "Insufficient" answer blocks job enqueue.

### refund (credits.ts)
```typescript
// Called when job fails:
await transaction(async (client) => {
  1. Check if already refunded: SELECT FROM transactions WHERE kind='refund' AND reference=$1
  2. Load wallet FOR UPDATE
  3. Determine refund hamyon (reverse of charge split)
  4. UPDATE users SET {points|quota|balance} += refund
  5. INSERT transactions(kind='refund', reference, note='Xatolik: ...')
})
```

### refundPartial (credits.ts) — Shortfall Handling
Used when generation delivers `{got: 3, want: 4}` (e.g., 3 of 4 requested images):
```typescript
1. Calculate ratio: refundRatio(delivered) from lib/generation/delivered.ts
   - Ratio = (want - got) / want (e.g., 1/4 = 0.25 for 1 missing)
2. refund = Math.round(price * ratio)
3. Apply refund via transaction (same as failJob refund)
```
**Worker logic** (worker.ts:273):
- If `delivered && delivered.got < delivered.want`:
  - Ratio = `refundRatio(delivered)` (null if no refund share for this tool)
  - If null: warn but don't refund (e.g., image shortfall in standard slide, no surcharge)
  - Otherwise: `refundPartial(userId, id, ratio, label)` with journal

### Click Payment Webhook (payments.ts)
**POST /api/payments/click**
```
1. HMAC-SHA256 verify: hash(click_secret_key + request_body)
2. Prevent double-processing: SELECT FROM payment_orders WHERE provider='click' AND provider_txn=$txnId
3. If state='pending' and incoming is 'complete' (Complete request):
   - charge user (topup): `points += amount_soum`
   - INSERT transaction(kind='topup', reference=txnId)
   - UPDATE payment_orders SET state='paid'
4. Return JSON confirmation
```

### Payme Webhook (payments.ts)
```
1. HMAC-SHA256 verify
2. CheckTransaction: respond with existing transaction hash
3. PerformTransaction: idempotent on order_id + txn_id pair
   - charge user, INSERT transaction, UPDATE state
4. GetStatement: return list of transactions in date range
```

### Order Lifecycle
**createPaymentOrder(userId, amount, purpose)**:
1. Generate UUID, INSERT payment_orders(state='created')
2. Return order_id to client
3. Client redirects to Click/Payme hosted form (order_id as merchant reference)
4. Payment gateway POSTs webhook → server verifies → charges if approved
5. Client polls `/api/users/me` to see updated balance

**Invariant**: Payment is idempotent on webhook transaction ID. If webhook replayed, transaction table UNIQUE index blocks duplicate.

## 6. Rate Limiting

### Implementation (ratelimit.ts)
**Fixed-window buckets** stored in rate_limits table:
```sql
bucket      TEXT          (e.g., "polish:user_123", "otp_verify:+998XXXXXXXXX")
window_start TIMESTAMPTZ  (aligned to window boundary, e.g., 00:00 UTC for 1-day window)
hits        INT           (count of requests in window)
```

**rateLimit(bucket, limit, windowSec)**:
1. Calculate window boundary: `Math.floor(now / windowMs) * windowMs`
2. `INSERT INTO rate_limits(bucket, window_start, hits) VALUES ($1, $2, 1)`
   `ON CONFLICT (bucket, window_start) DO UPDATE SET hits = hits + 1`
3. Return `{ok: hits <= limit, remaining, retryAfterSec}`

### Where Applied
| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| `/api/auth/otp-request` | 3 | 1 hour | IP (via clientIp) |
| `/api/auth/otp-verify` | 5 | 1 hour | IP |
| `/api/payments/verify` | 10 | 1 minute | user_id |
| `/api/generations/[id]/polish` | 3 | 1 day | user_id (AUDIT-18, 20 total per user per day) |
| `/api/article/udk` | 30 | 1 hour | user_id (AUDIT-18) |

### Cleanup
**purgeRateLimits()** (cron, housekeeping):
- Delete windows older than 25 hours
- Prevents old windows from accumulating

### IP Handling
**clientIp(req)**:
- If `TRUST_PROXY=false`: return "direct" (single bucket)
- If `TRUST_PROXY=true`: trust `x-forwarded-for` last element (nginx sets it)
- Fallback: `cf-connecting-ip`, `x-real-ip`

## 7. Files & Storage

### In-Database Storage
**generation_files** table:
```sql
generation_id  UUID PK FK
bytes          BYTEA      (file content, up to ~1 GB per row in Postgres)
file_name      TEXT       (original filename)
mime           TEXT       (detected MIME type)
size_bytes     BIGINT
```

**putGenerationFile(id, {bytes, mime, fileName})**:
- INSERT or UPSERT generation_files
- No disk I/O

**getGenerationFile(id, userId)**:
- SELECT bytes, file_name, mime WHERE generation_id=$1 AND user_id=$2 (via JOIN)
- Return Blob to client

### Asset Storage (Images, Audio)
**generation_assets** table:
```sql
id             UUID PK
generation_id  UUID FK
mime           TEXT
bytes          BYTEA
created_at     TIMESTAMPTZ
```

Used for:
- Slide images (extracted from DOCX/PPTX before sending)
- Resume photo (extracted from PDF)
- Figure SVG→PNG (article diagrams)
- TTS audio (podcast audio clips)

**extractAssets(generationId, doc, html)** (worker.ts:249):
- Scans doc_json and html for data: URLs (base64)
- Extracts to generation_assets rows
- Returns clean doc/html with `/api/assets/…` refs

### Size Limits
- Resume photo: ≤ 5 MB, cropped ≤ 1200 px
- Translation source: ≤ 20 MB
- Template PPTX: ≤ 20 MB
- Logo: ≤ 2 MB (typically < 100 KB)

### TTL & Purging (Migration 011)
- **Historically**: Files expired after 72 hours
- **2026-09 change**: Removed expiry (`expires_at` stays NULL in 011)
- **Current**: Files kept indefinitely
- No cron job purges generations anymore

## 8. Telegram Bot

### Flow: Link & Login

**createLoginTicket(tgUserId)** → token:
1. INSERT login_tickets(token=random_32, telegram_user_id, expires_at=now+10min)
2. Generates URL: `https://t.me/BOT_USERNAME?start=<token>`
3. User shares or scans QR → clicks on Telegram

**Bot receives /start <token>**:
1. consumeLoginTicket(token) → load user by telegram_user_id
2. If user doesn't exist, create with telegram_id + extracted name/photo
3. createSession(userId) → set slaydx_session cookie
4. Redirect to sayt (`APP_URL`)

### Webhook vs. Polling
- **Prod**: Webhook mode (set via setWebhook to Telegram API)
  - `POST /api/telegram/webhook` with `secret_token` (CRON_SECRET)
  - Hmac-SHA256 verify
  - Request body = Update object
  
- **Dev**: Polling mode (`npm run bot`)
  - Long-polling getUpdates()
  - No HTTPS required

### Update Handler (scripts/bot.mts, lib/server/telegram.ts)
```
1. Extract message text / callback query
2. If /start <token>: handleLoginTicket(token)
3. If /help: show commands
4. If /link <phone>: linkAdminPhone (for admin registration)
5. Otherwise: send help menu
```

## 9. Process & State Map

### Three Processes

| Process | Role | In-Memory State | Shared State |
|---------|------|-----------------|--------------|
| **web** (Next.js) | API routes, auth, forms | `__slaydxPool` (DB connection pool), `__slaydxMigrated` (Promise guard), module singletons (if any) | Postgres: generations, users, sessions, transactions |
| **worker** (Node script) | Job execution, LLM calls, file generation | `__slaydxPool`, `WORKER_ID`, job-local: `progressTicker` interval, `LiveReporter` state | Postgres: generation updates (progress, live_json, status), assets |
| **postgres** | Persistent state, mutual exclusion | Advisory locks (727_000_001 for migrations), row-level locking (FOR UPDATE) | Tables listed in schema section |
| **bot** (Node script, optional) | Telegram updates, login tickets | Long-polling state (getUpdates offset) | Postgres: login_tickets, users, sessions |

### In-Memory Singletons (Risks with Horizontal Scale)
- **`lib/server/db.ts`**: `__slaydxPool` per process (OK: each process has own pool, DB handles concurrency)
- **No user-session state** in memory (OK: sessions in DB)
- **No in-memory job cache** (OK: claimJob queries DB each poll)
- **Rate limits table-backed** (OK: DB-resident, shared across instances)

**2+ web replicas**: Safe IF each has own pool. No affinity needed.

### Graceful Shutdown
- **web**: Node SIGTERM → Next.js closes listeners, in-flight requests complete
- **worker**: SIGTERM → Finish current job, release lock, exit. Next tick reclaims via reclaimStaleJobs
- **Postgres**: Container stop → graceful shutdown (pg_isready checks it)

## 10. Observations for Auditors

### Security & Integrity
1. **Row-level ownership** (`WHERE id=$1 AND user_id=$2`) enforced consistently across generations, sessions, assets — guards against IDOR. ✓
2. **Token hashing**: Sessions store SHA-256, not plaintext. Cookie is httpOnly. ✓
3. **Webhook HMAC verification**: Click/Payme both check `HMAC-SHA256(secret, body)`. ✓
4. **Idempotency keys**: transactions(kind, reference) UNIQUE prevents double-charge even if webhook replayed. ✓
5. **Admin list hardcoded** in code (not database) — unusual but matches project policy. ✓

### Data Consistency
1. **Enqueue-charge atomicity**: Both in one transaction, job cannot be claimed without payment. ✓
2. **Wallet invariant**: `points + quota + balance = Σ(transaction deltas)` — should be verified by audit. ⚠
3. **Job lock ownership**: `locked_by` + `locked_at` prevent two workers finishing same job. `completeJob` checks `locked_by = $2` (worker ID). ✓
4. **Stale job recovery**: Hardcoded to 2 max attempts; second timeout → permanent fail + refund. ✓

### Scalability & Performance
1. **Per-job timeout (`budget_ms`)**: Replaces global constant, adapts to actual task complexity. ✓
2. **Index on `(run_after) WHERE status='QUEUED'`**: Efficient queue scan. ✓
3. **SKIP LOCKED**: Prevents contention when 2+ workers poll queue. ✓
4. **Heartbeat pattern**: `setProgress`/`setLive` refresh `locked_at` to keep job alive during LLM waits. Avoids false timeout. ✓
5. **No transaction in setProgress**: Fast updates, parallel-safe (updates move locked_at forward). ✓

### Potential Risks
1. **No LIMIT in some queries**: `lib/server/jobs.ts:197` `listGenerations(..., limit=100)` — capped, OK. But verify all user-facing list endpoints have LIMIT. ⚠
2. **Advisory lock scope**: Single lock (727_000_001) serializes ALL migrations. With multiple services on same DB, could block. `.claude/deploy.md` documents this; OK if known. ✓
3. **rate_limits purge interval 25 hours**: Cumulative across 1-hour to 1-day windows. If window = 24h, old entries stick 49 hours. Minor; not a bug. ✓
4. **Worker budget math**: `jobBudget() * 0.7` for expected progress time means 30% buffer. If actual << 70%, progress bar flattens early (no visual feedback). Acceptable (CLAUDE.md §1 notes this design). ✓
5. **Live JSON in IN_PROGRESS only**: On status change to COMPLETED, `live_json` set to NULL. Client must read before refresh if on slow link. Expected behavior per docs. ✓

### Audit Recommendations
1. **Run balance audit**: `SELECT user_id, (points + quota + balance) - COALESCE((SELECT SUM(points_delta + quota_delta + balance_delta) FROM transactions t2 WHERE t2.user_id = users.id), 0) AS drift FROM users WHERE drift != 0;` — should return 0 rows.
2. **Check for orphaned jobs**: `SELECT id FROM generations WHERE status IN ('IN_PROGRESS', 'QUEUED') AND created_at < now() - interval '7 days';` — should be rare; if many, reclaimStaleJobs not running.
3. **Verify indexes exist** on `(run_after)`, `(locked_at)`, `(window_start)` — `\d+ rate_limits` etc. in psql.
4. **Rate-limit window alignment**: Confirm bucket keys match code (e.g., "polish:user_123"). Check if clock skew across servers affects window boundaries.
5. **TLS for webhook**: Verify `SESSION_COOKIE_SAMESITE=none` ONLY on HTTPS (assertRuntimeConfig enforces this). ✓

### Production Readiness Checklist
| Item | Status | Evidence |
|------|--------|----------|
| Migrations idempotent | ✓ | `IF NOT EXISTS` guards, idempotent operations |
| Connection pooling | ✓ | `Pool(max=10)`, healthcheck `pg_isready` |
| Backup strategy | External | `.claude/deploy.md`: `pg_dump` before deploy |
| Secret rotation | Manual | SESSION_SECRET, API keys in .env, not in git |
| Rate limiting active | ✓ | Table-backed, applied to auth & API endpoints |
| Error logging | ✓ | console.error/warn throughout, jurnals in CLAUDE.md |
| Graceful shutdown | ✓ | SIGTERM handled, reclaimStaleJobs recovers stuck jobs |
| Horizontal scale readiness | ⚠ | No in-memory caches; `__slaydxPool` per process (OK); verify no shared mutable state in modules |

