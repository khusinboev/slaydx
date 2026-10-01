# Admin panel — handoff for the next session

**Snapshot:** 2026-10-01. The cloud session moved the work to the owner's laptop at this point. Read this file first, then `02-plan.md` (the spec), then `AGENT-BRIEF.md` (the rules every coding agent follows).

## 1. What this project is

SlaydX (`slaydxx.uz`) is a Next.js 15 (App Router) + PostgreSQL 16 product. It generates educational documents with AI: slides, coursework, essays, translation, games and TTS. Two processes do the work: a `web` process and a queue `worker` process. The UI and docs are Uzbek-first.

We are adding a **production admin panel** without changing existing product behavior. All three documents live in `docs/admin/`:

| File | What it is |
|---|---|
| `01-analysis.md` | Phase 1 analysis: system map, entities, flows, risks, test baseline. Every claim cites `path:line`. |
| `02-plan.md` | Phase 2 plan, **approved by the owner**. It covers architecture, RBAC, data model, API contract, screens, threat model, tests, work packages with file ownership, rollout and rollback. §17 is the pricing and unit-economics module the owner added. §18 is the execution model. |
| `03-report.md` | Phase 4 final report. **Not written yet.** |
| `AGENT-BRIEF.md` | Rules, conventions and checks for every coding agent. Give it to each agent. |
| `prototype.html` | Clickable prototype of all screens (sample data only). Open it in a browser. It is the visual reference for the UI packages. |

The brief's non-negotiable rules:
- edits to existing files stay minimal;
- migrations are additive only;
- permission checks are server-side (`adminHandler`);
- every admin mutation writes an audit row in the same transaction;
- money actions need a reason, an idempotency key and step-up;
- no new dependencies, no mock data, no TODOs;
- never weaken a test;
- code and comments in English, UI copy in Uzbek;
- talk to the owner in Uzbek.

## 2. Work-package status (plan §13 / §18)

| Pkg | Content | Status |
|---|---|---|
| F1 | Migrations 028–033 (admin core, ops, indexes, legacy-note scrub, pricing, ai_usage) and `lib/server/settings.ts` | ✅ merged |
| F4 | `lib/server/admin-list.ts` (keyset paging, filters incl. `enumList`, Tashkent date ranges, user-query classifier), `admin-csv.ts`, `admin-mask.ts` | ✅ merged |
| F3a | UI primitives `components/admin/ui/*` (DataTable, CursorPager, dialogs, StepUp, Toaster, DateRangePicker, charts), `lib/admin-api/core.ts` + `auth.ts`, `lib/admin-format.ts`, chart/status tokens, boundary and bundle tests | ✅ merged |
| F5a | Runtime price adjustment (`applyPriceAdjust`, `lib/server/pricing.ts`), generation pause, `expectedPrice` 409 guard, client price display | ✅ merged |
| F5b | Error sink → `error_log`, process heartbeats, housekeeping status, Telegram broadcast delivery, `ai_usage` cost capture, free-LLM runtime settings | ✅ merged |
| F2 | Security core: crypto/TOTP, RBAC matrix, admin sessions, audit, `adminHandler`, auth/account/admins routes, `scripts/admin-create.mts`, `ADMIN_TOTP_KEY` | ✅ merged |
| F3b | Admin layouts and pages: `app/admin/layout.tsx`, `(auth)/login`, `(auth)/enroll`, `(panel)/layout.tsx` (shell, nav, Toaster, StepUpProvider), `(panel)/error.tsx`, `loading.tsx`, `account/page.tsx`; `components/admin/shell/*`; `app/uz/admin/page.tsx` → redirect to `/admin`; Sidebar link → `/admin`; delete `components/admin/AdminPage.tsx` and `app/uz/admin/loading.tsx` | ⏳ todo (needs F2) |
| F6 | Money actions: wallet adjustment, job cancel/fail/refund, external order refund with clawback, plus dialogs (`components/admin/money/*`, `lib/admin-api/money.ts`). Uses `adminAdjustWalletInTx` extracted from `lib/server/credits.ts` | ⏳ todo (opus) |
| WP1 | Dashboard (§6.3, S3) | ⏳ |
| WP2 | Users (§6.4, S4/S5); rewrites the legacy `app/api/admin/users/**` | ⏳ |
| WP3 | Generations (§6.5, S6/S7) | ⏳ |
| WP4 | Payments and finance (§6.6, S8–S10) | ⏳ |
| WP5 | AI cost and providers (§6.7, S11); use `ai_usage` and `cost_json` | ⏳ |
| WP6 | Moderation (§6.8, S12) | ⏳ |
| WP7 | System and errors (§6.11, S15/S16) | ⏳ |
| WP8 | Settings UI and routes (§6.10, S14); call `invalidateSettingsCache()` after commit | ⏳ |
| WP9 | Broadcasts (§6.9, S13); delivery already exists in F5b | ⏳ |
| WP10 | Audit log UI and admins UI (§6.12, §6.13, S17/S18) | ⏳ |
| WP11 | Pricing admin (§17.4–17.6, S20) (opus); call `invalidatePricingCache()` after commit | ⏳ |
| I | Integration: remove the legacy admin section in `lib/api-client.ts:292-336` and the legacy `requireAdmin` in `lib/server/admin.ts` with its routes; add the `admin:seed-dev` script; full checks | ⏳ |
| P4 | Phase 4: three independent reviews (security, regression, UX walk at 1280 px and 360 px, light and dark), fix every finding, write `03-report.md` | ⏳ |

