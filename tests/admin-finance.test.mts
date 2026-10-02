import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Finance for the admin panel through the REAL routes (docs/admin/02-plan.md
 * §6.6 rows `finance/summary`, `finance/reconciliation`, `transactions`,
 * `transactions/export`; §9) on a throwaway Postgres. Money moves through the
 * production paths (`settleOrder`, `charge`, `refund`, `refundPartial`,
 * `topUp`, the F6 external-refund route); only the defects reconciliation
 * must find are written by hand, each next to a negative twin.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - partial check without the `refundShare` CASE: G5 (share 0) is reported;
 *   - pending check without `GREATEST(...)`: P3 (fresh provider txn on an old
 *     order) is reported;
 *   - failed check without `NOT EXISTS refund`: G2 is reported;
 *   - timeout not caught (`isTimeout` → false): the lock test gets a 500;
 *   - summary cache key without `to`: the second range returns the first one's data;
 *   - ledger link resolver: generation lookup removed → charge rows lose their link.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-finance-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminfinance") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { settleOrder, attachTransaction } = await import("../lib/server/payments.ts");
const { charge, refund, refundPartial, topUp } = await import("../lib/server/credits.ts");
const { clearFinanceCache, runReconciliation } = await import("../lib/server/admin-finance.ts");
const summaryRoute = await import("../app/api/admin/finance/summary/route.ts");
const reconRoute = await import("../app/api/admin/finance/reconciliation/route.ts");
const ledgerRoute = await import("../app/api/admin/transactions/route.ts");
const ledgerExportRoute = await import("../app/api/admin/transactions/export/route.ts");
const refundRoute = await import("../app/api/admin/orders/[id]/external-refund/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type Session = { cookie: string; adminId: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name: string): Promise<{ id: string; token: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `f_${randomBytes(5).toString("hex")}`, name],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, token };
}

async function session(role: Role, reauth = true): Promise<Session> {
  const u = await mkUser("Admin");
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.token)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: acc!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "finance-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${u.token}; ${adminCookieName()}=${s.token}`, adminId: acc!.id };
}

type Res = { status: number; body: Record<string, unknown>; text: string; headers: Headers };

async function read(res: Response): Promise<Res> {
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text, headers: res.headers };
}

function get(path: string, cookie: string | null): Request {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.3.9", "user-agent": "finance-test" };
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost:3000${path}`, { headers });
}

type GetRoute = { GET: (req: Request, ctx: unknown) => Promise<Response> };
const call = async (route: GetRoute, path: string, cookie: string | null) => {
  const req = get(path, cookie);
  return read(await inRequest(req, () => route.GET(req, undefined)));
};
const summary = (cookie: string | null, qs = "") => call(summaryRoute, `/api/admin/finance/summary${qs}`, cookie);
const recon = (cookie: string | null, qs = "") => call(reconRoute, `/api/admin/finance/reconciliation${qs}`, cookie);
const ledger = (cookie: string | null, qs = "") => call(ledgerRoute, `/api/admin/transactions${qs}`, cookie);
const ledgerCsv = (cookie: string | null, qs = "") => call(ledgerExportRoute, `/api/admin/transactions/export${qs}`, cookie);

/** The removed Pro subscription as it was sold (the former `PRO_PLAN`): legacy orders only. */
const LEGACY_PRO = { priceSoum: 15_000, quota: 15_000 } as const;

/**
 * A Pro order paid BEFORE the subscription removal, written by SQL (the product
 * can no longer create or settle one this way): the order, its `subscription`
 * ledger row crediting quota under the settlement reference, and the wallet.
 */
async function legacyProOrder(uid: string, provider: "click" | "payme", performTime: number): Promise<{ id: string; txn: string }> {
  const id = randomUUID();
  const txn = provider === "click" ? String(randomInt(100_000_000, 999_999_999)) : randomBytes(12).toString("hex");
  await transaction(async (c) => {
    await c.query(
      `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state, provider_txn, create_time, perform_time)
       VALUES ($1, $2, $3, 'pro', $4, 'paid', $5, $6, $7)`,
      [id, uid, provider, LEGACY_PRO.priceSoum, txn, performTime - 60_000, performTime],
    );
    await c.query(`INSERT INTO transactions (user_id, kind, quota_delta, reference, note) VALUES ($1, 'subscription', $2, $3, 'Pro obuna')`, [
      uid,
      LEGACY_PRO.quota,
      `${provider}:${txn}`,
    ]);
    await c.query(`UPDATE users SET quota = quota + $2, plan = 'pro' WHERE id = $1`, [uid, LEGACY_PRO.quota]);
  });
  return { id, txn };
}

/** Migration 034's merge for one user (034 itself ran before the fixtures existed); returns the ledger row id. */
async function mergeQuota(uid: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `WITH src AS (SELECT id, quota AS q FROM users WHERE id = $1 AND quota > 0 FOR UPDATE),
     moved AS (
       UPDATE users u SET quota = u.quota - s.q, balance = u.balance + s.q FROM src s WHERE u.id = s.id
       RETURNING u.id, s.q
     )
     INSERT INTO transactions (user_id, kind, quota_delta, balance_delta, reference, note)
     SELECT id, 'quota_merge', -q, q, 'quota-merge:' || id::text, 'Kvota balansga o''tkazildi: ' || q::text || ' tanga' FROM moved
     RETURNING id::text AS id`,
    [uid],
  );
  assert.ok(row, "the user held quota to merge");
  return row.id;
}

/** UTC instant of a Tashkent wall-clock time (UTC+5, no DST). */
const tk = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 5, mi, s, ms);

async function paidOrder(uid: string, provider: "click" | "payme", purpose: "topup", amount: number, performTime: number): Promise<{ id: string; txn: string }> {
  const id = randomUUID();
  const txn = provider === "click" ? String(randomInt(100_000_000, 999_999_999)) : randomBytes(12).toString("hex");
  await query(`INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum) VALUES ($1, $2, $3, $4, $5)`, [id, uid, provider, purpose, amount]);
  assert.equal(await attachTransaction(id, txn, performTime - 60_000), true);
  assert.equal((await settleOrder(id, performTime)).status, "paid");
  return { id, txn };
}

async function job(uid: string, status: "FAILED" | "COMPLETED", delivered: unknown = null): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, price, finished_at, delivered_json)
     VALUES ($1, $2, 'slide', 'Mavzu', $3, 0, now(), $4::jsonb)`,
    [id, uid, status, delivered === null ? null : JSON.stringify(delivered)],
  );
  return id;
}

