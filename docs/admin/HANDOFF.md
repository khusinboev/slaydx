# Admin panel — handoff for the next session

**Snapshot:** 2026-10-02 (laptop session). Work branch: `feat/admin-panel` (from `main` at `ffddd39`). The cloud session moved the work to the owner's laptop on 2026-10-01. Read this file first, then `02-plan.md` (the spec), then `AGENT-BRIEF.md` (the rules every coding agent follows).

## 1. What this project is

SlaydX (`slaydxx.uz`) is a Next.js 15 (App Router) + PostgreSQL 16 product. It generates educational documents with AI: slides, coursework, essays, translation, games and TTS. Two processes do the work: a `web` process and a queue `worker` process. The UI and docs are Uzbek-first.

We are adding a **production admin panel** without changing existing product behavior. All three documents live in `docs/admin/`:

| File | What it is |
|---|---|
| `01-analysis.md` | Phase 1 analysis: system map, entities, flows, risks, test baseline. Every claim cites `path:line`. |
| `02-plan.md` | Phase 2 plan, **approved by the owner**. It covers architecture, RBAC, data model, API contract, screens, threat model, tests, work packages with file ownership, rollout and rollback. §17 is the pricing and unit-economics module the owner added. §18 is the execution model. |
| `03-report.md` | Phase 4 final report. **Not written yet.** |
| `AGENT-BRIEF.md` | Rules, conventions and checks for every coding agent. Give it to each agent. |
| `WP-BRIEF.md` | Extra common instructions for screen packages (WP1–WP11): reuse contracts, smoke recipe (`WORKER_INLINE=false`), checks. Paths to the scratchpad smoke kit are session-specific; recreate the kit from F3b's pattern if missing. |
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
| F3b | Admin layouts and pages: `app/admin/layout.tsx`, `(auth)/login`, `(auth)/enroll`, `(panel)/layout.tsx` (shell, nav, Toaster, StepUpProvider), `(panel)/error.tsx`, `loading.tsx`, `account/page.tsx`; `components/admin/shell/*` (incl. `nav-registry.ts`, `useCan`); `app/uz/admin/page.tsx` → redirect to `/admin`; Sidebar link → `/admin`; legacy `AdminPage.tsx` deleted | ✅ merged 2026-10-02 (opus; Chromium smoke 32/32) |
| F6 | Money actions: wallet adjustment, job cancel/fail/refund, external order refund with clawback, plus dialogs (`components/admin/money/*`, `lib/admin-api/money.ts`). `adminAdjustWalletInTx` extracted from `lib/server/credits.ts`; idempotency in `lib/server/admin-idempotency.ts` | ✅ merged 2026-10-02 (fable; fable review: 1 MAJOR + 3 MINOR fixed) |
| COST | `lib/server/admin-cost.ts`: the ONE definition of AI spend (ai_usage ∪ legacy completed cost_json, no double count), groupings, coverage, `COST_CAVEATS`. WP1, WP5 and WP11 must use it | ✅ merged 2026-10-02 |
| WP1 | Dashboard (§6.3, S3) | ✅ merged 2026-10-02 (opus; smoke 41/41) |
| WP2 | Users (§6.4, S4/S5); rewrites the legacy `app/api/admin/users/**` | ✅ merged 2026-10-02 (opus; smoke 98/98) |
| WP3 | Generations (§6.5, S6/S7); exports `GenerationsTable` (`fixedFilters`, `embedded`) for WP2 | ✅ merged 2026-10-02 (opus; smoke 53/53) |
| WP4 | Payments and finance (§6.6, S8–S10); exports `OrdersTable`/`LedgerTable` for WP2 | ✅ merged 2026-10-02 (opus; smoke 79/79) |
| WP5 | AI cost and providers (§6.7, S11) on `admin-cost`; `lib/server/admin-heartbeat.ts` (shared stale rule) | ✅ merged 2026-10-02 (sonnet; smoke 43/43) |
| WP6 | Moderation (§6.8, S12) | ✅ merged 2026-10-02 (sonnet; smoke 71/72, 1 script bug verified in SQL) |
| WP7 | System and errors (§6.11, S15/S16) | ✅ merged 2026-10-02 (sonnet; smoke 82/82) |
| WP8 | Settings UI and routes (§6.10, S14) | ✅ merged 2026-10-02 (sonnet; pause verified end to end as a buyer) |
| WP9 | Broadcasts (§6.9, S13); delivery already exists in F5b | ✅ merged 2026-10-02 (sonnet; smoke 76/76; step-up applies to every broadcasts.send route) |
| WP10 | Audit log UI and admins UI (§6.12, §6.13, S17/S18) | ✅ merged 2026-10-02 (sonnet; smoke 113 assertions) |
| WP11 | Pricing admin (§17.4–17.6, S20) | ✅ merged 2026-10-02 (fable; smoke 62/62 incl. buyer charged the adjusted price and the 409 price_changed flow) |
| I | Integration: legacy admin code removed (`lib/api-client.ts` section, `lib/server/admin.ts`), `admin:seed-dev`, shared `adminDownload`/`useLoad`/`cancelQueuedInTx`/`spendForJobs`, permission matrix test (402 cases), full checks | ✅ merged 2026-10-02 — full regression: tsc/lint clean, npm test 4032/4032, test:ui 779/779, test:viewer 248/248, build OK |
| P4 | Phase 4: three independent reviews (security, regression, UX walk at 1280 px and 360 px, light and dark), fix every finding, write `03-report.md` | 🔄 security APPROVE (after 3 fixes, re-verified), correctness APPROVE (after 5 fixes, re-verified), UX: 3 MEDIUM + 11 LOW being fixed (2 agents); then UX re-verify, final full regression, 03-report |

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

