import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin wallet adjustment through the REAL route (docs/admin/02-plan.md §6.4,
 * §6.0 Idempotency-Key, §8 audit, §10 T9/T13) on a throwaway Postgres:
 * ledger row + audit row in one transaction, idempotent replay (same key,
 * same canonical body → original body + `Idempotent-Replayed`), 422 on a
 * different body, exactly one effect under concurrency, 409 insufficient /
 * self, 400 confirm above the threshold, strict validation, and the guard
 * (403 role, 401 stale step-up, 403 no Origin, 404 non-admin).
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - drop `pg_advisory_xact_lock` → the parallel test writes 2 ledger rows;
 *   - skip the bodyHash compare → the conflict test gets 201 instead of 422;
 *   - drop the `self` check → 409 self test gets 201;
 *   - drop the `after < 0` check → insufficient test gets 201 and a CHECK violation;
 *   - drop the confirm check → 400 confirm test gets 201.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-wallet-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminwallet") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { confirmMatches, parseWalletAdjustBody } = await import("../lib/server/admin-wallet.ts");
const { bodyHashOf, canonicalJson, requireIdempotencyKey } = await import("../lib/server/admin-idempotency.ts");
const route = await import("../app/api/admin/users/[id]/wallet-adjustments/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures (admin-auth.test.mts pattern)

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(balance = 0, points = 0, quota = 0): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, 'Wallet Test', $3, $4, $5) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `w_${randomBytes(5).toString("hex")}`, points, quota, balance],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function mkAdmin(role: Role): Promise<TestAdmin> {
  const u = await mkUser(100);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  return { ...u, adminId: row!.id };
}

async function openSession(admin: TestAdmin, reauth = true): Promise<Session> {
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(admin.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "wallet-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

async function session(role: Role, reauth = true): Promise<Session> {
  return openSession(await mkAdmin(role), reauth);
}

type Result = { status: number; body: Record<string, unknown>; replayed: string | null };

async function adjust(
  cookie: string | null,
  userId: string,
  body: unknown,
  opts: { key?: string | null; origin?: boolean } = {},
): Promise<Result> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "wallet-test", "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (opts.origin !== false) headers.origin = "http://localhost:3000";
  if (opts.key !== null) headers["Idempotency-Key"] = opts.key ?? randomUUID();
  const req = new Request(`http://localhost:3000/api/admin/users/${encodeURIComponent(userId)}/wallet-adjustments`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const res = await inRequest(req, () => route.POST(req, { params: Promise.resolve({ id: userId }) }));
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed, replayed: res.headers.get("Idempotent-Replayed") };
}

const wallets = async (id: string) => {
  const r = await queryOne<{ points: string; quota: string; balance: string }>(`SELECT points, quota, balance FROM users WHERE id = $1`, [id]);
  return { points: Number(r!.points), quota: Number(r!.quota), balance: Number(r!.balance) };
};
const ledger = (id: string) =>
  query<{ kind: string; reference: string | null; note: string | null; points_delta: string; quota_delta: string; balance_delta: string }>(
    `SELECT kind, reference, note, points_delta, quota_delta, balance_delta FROM transactions WHERE user_id = $1 ORDER BY id`,
    [id],
  );
const audits = (adminId: string, action = "users.wallet.adjust") =>
  query<{ outcome: string; target_id: string | null; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; meta: Record<string, unknown> | null }>(
    `SELECT outcome, target_id, reason, before, after, meta FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id`,
    [adminId, action],
  );

const GOOD = { wallet: "balance", delta: 1_000, reasonCode: "compensation", reason: "Xizmat uzilishi uchun kompensatsiya" };

// ───────────────────────────── unit (no DB)

test("confirmMatches: group separators of any kind are ignored, the digits must match", () => {
  assert.equal(confirmMatches("1 000 000", 1_000_000), true);
  assert.equal(confirmMatches("1 000 000", -1_000_000), true);
  assert.equal(confirmMatches("1 000 000", 1_000_000), true);
  assert.equal(confirmMatches("1000000", 1_000_000), true);
  assert.equal(confirmMatches("1 000 00", 1_000_000), false);
  assert.equal(confirmMatches("", 5), false);
  assert.equal(confirmMatches(null, 5), false);
});

test("canonicalJson / bodyHashOf: key order never changes the hash; a value does", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } }), '{"a":{"c":2,"d":[1,{"y":2,"z":1}]},"b":1}');
  assert.equal(bodyHashOf({ delta: 5, wallet: "balance" }), bodyHashOf({ wallet: "balance", delta: 5 }));
  assert.notEqual(bodyHashOf({ delta: 5, wallet: "balance" }), bodyHashOf({ delta: 6, wallet: "balance" }));
});

