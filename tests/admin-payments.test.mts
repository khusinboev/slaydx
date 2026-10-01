import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Orders for the admin panel through the REAL routes (docs/admin/02-plan.md
 * §6.6 rows `GET /orders`, `/orders/export`, `/orders/:id`; §6.0; §8) on a
 * throwaway Postgres. Paid orders are settled through `settleOrder`, events
 * written through `recordPaymentEvent`, the external refund through the F6
 * route, so every number below comes from production code paths.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - `CREDITED_SQL` kind CASE swapped (pro → topup): the `credited` test sees
 *     `false` for the settled Pro order;
 *   - `classifyOrderQuery` digits branch removed: `q=<prepare_id>` finds nothing;
 *   - `redactPayload` dropped in `getAdminOrder`: the raw `password` leaks;
 *   - `msToIso` returns the raw ms: the detail time assertions fail;
 *   - export audit row removed: the export audit assertion fails;
 *   - `o.state = ANY(...)` filter dropped: the state filter test sees other states.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-payments-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminpayments") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { settleOrder, cancelOrder, attachTransaction, PRO_PLAN } = await import("../lib/server/payments.ts");
const { recordPaymentEvent } = await import("../lib/server/payment-events.ts");
const { classifyOrderQuery, msToIso } = await import("../lib/server/admin-payments.ts");
const listRoute = await import("../app/api/admin/orders/route.ts");
const exportRoute = await import("../app/api/admin/orders/export/route.ts");
const detailRoute = await import("../app/api/admin/orders/[id]/route.ts");
const refundRoute = await import("../app/api/admin/orders/[id]/external-refund/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type Session = { cookie: string; adminId: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name = "Payments Test"): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `p_${randomBytes(5).toString("hex")}`, name],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function session(role: Role, reauth = true): Promise<Session> {
  const u = await mkUser("Admin");
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: acc!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "payments-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${u.userToken}; ${adminCookieName()}=${s.token}`, adminId: acc!.id };
}

type Res = { status: number; body: Record<string, unknown>; text: string; headers: Headers };

