import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { allowPaynetProvider } from "./helpers/paynet-provider.mts";

/**
 * Paynet as a first-class provider in the admin panel (docs/payments/PAYNET.md «UI»), through the REAL routes
 * on a throwaway Postgres: a Paynet top-up is a normal paid `payment_orders` row (provider `paynet`, `provider_txn` =
 * Paynet's digit transactionId) settled by `settleOrder`, so every admin report must count it.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - ORDER_PROVIDERS without "paynet" (server list): `provider=paynet` → 400 → "list filter";
 *   - ('paynet', …) dropped from the digits branch of `orderFromWhere`: "search by transactionId" finds nothing;
 *   - `paynet` FILTER column dropped from the finance revenue SQL: "finance summary" sees paynet 0;
 *   - `paynet` FILTER column dropped from the metrics KPI / series SQL: "metrics" sees paynet 0;
 *   - SETTLE_REF_RE without paynet: the ledger row of a Paynet credit loses its order link ("ledger link").
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-paynet-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminpaynet") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { settleOrder } = await import("../lib/server/payments.ts");
const { recordPaymentEvent } = await import("../lib/server/payment-events.ts");
const { clearFinanceCache } = await import("../lib/server/admin-finance.ts");
const metrics = await import("../lib/server/admin-metrics.ts");
const listRoute = await import("../app/api/admin/orders/route.ts");
const exportRoute = await import("../app/api/admin/orders/export/route.ts");
const detailRoute = await import("../app/api/admin/orders/[id]/route.ts");
const summaryRoute = await import("../app/api/admin/finance/summary/route.ts");
const ledgerRoute = await import("../app/api/admin/transactions/route.ts");
const overviewRoute = await import("../app/api/admin/metrics/overview/route.ts");
const seriesRoute = await import("../app/api/admin/metrics/series/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) {
  await ensureMigrated();
  await allowPaynetProvider(async (sql, params) => ({ rows: (await query(sql, params)) as unknown as Array<Record<string, unknown>> }));
}

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name: string): Promise<{ id: string; token: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `pn_${randomBytes(5).toString("hex")}`, name],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, token };
}

async function session(role: Role): Promise<{ cookie: string; adminId: string }> {
  const u = await mkUser("Admin");
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.token)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: acc!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "paynet-test", reauth: true }),
  );
  return { cookie: `${SESSION_COOKIE}=${u.token}; ${adminCookieName()}=${s.token}`, adminId: acc!.id };
}

type Res = { status: number; body: Record<string, unknown>; text: string };
async function read(res: Response): Promise<Res> {
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text };
}

type GetRoute = { GET: (req: Request, ctx: never) => Promise<Response> };
async function call(route: GetRoute, path: string, cookie: string, ctx?: unknown): Promise<Res> {
  const req = new Request(`http://localhost:3000${path}`, { headers: { host: "localhost:3000", "x-forwarded-for": "10.1.4.9", "user-agent": "paynet-test", cookie } });
  return read(await inRequest(req, () => route.GET(req, ctx as never)));
}
const list = (cookie: string, qs = "") => call(listRoute, `/api/admin/orders${qs}`, cookie);
const ids = (r: Res) => (r.body.items as Array<{ id: string }>).map((x) => x.id);
const item = (r: Res, id: string) => (r.body.items as Array<Record<string, unknown>>).find((x) => x.id === id);

/**
 * What the Paynet endpoint writes for a successful PerformTransaction: a pending row with the transactionId
 * (create_time set), then the normal settle path (ledger reference `paynet:<transactionId>`).
 */
async function paynetOrder(uid: string, amount: number, txn: string, performTime: number): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state, provider_txn, create_time)
     VALUES ($1, $2, 'paynet', 'topup', $3, 'pending', $4, $5)`,
    [id, uid, amount, txn, performTime],
  );
  assert.equal((await settleOrder(id, performTime)).status, "paid");
  return id;
}

async function otherOrder(uid: string, provider: "click" | "payme", amount: number, txn: string, performTime: number): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state, provider_txn, create_time) VALUES ($1, $2, $3, 'topup', $4, 'pending', $5, $6)`,
    [id, uid, provider, amount, txn, performTime - 60_000],
  );
  assert.equal((await settleOrder(id, performTime)).status, "paid");
  return id;
}

