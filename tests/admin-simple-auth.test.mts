import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Simple admin entry — the 2FA switch OFF (docs/admin/HANDOFF.md "Admin 2FA
 * switch", owner decision 2026-10-02), through the REAL route handlers on a
 * throwaway Postgres and WITHOUT `ADMIN_TOTP_KEY`:
 *   • `POST /api/admin/auth/auto` opens a session for a designated admin — the
 *     same `admin_sessions` row, cookie and user-session binding as a TOTP
 *     login, one `auth.login` row with `meta.mode = "simple"`, no Telegram notice;
 *   • a `pending` account is activated on first entry (audited);
 *   • the cloak (anonymous / non-admin / disabled → 404), the Origin rule
 *     (→ 403) and the per-admin budget (→ 429) still apply; GET never mints;
 *   • with the switch ON the route is a 404 and a code-less session is refused;
 *   • a user logout (or "logout everywhere") kills admin access at once;
 *   • no step-up anywhere: a session without `reauth_at` runs `admins.manage`;
 *   • admins created by the API or the CLI are `active` with no enrollment link;
 *     reset-2fa / re-enable never park an account in `pending`;
 *   • every TOTP flow answers 409 `2fa_off` instead of needing the key.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - `autoLogin` without `if (env.admin2faRequired) throw 404` → "switch on"
 *     (200 instead of 404);
 *   - `adminHandler` step-up gate without `env.admin2faRequired &&` → "no
 *     step-up" (401 reauth on admins/create);
 *   - `resolveAdminContext` without the `enrolled` relaxation → "auto entry"
 *     (401 admin_auth on me/sessions right after a 200 auto);
 *   - `createAdmin` status hard-coded to 'pending' → "admin creation" (status
 *     and `enrollUrl` assertions).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
// Simple mode must not need the key: whatever `.env.local` carries is dropped here.
delete process.env.ADMIN_TOTP_KEY;
process.env.ADMIN_2FA_REQUIRED = "false";
// The bot would "send" through the fetch stub below; simple mode must never call it.
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-simple-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminsimple") : { isolated: false, drop: async () => {} };

const telegramSends: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.telegram.org/")) {
    telegramSends.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { query, queryOne, ensureMigrated, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE, revokeAllSessions, getUserById } = await import("../lib/server/session.ts");
const { adminCookieName } = await import("../lib/server/admin-session.ts");
const { cliUpsertAdmin } = await import("../lib/server/admin-accounts.ts");

const routes = {
  auto: await import("../app/api/admin/auth/auto/route.ts"),
  session: await import("../app/api/admin/session/route.ts"),
  login: await import("../app/api/admin/auth/login/route.ts"),
  recovery: await import("../app/api/admin/auth/recovery/route.ts"),
  reauth: await import("../app/api/admin/auth/reauth/route.ts"),
  enroll: await import("../app/api/admin/auth/enroll/route.ts"),
  recoveryCodes: await import("../app/api/admin/me/recovery-codes/route.ts"),
  meSessions: await import("../app/api/admin/me/sessions/route.ts"),
  admins: await import("../app/api/admin/admins/route.ts"),
  adminById: await import("../app/api/admin/admins/[id]/route.ts"),
  reset2fa: await import("../app/api/admin/admins/[id]/reset-2fa/route.ts"),
};

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── helpers

const ADMIN_COOKIE = adminCookieName();
const REASON = "oddiy rejim testi uchun sabab";
type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; telegramId: string; userToken: string };
type TestAdmin = TestUser & { adminId: string; role: Role };
type RouteFn = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Result = { status: number; body: Record<string, unknown>; setCookies: string[] };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const freshIp = () => `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;

async function mkUser(): Promise<TestUser> {
  const telegramId = String(randomInt(5_000_000_000, 9_000_000_000));
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, 'Simple Test') RETURNING id::text AS id`,
    [telegramId, `smp_${randomBytes(5).toString("hex")}`],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, telegramId, userToken: token };
}

/** An admin account with NO TOTP secret: in simple mode nobody has one. */
async function mkAdmin(role: Role, status: "active" | "pending" | "disabled" = "active"): Promise<TestAdmin> {
  const u = await mkUser();
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [u.id, role, status],
  );
  return { ...u, adminId: row!.id, role };
}

async function userSessionId(userToken: string): Promise<string> {
  const row = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(userToken)]);
  return row!.id;
}

function cookie(userToken: string | null, adminToken?: string | null): string {
  const parts: string[] = [];
  if (userToken) parts.push(`${SESSION_COOKIE}=${userToken}`);
  if (adminToken) parts.push(`${ADMIN_COOKIE}=${adminToken}`);
  return parts.join("; ");
}

