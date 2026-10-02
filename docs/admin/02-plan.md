# Admin panel — Phase 2: Implementation plan

**Status:** APPROVED by the owner on 2026-10-01. The defaults in §16 are accepted, with two changes: Q10 (pricing becomes editable) and Q11 (accurate cost capture is in scope). The owner also added the pricing and unit-economics module (§17). Execution follows §18.
**Input:** `docs/admin/01-analysis.md`. Citations there are `path:line` at `857b8b8`, and this plan cites the same way.
**Audience:** a developer who has never seen this repo. Read §1–§4 first. §5–§12 are the specification. §13–§15 cover execution.

Some decisions depend on owner questions Q1–Q16 from the analysis. Those are marked **[DEFAULT Qn]**. §16 lists each default, and the owner can override any of them before approval.

---

## 1. Scope

### 1.1 In scope

A production admin panel inside the existing Next.js app, built on the existing stack and database:

1. **Admin identity and security.** This covers:
   - DB-backed admin accounts with roles;
   - a separate admin session cookie;
   - TOTP 2FA with recovery codes;
   - step-up re-authentication for sensitive actions;
   - login rate limiting and lockout;
   - an append-only audit log;
   - a CLI to bootstrap the first owner.
2. **Modules:**
   - KPI dashboard with date ranges;
   - users;
   - generations (jobs);
   - payments and finance (orders, ledger, reconciliation);
   - AI usage and cost, plus provider health;
   - moderation of public game links and results;
   - Telegram broadcasts and direct messages **[DEFAULT Q9]**;
   - runtime settings and feature flags **[DEFAULT Q8]**;
   - admin accounts and roles;
   - audit log viewer;
   - system health, workers, queue and background tasks;
   - persisted error log.
3. **Money actions**, each with a mandatory reason, confirmation, an idempotency key and an audit row in the same transaction:
   - wallet adjustment;
   - manual refund of a failed job;
   - cancel or force-fail of a stuck job (with refund);
   - recording an external refund or chargeback, with wallet clawback **[DEFAULT Q7]**.
4. **Replacing the current admin implementation** (`components/admin/AdminPage.tsx`, `app/api/admin/users/**`) and fixing its defects A1–A10 (analysis §6). A1, the phone leak, includes an additive data migration that scrubs it **[DEFAULT Q12]**.
5. **Minimal, additive hooks in product code.** The panel needs data that only product code can provide: settings overrides, an error sink, process heartbeats, and the housekeeping status. Every edit to an existing file is listed in §13.4.

### 1.2 Explicit non-goals

- No change to existing user-facing behavior beyond the listed hooks. Each hook defaults to the current env-driven value, so behavior does not change until an admin acts.
- No fixes for the product defects in analysis R15: Pro quota expiry, Pro priority, the missing-key template charge, cancel while IN_PROGRESS, lost partial refunds. They are reported only **[DEFAULT Q12]**. The panel makes several of them visible; for example, reconciliation lists lost partial refunds.
- ~~No price editing~~. Superseded by §17: per-tool price adjustment is in scope. ~~The Pro plan price (`lib/server/payments.ts:114-118`) stays out of scope.~~ **(2026-10-02: subscriptions removed — see docs/SUBS-REMOVAL.md)**
- No changes to the Click or Payme protocol. Payme state −2 is not implemented, and no outbound refund call is made to a provider.
- No user hard-delete or erasure **[DEFAULT Q6]**. Blocking is the only account action.
- No `pg_trgm` or any other extension **[DEFAULT Q13]**.
- No work on the container-specific local test failures **[DEFAULT Q3]**: 84 top-level failures in `npm test` and 29 in `test:ui`, listed in analysis §8. CI is green and must stay green. Locally, the admin work must add **zero** new failures.
- Changing `cost_json` capture for failed jobs or free-LLM calls is **optional work package WP-X1**, which runs only if Q11 is answered "yes".
- No new npm dependencies. QR codes use the existing `qrcode` package (`package.json`, already used by `lib/game/qr.ts`). TOTP and AES use `node:crypto`. Charts and tables are hand-written.
- The admin panel is not supported inside the Telegram Mini App iframe. Admin pages send `frame-ancestors 'none'`.

---

## 2. Architecture decision: where the admin lives

**Decision.** Same Next.js app and same deployment, split into three areas:

| Area | Location | Role |
|---|---|---|
| UI | top-level route **`/admin`** (`app/admin/**`) | Its own layout and shell, not the consumer `AppShell`. |
| API | **`/api/admin/**`** | The existing namespace. Every handler goes through a single `adminHandler()` guard. |
| Server logic | flat `lib/server/admin-*.ts` modules | Follows the house convention (analysis §1.2). |

`/uz/admin` becomes a server redirect to `/admin`, so old links keep working.

| Alternative | Why rejected |
|---|---|
| A. Keep the admin at `/uz/admin`, inside the consumer `AppShell` (status quo) | `app/uz/layout.tsx:1-5` wraps everything in the consumer sidebar, topbar and overlays, which are irrelevant to admins. `app/error.tsx` unmounts the shell on any error (analysis R11). It is harder to give `/uz/admin` different headers or an nginx rule without also matching consumer paths. Admin client code already leaks into user bundles through `lib/store.ts:5` (A8). |
| B. A separate Next.js app or package (monorepo) | Doubles build, deploy, env, Docker and CI. The session, DB and lib code would have to be shared across packages anyway. It is a large change to repo structure for no security gain, since it uses the same DB credentials. |
| C. A third-party admin (Retool, AdminJS, Metabase) | Adds a dependency or SaaS, and needs a direct DB connection or a broad API. It cannot reuse the server-side money logic (`refundInTx`, ledger invariants), auditing becomes uncontrollable, and it puts customer PII in an external tool. |
| D. A separate admin host or subdomain | Good for isolation, but needs DNS, TLS and nginx changes that are outside the repo. Choosing `/admin` keeps this possible later: nginx can map `admin.<domain>` to the same app and restrict `/admin` and `/api/admin` (Q14). |

Consequences:

- **No shared mutable state with consumer pages.** Admin client code lives only under `components/admin/**` and `lib/admin-api/**`. A test (`tests/admin-boundary.test.mts`) enforces that no consumer entry imports it and that it imports no `lib/server/**`.
- **Non-admins learn nothing from the cloak.** `/admin` and `/api/admin/**` return **404** to everyone who is not an admin account. This keeps the existing cloaking convention (`lib/server/admin.ts:10-14`).

---

## 3. Admin identity, authentication and sessions

### 3.1 Model

- **Admins are linked to an existing user account.** An admin account is a row in `admin_accounts` linked 1:1 to `users.id`. The **Telegram login is factor 1**: an admin must already be logged in to the site as that user through one of the existing flows (`lib/server/session.ts`).
- **TOTP is factor 2.** It uses RFC 6238 with SHA-1, 6 digits, a 30-second step and a ±1 step window. The secret is encrypted at rest with AES-256-GCM under a new env key, `ADMIN_TOTP_KEY`. **[DEFAULT Q2]**
- **The admin session is separate.** It is a row in `admin_sessions`, carried by the cookie `__Host-slaydx_admin` in prod and `slaydx_admin` in dev. The cookie is `Secure` (prod), `HttpOnly`, `SameSite=Strict`, `Path=/`, and has no Domain.
  - Idle timeout is **30 minutes** (sliding). Absolute lifetime is **12 hours**.
  - The token is 32 random bytes, and only its SHA-256 is stored, following `lib/server/session.ts:156-170`.
- **The admin session depends on the user session.** `admin_sessions.user_session_id` references `sessions(id) ON DELETE CASCADE`. On every request the guard also requires that **the same user session is still valid**. A user logout, a "logout everywhere", an expiry, or a block (`session.ts:228`) therefore kills admin access immediately.
- **Step-up re-authentication.** Sensitive permissions (§4.3) need `admin_sessions.reauth_at` to be within the last **10 minutes**. If it is older, the API returns 401 `{code:"reauth"}` and the UI asks for a fresh TOTP code.
- **The phone allow-list is retired as an authorization source.**
  - `SessionUser.isAdmin` becomes "has an `admin_accounts` row with status active or pending" (edit to `lib/server/session.ts`; see §13.4).
  - `ADMIN_PHONES` and `isAdminPhone` stay only for the existing bot `/admin` reply in `lib/server/telegram.ts:496-497`, which is not touched. The 01-analysis/03-report docs record this as a known limitation: the reply says "admin", but access now requires an admin account.

### 3.2 Flows

**Bootstrap (first owner).**
1. Run, in the worker container: `npm run admin:create -- --telegram-id <id> --role owner`. The script is `scripts/admin-create.mts`.
2. The script inserts or updates `admin_accounts` (status `pending`), creates an enrollment token valid for 30 minutes, writes an audit row (`actor = null`, `meta.via = "cli"`), and prints `APP_URL/admin/enroll?token=…`.
3. The same CLI is the break-glass path if every owner loses their 2FA. Re-running it resets 2FA and revokes that admin's sessions.

**Enrollment** (`/admin/enroll?token=`):
1. The user must be logged in as the matching user. If not, they get a 404.
2. `GET /api/admin/auth/enroll` returns the secret, the `otpauth://` URI and a QR SVG.
3. The user enters a code. `POST` verifies it, sets `totp_enabled_at` and `status='active'`, consumes the token, and generates **10 recovery codes**. These are shown once and stored hashed.
4. The server creates an admin session and writes the audit row `auth.enroll`.

**Login** (`/admin/login`):
1. The server-side layout confirms that the current user has an admin account. Otherwise it returns 404.
2. The user enters a 6-digit code, which goes to `POST /api/admin/auth/login`.
3. The code is verified and the replay guard is checked: `step > totp_last_step`, updated atomically with `UPDATE … WHERE totp_last_step < $step`.
4. Lockout limits apply.
5. The server creates the session, sets the cookie, and writes the audit row `auth.login`.
6. **Best-effort Telegram notice** to the admin's own `telegram_id`: "New admin login: time, IP". It uses `sendMessage` (`lib/server/telegram.ts:125`). The admin can then spot a stolen session.

**Recovery login.** `POST /api/admin/auth/recovery` takes a recovery code instead of a TOTP code. The code is consumed, the audit row is `auth.recovery_used`, and the Telegram notice is sent.

**Step-up.** `POST /api/admin/auth/reauth` takes a TOTP code and sets `reauth_at = now()`.

**Logout.** `DELETE /api/admin/session` sets `revoked_at` and clears the cookie.

### 3.3 Brute-force protection

All limits use `rateLimit(..., { failClosed: true })` (`lib/server/ratelimit.ts:52-86`). If the DB fails, login is refused.

| Bucket | Limit |
|---|---|
| per admin account, failed codes | 5 per 15 min → 429 with `retryAfterSec`, audit `auth.locked`, and a Telegram notice |
| per IP (`clientIp`) | 20 attempts per 15 min |
| enrollment `POST` per token | 5 failed codes, then the token is burned |

Codes are compared in constant time with `safeEqual` (`session.ts:273-278`). Errors are deliberately generic: "Kod noto'g'ri".

### 3.4 Cryptography (`lib/server/admin-crypto.ts`, `admin-totp.ts`)

- **Key.** `ADMIN_TOTP_KEY` is base64 for exactly 32 bytes; anything else is invalid. If it is missing or invalid, admin login and enrollment return 503 `{code:"admin_disabled"}`, and `runtimeWarnings()` emits a **warning**, not a fatal problem. This follows the lesson recorded at `lib/server/env.ts:356-366`.
- **Secret at rest.** `seal(plain)` produces `v1.` + base64url(iv(12) | tag(16) | ciphertext), using AES-256-GCM with a fresh random IV. `open()` rejects any other version.
- **Codes and tokens.** Recovery codes are stored as HMAC-SHA256(HKDF(key, "admin-recovery"), normalized code). Enrollment and session tokens are stored as SHA-256 of 32 random bytes.
- **Base32 (RFC 4648).** Encoding and decoding are hand-written, about 30 lines. Unit tests use the RFC 6238 Appendix B vectors.

---

## 4. RBAC

### 4.1 Roles **[DEFAULT Q1]**

Roles are a fixed set defined in code. `admin_accounts.role` carries a CHECK constraint. Role-to-permission mapping is a reviewed, testable code constant in `lib/server/admin-rbac.ts`; it is not stored in the DB, so there is no privilege-escalation surface through data.

| Role | Rank | Purpose |
|---|---|---|
| `owner` | 100 | Business owner. Can do everything, including managing owners and admins. |
| `admin` | 80 | Operations lead. Can do everything except manage owner/admin accounts. Can manage support, moderator, viewer and finance accounts. |
| `finance` | 60 | Money: payments, finance, wallet adjustments, refunds. Sees PII only in its masked form. |
| `support` | 50 | User support: users with PII, sessions, block, messages, job inspection, refunds of failed jobs. No wallet adjustments. |
| `moderator` | 40 | Public content: game links and results. Can block users. |
| `viewer` | 10 | Read-only dashboards and lists. PII is always masked. |

### 4.2 Permissions

| Permission | Meaning |
|---|---|
| `dashboard.view` | KPI dashboard |
| `users.view` | user list and detail (phone masked) |
| `users.pii` | unmask phone, profile fields, job inputs. Each reveal is audited. |
| `users.export` | CSV export of users |
| `users.block` | block or unblock, with optional side effects |
| `users.sessions` | list and revoke a user's sessions |
| `users.wallet` | wallet adjustments (money) |
| `users.message` | direct Telegram message to one user |
| `jobs.view` | generations list and detail (inputs masked) |
| `jobs.input` | view a job's raw input and download its file (audited) |
| `jobs.export` | CSV export of generations |
| `jobs.cancel` | cancel a QUEUED job, or force-fail a stuck IN_PROGRESS job (both refund) |
| `jobs.refund` | manually refund a FAILED, charged, unrefunded job |
| `payments.view` | orders, payment events |
| `payments.export` | CSV of orders |
| `payments.refund_record` | record an external refund or chargeback, with clawback |
| `finance.view` | revenue summary, global ledger, reconciliation |
| `finance.export` | CSV of the ledger |
| `ai.view` | AI cost and provider health |
| `moderation.view` | game links and results |
| `moderation.act` | revoke a link, delete a result |
| `broadcasts.view` | list broadcasts |
| `broadcasts.send` | create, test, send or cancel a broadcast |
| `settings.view` | view runtime settings |
| `settings.edit` | change runtime settings |
| `system.view` | health, workers, queue, housekeeping |
| `errors.view` | error log |
| `errors.resolve` | resolve errors |
| `audit.view` | audit log |
| `audit.export` | CSV of the audit log |
| `admins.view` | admin account list |
| `admins.manage` | create, disable, change role, reset 2FA, revoke sessions, within rank limits |
| `self` | implicit for every admin: own sessions, own recovery codes |