/** UTC instant of a Tashkent wall-clock time on 2026-09-`d` (UTC+5, no DST). */
const tk = (d: number, h: number, mi = 0) => Date.UTC(2026, 8, d, h - 5, mi);
const P_TXN = String(randomInt(1_000_000_000, 9_999_999_999)); // Paynet transactionId (digit string)
const P2_TXN = String(randomInt(1_000_000_000, 9_999_999_999));
const CLICK_TXN = String(randomInt(100_000_000, 999_999_999));
const PAYME_TXN = randomBytes(12).toString("hex");
const seed = { ali: "", vali: "", p1: "", p2: "", clickSame: "", click: "", payme: "" };

before(async () => {
  if (!hasDb) return;
  const ali = await mkUser("Ali Valiyev");
  const vali = await mkUser("Vali Aliyev");
  seed.ali = ali.id;
  seed.vali = vali.id;
  seed.p1 = await paynetOrder(ali.id, 30_000, P_TXN, tk(11, 10));
  seed.p2 = await paynetOrder(vali.id, 12_000, P2_TXN, tk(12, 15));
  seed.click = await otherOrder(ali.id, "click", 20_000, CLICK_TXN, tk(11, 11));
  seed.payme = await otherOrder(vali.id, "payme", 7_000, PAYME_TXN, tk(12, 9));
  // A Click order whose txn has the SAME digits as the Paynet transactionId: the unique index is per provider.
  seed.clickSame = await otherOrder(ali.id, "click", 5_000, P_TXN, tk(10, 9));
  // The Paynet call log, written through the real recorder.
  await recordPaymentEvent({
    provider: "paynet",
    method: "PerformTransaction",
    orderId: seed.p1,
    providerTxn: P_TXN,
    payload: { params: { amount: 3_000_000, transactionId: P_TXN, fields: { client_id: seed.ali } }, password: "hunter2" },
    responseCode: 0,
  });
});

// ───────────────────────────── orders

test("list filter: provider=paynet returns only Paynet orders, with the exact row", { skip }, async () => {
  const s = await session("viewer");
  const r = await list(s.cookie, "?provider=paynet");
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(new Set(ids(r)), new Set([seed.p1, seed.p2]));
  assert.equal(r.body.total, 2);
  const row = item(r, seed.p1)!;
  assert.equal(row.provider, "paynet");
  assert.equal(row.purpose, "topup");
  assert.equal(row.state, "paid");
  assert.equal(row.amountSoum, 30_000);
  assert.equal(row.providerTxn, P_TXN);
  assert.equal(row.prepareId, null, "Paynet has no prepare id");
  assert.equal(row.credited, true, "the ledger row `paynet:<txn>` is matched to the order");
  assert.equal(row.performTime, new Date(tk(11, 10)).toISOString());

  assert.deepEqual(new Set(ids(await list(s.cookie, "?provider=click"))), new Set([seed.click, seed.clickSame]), "Click filter unchanged");
  assert.deepEqual(ids(await list(s.cookie, "?provider=payme")), [seed.payme], "Payme filter unchanged");
  assert.equal((await list(s.cookie, "?provider=paynetx")).status, 400, "an unknown provider is still a 400");
  assert.equal((await list(s.cookie)).body.total, 5);
});

test("search by transactionId: the digits find the Paynet order (and a Click order with the same digits); nothing partial", { skip }, async () => {
  const s = await session("viewer");
  assert.deepEqual(new Set(ids(await list(s.cookie, `?q=${P_TXN}`))), new Set([seed.p1, seed.clickSame]), "same digits under two providers → both");
  assert.deepEqual(ids(await list(s.cookie, `?q=${P2_TXN}`)), [seed.p2]);
  assert.deepEqual(ids(await list(s.cookie, `?provider=paynet&q=${P_TXN}`)), [seed.p1], "narrowed by provider");
  assert.deepEqual(ids(await list(s.cookie, `?q=${P2_TXN.slice(0, 8)}`)), [], "exact match only");
  assert.deepEqual(ids(await list(s.cookie, `?q=${CLICK_TXN}`)), [seed.click], "Click search unchanged");
  assert.deepEqual(ids(await list(s.cookie, `?q=${PAYME_TXN}`)), [seed.payme], "Payme search unchanged");
});