async function read(res: Response): Promise<Res> {
  // `ignoreBOM` keeps the CSV's BOM visible (`res.text()` would strip it).
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
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.9", "user-agent": "payments-test" };
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost:3000${path}`, { headers });
}

const list = async (cookie: string | null, qs = "") => {
  const req = get(`/api/admin/orders${qs}`, cookie);
  return read(await inRequest(req, () => listRoute.GET(req, undefined)));
};
const detail = async (cookie: string | null, id: string) => {
  const req = get(`/api/admin/orders/${encodeURIComponent(id)}`, cookie);
  return read(await inRequest(req, () => detailRoute.GET(req, { params: Promise.resolve({ id }) })));
};
const exportCsv = async (cookie: string | null, qs = "") => {
  const req = get(`/api/admin/orders/export${qs}`, cookie);
  return read(await inRequest(req, () => exportRoute.GET(req, undefined)));
};

type OrderOpts = { provider: "click" | "payme"; purpose: "topup" | "pro"; amount?: number };

/** created: no provider transaction yet. */
async function createdOrder(uid: string, o: OrderOpts): Promise<string> {
  const id = randomUUID();
  await query(`INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum) VALUES ($1, $2, $3, $4, $5)`, [
    id,
    uid,
    o.provider,
    o.purpose,
    o.purpose === "pro" ? PRO_PLAN.priceSoum : (o.amount ?? 10_000),
  ]);
  return id;
}

/** pending: attached through the real `attachTransaction` (sets create_time and prepare_id). */
async function pendingOrder(uid: string, o: OrderOpts, txn: string, createTime: number): Promise<string> {
  const id = await createdOrder(uid, o);
  assert.equal(await attachTransaction(id, txn, createTime), true);
  return id;
}

/** paid: settled through the real `settleOrder` (ledger credit + state in one transaction). */
async function paidOrder(uid: string, o: OrderOpts, txn: string, createTime: number, performTime: number): Promise<string> {
  const id = await pendingOrder(uid, o, txn, createTime);
  const out = await settleOrder(id, performTime);
  assert.equal(out.status, "paid");
  return id;
}

// Seeded once, shared by the read-only tests below.
const T0 = Date.UTC(2026, 8, 20, 6, 0, 0); // 20.09.2026 11:00 Tashkent
const seed = {
  ali: "" as string,
  vali: "" as string,
  paidClickTopup: "" as string,
  paidPaymeTopup: "" as string,
  paidClickPro: "" as string,
  paidPaymePro: "" as string,
  pendingPayme: "" as string,
  pendingClick: "" as string,
  createdClick: "" as string,
  cancelledPayme: "" as string,
  paidNoLedger: "" as string,
  oldOrder: "" as string,
  clickTxn: String(randomInt(100_000_000, 999_999_999)),
  paymeTxn: randomBytes(12).toString("hex"),
  prepareId: "" as string,
  refundId: "" as string,
  all: [] as string[],
};

before(async () => {
  if (!hasDb) return;
  const ali = await mkUser("Ali Valiyev");
  const vali = await mkUser("=HYPERLINK(\"http://evil\")");
  seed.ali = ali.id;
  seed.vali = vali.id;
  seed.paidClickTopup = await paidOrder(ali.id, { provider: "click", purpose: "topup", amount: 20_000 }, seed.clickTxn, T0, T0 + 90_000);
  seed.paidPaymeTopup = await paidOrder(ali.id, { provider: "payme", purpose: "topup", amount: 50_000 }, seed.paymeTxn, T0 + 1000, T0 + 61_000);
  seed.paidClickPro = await paidOrder(vali.id, { provider: "click", purpose: "pro" }, String(randomInt(100_000_000, 999_999_999)), T0, T0 + 5_000);
  seed.paidPaymePro = await paidOrder(vali.id, { provider: "payme", purpose: "pro" }, randomBytes(12).toString("hex"), T0, T0 + 7_000);
  seed.pendingPayme = await pendingOrder(ali.id, { provider: "payme", purpose: "topup", amount: 7_000 }, randomBytes(12).toString("hex"), T0 + 2000);
  seed.pendingClick = await pendingOrder(vali.id, { provider: "click", purpose: "topup", amount: 8_000 }, String(randomInt(100_000_000, 999_999_999)), T0 + 3000);
  seed.createdClick = await createdOrder(ali.id, { provider: "click", purpose: "topup", amount: 9_000 });
  seed.cancelledPayme = await pendingOrder(vali.id, { provider: "payme", purpose: "pro" }, randomBytes(12).toString("hex"), T0 + 4000);
  assert.equal((await cancelOrder(seed.cancelledPayme, T0 + 9_000, 4)).status, "cancelled");
  // A paid order whose credit never reached the ledger (what reconciliation must catch).
  seed.paidNoLedger = await createdOrder(vali.id, { provider: "payme", purpose: "topup", amount: 11_000 });
  await query(`UPDATE payment_orders SET state = 'paid', perform_time = $2 WHERE id = $1`, [seed.paidNoLedger, T0]);
  // An old order for the date-range filter.
  seed.oldOrder = await createdOrder(ali.id, { provider: "click", purpose: "topup", amount: 6_000 });
  await query(`UPDATE payment_orders SET created_at = '2025-01-15T08:00:00Z' WHERE id = $1`, [seed.oldOrder]);
  seed.prepareId = (await queryOne<{ p: string }>(`SELECT prepare_id::text AS p FROM payment_orders WHERE id = $1`, [seed.pendingClick]))!.p;

  // Webhook trail of the Click top-up, written through the real recorder (redacts sign_string).
  await recordPaymentEvent({
    provider: "click",
    method: "prepare",
    orderId: seed.paidClickTopup,
    providerTxn: seed.clickTxn,
    payload: { click_trans_id: seed.clickTxn, merchant_trans_id: seed.paidClickTopup, amount: "20000", action: "0", sign_string: "deadbeef" },
    responseCode: 0,
  });
  await recordPaymentEvent({
    provider: "click",
    method: "complete",
    orderId: seed.paidClickTopup,
    providerTxn: seed.clickTxn,
    payload: { click_trans_id: seed.clickTxn, merchant_trans_id: seed.paidClickTopup, amount: "20000", action: "1", sign_string: "cafebabe" },
    responseCode: 0,
  });
  // A legacy row stored WITHOUT redaction: the admin API must still never show the secret.
  await query(`INSERT INTO payment_events (provider, method, order_id, provider_txn, payload, response_code) VALUES ('click', 'legacy', $1, $2, $3::jsonb, -1)`, [
    seed.paidClickTopup,
    seed.clickTxn,
    JSON.stringify({ password: "hunter2", nested: { secret_key: "abc" }, ok: "<script>x</script>" }),
  ]);

  // External refund (5 000 of 20 000) with clawback, through the F6 route.
  const fin = await session("finance");
  const req = new Request(`http://localhost:3000/api/admin/orders/${seed.paidClickTopup}/external-refund`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-forwarded-for": "10.1.2.9",
      cookie: fin.cookie,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ kind: "refund", amountSoum: 5_000, reason: "Click orqali qaytarildi", clawback: true }),
  });
  const r = await read(await inRequest(req, () => refundRoute.POST(req, { params: Promise.resolve({ id: seed.paidClickTopup }) })));
  assert.equal(r.status, 201, r.text);
  seed.refundId = String((r.body.refund as Record<string, unknown>).id);

  seed.all = [
    seed.paidClickTopup,
    seed.paidPaymeTopup,
    seed.paidClickPro,
    seed.paidPaymePro,
    seed.pendingPayme,
    seed.pendingClick,
    seed.createdClick,
    seed.cancelledPayme,
    seed.paidNoLedger,
    seed.oldOrder,
  ];
});

