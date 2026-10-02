import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin authentication end to end, through the REAL route handlers and a
 * real Postgres (docs/admin/02-plan.md §3, §4.4, §6.1, §6.2, §10 T1–T3, T10,
 * T16, T20): enrollment, login, recovery, step-up, lockout (fail-closed),
 * TOTP replay, session binding to the user session, idle/absolute expiry,
 * the 404 cloak, 401/403 codes with the denied audit row, Origin rules.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// The bot "sends" through the fetch stub below; nothing leaves the process.
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-auth-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminauth") : { isolated: false, drop: async () => {} };

type Sent = { chat_id: unknown; text: string; parse_mode?: string };
const sent: Sent[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.telegram.org/")) {
    sent.push(JSON.parse(String(init?.body ?? "{}")) as Sent);
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { seal, generateRecoveryCode, hmacCode, RECOVERY_CODE_RE } = await import("../lib/server/admin-crypto.ts");
const { generateTotpSecret, totpCode, totpStep } = await import("../lib/server/admin-totp.ts");
const { createAdminSession } = await import("../lib/server/admin-session.ts");
const { cliUpsertAdmin, IP_LIMIT } = await import("../lib/server/admin-accounts.ts");

const routes = {
  session: await import("../app/api/admin/session/route.ts"),
  login: await import("../app/api/admin/auth/login/route.ts"),
  recovery: await import("../app/api/admin/auth/recovery/route.ts"),
  reauth: await import("../app/api/admin/auth/reauth/route.ts"),
  enroll: await import("../app/api/admin/auth/enroll/route.ts"),
  meSessions: await import("../app/api/admin/me/sessions/route.ts"),
  meRevoke: await import("../app/api/admin/me/sessions/[id]/revoke/route.ts"),
  recoveryCodes: await import("../app/api/admin/me/recovery-codes/route.ts"),
  admins: await import("../app/api/admin/admins/route.ts"),
};

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── helpers

const ADMIN_COOKIE = "slaydx_admin";
type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; telegramId: string; userToken: string };
type TestAdmin = TestUser & { adminId: string; secret: string; role: Role };
type RouteFn = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Result = { status: number; body: Record<string, unknown>; setCookies: string[] };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const freshIp = () => `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;

async function mkUser(): Promise<TestUser> {
  const telegramId = String(randomInt(5_000_000_000, 9_000_000_000));
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, 'Admin Test') RETURNING id::text AS id`,
    [telegramId, `adm_${randomBytes(5).toString("hex")}`],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, telegramId, userToken: token };
}

async function mkAdmin(role: Role, opts: { status?: "active" | "pending" | "disabled"; enrolled?: boolean } = {}): Promise<TestAdmin> {
  const u = await mkUser();
  const status = opts.status ?? "active";
  const enrolled = opts.enrolled ?? status !== "pending";
  const secret = generateTotpSecret();
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [u.id, role, status],
  );
  const adminId = row!.id;
  if (enrolled) {
    await query(`UPDATE admin_accounts SET totp_secret_enc = $2, totp_enabled_at = now() WHERE id = $1`, [
      adminId,
      seal(secret, `admin:${adminId}`),
    ]);
  }
  return { ...u, adminId, secret, role };
}

async function userSessionId(userToken: string): Promise<string> {
  const row = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(userToken)]);
  return row!.id;
}

/** A real admin session row (same code path as login), for guard tests. */
async function openSession(a: TestAdmin, opts: { reauth?: boolean; userToken?: string } = {}): Promise<{ token: string; id: string }> {
  const usid = await userSessionId(opts.userToken ?? a.userToken);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: a.adminId, userSessionId: usid, ip: "10.0.0.1", userAgent: "admin-test", reauth: opts.reauth ?? false }),
  );
  return { token: s.token, id: s.id };
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
    "user-agent": "admin-auth-test",
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

const nowCode = (secret: string) => totpCode(secret, totpStep(Date.now()));
const wrongCode = (secret: string) => String((Number(nowCode(secret)) + 500_000) % 1_000_000).padStart(6, "0");
const resetStep = (a: TestAdmin) => query(`UPDATE admin_accounts SET totp_last_step = 0 WHERE id = $1`, [a.adminId]);
const flush = () => new Promise((r) => setTimeout(r, 50));

async function auditRows(adminId: string | null, action: string) {
  return query<{ outcome: string; meta: Record<string, unknown> | null; before: unknown; after: unknown; admin_id: string | null; ip: string | null; request_id: string | null }>(
    `SELECT outcome, meta, before, after, admin_id::text AS admin_id, ip, request_id FROM admin_audit_log
      WHERE action = $1 AND ${adminId === null ? "admin_id IS NULL" : "admin_id = $2"} ORDER BY id`,
    adminId === null ? [action] : [action, adminId],
  );
}

// ───────────────────────────── 404 cloak

test("404 cloak: anonymous callers and users without an admin account learn nothing", { skip }, async () => {
  const user = await mkUser();
  const disabled = await mkAdmin("owner", { status: "disabled" });
  for (const c of [undefined, cookie(user.userToken), cookie(disabled.userToken)]) {
    assert.equal((await call(routes.session, "GET", "/api/admin/session", { cookie: c })).status, 404);
    assert.equal((await call(routes.admins, "GET", "/api/admin/admins", { cookie: c })).status, 404);
    assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: c })).status, 404);
    const login = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code: "123456" } });
    assert.equal(login.status, 404);
    assert.equal(login.body.error, "Topilmadi");
    assert.equal((await call(routes.enroll, "GET", "/api/admin/auth/enroll?token=x", { cookie: c })).status, 404);
  }
  // Even an admin's cookie is useless once the account is disabled.
  const s = await openSession(disabled);
  assert.equal((await call(routes.admins, "GET", "/api/admin/admins", { cookie: cookie(disabled.userToken, s.token) })).status, 404);
});