async function charged(uid: string, amount: number, status: "FAILED" | "COMPLETED", delivered: unknown = null): Promise<string> {
  const id = await job(uid, status, delivered);
  const r = await charge(uid, amount, id, "Generatsiya");
  assert.equal(r.ok, true);
  return id;
}

const seed = {
  ali: "",
  vali: "",
  mismatch: "",
  a1: { id: "", txn: "" },
  b1: { id: "", txn: "" },
  legacy: "",
  g: {} as Record<string, string>,
  ghost: "",
  p1: "",
  p2: "",
  p3: "",
  c1: "",
  c2: "",
  clawbackRefundId: "",
};

before(async () => {
  if (!hasDb) return;
  const ali = await mkUser("Ali Valiyev");
  const vali = await mkUser("Vali Aliyev");
  const mis = await mkUser("Hamyon Farqi");
  seed.ali = ali.id;
  seed.vali = vali.id;
  seed.mismatch = mis.id;

  // Revenue: two orders in range, two just outside it, one legacy paid order without perform_time (and without a ledger row).
  seed.a1 = await paidOrder(ali.id, "click", "topup", 100_000, tk(2026, 9, 11, 10));
  await paidOrder(ali.id, "click", "topup", 5_000, tk(2026, 9, 9, 23, 59, 59, 999));
  seed.b1 = await legacyProOrder(vali.id, "payme", tk(2026, 9, 13, 23, 59, 59, 999));
  await paidOrder(vali.id, "payme", "topup", 40_000, tk(2026, 9, 14));
  seed.legacy = randomUUID();
  await query(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state, perform_time, updated_at)
     VALUES ($1, $2, 'payme', 'topup', 7000, 'paid', 0, '2026-09-12T07:00:00Z')`,
    [seed.legacy, vali.id],
  );

  // Jobs: ali has 105 000 balance.
  seed.g.G1 = await charged(ali.id, 3_000, "FAILED"); // failed, unrefunded → hit
  seed.g.G2 = await charged(ali.id, 2_000, "FAILED"); // failed, refunded → no hit
  assert.equal(await refund(ali.id, seed.g.G2, "Xatolik"), true);
  seed.g.G3 = await charged(ali.id, 6_000, "COMPLETED", { got: 3, want: 4 }); // shortfall, no refund → hit
  seed.g.G4 = await charged(ali.id, 8_000, "COMPLETED", { got: 14, want: 16, unit: "slayd" }); // partial refund done → no hit
  assert.equal(await refundPartial(ali.id, seed.g.G4, 0.125, "16 tadan 14 ta slayd"), true);
  seed.g.G5 = await charged(ali.id, 3_000, "COMPLETED", { got: 3, want: 4, refundShare: 0 }); // nothing owed → no hit
  seed.g.G6 = await charged(ali.id, 3_000, "COMPLETED", { got: 4, want: 4 }); // delivered in full → no hit
  seed.g.G7 = await job(ali.id, "FAILED"); // never charged → no hit
  seed.g.G8 = await charged(ali.id, 1_000, "COMPLETED", { got: 0, want: 2 }); // nothing delivered, no refund → hit
  seed.g.G9 = await job(ali.id, "COMPLETED", { got: "x", want: 4 }); // malformed JSON numbers must not break the check
  seed.ghost = randomUUID();
  assert.equal((await charge(ali.id, 500, seed.ghost, "Generatsiya")).ok, true); // a charge whose job row is gone → no link

  // External refunds through the F6 route: a clawback on the top-up and a chargeback without one on the Pro order.
  const fin = await session("finance");
  for (const [orderId, body] of [
    [seed.a1.id, { kind: "refund", amountSoum: 10_000, reason: "Click orqali qaytarildi", clawback: true }],
    [seed.b1.id, { kind: "chargeback", amountSoum: LEGACY_PRO.priceSoum, reason: "Bank chargeback qildi", clawback: false }],
  ] as const) {
    const req = new Request(`http://localhost:3000/api/admin/orders/${orderId}/external-refund`, {
      method: "POST",
      headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", cookie: fin.cookie, "Idempotency-Key": randomUUID() },
      body: JSON.stringify(body),
    });
    const r = await read(await inRequest(req, () => refundRoute.POST(req, { params: Promise.resolve({ id: orderId }) })));
    assert.equal(r.status, 201, r.text);
    if (body.clawback) seed.clawbackRefundId = String((r.body.refund as Record<string, unknown>).id);
  }

  // Wallet mismatch: a real top-up and bonus, then a write that bypasses the ledger.
  assert.equal(await topUp(mis.id, { balance: 1_000 }, `click:manual-${randomBytes(4).toString("hex")}`, "topup", "Qo'lda"), true);
  assert.equal(await topUp(mis.id, { points: 50 }, `signup:${mis.id}`, "bonus", "=1+1"), true);
  await query(`UPDATE users SET balance = balance + 7, created_at = '2026-09-12T06:00:00Z' WHERE id = $1`, [mis.id]);

  // Order age checks.
  const now = Date.now();
  const pending = async (createdAgoH: number, createTimeAgoH: number) => {
    const id = randomUUID();
    await query(`INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, created_at) VALUES ($1, $2, 'payme', 'topup', 9000, now() - make_interval(hours => $3))`, [
      id,
      vali.id,
      createdAgoH,
    ]);
    assert.equal(await attachTransaction(id, randomBytes(12).toString("hex"), now - createTimeAgoH * 3_600_000), true);
    return id;
  };
  seed.p1 = await pending(13, 13); // → hit
  seed.p2 = await pending(1, 1);
  seed.p3 = await pending(13, 1); // old order, fresh provider transaction → not yet
  const created = async (agoH: number) => {
    const id = randomUUID();
    await query(`INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, created_at) VALUES ($1, $2, 'click', 'topup', 9000, now() - make_interval(hours => $3))`, [
      id,
      ali.id,
      agoH,
    ]);
    return id;
  };
  seed.c1 = await created(25); // → hit
  seed.c2 = await created(2);

  // Pin job-ledger and refund timestamps to a fixed Tashkent day so the summary is deterministic.
  await query(`UPDATE transactions SET created_at = '2026-09-12T06:00:00Z' WHERE kind IN ('charge', 'refund', 'admin_debit', 'admin_credit')`);
  await query(`UPDATE payment_refunds SET created_at = '2026-09-12T06:00:00Z'`);
});