async function call(
  mod: object,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { cookie?: string; body?: unknown; origin?: boolean | string; ip?: string; params?: Record<string, string> } = {},
): Promise<Result> {
  const headers: Record<string, string> = {
    host: "localhost:3000",
    "x-forwarded-for": opts.ip ?? freshIp(),
    "user-agent": "admin-simple-test",
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  const origin = opts.origin ?? true;
  if (origin === true) headers.origin = "http://localhost:3000";
  else if (typeof origin === "string") headers.origin = origin;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const fn = (mod as Record<string, RouteFn>)[method];
  assert.ok(fn, `${path} has no ${method}`);
  const res = await inRequest(req, () => fn(req, { params: Promise.resolve(opts.params ?? {}) }));
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, setCookies: res.headers.getSetCookie() };
}

function adminTokenFrom(setCookies: string[]): string | null {
  const c = setCookies.find((s) => s.startsWith(`${ADMIN_COOKIE}=`));
  if (!c) return null;
  const v = c.slice(ADMIN_COOKIE.length + 1).split(";")[0]!;
  return v || null;
}

const auto = (u: TestUser, opts: Parameters<typeof call>[3] = {}) =>
  call(routes.auto, "POST", "/api/admin/auth/auto", { cookie: cookie(u.userToken), body: {}, ...opts });

/** Enters once and returns the admin cookie token (asserting the 200). */
async function enter(u: TestUser): Promise<string> {
  const r = await auto(u);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const token = adminTokenFrom(r.setCookies);
  assert.ok(token, "admin cookie set");
  return token;
}

async function auditRows(adminId: string | null, action: string) {
  return query<{ outcome: string; meta: Record<string, unknown> | null; before: unknown; after: unknown; admin_id: string | null }>(
    `SELECT outcome, meta, before, after, admin_id::text AS admin_id FROM admin_audit_log
      WHERE action = $1 AND ${adminId === null ? "admin_id IS NULL" : "admin_id = $2"} ORDER BY id`,
    adminId === null ? [action] : [action, adminId],
  );
}

const liveSessions = async (adminId: string) =>
  (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_sessions WHERE admin_id = $1 AND revoked_at IS NULL`, [adminId]))!.n;

const flush = () => new Promise((r) => setTimeout(r, 50));

// ───────────────────────────── entry

test("auto entry: an active admin gets a bound session + cookie, one auth.login {mode: simple} row, no notice, no key", { skip }, async () => {
  assert.equal(process.env.ADMIN_TOTP_KEY, undefined, "this file runs without ADMIN_TOTP_KEY");
  const a = await mkAdmin("finance");
  const sends = telegramSends.length;

  const r = await auto(a);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const token = adminTokenFrom(r.setCookies);
  assert.ok(token && /^[A-Za-z0-9_-]{43}$/.test(token), "a fresh 43-char admin token");
  const set = r.setCookies.find((s) => s.startsWith(`${ADMIN_COOKIE}=`))!;
  assert.match(set, /HttpOnly/i);
  assert.match(set, /SameSite=Strict/i);
  const session = r.body.session as { id: string; reauthUntil: string | null };
  assert.equal(session.reauthUntil, null, "no second factor was presented");
  assert.equal((r.body.admin as { status: string }).status, "active");

  // Same row shape as a TOTP login: hash only, bound to THIS user session, 30 min / 12 h.
  const row = await queryOne<{ user_session_id: string; token_hash: string; reauth_at: Date | null; idle_min: number; abs_h: number }>(
    `SELECT user_session_id::text AS user_session_id, token_hash, reauth_at,
            round(extract(epoch FROM (idle_expires_at - created_at)) / 60)::int AS idle_min,
            round(extract(epoch FROM (expires_at - created_at)) / 3600)::int AS abs_h
       FROM admin_sessions WHERE id = $1`,
    [session.id],
  );
  assert.equal(row!.user_session_id, await userSessionId(a.userToken));
  assert.equal(row!.token_hash, sha256(token!));
  assert.equal(row!.reauth_at, null);
  assert.equal(row!.idle_min, 30);
  assert.equal(row!.abs_h, 12);
  assert.ok((await queryOne<{ t: Date | null }>(`SELECT last_login_at AS t FROM admin_accounts WHERE id = $1`, [a.adminId]))!.t, "last_login_at set");

  const rows = await auditRows(a.adminId, "auth.login");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.outcome, "ok");
  assert.deepEqual(rows[0]!.meta, { mode: "simple", sessionId: session.id, activated: false });
  assert.equal(rows[0]!.before, null);
  await flush();
  assert.equal(telegramSends.length, sends, "no Telegram login notice in simple mode");

  // The session opens adminHandler routes (no TOTP ever enrolled).
  const me = await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: cookie(a.userToken, token) });
  assert.equal(me.status, 200, JSON.stringify(me.body));
  const items = me.body.items as Array<{ id: string; current: boolean }>;
  assert.ok(items.some((s) => s.id === session.id && s.current));
  const info = await call(routes.session, "GET", "/api/admin/session", { cookie: cookie(a.userToken, token) });
  assert.equal((info.body.session as { id: string }).id, session.id);
});

test("GET /api/admin/session never mints: without an admin cookie `session` is null and no cookie is set", { skip }, async () => {
  const a = await mkAdmin("viewer");
  const r = await call(routes.session, "GET", "/api/admin/session", { cookie: cookie(a.userToken) });
  assert.equal(r.status, 200);
  assert.equal(r.body.session, null);
  assert.equal(adminTokenFrom(r.setCookies), null);
  assert.equal(await liveSessions(a.adminId), 0);
});

test("cloak and Origin: anonymous, non-admin and disabled get 404 on auto (no session); missing or foreign Origin → 403", { skip }, async () => {
  const plain = await mkUser();
  const disabled = await mkAdmin("owner", "disabled");
  for (const [who, c] of [
    ["anonymous", null],
    ["non-admin", cookie(plain.userToken)],
    ["disabled admin", cookie(disabled.userToken)],
  ] as const) {
    const r = await call(routes.auto, "POST", "/api/admin/auth/auto", { cookie: c ?? undefined, body: {} });
    assert.equal(r.status, 404, `${who}: ${JSON.stringify(r.body)}`);
    assert.notEqual(r.body.code, "not_found", `${who}: the cloak, not a coded 404`);
    assert.equal(adminTokenFrom(r.setCookies), null, `${who}: no cookie`);
  }
  assert.equal(await liveSessions(disabled.adminId), 0);
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_sessions s JOIN admin_accounts a ON a.id = s.admin_id WHERE a.user_id = $1`, [plain.id]))!.n, 0);

  const a = await mkAdmin("support");
  assert.equal((await auto(a, { origin: false })).status, 403, "no Origin");
  assert.equal((await auto(a, { origin: "https://evil.example" })).status, 403, "foreign Origin");
  assert.equal(await liveSessions(a.adminId), 0);
});

