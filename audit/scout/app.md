# SlaydX App Layer Audit — Route & Config Cartography

**Date:** 2026-09-23  
**Scope:** `app/api/*/route.ts`, `app/page.tsx`, `app/layout.tsx`, `next.config.ts`, `instrumentation.ts`, root config files

---

## 1. API Routes (43 files, 51+ exports)

### Authentication & Session (6 files, 8 exports)

| Path | Method | Auth | Helper + Line | Rate Limit | Description |
|------|--------|------|---------------|-----------|-------------|
| `/api/auth/telegram` | POST | Public | `limit(tg:${ip}, 20, 300)` at line 33 | 20/5min IP-based | Verify Telegram widget/Mini App signature; create session; CRON_SECRET NOT required; `checkOrigin()` verified `api.ts:64` |
| `/api/auth/telegram/ticket` | POST | Public | `limit(ticket:new:${ip}, 10, 300)` | 10/5min IP | Create nonce → bot URI; CSRF `checkOrigin()` required |
| `/api/auth/telegram/enter` | GET | Public | No session check | None | One-time token login (5 min expiry, one-use) |
| `/api/auth/otp` | POST | Public | `limit(otp:req:${id}, 3, 600)` + `limit(otp:ip:${ip}, 15, 600)` verify limits | Multi-bucket | SMS/OTP (provider not wired); DEV_LOGIN_ENABLED toggles hardcoded codes |
| `/api/auth/session` | GET | Optional | `optionalUser()` — no exception if missing | None | Get current session or public info |
| `/api/auth/session` | DELETE | Auth | `requireUser()` + optional `?all=1` | None | Logout this session or all sessions |

**Public auth notes:**  
- `/auth/telegram/*` has no `requireUser` — validates Telegram signature server-side (`verifyLoginWidget`/`verifyMiniAppInitData` use bot token)  
- `checkOrigin()` enforces `Sec-Fetch-Site: same-origin|none` + exact host or ALLOWED_ORIGINS list (`api.ts:99–133`)  
- `/auth/otp` endpoints exist but SMS provider unavailable; fallback via `DEV_LOGIN_ENABLED` for testing

---

### User Profile & Admin (5 files, 7 exports)

| Path | Method | Auth | Validation | Rate Limit | Description |
|------|--------|------|-----------|-----------|-------------|
| `/api/users/me` | GET | `requireUser` | None | None | Profile + last 30 transactions |
| `/api/users/me` | PATCH | `requireUser` | Whitelist `EDITABLE` array (line 23–38); `slice(0, 200)` per field | `limit(profile:${user.id}, 30, 300)` | Update name, university, author, position, organization (NEVER points/balance) |
| `/api/admin/users` | GET | `requireAdmin` | Query param `q` (line 42 ILIKE name/username/local_id/telegram_id) | None | Search + paginate 30/page; **admin-only via `requireAdmin`** |
| `/api/admin/users/[id]` | GET | `requireAdmin` | UUID validation | None | User detail (admin) |
| `/api/admin/users/[id]` | PATCH | `requireAdmin` | Points/quota/balance/plan fields via SQL sets | None | Adjust user balance (admin) |
| `/api/admin/users/[id]` | PUT | `requireAdmin` | `isBlocked` boolean | None | Block/unblock user (admin) |

**Admin security:**  
- All `/admin/*` routes call `requireAdmin()` — enforces `is_admin=true` in session OR hardcoded admin ID (`lib/server/admin.ts`)  
- No rate limit on admin endpoints — trusted role

---

### Document Generation (13 files, 18 exports)