// ───────────────────────────── enrollment

test("enrollment: CLI link → info only for that user → wrong code 401 → right code: active, 10 codes, bound session, audit", { skip }, async () => {
  const u = await mkUser();
  const res = await cliUpsertAdmin({ telegramId: u.telegramId, role: "owner", host: "test-host" });
  assert.equal(res.created, true);
  assert.ok(res.enrollUrl.startsWith("http://localhost:3000/admin/enroll?token="), res.enrollUrl);
  const token = new URL(res.enrollUrl).searchParams.get("token")!;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  // Only the hash is stored.
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_enrollments WHERE token_hash = $1`, [sha256(token)]))!.n, 1);
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_enrollments WHERE token_hash = $1`, [token]))!.n, 0);
  const sys = await auditRows(null, "admins.create");
  assert.ok(sys.some((r) => r.meta?.via === "cli" && r.meta?.host === "test-host"), "CLI audit row (admin_id NULL, meta.via=cli)");

  const q = `/api/admin/auth/enroll?token=${token}`;
  const other = await mkAdmin("viewer", { status: "pending" });
  assert.equal((await call(routes.enroll, "GET", q, { cookie: cookie(other.userToken) })).status, 404, "another admin's user");
  assert.equal((await call(routes.enroll, "GET", q, { cookie: cookie((await mkUser()).userToken) })).status, 404, "non-admin");
  assert.equal((await call(routes.enroll, "GET", `/api/admin/auth/enroll?token=${"A".repeat(43)}`, { cookie: cookie(u.userToken) })).status, 404);

  const info = await call(routes.enroll, "GET", q, { cookie: cookie(u.userToken) });
  assert.equal(info.status, 200);
  assert.deepEqual(info.body.account, { role: "owner" });
  const secret = String(info.body.secret);
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.ok(String(info.body.otpauthUri).startsWith("otpauth://totp/"));
  assert.ok(String(info.body.otpauthUri).includes(`secret=${secret}`));
  assert.match(String(info.body.qrSvg), /^<svg/);
  const again = await call(routes.enroll, "GET", q, { cookie: cookie(u.userToken) });
  assert.equal(again.body.secret, secret, "GET is stable for the same link");

  const noOrigin = await call(routes.enroll, "POST", "/api/admin/auth/enroll", {
    cookie: cookie(u.userToken),
    body: { token, code: nowCode(secret) },
    origin: false,
  });
  assert.equal(noOrigin.status, 403, "mutation without Origin");
  const bad = await call(routes.enroll, "POST", "/api/admin/auth/enroll", { cookie: cookie(u.userToken), body: { token, code: wrongCode(secret) } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, "bad_code");
  assert.equal((await call(routes.enroll, "POST", "/api/admin/auth/enroll", { cookie: cookie(u.userToken), body: { token, code: "12ab56" } })).status, 400);

  const ok = await call(routes.enroll, "POST", "/api/admin/auth/enroll", { cookie: cookie(u.userToken), body: { token, code: nowCode(secret) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const codes = ok.body.recoveryCodes as string[];
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, RECOVERY_CODE_RE);
  const setCookie = ok.setCookies.find((c) => c.startsWith(`${ADMIN_COOKIE}=`))!;
  assert.ok(setCookie, "admin cookie set");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(setCookie, /Domain=/i);
  const adminToken = adminTokenFrom(ok.setCookies)!;

  const acc = await queryOne<{ status: string; totp_secret_enc: string; totp_last_step: string }>(
    `SELECT status, totp_secret_enc, totp_last_step::text AS totp_last_step FROM admin_accounts WHERE id = $1`,
    [res.adminId],
  );
  assert.equal(acc!.status, "active");
  assert.match(acc!.totp_secret_enc, /^v1\./);
  assert.ok(!acc!.totp_secret_enc.includes(secret), "secret is sealed at rest");
  assert.ok(Number(acc!.totp_last_step) > 0, "the enrollment code's step is burned");
  const stored = await query<{ code_hash: string }>(`SELECT code_hash FROM admin_recovery_codes WHERE admin_id = $1`, [res.adminId]);
  assert.equal(stored.length, 10);
  for (const r of stored) {
    assert.match(r.code_hash, /^[0-9a-f]{64}$/);
    assert.ok(!codes.some((c) => r.code_hash.includes(c.replace(/-/g, ""))));
  }
  assert.equal((await auditRows(res.adminId, "auth.enroll")).filter((r) => r.outcome === "ok").length, 1);
  assert.ok((await auditRows(res.adminId, "auth.login_failed")).some((r) => r.outcome === "failed" && r.meta?.flow === "enroll"));

  // The link is single use.
  assert.equal((await call(routes.enroll, "POST", "/api/admin/auth/enroll", { cookie: cookie(u.userToken), body: { token, code: nowCode(secret) } })).status, 404);

  // The new session works and reports the owner's permissions.
  const me = await call(routes.session, "GET", "/api/admin/session", { cookie: cookie(u.userToken, adminToken) });
  assert.equal(me.status, 200);
  const admin = me.body.admin as { status: string; role: string; permissions: string[]; totpEnabled: boolean };
  assert.equal(admin.status, "active");
  assert.equal(admin.totpEnabled, true);
  assert.ok(admin.permissions.includes("admins.manage"));
  assert.ok(me.body.session, "session present");
  assert.equal((await call(routes.admins, "GET", "/api/admin/admins", { cookie: cookie(u.userToken, adminToken) })).status, 200);

  // Bound to THIS user session: the same admin cookie with another session of the same user is refused.
  const { token: otherUserToken } = await createSession(u.id);
  const foreign = await call(routes.admins, "GET", "/api/admin/admins", { cookie: cookie(otherUserToken, adminToken) });
  assert.equal(foreign.status, 401);
  assert.equal(foreign.body.code, "admin_auth");
});

test("enrollment: the link burns after 5 wrong codes; a later right code gets 404", { skip }, async () => {
  const u = await mkUser();
  const res = await cliUpsertAdmin({ userId: u.id, role: "viewer", host: "h" });
  const token = new URL(res.enrollUrl).searchParams.get("token")!;
  const info = await call(routes.enroll, "GET", `/api/admin/auth/enroll?token=${token}`, { cookie: cookie(u.userToken) });
  const secret = String(info.body.secret);
  for (let i = 0; i < 5; i++) {
    const r = await call(routes.enroll, "POST", "/api/admin/auth/enroll", { cookie: cookie(u.userToken), body: { token, code: wrongCode(secret) } });
    assert.equal(r.status, 401, `attempt ${i + 1}`);
  }
  const late = await call(routes.enroll, "POST", "/api/admin/auth/enroll", { cookie: cookie(u.userToken), body: { token, code: nowCode(secret) } });
  assert.equal(late.status, 404);
  const row = await queryOne<{ attempts: number; consumed: boolean }>(
    `SELECT attempts, consumed_at IS NOT NULL AS consumed FROM admin_enrollments WHERE token_hash = $1`,
    [sha256(token)],
  );
  assert.deepEqual(row, { attempts: 5, consumed: true });
  assert.equal((await queryOne<{ status: string }>(`SELECT status FROM admin_accounts WHERE id = $1`, [res.adminId]))!.status, "pending");
});

// ───────────────────────────── login, replay, lockout

test("login: format 400, wrong 401 + failed audit, right 200 + cookie + notice, the same code again is a replay (401)", { skip }, async () => {
  const a = await mkAdmin("admin");
  const c = cookie(a.userToken);
  assert.equal((await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code: "12345" } })).status, 400);
  assert.equal((await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code: 123456 } })).status, 400);
  assert.equal((await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code: nowCode(a.secret) }, origin: false })).status, 403);
  assert.equal(
    (await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code: nowCode(a.secret) }, origin: "https://evil.example" })).status,
    403,
  );

  const bad = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code: wrongCode(a.secret) } });
  assert.equal(bad.status, 401);
  assert.deepEqual([bad.body.error, bad.body.code], ["Kod noto'g'ri", "bad_code"]);
  const failed = await auditRows(a.adminId, "auth.login_failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.outcome, "failed");
  assert.ok(failed[0]!.request_id, "request id captured");
  assert.ok(!JSON.stringify(failed[0]).includes(wrongCode(a.secret)), "codes are never audited");

  const before = sent.length;
  const code = nowCode(a.secret);
  const ok = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code }, ip: "192.0.2.10" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const session = ok.body.session as { id: string; reauthUntil: string | null; expiresAt: string; idleExpiresAt: string };
  assert.ok(session.reauthUntil, "a TOTP login counts as a fresh step-up");
  const absMs = Date.parse(session.expiresAt) - Date.now();
  const idleMs = Date.parse(session.idleExpiresAt) - Date.now();
  assert.ok(absMs > 11.9 * 3600_000 && absMs <= 12 * 3600_000 + 5_000, `absolute ${absMs}`);
  assert.ok(idleMs > 29.9 * 60_000 && idleMs <= 30 * 60_000 + 5_000, `idle ${idleMs}`);
  const token = adminTokenFrom(ok.setCookies)!;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const row = await queryOne<{ user_session_id: string; ip: string }>(
    `SELECT user_session_id::text AS user_session_id, ip FROM admin_sessions WHERE token_hash = $1`,
    [sha256(token)],
  );
  assert.equal(row!.user_session_id, await userSessionId(a.userToken), "bound to the current user session");
  assert.equal(row!.ip, "192.0.2.10");
  assert.equal((await auditRows(a.adminId, "auth.login")).length, 1);
  await flush();
  const notice = sent.slice(before).find((m) => String(m.chat_id) === a.telegramId);
  assert.ok(notice, "Telegram login notice sent to the admin");
  assert.equal(notice!.parse_mode, "HTML");
  assert.match(notice!.text, /Admin panelga yangi kirish/);
  assert.match(notice!.text, /192\.0\.2\.10/);

  const replay = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code } });
  assert.equal(replay.status, 401, "the same TOTP step must not open a second session");
  assert.equal(replay.body.code, "bad_code");

  const pending = await mkAdmin("viewer", { status: "pending" });
  const ne = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(pending.userToken), body: { code: "123456" } });
  assert.equal(ne.status, 409);
  assert.equal(ne.body.code, "not_enrolled");
});