test("requireIdempotencyKey: UUID v4 only (lower-cased), 400 otherwise", () => {
  const mk = (v?: string) => new Request("http://x/", { headers: v === undefined ? {} : { "Idempotency-Key": v } });
  const key = randomUUID();
  assert.equal(requireIdempotencyKey(mk(key.toUpperCase())), key);
  for (const bad of [undefined, "", "abc", "12345678-1234-1234-1234-123456789012", "6ba7b810-9dad-11d1-80b4-00c04fd430c8", `${key}x`]) {
    assert.throws(() => requireIdempotencyKey(mk(bad)), (e: { status: number; extra: { code: string } }) => e.status === 400 && e.extra.code === "idempotency_key", `MUTATSIYA: ${bad}`);
  }
});

test("parseWalletAdjustBody: every field is validated from unknown", () => {
  assert.deepEqual(parseWalletAdjustBody({ ...GOOD, extra: "ignored" }), { ...GOOD, confirm: null });
  assert.equal(parseWalletAdjustBody({ ...GOOD, confirm: "1 000" }).confirm, "1 000");
  const bad: Array<Record<string, unknown>> = [
    { ...GOOD, wallet: "hacked" },
    { ...GOOD, wallet: ["balance"] },
    { ...GOOD, delta: "1000" },
    { ...GOOD, delta: 0 },
    { ...GOOD, delta: 1.5 },
    { ...GOOD, delta: 100_000_001 },
    { ...GOOD, delta: -100_000_001 },
    { ...GOOD, delta: Number.NaN },
    { ...GOOD, reasonCode: "bribe" },
    { ...GOOD, reason: "kam" },
    { ...GOOD, reason: "x".repeat(501) },
    { ...GOOD, reason: 42 },
    { ...GOOD, confirm: 1000 },
  ];
  for (const b of bad) {
    assert.throws(() => parseWalletAdjustBody(b), (e: { status: number }) => e.status === 400, `MUTATSIYA: ${JSON.stringify(b)}`);
  }
});

// ───────────────────────────── DB integration

test("credit: 201, one ledger row with admin:<key> and the neutral note, one audit row in the same transaction", { skip }, async () => {
  const s = await session("finance");
  const u = await mkUser(500);
  const key = randomUUID();
  const r = await adjust(s.cookie, u.id, GOOD, { key });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.replayed, null);
  assert.equal(r.body.wallet, "balance");
  assert.equal(r.body.before, 500);
  assert.equal(r.body.after, 1500);
  assert.match(String(r.body.transactionId), /^\d+$/);
  const user = r.body.user as Record<string, unknown>;
  assert.equal(user.id, u.id);
  assert.equal(user.balance, 1500);
  assert.ok(!("phone" in user), "no PII in the money response");

  assert.deepEqual(await wallets(u.id), { points: 0, quota: 0, balance: 1500 });
  const rows = await ledger(u.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "admin_credit");
  assert.equal(rows[0].reference, `admin:${key}`);
  assert.equal(rows[0].note, "Ma'muriy tuzatish", "the actor never reaches the user-visible note");
  assert.equal(rows[0].balance_delta, "1000");

  const a = await audits(s.admin.adminId);
  assert.equal(a.length, 1, "exactly one ok audit row");
  assert.equal(a[0].outcome, "ok");
  assert.equal(a[0].target_id, u.id);
  assert.equal(a[0].reason, GOOD.reason);
  assert.deepEqual(a[0].before, { balance: 500 });
  assert.deepEqual(a[0].after, { balance: 1500 });
  assert.equal(a[0].meta?.reasonCode, "compensation");
  assert.equal(a[0].meta?.idempotencyKey, key);
  assert.equal(a[0].meta?.transactionId, r.body.transactionId);
  assert.match(String(a[0].meta?.bodyHash), /^[0-9a-f]{64}$/);
});