### 4.3 Permission matrix (role × permission)

✓ = granted. **S** = step-up required: a fresh TOTP within 10 minutes.

| Permission | owner | admin | finance | support | moderator | viewer | Step-up |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| dashboard.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| users.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| users.pii | ✓ | ✓ | | ✓ | | | |
| users.export | ✓ | ✓ | ✓ | | | | S |
| users.block | ✓ | ✓ | | ✓ | ✓ | | |
| users.sessions | ✓ | ✓ | | ✓ | | | |
| users.wallet | ✓ | ✓ | ✓ | | | | S |
| users.message | ✓ | ✓ | | ✓ | | | |
| jobs.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| jobs.input | ✓ | ✓ | | ✓ | | | |
| jobs.export | ✓ | ✓ | ✓ | | | | S |
| jobs.cancel | ✓ | ✓ | | ✓ | | | |
| jobs.refund | ✓ | ✓ | ✓ | ✓ | | | |
| payments.view | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| payments.export | ✓ | ✓ | ✓ | | | | S |
| payments.refund_record | ✓ | ✓ | ✓ | | | | S |
| finance.view | ✓ | ✓ | ✓ | | | ✓ | |
| finance.export | ✓ | ✓ | ✓ | | | | S |
| ai.view | ✓ | ✓ | ✓ | | | ✓ | |
| moderation.view | ✓ | ✓ | | ✓ | ✓ | | |
| moderation.act | ✓ | ✓ | | | ✓ | | |
| broadcasts.view | ✓ | ✓ | | ✓ | | | |
| broadcasts.send | ✓ | ✓ | | | | | S |
| settings.view | ✓ | ✓ | ✓ | | | ✓ | |
| settings.edit | ✓ | ✓ | | | | | S |
| system.view | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| errors.view | ✓ | ✓ | | ✓ | | ✓ | |
| errors.resolve | ✓ | ✓ | | | | | |
| audit.view | ✓ | ✓ | | | | | |
| audit.export | ✓ | | | | | | S |
| pricing.view | ✓ | ✓ | ✓ | | | ✓ | |
| pricing.edit | ✓ | ✓ | | | | | S |
| admins.view | ✓ | ✓ | | | | | |
| admins.manage | ✓ | ✓ (rank-limited) | | | | | S |

**Additional server-side invariants**, enforced in `admin-accounts.ts` and tested:

- An admin cannot change their own role or status, or reset their own 2FA through `admins.manage`. They use `/admin/account` for their own 2FA.
- An admin can only create or manage accounts with a strictly **lower rank** than their own. An owner can manage owners.
- The **last active owner** cannot be disabled or demoted.
- `users.block` is refused when:
  - the admin targets themselves: 409 `{code:"self"}`;
  - the target user is an active admin account and the actor lacks `admins.manage`: 403.
- Viewing or acting is never possible through the 404 cloak. Any user without an admin account gets 404. An admin without a valid admin session gets 401 `{code:"admin_auth"}`. An admin lacking the permission gets 403 `{code:"forbidden"}` and an audit row with `outcome='denied'`.

### 4.4 Enforcement: `adminHandler` (`lib/server/admin-handler.ts`)

Every route under `app/api/admin/**` exports each method as:

```ts
export const POST = adminHandler(
  "admin/users/block",                       // log scope (house convention)
  { permission: "users.block", mutation: true, rate: [30, 60] },
  async (req, ctx, admin) => { /* ... */ },
);
```

The pipeline runs in this order. Every step is server-side, and none can be bypassed by the client.

1. Wrap the call in `handler(scope, …)` (`lib/server/api.ts:211`). This provides the request id and error mapping.
2. Call `ensureMigrated()`.
3. Check the origin, for mutations only:
   - `checkOrigin(req)` (`lib/server/api.ts:95`) must pass.
   - **An `Origin` header must be present.** This is stricter than user routes, which allow a missing Origin (`api.ts:100-101`).
   - On failure: 403.
4. Run `currentUser()`. If there is no user, or the user has no admin account, or the account is `disabled`: **404** "Topilmadi".
5. Read the admin cookie, then load the session. It must be:
   - unrevoked;
   - within `idle_expires_at` and `expires_at`;
   - bound to an active `admin_accounts` row with status `active`;
   - linked to a `user_session_id` whose session token matches the current user cookie.

   Otherwise: **401** `{code:"admin_auth"}`.
6. Slide the idle expiry, writing at most once per 60 seconds.
7. Check `can(admin.role, permission)`. If it fails: write the audit row `denied` and return **403** `{code:"forbidden"}`.
8. If the permission needs step-up and `reauth_at` is older than 10 minutes: **401** `{code:"reauth"}`.
9. Check the rate limit with `rateLimit("admin:<adminId>:<scope>", …, {failClosed:true})`. The defaults are reads 300/60 s and mutations 30/60 s. Over the limit: 429.
10. Call `addLogContext({ userId, adminId })`. This also fixes A6.
11. Call `fn(req, ctx, admin)`. `admin` is `{ id, userId, role, permissions, sessionId, ip, userAgent, requestId }`.

A static test, `tests/admin-route-guard.test.mts`, scans every `app/api/admin/**/route.ts`. It fails if an exported HTTP method is not an `adminHandler(...)` call with a literal permission that exists in the matrix. The only exceptions are the auth routes listed in §6.1, which use `adminAuthHandler` with no session requirement.

The legacy `requireAdmin` (`lib/server/admin.ts`) is deleted in the integration step once no route uses it.

---

## 5. Data model changes

All changes are additive. There are four new migration files, numbered contiguously from **028**, as required by `tests/migrations.test.mts:28-51`. Each file:

- starts with `SET LOCAL lock_timeout = '5s';`
- uses `IF NOT EXISTS` everywhere;
- includes an English header comment and a commented `-- ROLLBACK` block, following the precedent in `M/025:20-28`.

No existing column is dropped or altered. The only data change to an existing table is the A1 phone scrub in `031`, which copies the original note into the audit log first **[DEFAULT Q12]**.

### 5.1 `028_admin_core.sql`

```sql
CREATE TABLE IF NOT EXISTS admin_accounts (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  role             TEXT NOT NULL CHECK (role IN ('owner','admin','finance','support','moderator','viewer')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
  totp_secret_enc  TEXT,                       -- admin-crypto seal(); NULL until enrolled
  totp_enabled_at  TIMESTAMPTZ,
  totp_last_step   BIGINT NOT NULL DEFAULT 0,  -- TOTP replay guard
  created_by       BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ,
  disabled_at      TIMESTAMPTZ,
  disabled_reason  TEXT
);

CREATE TABLE IF NOT EXISTS admin_enrollments (
  token_hash   TEXT PRIMARY KEY,
  admin_id     BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  created_by   BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  attempts     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS admin_enrollments_admin_idx ON admin_enrollments(admin_id);

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at     TIMESTAMPTZ,
  UNIQUE (admin_id, code_hash)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id               BIGSERIAL PRIMARY KEY,
  admin_id         BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  user_session_id  BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash       TEXT NOT NULL UNIQUE,
  ip               TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at  TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  reauth_at        TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  revoke_reason    TEXT
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions(admin_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_id       BIGINT REFERENCES admin_accounts(id) ON DELETE RESTRICT,  -- NULL = CLI / system / migration
  actor_user_id  BIGINT,
  actor_role     TEXT,
  action         TEXT NOT NULL,          -- e.g. 'users.block', 'auth.login', 'users.wallet.adjust'
  target_type    TEXT,                   -- 'user' | 'generation' | 'order' | 'game_session' | 'setting' | 'admin' | ...
  target_id      TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('ok','denied','failed')),
  reason         TEXT,
  before         JSONB,
  after          JSONB,
  meta           JSONB,                  -- idempotency key, filters of an export, via:'cli', etc.
  request_id     TEXT,
  ip             TEXT,
  user_agent     TEXT
);
CREATE INDEX IF NOT EXISTS admin_audit_at_idx ON admin_audit_log(at DESC, id DESC);
CREATE INDEX IF NOT EXISTS admin_audit_admin_idx ON admin_audit_log(admin_id, at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit_log(target_type, target_id, at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit_log(action, at DESC);

-- Append-only: the application role cannot UPDATE/DELETE/TRUNCATE audit rows.
CREATE OR REPLACE FUNCTION admin_audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'admin_audit_log is append-only'; END $$;
DROP TRIGGER IF EXISTS admin_audit_log_no_update ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_update BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_immutable();
DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_truncate BEFORE TRUNCATE ON admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_log_immutable();
```

Notes:
- Nothing ever deletes users, and `ON DELETE RESTRICT` on `admin_accounts.user_id` protects the link.
- The existing session purge deletes expired `sessions` rows (`session.ts:258-270`), and the cascade from `sessions` cleans up stale `admin_sessions`.
- This adds the repo's first plpgsql function and trigger. The repo avoids *extensions*; plpgsql is built in. The trigger is justified because append-only must hold even against a bug in the app.