test("detail: Paynet order has settlement reference paynet:<txn>, redacted call log and the credit row", { skip }, async () => {
  const s = await session("support");
  const r = await call(detailRoute, `/api/admin/orders/${seed.p1}`, s.cookie, { params: Promise.resolve({ id: seed.p1 }) });
  assert.equal(r.status, 200, r.text);
  const order = r.body.order as Record<string, unknown>;
  assert.equal(order.provider, "paynet");
  assert.equal(order.settlementReference, `paynet:${P_TXN}`);
  assert.equal(order.credited, true);
  const events = r.body.events as Array<Record<string, unknown>>;
  assert.deepEqual(events.map((e) => [e.provider, e.method, e.providerTxn]), [["paynet", "PerformTransaction", P_TXN]]);
  assert.doesNotMatch(r.text, /hunter2/, "the Basic password never reaches the admin");
  const ledger = r.body.ledger as Array<Record<string, unknown>>;
  assert.ok(ledger.some((l) => l.kind === "topup"), "the top-up credit is listed on the order");
});

test("export: the CSV carries the provider code of Paynet orders and honours provider=paynet", { skip }, async () => {
  const s = await session("finance");
  const r = await call(exportRoute, "/api/admin/orders/export?provider=paynet", s.cookie);
  assert.equal(r.status, 200, r.text);
  const lines = r.text.slice(1).split("\r\n").filter(Boolean);
  assert.equal(lines.length - 1, 2, "header + the two Paynet orders");
  assert.ok(lines.slice(1).every((l) => l.includes('"paynet"')), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes(`"${P_TXN}"`)));
});

test("ledger link: the credit row `paynet:<txn>` opens its order", { skip }, async () => {
  const s = await session("finance");
  const r = await call(ledgerRoute, `/api/admin/transactions?reference=${encodeURIComponent(`paynet:${P_TXN}`)}`, s.cookie);
  assert.equal(r.status, 200, r.text);
  const items = r.body.items as Array<{ reference: string; kind: string; link: unknown }>;
  const credit = items.find((e) => e.reference === `paynet:${P_TXN}` && e.kind === "topup")!;
  assert.ok(credit, r.text);
  assert.deepEqual(credit.link, { type: "order", id: seed.p1 });
});

// ───────────────────────────── finance + metrics

test("finance summary: Paynet is its own revenue bucket; the provider buckets add up to the total", { skip }, async () => {
  clearFinanceCache();
  const s = await session("viewer");
  const r = await call(summaryRoute, "/api/admin/finance/summary?from=2026-09-10&to=2026-09-12", s.cookie);
  assert.equal(r.status, 200, r.text);
  const rev = r.body.revenue as { total: { soum: number; orders: number }; byProvider: Record<string, { soum: number; orders: number }>; byDay: Array<Record<string, unknown>> };
  assert.deepEqual(rev.byProvider, {
    click: { soum: 25_000, orders: 2 },
    payme: { soum: 7_000, orders: 1 },
    paynet: { soum: 42_000, orders: 2 },
  });
  assert.deepEqual(rev.total, { soum: 74_000, orders: 5 });
  assert.equal(Object.values(rev.byProvider).reduce((a, b) => a + b.soum, 0), rev.total.soum);
  assert.deepEqual(rev.byDay.map((d) => [d.day, d.click, d.payme, d.paynet]), [
    ["2026-09-10", 5_000, 0, 0],
    ["2026-09-11", 20_000, 0, 30_000],
    ["2026-09-12", 0, 7_000, 12_000],
  ]);
});

test("metrics: revenueSoum.paynet in the overview and `paynet` in the revenue series", { skip }, async () => {
  metrics.clearMetricsCache();
  const s = await session("viewer");
  const ov = await call(overviewRoute, "/api/admin/metrics/overview?from=2026-09-10&to=2026-09-12", s.cookie);
  assert.equal(ov.status, 200, ov.text);
  const cur = ov.body.current as { revenueSoum: Record<string, number>; paidOrders: number };
  assert.deepEqual(cur.revenueSoum, { total: 74_000, click: 25_000, payme: 7_000, paynet: 42_000, topup: 74_000, pro: 0 });
  assert.equal(cur.paidOrders, 5);

  const ser = await call(seriesRoute, "/api/admin/metrics/series?metric=revenue&from=2026-09-10&to=2026-09-12", s.cookie);
  assert.equal(ser.status, 200, ser.text);
  const pts = ser.body.points as Array<{ day: string; values: Record<string, number> }>;
  assert.deepEqual(pts.map((p) => [p.day, p.values.paynet, p.values.total]), [
    ["2026-09-10", 0, 5_000],
    ["2026-09-11", 30_000, 50_000],
    ["2026-09-12", 12_000, 19_000],
  ]);
  assert.equal(pts.reduce((a, p) => a + p.values.paynet, 0), cur.revenueSoum.paynet, "series and overview agree");
});