// ───────────────────────────── summary

test("summary: zero-filled Tashkent days, provider/purpose split, spend, refunds, adjustments, liabilities, external refunds", { skip }, async () => {
  clearFinanceCache();
  const s = await session("viewer");
  const r = await summary(s.cookie, "?from=2026-09-10&to=2026-09-13");
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["adjustments", "cashSpend", "externalRefunds", "generatedAt", "liabilities", "range", "refunds", "revenue"]);
  assert.deepEqual(r.body.range, { from: "2026-09-10", to: "2026-09-13", days: 4 });
  const rev = r.body.revenue as Record<string, unknown>;
  assert.deepEqual(rev.byDay, [
    { day: "2026-09-10", soum: 0, orders: 0, click: 0, payme: 0, topup: 0, pro: 0 },
    { day: "2026-09-11", soum: 100_000, orders: 1, click: 100_000, payme: 0, topup: 100_000, pro: 0 },
    // The legacy paid order has no perform_time: not revenue (same rule as the dashboard), only a reconciliation hit.
    { day: "2026-09-12", soum: 0, orders: 0, click: 0, payme: 0, topup: 0, pro: 0 },
    { day: "2026-09-13", soum: 15_000, orders: 1, click: 0, payme: 15_000, topup: 0, pro: 15_000 },
  ]);
  assert.deepEqual(rev.total, { soum: 115_000, orders: 2 });
  assert.deepEqual(rev.byProvider, { click: { soum: 100_000, orders: 1 }, payme: { soum: 15_000, orders: 1 } });
  assert.deepEqual(rev.byPurpose, { topup: { soum: 100_000, orders: 1 }, pro: { soum: 15_000, orders: 1 } });

  assert.deepEqual(r.body.cashSpend, { charges: 8, points: 0, quota: 0, balance: 26_500 });
  assert.deepEqual(r.body.refunds, { count: 2, points: 0, quota: 0, balance: 3_000 });
  assert.deepEqual(r.body.adjustments, { count: 1, points: 0, quota: 0, balance: -10_000 });
  // ali 105 000 − 26 500 + 3 000 − 10 000; vali 40 000 + Pro quota; mismatch 1 007 + 50 points.
  assert.deepEqual(r.body.liabilities, { points: 50, quota: LEGACY_PRO.quota, balance: 71_500 + 40_000 + 1_007, users: 3 });
  assert.deepEqual(r.body.externalRefunds, {
    count: 2,
    amountSoum: 10_000 + LEGACY_PRO.priceSoum,
    refunds: 1,
    chargebacks: 1,
    clawedBack: { balance: 10_000, quota: 0 },
    shortfall: 0,
  });

  const other = await summary(s.cookie, "?from=2026-09-14&to=2026-09-14");
  assert.deepEqual((other.body.revenue as Record<string, unknown>).total, { soum: 40_000, orders: 1 }, "the midnight order belongs to the 14th");
  assert.deepEqual(other.body.cashSpend, { charges: 0, points: 0, quota: 0, balance: 0 });

  const dflt = await summary(s.cookie);
  assert.equal(dflt.status, 200);
  assert.equal(((dflt.body.revenue as Record<string, unknown>).byDay as unknown[]).length, 30, "default: the last 30 days");
});

