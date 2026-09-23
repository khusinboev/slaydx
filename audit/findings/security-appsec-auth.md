# security-appsec (auth) — findings
Scope actually covered: `lib/server/{api,session,auth,telegram,admin,admin-phones,ratelimit,game-sessions,env,payments,assets,storage,slide-image}.ts`, every `app/api/**/route.ts` (auth/session/telegram/otp, generations/[id]/*, uploads/*, admin/*, payments/*, o/[token]/*, health, users/me), `app/uz/admin/page.tsx`, `app/o/[token]/page.tsx`, `next.config.ts`, `instrumentation.ts`, `docker-compose.yml`, `.env.example`, `Dockerfile`, `scripts/bot.mts`, `components/overlays/LoginModal.tsx` + `returnTo` producers, `lib/game/public.ts` (answer-key stripping). Verified Next.js 15.5.23 router redirect behaviour in `node_modules`.
Not covered (out of scope / other auditors): payment credit math & idempotency internals (payments/DB auditor) — only webhook signature auth checked; generation/worker internals; DB schema drift; file-parsing DoS (upload-size auditor). nginx vhost config is out-of-repo (see SECA-03).
Summary: P0 1 · P1 0 · P2 1 · P3 3

### SECA-01 — Any Telegram user can become admin: the bot accepts a forged contact (no `user_id`) and the 9-digit phone form dodges the unique index
- **Severity:** P0
- **Location:** `lib/server/telegram.ts:301` (contact ownership check), `lib/server/telegram.ts:305-311` (raw phone stored), `lib/server/telegram.ts:330`; `lib/server/admin-phones.ts:17,27-30,34-37` (`ADMIN_PHONES`, `normalizePhone`, `isAdminPhone`); `lib/server/migrations/008_admin.sql:12` (unique index on the raw string); consumers `lib/server/session.ts:110`, `lib/server/admin.ts:21`, `app/uz/admin/page.tsx:18`
- **Evidence:**
  - Ownership check only rejects a contact whose `user_id` is present AND different:
    `if (contact.user_id != null && contact.user_id !== fromId) { … return; }`.
    In the Bot API `Contact.user_id` is *optional*: it is absent whenever the shared contact is an
    address-book entry / any number Telegram does not resolve for the sender (unregistered number, or the
    owner's "find me by number" privacy). Any user can send such a contact (mobile app: Attach → Contact
    from the phone book; or any MTProto client, e.g. Pyrogram `send_contact(bot, phone_number=…, first_name=…)`).
    Missing `user_id` therefore passes, although the comment above the function says only the sender's own
    contact is accepted.
  - The phone is stored as `+${digits}` exactly as sent, and the unique index is on that raw text
    (`CREATE UNIQUE INDEX users_phone_key ON users(phone)`), but admin detection normalises:
    `normalizePhone` turns any 9-digit string into `998…`. So `+<9 national digits>` (the hardcoded admin
    number without `998`) is a *different* row value from the real admin's `+998…` (no unique conflict),
    yet `isAdminPhone()` returns true for it.
  - The admin number is hardcoded in a PUBLIC repo (`admin-phones.ts:17`), so the target value is known.
  - `rowToUser` sets `isAdmin` from `phone` on every request and `requireAdmin` trusts it, so the attacker's
    existing session immediately passes `/api/admin/*` and `/uz/admin`.
  - Impact: `PATCH /api/admin/users/:id` credits up to 100 000 000 per call to any wallet (unbounded free paid
    LLM/image generation = direct money loss), `PUT` blocks any user including the real admin (who then
    cannot unblock himself), `GET /api/admin/users` dumps all users' names, usernames, Telegram ids, phones.
  - Precondition: attacker has any Telegram account and has logged in once (bot `/start` → link). Nothing else.
- **Reproduction:**
  1. Open the bot, `/start`, click the login link (creates `users` row with attacker's `telegram_id`).
  2. Send the bot a contact whose `phone_number` is the 9 national digits of the number in `ADMIN_PHONES`
     (Pyrogram: `await app.send_contact("<bot>", phone_number="<9 digits>", first_name="x")`).
     Bot replies «✅ Admin sifatida tasdiqlandingiz.»
  3. `curl -s -b 'slaydx_session=<attacker cookie>' https://<host>/api/admin/users` → 200 with the user list;
     `curl -X PATCH -H 'Content-Type: application/json' -H 'Origin: https://<host>' -b … -d '{"wallet":"balance","delta":100000000}' https://<host>/api/admin/users/<attacker id>` → credited.
  - Unit sketch (fails today): seed `users(telegram_id=111)`; `await handleUpdate({update_id:1,message:{chat:{id:111},from:{id:111},contact:{phone_number:"<9 digits>"}}})`;
    `assert.equal((await getUserById(id)).isAdmin, false)` → currently `true`. Same with `phone_number:"+998…"` when the real admin row has no phone yet.
  - Compromise check on prod DB (read-only): `SELECT id, telegram_id, phone FROM users WHERE regexp_replace(phone,'\D','','g') IN ('998<9>','<9>');` must return only the real admin; also review `transactions WHERE kind IN ('admin_credit','admin_debit')`.
- **Proposed fix:** (1) `handleContact`: require `contact.user_id === fromId` (reject when absent) and ignore forwarded messages (`forward_origin`/`forward_date`). (2) Store one canonical form (`"+" + normalizePhone(...)`) so the unique index sees normalised values, and make `isAdminPhone` compare the exact canonical E.164 value (drop the 9-digit expansion for admin checks). (3) Better: bind admin to hardcoded/env Telegram user ids (`from.id` is unforgeable) instead of a phone number. (4) Clean any non-canonical admin-matching `phone` rows and audit admin transactions.
- **Effort:** S
- **Confidence:** high (code path is unambiguous; the only external fact — Bot API `Contact.user_id` is optional and absent for arbitrary/unresolved contacts — is documented Bot API behaviour; confirm with the unit sketch above).

### SECA-02 — Post-login open redirect via `returnTo` query param
- **Severity:** P2
- **Location:** `components/home/HomeFiles.tsx:31-32` (`const ret = params.get("returnTo"); … open("login", { returnTo: ret })`), consumed at `components/overlays/LoginModal.tsx:42` (`if (returnTo) router.push(returnTo)`).
- **Evidence:** `/uz?returnTo=<attacker-value>` is read verbatim from the query string and, after the victim logs in, passed straight to `router.push(returnTo)`. Next.js `router.push` treats any value whose parsed origin differs from the site origin as an external URL and performs a hard `location.assign(canonicalUrl)` (`node_modules/next/dist/client/components/app-router.js:59-60` `isExternalURL`, `:270-280` MPA `location.assign`). So `returnTo=https://evil.example/login` redirects the freshly-authenticated user off-site. No allow-list or same-origin check anywhere on this path (other `returnTo` producers pass only hard-coded `/uz/...` strings, but this one is attacker-controlled). Impact is phishing: a link that looks like the real site sends the user, right after a successful login, to a look-alike page. `javascript:`-scheme values are largely neutralised by modern browsers' block on `location.assign('javascript:…')`, so the practical impact is the external HTTP(S) redirect.
- **Reproduction:** Send a victim `https://<host>/uz?returnTo=https://evil.example/phish`. Victim (not logged in) sees the login modal open automatically, logs in via Telegram, and is then navigated to `https://evil.example/phish`.
- **Proposed fix:** In `HomeFiles.tsx` accept `ret` only if it is a same-site path: `if (ret && ret.startsWith("/") && !ret.startsWith("//"))`. Better, centralise a `safeReturnTo()` helper (reject values containing `:` or starting with `//`) and use it wherever `returnTo` is set from untrusted input.
- **Effort:** S
- **Confidence:** high

### SECA-03 — Rate-limit client IP trusts the last `X-Forwarded-For` hop; spoofable if nginx is not configured to overwrite/append it
- **Severity:** P3 (becomes P1 if the nginx vhost does not normalise `X-Forwarded-For`)
- **Location:** `lib/server/ratelimit.ts:78-95` (`clientIp`), enabled by `docker-compose.yml:91` (`TRUST_PROXY: true` default) and `lib/server/env.ts:142`.
- **Evidence:** With `TRUST_PROXY=true` the app takes `x-forwarded-for.split(",").pop()` as the client IP. This is correct only if the fronting nginx **replaces** the header or **appends** the real peer (the `$proxy_add_x_forwarded_for` idiom), so the last element is trustworthy. nginx by default forwards inbound request headers to the upstream, so if the `slaydx` vhost lacks a `proxy_set_header X-Forwarded-For …` directive, a client-supplied `X-Forwarded-For` reaches the app unchanged and its last element is attacker-controlled. The web port is bound to `127.0.0.1:3000` (compose), so requests must pass through nginx — but that does not by itself sanitise the header. If spoofable, every IP-keyed limit is bypassed by sending a fresh `X-Forwarded-For` per request: `tg:${ip}` (Telegram login 20/5min), `ticket:new:${ip}`, `otp:ip:${ip}`, `enter:${ip}`, `o:submit:${ip}` — enabling auth brute-force and queue/LLM resource exhaustion under load. The nginx config is not in the repo, so this cannot be confirmed here.
- **Reproduction:** From the internet, `for i in $(seq 1 100); do curl -s -H "X-Forwarded-For: 10.0.0.$i" -X POST https://<host>/api/auth/telegram/ticket -H 'Origin: https://<host>'; done`. If each request is counted under a different bucket (never 429 before 100), the header is trusted end-to-end → spoofable. Confirm by reading `/etc/nginx/sites-available/slaydx` for `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (safe) vs. absent/`$http_x_forwarded_for` (unsafe).
- **Proposed fix:** Ensure the nginx vhost sets `proxy_set_header X-Forwarded-For $remote_addr;` (single trusted proxy — simplest and unspoofable) or `$proxy_add_x_forwarded_for`. Defensively, make `clientIp` take the *n*-th-from-last entry where *n* = a configured trusted-proxy hop count, rather than blindly the last element, and document the required nginx directive next to `TRUST_PROXY`.
- **Effort:** S
- **Confidence:** medium — mechanism is certain; whether it is live depends on the out-of-repo nginx config.

### SECA-04 — `DELETE /api/auth/session` (single-session logout) skips `checkOrigin` → logout CSRF under `SameSite=None`
- **Severity:** P3
- **Location:** `app/api/auth/session/route.ts:27-36`. The `?all=1` branch calls `requireUser` (which runs `checkOrigin`), but the default branch calls `revokeCurrentSession()` + `clearSessionCookie()` with no auth/origin check.
- **Evidence:** `checkOrigin` is the project's sole CSRF defence when `SESSION_COOKIE_SAMESITE=none` (the explicitly-supported Telegram-web-iframe config, `env.ts:117-132`). Every other mutation runs it via `requireUser`/explicit call; this branch does not. Under `SameSite=None`, a third-party page can `fetch('https://<host>/api/auth/session',{method:'DELETE',credentials:'include'})` and force-log-out the victim. Under the default `SameSite=Lax`, a cross-site `DELETE` fetch does not carry the cookie, so the practical window is the `none` deployment. Impact is limited to forced logout (nuisance / denial of session); no data loss.
- **Reproduction:** With the site running `SESSION_COOKIE_SAMESITE=none`, host an attacker page that fires the credentialed `DELETE` fetch above; a logged-in visitor is silently logged out.
- **Proposed fix:** Call `requireUser(req)` (or at least `checkOrigin`) in both branches of the DELETE handler before revoking; logout is a state change and should get the same CSRF treatment as every other mutation.
- **Effort:** S
- **Confidence:** high

### SECA-05 — Bot-initiated magic link enables login-CSRF (session fixation into the attacker's account)
- **Severity:** P3
- **Location:** `lib/server/telegram.ts:151-161` (`createBotLoginLink`), `:337-411` (`/start`,`/login` send the link), `app/api/auth/telegram/enter/route.ts:110-141` (`GET …/enter?t=` opens a session in whatever browser loads it, no origin/confirmation).
- **Evidence:** The site-initiated ticket flow is safe (the magic link is delivered only to the victim's own Telegram chat, and the attacker's polling browser never receives the token — as the code comments argue). But the bot-initiated flow lets an attacker press `/start` (or `/login`) on the bot, receive a valid one-time `…/enter?t=<token>` link **bound to the attacker's own Telegram profile**, and forward that link to a victim. The `enter` route deliberately has no `checkOrigin` and no confirmation step (it must work as an off-site navigation from Telegram), so when the victim clicks it their browser is issued a session cookie for the **attacker's** account. The victim, believing it is their own session, may upload a resume (name, photo, personal data), generate documents, or top up credits — all of which land in the attacker's account for later retrieval/spending. One-time + 5-min expiry do not prevent this (attacker mints the link on demand).
- **Reproduction:** Attacker: message the bot `/login`, copy the `…/enter?t=…` URL from the reply. Send it to a victim (e.g. "log in to SlaydX here"). Victim clicks, lands logged-in; anything they do is in the attacker's account. Attacker then logs into their own account normally and sees it.
- **Proposed fix:** Make `/enter` land on an interstitial that names the account being entered ("Continue as @<username>?") requiring a same-origin POST to finalise, and/or bind the token to a value only the initiating browser holds (site-initiated flow already achieves this — consider restricting auto-session creation to that path and having the bot-initiated `/start` link instead deep-link back to the site to start a browser-bound ticket).
- **Effort:** M
- **Confidence:** medium — mechanism is certain; severity kept at P3 because exploitation needs the victim to keep using an account that is visibly not theirs.


## Checked and OK
- **Session tokens**: `randomBytes(32)` (256-bit), stored only as SHA-256 (`session.ts:156-183`); cookie is `httpOnly`, `secure` when prod or SameSite=None, `SameSite` from env; validated with `token_hash = $1 AND revoked_at IS NULL AND expires_at > now()` (`session.ts:214-236`). No session fixation: cookie is set only after successful auth with a fresh token.
- **Blocked users**: `currentUser` returns `null` when `is_blocked` (`session.ts:228`), so a blocked user is denied on the next request even though existing session rows are not force-revoked.
- **Logout-all / revocation**: `revokeAllSessions` (`session.ts:250-255`) and `revokeCurrentSession` work; `?all=1` is properly `requireUser`-gated (but see SECA-04 for the single-session branch).
- **Telegram signature verification**: Login Widget uses `secret=SHA256(botToken)`, Mini App uses `secret=HMAC("WebAppData",botToken)`; both timing-safe compare (`safeEqual`) and reject `auth_date` older than 24h; client `id`/`user` never trusted without a valid hash (`auth.ts:36-99`). Missing `auth_date` → rejected.
- **OTP**: 5-digit `randomInt(10000,100000)`, hashed (`HMAC-SHA256(sessionSecret, id:code)`), 2-min TTL, 5-attempt cap per code, `safeEqual`, per-identifier (3/600 req, 10/600 verify) + per-IP (15/600, 30/600) limits (`auth.ts:142-208`, `otp/route.ts`). `DEV_LOGIN_ENABLED` defaults false in prod and `instrumentation.ts` refuses to boot prod if it is on (`env.ts:239-241`, `instrumentation.ts:21-24`); the OTP route also 503s when the flag is off. No hardcoded/bypass codes.
- **Login-ticket single-use**: `redeemLoginToken` runs `SELECT … FOR UPDATE WHERE consumed_at IS NULL AND expires_at > now()` then sets `consumed_at` in one transaction (`telegram.ts:174-205`); token stored only as HMAC hash; 5-min TTL. Site-initiated flow is not vulnerable to nonce-forwarding session-swap (only the bot-initiated variant is — SECA-05).
- **IDOR — generation `[id]` routes**: all of route/file/doc/doc·restore/rebuild/rewrite/polish/results/share/thumb/photo/slides·image/assets·[assetId] pass `user.id` into helpers that enforce `WHERE id=$1 AND user_id=$2` (`jobs.ts:213-704`, `assets.ts:225-236` `getAsset`, `game-sessions.ts` `createGameSession`/`listResults` join on `user_id`). UUID-format guard on every `[id]`.
- **IDOR — uploads**: `source_uploads`/`template_uploads`/`user_photos`/`logo_uploads` are keyed by `user_id` PK and their GET/DELETE use `WHERE user_id=$1 AND asset_id=$2`; POSTs are `requireUser` + rate-limited.
- **Public game endpoints**: 128-bit token (`randomBytes(16)`), `TOKEN_RE` guard, ownership by token only; `publicGameView` (`lib/game/public.ts`) rebuilds each view field-by-field and strips every answer key (crossword cells → booleans, quiz correct-index dropped, sorting item→category mapping removed, options shuffled deterministically); scoring is server-side (`scoreAnswers`), the submit response returns only the score, not the key. Audio route re-checks the asset belongs to the token's game.
- **Price/credit trust**: `/api/generations` recomputes price server-side and ignores client `price`; `/api/users/me` PATCH is a hardcoded field whitelist (field names are constants, values sliced to 200, null-stripped) — no wallet fields writable. `admin/users/[id]` PATCH bounds `|delta|` and validates wallet enum.
- **CSRF**: `checkOrigin` (`api.ts:64-107`) rejects `Sec-Fetch-Site` other than same-origin/none and validates `Origin` host against Host + `ALLOWED_ORIGINS`; applied to every mutation via `requireUser`/`requireAdmin` (non-GET) or explicit call (auth, o/submit) — the one gap is SECA-04. No `null`/missing-Origin bypass that matters (such requests carry no cookie).
- **CORS**: no `Access-Control-Allow-*` headers anywhere; client fetch uses `credentials: "same-origin"`.
- **Security headers** (`next.config.ts`): CSP with `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self' + telegram` (clickjacking on the editor limited to Telegram origins); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Cross-Origin-Resource-Policy: same-origin`; `Permissions-Policy` locks down camera/mic/geo/payment/usb; HSTS (2y, preload) in prod; `no-store` on `/api/*`; asset/file responses add `Content-Security-Policy: default-src 'none'; sandbox` + `nosniff`. `unsafe-inline` in `script-src` is a documented, mitigated trade-off (no `unsafe-eval` in prod).
- **Telegram webhook & /api/health detail**: gated by `CRON_SECRET` with `safeEqual`; webhook 503s if the secret is unset (never silently falls back to `SESSION_SECRET`).
- **Payment webhooks**: Click MD5 signature includes the secret and is timing-safe-compared, plus service_id/amount/order-state checks (`payments.ts:53-66`); Payme `Basic` auth SHA-256 timing-safe compared against test+prod keys with strict base64 validation (`payments.ts:76-106`). No `requireUser`/`checkOrigin` needed (server-to-server).
- **Error hygiene**: `serverError` hides internals in prod (`api.ts:27-37`); admin/not-found return 404 (`requireAdmin`, `/uz/admin` `notFound()`) so the admin surface is not disclosed.
- **Secrets**: `SESSION_SECRET` must be ≥32 chars in prod or boot fails (`env.ts:52-64`); `.env.example` ships all secrets blank; compose binds web to `127.0.0.1` and Postgres is `expose`-only. No secrets read during this audit.
- **Minor / accepted**: `uploadSlideImage` (`slide-image.ts:72`) calls `putAssetBytes(id,…)` before `commitDocOps` verifies ownership, so an asset row can be written under a foreign generation — but only for an *existing* generation UUID (FK-enforced, UUIDv4 unguessable), the row is content-addressed, never referenced by the victim's doc, and not readable by the attacker (`getAsset` checks owner); rate-limited 30/hr. Near-unexploitable storage-junk; worth reordering (ownership check first) as defense-in-depth, not tracked as a separate finding.