| Path | Method | Auth | Input Validation | Rate Limit | Special Exports | Description |
|------|--------|------|------------------|-----------|-----------------|-------------|
| `/api/generations` | GET | `requireUser` | None | None | `runtime: nodejs` `dynamic: force-dynamic` | List user's generations only (SQL WHERE `user_id=$2`) |
| `/api/generations` | POST | `requireUser` | `sanitizeValues()` (line 47), required fields check (line 94), preflight check (line 100), price recalc server-side (line 103) | `limit(gen:burst:${user.id}, 5, 60)` + `limit(gen:hour:${user.id}, 60, 3600)` | `maxDuration: n/a` | Enqueue new generation; **tarjima hajm computed server-side** (line 63–85: `sourceCharsForRequest` overrides client), **price recalc, credit debit + queue in tx** |
| `/api/generations/[id]` | GET | `requireUser` | UUID regex test (line 11); optional `?since=<liveSeq>` (line 20) | None | `force-dynamic` | Fetch gen by id (SQL `WHERE id=$1 AND user_id=$2`); live progress if available |
| `/api/generations/[id]` | DELETE | `requireUser` | UUID test | None | None | Cancel queued job (refund), delete completed record; **cascade deletes files/assets** |
| `/api/generations/[id]/file` | GET | `requireUser` | UUID test; `?format=pdf` optional; `?inline=1` optional | None | `maxDuration: 60` | Get DOCX/PPTX/PNG; **NEVER return stale PPTX** (line 50: `ensureFreshFile` rebuilds if doc_version > file_version); PDF on-demand via LibreOffice |
| `/api/generations/[id]/doc` | PATCH | `requireUser` | `parseDocOps()` typecheck (ops array); `baseVersion` integer check; SQL conflict 409 if stale | `limit(edit:${user.id}, 120, 60)` | `maxDuration: n/a` | Apply edit operations (text/layout/delete); rebuild PPTX on debounce (3s) |
| `/api/generations/[id]/doc/restore` | POST | `requireUser` | `baseVersion` integer | `limit(edit:${user.id}, 120, 60)` | None | Restore doc to earlier version (undo across sessions) |
| `/api/generations/[id]/rebuild` | POST | `requireUser` | UUID test | `limit(rebuild:${user.id}, 30, 3600)` | `maxDuration: 60` | Force PPTX rebuild from current doc (editing UI) |
| `/api/generations/[id]/rewrite` | POST | `requireUser` | `baseVersion` integer; body contains `{section, fix, ...}` | `limit(rewrite:${user.id}, 20, 600)` | `maxDuration: 150` | Rewrite article section/annotation; **free, but limited 20/600s per user** |
| `/api/generations/[id]/polish` | POST | `requireUser` | `baseVersion` integer | `limit(polish:${user.id}, 20, 86_400)` + `limit(polish:${id}, 3, 86_400)` | `maxDuration: 150` | Auto-polish (article/essay/work); **free, 3 per doc/day, 20 per user/day** |
| `/api/generations/[id]/results` | GET | `requireUser` | UUID test | None | None | Fetch results summary (deprecated/legacy endpoint) |
| `/api/generations/[id]/share` | POST | `requireUser` | UUID test | `limit(share:${user.id}, 30, 3600)` | None | Create public game session token; returns token for `GET /api/o/[token]` |
| `/api/generations/[id]/thumb` | GET | `requireUser` | UUID test | None | `maxDuration: 15` | Thumbnail image (first slide/page) |
| `/api/generations/[id]/assets/[assetId]` | GET | `requireUser` | Asset ID validation | None | None | Get media (SVG/PNG from article figures, etc.); **SQL ownership check** |
| `/api/generations/[id]/photo` | POST | `requireUser` | Multipart form; `?crop` query (resume viewer edit) | `limit(imgup:${user.id}, 30, 3600)` | None | Replace resume photo from viewer |
| `/api/generations/[id]/slides/[index]/image` | POST | `requireUser` | Multipart; index integer | `limit(imgup:${user.id}, 30, 3600)` | None | Upload custom slide image |