**This laptop (verified 2026-10-02):** repo at `/home/adhambek/projects/pythons/slaydbot/slaydx`.
- Test Postgres 16 = docker container `slaydx-admin-pg` on `127.0.0.1:55440` (user/password `slaydx`). Port 5432 is a host Postgres of other projects; `55432` is the owner's dev DB (`sodda-pg`, used by `.env.local` and `npm run dev`). Never run tests against either.
- Run tests with an exported `DATABASE_URL=postgres://slaydx:slaydx@127.0.0.1:55440/<db>`; it overrides `.env.local` (Node `--env-file` never overrides set vars).
- `ADMIN_TOTP_KEY` is in `.env.local` (git-ignored).
- Heavy commands only through `scripts/heavy.sh` (see `CLAUDE.md`).

Generic recipe (cloud-era, kept for reference):

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

- **CI flake root-caused and fixed (2026-10-02).** Every red run (`36905975564`, `36907841671`, `36908956735`, `36911209650`, `36911410685`) failed only docker tests in `tests/backup-script.test.mts` (plus one PII hit in `36907841671`, fixed earlier). Cause: the tests waited with a unix-socket `pg_isready`, which reports ready on the postgres image's socket-only *temporary init server*; the next `psql`/`pg_dump` then hit "the database system is shutting down" or "database does not exist". The probes now use TCP (`-h 127.0.0.1`), as `scripts/restore-check.sh` already did. Not related to F5b.
- **Container-only failures do not reproduce on the laptop:** full `npm test` 3756/3756, `test:ui` 511/511, `test:viewer` 248/248, 0 skipped.
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
- **CI status at cloud hand-off: red** (resolved on the laptop, see §5 and §7). On the last head, `npm run test` fails **3 of 3756** in GitHub Actions. They could not be identified from the cloud session: the reachable log shows only the last 5 000 lines, and those tests fail locally anyway because of the container's tsx issue.
  - The prime suspects are top-level tests numbered below about 2900 in the CI log, most likely in `tests/free-llm.test.mts`. F5b changed `lib/server/spend.ts` (runtime free-LLM settings and `ai_usage` flush).
  - Other candidates are `env-*` and `instrumentation-*` tests touched by F2/F5b, or the known intermittent tests.
  - **First task of the next session:**
    1. run `npm test` on the laptop, where tsx behaves like CI, and also open the CI log in the browser and search `not ok`;
    2. fix the 3 failures without weakening any test;
    3. get CI green before any new package.
- **Next step:** after CI is green, F3b and F6, then WP1–WP11 (§2).

## 7. Laptop session log