test("switch on: auto is a 404 and mints nothing; a session minted in simple mode is refused once the switch is on", { skip }, async () => {
  const a = await mkAdmin("admin");
  const token = await enter(a);
  process.env.ADMIN_2FA_REQUIRED = "true";
  try {
    const r = await auto(a);
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(adminTokenFrom(r.setCookies), null);
    assert.equal(await liveSessions(a.adminId), 1, "no second session");
    // No TOTP was ever enrolled: with the switch on this account cannot hold a session.
    const me = await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: cookie(a.userToken, token) });
    assert.equal(me.status, 401);
    assert.equal(me.body.code, "admin_auth");
  } finally {
    process.env.ADMIN_2FA_REQUIRED = "false";
  }
  // Back in simple mode the same session works again.
  assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: cookie(a.userToken, token) })).status, 200);
});

test("pending account: isAdmin already true; first entry activates it (audited before/after) and later entries are plain logins", { skip }, async () => {
  const a = await mkAdmin("moderator", "pending");
  assert.equal((await getUserById(a.id))!.isAdmin, true, "the sidebar button shows for a pending admin");
  const r = await auto(a);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((r.body.admin as { status: string }).status, "active");
  assert.equal((await queryOne<{ status: string }>(`SELECT status FROM admin_accounts WHERE id = $1`, [a.adminId]))!.status, "active");
  const rows = await auditRows(a.adminId, "auth.login");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.before, { status: "pending" });
  assert.deepEqual(rows[0]!.after, { status: "active" });
  assert.equal(rows[0]!.meta?.activated, true);
  assert.equal(rows[0]!.meta?.mode, "simple");
  // Second entry: no status change recorded.
  await enter(a);
  const again = await auditRows(a.adminId, "auth.login");
  assert.equal(again.length, 2);
  assert.equal(again[1]!.before, null);
  assert.equal(again[1]!.meta?.activated, false);
});