test("summary: cached 60 s per range; bad ranges 400; support lacks finance.view", { skip }, async () => {
  clearFinanceCache();
  const s = await session("finance");
  const first = await summary(s.cookie, "?from=2026-09-11&to=2026-09-11");
  await query(`UPDATE payment_orders SET amount_soum = amount_soum + 1 WHERE id = $1`, [seed.a1.id]);
  try {
    const again = await summary(s.cookie, "?from=2026-09-11&to=2026-09-11");
    assert.equal(again.body.generatedAt, first.body.generatedAt, "served from the cache");
    assert.deepEqual((again.body.revenue as Record<string, unknown>).total, { soum: 100_000, orders: 1 });
    const longer = await summary(s.cookie, "?from=2026-09-11&to=2026-09-12");
    assert.deepEqual(longer.body.range, { from: "2026-09-11", to: "2026-09-12", days: 2 }, "the cache key covers both ends of the range");
    assert.deepEqual((longer.body.revenue as Record<string, unknown>).total, { soum: 100_001, orders: 1 });
    clearFinanceCache();
    const fresh = await summary(s.cookie, "?from=2026-09-11&to=2026-09-11");
    assert.deepEqual((fresh.body.revenue as Record<string, unknown>).total, { soum: 100_001, orders: 1 });
  } finally {
    await query(`UPDATE payment_orders SET amount_soum = amount_soum - 1 WHERE id = $1`, [seed.a1.id]);
    clearFinanceCache();
  }

  for (const qs of ["?from=2026-13-01", "?from=2024-01-01&to=2026-01-01", "?from=2026-09-12&to=2026-09-10", "?from=2026-09-10&from=2026-09-11", "?to=yesterday"]) {
    const r = await summary(s.cookie, qs);
    assert.equal(r.status, 400, `MUTATSIYA: ${qs} → ${r.status}`);
  }
  const sup = await session("support");
  assert.equal((await summary(sup.cookie)).status, 403);
});