| Date | Stage | Result |
|---|---|---|
| 2026-10-02 | (c)/(d) wave 1 | WP1, WP3, WP5, WP7 merged (each: own tests + guards green, Chromium smoke, lead review). Agents stopped once by the API session limit; resumed via SendMessage (worktrees kept their commits). Smoke rule: dev servers ALWAYS `WORKER_INLINE=false`. Agent brief for screens: `WP-COMMON.md` (lead scratchpad; content mirrored in AGENT-BRIEF + plan). Open items list kept by the lead for Integration. Next: WP2 (after WP4), WP9, WP10, WP11. |
| 2026-10-02 | (b) F3b + F6 + COST | merged; merged-state tsc/lint clean, admin+guard tests 338/338, admin UI 72/72; PR #2 CI green (run 36916073054). Owner #1 created in the dev DB (`sodda`, backup taken first) — enroll link to be regenerated once `/admin` has a page. Note: plain `next dev` (webpack) 500s on every page because of `instrumentation.ts` → sharp; use `--turbopack` (pre-existing). Open owner question: pro chargeback leaves plan=pro (spec: quota clawback only). |
| 2026-10-02 | (a) baseline + CI fix | `main` fast-forwarded to `ffddd39`, branch `feat/admin-panel`. typecheck ✅, lint ✅, `npm test` 3756/3756, `test:ui` 511/511, `test:viewer` 248/248. CI flake fixed in `tests/backup-script.test.mts` (§5). AGENT-BRIEF and CLAUDE.md adapted to the laptop. Next: (b) F3b + F6 after owner approval. |

## 8. Open items for Integration (lead-maintained)

- [ ] admin-cost: add per-job helper `spendForJobs(db, ids)`; switch WP3 `costsFor/costOf` to it (WP3 currently runs spendRowsSql all-time filtered by ids).
- [ ] components/admin/ui/FilterBar.tsx: MultiSelectFilter button accessible name = current value, should include its label (WP3 finding).
- [ ] WP3 export download: client checks reauthUntil then plain browser download; with clock skew a 401 JSON may be saved as file — consider fetch+blob or server-side 401 page.
- [ ] generations sort duration_desc has no index (fine at today's size; note in 03-report).
- [ ] WP3 deviations: filters via history.replaceState (accepted); stuck = IN_PROGRESS without lock also counts (follows reclaimStaleJobs).
- [ ] AccountPage shows raw permission keys — show Uzbek labels (UX).
- [ ] Owner question: pro chargeback keeps plan=pro.
- [ ] components/admin/ui/charts/LineChart.tsx floors y-max at 1 (flattens < 1 values); WP1 worked around locally — fix in primitive.
- [ ] Dashboard revenueSoum is gross (external refunds/chargebacks not subtracted) — state in 03-report / tile hint.
- [ ] env.ts:414-416 runtimeWarnings echoes raw FREE_LLM_DISABLED value; WP7 sanitizes in admin-system safeConfigMessage. Decide: one-line env.ts fix (product file) or keep sanitizer.
- [ ] No index on lower(generations.topic): moderation q prefix scans generations (fine now; note in 03-report).
- [ ] settings group label 'Narxlar' (catalog) vs prototype 'Narxlash' — keep catalog.
- [ ] Shared step-up-aware CSV download: WP3 and WP4 each implement their own; add `adminDownload` to lib/admin-api/core.ts and switch all exports (WP3/WP4/WP10/WP2).
- [ ] orders sort amount_desc has no index (fine now; 03-report).
- [ ] AdminIdentity lacks the admin id (S18 reads it from getAdminSession for 'self'): add `adminId` to the shell identity.
- [ ] Server: admins/:id/sessions/revoke on self is allowed (revokeSessionsOf has no assertNotSelf); plan §4.3 says own account goes via /admin/account → add 409 self.
- [ ] `useLoad` lives in components/admin/system/shared and is imported by errors/audit/admins: move to components/admin/ui.
- [ ] admin_audit_action_idx is plain btree; LIKE prefix uses it only under C collation (03-report; text_pattern_ops index would need a migration).
- [ ] Extract `cancelQueuedInTx` from lib/server/admin-job-actions.ts; switch admin-users setUserBlocked to it (WP2 repeats F6's QUEUED→REVOKED update).
- [ ] users sort last_seen_desc ≈480 ms at 50k users, balance_desc no index (03-report; index needs a migration).
- [ ] UX: pricing table at 1280 px pushes the recommendation column into the table's own scroll; consider compacting (Phase 4 UX).
- [ ] Pricing product calls to confirm with owner: pages unit = package midpoint; glossary without termCount excluded from per-unit cost; avg AI cost over jobs WITH cost data.
