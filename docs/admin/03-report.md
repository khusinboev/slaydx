# Admin panel — Phase 4 final report

**Branch:** `feat/admin-panel` (draft PR khusinboev/slaydx#2). **Not deployed.** `main` and production are untouched; deploy only on the owner's instruction (§7).
**Inputs:** `01-analysis.md` (what existed), `02-plan.md` (approved spec), `HANDOFF.md` (execution log, open-items list).

## 1. Summary

The panel described in `02-plan.md` is built, integrated and verified:

- **20 screens** under `/admin` (S1–S20), **66 API route files** under `/api/admin/**`, all behind one server guard (`adminHandler`). Non-admins get a 404; the permission matrix of §4.3 is enforced on the server and proven by a generated test over every route × method × role.
- **Security:** Telegram login (factor 1) + TOTP (factor 2) with recovery codes, a separate short-lived admin session bound to the user session, step-up for sensitive permissions, fail-closed brute-force limits, append-only audit log written in the same transaction as every mutation.
- **Money:** wallet adjustment, job cancel / force-fail / refund, external refund with clawback — each with reason, confirmation, `Idempotency-Key`, step-up where the matrix says so, and exactly one audit row.
- **Pricing (§17):** real AI cost per tool from one canonical spend definition, admin-set price adjustment per tool, margin/markup analysis, 90-day cost trend, simulator, history; the buyer is charged the adjusted price and a stale client price is caught by the `price_changed` 409.
- **Gates:** full regression green (§4), three independent reviews (security, correctness/money, UX/performance) with every finding fixed or explicitly accepted (§5).

## 2. What was built

| Area | Screens | Notes |
|---|---|---|
| Auth & account | S1 login, S2 enroll, S19 account | TOTP + recovery, lockout countdown, recovery codes shown once; own sessions and code regeneration |
| Dashboard | S3 | KPIs with previous-period deltas, revenue/generations/signups/AI-cost charts, top tools, live queue strip (15 s, paused when hidden) |
| Users | S4, S5 | classified search (#id, Telegram id, exact phone, @username prefix, name prefix), masked phone + audited reveal, tabs: overview, generations, payments, ledger, sessions, game links, audit; block with side effects, sessions revoke, message, wallet adjust |
| Generations | S6, S7 | filters incl. "unrefunded" and "stuck", audited input reveal and file download, cancel / force-fail / refund |
| Payments & finance | S8, S9, S10 | orders, webhook timeline, external refund with clawback, revenue summary, global ledger, six reconciliation checks |
| AI cost & providers | S11 | cost by day/tool/provider/model/kind with coverage and caveats; key presence (booleans only), breakers and limiters per process |
| Pricing | S20 | per-tool cost per job and per unit, ladders base → effective, margin colouring, recommendation, simulator, history, edit/reset with step-up |
| Moderation | S12 | public game links and results; revoke (public link dies), single and bulk result delete |
| Broadcasts | S13 | draft → test-to-self → typed-count send → worker delivery with progress; cancel |
| Settings | S14 | free-LLM switch and caps, global/per-tool generation pause, finance knobs, pricing target markup |
| System & errors | S15, S16 | DB, migrations, queue, heartbeats (stale rule shared), housekeeping, config problems; persisted error log with resolve |
| Audit & admins | S17, S18 | filterable trail with before/after diff and owner-only CSV; admin accounts with rank rules, one-time enroll links |

Supporting pieces: `lib/server/admin-cost.ts` (the only definition of AI spend: `ai_usage` ∪ legacy `cost_json`, no double count), `scripts/admin-seed-dev.mts` (`npm run admin:seed-dev`, dev-only guards), `scripts/admin-create.mts` (bootstrap and break-glass).

## 3. Changes outside the admin area

Data model: migrations **028–033**, all additive (`IF NOT EXISTS`, commented rollback blocks, re-run idempotent; rollbacks exercised on a fresh DB). `031` rewrites old admin ledger notes to "Ma'muriy tuzatish" and keeps the originals in the audit log (reversible).

Product files touched (each change keeps today's behaviour by default; reviewed in Phase 4 for byte-identical defaults):

| File | Change |
|---|---|
| `lib/tools.ts`, `lib/server/pricing.ts`, `app/api/generations/route.ts`, `lib/store.ts`, `components/forms/*` (price display) | per-tool price adjustment (100 % = identical prices), pause check, `expectedPrice` 409 |
| `lib/server/spend.ts`, `lib/generation/job-cost.ts`, `lib/generation/image-provider-fal.ts`, `lib/server/ai-usage.ts` | free-LLM runtime settings; `ai_usage` spend capture incl. failed/abandoned/free |
| `lib/server/worker.ts`, `instrumentation.ts`, `lib/server/log.ts` | heartbeat, error sink, housekeeping status, broadcast delivery, purges, admin force-fail leftovers sweep |
| `lib/server/credits.ts` | `adminAdjustWalletInTx` extracted (legacy wrapper unchanged); a racing refund's unique violation is treated as "already refunded" instead of a false alert |
| `lib/server/session.ts` | `isAdmin` = has an admin account (phone allow-list no longer grants access) |
| `lib/server/env.ts`, `.env.example`, `docker-compose.yml` | `ADMIN_TOTP_KEY`; production warning when `TRUST_PROXY` is not true |
| `next.config.ts` | admin headers (`frame-ancestors 'none'`, `no-store`, `noindex`) |
| `components/providers.tsx` | consumer session bootstrap skipped on `/admin` pages |
| `lib/api-client.ts`, `lib/server/admin.ts`, `components/admin/AdminPage.tsx`, `app/uz/admin/*` | legacy admin removed; `/uz/admin` redirects to `/admin` |
| `app/globals.css` | additive status/chart/badge tokens |

No new npm dependency.

## 4. Verification

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean (final head `d0a0f16`) |
| `npm test` (fresh Postgres 16) | **4047 / 4047** pass, 0 skipped |
| `npm run test:ui` | **792 / 792** |
| `npm run test:viewer` | **248 / 248** |
| `npm run build` | compiled successfully |
| GitHub CI (draft PR #2) | green since the backup-test fix (run 36916073054) |

- **Permission matrix** (`tests/admin-permission-matrix.test.mts`): the route manifest is generated from the code; 67 methods × 6 roles = 402 cases, plus 404 cloak for anonymous / non-admin / disabled on every route, Origin required on every mutation, 401 `admin_auth` for expired or revoked sessions, 401 `reauth` for every step-up permission, one `denied` audit row per refusal, and an equality check of the code matrix against §4.3.
- **Mutation testing:** every package mutation-checked its key assertions (break the code, see the test fail, restore); lists are in each package report in the git history.
- **Browser smoke:** every package ran real Chromium against a real dev server and database with seeded data at 1280 and 360 px, light and dark, per role (e.g. a buyer charged the adjusted price; a blocked user refused; a revoked public game link dead).
- **CI flake fixed first:** the three red CI tests were docker-based backup tests racing the postgres image's temporary init server; readiness now probes over TCP.

## 5. Independent reviews

| Review | Model | Findings | Outcome |
|---|---|---|---|
| Security / RBAC | fable | 0 critical, 0 high, 2 medium, 4 low | fixed: denied-call rate limit before the audit row; IP gate counts failures only and is skipped without a trusted proxy (plus prod warning); money actions follow admin-target and self rules. Accepted: enroll token in the URL (#5), Origin check before the cloak (#6). Re-verified: **APPROVE** |
| Correctness / money / regression | fable | 0 critical, 0 high, 1 medium, 4 low | fixed: block lock order (deadlock), racing refund false alert, force-fail leftovers sweep, pricing all-in totals, per-request FX. Hand-calculated dashboard and pricing numbers matched. Re-verified: **APPROVE** |
| UX / performance | opus | 0 high, 3 medium, 11 low | fixed: pricing overflow, badge contrast (≥ 4.5:1), row focus ring, Uzbek labels, unit consistency with explicit tanga→so'm, hidden columns, forbidden-only states, payload cap, user audit tab, phone KPI grid, dialog focus, scroll regions, consumer calls on `/admin`. Accepted by design: filters use `router.replace`, page cursor not in the URL (#14). Re-verified on a production build: **APPROVE**; its three small leftovers (focusable scroll regions, row focus-ring contrast, refresh button on a forbidden page) were fixed after. |

Per-package reviews during the build also caught and fixed: an idempotency key replayed across different target users (F6, major), a client rank-mirror bug (WP10), a duplicated spend rule (WP5), profile-field masking against the plan (WP2).

Performance on seeded data (production build): full page ready 82–156 ms, client navigation 65–103 ms, list APIs 8–22 ms, 366-day aggregates ≤ 40 ms uncached; no duplicate calls or polling leaks; admin First Load JS 211–251 kB; no admin code in consumer bundles for anonymous visitors.

## 6. Known limitations and residual risks

- **`TRUST_PROXY` must be `true` in production** (behind nginx). Without it the admin IP brute-force gate is disabled (per-account limits still apply) and audit IPs read "direct". `runtimeWarnings()` now warns about it.
- Enrollment token travels in a URL query (30-minute TTL, single use, bound to the logged-in target user, burns after 5 bad codes, masked in app logs). Avoid logging `/admin/enroll` in nginx if possible.
- An admin with `users.pii` can read PII; mitigated by audit only. The consumer CSP still allows `'unsafe-inline'` (out of scope).
- Indexes not added (would need a migration; fine at today's size): users `balance_desc` / `last_seen_desc` sorts, orders `amount_desc`, generations `duration_desc`, `lower(topic)` prefix search, audit action prefix under non-C collation.
- Dashboard revenue is gross (external refunds/chargebacks are listed separately, not subtracted). `activeUsers` is a lower bound for past ranges.
- Pricing per-unit cost: pages use the package midpoint; glossary jobs without a term count are excluded from the per-unit figure.
- Pro chargeback claws back quota only; the user's `pro` plan stays until expiry (per spec; owner decision pending, §8).
- The bot's `/admin` text reply still uses the phone allow-list wording; access itself requires an admin account.
- No nightly rollup tables; aggregates are computed on demand with a 60 s cache. Revisit beyond ~1M generations.

## 7. Rollout and rollback (from plan §15, updated)

Before deploy:
1. Owner approval to merge `feat/admin-panel` into `main` and deploy.
2. Prod `.env`: set `ADMIN_TOTP_KEY` (`openssl rand -base64 32`, store it in the password manager) and confirm `TRUST_PROXY=true`.
3. Fresh DB backup (`scripts/backup.sh`) and confirm it.

Deploy as usual; migrations 028–033 apply at web boot. Then:
1. `docker compose -p slaydx exec worker npm run admin:create -- --telegram-id <owner id> --role owner`, open the printed link while logged in via Telegram, enroll, store the recovery codes offline.
2. Smoke: `/admin` dashboard loads; `/admin/system` shows fresh web and worker heartbeats; `/admin/audit` shows `auth.enroll` and `auth.login`; a non-admin gets 404 on `/admin` and `/api/admin/session`.
3. Add the other admins from `/admin/admins`.

Rollback: redeploy the previous image (all migrations are additive; old code ignores the new tables). Kill switch without redeploy: unset `ADMIN_TOTP_KEY` and restart web, then `UPDATE admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL;`. A misbehaving runtime setting: reset it in `/admin/settings` or `DELETE FROM app_settings WHERE key = '<key>'` (effective within 15 s). A wrong price: "100 % ga qaytarish" in `/admin/pricing`.

## 8. Open owner decisions

1. **Pro chargeback:** keep the `pro` plan until expiry (current, per spec) or also revoke it?
2. **Pricing per-unit conventions:** pages = package midpoint; glossary without term count excluded — confirm.
3. **Optional nginx allow-list** for `/admin` and `/api/admin` (Q14) — template in plan §15.

## 9. Admin 2FA switch (2026-10-02)

**What changed.** On the owner's request the second factor is no longer required to enter the panel: a designated admin (an `admin_accounts` row that is `active` or `pending`) clicks the site's "Admin panel" button and lands on the dashboard. The strengthened protection of §3 of the plan (TOTP enrollment, code login, recovery codes, 10-minute step-up, login notices) is kept as working, tested code behind one environment switch, `ADMIN_2FA_REQUIRED` (default `false`).

**How the simple mode works.** With the switch off, the panel layout — finding no admin session — mounts `AdminAutoEnter`, which POSTs once to the new `POST /api/admin/auth/auto` (an `adminAuthHandler` route: Origin required, 404 cloak for non-admins, disabled accounts and anonymous callers, 30 entries / 60 s per admin) and refreshes. The route mints the same `admin_sessions` row as a TOTP login (hashed token, `__Host-` cookie, 30 min idle / 12 h absolute, bound to the live user session), activates a `pending` account on first entry, and writes one `auth.login` audit row with `meta.mode = "simple"`. `adminHandler` skips the step-up gate, so no money action asks for a code; the RBAC matrix, the `denied` audit, idempotency, reasons, typed confirmations, rank/self rules and the user-session binding are untouched. TOTP routes answer 409 `2fa_off`; `ADMIN_TOTP_KEY` is not needed and raises no boot warning. Admins created from `/admin/admins` or `npm run admin:create` are `active` with no enrollment link; the UI hides the 2FA column, the "2FA ni tiklash" action and the TOTP/recovery sections of `/admin/account`.

**Turning 2FA back on.** Set `ADMIN_2FA_REQUIRED=true` plus a valid `ADMIN_TOTP_KEY` in prod `.env` and restart web and worker. Sessions minted in simple mode are refused immediately (no TOTP enrolled), so every admin re-enrolls: an owner issues links with "2FA ni tiklash" in `/admin/admins`, or runs the CLI (`npm run admin:create -- --telegram-id <id> --role <role>`) for themselves. Nothing else changes; the 2FA-mode behaviour is the one described in §2–§4 of this report.

**Residual risk.** In simple mode admin access rests on the Telegram account alone: whoever controls an admin's Telegram login (or steals their user-session cookie) controls the panel, with no second factor, no step-up before money actions and no login notice. What remains: the audit log (every entry is recorded with IP and user agent), session expiry and binding (a user logout or block ends admin access), owner-only account management, and the switch itself as the way back.

**Verification.** `tests/admin-simple-auth.test.mts` (12 cases, runs with `ADMIN_TOTP_KEY` unset), `tests/ui/admin-simple-auth.test.mts` (8 cases: auto entry, sidebar button, account page, admins page in both modes), `tests/admin-permission-matrix.test.mts` parametrised over both switch positions (same refused set; step-up cases become "no reauth needed"), `tests/compose-env.test.mts` and `tests/env-warnings.test.mts` for the plumbing; every pre-existing admin test pins the 2FA mode explicitly and is unchanged. Chromium smoke in simple mode: sidebar button → dashboard with no code prompt, wallet adjustment without a step-up dialog, non-admin sees no button and gets 404 on `/admin`.