// ───────────────────────────── reconciliation

type Check = { id: string; title: string; severity: string; count: number | null; countCapped: boolean; sample: Array<Record<string, unknown>>; timedOut: boolean };

test("reconciliation: every check finds its seeded positive and none of its negatives", { skip }, async () => {
  const s = await session("owner");
  const r = await recon(s.cookie);
  assert.equal(r.status, 200, r.text);
  const checks = r.body.checks as Check[];
  assert.deepEqual(
    checks.map((c) => c.id),
    ["paid_without_ledger", "wallet_ledger_mismatch", "failed_unrefunded", "partial_refund_missing", "orders_pending_12h", "orders_created_24h"],
  );
  const by = Object.fromEntries(checks.map((c) => [c.id, c])) as Record<string, Check>;
  const sampleIds = (id: string) => by[id]!.sample.map((x) => x.id);
  for (const c of checks) {
    assert.equal(c.timedOut, false, c.id);
    assert.equal(c.countCapped, false, c.id);
    assert.ok(c.title.length > 5);
    assert.ok(["error", "warning", "info"].includes(c.severity));
  }

  assert.equal(by.paid_without_ledger!.count, 1);
  assert.deepEqual(sampleIds("paid_without_ledger"), [seed.legacy]);
  assert.deepEqual(Object.keys(by.paid_without_ledger!.sample[0]!).sort(), ["amountSoum", "createdAt", "credited", "id", "provider", "purpose", "state", "type", "userId", "userName"]);
  assert.equal(by.paid_without_ledger!.sample[0]!.type, "order");

  assert.equal(by.wallet_ledger_mismatch!.count, 1);
  assert.deepEqual(by.wallet_ledger_mismatch!.sample, [
    { type: "user", id: seed.mismatch, userName: "Hamyon Farqi", wallet: { points: 50, quota: 0, balance: 1_007 }, ledger: { points: 50, quota: 0, balance: 1_000 } },
  ]);

  assert.equal(by.failed_unrefunded!.count, 1);
  assert.deepEqual(sampleIds("failed_unrefunded"), [seed.g.G1]);
  const g1 = by.failed_unrefunded!.sample[0]!;
  assert.equal(g1.type, "generation");
  assert.equal(g1.userId, seed.ali);
  assert.equal(g1.toolId, "slide");
  assert.equal((g1 as { toolTitle?: string }).toolTitle, "Slayd", "the server resolves the Uzbek tool title; toolId is unchanged");
  assert.deepEqual(g1.charged, { points: 0, quota: 0, balance: 3_000 });

  assert.equal(by.partial_refund_missing!.count, 2);
  assert.deepEqual(new Set(sampleIds("partial_refund_missing")), new Set([seed.g.G3, seed.g.G8]));
  const g3 = by.partial_refund_missing!.sample.find((x) => x.id === seed.g.G3)!;
  assert.deepEqual(g3.delivered, { got: 3, want: 4 });
  assert.deepEqual(g3.charged, { points: 0, quota: 0, balance: 6_000 });

  assert.equal(by.orders_pending_12h!.count, 1);
  assert.deepEqual(sampleIds("orders_pending_12h"), [seed.p1]);
  assert.equal(by.orders_created_24h!.count, 1);
  assert.deepEqual(sampleIds("orders_created_24h"), [seed.c1]);
  assert.equal(r.body.walletRange, null);

  // Signup range narrows the wallet aggregate.
  const inRange = await recon(s.cookie, "?from=2026-09-12&to=2026-09-12");
  assert.equal((inRange.body.checks as Check[])[1]!.count, 1);
  assert.deepEqual(inRange.body.walletRange, { from: "2026-09-12", to: "2026-09-12" });
  const outside = await recon(s.cookie, "?from=2026-09-13&to=2026-09-13");
  assert.equal((outside.body.checks as Check[])[1]!.count, 0);
  assert.equal((outside.body.checks as Check[])[0]!.count, 1, "the range narrows only the wallet check");
});

