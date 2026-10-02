import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin account management (docs/admin/02-plan.md §4.3 invariants, §6.13,
 * §8, §10 T4, T20) through the real routes on an isolated Postgres: rank and
 * self rules, the last-active-owner guard, disable → sessions revoked in the
 * same transaction, reset-2fa, session revocation, and exactly one audit row
 * (with before/after of the changed fields only) per successful mutation.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-accounts-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

// The last-owner guard counts owners globally: it needs a database of its own.
const iso = hasDb ? await createIsolatedDb("adminacc") : { isolated: false, drop: async () => {} };

type Sent = { chat_id: unknown; text: string };
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
const { createSession, SESSION_COOKIE, getUserById } = await import("../lib/server/session.ts");
const { seal, hmacCode, generateRecoveryCode } = await import("../lib/server/admin-crypto.ts");
const { generateTotpSecret } = await import("../lib/server/admin-totp.ts");
const { createAdminSession } = await import("../lib/server/admin-session.ts");
const accounts = await import("../lib/server/admin-accounts.ts");
const { permissionsOf } = await import("../lib/server/admin-rbac.ts");
type AdminActor = Parameters<typeof accounts.updateAdmin>[0];

const routes = {
  admins: await import("../app/api/admin/admins/route.ts"),
  admin: await import("../app/api/admin/admins/[id]/route.ts"),
  reset: await import("../app/api/admin/admins/[id]/reset-2fa/route.ts"),
  revoke: await import("../app/api/admin/admins/[id]/sessions/revoke/route.ts"),
  enroll: await import("../app/api/admin/auth/enroll/route.ts"),
  meSessions: await import("../app/api/admin/me/sessions/route.ts"),
};

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── helpers

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestAdmin = { id: string; telegramId: string; userToken: string; adminId: string; role: Role; adminToken: string; sessionId: string };
type RouteFn = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Result = { status: number; body: Record<string, unknown> };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const freshIp = () => `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;

async function mkUser(): Promise<{ id: string; telegramId: string; userToken: string }> {
  const telegramId = String(randomInt(5_000_000_000, 9_000_000_000));
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, 'Admin Test') RETURNING id::text AS id`,
    [telegramId, `acc_${randomBytes(5).toString("hex")}`],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, telegramId, userToken: token };
}

/** An enrolled, active admin with a live session (step-up fresh unless told otherwise). */
async function mkAdmin(role: Role, opts: { status?: "active" | "pending" | "disabled"; reauth?: boolean } = {}): Promise<TestAdmin> {
  const u = await mkUser();
  const status = opts.status ?? "active";
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [u.id, role, status],
  );
  const adminId = row!.id;
  if (status !== "pending") {
    await query(`UPDATE admin_accounts SET totp_secret_enc = $2, totp_enabled_at = now() WHERE id = $1`, [
      adminId,
      seal(generateTotpSecret(), `admin:${adminId}`),
    ]);
  }
  const usid = (await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.userToken)]))!.id;
  const s = await transaction((client) =>
    createAdminSession(client, { adminId, userSessionId: usid, ip: "10.0.0.2", userAgent: "t", reauth: opts.reauth ?? true }),
  );
  return { ...u, adminId, role, adminToken: s.token, sessionId: s.id };
}

async function call(
  mod: object,
  method: "GET" | "POST" | "PATCH",
  path: string,
  who: TestAdmin | null,
  opts: { body?: unknown; params?: Record<string, string> } = {},
): Promise<Result> {
  const headers: Record<string, string> = { host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": freshIp() };
  if (who) headers.cookie = `${SESSION_COOKIE}=${who.userToken}; slaydx_admin=${who.adminToken}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const fn = (mod as Record<string, RouteFn>)[method]!;
  const res = await inRequest(req, () => fn(req, { params: Promise.resolve(opts.params ?? {}) }));
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const patch = (who: TestAdmin, id: string, body: unknown) => call(routes.admin, "PATCH", `/api/admin/admins/${id}`, who, { body, params: { id } });
const reset2fa = (who: TestAdmin, id: string, body: unknown) =>
  call(routes.reset, "POST", `/api/admin/admins/${id}/reset-2fa`, who, { body, params: { id } });
const revokeAll = (who: TestAdmin, id: string, body: unknown) =>
  call(routes.revoke, "POST", `/api/admin/admins/${id}/sessions/revoke`, who, { body, params: { id } });

type AuditRow = { id: string; admin_id: string | null; actor_role: string | null; outcome: string; reason: string | null; before: unknown; after: unknown; meta: Record<string, unknown> | null };
async function audits(action: string, targetId: string): Promise<AuditRow[]> {
  return query<AuditRow>(
    `SELECT id::text AS id, admin_id::text AS admin_id, actor_role, outcome, reason, before, after, meta
       FROM admin_audit_log WHERE action = $1 AND target_id = $2 ORDER BY id`,
    [action, targetId],
  );
}

async function liveSessions(adminId: string): Promise<number> {
  return (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_sessions WHERE admin_id = $1 AND revoked_at IS NULL`, [adminId]))!.n;
}