**Gen security notes:**  
- All `/api/generations/[id]*` routes: `requireUser` validates ownership via SQL WHERE `user_id = $2`  
- Price NEVER trusted from client — recalculated server-side (line 103 `priceFor`)  
- Tarjima: `sourceChars` overridden from DB upload (`sourceCharsForRequest`) or computed from `sourceText` length (line 79)  
- File endpoint **deliberately refreshes PPTX** if stale (`ensureFreshFile` — matches "ko'rdim = oldim")  
- Stale file detection: if `doc_version > file_version`, rebuild before download

---

### File Uploads (Upload/Asset Management) (7 files, 10 exports)

| Path | Method | Auth | Validation | Rate Limit | Body Size / Limits | Description |
|------|--------|------|-----------|-----------|------------------|-------------|
| `/api/extract` | POST | `requireUser` | File size pre-check via `Content-Length` (line 23); `EXTRACT_MAX_BYTES` checked post-formData (line 30); output truncated to `EXTRACT_MAX_CHARS` (line 48) | `limit(extract:${user.id}, 20, 300)` | ≤`EXTRACT_MAX_BYTES` (~10 MB); output ≤`EXTRACT_MAX_CHARS` (~2 M) | Extract text from DOCX/PDF/PPTX/XLSX/TXT; **header-first size check** prevents OOM |
| `/api/uploads/source` | POST | `requireUser` | File sniff (DOCX/PPTX/XLSX/PDF/TXT); PDF page count limit | `limit(source:${user.id}, 20, 600)` | ≤20 MB | Tarjima manbasini yuklash; returns `{assetId, chars, kind, name}` |
| `/api/uploads/source/[assetId]` | DELETE | `requireUser` | UUID/objectId test | None | N/A | Delete uploaded source |
| `/api/uploads/template` | POST | `requireUser` | ZIP sniff, PPTX validation; `rasterizeTemplate` via LibreOffice | `limit(template:${user.id}, 5, 600)` | ≤20 MB; `maxDuration: 120` | Custom PPTX template upload (pro-slide) |
| `/api/uploads/template` | GET | `requireUser` | None | None | None | List user's templates |
| `/api/uploads/template/[assetId]` | DELETE | `requireUser` | UUID test | None | N/A | Delete template |
| `/api/uploads/photo` | POST | `requireUser` | Image sniff; crop + resize via sharp; stores cropped + original | `limit(photo:${user.id}, 20, 300)` | ≤5 MB | Resume photo (crops to 1200×1200, stores original for DOCX) |
| `/api/uploads/photo/[assetId]` | GET | `requireUser` | Asset ID test | None | N/A | Retrieve photo data URL |
| `/api/uploads/logo` | POST | `requireUser` | File sniff (PNG/SVG) | `limit(logo:${user.id}, 10, 300)` | ≤2 MB | Organization logo upload |

**Upload security notes:**  
- All uploads: **size checked BEFORE parsing** (extract: `Content-Length` header pre-check line 23)  
- Sniff validation via `snapImageType()` (article 2 figures, resume photos — prevent ZIP/HEIF DoS)  
- Ownership: asset URLs include `[assetId]`, verified via `getAsset(id, userId)` SQL WHERE clause  
- Templates: 20 MB limit; ZIP decompression checked; rendered via LibreOffice to PNG (attack surface: `pdftoppm` via libpoppler)

---

### Payments & Webhooks (3 files, 4 exports)

| Path | Method | Auth | Signature/Token | Rate Limit | Description |
|------|--------|------|-----------------|-----------|-------------|
| `/api/payments/orders` | GET | `requireUser` | Session only | None | List user's orders |
| `/api/payments/orders` | POST | `requireUser` | Session only; body `{amount}` | None | Create payment order; returns provider-specific URL |
| `/api/payments/click` | POST | Public | MD5 signature verify (Click Prepare/Complete webhooks) | None | **PUBLIC webhook — validates `sign_string` = MD5(…)** per Click protocol (line 49–60 checks sig, amount, state) |
| `/api/payments/payme` | POST | Public | Basic auth header `Authorization: Basic Paycom:<KEY>` | None | **PUBLIC webhook — Payme Merchant API** (JSON-RPC); validates auth header |
| `/api/telegram/webhook` | POST | Public | `x-telegram-bot-api-secret-token` header = `CRON_SECRET` | None | **PUBLIC webhook — requires `CRON_SECRET`** (line 28: crashes 503 if missing); `safeEqual()` timing-safe compare |