const ids = (r: Res) => (r.body.items as Array<{ id: string }>).map((x) => x.id);
const item = (r: Res, id: string) => (r.body.items as Array<Record<string, unknown>>).find((x) => x.id === id);

// ───────────────────────────── unit

test("classifyOrderQuery: uuid → id, digits → number, else txn; blank → null; NUL / overlong → 400", () => {
  const u = randomUUID();
  assert.deepEqual(classifyOrderQuery(u.toUpperCase()), { kind: "id", value: u });
  assert.deepEqual(classifyOrderQuery(" 1042 "), { kind: "number", value: "1042" });
  assert.deepEqual(classifyOrderQuery("6512f1e0a3b4c5d6e7f80912"), { kind: "txn", value: "6512f1e0a3b4c5d6e7f80912" });
  assert.deepEqual(classifyOrderQuery("1".repeat(19)), { kind: "txn", value: "1".repeat(19) }, "too long for a bigint: exact txn only");
  assert.equal(classifyOrderQuery(null), null);
  assert.equal(classifyOrderQuery("   "), null);
  assert.throws(() => classifyOrderQuery("a\0b"), (e: { status: number }) => e.status === 400);
  assert.throws(() => classifyOrderQuery("x".repeat(201)), (e: { status: number }) => e.status === 400);
});

test("msToIso: epoch ms → ISO; 0 / junk → null", () => {
  assert.equal(msToIso("1758348000000"), new Date(1758348000000).toISOString());
  assert.equal(msToIso(0), null);
  assert.equal(msToIso("0"), null);
  assert.equal(msToIso("abc"), null);
  assert.equal(msToIso(null), null);
});

// ───────────────────────────── list

test("list: 200 with the exact row shape, newest first, credited / externalRefunds / provider times", { skip }, async () => {
  const s = await session("finance");
  const r = await list(s.cookie, "?limit=100");
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["items", "nextCursor", "total", "totalCapped"]);
  assert.equal(r.body.total, seed.all.length);
  assert.equal(r.body.totalCapped, false);
  assert.equal(r.body.nextCursor, null);
  assert.deepEqual(new Set(ids(r)), new Set(seed.all));
  assert.equal(ids(r).at(-1), seed.oldOrder, "created_desc: the 2025 order is last");

  const row = item(r, seed.paidClickTopup)!;
  assert.deepEqual(Object.keys(row).sort(), [
    "amountSoum", "cancelReason", "cancelTime", "createTime", "createdAt", "credited", "externalRefunds", "id",
    "performTime", "prepareId", "provider", "providerTxn", "purpose", "state", "userId", "userName",
  ]);
  assert.equal(row.userId, seed.ali);
  assert.equal(row.userName, "Ali Valiyev");
  assert.equal(row.provider, "click");
  assert.equal(row.purpose, "topup");
  assert.equal(row.amountSoum, 20_000);
  assert.equal(row.state, "paid");
  assert.equal(row.providerTxn, seed.clickTxn);
  assert.equal(row.createTime, new Date(T0).toISOString());
  assert.equal(row.performTime, new Date(T0 + 90_000).toISOString());
  assert.equal(row.cancelTime, null);
  assert.equal(row.credited, true);
  assert.equal(row.externalRefunds, 1);
  assert.match(String(row.prepareId), /^\d+$/);

  for (const id of [seed.paidPaymeTopup, seed.paidClickPro, seed.paidPaymePro]) assert.equal(item(r, id)!.credited, true, `credited ${id}`);
  assert.equal(item(r, seed.paidNoLedger)!.credited, false, "paid without a ledger row");
  assert.equal(item(r, seed.pendingPayme)!.credited, false);
  const cancelled = item(r, seed.cancelledPayme)!;
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.cancelTime, new Date(T0 + 9_000).toISOString());
  assert.equal(cancelled.cancelReason, 4);
  const created = item(r, seed.createdClick)!;
  assert.equal(created.createTime, null);
  assert.equal(created.prepareId, null);
  assert.equal(created.providerTxn, null);
});

