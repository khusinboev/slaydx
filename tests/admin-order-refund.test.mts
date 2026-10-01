import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * External refunds / chargebacks through the REAL route (docs/admin/02-plan.md
 * §5.2, §6.6) on a throwaway Postgres: `payment_refunds` row + optional wallet
 * clawback (balance for a top-up, Pro quota for a subscription, pro rata,
 * never below zero → `shortfall`) + audit row in one transaction; the recorded
 * total never exceeds the order; only `paid` orders; Idempotency-Key replay,
 * conflict and concurrency; strict validation; the guard incl. step-up.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - `Math.min(requested, available)` → `requested`: the shortfall test hits
 *     the users CHECK constraint (500) instead of shortfall 15 000;
 *   - drop the `amountSoum > remaining` check → the cap test records 33 000 on
 *     a 20 000 order;
 *   - drop the `state !== 'paid'` check → a pending order gets 201;
 *   - drop the advisory lock → the parallel test inserts 2 refund rows.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-orders-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminorders") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { settleOrder, PRO_PLAN, SOUM_PER_COIN } = await import("../lib/server/payments.ts");
const { clawbackUnits, clawbackWalletOf, parseExternalRefundBody } = await import("../lib/server/admin-order-refund.ts");
const route = await import("../app/api/admin/orders/[id]/external-refund/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, 'Orders Test', 0, 0, 0) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `o_${randomBytes(5).toString("hex")}`],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function session(role: Role, reauth = true): Promise<Session> {
  const u = await mkUser();
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const admin: TestAdmin = { ...u, adminId: acc!.id };
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "orders-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${u.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

/** A real settlement (`settleOrder`) so the wallet is credited the way production does it. */
async function paidOrder(uid: string, purpose: "topup" | "pro", amountSoum: number): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state, provider_txn) VALUES ($1, $2, 'click', $3, $4, 'pending', $5)`,
    [id, uid, purpose, amountSoum, `txn-${id.slice(0, 8)}`],
  );
  const out = await settleOrder(id, Date.now());
  assert.equal(out.status, "paid");
  return id;
}

type Result = { status: number; body: Record<string, unknown>; replayed: string | null };

async function record(cookie: string | null, orderId: string, body: unknown, opts: { key?: string | null; origin?: boolean } = {}): Promise<Result> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.5", "user-agent": "orders-test", "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (opts.origin !== false) headers.origin = "http://localhost:3000";
  if (opts.key !== null) headers["Idempotency-Key"] = opts.key ?? randomUUID();
  const req = new Request(`http://localhost:3000/api/admin/orders/${encodeURIComponent(orderId)}/external-refund`, { method: "POST", headers, body: JSON.stringify(body) });
  const res = await inRequest(req, () => route.POST(req, { params: Promise.resolve({ id: orderId }) }));
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
const refundRows = (orderId: string) =>
  query<{ id: string; amount_soum: string; kind: string; clawback_wallet: string | null; clawback_amount: string; shortfall: string; clawback_tx_id: string | null; created_by: string | null }>(
    `SELECT id::text AS id, amount_soum, kind, clawback_wallet, clawback_amount, shortfall, clawback_tx_id::text AS clawback_tx_id, created_by::text AS created_by
       FROM payment_refunds WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
const debits = (uid: string) =>
  query<{ id: string; reference: string | null; note: string | null; balance_delta: string; quota_delta: string }>(
    `SELECT id::text AS id, reference, note, balance_delta, quota_delta FROM transactions WHERE user_id = $1 AND kind = 'admin_debit' ORDER BY id`,
    [uid],
  );
const audits = (adminId: string, action = "payments.refund_record") =>
  query<{ outcome: string; target_id: string | null; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; meta: Record<string, unknown> | null }>(
    `SELECT outcome, target_id, reason, before, after, meta FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id`,
    [adminId, action],
  );

const BODY = { kind: "refund", amountSoum: 20_000, reason: "Click orqali qaytarildi", clawback: true };

// ───────────────────────────── unit

test("clawback units mirror the settlement credit: top-up 1 so'm = 1/SOUM_PER_COIN balance, pro quota pro rata", () => {
  assert.equal(clawbackWalletOf("topup"), "balance");
  assert.equal(clawbackWalletOf("pro"), "quota");
  assert.equal(clawbackUnits("topup", 20_000), Math.floor(20_000 / SOUM_PER_COIN));
  assert.equal(clawbackUnits("pro", PRO_PLAN.priceSoum), PRO_PLAN.quota);
  assert.equal(clawbackUnits("pro", PRO_PLAN.priceSoum / 2), Math.floor(PRO_PLAN.quota / 2));
  assert.equal(clawbackUnits("pro", 1), Math.floor(PRO_PLAN.quota / PRO_PLAN.priceSoum));
});

test("parseExternalRefundBody: strict fields", () => {
  assert.deepEqual(parseExternalRefundBody({ ...BODY, extra: 1 }), BODY);
  for (const b of [
    { ...BODY, kind: "gift" },
    { ...BODY, amountSoum: "20000" },
    { ...BODY, amountSoum: 0 },
    { ...BODY, amountSoum: -5 },
    { ...BODY, amountSoum: 1.5 },
    { ...BODY, clawback: "yes" },
    { ...BODY, clawback: undefined },
    { ...BODY, reason: "kam" },
  ]) {
    assert.throws(() => parseExternalRefundBody(b), (e: { status: number }) => e.status === 400, `MUTATSIYA: ${JSON.stringify(b)}`);
  }
});

// ───────────────────────────── DB integration

test("top-up refund with full clawback: refund row, admin_debit refund:<id>, wallet to zero, one audit row", { skip }, async () => {
  const s = await session("finance");
  const u = await mkUser();
  const order = await paidOrder(u.id, "topup", 20_000);
  assert.deepEqual(await wallets(u.id), { points: 0, quota: 0, balance: 20_000 });

  const key = randomUUID();
  const r = await record(s.cookie, order, BODY, { key });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.replayed, null);
  const refund = r.body.refund as Record<string, unknown>;
  assert.equal(refund.orderId, order);
  assert.equal(refund.amountSoum, 20_000);
  assert.equal(refund.kind, "refund");
  assert.equal(refund.clawbackWallet, "balance");
  assert.equal(refund.clawbackAmount, 20_000);
  assert.equal(refund.shortfall, 0);
  assert.equal(refund.createdBy, s.admin.adminId);
  assert.deepEqual(r.body.clawback, { wallet: "balance", requested: 20_000, debited: 20_000, shortfall: 0 });
  assert.equal(r.body.recordedSoum, 20_000);
  assert.equal(r.body.remainingSoum, 0);

  assert.deepEqual(await wallets(u.id), { points: 0, quota: 0, balance: 0 });
  const rows = await refundRows(order);
  assert.equal(rows.length, 1);
  const d = await debits(u.id);
  assert.equal(d.length, 1);
  assert.equal(d[0].reference, `refund:${rows[0].id}`);
  assert.equal(d[0].note, "Ma'muriy tuzatish");
  assert.equal(d[0].balance_delta, "-20000");
  assert.equal(rows[0].clawback_tx_id, d[0].id, "the ledger row is linked from payment_refunds");
  assert.equal(refund.clawbackTxId, d[0].id);

  const a = await audits(s.admin.adminId);
  assert.equal(a.length, 1);
  assert.equal(a[0].target_id, order);
  assert.equal(a[0].reason, BODY.reason);
  assert.deepEqual(a[0].before, { recordedSoum: 0, balance: 20_000 });
  assert.deepEqual(a[0].after, { recordedSoum: 20_000, balance: 0, shortfall: 0 });
  assert.equal(a[0].meta?.idempotencyKey, key);
  assert.equal(a[0].meta?.refundId, rows[0].id);

  const full = await record(s.cookie, order, { ...BODY, amountSoum: 1 });
  assert.equal(full.status, 409);
  assert.equal(full.body.code, "amount");
  assert.equal(full.body.remaining, 0);
});

test("shortfall: the clawback never takes the wallet below zero", { skip }, async () => {
  const s = await session("owner");
  const u = await mkUser();
  const order = await paidOrder(u.id, "topup", 20_000);
  await query(`UPDATE users SET balance = 5_000 WHERE id = $1`, [u.id]); // the user already spent 15 000
  const r = await record(s.cookie, order, { ...BODY, kind: "chargeback" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.clawback, { wallet: "balance", requested: 20_000, debited: 5_000, shortfall: 15_000 });
  assert.equal((await wallets(u.id)).balance, 0);
  const rows = await refundRows(order);
  assert.equal(rows[0].kind, "chargeback");
  assert.equal(rows[0].clawback_amount, "5000");
  assert.equal(rows[0].shortfall, "15000");
  assert.ok(rows[0].clawback_tx_id);

  // Nothing left in the wallet: no ledger row at all, shortfall is the whole amount.
  const u2 = await mkUser();
  const order2 = await paidOrder(u2.id, "topup", 10_000);
  await query(`UPDATE users SET balance = 0 WHERE id = $1`, [u2.id]);
  const r2 = await record(s.cookie, order2, { ...BODY, amountSoum: 10_000 });
  assert.equal(r2.status, 201);
  assert.deepEqual(r2.body.clawback, { wallet: "balance", requested: 10_000, debited: 0, shortfall: 10_000 });
  assert.equal((await debits(u2.id)).length, 0);
  assert.equal((await refundRows(order2))[0].clawback_tx_id, null);
});

test("partial amounts: the recorded total is capped at the order; no clawback → no ledger row", { skip }, async () => {
  const s = await session("admin");
  const u = await mkUser();
  const order = await paidOrder(u.id, "topup", 20_000);
  const a = await record(s.cookie, order, { ...BODY, amountSoum: 8_000, clawback: false });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.clawback, null);
  assert.equal(a.body.remainingSoum, 12_000);
  assert.equal((await wallets(u.id)).balance, 20_000);
  assert.equal((await debits(u.id)).length, 0);
  const rows = await refundRows(order);
  assert.equal(rows[0].clawback_wallet, null);
  assert.equal(rows[0].clawback_amount, "0");

  const over = await record(s.cookie, order, { ...BODY, amountSoum: 13_000 });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, "amount");
  assert.equal(over.body.remaining, 12_000);
  assert.equal((await refundRows(order)).length, 1);

  const rest = await record(s.cookie, order, { ...BODY, amountSoum: 12_000 });
  assert.equal(rest.status, 201);
  assert.equal(rest.body.recordedSoum, 20_000);
  assert.deepEqual(rest.body.clawback, { wallet: "balance", requested: 12_000, debited: 12_000, shortfall: 0 });
  assert.equal((await wallets(u.id)).balance, 8_000);
  assert.equal((await audits(s.admin.adminId)).length, 2);
});

test("pro order: the clawback hits the quota, pro rata", { skip }, async () => {
  const s = await session("finance");
  const u = await mkUser();
  const order = await paidOrder(u.id, "pro", PRO_PLAN.priceSoum);
  assert.equal((await wallets(u.id)).quota, PRO_PLAN.quota);
  const half = Math.floor(PRO_PLAN.priceSoum / 2);
  const r = await record(s.cookie, order, { ...BODY, amountSoum: half });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const expected = clawbackUnits("pro", half);
  assert.deepEqual(r.body.clawback, { wallet: "quota", requested: expected, debited: expected, shortfall: 0 });
  assert.equal((await wallets(u.id)).quota, PRO_PLAN.quota - expected);
  assert.equal((await wallets(u.id)).balance, 0, "balance untouched");
  const d = await debits(u.id);
  assert.equal(d.length, 1);
  assert.equal(d[0].quota_delta, String(-expected));
  assert.equal((await refundRows(order))[0].clawback_wallet, "quota");
});

test("only paid orders: pending / cancelled → 409 state; unknown or malformed id → 404", { skip }, async () => {
  const s = await session("finance");
  const u = await mkUser();
  const pending = randomUUID();
  await query(`INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state) VALUES ($1, $2, 'payme', 'topup', 5000, 'pending')`, [pending, u.id]);
  const r = await record(s.cookie, pending, { ...BODY, amountSoum: 5_000 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "state");
  assert.equal(r.body.state, "pending");
  assert.equal((await refundRows(pending)).length, 0);
  assert.equal((await audits(s.admin.adminId)).length, 0);

  for (const id of ["abc", "123", "", randomUUID().slice(0, 35), "'; --"]) {
    const bad = await record(s.cookie, id, BODY);
    assert.equal(bad.status, 404, `MUTATSIYA: id=${JSON.stringify(id)} → ${bad.status}`);
    assert.equal(bad.body.code, "not_found");
  }
  const unknown = await record(s.cookie, randomUUID(), BODY);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "not_found");
  assert.equal((await record(s.cookie, pending, BODY, { key: null })).status, 400, "missing key");
  assert.equal((await record(s.cookie, pending, { ...BODY, clawback: "yes" })).status, 400);
});

test("idempotency: replay returns the original body, a different body is 422, parallel duplicates insert one row", { skip }, async () => {
  const s = await session("finance");
  const u = await mkUser();
  const order = await paidOrder(u.id, "topup", 20_000);
  const key = randomUUID();
  const body = { ...BODY, amountSoum: 6_000 };
  const first = await record(s.cookie, order, body, { key });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const replay = await record(s.cookie, order, { clawback: true, reason: body.reason, amountSoum: 6_000, kind: "refund" }, { key });
  assert.equal(replay.status, 201);
  assert.equal(replay.replayed, "true");
  assert.deepEqual(replay.body, first.body);
  assert.equal((await refundRows(order)).length, 1);
  assert.equal((await wallets(u.id)).balance, 14_000, "no second clawback");
  assert.equal((await audits(s.admin.adminId)).length, 1);

  const conflict = await record(s.cookie, order, { ...body, amountSoum: 7_000 }, { key });
  assert.equal(conflict.status, 422);
  assert.equal(conflict.body.code, "idempotency_conflict");
  assert.equal((await refundRows(order)).length, 1);

  const key2 = randomUUID();
  // Barrier (see admin-wallet.test.mts): hold the order row so all three are in flight together.
  const gate = await pool().connect();
  await gate.query("BEGIN");
  await gate.query(`SELECT 1 FROM payment_orders WHERE id = $1 FOR UPDATE`, [order]);
  const pending = Promise.all([1, 2, 3].map(() => record(s.cookie, order, { ...body, amountSoum: 4_000 }, { key: key2 })));
  await new Promise((r) => setTimeout(r, 400));
  await gate.query("COMMIT");
  gate.release();
  const par = await pending;
  for (const r of par) assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(par.filter((r) => r.replayed === null).length, 1);
  assert.equal((await refundRows(order)).length, 2);
  assert.equal((await wallets(u.id)).balance, 10_000);
  assert.equal((await audits(s.admin.adminId)).length, 2);
});

test("guard: support → 403 (denied audit), stale step-up → 401 reauth, no Origin → 403, non-admin → 404", { skip }, async () => {
  const u = await mkUser();
  const order = await paidOrder(u.id, "topup", 20_000);
  const support = await session("support");
  const denied = await record(support.cookie, order, BODY);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "forbidden");
  assert.equal((await audits(support.admin.adminId, "auth.denied"))[0]?.meta?.permission, "payments.refund_record");

  const stale = await session("finance", false);
  const reauth = await record(stale.cookie, order, BODY);
  assert.equal(reauth.status, 401);
  assert.equal(reauth.body.code, "reauth");

  const fresh = await session("finance");
  assert.equal((await record(fresh.cookie, order, BODY, { origin: false })).status, 403);
  const plain = await mkUser();
  assert.equal((await record(`${SESSION_COOKIE}=${plain.userToken}`, order, BODY)).status, 404);
  assert.equal((await record(null, order, BODY)).status, 404);

  assert.equal((await refundRows(order)).length, 0);
  assert.equal((await wallets(u.id)).balance, 20_000);
});