const REASON = "Operatsion zarurat";

// ───────────────────────────── create

test("create: validation, rank, unknown user, already-admin; success returns a one-time link and one audit row", { skip }, async () => {
  const owner = await mkAdmin("owner");
  const admin = await mkAdmin("admin");
  const target = await mkUser();
  const post = (who: TestAdmin, body: unknown) => call(routes.admins, "POST", "/api/admin/admins", who, { body });

  assert.equal((await post(admin, { userId: target.id, role: "owner", reason: REASON })).status, 403, "admin cannot create an owner");
  const r403 = await post(admin, { userId: target.id, role: "admin", reason: REASON });
  assert.equal(r403.status, 403, "admin cannot create a peer admin");
  assert.equal(r403.body.code, "rank");
  for (const body of [
    { userId: target.id, role: "root", reason: REASON },
    { userId: target.id, role: "viewer" },
    { userId: target.id, role: "viewer", reason: "abc" },
    { userId: target.id, role: "viewer", reason: "x".repeat(501) },
    { userId: target.id, telegramId: target.telegramId, role: "viewer", reason: REASON },
    { role: "viewer", reason: REASON },
    { userId: target.id, role: "viewer", reason: REASON, sendViaTelegram: "yes" },
  ]) {
    assert.equal((await post(owner, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await post(owner, { userId: "abc", role: "viewer", reason: REASON })).status, 404);
  assert.equal((await post(owner, { userId: "999999999999", role: "viewer", reason: REASON })).status, 404);
  assert.equal((await post(owner, { telegramId: "1", role: "viewer", reason: REASON })).status, 404);
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_accounts WHERE user_id = $1`, [target.id]))!.n, 0);

  const before = sent.length;
  const ok = await post(admin, { telegramId: target.telegramId, role: "finance", reason: REASON, sendViaTelegram: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const created = ok.body.admin as { id: string; userId: string; role: string; status: string; totpEnabled: boolean; activeSessions: number };
  assert.deepEqual(
    { userId: created.userId, role: created.role, status: created.status, totpEnabled: created.totpEnabled, activeSessions: created.activeSessions },
    { userId: target.id, role: "finance", status: "pending", totpEnabled: false, activeSessions: 0 },
  );
  const url = String(ok.body.enrollUrl);
  assert.match(url, /^http:\/\/localhost:3000\/admin\/enroll\?token=[A-Za-z0-9_-]{43}$/);
  const expIn = Date.parse(String(ok.body.expiresAt)) - Date.now();
  assert.ok(expIn > 29 * 60_000 && expIn <= 30 * 60_000 + 5_000, `expires in ${expIn}`);
  const rows = await audits("admins.create", created.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.admin_id, admin.adminId);
  assert.equal(rows[0]!.actor_role, "admin");
  assert.equal(rows[0]!.reason, REASON);
  assert.deepEqual(rows[0]!.after, { userId: target.id, role: "finance", status: "pending" });
  assert.ok(!JSON.stringify(rows[0]).includes(new URL(url).searchParams.get("token")!), "the token is never audited");
  await new Promise((r) => setTimeout(r, 50));
  const dm = sent.slice(before).find((m) => String(m.chat_id) === target.telegramId);
  assert.ok(dm && dm.text.includes(url.replace(/&/g, "&amp;")), "enrollment link sent on request");

  const dup = await post(owner, { userId: target.id, role: "viewer", reason: REASON });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "already_admin");

  // The link opens only for that user.
  const token = new URL(url).searchParams.get("token")!;
  const req = new Request(`http://localhost:3000/api/admin/auth/enroll?token=${token}`, {
    headers: { host: "localhost:3000", cookie: `${SESSION_COOKIE}=${target.userToken}`, "x-forwarded-for": freshIp() },
  });
  const info = await inRequest(req, () => (routes.enroll.GET as RouteFn)(req, { params: Promise.resolve({}) }));
  assert.equal(info.status, 200);

  // Owners may create owners.
  const u2 = await mkUser();
  assert.equal((await post(owner, { userId: u2.id, role: "owner", reason: REASON })).status, 201);
});