**Webhook security notes:**  
- Click/Payme webhooks: **NO auth, rely on signature/token validation only** — both check HTTP header (Click: computed sig; Payme: `Basic` auth)  
- Telegram webhook: **MUST have `CRON_SECRET`** — else fails at boot or returns 503  
- All webhooks: no `requireUser` — process async; idempotent by `reference` or `transaction_id`

---

### Public Game Endpoints (`/api/o/[token]`) (3 files, 3 exports)

| Path | Method | Auth | Token Validation | Rate Limit | Description |
|------|--------|------|-----------------|-----------|-------------|
| `/api/o/[token]` | GET | Public | `TOKEN_RE` regex; token must exist + `status=COMPLETED` + doc not null | None | **PUBLIC: Get game metadata** — returns `{game, title, kind}` via `publicGameView()` (sanitized); **NO ownership check — token IS the secret** |
| `/api/o/[token]/submit` | POST | Public | Token valid; body `{answers, ...}` | `limit(o:submit:${ip}, SUBMIT_PER_MINUTE, 60)` IP-based | Submit game answers |
| `/api/o/[token]/audio/[assetId]` | GET | Public | Token valid; asset ID | None | Fetch game audio/media |

**Public game security notes:**  
- **No `requireUser`** — token (128-bit random) is the only credential  
- Token validation happens in `getGameSessionByToken()` — checks status, TTL, doc exists  
- Response sanitized via `publicGameView()` — does NOT return full document  
- `createGameSession()` enforces token entropy + one-time use  
- Missing/invalid token → 404 with reason hidden (leak prevention)

---

### Data Processing (3 files, 4 exports)

| Path | Method | Auth | Input | Rate Limit | Description |
|------|--------|------|-------|-----------|-------------|
| `/api/outline` | POST | `requireUser` | Body `{topic, language, ...}` | `limit(outline:${user.id}, 12, 600)` | Generate AI outline (for form preview); **no credit debit** |
| `/api/curriculum` | GET | `requireUser` | Optional `?query=` param | `limit(curriculum:${user.id}, LIMIT_PER_MIN, 60)` | Search teacher curriculum (static data from `data/curriculum.json`) |
| `/api/article/udk` | POST | `requireUser` | Body `{topic, language}` | `limit(udk:${user.id}, 30, 3600)` | UDK suggestion via LLM `fast` role; **no credit debit** |
| `/api/forms/[toolId]/draft` | GET/PUT/DELETE | `requireUser` | `toolId` validation (resume, article, etc.); body is form values | None | Form draft storage (per-tool, per-user) |
| `/api/resume/draft` | GET/PUT/DELETE | `requireUser` | Resume-specific draft | None | Resume draft (legacy — now under `/forms/resume/draft`) |

**Data endpoints notes:**  
- `outline`, `udk`: **free helper endpoints, no credit charged**; LLM calls ONLY for form preview  
- `curriculum`: static JSON served from disk + prefix search (no DB)  
- Draft endpoints: store form values as JSON; **no generation created**

---

## 2. Page Routes & Layouts

