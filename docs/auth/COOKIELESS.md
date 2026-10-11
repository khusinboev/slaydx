# Cookieless sessions (bearer fallback for webviews that refuse cookies)

Status: implemented on `fix/cookieless-session` (2026-10-11). Owner bug: in
Telegram Desktop (Linux) the Mini App asks «… sifatida kirasizmi?», «Kirish»
gets `200` from `POST /api/auth/bot-link` and a `sessions` row is created, but
every following API call from that webview is `401`.

## 1. Investigation

### Where the session lives

| Piece | File | Notes |
|---|---|---|
| Token issue | `lib/server/session.ts createSession` | 32 random bytes, base64url (43 chars); only `sha256(token)` is stored in `sessions.token_hash` |
| Transport | `setSessionCookie` | `slaydx_session`, httpOnly, `Secure` in prod (or with `SameSite=None`), `SameSite=env.sessionSameSite` (default `lax`), path `/`, `Expires` |
| Read | `currentSessionRef` / `currentUser` | `cookies()` → hash → `sessions JOIN users`, `revoked_at IS NULL`, `expires_at > now()`, user not blocked, `last_seen_at` written at most hourly |
| Consumer API gate | `lib/server/api.ts requireUser` / `optionalUser` | every consumer route; strict `checkOrigin` on non-GET first |
| Admin binding | `lib/server/admin-session.ts resolveAdminContext`, `admin-handler.ts adminAuthHandler`, `app/admin/layout.tsx` | admin sessions are bound to the user `sessions` row (`admin_sessions.user_session_id`); admin has its own cookie as well |
| Logout | `app/api/auth/session/route.ts DELETE` | `revokeCurrentSession` (by cookie token) or `revokeAllSessions` |

Endpoints that create a session: `POST /api/auth/telegram` (Mini App
`initData` or Login Widget), `POST /api/auth/bot-link` (bot keyboard `?bt=`
link, after «Kirish»), `POST /api/auth/otp?action=verify` (phone/OTP, only with
`DEV_LOGIN_ENABLED`), `POST /api/auth/telegram/enter` (HTML form page opened
from the bot in a real browser), admin auto-entry (`/api/admin/auth/auto`,
admin cookie only, needs a user session).

Client: every consumer call goes through `lib/api-client.ts request()`
(`credentials: "same-origin"`, the browser attaches the cookie). The store
(`lib/store.ts`) hydrates `user`/`sessionChecked` from `GET /api/auth/session`;
a `401` on any non-auth call runs `onUnauthorized` and signs the UI out — this
is exactly the owner's symptom (`bot-link` 200 → `GET /api/generations` 401 →
signed out). Consumer pages do not read the session during SSR (only
`app/admin/layout.tsx` calls `currentUser()`), so signed-out HTML + client
hydration is already the normal path.

Subresources that need the session but cannot carry a header: `<img>` thumbs
(`/api/generations/{id}/thumb`), generation assets in slides / documents /
image viewer / resume (`/api/generations/{id}/assets/{asset}`), resume photo
(`/api/uploads/photo/{id}`), audio (`/api/generations/{id}/file?inline=1`), the
translator PDF iframe. Downloads already use signed, cookie-free
`/api/dl/<token>` URLs.

### Root cause (as far as it can be established without a real Telegram Desktop)

Established: the server issues the cookie (prod row exists, `200`), the very
next same-origin `fetch` from the webview arrives without it. So the webview
either drops our `Set-Cookie` or never sends it back. Mobile clients keep it.

Candidates (NOT verified — no Telegram Desktop build available here):

1. The desktop webview's cookie policy refuses cookies outright (WebKitGTK
   `WebKitCookieAcceptPolicy` set to "never", or an ephemeral network session
   with cookie storage disabled; WebView2/WKWebView hosts can do the same).