// ───────────────────────────── update

test("update: self 409, rank 403 (target and new role), no-op 400; role change audits only the changed field", { skip }, async () => {
  const admin = await mkAdmin("admin");
  const owner = await mkAdmin("owner");
  const peer = await mkAdmin("admin");
  const fin = await mkAdmin("finance");

  const self = await patch(admin, admin.adminId, { role: "viewer", reason: REASON });
  assert.equal(self.status, 409);
  assert.equal(self.body.code, "self");
  assert.equal((await patch(admin, admin.adminId, { status: "disabled", reason: REASON })).status, 409);
  assert.equal((await patch(admin, owner.adminId, { role: "viewer", reason: REASON })).status, 403, "higher rank");
  assert.equal((await patch(admin, peer.adminId, { role: "viewer", reason: REASON })).status, 403, "same rank");
  assert.equal((await patch(admin, fin.adminId, { role: "admin", reason: REASON })).status, 403, "cannot promote to own rank");
  assert.equal((await patch(admin, fin.adminId, { role: "finance", reason: REASON })).status, 400, "no-op");
  assert.equal((await patch(admin, fin.adminId, { status: "pending", reason: REASON })).status, 400);
  assert.equal((await patch(admin, fin.adminId, { reason: REASON })).status, 400);
  assert.equal((await patch(admin, fin.adminId, { role: "support" })).status, 400, "reason required");
  assert.equal((await patch(admin, "abc", { role: "support", reason: REASON })).status, 404);
  assert.equal((await patch(admin, "987654321", { role: "support", reason: REASON })).status, 404);
  assert.equal((await audits("admins.update", fin.adminId)).length, 0, "refused requests are not audited as changes");

  const ok = await patch(admin, fin.adminId, { role: "support", reason: REASON });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((ok.body.admin as { role: string }).role, "support");
  const rows = await audits("admins.update", fin.adminId);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.before, { role: "finance" });
  assert.deepEqual(rows[0]!.after, { role: "support" });
  assert.equal(rows[0]!.meta, null);
  assert.equal(await liveSessions(fin.adminId), 1, "a role change keeps sessions (permissions are re-read per request)");

  // The new role applies to the very next request.
  const viewerNow = await patch(owner, fin.adminId, { role: "viewer", reason: REASON });
  assert.equal(viewerNow.status, 200);
  const forbidden = await call(routes.admins, "GET", "/api/admin/admins", fin);
  assert.equal(forbidden.status, 403);
});

test("disable: revokes every session in the same transaction (T20); re-enable restores only an enrolled account", { skip }, async () => {
  const owner = await mkAdmin("owner");
  const sup = await mkAdmin("support");
  const usid = (await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(sup.userToken)]))!.id;
  await transaction((c) => createAdminSession(c, { adminId: sup.adminId, userSessionId: usid, ip: null, userAgent: null, reauth: false }));
  assert.equal(await liveSessions(sup.adminId), 2);

  const off = await patch(owner, sup.adminId, { status: "disabled", reason: REASON });
  assert.equal(off.status, 200);
  assert.equal((off.body.admin as { status: string; activeSessions: number }).status, "disabled");
  assert.equal((off.body.admin as { activeSessions: number }).activeSessions, 0);
  assert.equal(await liveSessions(sup.adminId), 0);
  const acc = await queryOne<{ disabled_at: Date | null; disabled_reason: string | null }>(
    `SELECT disabled_at, disabled_reason FROM admin_accounts WHERE id = $1`,
    [sup.adminId],
  );
  assert.ok(acc!.disabled_at);
  assert.equal(acc!.disabled_reason, REASON);
  const rows = await audits("admins.update", sup.adminId);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.before, { status: "active" });
  assert.deepEqual(rows[0]!.after, { status: "disabled" });
  assert.equal(rows[0]!.meta?.revokedSessions, 2);
  assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", sup)).status, 404, "disabled → cloak");

  const on = await patch(owner, sup.adminId, { status: "active", reason: REASON });
  assert.equal(on.status, 200);
  assert.equal((on.body.admin as { status: string }).status, "active");
  assert.equal((await queryOne<{ d: Date | null }>(`SELECT disabled_at AS d FROM admin_accounts WHERE id = $1`, [sup.adminId]))!.d, null);
  assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", sup)).status, 401, "revoked sessions stay revoked");

  // Not enrolled: "active" means "waiting for enrollment" (no TOTP, no access).
  const pend = await mkAdmin("viewer", { status: "pending" });
  await patch(owner, pend.adminId, { status: "disabled", reason: REASON });
  const back = await patch(owner, pend.adminId, { status: "active", reason: REASON });
  assert.equal(back.status, 200);
  assert.equal((back.body.admin as { status: string }).status, "pending");
});