test("login: two parallel requests with the same code — exactly one session", { skip }, async () => {
  const a = await mkAdmin("support");
  const code = nowCode(a.secret);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(a.userToken), body: { code } })),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.status).join(","));
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_sessions WHERE admin_id = $1`, [a.adminId]))!.n, 1);
});

test("lockout: the 5th wrong code → 429 + auth.locked + escaped notice; then even a right code or a recovery code is refused", { skip }, async () => {
  const a = await mkAdmin("finance");
  const c = cookie(a.userToken);
  const before = sent.length;
  for (let i = 1; i <= 4; i++) {
    const r = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code: wrongCode(a.secret) } });
    assert.equal(r.status, 401, `failure ${i}`);
  }
  // The IP is attacker-influenced text in the notice (TRUST_PROXY): it must be escaped.
  const fifth = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code: wrongCode(a.secret) }, ip: "<b>x</b>&" });
  assert.equal(fifth.status, 429);
  assert.equal(fifth.body.code, "locked");
  assert.equal(typeof fifth.body.retryAfterSec, "number");
  assert.equal((await auditRows(a.adminId, "auth.locked")).length, 1);
  assert.equal((await auditRows(a.adminId, "auth.login_failed")).length, 5);
  await flush();
  const notice = sent.slice(before).find((m) => String(m.chat_id) === a.telegramId && /bloklandi/.test(m.text));
  assert.ok(notice, "lockout notice");
  assert.ok(notice!.text.includes("&lt;b&gt;x&lt;/b&gt;&amp;"), notice!.text);
  assert.ok(!notice!.text.includes("<b>x</b>"));

  const right = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: c, body: { code: nowCode(a.secret) } });
  assert.equal(right.status, 429, "locked: the right code is not even checked");
  const code = generateRecoveryCode();
  await query(`INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1, $2)`, [a.adminId, hmacCode(code)]);
  assert.equal((await call(routes.recovery, "POST", "/api/admin/auth/recovery", { cookie: c, body: { code } })).status, 429);
  assert.equal((await auditRows(a.adminId, "auth.locked")).length, 1, "the lock event is written once");
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_sessions WHERE admin_id = $1`, [a.adminId]))!.n, 0);
});