2. The page runs as a third-party frame (a wrapper page or `web.telegram.org`
   embeds it). There `SameSite=Lax` cookies are neither set nor sent on
   `fetch`, and ITP / third-party-cookie blocking refuses even
   `SameSite=None; Secure` unless `Partitioned` (CHIPS) is honoured.

`SameSite=None; Secure; Partitioned` would only help case 2 and only on
engines with CHIPS; it cannot be measured here (the reproduction below has to
simulate the refusal by stripping `Set-Cookie`, which no attribute survives).
Per the brief it is therefore NOT implemented; `SESSION_COOKIE_SAMESITE=none`
already exists as an owner-side experiment. The bearer fallback below works
for every cause because it does not depend on the cookie jar at all.

### Reproduction

Playwright WebKit is not installed on this machine (only Chromium builds in
`~/.cache/ms-playwright`), so the end-to-end reproduction is Chromium:
`scripts/smoke/cookieless-login.cjs` puts a tiny reverse proxy in front of
`next dev` (test database) that removes every `Set-Cookie` header — the
observable behaviour of a cookie-refusing webview — then opens `/uz?bt=…`,
taps «Kirish» and visits `/uz`, `/uz/files`, `/uz/wallet`, `/uz/profile`,
`/uz/create`. (CDP `Fetch` interception was tried first and does not see
`Set-Cookie`.)

- Before (main `22c01ae`): `bot-link 409 → 200`, cookie jar empty, every page
  signed out (wallet shows «Kirish»), exit 1.
- After: `bot-link 200` (cookie) → probe signed out → `bot-link 200` (opt-in)
  → every following `/api` call carries the bearer, no 401 on any page, wallet
  shows the balance, cookie jar still empty, exit 0; one
  `[auth] bearer-mode session issued` line.

Unit-level: `tests/auth-cookieless.test.mts` (server; 8 of 10 fail on main's
server code) and `tests/ui/cookieless-login.test.mts` (client, jsdom, a
simulated server with real session state that never keeps cookies).

## 2. Design

Opt-in **bearer transport for the same `sessions` rows**. Nothing changes for
clients whose cookies work.

1. **Detection after login (client).** `lib/api-client.ts loginExchange` runs
   every consumer login (`loginWithTelegram`, `verifyOtp`, `botLinkLogin`). On
   success it probes `GET /api/auth/session`. Probe returns the same user id →
   cookie transport works, done. Probe returns no user / another user → cookies
   are unusable: the flag is remembered for the tab and the exchange is
   repeated once with `X-Session-Transport: bearer` (bot-link tokens and
   `initData`/widget payloads stay valid for their lifetime). The answer then
   carries `sessionToken`; the client probes again with it and enters bearer
   mode only if that probe returns the same user.
   *Deviation:* OTP codes are single use (`consumeLoginCode`), so a verify is
   never repeated; the user gets «Yangi kod so'rang…» and, because the flag is
   remembered, the next verify opts in on the first attempt. Every later login
   in the same tab (account switch, re-login) also opts in directly, so no
   second session is created.
2. **Token on the client.** `lib/session-transport.ts` keeps it in memory and
   mirrors it to `sessionStorage` (try/catch; memory only when storage is
   blocked). `request()` adds `Authorization: Bearer …` to same-origin
   `/api/…` calls except `/api/admin/…`; a `401` on such a call drops the
   token. `useApiSrc`/`ApiImg` (`lib/use-api-src.ts`) load protected media with
   the header into `blob:` URLs (CSP already allows `blob:` for img/media);
   in cookie mode they return the original URL unchanged (no render change).
   Logout clears the token.