test("list filters: state (multi), provider, purpose, userId, date range, exact q", { skip }, async () => {
  const s = await session("viewer");
  const states = await list(s.cookie, "?state=pending,cancelled");
  assert.equal(states.status, 200, states.text);
  assert.deepEqual(new Set(ids(states)), new Set([seed.pendingPayme, seed.pendingClick, seed.cancelledPayme]));
  assert.equal(states.body.total, 3);

  const payme = await list(s.cookie, "?provider=payme&purpose=pro");
  assert.deepEqual(new Set(ids(payme)), new Set([seed.paidPaymePro, seed.cancelledPayme]));

  const user = await list(s.cookie, `?userId=${seed.ali}&state=paid`);
  assert.deepEqual(new Set(ids(user)), new Set([seed.paidClickTopup, seed.paidPaymeTopup]));

  const old = await list(s.cookie, "?from=2025-01-15&to=2025-01-15");
  assert.deepEqual(ids(old), [seed.oldOrder], "Tashkent day of 2025-01-15 08:00Z");
  const none = await list(s.cookie, "?from=2025-01-16&to=2025-01-20");
  assert.deepEqual(ids(none), []);
  assert.equal(none.body.total, 0);

  assert.deepEqual(ids(await list(s.cookie, `?q=${seed.paidPaymeTopup.toUpperCase()}`)), [seed.paidPaymeTopup], "uuid, any case");
  assert.deepEqual(ids(await list(s.cookie, `?q=${seed.clickTxn}`)), [seed.paidClickTopup], "numeric Click txn");
  assert.deepEqual(ids(await list(s.cookie, `?q=${seed.paymeTxn}`)), [seed.paidPaymeTopup], "Payme txn");
  assert.deepEqual(ids(await list(s.cookie, `?q=${seed.prepareId}`)), [seed.pendingClick], "prepare_id");
  assert.deepEqual(ids(await list(s.cookie, `?q=${seed.paymeTxn.slice(0, 10)}`)), [], "exact only, never a prefix/substring scan");
  assert.deepEqual(ids(await list(s.cookie, `?q=${encodeURIComponent("%")}`)), [], "LIKE metacharacters mean nothing");
});