| Path | Type | Server/Client | Auth Check | Notes |
|------|------|---------------|-----------|-------|
| `/` | `page.tsx` | Server | None | Redirect to `/uz` (default locale) |
| `/uz` | `layout.tsx` + `page.tsx` | Server | Optional (nav shows login if not auth) | Main layout + home page; **next/font vars on `<html>`** (CLAUDE.md line 191) |
| `/uz/login` | `page.tsx` | Server | None | Auth forms (Telegram, OTP) |
| `/uz/create` | `page.tsx` | Server | `requireUser` (via hook) | Create new document (tool selection) |
| `/uz/files/[id]` | `page.tsx` + `loading.tsx` | Server | `requireUser` | Viewer + editor (GET `/api/generations/[id]` for auth) |
| `/uz/profile` | `page.tsx` | Server | `requireUser` | User settings, transaction history |
| `/uz/purchase` | `page.tsx` | Server | `requireUser` | Credit top-up UI |
| `/uz/admin` | `page.tsx` + `loading.tsx` | Server | `requireAdmin` (via hook) | Admin panel (user search, balance adjust) |
| `/o/[token]` | `page.tsx` | Server | None | **PUBLIC: Game view** — no auth; token in URL |

**Special error/not-found pages:**
- `app/error.tsx` — Error boundary (500 catches)
- `app/not-found.tsx` — 404 fallback

**Layout conventions:**
- `<html>` carries `--font-geist`, `--font-tinos` vars (CLAUDE.md R4 lesson)  
- All authenticated pages use client-side `useSession()` hook to check auth client-side + redirect if needed
- Admin pages wrapped in `<AdminGuard>` component

---

## 3. Security Configuration

### `next.config.ts` (lines 1–129)

**Security Headers:**

| Header | Value | Notes |
|--------|-------|-------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | *(omitted)* | **Intentional** — Mini App needs `web.telegram.org` iframe; CSP `frame-ancestors` used instead |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Leak prevention |
| `Cross-Origin-Resource-Policy` | `same-origin` | Prevent cross-site resource sharing |
| `Permissions-Policy` | Camera, microphone, geolocation, USB, payment, interest-cohort all `()` | Disable unused APIs |
| **CSP** | See below | Complex; production differs from dev |

**Content-Security-Policy (lines 31–67):**
- `default-src 'self'` — No external by default  
- `script-src 'self' 'unsafe-inline' [unsafe-eval in dev only] https://telegram.org` — **`unsafe-inline` is intentional** (Next.js inline runtime scripts; nonce too fragile with SSG); no `unsafe-eval` in prod  
- `style-src 'self' 'unsafe-inline'` — Inline styles allowed  
- `img-src 'self' data: blob:` — Inline images + data URIs  
- `font-src 'self' data:` — Google Fonts + data URIs  
- `connect-src 'self'` — API calls to same origin only  
- `frame-src 'self' https://telegram.org ...` — Allows Telegram iframe  
- `frame-ancestors 'self' https://web.telegram.org https://telegram.org https://k.telegram.org https://z.telegram.org https://a.telegram.org` — Permits embedding in Telegram Mini App  
- `object-src 'none'` — No plugins  
- `form-action 'self' https://my.click.uz https://checkout.paycom.uz` — Form submission to payment gateways only

**API Cache Control (line 109):**
- `/api/*` — `Cache-Control: private, no-store` — No caching

**File Download CSP Override (line 122):**
- `/api/generations/[id]/file` — `Content-Security-Policy: frame-ancestors 'self'` — Custom CSP for PDF/DOCX delivery (line 122 config overrides global)

**Output Mode (line 88):**
- `output: "standalone"` if `NEXT_OUTPUT=standalone` env — Minimal Docker bundle

**Images (line 86):**
- `images: { unoptimized: true }` — **Next Image optimization disabled** (sharp CVE GHSA-f88m-g3jw-g9cj, requires Next 16; workaround: no optimization)

**External Packages (line 74):**
- `serverExternalPackages: ["unpdf", "pg", "sharp"]` — Don't bundle (native modules)

---

### `instrumentation.ts` (lines 1–41)

**Boot sequence:**