test("idempotency: same key + same canonical body → original body, Idempotent-Replayed, no second effect; different body → 422", { skip }, async () => {
  const s = await session("owner");
  const u = await mkUser(0, 50);
  const key = randomUUID();
  const body = { wallet: "points", delta: -20, reasonCode: "correction", reason: "Noto'g'ri berilgan bonus" };
  const first = await adjust(s.cookie, u.id, body, { key });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  // Field order differs, the canonical body is the same.
  const replay = await adjust(s.cookie, u.id, { reason: body.reason, reasonCode: body.reasonCode, delta: body.delta, wallet: body.wallet }, { key });
  assert.equal(replay.status, 201);
  assert.equal(replay.replayed, "true");
  assert.deepEqual(replay.body, first.body, "the ORIGINAL response body is returned");
  assert.deepEqual(await wallets(u.id), { points: 30, quota: 0, balance: 0 }, "no second debit");
  assert.equal((await ledger(u.id)).length, 1);
  assert.equal((await audits(s.admin.adminId)).length, 1, "a replay writes no audit row");

  const conflict = await adjust(s.cookie, u.id, { ...body, delta: -10 }, { key });
  assert.equal(conflict.status, 422);
  assert.equal(conflict.body.code, "idempotency_conflict");
  assert.equal((await ledger(u.id)).length, 1);
  assert.equal((await audits(s.admin.adminId)).length, 1);

  // Another admin reusing the same key (even with the same body): a conflict, never a replay.
  const other = await session("admin");
  const stolen = await adjust(other.cookie, u.id, body, { key });
  assert.equal(stolen.status, 422);
  assert.equal(stolen.body.code, "idempotency_conflict");
  assert.equal(stolen.replayed, null);
  assert.equal((await ledger(u.id)).length, 1);
  assert.equal((await audits(other.admin.adminId)).length, 0);
});

test("same admin, same key, same body, DIFFERENT target → 422; user B gets no ledger or audit row (reviewer finding 1)", { skip }, async () => {
  const s = await session("finance");
  const a = await mkUser(0);
  const b = await mkUser(0);
  const key = randomUUID();
  const body = { wallet: "balance", delta: 1_000, reasonCode: "promo", reason: "Aksiya bonusi" };
  const r1 = await adjust(s.cookie, a.id, body, { key });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const r2 = await adjust(s.cookie, b.id, body, { key });
  assert.equal(r2.status, 422, `MUTATSIYA: ${JSON.stringify(r2.body)}`);
  assert.equal(r2.body.code, "idempotency_conflict");
  assert.equal(r2.replayed, null);
  assert.deepEqual(await wallets(a.id), { points: 0, quota: 0, balance: 1_000 });
  assert.deepEqual(await wallets(b.id), { points: 0, quota: 0, balance: 0 }, "B is never credited");
  assert.equal((await ledger(b.id)).length, 0);
  const a1 = await audits(s.admin.adminId);
  assert.equal(a1.length, 1);
  assert.equal(a1[0].target_id, a.id);
});

test("concurrency: four parallel identical requests → one ledger row, one audit row, one effect", { skip }, async () => {
  const s = await session("finance");
  const u = await mkUser(0);
  const key = randomUUID();
  const body = { wallet: "balance", delta: 7_000, reasonCode: "promo", reason: "Aksiya bo'yicha bonus" };
  // Barrier: the test holds the user's row lock so every request is in flight
  // at once; only the advisory lock keeps them from all passing the lookup.
  const gate = await pool().connect();
  await gate.query("BEGIN");
  await gate.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [u.id]);
  const pending = Promise.all([1, 2, 3, 4].map(() => adjust(s.cookie, u.id, body, { key })));
  await new Promise((r) => setTimeout(r, 400));
  await gate.query("COMMIT");
  gate.release();
  const results = await pending;
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(results.filter((r) => r.replayed === null).length, 1, "exactly one original");
  assert.equal(results.filter((r) => r.replayed === "true").length, 3, "the others are replays");
  for (const r of results) assert.deepEqual(r.body, results[0].body);
  assert.deepEqual(await wallets(u.id), { points: 0, quota: 0, balance: 7_000 });
  assert.equal((await ledger(u.id)).length, 1);
  assert.equal((await audits(s.admin.adminId)).length, 1);
});