test("user logout kills admin access: after `revokeAllSessions` every admin route and auto itself are 404", { skip }, async () => {
  const a = await mkAdmin("owner");
  const token = await enter(a);
  assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: cookie(a.userToken, token) })).status, 200);
  await revokeAllSessions(a.id);
  const me = await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: cookie(a.userToken, token) });
  assert.equal(me.status, 404, "no live user session → the cloak");
  assert.equal((await auto(a)).status, 404, "cannot re-enter without a user session");
  // A new user login enters again, but the old admin cookie stays dead (bound to the old user session).
  const { token: userToken2 } = await createSession(a.id);
  const stale = await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: cookie(userToken2, token) });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.code, "admin_auth");
  assert.equal((await auto({ ...a, userToken: userToken2 })).status, 200);
});

test("logout: DELETE /api/admin/session revokes and clears; the next auto enters again with a new session", { skip }, async () => {
  const a = await mkAdmin("finance");
  const first = await auto(a);
  const token = adminTokenFrom(first.setCookies)!;
  const out = await call(routes.session, "DELETE", "/api/admin/session", { cookie: cookie(a.userToken, token) });
  assert.equal(out.status, 200);
  assert.match(out.setCookies.find((s) => s.startsWith(`${ADMIN_COOKIE}=`)) ?? "", /Max-Age=0/i);
  assert.equal(await liveSessions(a.adminId), 0);
  assert.equal((await auditRows(a.adminId, "auth.logout")).length, 1);
  const dead = await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: cookie(a.userToken, token) });
  assert.equal(dead.status, 401);
  const second = await auto(a);
  assert.equal(second.status, 200);
  assert.notEqual((second.body.session as { id: string }).id, (first.body.session as { id: string }).id);
});

test("auto is budgeted per admin (30 / 60 s, fail-closed bucket): the 31st entry is 429", { skip }, async () => {
  const a = await mkAdmin("viewer");
  for (let i = 0; i < 30; i++) assert.equal((await auto(a)).status, 200, `entry ${i + 1}`);
  const r = await auto(a);
  assert.equal(r.status, 429);
  assert.ok(typeof r.body.retryAfterSec === "number");
  assert.equal(await liveSessions(a.adminId), 30);
});

// ───────────────────────────── no step-up, admin management