1. Load env, check runtime config (warnings in dev, errors in prod)  
2. Run migrations via `ensureMigrated()` (one-time, waits for schema)  
3. Start inline worker if `WORKER_INLINE=true` (default; async background job processor)  
4. **No cron jobs defined here** — separate schedule management

**Critical:** Prod boot fails if config incomplete (e.g., missing DATABASE_URL or auth secrets when required).

---

### Root Config Files

**`eslint.config.mjs`:**
- Standard Next.js + TypeScript linting

**No `middleware.ts` at project root:**
- CSRF checks inline via `checkOrigin()` in route handlers (`api.ts:64`)  
- Auth via `requireUser()`/`requireAdmin()` in each route
- Rate limiting via `rateLimit()` call per route

---

## 4. Cron/Maintenance Entry Points

| Path | Trigger | Auth | Function |
|------|---------|------|----------|
| `/api/health` | GET (internal polling) | `Authorization: Bearer <CRON_SECRET>` (optional; detailed response requires it) | Database + queue status; config validation; feature flags |
| **No explicit cron routes** | Background jobs (inline worker) | N/A | Job dequeue, LLM calls, file generation (worker loop, not HTTP) |
| **Rate limit purge** | Scheduled (interval TBD) | N/A | `purgeRateLimits()` (RATE_LIMIT_PURGE_INTERVAL = "25 hours") — cleans old rate limit windows from DB |
| **Migrations** | Boot-time (`instrumentation.ts:29`) | N/A | `ensureMigrated()` runs all `.sql` files in `lib/server/migrations/` on first request/startup |

**Rate limit purge frequency note (line 58 in `ratelimit.ts`):**  
- Purge interval must exceed longest rate limit window (now 86,400 s = 1 day for polish/daily limits)  
- "25 hours" allows 1-day windows to roll without data loss mid-window

---

## 5. Observations for Auditors

### Critical Security Findings

1. **`/api/payments/click` & `/api/payments/payme` — Public webhooks rely entirely on signature validation**  
   - Click: MD5 signature (weak crypto, but protocol mandates it)  
   - Payme: Basic auth in header (no HTTPS enforcement in config — only in deployment)  
   - **File:** `app/api/payments/{click,payme}/route.ts`  
   - **Risk:** If signature computation or header parsing is bypassed, arbitrary payments can be confirmed  
   - **Mitigation:** Signatures checked via `clickSignatureValid()` and `payme` SDK validates auth; replay prevented by idempotent `reference`

2. **`/api/generations/[id]/*` file handling — Stale file race condition mitigated by version check**  
   - `ensureFreshFile()` (line 50 in `/api/generations/[id]/file/route.ts`) rebuilds PPTX if `doc_version > file_version`  
   - **File:** `lib/server/slide-commit.ts`  
   - **Matches design principle:** "ko'rdim = oldim" — view matches download  
   - **Audit:** Verify `file_version` and `doc_version` columns exist in `generations` table and always incremented atomically

3. **`/api/extract` — Header-first size check prevents OOM on large uploads**  
   - `Content-Length` validated before `req.formData()` (line 23)  
   - Output also truncated (line 48)  
   - **File:** `app/api/extract/route.ts`  
   - **Design:** Prevents attacker from sending 1 GB to cause server crash during parse

4. **`/api/auth/telegram` & `/api/auth/session` — Signature verified server-side, client `id` never trusted**  
   - Bot token stored server-side in env; Telegram signature verified with it  
   - **Files:** `lib/server/auth.ts` (`verifyLoginWidget`, `verifyMiniAppInitData`)  
   - **CSRF:** `checkOrigin()` enforces `Sec-Fetch-Site` + host match or whitelist (`api.ts:99`)  
   - **Session:** httpOnly cookie, SHA-256 hash in DB