test("fail-closed: when the rate-limit store fails, login is refused (IP bucket and account bucket)", { skip }, async () => {
  const a = await mkAdmin("support");
  const badIp = `203.0.113.${randomInt(1, 255)}`;
  await query(`CREATE OR REPLACE FUNCTION f2_test_rl_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated rate-limit store failure'; END $$`);
  await query(`DROP TRIGGER IF EXISTS f2_test_rl_fail ON rate_limits`);
  await query(
    `CREATE TRIGGER f2_test_rl_fail BEFORE INSERT ON rate_limits FOR EACH ROW
       WHEN (NEW.bucket = 'admin-auth-ip:${badIp}' OR NEW.bucket = 'admin-auth-fail:${a.adminId}')
       EXECUTE FUNCTION f2_test_rl_fail()`,
  );
  try {
    const ipDown = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(a.userToken), body: { code: nowCode(a.secret) }, ip: badIp });
    assert.equal(ipDown.status, 429, "IP bucket unavailable → refused, not waved through");
    const failDown = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(a.userToken), body: { code: wrongCode(a.secret) } });
    assert.equal(failDown.status, 429, "failure counter unavailable → refused, never an unlimited 401 loop");
  } finally {
    await query(`DROP TRIGGER IF EXISTS f2_test_rl_fail ON rate_limits`);
    await query(`DROP FUNCTION IF EXISTS f2_test_rl_fail()`);
  }
  const ok = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(a.userToken), body: { code: nowCode(a.secret) } });
  assert.equal(ok.status, 200, "works again once the store is back");
});

test("per-IP limit: 20 attempts / 15 min across accounts, then 429", { skip }, async () => {
  const ip = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;
  // A new account every 4 attempts, so the per-account lock (5) never triggers first.
  const admins: TestAdmin[] = [];
  for (let i = 0; i < 6; i++) admins.push(await mkAdmin("viewer"));
  const statuses: number[] = [];
  for (let i = 0; i < 21; i++) {
    const target = admins[Math.floor(i / 4)]!;
    const r = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(target.userToken), body: { code: wrongCode(target.secret) }, ip });
    statuses.push(r.status);
  }
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(401));
  assert.equal(statuses[20], 429);
});

// ───────────────────────────── recovery codes