Suggested order:
1. F3b and F6 (in parallel).
2. WP1–WP11, at most 4–5 at a time; cheaper models for the read and UI packages.
3. I.
4. P4.

File ownership per package is in `02-plan.md` §13.2 and §18. No two parallel packages may touch the same file.

## 3. Conventions settled during the build (all also in AGENT-BRIEF)

- **List endpoints:**
  - helpers: `parseListParams`, `buildKeyset`, `keysetSelect`, `pageResult`, `countCapped`, `parseDateRange`, `classifyUserQuery`, `likePrefix`;
  - multi-select filters are comma-joined (`enumList`);
  - the spec's `id` carries the SQL type (`uuid` or `bigint`).
- **Missing admin resource:** `ApiError("Topilmadi", 404, { code: "not_found" })`.
- **Client:**
  - everything goes through `lib/admin-api/core.ts` (`adminGet`, `adminSend`, idempotency keys, reauth retry, the admin-auth redirect);
  - admin 401s do **not** log the consumer out (`lib/api-client.ts` skips `/api/admin/`);
  - import `ApiError` from `core.ts`.
- **PII guard:** `tests/no-pii-in-repo.test.mts` rejects any 998 phone number that is not on its allowlist. Use only `+998901234567`, `+998901112233`, `+998907654321`, `+998900000001` and `+998900000002`.
- **Settings and pricing caches:** both are 15 s per process. Admin write routes must call `invalidateSettingsCache()` or `invalidatePricingCache()` after COMMIT.
- **Comments:** every new comment is in English. The existing code keeps its Uzbek comments; do not translate them.

## 4. Local setup on a laptop

```bash
git clone https://github.com/khusinboev/slaydx.git && cd slaydx   # or: git pull on main
npm ci
docker run -d --name slaydx-pg -e POSTGRES_USER=slaydx -e POSTGRES_PASSWORD=slaydx -e POSTGRES_DB=slaydx -p 5432:5432 postgres:16-alpine
export DATABASE_URL=postgres://slaydx:slaydx@127.0.0.1:5432/slaydx
export ADMIN_TOTP_KEY=$(openssl rand -base64 32)    # needed for admin login/enroll (F2)
npm run typecheck && npm run lint
npx tsx --import ./tests/helpers/hermetic-env.mts --conditions=react-server --test --test-concurrency=2 tests/admin-*.test.mts tests/settings.test.mts tests/pricing-*.test.mts
npm test            # full suite (~5–8 min)
npm run test:ui && npm run test:viewer
npm run dev         # http://localhost:3000 ; admin at /admin once F3b exists
```

Bootstrap the first owner, once F2 is merged:
1. Run `npm run admin:create -- --telegram-id <your tg id> --role owner`.
2. Log in on the site with Telegram.
3. Open the printed `/admin/enroll?token=…` link and scan the QR code.

The enroll page arrives with F3b. Until then the flow can only be exercised through the API and the tests.

**Parallel agents:** use git worktrees, one branch per package. Merge into the integration branch after review. Give each agent its own database: `CREATE DATABASE slaydx_<pkg>`.

## 5. Known issues and caveats