test("list sort and keyset paging: amount_desc, limit=3 walks every row exactly once", { skip }, async () => {
  const s = await session("support");
  const byAmount = await list(s.cookie, "?sort=amount_desc&limit=100");
  assert.equal(byAmount.status, 200, byAmount.text);
  const amounts = (byAmount.body.items as Array<{ amountSoum: number }>).map((x) => x.amountSoum);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
  assert.equal(amounts[0], 50_000);

  for (const sort of ["created_desc", "amount_desc"]) {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const r: Res = await list(s.cookie, `?sort=${sort}&limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.total, seed.all.length, "total ignores the cursor");
      seen.push(...ids(r));
      cursor = r.body.nextCursor as string | null;
      if (!cursor) break;
    }
    assert.equal(seen.length, seed.all.length, `${sort}: no row twice, none skipped`);
    assert.deepEqual(new Set(seen), new Set(seed.all));
  }
});

test("list: bad params → 400 (never 500), injection attempts included", { skip }, async () => {
  const s = await session("owner");
  for (const qs of [
    "?state=paid,hacked",
    "?state=PAID",
    "?provider=uzcard",
    "?purpose=gift",
    "?sort=amount_asc",
    "?sort=created_desc;DROP%20TABLE%20users",
    "?sort=constructor",
    "?limit=0",
    "?limit=101",
    "?limit=1e2",
    "?cursor=not-a-cursor",
    `?cursor=${Buffer.from(JSON.stringify(["x' OR 1=1 --", "1"])).toString("base64url")}`,
    "?from=2026-02-30",
    "?from=2024-01-01&to=2026-01-01",
    "?to=2026-01-01&from=2026-02-01",
    "?userId=abc",
    "?userId=1%20OR%201=1",
    "?q=a%00b",
    "?q=a&q=b",
    `?q=${"x".repeat(201)}`,
  ]) {
    const r = await list(s.cookie, qs);
    assert.equal(r.status, 400, `MUTATSIYA: ${qs} → ${r.status} ${r.text}`);
    assert.equal(typeof r.body.error, "string");
  }
  const stillThere = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM users`);
  assert.ok(Number(stillThere!.n) > 0);
});

test("list guard: moderator 403 with a denied audit row; plain user 404; no session 404", { skip }, async () => {
  const mod = await session("moderator");
  const r = await list(mod.cookie);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "forbidden");
  const denied = await query<{ outcome: string; meta: Record<string, unknown> }>(
    `SELECT outcome, meta FROM admin_audit_log WHERE admin_id = $1 AND action = 'auth.denied'`,
    [mod.adminId],
  );
  assert.equal(denied.length, 1);
  assert.equal(denied[0].meta.permission, "payments.view");

  const plain = await mkUser();
  assert.equal((await list(`${SESSION_COOKIE}=${plain.userToken}`)).status, 404);
  assert.equal((await list(null)).status, 404);
});

// ───────────────────────────── detail

test("detail: order with ms times converted, redacted webhook timeline, credit + clawback ledger rows, recorded refund", { skip }, async () => {
  const s = await session("support");
  const r = await detail(s.cookie, seed.paidClickTopup);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["events", "eventsCapped", "ledger", "order", "refunds"]);

  const order = r.body.order as Record<string, unknown>;
  assert.equal(order.id, seed.paidClickTopup);
  assert.equal(order.userName, "Ali Valiyev");
  assert.match(String(order.userUsername), /^p_/);
  assert.equal(order.createTime, new Date(T0).toISOString());
  assert.equal(order.performTime, new Date(T0 + 90_000).toISOString());
  assert.equal(order.settlementReference, `click:${seed.clickTxn}`);
  assert.equal(order.recordedSoum, 5_000);
  assert.equal(order.remainingSoum, 15_000);
  assert.equal(order.credited, true);
  assert.equal(order.externalRefunds, 1);

  const events = r.body.events as Array<Record<string, unknown>>;
  assert.deepEqual(events.map((e) => e.method), ["prepare", "complete", "legacy"]);
  assert.equal(r.body.eventsCapped, false);
  assert.deepEqual(Object.keys(events[0]).sort(), ["id", "method", "payload", "provider", "providerTxn", "receivedAt", "responseCode"]);
  assert.equal((events[0].payload as Record<string, unknown>).sign_string, "[REDACTED]");
  assert.equal(events[2].responseCode, -1);
  assert.doesNotMatch(r.text, /hunter2|"abc"|deadbeef|cafebabe/, "no secret in the response, even from an unredacted legacy row");
  assert.equal(((events[2].payload as Record<string, unknown>).nested as Record<string, unknown>).secret_key, "[REDACTED]");
  assert.equal((events[2].payload as Record<string, unknown>).ok, "<script>x</script>", "data is returned as text; the UI escapes it");

  const ledger = r.body.ledger as Array<Record<string, unknown>>;
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].role, "credit");
  assert.equal(ledger[0].kind, "topup");
  assert.equal(ledger[0].balance, 20_000);
  assert.equal(ledger[0].reference, `click:${seed.clickTxn}`);
  assert.deepEqual(ledger[0].link, { type: "order", id: seed.paidClickTopup });
  assert.equal(ledger[1].role, "clawback");
  assert.equal(ledger[1].kind, "admin_debit");
  assert.equal(ledger[1].balance, -5_000);
  assert.equal(ledger[1].reference, `refund:${seed.refundId}`);

  const refunds = r.body.refunds as Array<Record<string, unknown>>;
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].id, seed.refundId);
  assert.equal(refunds[0].amountSoum, 5_000);
  assert.equal(refunds[0].kind, "refund");
  assert.equal(refunds[0].clawbackWallet, "balance");
  assert.equal(refunds[0].clawbackAmount, 5_000);
  assert.equal(refunds[0].shortfall, 0);
  assert.equal(refunds[0].createdByName, "Admin");

  // A Pro order: the credit row is the `subscription` quota row.
  const pro = await detail(s.cookie, seed.paidPaymePro);
  const proLedger = pro.body.ledger as Array<Record<string, unknown>>;
  assert.equal(proLedger.length, 1);
  assert.equal(proLedger[0].kind, "subscription");
  assert.equal(proLedger[0].quota, PRO_PLAN.quota);
  assert.deepEqual(pro.body.events, []);

  // Created order: nothing attached yet.
  const created = await detail(s.cookie, seed.createdClick);
  assert.equal((created.body.order as Record<string, unknown>).performTime, null);
  assert.deepEqual(created.body.ledger, []);
  assert.deepEqual(created.body.refunds, []);
});