### 5.2 `029_admin_ops.sql`

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS error_log (
  id             BIGSERIAL PRIMARY KEY,
  fingerprint    TEXT NOT NULL,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  count          INT NOT NULL DEFAULT 1,
  level          TEXT NOT NULL CHECK (level IN ('error','warn')),
  scope          TEXT NOT NULL DEFAULT '',
  message        TEXT NOT NULL,          -- already redacted by lib/server/log.ts
  stack          TEXT,                   -- truncated to 8 KB
  request_id     TEXT,
  user_id        BIGINT,                 -- no FK (logs must never block)
  job_id         TEXT,
  path           TEXT,
  process        TEXT,
  resolved_at    TIMESTAMPTZ,
  resolved_by    BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS error_log_open_fp_idx ON error_log(fingerprint) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS error_log_last_seen_idx ON error_log(last_seen_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS process_heartbeats (
  process_id    TEXT PRIMARY KEY,        -- '<role>@<hostname>:<pid>'
  role          TEXT NOT NULL CHECK (role IN ('web','worker')),
  hostname      TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  running       INT NOT NULL DEFAULT 0,
  concurrency   INT NOT NULL DEFAULT 0,
  breakers      JSONB NOT NULL DEFAULT '[]',
  limiters      JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS housekeeping_status (
  step           TEXT PRIMARY KEY,
  last_run_at    TIMESTAMPTZ,
  last_ok_at     TIMESTAMPTZ,
  last_error_at  TIMESTAMPTZ,
  last_error     TEXT,
  last_rows      INT,
  runs           BIGINT NOT NULL DEFAULT 0,
  failures       BIGINT NOT NULL DEFAULT 0,
  last_process   TEXT
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id           BIGSERIAL PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sending','done','cancelled')),
  text         TEXT NOT NULL,            -- plain text; HTML-escaped at send time
  audience     JSONB NOT NULL,           -- {kind:'all'|'paid'|'active_days', days?}
  total        INT NOT NULL DEFAULT 0,
  sent         INT NOT NULL DEFAULT 0,
  failed       INT NOT NULL DEFAULT 0,
  created_by   BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  queued_at    TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  broadcast_id  BIGINT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL,
  telegram_id   BIGINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  error         TEXT,
  sent_at       TIMESTAMPTZ,
  PRIMARY KEY (broadcast_id, user_id)
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_pending_idx ON broadcast_recipients(broadcast_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS payment_refunds (       -- external refunds / chargebacks recorded by finance [Q7]
  id                BIGSERIAL PRIMARY KEY,
  order_id          UUID NOT NULL REFERENCES payment_orders(id) ON DELETE RESTRICT,
  amount_soum       BIGINT NOT NULL CHECK (amount_soum > 0),
  kind              TEXT NOT NULL CHECK (kind IN ('refund','chargeback')),
  reason            TEXT NOT NULL,
  clawback_wallet   TEXT CHECK (clawback_wallet IN ('balance','quota')),
  clawback_amount   BIGINT NOT NULL DEFAULT 0,  -- actually debited (cannot go below 0)
  shortfall         BIGINT NOT NULL DEFAULT 0,  -- requested - debited
  clawback_tx_id    BIGINT,                     -- transactions.id of the admin_debit row
  created_by        BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_refunds_order_idx ON payment_refunds(order_id);
```

### 5.3 `030_admin_indexes.sql`

This file contains only indexes. It runs inside a transaction, which locks each table briefly. At today's size (about 100 generations, per `audit/DEPLOY-RUNBOOK.md:130`) that takes milliseconds. The 03-report runbook explains how to pre-create these indexes `CONCURRENTLY` by hand on a large database.

```sql
CREATE INDEX IF NOT EXISTS users_created_idx           ON users(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS users_username_lower_idx    ON users(lower(username) text_pattern_ops) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_name_lower_idx        ON users(lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS users_blocked_idx           ON users(id) WHERE is_blocked;
CREATE INDEX IF NOT EXISTS generations_created_idx     ON generations(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS generations_status_created_idx ON generations(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS generations_tool_created_idx   ON generations(tool_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_created_idx    ON transactions(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_kind_created_idx ON transactions(kind, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS payment_orders_created_idx  ON payment_orders(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS payment_orders_state_created_idx ON payment_orders(state, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS payment_orders_paid_perform_idx  ON payment_orders(perform_time) WHERE state = 'paid';
CREATE INDEX IF NOT EXISTS game_sessions_created_idx   ON game_sessions(created_at DESC, id DESC);
```

### 5.4 `031_admin_legacy_notes.sql` **[DEFAULT Q12]**

This migration fixes A1 for existing rows.

1. Copy every `transactions` row with `kind IN ('admin_credit','admin_debit')` and `note ~ '^admin:\+?[0-9]'` into `admin_audit_log`. Each copy gets:
   - `action='legacy.wallet_adjust'`, `outcome='ok'`;
   - `meta = {transaction_id, original_note}`;
   - `at = created_at`.
2. Set `note = 'Ma''muriy tuzatish' || <the part after "admin:<phone>: ">` on those rows, so the phone no longer appears in the note.

Rollback: restore the original notes from `admin_audit_log.meta->>'original_note'`. The SQL is written in the rollback comment.

From now on, new admin ledger rows have the neutral user-visible note "Ma'muriy tuzatish". The actor and reason are stored **only** in the audit log.

### 5.5 Data retention

| Data | Retention |
|---|---|
| `admin_audit_log` | forever, append-only **[DEFAULT Q15]** |
| `error_log` | 90 days after `last_seen_at`, purged by the housekeeping step `purgeErrorLog` |
| `process_heartbeats` | deleted 1 day after `last_seen_at` |
| `admin_sessions` | follows the `sessions` purge cascade, plus a purge of rows past `expires_at` + 7 days |
| `admin_enrollments` | consumed or expired rows purged after 7 days |
| `broadcast_recipients` | 180 days |

---

## 6. API contract

### 6.0 Conventions for all admin endpoints

- **Base path:** `/api/admin`. Every route file sets `runtime="nodejs"` and `dynamic="force-dynamic"`, and wraps each method in `adminHandler` (§4.4).
- **Status codes shared by all endpoints** (not repeated per row):

  | Status | Meaning |
  |---|---|
  | 404 | not an admin account |
  | 401 `{code:"admin_auth"}` | no valid admin session |
  | 401 `{code:"reauth"}` | step-up needed |
  | 403 `{code:"forbidden"}` | lacks permission |
  | 403 | bad Origin |
  | 429 `{retryAfterSec}` | rate limited |
  | 413 | body too large |
  | 500 `{error, requestId}` | unexpected error |

  Error bodies are always `{error: "<Uzbek>", code?, ...extra}` (`lib/server/api.ts:70-78`).
- **Lists.** Query parameters:
  - `limit` (1..100, default 50);
  - `cursor` (opaque base64url);
  - `sort` (whitelisted per endpoint, with the first value as the default);
  - filters as documented;
  - `from` / `to` as `YYYY-MM-DD`, read as **Asia/Tashkent** calendar days, inclusive, span ≤ 366 days.

  The response is `{ items: T[], nextCursor: string|null, total: number|null, totalCapped: boolean }`. `total` comes from `count(*)` with `LIMIT 10001`, and `totalCapped` means "10 000+". Pagination is keyset on `(sortColumn, id)`. Invalid input returns 400, never 500 (BEA-13).
- **Exports.** `GET …/export?<same filters>` streams `text/csv; charset=utf-8` with a BOM:
  - cells are protected against formula injection (`= + - @` and tab/CR at the start, following `app/api/generations/[id]/results/route.ts:21-25`);
  - output is capped at 100 000 rows;
  - timestamps are in Asia/Tashkent;
  - every export writes an audit row with `meta.filters`.
- **Money mutations** require the header `Idempotency-Key: <uuid v4>`. Replaying the same key with the same body returns the original result plus `Idempotent-Replayed: true`. The same key with a different body returns 422.
- **Every mutation:**
  - reads the body with `readJson(req, ≤8 KB)`;
  - requires a `reason` string of 5–500 characters, except where a row says "reason optional";
  - writes exactly one audit row (or more where documented) **in the same DB transaction** as the change;
  - returns the updated resource.
- **Masking.** Without `users.pii`:
  - phone becomes `+998 ** *** ** 12`;
  - job inputs (`values_json`) are reduced to keys only, plus the `topic`;
  - profile fields such as university are shown.

### 6.1 Auth and session

These routes use `adminAuthHandler`. It requires a logged-in user with an admin account, but no admin session.

| Method | Path | Body / params | Response | Errors |
|---|---|---|---|---|
| GET | `/api/admin/session` | — | `{admin:{id,userId,name,username,role,permissions[],status,totpEnabled}, session:{id,expiresAt,idleExpiresAt,reauthUntil}\|null}` | 404 (not an admin) |
| POST | `/api/admin/auth/login` | `{code:"123456"}` | 200 `{admin, session}` + Set-Cookie | 400 bad format; 401 `{code:"bad_code"}`; 409 `{code:"not_enrolled"}`; 429 lockout; 503 `{code:"admin_disabled"}` |
| POST | `/api/admin/auth/recovery` | `{code:"XXXX-XXXX-XX"}` | as login, plus `{remaining}` | same as login |
| POST | `/api/admin/auth/reauth` | `{code}` (needs an admin session) | `{reauthUntil}` | 401 bad code; 429 |
| DELETE | `/api/admin/session` | — | `{ok:true}` and the cookie cleared | — |
| GET | `/api/admin/auth/enroll?token=` | — | `{account:{role}, secret, otpauthUri, qrSvg}` | 404 bad, expired, consumed, or user mismatch |
| POST | `/api/admin/auth/enroll` | `{token, code}` | `{recoveryCodes:string[10]}` + Set-Cookie | 400; 401 bad code; 404 token; 429 |

### 6.2 Own account (`self`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/admin/me/sessions` | — | `{items:[{id,createdAt,lastSeenAt,ip,userAgent,current}]}` |
| POST | `/api/admin/me/sessions/:id/revoke` | `{}` (reason optional) | `{ok}` |
| POST | `/api/admin/me/recovery-codes` | `{code}` (a fresh TOTP is required in the body) | `{recoveryCodes[10]}`. Old codes are invalidated. |

### 6.3 Dashboard (`dashboard.view`)

| Method | Path | Params | Response |
|---|---|---|---|
| GET | `/api/admin/metrics/overview` | `from,to` | `{range, current:Kpis, previous:Kpis}`. `Kpis = {newUsers, activeUsers, generations:{total,completed,failed,revoked}, successRate, revenueSoum:{total,click,payme,topup,pro}, paidOrders, cashSpendTanga, bonusSpendPoints, refunds:{count,tanga,points}, aiCostUsd, aiCoverage, marginSoum, pendingOrders}` |
| GET | `/api/admin/metrics/series` | `metric ∈ {revenue,generations,signups,ai_cost,refunds}`, `from,to` | `{metric, points:[{day:"YYYY-MM-DD", values:{…}}]}`. Zero-filled per day. |
| GET | `/api/admin/metrics/tools` | `from,to` | `{items:[{toolId,title,count,completed,failed,failRate,cashSpend,aiCostUsd,avgDurationSec}]}` |
| GET | `/api/admin/metrics/live` | — | `{queued, running, oldestQueuedSec, inflightUsers, workersAlive, workersStale}` |

### 6.4 Users

| Method | Path | Permission | Params / body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/admin/users` | users.view | `q` (§6.4.1), `blocked∈{0,1}`, ~~`plan∈{free,pro}`~~ **(2026-10-02: subscriptions removed)**, `isAdmin∈{0,1}`, `from,to` (signup), `sort∈{created_desc,created_asc,balance_desc,last_seen_desc}`, `cursor,limit` | list of `AdminUserRow {id,name,username,telegramId,phoneMasked,points,quota,balance,isBlocked,isAdmin,createdAt,lastSeenAt,generations}` | 400 |
| GET | `/api/admin/users/export` | users.export (S) | same filters | CSV | |
| GET | `/api/admin/users/:id` | users.view | `reveal=1` (requires users.pii; writes the audit row `users.pii.view`) | `{user:AdminUserDetail, stats:{generations, completed, failed, spentTanga, paidSoum, storageBytes}, flags:{isAdminAccount}}` | 404 |
| GET | `/api/admin/users/:id/transactions` | users.view | `kind`, `cursor,limit` | list of `{id,kind,points,quota,balance,reference,note,createdAt,generationId?,orderId?}` | |
| GET | `/api/admin/users/:id/sessions` | users.sessions | — | `{items:[{id,createdAt,lastSeenAt,expiresAt,revokedAt,userAgent}]}` | |
| POST | `/api/admin/users/:id/sessions/revoke` | users.sessions | `{reason}` | `{revoked:n}` | 409 self |
| POST | `/api/admin/users/:id/block` | users.block | `{blocked:boolean (strict), reason, revokeSessions?:true, cancelQueued?:false, revokeLinks?:false}` | `{user, sideEffects:{sessionsRevoked, jobsCancelled, refunds, linksRevoked}}`. `blocked:false` reverses only the flag. | 400 when not a strict boolean; 409 self; 403 when the target is an admin and the actor lacks admins.manage |
| POST | `/api/admin/users/:id/wallet-adjustments` | users.wallet (S) | Header `Idempotency-Key`. `{wallet∈{points,balance} **(2026-10-02: subscriptions removed)**, delta:int≠0 \|delta\|≤100 000 000, reasonCode∈{compensation,promo,correction,manual_refund,test,other}, reason, confirm?:string}`. When `\|delta\| ≥` setting `admin.wallet_confirm_threshold` (default 1 000 000), `confirm` must equal the formatted amount. | 201 `{transactionId, wallet, before, after, user}` | 400; 409 `{code:"insufficient", available}`; 422 idempotency conflict |
| POST | `/api/admin/users/:id/message` | users.message | `{text: 1..2000}` | `{sent:boolean}` (false when the bot is blocked) | 409 `{code:"no_telegram"}` |

The wallet adjustment is implemented as `adminAdjustWalletInTx`, extracted from `lib/server/credits.ts:345-400` (see §13.4). It writes the ledger row with `reference = 'admin:' || <idempotency uuid>`, which reuses the existing `UNIQUE(kind, reference)` (`M/001:130-131`) for idempotency. The user-visible note is neutral. The audit row stores `before`/`after` per wallet, `reasonCode`, `reason` and the idempotency key.

**6.4.1 Search `q`.** The input is classified on the server; nothing is substring-scanned:

| Input | Match |
|---|---|
| `#123` or all digits ≤ 19 | `users.id` or exact `telegram_id` |
| starts with `+` or has ≥ 9 digits | exact match on the normalized phone or `local_id` |
| starts with `@` | prefix match on `lower(username)` (indexed) |
| anything else | prefix match on `lower(name)` (indexed) |

`%` and `_` are escaped. **[DEFAULT Q13]**

### 6.5 Generations

| Method | Path | Permission | Params / body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/admin/generations` | jobs.view | `status` (multi), `tool` (from the `TOOL_BY_ID` registry), `userId`, `from,to`, `hasError`, `unrefunded=1` (FAILED + charged + not refunded, any age), `stuck=1` (IN_PROGRESS with `locked_at` older than budget + 30 s), `sort∈{created_desc,created_asc,duration_desc}` | list of `{id,userId,userName,toolId,topic,status,price,progress,attempts,error,createdAt,startedAt,finishedAt,durationSec,charged:{points,quota,balance},refunded,costUsd,filesPurged}`. Wide columns are never selected. | |
| GET | `/api/admin/generations/export` | jobs.export (S) | same filters | CSV | |
| GET | `/api/admin/generations/:id` | jobs.view | `reveal=1` (jobs.input, audited) | `{generation:{…all lifecycle fields, budgetMs, lockedBy, lockedAt, delivered, cost:{usd,parts[]}, docVersion, fileVersion, editedAt, hasFile, fileSize, downloads, inputs (masked unless revealed)}, ledger:[…], gameLinks:n}` | 404 |
| GET | `/api/admin/generations/:id/file` | jobs.input | — | the file bytes as an attachment, with no-store. Writes the audit row `jobs.file.download`. | 404 |
| POST | `/api/admin/generations/:id/cancel` | jobs.cancel | `{reason}` | QUEUED → REVOKED and `refundInTx` (`lib/server/refund-tx.ts:20`) in one transaction. Returns `{generation, refunded}`. | 409 `{code:"state"}` when not QUEUED |
| POST | `/api/admin/generations/:id/fail` | jobs.cancel | `{reason}` | IN_PROGRESS → FAILED, `locked_by=NULL`, `error='Administrator tomonidan to''xtatildi'`, plus `refundInTx`, in one transaction. A late worker commit is rejected by the lease fence (`lib/server/jobs.ts:920,943`), and its own refund attempt is idempotent. | 409 when not IN_PROGRESS |
| POST | `/api/admin/generations/:id/refund` | jobs.refund | Header `Idempotency-Key`. `{reason}` | FAILED, charged and unrefunded → `refundInTx`. Returns `{refunded:{points,quota,balance}}`. | 409 `{code:"not_refundable"}` for COMPLETED jobs (use a wallet adjustment instead), already-refunded jobs, or uncharged jobs |

### 6.6 Payments and finance

| Method | Path | Permission | Params / body | Response |
|---|---|---|---|---|
| GET | `/api/admin/orders` | payments.view | `state` (multi), `provider`, `purpose`, `userId`, `q` (order uuid, `provider_txn` or `prepare_id`, exact), `from,to` (`created_at`), `sort∈{created_desc,amount_desc}` | list of `{id,userId,userName,provider,purpose,amountSoum,state,providerTxn,createdAt,createTime,performTime,cancelTime,cancelReason,credited:boolean,externalRefunds:n}` |
| GET | `/api/admin/orders/export` | payments.export (S) | same | CSV |
| GET | `/api/admin/orders/:id` | payments.view | — | `{order, events:[{id,method,responseCode,receivedAt,payload}], ledger:[…], refunds:[payment_refunds]}`. `payload` is already redacted (`lib/server/payment-events.ts:27-47`). |
| POST | `/api/admin/orders/:id/external-refund` | payments.refund_record (S) | Header `Idempotency-Key`. `{kind∈{refund,chargeback}, amountSoum ≤ order.amountSoum − already recorded, reason, clawback:boolean}` | In one transaction: inserts `payment_refunds`. If `clawback`, it debits the order's wallet (`balance` for topup, ~~`quota` for pro~~ **(2026-10-02: subscriptions removed)**) by `min(amount, available)` as `admin_debit` with reference `refund:<payment_refunds.id>`, and records `shortfall`. Writes the audit row. Returns `{refund, clawback:{debited, shortfall}}`. 409 when the order is not `paid`. |
| GET | `/api/admin/finance/summary` | finance.view | `from,to` | `{revenue:{byDay[],byProvider,byPurpose}, cashSpend, refunds, liabilities:{points,quota (eski),balance} (Σ wallets now), externalRefunds}` **(2026-10-02: subscriptions removed)** |
| GET | `/api/admin/finance/reconciliation` | finance.view | — | `{checks:[{id,title,count,sample:[…≤20]}]}` for these checks: `paid_without_ledger`, `wallet_ledger_mismatch` (bounded to 10 s, `LIMIT 100`), `failed_unrefunded`, `partial_refund_missing` (COMPLETED, `delivered.got < want`, no refund row), `orders_pending_12h`, `orders_created_24h` |
| GET | `/api/admin/transactions` | finance.view | `kind` (multi), `userId`, `reference`, `from,to` | global ledger list |
| GET | `/api/admin/transactions/export` | finance.export (S) | same | CSV |

### 6.7 AI usage and providers (`ai.view`)

| Method | Path | Params | Response |
|---|---|---|---|
| GET | `/api/admin/ai/cost` | `from,to`, `groupBy∈{day,tool,provider,model,kind}` | `{rows:[{key, calls, inputTokens, outputTokens, units, usd}], totals, coverage:{jobsWithCost, jobsCompleted, pct}, caveats:[…]}`. Built from `generations.cost_json->'parts'`, following the query pattern in `scripts/cost-report.mts:94-107`. `caveats` always lists the known gaps from analysis §4.8. |
| GET | `/api/admin/ai/providers` | — | `{keys:{gemini,anthropic,openai,openrouter,xai,fal,pexels,pixabay,azureTts,aisha}:boolean, breakers:[{process,name,state,openUntil,failures}], limiters:[{process,name,active,waiting,max}], usage24h:[{provider,model,calls,usd}]}`. Keys are booleans only. A secret value is never returned. |

### 6.8 Moderation

| Method | Path | Permission | Params / body | Response |
|---|---|---|---|---|
| GET | `/api/admin/moderation/game-links` | moderation.view | `active∈{0,1}`, `kind`, `userId`, `q` (topic prefix, case-insensitive, ≤ 100 characters), `from,to` | list of `{id,generationId,userId,userName,kind,topic,createdAt,expiresAt,active,results}` |
| GET | `/api/admin/moderation/game-links/:id` | moderation.view | — | `{link, preview: publicGameView(…) (the same answer-stripped shape the public sees), results:[{id,playerName,score,total,createdAt}] (first 200)}` |
| POST | `/api/admin/moderation/game-links/:id/revoke` | moderation.act | `{reason}` | Sets `expires_at = now()`. The public route already treats this as dead (`lib/server/game-sessions.ts:170`). Returns `{link}`. |
| POST | `/api/admin/moderation/game-results/:id/delete` | moderation.act | `{reason}` | Deletes the row. The audit row's `before` holds the full row. Returns `{ok}`. |
| POST | `/api/admin/moderation/game-results/delete` | moderation.act | `{ids:[≤100], reason}` | Bulk delete. Writes one audit row per id. |

### 6.9 Broadcasts **[DEFAULT Q9]**

| Method | Path | Permission | Body | Response |
|---|---|---|---|---|
| GET | `/api/admin/broadcasts` | broadcasts.view | `cursor` | list |
| GET | `/api/admin/broadcasts/audience` | broadcasts.view | `kind∈{all,paid,active_days}`, `days` | `{count}` of users with a `telegram_id` who are not blocked |
| POST | `/api/admin/broadcasts` | broadcasts.send | `{text:1..3500, audience}` | 201 `{broadcast}` (draft) |
| GET | `/api/admin/broadcasts/:id` | broadcasts.view | — | `{broadcast, stats}` |
| POST | `/api/admin/broadcasts/:id/test` | broadcasts.send | `{}` | Sends to the actor's own `telegram_id`. Returns `{sent}`. |
| POST | `/api/admin/broadcasts/:id/send` | broadcasts.send (S) | `{reason, confirmCount:int}`. `confirmCount` must equal the current audience count. | Snapshots the recipients and sets status `queued`. Returns `{broadcast}`. |
| POST | `/api/admin/broadcasts/:id/cancel` | broadcasts.send | `{reason}` | `{broadcast}`. Pending rows are no longer sent. |

Delivery happens in the worker housekeeping step `deliverBroadcasts`, run only by the leader. Each tick sends at most 25 messages per second and at most 600 messages. It calls `sendMessage` (`lib/server/telegram.ts:125`) with HTML-escaped text. A 403 response marks the recipient `failed`, and transient errors are retried on the next tick.

### 6.10 Settings **[DEFAULT Q8]**

| Method | Path | Permission | Body | Response |
|---|---|---|---|---|
| GET | `/api/admin/settings` | settings.view | — | `{items:[{key,label,type,value,source:'db'\|'env'\|'default',envValue,updatedBy,updatedAt,description}]}` |
| PUT | `/api/admin/settings/:key` | settings.edit (S) | `{value, reason}` | `{item}`. Values are validated by the catalog. Unknown keys get 404. |
| DELETE | `/api/admin/settings/:key` | settings.edit (S) | `{reason}` | `{item}` (back to the env or default value) |

The settings catalog lives in `lib/server/settings.ts`, owned by F5. Each entry has its key, type, how it is read, and which product code consumes it.

| Key | Type | Default | Consumed by |
|---|---|---|---|
| `free_llm.disabled` | bool | env `FREE_LLM_DISABLED` | `lib/server/spend.ts` `assertFreeLlmEnabled` |
| `free_llm.daily.outline` / `.udk` / `.rewrite` / `.polish` / `.global` | int ≥ 0 | env `FREE_LLM_DAILY_*` | `lib/server/spend.ts` |
| `generation.paused` | bool | false | `app/api/generations/route.ts`: 503 `{code:"paused"}` before charging |
| `generation.paused_tools` | ToolId[] | [] | same as above, per tool |
| `admin.wallet_confirm_threshold` | int | 1 000 000 | admin only |
| `finance.soum_per_usd` | int | env `SOUM_PER_USD` or 12 700 (`lib/generation/llm-pricing.ts:100-103`) | admin margin only |

Reads use a 15-second in-process cache, and a write invalidates the cache of the process that made it. Other processes pick up the change within 15 seconds; the UI says so.

### 6.11 System and errors

| Method | Path | Permission | Params / body | Response |
|---|---|---|---|---|
| GET | `/api/admin/system` | system.view | — | `{db:{ok,latencyMs,migrations:{applied,latest}}, queue:{queued,running,oldestQueuedSec}, processes:[heartbeat…, stale:boolean], housekeeping:[housekeeping_status…], config:{problems:string[], warnings:string[]} (from env.ts assertRuntimeConfig/runtimeWarnings; message text only, no values), version, nodeEnv}` |
| GET | `/api/admin/errors` | errors.view | `level`, `scope`, `resolved∈{0,1}`, `from,to`, `q` (message prefix) | list of error_log rows. `stack` is excluded from the list. |
| GET | `/api/admin/errors/:id` | errors.view | — | `{error}` with the stack |
| POST | `/api/admin/errors/:id/resolve` | errors.resolve | `{}` (reason optional) | `{error}` |
| POST | `/api/admin/errors/resolve` | errors.resolve | `{ids:[≤100]}` | `{resolved:n}`. Writes one audit row. |

### 6.12 Audit (`audit.view`)

| Method | Path | Params | Response |
|---|---|---|---|
| GET | `/api/admin/audit` | `adminId`, `action` (prefix), `targetType`, `targetId`, `outcome`, `from,to` | list of audit rows. `before`/`after` are omitted from the list. |
| GET | `/api/admin/audit/:id` | — | the full row |
| GET | `/api/admin/audit/export` | same (audit.export, S) | CSV |

### 6.13 Admin accounts

| Method | Path | Permission | Body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/admin/admins` | admins.view | — | `{items:[{id,userId,name,username,role,status,totpEnabled,lastLoginAt,createdAt,activeSessions}]}` | |
| POST | `/api/admin/admins` | admins.manage (S) | `{userId \| telegramId, role, reason}` | 201 `{admin, enrollUrl, expiresAt}`. The URL is shown once. Optional `sendViaTelegram:true` DMs the link. | 404 user; 409 already an admin; 403 rank |
| PATCH | `/api/admin/admins/:id` | admins.manage (S) | `{role?, status?∈{active,disabled}, reason}` | `{admin}`. Disabling also revokes all of that admin's sessions. | 409 self, or last owner; 403 rank |
| POST | `/api/admin/admins/:id/reset-2fa` | admins.manage (S) | `{reason}` | `{enrollUrl, expiresAt}`. Status becomes `pending`, the secret is cleared, and sessions are revoked. | 409 self; 403 rank |
| POST | `/api/admin/admins/:id/sessions/revoke` | admins.manage | `{reason}` | `{revoked:n}` | 403 rank |

---

## 7. Screen-by-screen specification

### 7.0 Shared UI rules

- **Layout.** The admin has its own layout (`app/admin/(panel)/layout.tsx`):
  - left navigation on desktop, a top bar plus drawer below `md`;
  - the content container is `max-w-7xl`, as in `components/home/HomeFiles.tsx:161`;
  - the light/dark theme comes from the existing store (`lib/store.ts:134-137`).
- **Nav visibility.** The navigation shows only the modules the admin has permission for. This is cosmetic; the server enforces permissions.
- **Copy.** All UI copy is Uzbek (Latin), and English `aria-label`, `title`, `placeholder` and `alt` are not allowed (`tests/ui-strings.test.mts`). Numbers use `toLocaleString("uz-UZ")`. Dates use `DD.MM.YYYY HH:mm` in Asia/Tashkent. Money is shown as "so'm" or "tanga". Numbers use `tabular-nums`.
- **States.** Every list and detail view has four states:

  | State | Rendering |
  |---|---|
  | **loading** | skeleton rows |
  | **empty** | an `EmptyState` with the reason, plus a "clear filters" action when filters are set |
  | **error** | an `ErrorState` with the message, `requestId` and a retry button |
  | **forbidden** | 403 renders "Ruxsat yo'q" |

  A 401 `admin_auth` redirects to `/admin/login?next=…`. A 401 `reauth` opens the step-up dialog and replays the action once after success.
- **Lists.** Filters live in the URL query, so views are shareable and the back button works. Changing a filter resets the cursor. Pending requests are aborted, which fixes the race in A-list (analysis frontend §10). Pagination is keyset with "Oldingi" (a client-side cursor stack) and "Keyingi", plus "N ta natija" or "10 000+".
- **Mutations.**
  - A `ConfirmDialog` shows the target, its before → after state, a **reason** field (required where the API requires it), and a typed confirmation for large money amounts or bulk actions.
  - The confirm button is disabled while the request is in flight.
  - Every money action sends an `Idempotency-Key`, generated once per dialog open.
  - Success shows a toast. Errors appear inline in the dialog.
- **Tables.** Tables use `DataTable`:
  - a sticky header and sortable columns (only the whitelisted ones);
  - row click opens the detail page;
  - a checkbox column only where a bulk action exists;
  - a card-list fallback below `sm`;
  - horizontal scroll at medium widths.
- **Narrow viewports.** The layout must not overflow horizontally at 360 px, apart from the table's own scroll area.

### 7.1 Screens

| # | Route | Purpose | Columns / content | Filters | Sort | Bulk actions | Export | Permission |
|---|---|---|---|---|---|---|---|---|
| S1 | `/admin/login` | TOTP login | 6-digit code input (autocomplete `one-time-code`), "Tiklash kodi bilan kirish" toggle, lockout countdown | — | — | — | — | admin account |
| S2 | `/admin/enroll?token=` | 2FA enrollment | QR code, manual secret with copy, code input; afterwards the 10 recovery codes with "Nusxa olish" / "Yuklab olish (.txt)" and a "Saqladim" checkbox before continuing | — | — | — | — | admin account matching the token |
| S3 | `/admin` | KPI dashboard | Date range presets (Bugun, Kecha, 7 kun, 30 kun, Shu oy, O'tgan oy, custom ≤ 366 days) with "oldingi davr" deltas. KPI tiles: new users, active users, generations, success %, revenue so'm, cash spend, refunds, AI cost $ (with coverage %), margin, pending orders. Charts: revenue per day (line), generations per day (stacked bar completed/failed), signups per day, AI cost per day. Top tools table. A live queue strip that refreshes every 15 s while the tab is visible. | date range | tools table by count | — | — | dashboard.view |
| S4 | `/admin/users` | Find users | Name, @username, Telegram ID, phone (masked), ~~plan~~ **(2026-10-02: subscriptions removed)**, balance/quota (eski)/points, generations, blocked badge, admin badge, created, last seen | q, blocked, ~~plan~~ **(2026-10-02: subscriptions removed)**, admin, signup range | created ↓↑, balance ↓, last seen ↓ | — | CSV | users.view |
| S5 | `/admin/users/[id]` | One user, 360° view | **Header:** identity, badges, wallets. **Actions** (each shown only with permission): Hamyonni tuzatish, Bloklash/Blokdan chiqarish, Sessiyalarni bekor qilish, Xabar yuborish, Telefonni ko'rsatish (reveal). **Tabs:** Umumiy (profile, stats), Generatsiyalar (list S6 filtered by user), Hisob (ledger with per-wallet split), To'lovlar (orders S8 filtered), Sessiyalar, O'yin havolalari, Audit (audit rows targeting this user) | per tab | per tab | — | — | users.view (tabs by permission) |
| S6 | `/admin/generations` | Jobs | ID (short), user, tool, topic, status pill, price, charged wallets, refunded ✓, attempts, duration, AI $, error (truncated), created | status (multi), tool, user, date range, "xato bor", "qaytarilmagan", "osilib qolgan" | created ↓↑, duration ↓ | — | CSV | jobs.view |
| S7 | `/admin/generations/[id]` | Job detail | Lifecycle timeline (created → started → finished), status, step, progress, attempts, lease, budget, error, delivered, cost breakdown (parts table), file info and download (jobs.input), inputs (masked or revealed), ledger rows, game links count. **Actions:** Bekor qilish (QUEUED), To'xtatish (stuck IN_PROGRESS), Pulni qaytarish (FAILED + unrefunded), each with ConfirmDialog and reason | — | — | — | — | jobs.view |
| S8 | `/admin/payments` | Orders | Order ID, user, provider, purpose, amount so'm, state pill, provider txn, created, performed, credited ✓, external refunds | state (multi), provider, purpose, user, date, q (exact id or txn) | created ↓, amount ↓ | — | CSV | payments.view |
| S9 | `/admin/payments/[id]` | Order detail | Order fields (provider times converted from ms), credited ledger row(s), webhook timeline (method, response code, time, expandable redacted payload), external refunds. **Action:** Tashqi qaytarishni qayd etish (finance, S) | — | — | — | — | payments.view |
| S10 | `/admin/finance` | Money overview | Tab **Xulosa:** revenue per day (chart), by provider and purpose, cash spend, refunds, liabilities (Σ wallets). Tab **Hisob kitobi:** global ledger table (kind, user, per-wallet deltas, reference link, note, time). Tab **Muvofiqlashtirish:** each check with count, sample rows and links | date range; ledger: kind, user, reference | ledger: created ↓ | — | ledger CSV | finance.view |
| S11 | `/admin/ai` | AI cost and providers | Tab **Xarajat:** group-by selector, table and daily chart, coverage banner with caveats. Tab **Provayderlar:** key presence grid, breaker states per process (open = red), limiter load, 24 h usage by provider/model | date range, groupBy | by usd ↓ | — | — | ai.view |
| S12 | `/admin/moderation` | Public game content | Topic, kind, owner, created, expires, active, results count. Row → drawer with the public preview, result list (player name, score, time) and per-result delete checkboxes. **Actions:** Havolani o'chirish (revoke), Natijani o'chirish (single or bulk) | active, kind, user, q (topic prefix), date | created ↓ | delete results (≤ 100) | — | moderation.view |
| S13 | `/admin/broadcasts` | Telegram announcements | Status, text preview, audience, total/sent/failed, created by, created. "Yangi xabar" → editor (textarea with character counter, audience picker with live count, "O'zimga sinov" test-send, "Yuborish" with typed count confirm). Detail shows progress and a cancel action | status | created ↓ | — | — | broadcasts.view |
| S14 | `/admin/settings` | Runtime flags | Grouped cards: Bepul AI (kill switch, daily caps), Generatsiya (pause all, paused tools multi-select from the registry), Moliya (so'm per USD, wallet confirm threshold). Each card shows the current value, its source (DB, env or default), the env value, and who changed it and when. Edit opens a dialog with a reason. "Standartga qaytarish" resets to the default | — | — | — | — | settings.view |
| S15 | `/admin/system` | Ops health | DB status and latency, migrations, queue, processes table (role, host, started, last seen, running/concurrency, stale badge), housekeeping steps table (last run, last ok, failures, last error), config problems and warnings | — | — | — | — | system.view |
| S16 | `/admin/errors` | Error log | Last seen, count, level, scope, message, path, process, resolved | level, scope, resolved, date, q | last seen ↓ | resolve (≤ 100) | — | errors.view |
| S17 | `/admin/audit` | Audit trail | Time, admin, role, action, target (link), outcome, reason, IP. Row → drawer with a before/after JSON diff and meta | admin, action, target, outcome, date | time ↓ | — | CSV (owner) | audit.view |
| S18 | `/admin/admins` | Admin accounts | Name, @username, role, status, 2FA ✓, last login, active sessions. **Actions:** Admin qo'shish (pick a user by Telegram ID or user ID, then a role), Rolni o'zgartirish, O'chirish/Yoqish, 2FA ni tiklash, Sessiyalarni bekor qilish. Rank limits are mirrored in the UI and enforced on the server | — | — | — | — | admins.view |
| S19 | `/admin/account` | My account | My role and permissions, my sessions (revoke), regenerate recovery codes (needs TOTP), logout | — | — | — | — | self |

Error pages: `app/admin/(panel)/error.tsx`, an admin-styled error with `requestId`, retry, and the shell kept. `loading.tsx` is a skeleton.

---

## 8. Audit log design

- **Who:**
  - `admin_id`, `actor_user_id` and `actor_role` are captured at action time, so a later role change does not rewrite history;
  - `ip` comes from `clientIp(req)` (`lib/server/ratelimit.ts:114-130`);
  - `user_agent` is truncated to 300 characters;
  - `request_id` is the same id as the `x-request-id` response header and the log lines.
- **What:**
  - `action` follows `<module>.<verb>`, e.g. `users.block`, `users.wallet.adjust`, `jobs.refund`, `settings.update`, `auth.login`, `users.pii.view`, `export.users`;
  - `target_type` and `target_id` identify the object;
  - `reason` is mandatory for mutations;
  - `meta` holds the idempotency key, export filters, row counts and the `via` value.
- **Before and after:** JSON snapshots of **only the changed fields**. Examples: `{is_blocked:false}` → `{is_blocked:true}`; wallet `{balance:5000}` → `{balance:15000}`; settings `{value:false, source:"env"}` → `{value:true, source:"db"}`. Secrets are never snapshotted (TOTP secrets, codes, tokens). PII fields are written only when they are the subject of the change.
- **When:** `at` is the DB `now()`. Because it is written in the same transaction, it equals the commit time.
- **Outcomes:**
  - `ok`: written inside the mutation's transaction, so the audit and the change both commit or both roll back;
  - `denied`: written in its own small transaction when the permission check fails;
  - `failed`: for auth failures only. Domain validation failures (400/409) are **not** audited, to avoid noise; the request log has them.
- **Append-only:** enforced by the DB triggers (§5.1). There is no API to edit or delete audit rows.
- **Reads that are audited:** PII reveal, job input reveal and file download, every export, and viewing the audit log export.
- **Integration with logs:** `writeAudit` also emits `log("info", "[admin] <action>", {...})` with the same `request_id`, so stdout and DB correlate.

---

## 9. Performance

- **Never select wide columns in lists.** `html`, `doc_json`, `doc_prev`, `live_json`, `values_json` and every `bytes` column stay out of list queries; follow the narrow-column pattern of `SUMMARY_COLUMNS` (`lib/server/jobs.ts:90-105`). Detail endpoints select the specific JSONB keys they need.
- **Server-side everything.** Pagination is keyset (§6.0). Sorting is limited to whitelisted, indexed orders (§5.3). Filters run in SQL with `$n` parameters. Counts are capped at 10 001.
- **Aggregations run in bounded transactions.** Dashboard, finance and AI-cost queries run inside `transaction` with `SET TRANSACTION READ ONLY` and `SET LOCAL statement_timeout = '10s'`.
  - Day buckets use `(ts AT TIME ZONE 'Asia/Tashkent')::date`, and the range is capped at 366 days.
  - Results are cached **60 s in-process**, keyed by `(endpoint, from, to, params)`. The `live` endpoint is not cached.
  - There are no materialized views. That is the right trade-off at today's scale (analysis §3, about 100 generations). When `generations` passes about 1M rows, add a nightly `daily_metrics` rollup table. This is documented in 03-report as a known limitation and is not built now.
- **Pool protection.** Admin traffic shares the 10-connection pool (`lib/server/env.ts:125`). The rate limits (§4.4) and the 10-second statement timeout bound the impact. Exports stream in batches of 1 000 using keyset paging, and never hold one long query open.
- **Reconciliation `wallet_ledger_mismatch`** is a full aggregate over `transactions`. It runs only on demand from the finance page, with a 10 s timeout and `LIMIT 100`. The UI shows "timed out — narrow the range" if the timeout is hit.
- **Indexes:** §5.3. Every list endpoint's default sort is backed by one of them. This is verified with `EXPLAIN` in the WP tests' review checklist.
- **Client.** Admin bundles are split from user bundles (§13, test). Charts are lightweight inline SVG. There is no polling except the dashboard live strip (15 s, paused when the tab is hidden) and the broadcast detail page while it is sending (5 s).

---

## 10. Threat model (admin surface)

| # | Threat | Vector | Mitigation | Verified by |
|---|---|---|---|---|
| T1 | Account takeover of an admin | Stolen Telegram account or SIM swap; leaked Mini App `initData`, replayable for 24 h (`lib/server/auth.ts:82-83`) | TOTP second factor; separate short-lived admin session (30 min idle, 12 h absolute); Telegram notice on every admin login and lockout; recovery codes stored hashed | admin-auth tests |
| T2 | Session theft or fixation | XSS in the consumer app; cookie replay | `HttpOnly`, `SameSite=Strict`, `__Host-` cookie; session bound to the live user session; the token is new at every login; idle and absolute expiry; revocation; admin pages not framable | auth tests; header test |
| T3 | CSRF | Cross-site form or fetch | `SameSite=Strict` admin cookie, **plus** `Origin` required and checked on every mutation; GET routes are side-effect-free apart from audit writes | route tests with a foreign or missing Origin |
| T4 | Privilege escalation | Calling endpoints beyond the role; editing one's own role; managing a higher rank; DB tampering of roles | `adminHandler` permission check on every route (static test); matrix in code; rank and self rules; last-owner guard; all role changes audited | permission matrix test; admins tests |
| T5 | IDOR | Guessing ids | Admin endpoints are global by design, but gated by permission; every id is parsed strictly (`parseIntParam` / UUID regex), so a bad id gives 404, never 500 | malformed-params tests |
| T6 | SQL injection | Filters, sort, search | Only `$n` parameters; sort and filter values mapped through whitelists to constant SQL fragments; `LIKE` metacharacters escaped | unit tests on the list builder |
| T7 | XSS | User-controlled strings (names, topics, player names, error messages, webhook payloads) rendered in admin | React escaping only; **no `dangerouslySetInnerHTML`** in `components/admin/**` (static test); JSON shown as text; links built from ids, never raw URLs | static test |
| T8 | Telegram HTML injection | Broadcast or message text sent with `parse_mode: HTML` (`lib/server/telegram.ts:133-139`) | Escape `& < >` before sending; length caps | unit test |
| T9 | Mass assignment | Extra body fields | Each handler reads explicit fields from `unknown` and validates strictly (e.g. `blocked` must be a boolean, fixing A5); no spread of the body into SQL | route tests |
| T10 | Brute force of TOTP or recovery codes | Online guessing | Per-account and per-IP fail-closed limits; replay guard (`totp_last_step`); constant-time compare; generic errors; enrollment token burned after 5 failures | auth tests |
| T11 | Data exfiltration | Bulk export, PII browsing | Export needs a separate permission and step-up, is capped, and is audited with its filters; PII masked by default; reveals audited; rate limits | export and audit tests |
| T12 | Secrets leaking to the client | Env values, keys, TOTP secrets in API responses or bundles | Provider keys reported as booleans only; config problems reported as message strings; the TOTP secret is returned only during enrollment to the matching user; client boundary test so no server module reaches the client bundle | `admin-boundary` and `client-bundle-guard` tests |
| T13 | Money abuse by an insider | Repeated credits, self-credit | Idempotency keys; mandatory reason; typed confirmation above the threshold; step-up; audit with before/after; rate limits; **an admin cannot adjust their own wallet** (409 `self`) | wallet tests |
| T14 | Double refund | Admin refund racing a worker refund or reconcile | Every path uses `refundInTx`, which is idempotent on `(kind='refund', reference)` (`lib/server/refund-tx.ts:26-29`), plus the `transactions_ref_idx` unique index; FOR UPDATE on the generation row | job-action tests |
| T15 | Audit tampering | Editing or deleting audit rows | Append-only trigger; no API to edit; audit written in the same transaction as the change | trigger test |
| T16 | Enumeration of the panel | Non-admins probing `/admin` and `/api/admin` | 404 for any user without an admin account; admin client code not in user bundles (fixing A8); `X-Robots-Tag: noindex` | boundary and bundle tests |
| T17 | Clickjacking | Framing `/admin` | An extra CSP header on `/admin/:path*` and `/api/admin/:path*` with `frame-ancestors 'none'`. Browsers enforce the intersection of multiple CSPs. Also `Cache-Control: no-store` | header test |
| T18 | DoS via heavy queries | Expensive filters or exports | Statement timeout 10 s; capped ranges, limits and counts; rate limits; export batching | perf checklist |
| T19 | Lost admin access (availability) | All owners lose TOTP | Recovery codes; CLI break-glass in the worker container | runbook in 03-report |
| T20 | Stale privileges | A disabled admin keeps working | Each request re-reads account status; disabling revokes sessions in the same transaction | admins tests |

Residual risks, documented in 03-report:
- the consumer CSP still allows `'unsafe-inline'` scripts (`next.config.ts:47`), which is out of scope;
- the IP allow-list is an optional nginx step (Q14);
- an admin with `users.pii` can read PII, which is mitigated by audit only.

---

## 11. Test strategy

**Rule:** no existing test is weakened, skipped or deleted. The bar is **CI fully green** (typecheck, lint, test, test:viewer, test:ui, build), plus zero new local failures relative to the container baseline in analysis §8. **[DEFAULT Q3]**

| Layer | What | Where |
|---|---|---|
| Unit (no DB) | base32 and RFC 6238 vectors; AES-GCM seal/open (tamper detection, version); recovery-code format and hash; RBAC matrix equals the §4.3 table (snapshot of the full matrix); rank rules; cursor codec; sort/filter whitelist builder (injection attempts); `q` classifier; Tashkent date ranges; CSV cell escaping; PII masking; Telegram HTML escape; settings catalog validation | `tests/admin-*.test.mts` (flat) |
| Static | every `app/api/admin/**/route.ts` method uses `adminHandler` or `adminAuthHandler` with a valid permission; no `dangerouslySetInnerHTML` in `components/admin/**`; no `lib/server` import from admin client code; no consumer entry imports admin modules (extends `tests/bundle-split.test.mts`) | `tests/admin-route-guard.test.mts`, `tests/admin-boundary.test.mts` |
| DB integration (real Postgres; skipped without `DATABASE_URL`, per the house pattern) | migrations 028–031 apply on a fresh DB (`createIsolatedDb`), the append-only trigger rejects UPDATE/DELETE, and the rollback blocks drop cleanly; login, enroll, recovery, reauth, lockout, replay, session binding to the user session, idle and absolute expiry; **permission matrix**: for every route and method × each role, call through the real handler with a seeded admin session and assert 403 when the role lacks the permission and not-403 otherwise (generated from the route manifest); 404 for non-admins and anonymous callers; each mutation writes exactly one `ok` audit row with the right before/after; money: idempotent wallet adjustment (same key → one ledger row; different body → 422), insufficient funds, self-adjust refused, refund idempotency against `refundInTx`, cancel and fail state machines, a worker commit after a force-fail being rejected by the lease fence, external refund clawback and shortfall; settings override read by `spend.ts` and the generations route; block side effects; moderation revoke makes the public link 404 | `tests/admin-*.test.mts` |
| UI (jsdom, `tests/ui/*.test.mts`) | primitives (DataTable sort and selection, CursorPager, ConfirmDialog reason and typed-confirm, DateRangePicker presets, Toaster); per screen: loading, empty, error, forbidden, and 401 → redirect; the reauth dialog replays the action; the money dialog sends `Idempotency-Key` | `tests/ui/admin-*.test.mts` |
| Regression | full `npm run typecheck`, `lint`, `test`, `test:viewer`, `test:ui`, `build`; a failure diff against the baseline list in analysis §8 | Phase 4 |
| Manual / UX | a browser walk-through of every screen with seeded data (Playwright, using the preinstalled Chromium) at 1280 px and 360 px, light and dark, empty and error states | Phase 4 |

Seed data for development and the UX review comes from `scripts/admin-seed-dev.mts`, which runs **only when `NODE_ENV !== 'production'` and the DB name does not contain "prod"**. It creates users, generations in every status, orders, ledger rows, game links, errors and heartbeats through real code paths where they exist. The script is part of WP-F and is never run against production.

---

## 12. Frontend architecture details

- **Routes:**

  | Path | Role |
  |---|---|
  | `app/admin/layout.tsx` | server component. `dynamic="force-dynamic"`, `metadata.robots = {index:false}`. Gate: `currentUser()` plus an admin account with status pending or active, else `notFound()`. |
  | `app/admin/(auth)/login/page.tsx` | login page |
  | `app/admin/(auth)/enroll/page.tsx` | enrollment page |
  | `app/admin/(panel)/layout.tsx` | server component. Validates the admin session from cookies, and calls `redirect('/admin/login?next=…')` if it is invalid. Renders `AdminShell` with `{role, permissions, name}`. |
  | `app/admin/(panel)/**/page.tsx` | each is a thin server page that renders one client component, following the house convention |

- **Client API.** `lib/admin-api/core.ts` (`"use client"`) wraps the existing `request()` from `lib/api-client.ts` and adds:
  - an `AbortSignal` on every call;
  - an `Idempotency-Key` helper;
  - handling of 401 `admin_auth` (redirect), 401 `reauth` (calls the registered step-up handler, then retries once) and 403.

  There is one file per module (`lib/admin-api/users.ts`, `generations.ts`, …). The existing admin functions in `lib/api-client.ts:292-336` are **removed** (fixing A8).
- **Primitives** live in `components/admin/ui/*` (admin-only):
  - built on the existing `useDialog` (`components/overlays/useDialog.ts`, always called with a stable `close`) and `useConfirmClick`;
  - styled with the class recipes of `components/forms/compact.tsx`;
  - `components/forms/shared/index.tsx` and `fields.tsx` are not imported, because they pull in generation modules (analysis frontend §5).
- **Tokens.** New tokens are added to `app/globals.css` (additive): `--success`, `--warning`, `--info` and `--chart-1`…`--chart-5`, each with light and dark values and mapped in `@theme inline`.
- **Charts.** `components/admin/ui/charts/*` are hand-written responsive SVG components: line, stacked bar and sparkline. Each has a `<title>`, an `aria-label` and a visually hidden data table. Axis ticks reuse the algorithm of `niceTicks`; the code is copied into `components/admin/ui/charts/ticks.ts`, so admin code does not depend on the generation engine.
- **Formatting.** `lib/admin-format.ts` provides number, money, date (Tashkent) and relative-time helpers.

---

## 13. Work breakdown

### 13.1 Execution order

```mermaid
flowchart TD
  F1[F1 Migrations] --> F2[F2 Security core: crypto, TOTP, RBAC, sessions, audit, adminHandler, auth routes, admins API, CLI]
  F2 --> F4[F4 Server list/CSV/mask helpers]
  F2 --> F3[F3 UI foundation: layout, shell, login/enroll, primitives, admin-api core]
  F4 --> F5[F5 Product hooks: settings, error sink, heartbeats, housekeeping status, broadcast delivery, breaker/limiter snapshot, credits InTx]
  F5 --> F6[F6 Money actions: wallet, job cancel/fail/refund, external refund + dialogs]
  F3 --> F6
  F6 --> P{{Parallel WPs in worktrees}}
  P --> WP1[WP1 Dashboard]
  P --> WP2[WP2 Users]
  P --> WP3[WP3 Generations]
  P --> WP4[WP4 Payments & Finance]
  P --> WP5[WP5 AI & Providers]
  P --> WP6[WP6 Moderation]
  P --> WP7[WP7 System & Errors]
  P --> WP8[WP8 Settings UI]
  P --> WP9[WP9 Broadcasts]
  P --> WP10[WP10 Audit & Admins UI]
  WP1 & WP2 & WP3 & WP4 & WP5 & WP6 & WP7 & WP8 & WP9 & WP10 --> I[I Integration: merge, cleanup legacy, full checks]
  I --> V[Phase 4 verification]
```

The foundation work, **F1–F6, is done by the lead engineer, sequentially.** It holds every security-sensitive, money-related and product-touching change. WP1–WP10 run in parallel, each in its own git worktree, assigned to the sonnet model. The lead reviews every WP diff before merging it.

### 13.2 File ownership

No file appears in two packages. "(new)" means the file is created; "(edit)" means an existing file is changed.

**F1 — Migrations** (lead)
- `lib/server/migrations/028_admin_core.sql` (new)
- `lib/server/migrations/029_admin_ops.sql` (new)
- `lib/server/migrations/030_admin_indexes.sql` (new)
- `lib/server/migrations/031_admin_legacy_notes.sql` (new)
- `tests/admin-migrations.test.mts` (new)

**F2 — Security core** (lead)
- New server modules: `lib/server/admin-crypto.ts`, `admin-totp.ts`, `admin-rbac.ts`, `admin-session.ts`, `admin-audit.ts`, `admin-handler.ts`, `admin-accounts.ts`
- New routes:
  - `app/api/admin/session/route.ts`
  - `app/api/admin/auth/login/route.ts`, `recovery/route.ts`, `reauth/route.ts`, `enroll/route.ts`
  - `app/api/admin/me/sessions/route.ts`, `me/sessions/[id]/revoke/route.ts`, `me/recovery-codes/route.ts`
  - `app/api/admin/admins/route.ts`, `admins/[id]/route.ts`, `admins/[id]/reset-2fa/route.ts`, `admins/[id]/sessions/revoke/route.ts`
- New client API: `lib/admin-api/admins.ts`
- New script: `scripts/admin-create.mts`
- Edits:
  - `package.json` (script `admin:create`)
  - `lib/server/env.ts` (`adminTotpKey`, warning)
  - `.env.example`
  - `docker-compose.yml` (`ADMIN_TOTP_KEY` for web and worker)
  - `tests/compose-env.test.mts`
  - `lib/server/session.ts` (`isAdmin` from `admin_accounts`)
  - `lib/server/admin.ts` (`requireAdmin` delegates to the new guard until integration)
  - `next.config.ts` (admin headers)
- New tests: `tests/admin-crypto.test.mts`, `admin-totp.test.mts`, `admin-rbac.test.mts`, `admin-auth.test.mts`, `admin-accounts.test.mts`, `admin-route-guard.test.mts`, `admin-headers.test.mts`

**F3 — UI foundation** (lead)
- New routes:
  - `app/admin/layout.tsx`
  - `app/admin/(auth)/login/page.tsx`, `app/admin/(auth)/enroll/page.tsx`
  - `app/admin/(panel)/layout.tsx`, `error.tsx`, `loading.tsx`, `account/page.tsx`
- New components:
  - `components/admin/shell/*` (AdminShell, AdminNav with a static registry of all module routes and their permissions, LoginForm, EnrollForm, ReauthDialog, AccountPage)
  - `components/admin/ui/*` (DataTable, CursorPager, FilterBar, SearchInput, SelectFilter, MultiSelectFilter, DateRangePicker, ConfirmDialog, ReasonField, Toaster, StatusBadge, Tabs, Drawer, KpiTile, EmptyState, ErrorState, Skeleton, MaskedText, CopyButton, KeyValueList, JsonView, `charts/*`)
- New libs: `lib/admin-api/core.ts`, `lib/admin-api/auth.ts`, `lib/admin-format.ts`
- Edits:
  - `app/globals.css` (tokens)
  - `lib/api-client.ts` (remove the admin section)
  - `components/shell/Sidebar.tsx` (link `/uz/admin` → `/admin`)
  - `app/uz/admin/page.tsx` (redirect)
- Deletions: `app/uz/admin/loading.tsx`, `components/admin/AdminPage.tsx`
- Test edits: `tests/bundle-split.test.mts` (admin assertions)
- New tests: `tests/admin-boundary.test.mts`, `tests/ui/admin-primitives.test.mts`, `tests/ui/admin-auth.test.mts`

**F4 — Server helpers** (lead)
- New: `lib/server/admin-list.ts` (cursor, sort/filter whitelist, count cap, Tashkent ranges, `q` classifier), `lib/server/admin-csv.ts` (streaming CSV), `lib/server/admin-mask.ts`
- New tests: `tests/admin-list.test.mts`, `admin-csv.test.mts`, `admin-mask.test.mts`

**F5 — Product hooks** (lead; every product-code edit lives here)
- New modules:
  - `lib/server/settings.ts` (catalog, cached read, write)
  - `lib/server/error-sink.ts`
  - `lib/server/heartbeat.ts`
  - `lib/server/housekeeping-status.ts`
  - `lib/server/broadcast-delivery.ts`
- Edits:
  - `lib/server/spend.ts` (read the effective free-LLM settings)
  - `app/api/generations/route.ts` (pause check)
  - `lib/server/log.ts` (optional error sink hook)
  - `instrumentation.ts` (register the sink and the web heartbeat)
  - `lib/server/worker.ts` (sink, heartbeat, step status recording, `deliverBroadcasts`, purges)
  - `lib/generation/llm/breaker.ts` (export `snapshotBreakers`)
  - `lib/generation/llm/limiter.ts` (export `snapshotLimiters`)
  - `lib/server/credits.ts` (extract `adminAdjustWalletInTx`; the existing function delegates to it with unchanged behavior)
- New tests: `tests/settings.test.mts`, `error-sink.test.mts`, `heartbeat.test.mts`, `housekeeping-status.test.mts`, `broadcast-delivery.test.mts`

**F6 — Money actions** (lead)
- New server modules: `lib/server/admin-wallet.ts`, `lib/server/admin-job-actions.ts`, `lib/server/admin-order-refund.ts`
- New routes:
  - `app/api/admin/users/[id]/wallet-adjustments/route.ts`
  - `app/api/admin/generations/[id]/cancel/route.ts`, `[id]/fail/route.ts`, `[id]/refund/route.ts`
  - `app/api/admin/orders/[id]/external-refund/route.ts`
- New components: `components/admin/money/*` (WalletAdjustDialog, JobActionDialog, ExternalRefundDialog)
- New client API: `lib/admin-api/money.ts`
- New tests: `tests/admin-wallet.test.mts`, `admin-job-actions.test.mts`, `admin-order-refund.test.mts`, `tests/ui/admin-money.test.mts`

**WP1 — Dashboard** (sonnet)
- Server: `lib/server/admin-metrics.ts`
- Routes: `app/api/admin/metrics/{overview,series,tools,live}/route.ts`
- UI: `app/admin/(panel)/page.tsx`, `components/admin/dashboard/*`
- Client API: `lib/admin-api/metrics.ts`
- Tests: `tests/admin-metrics.test.mts`, `tests/ui/admin-dashboard.test.mts`

**WP2 — Users** (sonnet)
- Server: `lib/server/admin-users.ts`
- Routes:
  - `app/api/admin/users/route.ts` (**rewrite**)
  - `app/api/admin/users/[id]/route.ts` (**rewrite**: GET only)
  - `users/export/route.ts`, `users/[id]/transactions/route.ts`, `users/[id]/sessions/route.ts`, `users/[id]/sessions/revoke/route.ts`, `users/[id]/block/route.ts`, `users/[id]/message/route.ts`
- UI: `app/admin/(panel)/users/page.tsx`, `users/[id]/page.tsx`, `components/admin/users/*`
- Client API: `lib/admin-api/users.ts`
- Tests: `tests/admin-users.test.mts`, `tests/ui/admin-users.test.mts`

**WP3 — Generations** (sonnet)
- Server: `lib/server/admin-generations.ts`
- Routes: `app/api/admin/generations/route.ts`, `export/route.ts`, `[id]/route.ts`, `[id]/file/route.ts`
- UI: `app/admin/(panel)/generations/page.tsx`, `[id]/page.tsx`, `components/admin/generations/*`
- Client API: `lib/admin-api/generations.ts`
- Tests: `tests/admin-generations.test.mts`, `tests/ui/admin-generations.test.mts`

**WP4 — Payments and finance** (sonnet)
- Server: `lib/server/admin-payments.ts`, `lib/server/admin-finance.ts`
- Routes:
  - `app/api/admin/orders/route.ts`, `orders/export/route.ts`, `orders/[id]/route.ts`
  - `app/api/admin/finance/summary/route.ts`, `finance/reconciliation/route.ts`
  - `app/api/admin/transactions/route.ts`, `transactions/export/route.ts`
- UI: `app/admin/(panel)/payments/page.tsx`, `payments/[id]/page.tsx`, `finance/page.tsx`, `components/admin/payments/*`, `components/admin/finance/*`
- Client API: `lib/admin-api/payments.ts`
- Tests: `tests/admin-payments.test.mts`, `tests/admin-finance.test.mts`, `tests/ui/admin-payments.test.mts`

**WP5 — AI and providers** (sonnet)
- Server: `lib/server/admin-ai.ts`
- Routes: `app/api/admin/ai/cost/route.ts`, `ai/providers/route.ts`
- UI: `app/admin/(panel)/ai/page.tsx`, `components/admin/ai/*`
- Client API: `lib/admin-api/ai.ts`
- Tests: `tests/admin-ai.test.mts`, `tests/ui/admin-ai.test.mts`

**WP6 — Moderation** (sonnet)
- Server: `lib/server/admin-moderation.ts`
- Routes: `app/api/admin/moderation/game-links/route.ts`, `game-links/[id]/route.ts`, `game-links/[id]/revoke/route.ts`, `game-results/[id]/delete/route.ts`, `game-results/delete/route.ts`
- UI: `app/admin/(panel)/moderation/page.tsx`, `components/admin/moderation/*`
- Client API: `lib/admin-api/moderation.ts`
- Tests: `tests/admin-moderation.test.mts`, `tests/ui/admin-moderation.test.mts`

**WP7 — System and errors** (sonnet)
- Server: `lib/server/admin-system.ts`, `lib/server/admin-errors.ts`
- Routes: `app/api/admin/system/route.ts`, `errors/route.ts`, `errors/[id]/route.ts`, `errors/[id]/resolve/route.ts`, `errors/resolve/route.ts`
- UI: `app/admin/(panel)/system/page.tsx`, `errors/page.tsx`, `components/admin/system/*`, `components/admin/errors/*`
- Client API: `lib/admin-api/system.ts`
- Tests: `tests/admin-system.test.mts`, `tests/ui/admin-system.test.mts`

**WP8 — Settings** (sonnet)
- Server: `lib/server/admin-settings.ts` (route-facing wrappers over F5's `settings.ts`)
- Routes: `app/api/admin/settings/route.ts`, `settings/[key]/route.ts`
- UI: `app/admin/(panel)/settings/page.tsx`, `components/admin/settings/*`
- Client API: `lib/admin-api/settings.ts`
- Tests: `tests/admin-settings.test.mts`, `tests/ui/admin-settings.test.mts`

**WP9 — Broadcasts** (sonnet)
- Server: `lib/server/admin-broadcasts.ts`
- Routes: `app/api/admin/broadcasts/route.ts`, `broadcasts/audience/route.ts`, `broadcasts/[id]/route.ts`, `[id]/test/route.ts`, `[id]/send/route.ts`, `[id]/cancel/route.ts`
- UI: `app/admin/(panel)/broadcasts/page.tsx`, `broadcasts/[id]/page.tsx`, `components/admin/broadcasts/*`
- Client API: `lib/admin-api/broadcasts.ts`
- Tests: `tests/admin-broadcasts.test.mts`, `tests/ui/admin-broadcasts.test.mts`

**WP10 — Audit and admins UI** (sonnet)
- Server: `lib/server/admin-audit-query.ts`
- Routes: `app/api/admin/audit/route.ts`, `audit/[id]/route.ts`, `audit/export/route.ts`
- UI: `app/admin/(panel)/audit/page.tsx`, `admins/page.tsx`, `components/admin/audit/*`, `components/admin/admins/*` (uses F2's `lib/admin-api/admins.ts`)
- Client API: `lib/admin-api/audit.ts`
- Tests: `tests/admin-audit-query.test.mts`, `tests/ui/admin-audit.test.mts`, `tests/ui/admin-admins.test.mts`

**WP-SEED** (lead, after F6): `scripts/admin-seed-dev.mts` (new, dev only).

**WP-X1 (optional, only if Q11 = yes)** (lead): persist cost for failed and abandoned jobs and free-LLM calls into a new `ai_usage` table (migration `032`). This needs edits to `lib/generation/job-cost.ts`, `lib/server/worker.ts` and `lib/server/spend.ts`. It is not in the default scope.

**I — Integration** (lead):
- merge the WPs;
- delete the legacy `requireAdmin` from `lib/server/admin.ts` if nothing uses it;
- run the full checks;
- diff test failures against the baseline;
- update this plan if reality changed.

### 13.3 What every WP subagent receives

- Its section of §6 (API) and §7 (screens).
- Its file list from §13.2. **It must not touch any other file.** If it needs a change elsewhere, it stops and reports.
- The house conventions from analysis §1.2 and this plan's §6.0 and §7.0. Code comments are in English. UI copy is in Uzbek.
- The APIs it must use: `adminHandler`, `writeAudit`/`adminTx`, `admin-list`, `admin-csv`, `admin-mask`, the UI primitives, and `lib/admin-api/core.ts`.
- **Acceptance criteria:**
  1. every endpoint in its section exists with the exact path, method, permission and response shape;
  2. every screen has loading, empty, error and forbidden states and works at 360 px;
  3. every mutation writes exactly one audit row in the same transaction;
  4. new tests cover every endpoint's success path plus its 400, 404 and 409 paths;
  5. `npm run typecheck`, `npm run lint`, the WP's own test files, `tests/admin-route-guard.test.mts`, `tests/admin-boundary.test.mts` and `tests/ui-strings.test.mts` all pass;
  6. it adds no new dependencies, TODOs or placeholder data.
- Commands it can run: §14.

### 13.4 Every edit to an existing file

| File | Change | Behavior impact |
|---|---|---|
| `lib/server/session.ts` | `isAdmin` becomes `EXISTS(admin_accounts active/pending)` instead of the phone allow-list | Only the admin sidebar link and the admin gate change |
| `lib/server/admin.ts` | `requireAdmin` delegates to the new guard, then is removed at integration | Admin only |
| `lib/server/credits.ts` | extract `adminAdjustWalletInTx(client, …)`. The existing `adminAdjustWallet` signature and behavior are unchanged (`tests/admin.test.mts` keeps passing) | None |
| `lib/server/spend.ts` | free-LLM switch and caps read `settings` (default = the current env) | None until an admin changes a setting |
| `app/api/generations/route.ts` | before pricing: if `generation.paused` or the tool is paused, return 503 `{code:"paused"}` with an Uzbek message | None until an admin changes a setting |
| `lib/server/log.ts` | `setErrorSink(fn)`. `log()` calls the sink for level `error` and swallows any sink error | None (fire-and-forget, never throws) |
| `instrumentation.ts` | register the error sink and the web heartbeat timer (`unref`) | None |
| `lib/server/worker.ts` | register the sink; heartbeat every tick; wrap each housekeeping step to record status; add `deliverBroadcasts`, `purgeErrorLog` and `purgeHeartbeats` steps (leader only) | Additional housekeeping steps only |
| `lib/generation/llm/breaker.ts`, `limiter.ts` | add read-only snapshot exports | None |
| `lib/server/env.ts`, `.env.example`, `docker-compose.yml`, `tests/compose-env.test.mts` | `ADMIN_TOTP_KEY` | A new optional env var with a warning |
| `next.config.ts` | header rules for `/admin/:path*` and `/api/admin/:path*` | Admin only |
| `app/globals.css` | new color tokens | None (additive) |
| `lib/api-client.ts` | remove the admin functions and types (`:292-336`) | Smaller user bundle |
| `components/shell/Sidebar.tsx` | admin link `href` set to `/admin` | Admin only |
| `app/uz/admin/page.tsx` | redirect to `/admin` | Old link still works |
| `app/uz/admin/loading.tsx`, `components/admin/AdminPage.tsx` | deleted | Replaced by the new panel |
| `app/api/admin/users/route.ts`, `[id]/route.ts` | rewritten on the new guard | Admin only |
| `tests/bundle-split.test.mts` | **add** assertions (none removed) | Stronger test |
| `package.json` | add scripts `admin:create` and `admin:seed-dev` | None |
| Data: `transactions.note` (031) | scrub the admin phone from admin rows, keeping the original in the audit log | A user sees "Ma'muriy tuzatish" instead of `admin:+998…` |

---

## 14. Verified commands (for every implementer)

```bash
cd <worktree>
npm ci
npm run typecheck
npm run lint
# DB-backed tests need Postgres 16. In this container (no docker daemon) a throwaway server runs via
# user namespace — see docs/admin/01-analysis.md §8 and the ops recipe; connection:
export DATABASE_URL=postgres://slaydx:slaydx@127.0.0.1:5432/slaydx
npx tsx --env-file-if-exists=.env.local --import ./tests/helpers/hermetic-env.mts --conditions=react-server --test tests/admin-*.test.mts
npx tsx --tsconfig tsconfig.viewer.json --test tests/ui/admin-*.test.mts
npm test            # full suite: must not add failures vs analysis §8
npm run test:ui     # same
npm run build       # Phase 4 / integration only
```

---

## 15. Rollout and rollback

### 15.1 Rollout (production)

1. **Before deploy.**
   - Set `ADMIN_TOTP_KEY` in the prod `.env`, generated with `openssl rand -base64 32`. Store it in the password manager: losing it invalidates every TOTP enrollment, and recovery is the CLI re-enroll.
   - Take a fresh DB backup and confirm it: `scripts/backup.sh` (`scripts/backup.sh:94-129`).
2. **Deploy.** Build and run as usual (`audit/DEPLOY-RUNBOOK.md`). Migrations 028–031 apply automatically at web boot under the advisory lock (`instrumentation.ts:52-63`, `lib/server/db.ts:198`).
   - 030 takes short table locks. At today's size the whole step takes under a second.
   - If the DB is ever large, pre-create the 030 indexes `CONCURRENTLY` by hand first. The `IF NOT EXISTS` clauses then make 030 a no-op.
3. **Bootstrap the owner.** Run `docker compose -p slaydx exec worker npm run admin:create -- --telegram-id <owner tg id> --role owner`. Then open the printed link while logged in through Telegram, enroll, and store the recovery codes offline.
4. **Smoke test.**
   - `/admin` shows the dashboard.
   - `/admin/system` shows web and worker heartbeats, all fresh.
   - `/admin/audit` shows `auth.enroll` and `auth.login`.
   - A non-admin account gets 404 on `/admin` and on `/api/admin/session`.
5. **Optional (Q14).** Add the nginx `location ^~ /admin` and `location ^~ /api/admin/` allow-list. A template snippet is in 03-report.
6. **Add the other admins** from `/admin/admins`.

### 15.2 Rollback

- **App rollback.** Redeploy the previous image. Old code ignores the new tables, and the removed `/uz/admin` phone-based panel comes back with the old image. This is safe because every migration is additive. The 031 note scrub stays applied: old code only displays notes, so it is unaffected.
- **Feature kill.** To disable the admin panel without a redeploy, unset `ADMIN_TOTP_KEY` and restart web. Login and enrollment then return 503, and existing admin sessions keep working until they expire. To revoke them immediately, run `UPDATE admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL;`.
- **Settings.** If a runtime setting misbehaves, `DELETE /api/admin/settings/:key` resets it to the env default. Without the UI, run `DELETE FROM app_settings WHERE key = '<key>'`; the change takes effect within 15 seconds.
- **DB rollback** is rarely needed. Each migration's commented `-- ROLLBACK` block drops only the objects that migration created, in reverse order 031 → 028. 031's rollback restores the original notes from the audit log. Phase 4 tests that these blocks run cleanly on a fresh DB.

---

## 16. Decisions pending owner approval (defaults used in this plan)

| Q | Default in this plan | Where it applies |
|---|---|---|
| Q1 Roles | owner, admin, finance, support, moderator, viewer, with the §4.3 matrix | §4 |
| Q2 2FA | TOTP (authenticator app) plus recovery codes; Telegram login is factor 1; Telegram notice on login | §3 |
| Q3 Test gate | DoD = **CI fully green**, plus zero new local failures against analysis §8 (container-only noise). The intermittent CI tests (analysis §0) must be identified, and fixed in a separate pre-step, if they block green | §11 |
| Q4 Branch | Continue on `claude/cool-feynman-jiixoi` with one draft PR, unless you allow `feat/admin-panel` | — |
| Q5 Block | Block sets the flag and revokes sessions by default. Cancelling queued jobs (with refund) and revoking public links are opt-in checkboxes | §6.4 |
| Q6 Erasure | Not built | §1.2 |
| Q7 Paid-order refunds | Record an external refund or chargeback with an optional clawback; no provider call | §6.6 |
| Q8 Runtime settings | free-LLM switch and caps, global or per-tool generation pause, and two admin-only finance knobs | §6.10 |
| Q9 Broadcasts | Telegram bot broadcast to non-blocked users with a `telegram_id`, plus a direct message to one user; no in-app banner | §6.9 |
| Q10 Pricing | **Changed by owner:** prices are editable through per-tool adjustments, with cost analytics (§17) | §17 |
| Q11 AI cost accuracy | **Approved:** WP-X1 is in scope (`ai_usage` captures failed, abandoned and free-LLM cost) | §17, §18 |
| Q12 Product defects / A1 | Defects reported only; A1 fixed (neutral note going forward, plus the 031 scrub with the original kept in the audit log) | §5.4 |
| Q13 Search | No `pg_trgm`; exact and prefix search with indexes | §6.4.1 |
| Q14 nginx allow-list | Optional; a template is provided | §15 |
| Q15 Retention | Audit kept forever; errors 90 days; heartbeats 1 day; recipients 180 days | §5.5 |
| Q16 `scripts/topup.mts` | Left unchanged, and documented in 03-report as the unaudited legacy path. Recommendation: use the panel instead | — |


---

## 17. Pricing and unit economics module (added 2026-10-01 at the owner's request)

### 17.1 Requirements (owner's words, summarised)

1. Show the **real production cost** of every tool: average AI cost per job and per unit, in USD and so'm.
2. Show the **admin-set price** of every tool next to its cost.
3. Let the admin **analyse** prices against cost and margin, and **change** them up or down.
4. Keep **average costs per content type** calculated continuously (a daily trend). Use them to suggest prices.

### 17.2 Price model

- **The code formula stays the base price.** `priceFor(tool, values)` in `lib/tools.ts:1465-1551` keeps every tier, per-slide and per-character rule. The admin does not rewrite formulas. The admin sets one adjustment per tool:
  - `percent`: an integer from 25 to 1000, default 100;
  - `roundTo`: 100, 500 or 1000, default 500.
- **Effective price.** A new pure function, `applyPriceAdjust(base, adj)` in `lib/tools.ts`, computes it:
  - if `percent === 100`, the result is exactly `base` (bit-for-bit today's behavior);
  - otherwise it is `max(roundTo, Math.round(base * percent / 100 / roundTo) * roundTo)`.
- **Server.** `app/api/generations/route.ts` charges `applyPriceAdjust(priceFor(tool, values), await getToolPricing(tool.id))`. `getToolPricing` lives in `lib/server/pricing.ts` and reads `tool_pricing` with a 15 s in-process cache. The server never relies on module-global client state.
- **Client display.** `GET /api/auth/session` `features` gains `pricing: { [toolId]: { percent, roundTo } }`, listing only non-default tools.
  - `lib/store.ts` stores it and exposes it to `lib/tools.ts` through `setClientPriceAdjustments(map)`.
  - `priceFor(tool, values)` applies the client adjustment only when it runs in the browser (`typeof window !== "undefined"`), and only through that registry.
  - Every displayed price, including option labels built from `ARTICLE_PRICES`, `THESIS_PRICES`, the glossary tiers and so on, must go through the adjusted path.
  - The store refreshes pricing on session refresh, and every 5 min while the tab is visible.
- **No silent charge mismatch.** The client sends `expectedPrice` in the `POST /api/generations` body.
  - If present and different from the server price, the route returns **409** `{error:"Narx o'zgardi…", code:"price_changed", price}` **before** any charge.
  - The client (`components/forms/runGeneration.ts` → `lib/api-client.ts`) then shows the new price and asks the user to confirm.
  - When `expectedPrice` is absent (an old cached client), behavior is unchanged.
- **Default.** With no `tool_pricing` rows, every price is identical to today's. This is verified by a test that compares `priceFor` output for every tool and tier, with and without an empty adjustment map.

### 17.3 Cost data

- **Successful jobs:** `generations.cost_json` (existing).
- **Everything else (WP-X1, now in scope):** a new append-only `ai_usage` table records the cost of:
  - failed and abandoned jobs (the meter is flushed in `finally`);
  - free-LLM endpoints (`withFreeLlm` in `lib/server/spend.ts`);
  - fal images.

  It has no FK cascade to `generations`, so deletes do not erase spend.
- **FX:** setting `finance.soum_per_usd` (§6.10).
- **Units per tool** (for cost per unit):

  | Tools | Unit |
  |---|---|
  | slide, pro-slide | slide (`values.slideCount`) |
  | coursework, referat, mustaqil-ish, essay, article, thesis | page |
  | translation | 1 000 characters |
  | image | image |
  | glossary | term |
  | everything else | job |

  The mapping lives in `lib/server/admin-pricing.ts` and is typed against `ToolId`.

### 17.4 Analytics (per tool, over a date range; default 30 days)

| Metric | Definition |
|---|---|
| jobs, completed, failed, failure rate, refund rate | from `generations` |
| average listed price | `avg(generations.price)` |
| average cash revenue per job | Σ(−charge − refund) of `balance_delta + quota_delta` ÷ jobs. Points are excluded as non-cash, as in `lib/server/spend.ts:231-235` |
| average AI cost per completed job | `cost_json->>'usd'`, in USD and so'm |
| failure overhead per completed job | Σ `ai_usage` cost of failed/abandoned jobs ÷ completed |
| full cost per job | average AI cost + failure overhead |
| average cost per unit | full cost per job ÷ average units per job |
| margin % | (cash revenue − full cost in so'm) ÷ cash revenue |
| markup × | average listed price ÷ full cost in so'm |
| coverage % | jobs with cost data ÷ completed |
| **daily trend** | average full cost per job per tool per Tashkent day, for 90 days. This is the "continuously calculated average"; it is computed on demand with a 60 s cache, and a nightly rollup is added only if volume requires it |
| **recommended adjustment** | the `percent` that brings the markup to the target. The target is setting `pricing.target_markup`, default 3.0. Shown with the sample size, and labelled "low confidence" when completed jobs < 20 |
| **simulator** | for a proposed `percent`: the new price for each tier of the tool (a tier ladder from representative inputs in `lib/server/admin-pricing.ts`), and projected 30-day revenue and margin at the same volume |

### 17.5 API (all under `adminHandler`)

| Method | Path | Permission | Params / body | Response |
|---|---|---|---|---|
| GET | `/api/admin/pricing` | pricing.view | `from,to` | `{items:[{toolId,title,unit,adjust:{percent,roundTo},ladder:[{label,base,effective}],jobs,completed,failRate,avgPrice,avgCashRevenue,avgCostUsd,avgCostSoum,overheadSoum,costPerUnitSoum,marginPct,markup,coveragePct,recommendedPercent,confidence}], fx, targetMarkup}` |
| GET | `/api/admin/pricing/:toolId` | pricing.view | `days≤90` | `{tool, trend:[{day,avgCostSoum,jobs}], history:[{at,admin,oldPercent,newPercent,oldRoundTo,newRoundTo,reason}], ladder}` |
| POST | `/api/admin/pricing/:toolId/simulate` | pricing.view | `{percent, roundTo}` | `{ladder, projected:{revenue30d, cost30d, marginPct}}` |
| PUT | `/api/admin/pricing/:toolId` | pricing.edit (S) | `{percent:25..1000, roundTo∈{100,500,1000}, reason}` | `{item}`. Upserts `tool_pricing`, inserts `tool_price_history`, and writes the audit row `pricing.update` with before/after, all in one transaction. The change takes effect within 15 s server-side. |
| DELETE | `/api/admin/pricing/:toolId` | pricing.edit (S) | `{reason}` | Resets the tool to 100 % (row deleted, history and audit written) |

### 17.6 Screen S20 `/admin/pricing` ("Narxlar")

- **Table:** one row per tool, with these columns:
  - tool and unit;
  - base price ladder (e.g. "3 000 – 6 000");
  - current adjustment (`percent`, highlighted when ≠ 100);
  - effective price ladder;
  - average full cost (so'm) per job and per unit;
  - markup ×;
  - margin %;
  - jobs (30 d);
  - a 30-day cost-trend sparkline;
  - the recommendation chip (e.g. "+20 % tavsiya").
- **Colouring:** margin < 30 % is red, 30–60 % amber, otherwise green.
- **Filters:** date range, tool group. **Sort:** margin, cost, volume.
- **Row → drawer** with:
  - a 90-day cost trend chart;
  - the tier ladder (base → effective);
  - the **simulator** (percent slider plus an input, live projected price and margin);
  - the change history;
  - an "O'zgartirish" button (pricing.edit, step-up) that requires a reason and typed confirmation when the change exceeds ±50 %;
  - "100 % ga qaytarish".
- **Banner:** the coverage caveat when coverage < 90 %.

### 17.7 Data model (`032_pricing.sql`, `033_ai_usage.sql`)

```sql
CREATE TABLE IF NOT EXISTS tool_pricing (
  tool_id     TEXT PRIMARY KEY,
  percent     INT  NOT NULL CHECK (percent BETWEEN 25 AND 1000),
  round_to    INT  NOT NULL DEFAULT 500 CHECK (round_to IN (100, 500, 1000)),
  updated_by  BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tool_price_history (
  id            BIGSERIAL PRIMARY KEY,
  tool_id       TEXT NOT NULL,
  old_percent   INT  NOT NULL, new_percent  INT NOT NULL,
  old_round_to  INT  NOT NULL, new_round_to INT NOT NULL,
  reason        TEXT NOT NULL,
  admin_id      BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_price_history_tool_idx ON tool_price_history(tool_id, at DESC);

CREATE TABLE IF NOT EXISTS ai_usage (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  source         TEXT NOT NULL CHECK (source IN ('job','free')),
  outcome        TEXT NOT NULL CHECK (outcome IN ('completed','failed','abandoned','free')),
  generation_id  UUID,            -- no FK: spend survives deletes
  user_id        BIGINT,
  tool_id        TEXT,            -- tool id, or 'free:outline' | 'free:udk' | 'free:rewrite' | 'free:polish'
  calls          INT NOT NULL DEFAULT 0,
  input_tokens   BIGINT NOT NULL DEFAULT 0,
  output_tokens  BIGINT NOT NULL DEFAULT 0,
  usd            NUMERIC(12,6) NOT NULL DEFAULT 0,
  parts          JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS ai_usage_at_idx ON ai_usage(at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_tool_at_idx ON ai_usage(tool_id, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_job_once_idx ON ai_usage(generation_id, outcome) WHERE generation_id IS NOT NULL;
```

Setting added to the catalog: `pricing.target_markup` (number, 1.0–20.0, default 3.0; admin only).

### 17.8 Threat and risk notes

- **Price manipulation by an insider:** `pricing.edit` is owner/admin only, with step-up, reason, audit and history. The 25–1000 % bounds stop accidental zero or extreme prices.
- **Client/server drift:** prevented by the `expectedPrice` 409 guard. It is tested end to end.
- **Cache staleness:** up to 15 s server-side. A price change is not retroactive; already-queued jobs keep their charged price.

---

## 18. Execution model (owner instruction 2026-10-01)

- **Roles.** The lead orchestrates and reviews; agents write the code. The lead still owns every architecture decision and reviews **every** diff before merging. Security-, money- and product-hook packages go to **opus** agents with tight specs. Well-specified UI and read packages go to **sonnet**. Mechanical chores go to **haiku**.
- **Branches.**
  - Each package runs in its own git worktree (`isolation: worktree`) and commits on its own branch.
  - The lead merges each one into `claude/cool-feynman-jiixoi` after review.
  - The branch for this session is `claude/cool-feynman-jiixoi`, and push is allowed only there (Q4 default).
- **Concurrency.** The machine has 4 CPUs, so at most 5 packages run at once. Agents run only their own tests plus the guard tests. The lead runs the full suites at merge points.
- **Shared resources.**
  - One local Postgres 16 at `127.0.0.1:5432`.
  - Each agent uses its own database: `CREATE DATABASE slaydx_<pkg>` and `DATABASE_URL=postgres://slaydx:slaydx@127.0.0.1:5432/slaydx_<pkg>`.
  - Worktrees symlink `node_modules` from the main checkout.

| Wave | Package | Model | Depends on | Owns (summary; full list in §13.2 plus the changes below) |
|---|---|---|---|---|
| 0 | F1 Migrations + settings service | opus | — | migrations 028–033, `lib/server/settings.ts` (catalog incl. `pricing.target_markup`), `tests/admin-migrations.test.mts`, `tests/settings.test.mts` |
| 1 | F2 Security core | opus | F1 | §13.2 F2 |
| 1 | F4 Server helpers | sonnet | — | §13.2 F4 |
| 1 | F3 UI foundation | sonnet | contract only | §13.2 F3 **except** `lib/api-client.ts` (removing the legacy admin functions moves to Integration) |
| 1 | F5a Product hooks: pause + pricing | opus | F1 | `lib/tools.ts`, `lib/server/pricing.ts` (new), `app/api/generations/route.ts`, `app/api/auth/session/route.ts`, `lib/store.ts`, `lib/api-client.ts` (only `createGeneration` gains `expectedPrice`), `components/forms/runGeneration.ts`, composer files whose displayed prices bypass `priceFor`, tests |
| 1 | F5b Ops hooks + WP-X1 | opus | F1 | `lib/server/log.ts`, `instrumentation.ts`, `lib/server/worker.ts`, `lib/server/spend.ts` (free-LLM settings + `ai_usage`), `lib/generation/job-cost.ts`, `lib/generation/llm/breaker.ts`, `limiter.ts`, `lib/generation/image-provider-fal.ts`, `lib/server/error-sink.ts`, `heartbeat.ts`, `housekeeping-status.ts`, `broadcast-delivery.ts`, `ai-usage.ts` (new), tests |
| 2 | F6 Money actions | opus | F2, F4 | §13.2 F6 |
| 2 | WP1–WP10 | sonnet | F2, F3, F4 | §13.2 |
| 2 | WP11 Pricing admin | opus | F2, F3, F4, F5a | `lib/server/admin-pricing.ts`, `app/api/admin/pricing/**`, `app/(admin)/…/pricing` page, `components/admin/pricing/*`, `lib/admin-api/pricing.ts`, tests |
| 3 | Integration | lead | all | removes the legacy admin code in `lib/api-client.ts` and `lib/server/admin.ts`, adds the `admin:seed-dev` script, runs full checks |
| 4 | Verification | security / regression / UX reviewers | Integration | Phase 4 of the brief |