- **CI test step is intermittent** (01-analysis §0/§8): a docs-only change once failed 4 of 3520 tests. The most recent CI failure could not be traced from the truncated log. Locally, a fresh full run showed no new failing test files compared with the baseline. If CI is red, first open the job log in the browser and search for `not ok`.
- **Container-specific local failures** (tsx module identity, LibreOffice) are listed in 01-analysis §8. A laptop with docker and LibreOffice may differ.
- **F5b notes:**
  - Broadcast delivery runs in the background so the worker loop doesn't stall.
  - The breaker and limiter snapshot in the *web* heartbeat may only show the inline worker's registry when Next loads separate module copies.
  - fal is priced only for `flux/schnell`; other fal models are recorded with `priced:false`.
- **F5a note:** the free-LLM route kill switch uses the last value its process read. `withFreeLlm` always reads fresh, so an admin "disable" always stops provider calls.

**⚠️ Do NOT deploy `main` to production until Integration and Phase 4 are done.** `main` now contains the new foundation, which is additive and does not change consumer behavior with default settings. However:
- after F2, the legacy phone-based `/uz/admin` panel requires the new admin session (owner/admin);
- the new `/admin` UI arrives with F3b and later packages.

Deploying earlier would leave the owner without a working admin UI. Migration `031` rewrites old admin ledger notes to "Ma'muriy tuzatish", keeping the original text in `admin_audit_log`. That is intended (plan §5.4).

## 6. State at the end of the cloud session

- **Branches.** Everything above is merged into `claude/cool-feynman-jiixoi`, and that branch was merged into `main` via PR khusinboev/slaydx#1.
- **Local checks at the hand-off head:**
  - typecheck and lint: clean;
  - new admin, settings and pricing tests: pass;
  - full `npm test`: the set of failing files is identical to the container baseline in 01-analysis §8, with no new failures.
- **F2 decisions the next session must know:**
  - **Admin CSP:** Next keeps one value per header key, so admin paths get the *full* site CSP with only `frame-ancestors 'none'` changed (locked by `tests/admin-headers.test.mts`).
  - **`SessionUser.isAdmin`** is now "has an admin_accounts row (active|pending)". The phone allow-list no longer grants anything.
  - **Legacy `requireAdmin`** (used only by `app/api/admin/users/**`) requires an owner/admin admin session, an Origin header and a fresh step-up for mutations. WP2 replaces those routes; Integration deletes `requireAdmin`.
  - **Permission `self`** exists for every role and is used by `me/*` and reauth.
  - **Audit action names in use:**
    - `auth.login`, `auth.login_failed` (with `meta.flow`), `auth.locked`, `auth.recovery_used`, `auth.reauth`, `auth.enroll`, `auth.logout`, `auth.denied`, `auth.session_revoke`, `auth.recovery_regenerate`;
    - `admins.create|update|reset_2fa|revoke_sessions`.
  - **Brute-force limits:** a 429 carries `retryAfterSec`, plus `code:"locked"` when the account is locked.
  - **Enrollment secret:** derived from the enrollment token with a keyed MAC; it is sealed into the account only on the first confirmed code.
- **Test fixture pattern** for an authenticated admin in route tests: insert `admin_accounts` (status `active`, `totp_enabled_at`, a non-null `totp_secret_enc`), then `createAdminSession(client, {adminId, userSessionId, reauth:true})`, then send both cookies (`slaydx_session` and `adminCookieName()`). See `tests/admin-auth.test.mts` (`openSession`) and `tests/malformed-route-params.test.mts`.
- **⚠️ CI status at hand-off: red.** On the last head, `npm run test` fails **3 of 3756** in GitHub Actions. They could not be identified from the cloud session: the reachable log shows only the last 5 000 lines, and those tests fail locally anyway because of the container's tsx issue.
  - The prime suspects are top-level tests numbered below about 2900 in the CI log, most likely in `tests/free-llm.test.mts`. F5b changed `lib/server/spend.ts` (runtime free-LLM settings and `ai_usage` flush).
  - Other candidates are `env-*` and `instrumentation-*` tests touched by F2/F5b, or the known intermittent tests.
  - **First task of the next session:**
    1. run `npm test` on the laptop, where tsx behaves like CI, and also open the CI log in the browser and search `not ok`;
    2. fix the 3 failures without weakening any test;
    3. get CI green before any new package.
- **Next step:** after CI is green, F3b and F6, then WP1–WP11 (§2).