test("recovery login: single use, normalized input, no step-up, audited with remaining count", { skip }, async () => {
  const a = await mkAdmin("owner");
  const codes = [generateRecoveryCode(), generateRecoveryCode(), generateRecoveryCode()];
  for (const c of codes) await query(`INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1, $2)`, [a.adminId, hmacCode(c)]);
  const c = cookie(a.userToken);
  assert.equal((await call(routes.recovery, "POST", "/api/admin/auth/recovery", { cookie: c, body: { code: "XXXX" } })).status, 400);

  const first = await call(routes.recovery, "POST", "/api/admin/auth/recovery", { cookie: c, body: { code: codes[0] } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.remaining, 2);
  assert.equal((first.body.session as { reauthUntil: string | null }).reauthUntil, null, "no step-up from a recovery code");
  const token = adminTokenFrom(first.setCookies)!;
  const used = await auditRows(a.adminId, "auth.recovery_used");
  assert.equal(used.length, 1);
  assert.equal(used[0]!.meta?.remaining, 2);

  const reuse = await call(routes.recovery, "POST", "/api/admin/auth/recovery", { cookie: c, body: { code: codes[0] } });
  assert.equal(reuse.status, 401, "a recovery code works once");

  const sloppy = codes[1]!.toLowerCase().replace(/-/g, " ");
  const second = await call(routes.recovery, "POST", "/api/admin/auth/recovery", { cookie: c, body: { code: sloppy } });
  assert.equal(second.status, 200);
  assert.equal(second.body.remaining, 1);

  const sensitive = await call(routes.admins, "POST", "/api/admin/admins", {
    cookie: cookie(a.userToken, token),
    body: { userId: a.id, role: "viewer", reason: "test reason" },
  });
  assert.equal(sensitive.status, 401);
  assert.equal(sensitive.body.code, "reauth");
});

// ───────────────────────────── step-up

test("step-up: S permission without reauth → 401 reauth; fresh TOTP opens 10 minutes; older than 10 min → reauth again", { skip }, async () => {
  const a = await mkAdmin("owner");
  const s = await openSession(a, { reauth: false });
  const c = cookie(a.userToken, s.token);
  const create = () => call(routes.admins, "POST", "/api/admin/admins", { cookie: c, body: { role: "nope" } });

  const r1 = await create();
  assert.equal(r1.status, 401);
  assert.equal(r1.body.code, "reauth");

  assert.equal((await call(routes.reauth, "POST", "/api/admin/auth/reauth", { cookie: c, body: { code: nowCode(a.secret) }, origin: false })).status, 403);
  const bad = await call(routes.reauth, "POST", "/api/admin/auth/reauth", { cookie: c, body: { code: wrongCode(a.secret) } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, "bad_code");
  const ok = await call(routes.reauth, "POST", "/api/admin/auth/reauth", { cookie: c, body: { code: nowCode(a.secret) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const until = Date.parse(String(ok.body.reauthUntil)) - Date.now();
  assert.ok(until > 9.9 * 60_000 && until <= 10 * 60_000 + 5_000, `reauthUntil in ${until} ms`);
  assert.equal((await auditRows(a.adminId, "auth.reauth")).length, 1);

  const r2 = await create();
  assert.equal(r2.status, 400, "past the guard: the handler validates the body");

  await query(`UPDATE admin_sessions SET reauth_at = now() - interval '11 minutes' WHERE id = $1`, [s.id]);
  const r3 = await create();
  assert.equal(r3.status, 401);
  assert.equal(r3.body.code, "reauth");
  // Reads with non-S permissions are unaffected.
  assert.equal((await call(routes.admins, "GET", "/api/admin/admins", { cookie: c })).status, 200);
});

// ───────────────────────────── expiry and sliding

test("idle and absolute expiry → 401 admin_auth; sliding moves idle expiry at most once a minute, never past the absolute", { skip }, async () => {
  const a = await mkAdmin("viewer");
  const get = (token: string) => call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: cookie(a.userToken, token) });

  const idle = await openSession(a);
  assert.equal((await get(idle.token)).status, 200);
  await query(`UPDATE admin_sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1`, [idle.id]);
  const r1 = await get(idle.token);
  assert.equal(r1.status, 401);
  assert.equal(r1.body.code, "admin_auth");

  const abs = await openSession(a);
  await query(`UPDATE admin_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [abs.id]);
  assert.equal((await get(abs.token)).status, 401);

  const fresh = await openSession(a);
  const t0 = await queryOne<{ last_seen_at: Date; idle_expires_at: Date }>(`SELECT last_seen_at, idle_expires_at FROM admin_sessions WHERE id = $1`, [fresh.id]);
  assert.equal((await get(fresh.token)).status, 200);
  const t1 = await queryOne<{ last_seen_at: Date; idle_expires_at: Date }>(`SELECT last_seen_at, idle_expires_at FROM admin_sessions WHERE id = $1`, [fresh.id]);
  assert.equal(t1!.last_seen_at.getTime(), t0!.last_seen_at.getTime(), "no write within 60 s");

  await query(
    `UPDATE admin_sessions SET last_seen_at = now() - interval '5 minutes', idle_expires_at = now() + interval '1 minute' WHERE id = $1`,
    [fresh.id],
  );
  assert.equal((await get(fresh.token)).status, 200);
  const slid = await queryOne<{ ok: boolean }>(
    `SELECT idle_expires_at > now() + interval '29 minutes' AS ok FROM admin_sessions WHERE id = $1`,
    [fresh.id],
  );
  assert.equal(slid!.ok, true, "idle expiry slid to now + 30 min");

  await query(
    `UPDATE admin_sessions SET last_seen_at = now() - interval '5 minutes', expires_at = now() + interval '2 minutes' WHERE id = $1`,
    [fresh.id],
  );
  assert.equal((await get(fresh.token)).status, 200);
  const capped = await queryOne<{ ok: boolean }>(`SELECT idle_expires_at = expires_at AS ok FROM admin_sessions WHERE id = $1`, [fresh.id]);
  assert.equal(capped!.ok, true, "never past the absolute lifetime");
});

// ───────────────────────────── user session lifecycle

test("admin access dies with the user session: logout, expiry, block; and with status changes or foreign tokens", { skip }, async () => {
  const get = (a: TestAdmin, token: string) => call(routes.admins, "GET", "/api/admin/admins", { cookie: cookie(a.userToken, token) });

  const a1 = await mkAdmin("admin");
  const s1 = await openSession(a1);
  assert.equal((await get(a1, s1.token)).status, 200);
  await query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, [sha256(a1.userToken)]);
  assert.equal((await get(a1, s1.token)).status, 404, "user logout → no user → cloak");

  const a2 = await mkAdmin("admin");
  const s2 = await openSession(a2);
  await query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [sha256(a2.userToken)]);
  assert.equal((await get(a2, s2.token)).status, 404, "user session expired");

  const a3 = await mkAdmin("admin");
  const s3 = await openSession(a3);
  await query(`UPDATE users SET is_blocked = true WHERE id = $1`, [a3.id]);
  assert.equal((await get(a3, s3.token)).status, 404, "blocked user");

  const a4 = await mkAdmin("admin");
  const s4 = await openSession(a4);
  await query(`UPDATE admin_accounts SET status = 'disabled' WHERE id = $1`, [a4.adminId]);
  assert.equal((await get(a4, s4.token)).status, 404, "disabled account (re-read on every request)");

  const a5 = await mkAdmin("admin");
  const s5 = await openSession(a5);
  await query(`UPDATE admin_accounts SET status = 'pending' WHERE id = $1`, [a5.adminId]);
  const r5 = await get(a5, s5.token);
  assert.equal(r5.status, 401, "pending account: no admin session");
  assert.equal(r5.body.code, "admin_auth");

  const a6 = await mkAdmin("admin");
  const victim = await mkAdmin("owner");
  const vs = await openSession(victim);
  assert.equal((await get(a6, vs.token)).status, 401, "another admin's token with my user session");
  assert.equal((await get(a6, "A".repeat(43))).status, 401, "unknown token");
  assert.equal((await get(a6, "short")).status, 401, "malformed token");
  assert.equal((await call(routes.admins, "GET", "/api/admin/admins", { cookie: cookie(a6.userToken) })).status, 401, "no admin cookie");
  await query(`UPDATE admin_sessions SET revoked_at = now() WHERE id = $1`, [vs.id]);
  assert.equal((await get(victim, vs.token)).status, 401, "revoked session");
});

// ───────────────────────────── permission denied

test("permission denied → 403 forbidden + one `denied` audit row; `self` routes stay open to every role", { skip }, async () => {
  const v = await mkAdmin("viewer");
  const s = await openSession(v, { reauth: true });
  const c = cookie(v.userToken, s.token);
  const r = await call(routes.admins, "GET", "/api/admin/admins", { cookie: c, ip: "192.0.2.77" });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "forbidden");
  const rows = await auditRows(v.adminId, "auth.denied");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.outcome, "denied");
  assert.equal(rows[0]!.meta?.permission, "admins.view");
  assert.equal(rows[0]!.meta?.scope, "admin/admins/list");
  assert.equal(rows[0]!.ip, "192.0.2.77");
  const post = await call(routes.admins, "POST", "/api/admin/admins", { cookie: c, body: { role: "viewer" } });
  assert.equal(post.status, 403);
  assert.equal((await auditRows(v.adminId, "auth.denied")).length, 2);
  assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: c })).status, 200);
  // Mutation Origin rule runs before anything else (no denied row for a CSRF attempt).
  assert.equal((await call(routes.admins, "POST", "/api/admin/admins", { cookie: c, body: {}, origin: false })).status, 403);
  assert.equal((await call(routes.admins, "POST", "/api/admin/admins", { cookie: c, body: {}, origin: "https://evil.example" })).status, 403);
  assert.equal((await auditRows(v.adminId, "auth.denied")).length, 2);
});

// ───────────────────────────── logout, own sessions, recovery codes

test("logout: revokes the session, clears the cookie, audited; the token is dead afterwards", { skip }, async () => {
  const a = await mkAdmin("support");
  const s = await openSession(a);
  const c = cookie(a.userToken, s.token);
  assert.equal((await call(routes.session, "DELETE", "/api/admin/session", { cookie: c, origin: false })).status, 403);
  const out = await call(routes.session, "DELETE", "/api/admin/session", { cookie: c });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
  const cleared = out.setCookies.find((x) => x.startsWith(`${ADMIN_COOKIE}=`));
  assert.ok(cleared && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cleared), String(cleared));
  assert.equal((await queryOne<{ revoked: boolean }>(`SELECT revoked_at IS NOT NULL AS revoked FROM admin_sessions WHERE id = $1`, [s.id]))!.revoked, true);
  assert.equal((await auditRows(a.adminId, "auth.logout")).length, 1);
  assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: c })).status, 401);
  const me = await call(routes.session, "GET", "/api/admin/session", { cookie: c });
  assert.equal(me.status, 200);
  assert.equal(me.body.session, null, "admin identity, but no session");
});

test("own sessions: list with `current`, revoke another one, foreign/malformed ids 404, revoking the current clears the cookie", { skip }, async () => {
  const a = await mkAdmin("moderator");
  const cur = await openSession(a);
  const other = await openSession(a);
  const c = cookie(a.userToken, cur.token);
  const list = await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: c });
  const items = list.body.items as Array<{ id: string; current: boolean }>;
  assert.equal(items.length, 2);
  assert.deepEqual(items.filter((i) => i.current).map((i) => i.id), [cur.id]);

  const path = (id: string) => `/api/admin/me/sessions/${id}/revoke`;
  const r = await call(routes.meRevoke, "POST", path(other.id), { cookie: c, body: {}, params: { id: other.id } });
  assert.equal(r.status, 200);
  assert.equal(adminTokenFrom(r.setCookies), null, "revoking another session keeps my cookie");
  assert.equal((await auditRows(a.adminId, "auth.session_revoke")).length, 1);

  const stranger = await mkAdmin("moderator");
  const ss = await openSession(stranger);
  assert.equal((await call(routes.meRevoke, "POST", path(ss.id), { cookie: c, body: {}, params: { id: ss.id } })).status, 404);
  for (const bad of ["abc", "0", "-1", "1.5", "99999999999999999999", " 1"]) {
    assert.equal((await call(routes.meRevoke, "POST", path(bad), { cookie: c, body: {}, params: { id: bad } })).status, 404, bad);
  }
  assert.equal((await call(routes.meRevoke, "POST", path(cur.id), { cookie: c, body: { reason: 123 }, params: { id: cur.id } })).status, 400);
  const self = await call(routes.meRevoke, "POST", path(cur.id), { cookie: c, body: {}, params: { id: cur.id } });
  assert.equal(self.status, 200);
  assert.ok(self.setCookies.some((x) => x.startsWith(`${ADMIN_COOKIE}=;`) || /Max-Age=0/i.test(x)), "current session revoked → cookie cleared");
});

test("recovery codes: regenerate needs a fresh TOTP; the old set stops working", { skip }, async () => {
  const a = await mkAdmin("admin");
  const old = generateRecoveryCode();
  await query(`INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1, $2)`, [a.adminId, hmacCode(old)]);
  const s = await openSession(a);
  const c = cookie(a.userToken, s.token);
  assert.equal((await call(routes.recoveryCodes, "POST", "/api/admin/me/recovery-codes", { cookie: c, body: {} })).status, 400);
  assert.equal((await call(routes.recoveryCodes, "POST", "/api/admin/me/recovery-codes", { cookie: c, body: { code: wrongCode(a.secret) } })).status, 401);
  const ok = await call(routes.recoveryCodes, "POST", "/api/admin/me/recovery-codes", { cookie: c, body: { code: nowCode(a.secret) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const fresh = ok.body.recoveryCodes as string[];
  assert.equal(fresh.length, 10);
  assert.equal((await auditRows(a.adminId, "auth.recovery_regenerate")).length, 1);
  assert.equal((await call(routes.recovery, "POST", "/api/admin/auth/recovery", { cookie: cookie(a.userToken), body: { code: old } })).status, 401, "old code invalidated");
  const viaNew = await call(routes.recovery, "POST", "/api/admin/auth/recovery", { cookie: cookie(a.userToken), body: { code: fresh[3] } });
  assert.equal(viaNew.status, 200);
  assert.equal(viaNew.body.remaining, 9);
});

// ───────────────────────────── kill switch

test("ADMIN_TOTP_KEY missing or invalid → login/enroll/reauth 503 admin_disabled; existing sessions keep working; the cloak still wins", { skip }, async () => {
  const a = await mkAdmin("owner");
  const s = await openSession(a, { reauth: true });
  const prev = process.env.ADMIN_TOTP_KEY;
  try {
    for (const key of ["", "c2hvcnQ=", randomBytes(32).toString("hex")]) {
      process.env.ADMIN_TOTP_KEY = key;
      const r = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(a.userToken), body: { code: "123456" } });
      assert.equal(r.status, 503, `key ${JSON.stringify(key)}`);
      assert.equal(r.body.code, "admin_disabled");
      assert.equal((await call(routes.enroll, "GET", "/api/admin/auth/enroll?token=x", { cookie: cookie(a.userToken) })).status, 503);
      assert.equal(
        (await call(routes.reauth, "POST", "/api/admin/auth/reauth", { cookie: cookie(a.userToken, s.token), body: { code: "123456" } })).status,
        503,
      );
      assert.equal((await call(routes.admins, "GET", "/api/admin/admins", { cookie: cookie(a.userToken, s.token) })).status, 200);
      const anon = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie((await mkUser()).userToken), body: { code: "123456" } });
      assert.equal(anon.status, 404, "non-admins still see 404, not 503");
    }
  } finally {
    process.env.ADMIN_TOTP_KEY = prev;
  }
  await resetStep(a);
  assert.equal((await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(a.userToken), body: { code: nowCode(a.secret) } })).status, 200);
});

test("CLI re-run is break-glass: resets 2FA, deletes recovery codes, revokes sessions, audits via=cli", { skip }, async () => {
  const a = await mkAdmin("owner");
  const s = await openSession(a);
  await query(`INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1, $2)`, [a.adminId, hmacCode(generateRecoveryCode())]);
  const res = await cliUpsertAdmin({ telegramId: a.telegramId, role: "owner", host: "box" });
  assert.equal(res.created, false);
  assert.equal(res.adminId, a.adminId);
  assert.equal(res.revokedSessions, 1);
  const acc = await queryOne<{ status: string; enc: string | null; enabled: Date | null; step: string }>(
    `SELECT status, totp_secret_enc AS enc, totp_enabled_at AS enabled, totp_last_step::text AS step FROM admin_accounts WHERE id = $1`,
    [a.adminId],
  );
  assert.deepEqual(acc, { status: "pending", enc: null, enabled: null, step: "0" });
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_recovery_codes WHERE admin_id = $1`, [a.adminId]))!.n, 0);
  assert.equal((await call(routes.admins, "GET", "/api/admin/admins", { cookie: cookie(a.userToken, s.token) })).status, 401);
  const rows = await query<{ meta: Record<string, unknown>; target_id: string }>(
    `SELECT meta, target_id FROM admin_audit_log WHERE admin_id IS NULL AND action = 'admins.reset_2fa' AND target_id = $1`,
    [a.adminId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.meta.via, "cli");
  await assert.rejects(cliUpsertAdmin({ telegramId: "1", role: "owner", host: "box" }), /user not found/);
});