5. **`/api/users/me` PATCH — Whitelist-only editable fields**  
   - `EDITABLE` array (line 23–38) hardcoded; points/quota/balance never updateable  
   - **File:** `app/api/users/me/route.ts`  
   - **Prevents:** Credit gift-to-self attacks

6. **`/api/admin/*` routes — No rate limit; trust `requireAdmin()` check**  
   - `requireAdmin()` uses session `is_admin=true` OR hardcoded admin user ID  
   - **File:** `lib/server/admin.ts` (check implementation)  
   - **Risk if bypassed:** Admin could arbitrarily adjust user balances  
   - **Audit:** Verify `is_admin` flag is never writable by users; admin ID hardcoded/env-based

7. **Rate limiting — Fixed-window in DB, shared across instances**  
   - Stored in `rate_limits(bucket, window_start, hits)` table  
   - Window calculated from current time + window size (line 27 in `ratelimit.ts`)  
   - **Files:** `lib/server/ratelimit.ts`  
   - **Risk:** Clock skew across servers → window boundaries misaligned  
   - **Audit:** Verify all servers use NTP; purge job doesn't interfere with active windows

### Functionality & Consistency

8. **Tarjima (translation) — Source file `chars` overridden server-side to prevent price fraud**  
   - Client can send `sourceChars`, but `/api/generations` line 63–85 recalculates:  
     - File upload: fetches from `source_uploads.chars` (measured at upload time)  
     - Text mode: computes from `sourceText.length`  
   - **Files:** `app/api/generations/route.ts`, `lib/server/source-upload.ts`  
   - **Design:** Prevents "upload 200k chars, pay for 1k" attacks

9. **Price always server-side (never client-side)**  
   - `priceFor(tool, values)` called line 103 in `/api/generations/route.ts`  
   - Client's `price` field ignored  
   - **File:** `lib/tools.ts` `priceFor()`  
   - **Matches CLAUDE.md rule:** "Narx serverda hisoblanadi"