test("detail: unknown or malformed id → 404 not_found (never 500); moderator 403", { skip }, async () => {
  const s = await session("viewer");
  for (const id of [randomUUID(), "abc", "1' OR '1'='1", `${randomUUID()}x`, "%00"]) {
    const r = await detail(s.cookie, id);
    assert.equal(r.status, 404, `MUTATSIYA: ${id} → ${r.status}`);
    assert.equal(r.body.code, "not_found");
  }
  const mod = await session("moderator");
  assert.equal((await detail(mod.cookie, seed.paidClickTopup)).status, 403);
});

// ───────────────────────────── export

test("export: step-up required, finance-only; CSV with BOM, header, filters, formula escaping, one audit row with meta.filters", { skip }, async () => {
  const stale = await session("finance", false);
  const reauth = await exportCsv(stale.cookie);
  assert.equal(reauth.status, 401);
  assert.equal(reauth.body.code, "reauth");
  const viewer = await session("viewer");
  assert.equal((await exportCsv(viewer.cookie)).status, 403, "viewer has payments.view but not payments.export");
  const support = await session("support");
  assert.equal((await exportCsv(support.cookie)).status, 403);

  const s = await session("finance");
  const r = await exportCsv(s.cookie, "?state=paid&sort=amount_desc");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(String(r.headers.get("content-disposition")), /^attachment; filename="buyurtmalar-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.text.charCodeAt(0), 0xfeff, "BOM");
  const lines = r.text.slice(1).split("\r\n").filter(Boolean);
  assert.equal(lines[0], `"Buyurtma ID","Foydalanuvchi ID","Foydalanuvchi","Provayder","Maqsad","Summa (so'm)","Holat","Provayder tranzaksiyasi","Prepare ID","Yaratilgan","Provayderda yaratilgan","To'langan","Bekor qilingan","Bekor qilish sababi","Hisobga yozilgan","Tashqi qaytarishlar"`);
  assert.equal(lines.length - 1, 5, "the 5 paid orders only");
  assert.ok(lines[1].startsWith(`"${seed.paidPaymeTopup}"`), "amount_desc: 50 000 first");
  const proRow = lines.find((l) => l.startsWith(`"${seed.paidClickPro}"`))!;
  assert.ok(proRow.includes(`"'=HYPERLINK(""http://evil"")"`), `formula injection escaped: ${proRow}`);
  const clickRow = lines.find((l) => l.startsWith(`"${seed.paidClickTopup}"`))!;
  assert.ok(clickRow.includes(`"20.09.2026 11:01"`), `perform time in Tashkent: ${clickRow}`);
  assert.ok(clickRow.includes(`"ha"`));
  const noLedger = lines.find((l) => l.startsWith(`"${seed.paidNoLedger}"`))!;
  assert.ok(noLedger.includes(`"yo'q"`));

  const audits = await query<{ action: string; outcome: string; target_type: string | null; meta: Record<string, unknown> }>(
    `SELECT action, outcome, target_type, meta FROM admin_audit_log WHERE admin_id = $1 ORDER BY id`,
    [s.adminId],
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "export.orders");
  assert.equal(audits[0].outcome, "ok");
  assert.deepEqual(audits[0].meta.filters, { sort: "amount_desc", state: ["paid"] });

  const bad = await exportCsv(s.cookie, "?state=nope");
  assert.equal(bad.status, 400);
  const after = await query(`SELECT 1 FROM admin_audit_log WHERE admin_id = $1`, [s.adminId]);
  assert.equal(after.length, 1, "a rejected export writes no audit row");
});
