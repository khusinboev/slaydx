# W4-C review — SECA-04, SECA-05, EXT-14, BEA-17/EXT-05, CONC-16, DEPS-04

Reviewer: independent, read-only. Branch `worktree-agent-aea95e08f2b326876` (`e8b8732..9d6efe7`) vs `audit/production-readiness`.

## Verdict: **CHANGES REQUESTED** (1 required change, small)

Everything else checks out. The one required change is a trap in the magic-link confirmation page. Right now it does no harm, but it would break Telegram login in every browser if anyone changed how Next merges headers. A test also locks the trap in place.

## Tests

The suite ran from the worktree root under `heavy2.sh -m 3G -t 900`: auth-logout-csrf, auth-enter-confirm, telegram-webhook, auth-first-login-race, deps-next-patch, telegram-bot-login and admin-contact. Result: **42/42 pass**, exit 0.

## Required changes

1. **Remove the route's `Referrer-Policy: no-referrer` on the confirmation page, or change it to `same-origin`. Fix the comment and the test to match.** (`app/api/auth/telegram/enter/route.ts` GET response; `tests/auth-enter-confirm.test.mts` asserts `referrer-policy === "no-referrer"`.)
   - Per the Fetch spec, a non-GET navigation from a document whose policy is `no-referrer` sends **`Origin: null`**. I checked this in headless Chromium (build 1243). A page served with `no-referrer` auto-submitted a POST form to itself and the request carried `Origin="null"`, `Sec-Fetch-Site=same-origin` and no `Referer`. The same page under `strict-origin-when-cross-origin` sent the real origin.
   - `checkOrigin` does `new URL("null")`, which throws, and then returns `false`. So the «Kirish» button would get **403 for every user**.
   - It works today only by accident. Next's `sendResponse` (`next/dist/server/send-response.js`) doesn't let the route overwrite a header that `next.config.ts headers()` already set, and the global `Referrer-Policy: strict-origin-when-cross-origin` applies to `/:path*`. So the route's `no-referrer` never reaches the browser. The code comment «token will not leak via Referer» describes protection that isn't in effect.
   - The unit test asserts the header on the raw `Response`. It never exercises the real merge and never sends `Origin: null`. The positive POST test uses `origin: http://localhost:3000`, which a real browser would not send under this policy.
   - The global `strict-origin-when-cross-origin` is already enough. The page's only links are same-origin, and cross-origin requests get the origin only.
   - Fix: drop the header, or use `same-origin`, which keeps `Origin` on the same-origin POST. Then change the test to assert the absence of `no-referrer`. Optionally add a POST case with `Origin: null` + `Sec-Fetch-Site: same-origin`, whether it is documented as rejected or accepted, so this failure mode is pinned down.

## Verified (no change needed)

**SECA-04 logout.** `checkOrigin` now runs before both branches. The only client caller is `lib/api-client.ts` (a same-origin `fetch` DELETE), and the Mini App iframe is same-origin too, so nothing legitimate breaks.

**SECA-05 enter flow:**
- **GET doesn't consume the token.** `peekLoginToken` is a plain `SELECT … consumed_at IS NULL AND expires_at > now()`. Link-preview bots and unfurlers don't carry our cookie, so they only see the page. Invalid tokens count against `enter:fail:<ip>`, and the wide bucket is only peeked on GET, so one login isn't counted twice.
- **POST consumes it once, atomically.** `redeemLoginToken` does `SELECT … FOR UPDATE` then `UPDATE consumed_at` in one transaction, and expiry is still enforced. The test shows a second POST gets the «eskirgan» error.
- **POST CSRF.** `checkOrigin` rejects a foreign Origin, and also rejects `Sec-Fetch-Site: cross-site` when Origin is missing. The global CSP has `form-action 'self'`.
- **Escaping.** `esc()` covers `& < > " '`. It is applied to the name, username, the other account's name, BRAND_NAME and the token (attribute context). The test checks `<b>` in a name.
- **Framing and caching.** The global CSP `frame-ancestors 'self' https://*telegram.org…` applies. Telegram's own origins are trusted, and an attacker's Mini App page is itself an ancestor, so it is blocked. `private, no-store` comes from both the route and the `/api` config rule. `X-Robots-Tag` and meta robots are set to noindex.
- **Session handling.** If the browser is already signed in to the same account, GET redirects and does not consume the token. If a different account is signed in, GET shows a warning, and POST revokes that session in the DB before creating the new one.
- **UX.** One extra tap, and the bot's WELCOME text is updated to say so. Reasonable for the login-CSRF fix.

**EXT-14 secret:**
- `str()` trims, so an empty or whitespace-only `TELEGRAM_WEBHOOK_SECRET` counts as unset and falls back to `CRON_SECRET`.
- `safeEqual` is `timingSafeEqual`; only the length leaks, which is standard.
- The warning text contains no secret value.
- `assertRuntimeConfig` accepts either secret. Compose and `.env.example` are updated, including the rotation order.

**BEA-17/EXT-05 webhook:**
- `claimUpdate` (`INSERT … ON CONFLICT DO NOTHING`) runs first, so two concurrent deliveries produce one message (tested).
- On any error the mark is released and the route returns 500, so a redelivery is processed again (tested).
- 403/400 from Telegram return `false` and the update is marked done. 429, 5xx, network errors and JSON parse errors raise `TelegramTransientError`.
- Malformed JSON or a missing `update_id` returns 200.
- Retrying `/start <nonce>` is safe: `attachTicket` re-binds the ticket with a fresh token and doesn't require `telegram_id IS NULL`. Retrying `/login` just creates a new ticket.
- Long-polling `scripts/bot.mts` advances the offset before handling, so a poison update can't wedge it.