test("409 insufficient (with available) leaves nothing behind; a debit to exactly zero is fine", { skip }, async () => {
  const s = await session("admin");
  const u = await mkUser(0, 0, 300);
  const r = await adjust(s.cookie, u.id, { wallet: "quota", delta: -301, reasonCode: "correction", reason: "Kvota tuzatish" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "insufficient");
  assert.equal(r.body.available, 300);
  assert.deepEqual(await wallets(u.id), { points: 0, quota: 300, balance: 0 });
  assert.equal((await ledger(u.id)).length, 0);
  assert.equal((await audits(s.admin.adminId)).length, 0, "domain refusals are not audited");

  const ok = await adjust(s.cookie, u.id, { wallet: "quota", delta: -300, reasonCode: "correction", reason: "Kvota tuzatish" });
  assert.equal(ok.status, 201);
  assert.equal((await ledger(u.id))[0].kind, "admin_debit");
  assert.deepEqual(await wallets(u.id), { points: 0, quota: 0, balance: 0 });
});

test("409 self: an admin cannot adjust their own wallet (T13)", { skip }, async () => {
  const s = await session("owner");
  const r = await adjust(s.cookie, s.admin.id, GOOD);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "self");
  assert.equal((await wallets(s.admin.id)).balance, 100);
  assert.equal((await ledger(s.admin.id)).length, 0);
});