test("reconciliation: a check that hits the statement timeout reports timedOut instead of failing", { skip }, async () => {
  const locker = await pool().connect();
  try {
    await locker.query("BEGIN");
    await locker.query("LOCK TABLE transactions IN ACCESS EXCLUSIVE MODE");
    const out = await runReconciliation(new URL("http://localhost/api/admin/finance/reconciliation"), { timeoutMs: 300 });
    const wallet = out.checks.find((c) => c.id === "wallet_ledger_mismatch")!;
    assert.equal(wallet.timedOut, true);
    assert.equal(wallet.count, null);
    assert.deepEqual(wallet.sample, []);
    assert.equal(out.checks.length, 6, "the other checks still report");
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
  }
  const ok = await runReconciliation(new URL("http://localhost/api/admin/finance/reconciliation"), { timeoutMs: 5_000 });
  assert.ok(ok.checks.every((c) => !c.timedOut));
});

test("reconciliation: bad range 400; support 403; viewer 200", { skip }, async () => {
  const s = await session("viewer");
  assert.equal((await recon(s.cookie)).status, 200);
  for (const qs of ["?from=nope", "?from=2024-01-01&to=2026-01-01", "?to=2026-01-01&to=2026-01-02"]) {
    assert.equal((await recon(s.cookie, qs)).status, 400, qs);
  }
  const sup = await session("support");
  assert.equal((await recon(sup.cookie)).status, 403);
});

// ───────────────────────────── global ledger

type Entry = { id: string; userId: string; userName: string | null; kind: string; points: number; quota: number; balance: number; reference: string | null; note: string | null; createdAt: string; link: unknown };