test("last active owner can be neither demoted, disabled nor reset (and nothing is written)", { skip }, async () => {
  if (!iso.isolated) return; // counts owners globally; meaningless on a shared DB
  const lastOwner = await mkAdmin("owner");
  // Make it the only active owner in this isolated database.
  await query(`UPDATE admin_accounts SET status = 'disabled' WHERE role = 'owner' AND id <> $1`, [lastOwner.adminId]);
  // Through the API the acting owner always counts as "another" active owner, so the
  // guard is reached only by a race or a stale actor; exercise it at the library level
  // with an actor whose own row is not an active owner.
  const actorRow = await mkAdmin("admin");
  const user = (await getUserById(actorRow.id))!;
  const actor = {
    id: actorRow.adminId,
    userId: actorRow.id,
    role: "owner",
    permissions: permissionsOf("owner"),
    sessionId: actorRow.sessionId,
    ip: "10.0.0.3",
    userAgent: null,
    requestId: null,
    user,
    session: {
      id: actorRow.sessionId,
      createdAt: "",
      lastSeenAt: "",
      idleExpiresAt: "",
      expiresAt: "",
      reauthAt: null,
      reauthFresh: true,
      needsSlide: false,
    },
  } satisfies AdminActor;

  for (const input of [{ role: "admin" }, { status: "disabled" }]) {
    await assert.rejects(accounts.updateAdmin(actor, lastOwner.adminId, { ...input, reason: REASON }), (e: unknown) => {
      const err = e as { status?: number; extra?: { code?: string } };
      return err.status === 409 && err.extra?.code === "last_owner";
    });
  }
  await assert.rejects(accounts.resetAdmin2fa(actor, lastOwner.adminId, REASON), (e: unknown) => (e as { status?: number }).status === 409);
  assert.equal((await queryOne<{ role: string; status: string }>(`SELECT role, status FROM admin_accounts WHERE id = $1`, [lastOwner.adminId]))!.status, "active");
  assert.equal((await audits("admins.update", lastOwner.adminId)).length, 0);
  assert.equal((await audits("admins.reset_2fa", lastOwner.adminId)).length, 0);
  assert.equal(await liveSessions(lastOwner.adminId), 1);

  // With a second active owner the same change goes through.
  const second = await mkAdmin("owner");
  const ok = await patch(second, lastOwner.adminId, { role: "admin", reason: REASON });
  assert.equal(ok.status, 200);
  const third = await patch(lastOwner, second.adminId, { status: "disabled", reason: REASON });
  assert.equal(third.status, 403, "the demoted ex-owner (now admin) cannot touch an owner");
});

// ───────────────────────────── reset-2fa

test("reset-2fa: self 409, rank 403; clears secret and codes, revokes sessions, closes old links, new link works", { skip }, async () => {
  const admin = await mkAdmin("admin");
  const owner = await mkAdmin("owner");
  const mod = await mkAdmin("moderator");
  await query(`INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1, $2)`, [mod.adminId, hmacCode(generateRecoveryCode())]);

  const self = await reset2fa(admin, admin.adminId, { reason: REASON });
  assert.equal(self.status, 409);
  assert.equal(self.body.code, "self");
  assert.equal((await reset2fa(admin, owner.adminId, { reason: REASON })).status, 403);
  assert.equal((await reset2fa(admin, mod.adminId, {})).status, 400);

  const first = await reset2fa(admin, mod.adminId, { reason: REASON });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await reset2fa(admin, mod.adminId, { reason: REASON });
  assert.equal(second.status, 200);
  const acc = await queryOne<{ status: string; enc: string | null; enabled: Date | null }>(
    `SELECT status, totp_secret_enc AS enc, totp_enabled_at AS enabled FROM admin_accounts WHERE id = $1`,
    [mod.adminId],
  );
  assert.deepEqual(acc, { status: "pending", enc: null, enabled: null });
  assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_recovery_codes WHERE admin_id = $1`, [mod.adminId]))!.n, 0);
  assert.equal(await liveSessions(mod.adminId), 0);
  const rows = await audits("admins.reset_2fa", mod.adminId);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0]!.before, { status: "active", totpEnabled: true });
  assert.deepEqual(rows[0]!.after, { status: "pending", totpEnabled: false });
  assert.equal(rows[0]!.meta?.revokedSessions, 1);

  const enroll = (url: unknown) => {
    const token = new URL(String(url)).searchParams.get("token")!;
    const req = new Request(`http://localhost:3000/api/admin/auth/enroll?token=${token}`, {
      headers: { host: "localhost:3000", cookie: `${SESSION_COOKIE}=${mod.userToken}`, "x-forwarded-for": freshIp() },
    });
    return inRequest(req, () => (routes.enroll.GET as RouteFn)(req, { params: Promise.resolve({}) }));
  };
  assert.equal((await enroll(first.body.enrollUrl)).status, 404, "an older link is closed by a newer one");
  assert.equal((await enroll(second.body.enrollUrl)).status, 200);

  // A disabled account stays disabled through a reset.
  const dis = await mkAdmin("viewer", { status: "disabled" });
  assert.equal((await reset2fa(owner, dis.adminId, { reason: REASON })).status, 200);
  assert.equal((await queryOne<{ status: string }>(`SELECT status FROM admin_accounts WHERE id = $1`, [dis.adminId]))!.status, "disabled");
});