test("typed confirmation at or above admin.wallet_confirm_threshold (default 1 000 000)", { skip }, async () => {
  const s = await session("finance");
  const u = await mkUser(0);
  const big = { wallet: "balance", delta: 1_000_000, reasonCode: "other", reason: "Katta miqdorli tuzatish" };
  const missing = await adjust(s.cookie, u.id, big);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "confirm");
  const wrong = await adjust(s.cookie, u.id, { ...big, confirm: "1 000" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, "confirm");
  assert.equal((await ledger(u.id)).length, 0);

  const ok = await adjust(s.cookie, u.id, { ...big, confirm: "1 000 000" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  // Just below the threshold no confirmation is needed.
  const small = await adjust(s.cookie, u.id, { ...big, delta: -999_999 });
  assert.equal(small.status, 201, JSON.stringify(small.body));
  assert.equal((await wallets(u.id)).balance, 1);

  // A lower threshold from app_settings is honoured (settings cache is per process; set before first read in this test).
  await query(`INSERT INTO app_settings (key, value) VALUES ('admin.wallet_confirm_threshold', '10') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  invalidateSettingsCache();
  const ten = await adjust(s.cookie, u.id, { ...big, delta: 10 });
  assert.equal(ten.status, 400);
  assert.equal(ten.body.code, "confirm");
  await query(`DELETE FROM app_settings WHERE key = 'admin.wallet_confirm_threshold'`);
  invalidateSettingsCache();
});

test("validation at the route: bad or missing key → 400, bad id → 404, unknown user → 404, bad body → 400 (never 500)", { skip }, async () => {
  const s = await session("owner");
  const u = await mkUser(0);
  assert.equal((await adjust(s.cookie, u.id, GOOD, { key: null })).status, 400, "missing key");
  assert.equal((await adjust(s.cookie, u.id, GOOD, { key: "not-a-uuid" })).status, 400, "bad key");
  assert.equal((await adjust(s.cookie, u.id, GOOD, { key: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" })).status, 400, "uuid v1");
  for (const id of ["abc", "1.5", "-1", "0", "99999999999999999999", " 1", "1e3"]) {
    const r = await adjust(s.cookie, id, GOOD);
    assert.equal(r.status, 404, `MUTATSIYA: id=${id} → ${r.status}`);
    assert.equal(r.body.code, "not_found");
  }
  const missing = await adjust(s.cookie, "9223372036854775807", GOOD);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "not_found");
  for (const b of [{ ...GOOD, delta: "1000" }, { ...GOOD, wallet: "hacked" }, { ...GOOD, reason: "" }, { ...GOOD, reasonCode: "x" }]) {
    assert.equal((await adjust(s.cookie, u.id, b)).status, 400, JSON.stringify(b));
  }
  assert.equal((await ledger(u.id)).length, 0);
  assert.equal((await audits(s.admin.adminId)).length, 0);
});

test("guard: 403 for support (denied audit), 401 reauth when the step-up is stale, 403 without Origin, 404 for non-admins", { skip }, async () => {
  const u = await mkUser(0);
  const support = await session("support");
  const denied = await adjust(support.cookie, u.id, GOOD);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "forbidden");
  const d = await audits(support.admin.adminId, "auth.denied");
  assert.equal(d.length, 1);
  assert.equal(d[0].outcome, "denied");
  assert.equal(d[0].meta?.permission, "users.wallet");

  const stale = await session("finance", false);
  const reauth = await adjust(stale.cookie, u.id, GOOD);
  assert.equal(reauth.status, 401);
  assert.equal(reauth.body.code, "reauth");

  const fresh = await session("finance");
  assert.equal((await adjust(fresh.cookie, u.id, GOOD, { origin: false })).status, 403, "Origin is mandatory on mutations");

  const plain = await mkUser(0);
  assert.equal((await adjust(`${SESSION_COOKIE}=${plain.userToken}`, u.id, GOOD)).status, 404, "non-admin → cloak");
  assert.equal((await adjust(null, u.id, GOOD)).status, 404, "anonymous → cloak");

  assert.deepEqual(await wallets(u.id), { points: 0, quota: 0, balance: 0 });
  assert.equal((await ledger(u.id)).length, 0);
});

/**
 * Phase 4 finding 3: money on an admin's own user account follows the same
 * `assertMayActOn` rule as blocking (§4.3): an active or pending admin account
 * may be adjusted only by an actor who could manage that role (`admins.manage`
 * + strictly lower rank; owners may act on owners). A disabled account is a
 * plain user again. Mutation: drop the `assertMayActOn` call → finance gets 201.
 */
test("403 admin_target: wallet adjustments on admin accounts need admins.manage within rank; nothing is written", { skip }, async () => {
  const finance = await session("finance");
  const support = await mkAdmin("support");
  const r = await adjust(finance.cookie, support.id, GOOD);
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, "admin_target");
  assert.equal((await wallets(support.id)).balance, 100);
  assert.equal((await ledger(support.id)).length, 0);
  assert.equal((await audits(finance.admin.adminId)).length, 0, "no audit row for a refused adjustment");

  // Pending accounts are admin accounts too (SessionUser.isAdmin).
  const pending = await mkUser(100);
  await query(`INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'viewer', 'pending')`, [pending.id]);
  assert.equal((await adjust(finance.cookie, pending.id, GOOD)).body.code, "admin_target");

  // Rank: an admin may adjust a support's wallet, never an owner's or another admin's.
  const admin = await session("admin");
  const owner = await mkAdmin("owner");
  const peer = await mkAdmin("admin");
  assert.equal((await adjust(admin.cookie, owner.id, GOOD)).body.code, "admin_target");
  assert.equal((await adjust(admin.cookie, peer.id, GOOD)).body.code, "admin_target");
  assert.equal((await adjust(admin.cookie, support.id, GOOD)).status, 201, "admin → support: within rank");
  assert.equal((await wallets(support.id)).balance, 1_100);

  // Owner → owner is allowed (§4.3); the self rule still wins for the owner's own wallet.
  const boss = await session("owner");
  assert.equal((await adjust(boss.cookie, owner.id, GOOD)).status, 201);
  assert.equal((await adjust(boss.cookie, boss.admin.id, GOOD)).body.code, "self");

  // A disabled admin account is a plain user.
  await query(`UPDATE admin_accounts SET status = 'disabled' WHERE user_id = $1`, [peer.id]);
  assert.equal((await adjust(finance.cookie, peer.id, GOOD)).status, 201, "disabled account → ordinary user");
});