test("SessionUser.isAdmin comes from admin_accounts (active|pending), not from the phone allow-list", { skip }, async () => {
  const { getUserById, currentUser } = await import("../lib/server/session.ts");
  const plain = await mkUser();
  await query(`UPDATE users SET phone = '+998901234567' WHERE id = $1`, [plain.id]);
  assert.equal((await getUserById(plain.id))!.isAdmin, false, "a phone alone grants nothing");
  for (const [status, expected] of [["active", true], ["pending", true], ["disabled", false]] as const) {
    const a = await mkAdmin("viewer", { status });
    assert.equal((await getUserById(a.id))!.isAdmin, expected, status);
    const req = new Request("http://localhost:3000/api/users/me", { headers: { cookie: cookie(a.userToken) } });
    const viaSession = await inRequest(req, () => currentUser());
    assert.equal(viaSession!.isAdmin, expected, `${status} via the session query`);
  }
});

test("audit log is append-only (028 trigger): UPDATE and DELETE are refused", { skip }, async () => {
  const row = await queryOne<{ id: string }>(`SELECT id::text AS id FROM admin_audit_log ORDER BY id DESC LIMIT 1`);
  assert.ok(row);
  await assert.rejects(query(`UPDATE admin_audit_log SET action = 'x' WHERE id = $1`, [row!.id]), /append-only/);
  await assert.rejects(query(`DELETE FROM admin_audit_log WHERE id = $1`, [row!.id]), /append-only/);
});