3. **Server reader.** `currentSessionRef(req)` / `currentUser(req)`: a valid
   cookie session wins; only when there is none is `Authorization: Bearer`
   (strict `^[A-Za-z0-9_-]{43}$`) looked up — same `hashToken`, same
   revoked/expired/blocked checks, same `last_seen_at` throttle. Without `req`
   (SSR pages, `app/admin/layout.tsx`, `admin-session.ts`, `admin-handler.ts`)
   the reader is **cookie-only**, so the admin panel stays browser-only and
   cannot be reached with a bearer token. Only `requireUser`, `optionalUser`,
   the three login routes (reuse/replace decisions) and logout pass `req`.
   *Deviation from "cookie wins when both are present":* an INVALID cookie does
   not shadow a valid bearer token — a webview that keeps sending an old
   revoked cookie while ignoring new `Set-Cookie` would otherwise stay locked
   out. A valid cookie always wins.
4. **Token issue.** `startSession(req, userId, ip)` creates the row, sets the
   cookie as before and returns `sessionToken` ONLY when the request carries
   `X-Session-Transport: bearer`; `sessionJson` puts it in the body with
   `Cache-Control: no-store`. Without the header the body is byte-for-byte the
   old one. Bearer sessions get a shorter lifetime (7 days, or
   `SESSION_TTL_DAYS` if lower).
5. **Logout / revoke.** `revokeCurrentSession(req)` revokes the cookie's row
   and the bearer token's row; logout-all, admin revoke and block act on rows,
   so they cover both transports.
6. **Observability.** One `info` line per bearer session issued:
   `[auth] bearer-mode session issued` with `route` and a user-agent family
   (`webkitgtk`, `webview2`, `wkwebview-mac`, `android`, `ios`, `other`) — no
   token, no full UA. No new tables.

What stays cookie-only: SSR/RSC, the admin panel, `/api/auth/telegram/enter`
(a real browser form flow), game player routes (public). Known gaps in bearer
mode: the translator «Fayl» PDF iframe and its «yangi oynada» link (a `blob:`
frame would need a CSP `frame-src` change), and lazy loading of thumbnails
(blob fetches start on mount).

## 3. Threat analysis

| Threat | Analysis / mitigation |
|---|---|
| Cross-site request forgery with the bearer | The header is not ambient: a foreign page cannot read the token or attach `Authorization` (no CORS on `/api`). The strict `checkOrigin` on mutations is unchanged and still runs first. |
| Token disclosure to normal clients | `sessionToken` only with the explicit `X-Session-Transport: bearer` request header, which a cross-site page cannot send without a CORS preflight we never answer. Whoever can send it already holds a valid login credential and could read `Set-Cookie` with curl anyway — no privilege gain. Tests lock "no header → no token". |
| XSS reads the token | Real trade-off: in bearer mode the token is readable by page JS (memory + `sessionStorage`). Limited by: bearer mode only after cookies were proven unusable; `sessionStorage` dies with the webview; 7-day row lifetime; revocable by logout / «Barcha qurilmalardan chiqish» / admin. The existing CSP (`script-src 'self' 'unsafe-inline' telegram.org`) stays the XSS defence. |
| Token in logs / URLs / caches | Never in a URL (no query param). `Cache-Control: no-store` on the response carrying it. `lib/server/log.ts` already redacts `Authorization`, `Bearer …`; this change adds `sessionToken` keys/JSON fields to the redaction. nginx access logs do not log request headers. |
| Brute force of tokens | 256-bit random secret; malformed values are ignored before any DB query. |
| Login CSRF / account swap through the opt-in retry | The retry hits the same route with the same checks: Origin, IP and per-account rate limits (it consumes the same buckets), `confirm: true` only after the user's «Kirish»/«O'tish», fresh `initData` required for a replace, phone sessions never replaced. |
| Admin escalation with a stolen bearer | The admin readers never look at `Authorization`; the panel needs the httpOnly user cookie plus the admin cookie. |
| Orphan session row | The first (cookie) attempt of a retried login leaves a row whose token was only in the dropped `Set-Cookie`; it is never readable by JS and expires with the normal TTL. Later logins in the tab opt in directly, so this happens at most once per tab. |
| Ambiguity cookie vs bearer | A valid cookie always wins; two credentials never merge. |