// ───────────────────────────── revoke sessions, list

test("revoke sessions: rank-limited, returns the count, audited; list shows live session counts", { skip }, async () => {
  const admin = await mkAdmin("admin");
  const owner = await mkAdmin("owner");
  const fin = await mkAdmin("finance");
  assert.equal((await revokeAll(admin, owner.adminId, { reason: REASON })).status, 403);
  assert.equal((await revokeAll(admin, fin.adminId, { reason: "x" })).status, 400);

  const list1 = await call(routes.admins, "GET", "/api/admin/admins", admin);
  assert.equal(list1.status, 200);
  const item = (list1.body.items as Array<{ id: string; activeSessions: number; name: string; role: string }>).find((i) => i.id === fin.adminId)!;
  assert.equal(item.activeSessions, 1);
  assert.equal(item.role, "finance");
  assert.equal(item.name, "Admin Test");

  const r = await revokeAll(admin, fin.adminId, { reason: REASON });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { revoked: 1 });
  const rows = await audits("admins.revoke_sessions", fin.adminId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.meta?.revoked, 1);
  assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", fin)).status, 401);
  const again = await revokeAll(admin, fin.adminId, { reason: REASON });
  assert.deepEqual(again.body, { revoked: 0 });

  const list2 = await call(routes.admins, "GET", "/api/admin/admins", admin);
  assert.equal((list2.body.items as Array<{ id: string; activeSessions: number }>).find((i) => i.id === fin.adminId)!.activeSessions, 0);
  // Owners may revoke owners (another owner's sessions); their own go through /admin/account (409 self, next test).
  const owner2 = await mkAdmin("owner");
  assert.equal((await revokeAll(owner, owner2.adminId, { reason: REASON })).status, 200);
  assert.equal((await revokeAll(owner, owner.adminId, { reason: REASON })).status, 409);
});

test("revoke sessions on yourself: 409 self (own sessions go via /admin/account), nothing revoked or audited", { skip }, async () => {
  // An owner passes the rank check against owners, so only the self rule stops this.
  const owner = await mkAdmin("owner");
  const r = await revokeAll(owner, owner.adminId, { reason: REASON });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "self");
  assert.equal(await liveSessions(owner.adminId), 1, "the own session is untouched");
  assert.equal((await audits("admins.revoke_sessions", owner.adminId)).length, 0, "a refusal is not audited");
  // Still signed in: the next request works.
  assert.equal((await call(routes.meSessions, "GET", "/api/admin/me/sessions", owner)).status, 200);
  // Another owner may revoke this owner's sessions.
  const other = await mkAdmin("owner");
  const ok = await revokeAll(other, owner.adminId, { reason: REASON });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { revoked: 1 });
});

test("mutations require step-up: no fresh reauth → 401 reauth and nothing written", { skip }, async () => {
  const owner = await mkAdmin("owner", { reauth: false });
  const fin = await mkAdmin("finance");
  const r = await patch(owner, fin.adminId, { status: "disabled", reason: REASON });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "reauth");
  assert.equal((await reset2fa(owner, fin.adminId, { reason: REASON })).body.code, "reauth");
  assert.equal(await liveSessions(fin.adminId), 1);
  assert.equal((await audits("admins.update", fin.adminId)).length, 0);
  // revoke-sessions is admins.manage too (S): same rule.
  assert.equal((await revokeAll(owner, fin.adminId, { reason: REASON })).body.code, "reauth");
});