// ───────────────────────────── Phase 4 security review fixes

/**
 * Finding 1: a refused call must cost the caller something. Before the fix
 * the `auth.denied` row was written BEFORE any rate limit, so a viewer could
 * flood the audit log (320 denied rows, zero 429). Now a dedicated bucket
 * `admin-denied:<adminId>` (`DENIED_RATE`, across scopes) runs first,
 * fail-closed; once over it the call is 429 and NO audit row is written.
 * Allowed calls never touch that bucket.
 *
 * Mutation: move the bucket after `writeDeniedAudit` → the row count is 31;
 * drop the bucket → the 31st call is 403.
 */
test("denied flood: refused calls are rate-limited BEFORE the audit row (across scopes); allowed calls unaffected", { skip }, async () => {
  const { DENIED_RATE } = await import("../lib/server/admin-handler.ts");
  assert.equal(DENIED_RATE.limit, 30, "production default");
  const v = await mkAdmin("viewer");
  const s = await openSession(v, { reauth: true });
  const c = cookie(v.userToken, s.token);
  const statuses: number[] = [];
  for (let i = 0; i < DENIED_RATE.limit; i++) {
    // Two different scopes: the budget is per admin, not per scope.
    const r =
      i % 2 === 0
        ? await call(routes.admins, "GET", "/api/admin/admins", { cookie: c })
        : await call(routes.admins, "POST", "/api/admin/admins", { cookie: c, body: { role: "viewer" } });
    statuses.push(r.status);
    assert.equal(r.body.code, "forbidden", `call #${i + 1}`);
  }
  assert.deepEqual(statuses, Array(DENIED_RATE.limit).fill(403));
  assert.equal((await auditRows(v.adminId, "auth.denied")).length, DENIED_RATE.limit, "one denied row per refused call under the limit");

  const over = await call(routes.admins, "GET", "/api/admin/admins", { cookie: c });
  assert.equal(over.status, 429, JSON.stringify(over.body));
  assert.equal(typeof over.body.retryAfterSec, "number");
  assert.notEqual(over.body.code, "forbidden");
  const overPost = await call(routes.admins, "POST", "/api/admin/admins", { cookie: c, body: { role: "viewer" } });
  assert.equal(overPost.status, 429, "the other scope is limited too (one bucket per admin)");
  assert.equal((await auditRows(v.adminId, "auth.denied")).length, DENIED_RATE.limit, "no audit row once limited");

  // The same admin's allowed calls are not throttled by the denied bucket.
  assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", { cookie: c })).status, 200);
  assert.equal((await call(routes.session, "GET", "/api/admin/session", { cookie: c })).status, 200);
});