test("no step-up: a session without reauth_at runs admins.manage; API-created admins are active with no link and enter at once", { skip }, async () => {
  const owner = await mkAdmin("owner");
  const token = await enter(owner);
  const target = await mkUser();
  const c = cookie(owner.userToken, token);

  const r = await call(routes.admins, "POST", "/api/admin/admins", { cookie: c, body: { userId: target.id, role: "support", reason: REASON } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.notEqual(r.body.code, "reauth");
  const created = r.body.admin as { id: string; status: string; totpEnabled: boolean; activeSessions: number };
  assert.equal(created.status, "active");
  assert.equal(created.totpEnabled, false);
  assert.equal(r.body.enrollUrl, null);
  assert.equal(r.body.expiresAt, null);
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_enrollments WHERE admin_id = $1`, [created.id]))!.n, 0, "no enrollment row");
  const rows = await auditRows(owner.adminId, "admins.create");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.after, { userId: target.id, role: "support", status: "active" });
  assert.equal(rows[0]!.meta?.mode, "simple");
  assert.ok(!JSON.stringify(rows[0]).includes("enroll"), "nothing enrollment-related is audited");

  // The new admin opens the panel from the site at once.
  const entered = await auto({ ...target, telegramId: target.telegramId });
  assert.equal(entered.status, 200, JSON.stringify(entered.body));
  assert.equal((entered.body.admin as { role: string }).role, "support");

  // sendViaTelegram: a plain "use the button" DM, no link.
  const sends = telegramSends.length;
  const t2 = await mkUser();
  assert.equal((await call(routes.admins, "POST", "/api/admin/admins", { cookie: c, body: { userId: t2.id, role: "viewer", reason: REASON, sendViaTelegram: true } })).status, 201);
  await flush();
  assert.equal(telegramSends.length, sends + 1);
  assert.match(telegramSends[sends]!, /Admin panel/);
  assert.doesNotMatch(telegramSends[sends]!, /enroll/);

  // Rank and self rules are untouched by the mode.
  const self = await call(routes.adminById, "PATCH", `/api/admin/admins/${owner.adminId}`, { cookie: c, body: { role: "admin", reason: REASON }, params: { id: owner.adminId } });
  assert.equal(self.status, 409);
  assert.equal(self.body.code, "self");
  const adm = await mkAdmin("admin");
  const admToken = await enter(adm);
  const rank = await call(routes.admins, "POST", "/api/admin/admins", { cookie: cookie(adm.userToken, admToken), body: { userId: (await mkUser()).id, role: "owner", reason: REASON } });
  assert.equal(rank.status, 403);
  assert.equal(rank.body.code, "rank");
});

test("reset-2fa and re-enable in simple mode never park an account in pending; reset revokes sessions and issues no link", { skip }, async () => {
  const owner = await mkAdmin("owner");
  const c = cookie(owner.userToken, await enter(owner));
  const sup = await mkAdmin("support");
  await enter(sup);
  assert.equal(await liveSessions(sup.adminId), 1);

  const reset = await call(routes.reset2fa, "POST", `/api/admin/admins/${sup.adminId}/reset-2fa`, { cookie: c, body: { reason: REASON }, params: { id: sup.adminId } });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.deepEqual(reset.body, { enrollUrl: null, expiresAt: null });
  assert.equal(await liveSessions(sup.adminId), 0, "sessions revoked");
  assert.equal((await queryOne<{ status: string }>(`SELECT status FROM admin_accounts WHERE id = $1`, [sup.adminId]))!.status, "active");
  assert.equal((await auto(sup)).status, 200, "enters again right away");

  const off = await call(routes.adminById, "PATCH", `/api/admin/admins/${sup.adminId}`, { cookie: c, body: { status: "disabled", reason: REASON }, params: { id: sup.adminId } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal((await auto(sup)).status, 404, "disabled → the cloak");
  const on = await call(routes.adminById, "PATCH", `/api/admin/admins/${sup.adminId}`, { cookie: c, body: { status: "active", reason: REASON }, params: { id: sup.adminId } });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal((on.body.admin as { status: string }).status, "active", "not pending: nothing to enrol");
  assert.equal((await auto(sup)).status, 200);
});

test("CLI in simple mode: creates an active account with no link; a re-run keeps it active and revokes sessions", { skip }, async () => {
  const u = await mkUser();
  const res = await cliUpsertAdmin({ telegramId: u.telegramId, role: "owner", host: "test-host" });
  assert.equal(res.created, true);
  assert.equal(res.enrollUrl, null);
  assert.equal(res.expiresAt, null);
  assert.equal((await queryOne<{ status: string }>(`SELECT status FROM admin_accounts WHERE id = $1`, [res.adminId]))!.status, "active");
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_enrollments WHERE admin_id = $1`, [res.adminId]))!.n, 0);
  const rows = await auditRows(null, "admins.create");
  const mine = rows.find((r) => (r.after as { userId?: string })?.userId === u.id);
  assert.ok(mine);
  assert.deepEqual(mine.after, { userId: u.id, role: "owner", status: "active", totpEnabled: false });
  assert.equal(mine.meta?.via, "cli");
  assert.equal(mine.meta?.mode, "simple");
  assert.equal((await auto(u)).status, 200, "enters without enrollment");

  const again = await cliUpsertAdmin({ userId: u.id, role: "admin", host: "test-host" });
  assert.equal(again.created, false);
  assert.equal(again.revokedSessions, 1);
  assert.equal(again.enrollUrl, null);
  assert.equal((await queryOne<{ status: string; role: string }>(`SELECT status, role FROM admin_accounts WHERE id = $1`, [res.adminId]))!.status, "active");
  assert.equal((await auto(u)).status, 200);
});

test("TOTP flows answer 409 2fa_off in simple mode (no key needed): login, recovery, reauth, recovery codes, enrollment", { skip }, async () => {
  const a = await mkAdmin("owner");
  const token = await enter(a);
  const userOnly = cookie(a.userToken);
  const both = cookie(a.userToken, token);
  for (const [name, r] of [
    ["login", await call(routes.login, "POST", "/api/admin/auth/login", { cookie: userOnly, body: { code: "123456" } })],
    ["recovery", await call(routes.recovery, "POST", "/api/admin/auth/recovery", { cookie: userOnly, body: { code: "ABCD-EFGH-12" } })],
    ["reauth", await call(routes.reauth, "POST", "/api/admin/auth/reauth", { cookie: both, body: { code: "123456" } })],
    ["recovery-codes", await call(routes.recoveryCodes, "POST", "/api/admin/me/recovery-codes", { cookie: both, body: { code: "123456" } })],
    ["enroll GET", await call(routes.enroll, "GET", `/api/admin/auth/enroll?token=${"a".repeat(43)}`, { cookie: userOnly })],
    ["enroll POST", await call(routes.enroll, "POST", "/api/admin/auth/enroll", { cookie: userOnly, body: { token: "a".repeat(43), code: "123456" } })],
  ] as const) {
    assert.equal(r.status, 409, `${name}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, "2fa_off", name);
  }
  assert.equal(await liveSessions(a.adminId), 1, "none of them opened a session");
  // The cloak still comes first.
  assert.equal((await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie((await mkUser()).userToken), body: { code: "123456" } })).status, 404);
});