**CONC-16 first login:**
- The `(xmax = 0)` trick correctly separates insert from conflict-update.
- The losing concurrent insert waits and takes the DO UPDATE path.
- The bonus goes through `topUpInTx` with the same `signup:<id>` reference as the legacy rows. It takes a user lock and checks the ledger before adding.
- `author` is only set on insert; username, name and photo are updated on every login.
- Tests run 5 rounds × 3 parallel logins, plus a returning-user case.

**DEPS-04:**
- The lockfile is consistent. Root specs are `^15.5.26`; `next`, `@next/*` and `eslint-config-next` all resolve to 15.5.26 with `resolved`/`integrity`.
- Next 15.5.26 widens its optional `sharp` to `^0.34.3 || ^0.35.4`, so the nested `next/node_modules/sharp@0.34.5` tree is gone and the top-level `sharp@0.35.4` is used. `fastq` 1.20.1→1.20.3 comes along incidentally, which is fine.
- `npm ls` in the worktree shows `invalid`, but only because `node_modules` is a symlink to the un-reinstalled root. That is expected; the build and reinstall are the orchestrator's gate.
- Release notes: 15.5.24 fixes RCE in the image optimizer (AVIF) and on Windows hosts; 15.5.25 re-enables AVIF with newer sharp; 15.5.26 hardens `next/og`. Nothing touches middleware, headers or route handlers. The app has `images.unoptimized: true`, so behaviour doesn't change.

## Nits (non-blocking)

- **N1.** The webhook returns 500 for *any* exception, not only transient ones. A deterministic bug in `processUpdate` would make Telegram redeliver the update until it gives up, and that can slow delivery of other updates. Consider returning 500 only for `TelegramTransientError` and DB connectivity errors, or capping retries per `update_id`, and returning 200 with a log line otherwise.
- **N2.** Small at-least-once gap. If Telegram times out and redelivers while the first attempt is still running (up to ~35 s with a 15 s timeout ×2 plus `retry_after`), the second delivery sees the claim and returns 200. If the first attempt then fails and releases the mark, the update is lost. This is rare; a comment is enough.
- **N3.** The POST 4 KB guard reads only the `Content-Length` header. A chunked body skips it, and `req.formData()` is unbounded. A streaming cap, or reading `req.text()` with a limit, would close this.
- **N4.** On failure, POST redirects to `env.appUrl/uz/login`. If the page was served on a host other than `APP_URL` (a www variant, or an IP), CSP `form-action 'self'` blocks the cross-origin redirect after a form submission. Links are always built from `APP_URL`, so this is low risk. Using the request origin for failure redirects on POST would avoid it.
- **N5.** Logging back in to the *same* account via POST creates a new session and leaves the previous one alive, orphaned once its cookie is overwritten. Revoking it in the same-id case as well would be tidier.
- **N6.** `app/api/auth/telegram/ticket/route.ts:18` still documents `GET /api/auth/telegram/enter` as the login step, which is now stale.

---

## Re-review — `2de82e6` (on top of merge `cfd9ce2`)

### Verdict: **APPROVE**

**Required change 1: done.**
- The GET confirmation page no longer sets `Referrer-Policy`. A comment explains why, so the global `strict-origin-when-cross-origin` now applies.
- The test asserts that the header is absent. A new test pins down `Origin: null` + `Sec-Fetch-Site: same-origin` → 403.
- **Headless Chromium re-check.** The page carried the effective global headers (`Referrer-Policy: strict-origin-when-cross-origin`, CSP `form-action 'self'`) and auto-submitted the confirm form to `/api/auth/telegram/enter`. The POST carried `Origin: http://127.0.0.1:<port>` and `Sec-Fetch-Site: same-origin`. Feeding those exact captured headers to the branch's real `checkOrigin` returned **true**; with `Origin: null` it returned false. Chromium also followed the new relative `303 Location: /uz` under `form-action 'self'`.

**Nits:**
- **N1.** The webhook now returns 500 only when `isRetryableUpdateError` is true. That covers `TelegramTransientError`, PG SQLSTATE 08xxx, 53xxx, 57P0x, 57014, 40001 and 40P01, the network errno codes, and pg-pool connect messages. Deterministic errors return 200. `handleUpdate` has already released the mark, and Telegram won't redeliver after a 200, so the update is simply dropped and logged. That is acceptable. There is a unit table for retryable vs non-retryable (22003, 23505, 42P01, TypeError), plus a route test.
- **N2.** The gap is documented on `claimUpdate`.
- **N3.** `readSmallBody` now streams the body with a 4096-byte cap (`reader.cancel()` once it's exceeded). Parsing uses `URLSearchParams`, so a malformed form gives an empty token, which counts as a failure. The test covers a chunked body with no `Content-Length` → 413 without consuming the token.
- **N4.** POST success and failure use a relative `Location` with `private, no-store`. GET keeps the absolute `APP_URL` redirect, which is fine because a navigation isn't subject to `form-action`. Session cookies set via `cookies()` still get merged into the plain `Response` by the app-route module (tested).
- **N5.** `revokeCurrentSession()` now always runs before `createSession`. It does nothing when there's no cookie, and a new test covers the same-account case.
- **N6.** The ticket route comment is updated.

The README's `setWebhook` example now uses `$TELEGRAM_WEBHOOK_SECRET`, with a rotation note, and a test guards against `secret_token=$CRON_SECRET`.

**Tests.** The same 7 files, run from the worktree via `heavy2.sh -m 3G -t 900` against the audit Postgres: **47/47 pass**, exit 0.

**Remaining (non-blocking).** The DEPS-04 build and reinstall are still the orchestrator's gate: the worktree's `node_modules` is the un-reinstalled root, so `npm ls` reports `invalid`, as expected.