/**
 * Finding 2+4: the IP budget (20 / 15 min) counts FAILED codes only;
 * successful logins never consume it. Mutation: count successes again →
 * the 21st login from one IP is 429.
 */
test("per-IP limit counts failed codes only: successful logins from one IP never consume the budget", { skip }, async () => {
  const ip = `198.19.${randomInt(0, 256)}.${randomInt(1, 255)}`;
  const admins: TestAdmin[] = [];
  for (let i = 0; i < 3; i++) admins.push(await mkAdmin("viewer"));
  for (let i = 0; i < IP_LIMIT + 1; i++) {
    const a = admins[i % admins.length]!;
    await resetStep(a);
    const r = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(a.userToken), body: { code: nowCode(a.secret) }, ip });
    assert.equal(r.status, 200, `login #${i + 1} from ${ip}: ${JSON.stringify(r.body)}`);
  }
  // One wrong code afterwards is an ordinary 401: the budget was untouched.
  const a = admins[0]!;
  const wrong = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(a.userToken), body: { code: wrongCode(a.secret) }, ip });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, "bad_code");
});

/**
 * Finding 2+4: when the client IP is not trustworthy (`clientIp` → "direct"
 * without TRUST_PROXY, "unknown" with it but no forwarded header) every admin
 * would share ONE global budget — one admin's failures lock everyone out. The
 * IP gate is skipped for such values; the per-account lock (5 / 15 min) still
 * protects. Mutation: gate "unknown" again → the 21st attempt is 429.
 */
test("untrustworthy client IP (unknown/direct): the IP gate is skipped, the per-account lock still applies", { skip }, async () => {
  const { ipGateApplies } = await import("../lib/server/admin-accounts.ts");
  assert.equal(ipGateApplies("direct"), false);
  assert.equal(ipGateApplies("unknown"), false);
  assert.equal(ipGateApplies(""), false);
  assert.equal(ipGateApplies("10.0.0.1"), true);
  assert.equal(ipGateApplies("2001:db8::1"), true);

  // An empty `x-forwarded-for` falls through to "unknown" in `clientIp`.
  const admins: TestAdmin[] = [];
  for (let i = 0; i < 6; i++) admins.push(await mkAdmin("viewer"));
  const statuses: number[] = [];
  for (let i = 0; i < 24; i++) {
    const target = admins[Math.floor(i / 4)]!;
    const r = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(target.userToken), body: { code: wrongCode(target.secret) }, ip: "" });
    statuses.push(r.status);
  }
  assert.deepEqual(statuses, Array(24).fill(401), "no shared global budget for an unknown IP");
  const failed = await auditRows(admins[0]!.adminId, "auth.login_failed");
  assert.equal(failed.length, 4);
  assert.equal(failed[0]!.ip, "unknown", "the test really exercised the untrustworthy-IP path");
  // The per-account lock is untouched: the 5th wrong code locks that account.
  const first = admins[0]!;
  const fifth = await call(routes.login, "POST", "/api/admin/auth/login", { cookie: cookie(first.userToken), body: { code: wrongCode(first.secret) }, ip: "" });
  assert.equal(fifth.status, 429);
  assert.equal(fifth.body.code, "locked");
});