test("ledger: exact shape, per-wallet deltas, links resolved from references", { skip }, async () => {
  const s = await session("finance");
  const total = Number((await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM transactions`))!.n);
  const r = await ledger(s.cookie, "?limit=100");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.total, total);
  const items = r.body.items as Entry[];
  assert.deepEqual(Object.keys(items[0]!).sort(), ["balance", "createdAt", "id", "kind", "link", "note", "points", "quota", "reference", "userId", "userName"]);
  const byRef = (ref: string, kind?: string) => items.find((e) => e.reference === ref && (!kind || e.kind === kind))!;

  const g1 = byRef(seed.g.G1, "charge");
  assert.equal(g1.balance, -3_000);
  assert.equal(g1.userName, "Ali Valiyev");
  assert.deepEqual(g1.link, { type: "generation", id: seed.g.G1 });
  assert.deepEqual(byRef(seed.g.G4, "refund").link, { type: "generation", id: seed.g.G4 });
  assert.equal(byRef(seed.g.G4, "refund").balance, 1_000);
  assert.equal(byRef(seed.ghost, "charge").link, null, "no job row → no link");
  assert.deepEqual(byRef(`click:${seed.a1.txn}`).link, { type: "order", id: seed.a1.id });
  const sub = byRef(`payme:${seed.b1.txn}`);
  assert.equal(sub.kind, "subscription");
  assert.equal(sub.quota, LEGACY_PRO.quota);
  assert.equal(sub.balance, 0, "a pre-removal Pro credit is quota only");
  assert.deepEqual(sub.link, { type: "order", id: seed.b1.id });
  const clawback = byRef(`refund:${seed.clawbackRefundId}`);
  assert.equal(clawback.kind, "admin_debit");
  assert.equal(clawback.balance, -10_000);
  assert.deepEqual(clawback.link, { type: "order", id: seed.a1.id });
  assert.equal(byRef(`signup:${seed.mismatch}`).link, null);
});

test("ledger filters: kind (multi), userId, exact reference, date range; keyset paging", { skip }, async () => {
  const s = await session("viewer");
  const kinds = await ledger(s.cookie, "?kind=refund,admin_debit&limit=100");
  assert.deepEqual(new Set((kinds.body.items as Entry[]).map((e) => e.kind)), new Set(["refund", "admin_debit"]));
  assert.equal(kinds.body.total, 3);

  const user = await ledger(s.cookie, `?userId=${seed.mismatch}`);
  assert.deepEqual((user.body.items as Entry[]).map((e) => e.kind).sort(), ["bonus", "topup"]);

  const ref = await ledger(s.cookie, `?reference=${encodeURIComponent(`click:${seed.a1.txn}`)}`);
  assert.equal(ref.body.total, 1);
  assert.equal((ref.body.items as Entry[])[0]!.kind, "topup");
  assert.equal((await ledger(s.cookie, `?reference=${encodeURIComponent(`click:${seed.a1.txn.slice(0, 4)}`)}`)).body.total, 0, "exact only");
  assert.equal((await ledger(s.cookie, `?reference=${encodeURIComponent("%")}`)).body.total, 0);

  const day = await ledger(s.cookie, "?from=2026-09-12&to=2026-09-12&limit=100");
  const dayKinds = new Set((day.body.items as Entry[]).map((e) => e.kind));
  assert.deepEqual(dayKinds, new Set(["charge", "refund", "admin_debit"]));
  assert.equal(day.body.total, 8 + 2 + 1);

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const page: Res = await ledger(s.cookie, `?limit=4${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(page.status, 200, page.text);
    seen.push(...(page.body.items as Entry[]).map((e) => e.id));
    cursor = page.body.nextCursor as string | null;
    if (!cursor) break;
  }
  const total = Number((await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM transactions`))!.n);
  assert.equal(seen.length, total);
  assert.equal(new Set(seen).size, total);
});

test("ledger: bad params 400; support / moderator 403", { skip }, async () => {
  const s = await session("owner");
  for (const qs of [
    "?kind=charge,stolen",
    "?kind=CHARGE",
    "?sort=created_asc",
    "?userId=-1",
    "?userId=x",
    "?reference=a%00b",
    `?reference=${"r".repeat(201)}`,
    "?reference=a&reference=b",
    "?cursor=%27%20OR%201=1",
    `?cursor=${Buffer.from(JSON.stringify(["2026-09-12T06:00:00.000000", "1; DROP TABLE x"])).toString("base64url")}`,
    "?from=2026-02-29",
  ]) {
    const r = await ledger(s.cookie, qs);
    assert.equal(r.status, 400, `MUTATSIYA: ${qs} → ${r.status} ${r.text}`);
  }
  assert.equal((await ledger((await session("support")).cookie)).status, 403);
  assert.equal((await ledger((await session("moderator")).cookie)).status, 403);
});

test("ledger export: step-up, finance.export only; CSV header, links, formula escaping; audit row with meta.filters", { skip }, async () => {
  const stale = await session("finance", false);
  const reauth = await ledgerCsv(stale.cookie);
  assert.equal(reauth.status, 401);
  assert.equal(reauth.body.code, "reauth");
  assert.equal((await ledgerCsv((await session("viewer")).cookie)).status, 403, "viewer has finance.view but not finance.export");

  const s = await session("admin");
  const r = await ledgerCsv(s.cookie, `?userId=${seed.mismatch}&kind=bonus,topup`);
  assert.equal(r.status, 200, r.text);
  assert.match(String(r.headers.get("content-disposition")), /^attachment; filename="hisob-kitobi-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(r.text.charCodeAt(0), 0xfeff);
  const lines = r.text.slice(1).split("\r\n").filter(Boolean);
  assert.equal(lines[0], `"ID","Vaqt","Foydalanuvchi ID","Foydalanuvchi","Turi","Bonus ball","Kvota (eski)","Balans","Havola","Izoh","Bog'liq obyekt","Bog'liq obyekt ID"`);
  assert.equal(lines.length, 3);
  const bonus = lines.find((l) => l.includes(`"bonus"`))!;
  assert.ok(bonus.includes(`"'=1+1"`), `formula escaped: ${bonus}`);
  assert.ok(bonus.includes(`"50"`));

  const linked = await ledgerCsv(s.cookie, `?reference=${encodeURIComponent(`refund:${seed.clawbackRefundId}`)}`);
  const row = linked.text.slice(1).split("\r\n").filter(Boolean)[1]!;
  assert.ok(row.includes(`"-10000"`), row);
  assert.ok(row.endsWith(`"buyurtma","${seed.a1.id}"`), row);

  const audits = await query<{ action: string; meta: Record<string, unknown> }>(
    `SELECT action, meta FROM admin_audit_log WHERE admin_id = $1 ORDER BY id`,
    [s.adminId],
  );
  assert.deepEqual(audits.map((a) => a.action), ["export.transactions", "export.transactions"]);
  assert.deepEqual(audits[0]!.meta.filters, { sort: "created_desc", kind: ["bonus", "topup"], userId: seed.mismatch });
  assert.deepEqual(audits[1]!.meta.filters, { sort: "created_desc", reference: `refund:${seed.clawbackRefundId}` });
});

// ───────────────────────────── subscription removal: the quota merge (migration 034)

test("quota merge: the wallet ↔ ledger check reconciles all three columns across a quota_merge row; the ledger lists and filters it", { skip }, async () => {
  const owner = await session("owner");
  const u = await mkUser("Eski Pro Mijoz");
  // History before the removal: a paid Pro order (quota), a job charged from that quota, then the 034 merge.
  const order = await legacyProOrder(u.id, "click", tk(2026, 9, 1, 12));
  const job = randomUUID();
  assert.equal((await charge(u.id, 4_000, job, "Generatsiya")).ok, true);
  const before = await queryOne<{ quota: string; balance: string }>(`SELECT quota::text AS quota, balance::text AS balance FROM users WHERE id = $1`, [u.id]);
  assert.equal(Number(before!.quota), LEGACY_PRO.quota - 4_000, "the charge drained quota");
  const mergeId = await mergeQuota(u.id);
  const after = await queryOne<{ quota: string; balance: string }>(`SELECT quota::text AS quota, balance::text AS balance FROM users WHERE id = $1`, [u.id]);
  assert.deepEqual([Number(after!.quota), Number(after!.balance)], [0, Number(before!.balance) + LEGACY_PRO.quota - 4_000]);

  const mismatch = async () => ((await recon(owner.cookie)).body.checks as Check[]).find((c) => c.id === "wallet_ledger_mismatch")!;
  const clean = await mismatch();
  assert.equal(clean.count, 1, "only the seeded bypass write: the merged user reconciles");
  assert.ok(!clean.sample.some((x) => x.id === u.id));

  // MUTATSIYA (invariant): a merge row whose quota leg is off by one is caught although its balance leg matches,
  // so the check must compare the quota column too, not only the cash total.
  await query(`UPDATE transactions SET quota_delta = quota_delta + 1 WHERE id = $1`, [mergeId]);
  try {
    const broken = await mismatch();
    assert.equal(broken.count, 2);
    const hit = broken.sample.find((x) => x.id === u.id);
    assert.ok(hit, "the merged user is reported");
    assert.deepEqual(hit.wallet, { points: 0, quota: 0, balance: Number(after!.balance) });
    assert.deepEqual(hit.ledger, { points: 0, quota: 1, balance: Number(after!.balance) });
  } finally {
    await query(`UPDATE transactions SET quota_delta = quota_delta - 1 WHERE id = $1`, [mergeId]);
  }
  assert.equal((await mismatch()).count, 1);

  // The global ledger lists the row with both legs, filters by the new kind, and gives it no link.
  const rows = await ledger(owner.cookie, `?userId=${u.id}&limit=100`);
  assert.equal(rows.status, 200, rows.text);
  const items = rows.body.items as Entry[];
  assert.deepEqual(items.map((e) => e.kind).sort(), ["charge", "quota_merge", "subscription"]);
  const merge = items.find((e) => e.kind === "quota_merge")!;
  assert.deepEqual([merge.quota, merge.balance, merge.points], [-(LEGACY_PRO.quota - 4_000), LEGACY_PRO.quota - 4_000, 0]);
  assert.equal(merge.reference, `quota-merge:${u.id}`);
  assert.equal(merge.link, null);
  assert.deepEqual(items.find((e) => e.kind === "subscription")!.link, { type: "order", id: order.id }, "the legacy order link still resolves");
  const only = await ledger(owner.cookie, "?kind=quota_merge&limit=100");
  assert.equal(only.status, 200, `MUTATSIYA: quota_merge is a known kind → ${only.status} ${only.text}`);
  assert.deepEqual((only.body.items as Entry[]).map((e) => e.id), [mergeId]);

  // Not cash and not an admin adjustment: a range holding only the merge row sums to zero everywhere.
  await query(`UPDATE transactions SET created_at = '2026-08-20T06:00:00Z' WHERE id = $1`, [mergeId]);
  clearFinanceCache();
  const sum = await summary(owner.cookie, "?from=2026-08-20&to=2026-08-20");
  assert.equal(sum.status, 200, sum.text);
  assert.deepEqual(sum.body.cashSpend, { charges: 0, points: 0, quota: 0, balance: 0 });
  assert.deepEqual(sum.body.refunds, { count: 0, points: 0, quota: 0, balance: 0 });
  assert.deepEqual(sum.body.adjustments, { count: 0, points: 0, quota: 0, balance: 0 });
  clearFinanceCache();
});