10. **Public game tokens — No user context, only token validation**  
    - `publicGameView()` sanitizes response (doesn't return full doc)  
    - Token must exist, doc must be COMPLETED, status checked  
    - **Files:** `/api/o/[token]/route.ts`, `lib/game/public.ts`  
    - **Risk if token enumeration possible:** Attacker could brute-force valid tokens (128-bit, 2^128 space — infeasible)  
    - **Audit:** Verify token generation uses crypto.getRandomValues()

11. **File uploads — Sniff validation prevents ZIP-bomb attacks on template/source parsing**  
    - `snapImageType()` validates image files  
    - DOCX/ZIP extraction has limits  
    - **Files:** `lib/server/source-upload.ts`, `lib/server/template-upload.ts`  
    - **Risk:** PDF parsing via `unpdf` — large compressed PDFs could timeout; mitigated by `maxDuration: 60`

### Observational (No Blocker)

12. **CSP `unsafe-inline` permitted intentionally**  
    - Next.js requires inline scripts for runtime  
    - SSG pages (`/uz/[slug]`) can't use nonce approach  
    - Trade-off documented in config (lines 33–46)  
    - **Mitigation:** `Content-Type: nosniff`, CSP `default-src 'self'`, no user-controlled script paths

13. **No session timeout enforcement in code**  
    - Session TTL only at DB level (TTL column)  
    - **File:** `lib/server/session.ts`  
    - **Design:** Stateless; client responsible for re-login  
    - **Audit:** Verify session.expiresAt is actually enforced on `requireUser()`

14. **Admin users hardcoded or determined by SQL flag**  
    - `requireAdmin()` checks `is_admin` column in users table  
    - **Risk:** If users table ever directly writable, escalation possible  
    - **Audit:** Verify users table structure — is_admin should be non-nullable, default false, only mutable via admin API

15. **Request body size limits — Various per endpoint**  
    - `/api/extract`: `EXTRACT_MAX_BYTES` (~10 MB)  
    - `/api/generations`: `1_200_000` bytes (line 42) — tarjima 200k chars + JSON overhead  
    - `/api/users/me` PATCH: `20_000` bytes  
    - `/api/generations/[id]/polish`: `4 * 1024` bytes  
    - **File:** Various route handlers call `readJson(req, limit)`  
    - **Design:** Per-endpoint basis, no global middleware limit  
    - **Audit:** Verify `readJson()` enforces size before parsing; check for `req.text()/arrayBuffer()` calls without pre-check

16. **No explicit brute-force protection on login endpoints**  
    - `/api/auth/otp` has per-user & per-IP limits (lines 3–5 in `otp/route.ts`), but no progressive backoff  
    - `/api/auth/telegram` limits IP-based (line 33)  
    - **Design:** Rate limit is the only defense; no CAPTCHA, no account lockout  
    - **Audit:** Test OTP endpoint with 3 wrong codes/user/300s then subsequent request — should 429

17. **CRON_SECRET is SINGLE credential for all webhooks and internal endpoints**  
    - Telegram webhook, `/api/health` detailed view, potentially others  
    - If leaked, attacker can submit fake Telegram updates or health probes  
    - **File:** `telegram/webhook/route.ts` line 28, `health/route.ts` line 25  
    - **Mitigation:** Long random string (openssl rand -base64 48), env-only, never logged  
    - **Audit:** Verify CRON_SECRET ≥32 bytes entropy; check logs for accidental leaks

### Missing Endpoints / Edge Cases

18. **No explicit rate limit on `/api/auth/telegram`; uses client IP**  
    - Limit: 20/5min per IP (line 33 in `/api/auth/telegram/route.ts`)  
    - **Risk:** Shared proxies / school networks → legitimate users blocked  
    - **Design:** IP-based for auth is standard; trade-off accepted

19. **Admin password/2FA not implemented**  
    - Admin user identified by hardcoded ID or `is_admin=true` in DB  
    - No additional auth step for sensitive operations (balance adjustment)  
    - **Files:** `/api/admin/users/[id]` line 1 calls `requireAdmin()`  
    - **Design:** Internal tool; deployment guards via IP whitelist expected  
    - **Audit:** Verify admin endpoints are NOT exposed to internet; firewall rule required

20. **`/api/curriculum` — Static data, no authentication despite `requireUser`**  
    - Hardcoded data in `data/curriculum.json` (8 subjects, 2424 topics)  
    - Rate limit: per-user (LIMIT_PER_MIN, likely 60)  
    - **Design:** Public reference data, but requires login (prevents scraping bot)  
    - **Audit:** If curriculum should be public, remove `requireUser` and increase rate limit or add CORS

---

## Summary

**Total API routes:** 43 files, 51+ exports  
**Public routes (no `requireUser`):** 11 (auth, webhooks, health, public game)  
**Authenticated routes:** 32 (require valid session)  
**Admin routes:** 2 (require `is_admin` flag)  
**Rate limits:** 20+ unique buckets (user-id, IP, per-doc, global hourly)  
**Signature-protected webhooks:** 2 (Click, Payme)  
**Token-protected webhooks:** 1 (Telegram, CRON_SECRET)

**Key architectural strengths:**
- SQL-level ownership checks (WHERE `user_id=$2`) on all data access  
- Server-side price calculation (never trusted from client)  
- Atomic credit debit + job enqueue (single transaction)  
- Stale-file prevention (version checking before download)  
- Header-first size validation (prevents OOM on uploads)  
- CSRF via Origin + Sec-Fetch-Site checks  

**Key risks to validate:**
- Admin escalation vector (hardcoded ID, single CRON_SECRET, no 2FA)  
- Rate limit clock skew (NTP dependency)  
- Signature validation in webhooks (MD5 weak but protocol-mandated)  
- CSP `unsafe-inline` (mitigated by `default-src 'self'`)  
- Static file serving (test for directory traversal in asset paths)
