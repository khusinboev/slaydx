import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Click DIRECT methods: `POST /api/payments/click/card`, `/card/verify`, `/invoice` and the `method`
 * field of `POST /api/payments/orders` -- the REAL routes against an isolated Postgres database with
 * `fetch` mocked for api.click.uz (and a mock "Click" that, like the real one, calls OUR Shop API
 * Prepare + Complete route when a payment is made).
 *
 * Invariants locked here:
 *   - ownership is enforced in SQL: a foreign / missing order answers 404 and Click is never called;
 *   - only a Click order that is `created` / `pending` can be paid (paid / cancelled = 409, Payme = 400);
 *   - input is validated on the SERVER (card prefix / length / expiry, phone, SMS code) before Click;
 *   - the amount sent to Click is the ORDER's amount, never a client field;
 *   - caps: card request, SMS attempts (5 / order), invoice per order / per target phone;
 *   - the one-time card token is stored between "SMS sent" and "payment submitted", claimed atomically
 *     (two concurrent confirms -> ONE payment) and cleared on paid / cancelled / stale;
 *   - an unknown outcome (timeout) answers `pending`, never "failed";
 *   - money is credited ONLY by the Shop API Complete: invoice or card payment -> Prepare + Complete ->
 *     credited exactly once + the 10 % payment bonus, replays answer -4 and add nothing;
 *   - no log line contains the card number, expiry or SMS code.
 *
 * Mutations (each verified red): ownership `AND user_id = $2` removed from `loadPayableOrder` ("ownership");
 * the token claim removed ("two concurrent confirms"); amount taken from the body ("amount comes from the
 * order"); `MIN_TOPUP_SOUM` back to 5 000 (payments-checkout "limits").
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://app.example.test";
process.env.CLICK_SERVICE_ID = "777";
process.env.CLICK_MERCHANT_ID = "42";
process.env.CLICK_SECRET_KEY = "click-secret-key";
process.env.CLICK_MERCHANT_USER_ID = "55";
delete process.env.PAYME_MERCHANT_ID;
delete process.env.PAYME_KEY;
delete process.env.PAYME_TEST_KEY;

const SKIP = hasDb ? false : "DATABASE_URL yo'q";
const iso = hasDb ? await createIsolatedDb("clickdirect") : { isolated: false, drop: async () => {} };

const CARD = "8600123412341234";
const CARD_SPACED = "8600 1234 1234 1234";
const EXPIRE = "12/99";
const SMS = "482915";
const PHONE = "+998 90 123 45 67"; // validation-only: sends that REACH the per-phone cap use fresh() below
let phoneSeq = 0;
/** A unique synthetic subscriber so the 5-per-phone-per-day cap never couples tests. */
const fresh = () => `+998 77 ${String(1_000_000 + ++phoneSeq)}`;
const SECRET = "click-secret-key";

type Api = { path: string; body: Record<string, unknown> };
type Json = Record<string, unknown>;

test("Click direct: card + invoice routes, caps, token handling, Shop API settlement", { skip: SKIP }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { createOrder, settleOrder, cancelOrder, purgeStaleCardTokens } = await import("../lib/server/payments.ts");
  const ordersRoute = await import("../app/api/payments/orders/route.ts");
  const cardRoute = await import("../app/api/payments/click/card/route.ts");
  const verifyRoute = await import("../app/api/payments/click/card/verify/route.ts");
  const invoiceRoute = await import("../app/api/payments/click/invoice/route.ts");
  const shop = await import("../app/api/payments/click/route.ts");
  const { env } = await import("../lib/server/env.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  // ───────────────────────── helpers

  let userSeq = 0;
  const mkUser = async () => {
    const r = await query<{ id: string }>(
      `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`,
      [`cd-${Date.now()}-${++userSeq}`],
    );
    return String(r[0].id);
  };
  const mkOrder = async (uid: string, amountSoum = 25_000, provider: "click" | "payme" = "click") =>
    createOrder({ userId: uid, provider, purpose: "topup", amountSoum });
  const post = async (route: { POST: (req: Request) => Promise<Response> }, path: string, uid: string | null, body: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (uid) headers.cookie = `${SESSION_COOKIE}=${(await createSession(uid)).token}`;
    const req = new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const res = await inRequest(req, () => route.POST(req));
    return { res, json: (await res.json()) as Json };
  };
  const card = (uid: string | null, body: unknown) => post(cardRoute, "/api/payments/click/card", uid, body);
  const verify = (uid: string | null, body: unknown) => post(verifyRoute, "/api/payments/click/card/verify", uid, body);
  const invoice = (uid: string | null, body: unknown) => post(invoiceRoute, "/api/payments/click/invoice", uid, body);

  const md5 = (s: string) => createHash("md5").update(s).digest("hex");
  let transSeq = 0;
  /** What Click does after a successful payment: Shop API Prepare then Complete. Returns both replies. */
  const clickSettles = async (orderId: string, amount: number) => {
    const call = async (p: Record<string, string>) => {
      const full: Record<string, string> = { service_id: "777", sign_time: "2026-10-09 10:00:00", error: "0", ...p };
      const sign_string = md5(
        full.click_trans_id + full.service_id + SECRET + full.merchant_trans_id + (full.action === "1" ? (full.merchant_prepare_id ?? "") : "") + full.amount + full.action + full.sign_time,
      );
      const res = await shop.POST(
        new Request("http://x/api/payments/click", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ...full, sign_string }).toString(),
        }),
      );
      return (await res.json()) as { error: number; error_note: string; merchant_prepare_id?: number };
    };
    const base = { click_trans_id: String(930_000 + ++transSeq), merchant_trans_id: orderId, amount: `${amount}.00` };
    const prepared = await call({ ...base, action: "0" });
    assert.equal(prepared.error, 0, prepared.error_note);
    const done = await call({ ...base, action: "1", merchant_prepare_id: String(prepared.merchant_prepare_id) });
    return { prepared, done, again: () => call({ ...base, action: "1", merchant_prepare_id: String(prepared.merchant_prepare_id) }) };
  };

  // Mock api.click.uz. Each test replaces `behave` entries; every request is recorded in `calls`.
  type Behave = (body: Json, call: Api) => Promise<{ status?: number; body?: unknown } | "throw"> | { status?: number; body?: unknown } | "throw";
  let calls: Api[] = [];
  let behave: Record<string, Behave> = {};
  let tokenSeq = 0;
  const defaults: Record<string, Behave> = {
    "/card_token/request": () => ({ body: { error_code: 0, error_note: "", card_token: `TOK-${++tokenSeq}`, phone_number: "+998*******67", temporary: true } }),
    "/card_token/verify": (b) =>
      b.sms_code === "000000"
        ? { body: { error_code: -402, error_note: "Wrong SMS code" } }
        : { body: { error_code: 0, error_note: "Success", card_number: "8600 12** **** 1234" } },
    "/card_token/payment": async (b) => {
      await clickSettles(String(b.transaction_parameter), Number(b.amount));
      return { body: { error_code: 0, error_note: "Success", payment_id: 598761234, payment_status: 2 } };
    },
    "/invoice/create": () => ({ body: { error_code: 0, error_note: "Success", invoice_id: 777001 } }),
  };
  const lines: string[] = [];
  const arm = (tc: TestContext) => {
    calls = [];
    lines.length = 0;
    behave = { ...defaults };
    for (const m of ["log", "info", "warn", "error"] as const) tc.mock.method(console, m, (...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    tc.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      const path = String(url).replace("https://api.click.uz/v2/merchant", "");
      const body = init.body ? (JSON.parse(String(init.body)) as Json) : {};
      calls.push({ path, body });
      const h = behave[path];
      assert.ok(h, `unexpected Click call ${path}`);
      const out = await h(body, { path, body });
      if (out === "throw") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200 });
    });
  };
  const row = async (id: string) =>
    (await queryOne<{
      state: string;
      click_method: string | null;
      click_card_token: string | null;
      click_invoice_id: string | null;
      click_payment_id: string | null;
    }>(`SELECT state, click_method, click_card_token, click_invoice_id, click_payment_id FROM payment_orders WHERE id = $1`, [id]))!;
  const wallet = async (uid: string) =>
    (await query<{ points: string; balance: string }>(`SELECT points, balance FROM users WHERE id = $1`, [uid])).map((r) => ({
      points: Number(r.points),
      balance: Number(r.balance),
    }))[0];
  const ledger = async (uid: string) =>
    (await query<{ kind: string; points_delta: string; balance_delta: string }>(
      `SELECT kind, points_delta, balance_delta FROM transactions WHERE user_id = $1 ORDER BY id`,
      [uid],
    )).map((r) => ({ kind: r.kind, points: Number(r.points_delta), balance: Number(r.balance_delta) }));

  // ───────────────────────── ownership / state

  await t.test("ownership: a foreign, missing or malformed order is 404 and Click is never called", async (tc) => {
    arm(tc);
    const owner = await mkUser();
    const other = await mkUser();
    const order = await mkOrder(owner);
    for (const [fn, body] of [
      [card, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE }],
      [verify, { orderId: order.id, smsCode: SMS }],
      [invoice, { orderId: order.id, phone: PHONE }],
    ] as const) {
      const r = await fn(other, body);
      assert.equal(r.res.status, 404, JSON.stringify(r.json));
      assert.match(String(r.json.error), /Buyurtma topilmadi/);
    }
    for (const orderId of ["00000000-0000-4000-8000-000000000000", "nope", "../../x", ""]) {
      assert.equal((await card(owner, { orderId, cardNumber: CARD, expireDate: EXPIRE })).res.status, 404, orderId);
    }
    assert.equal(calls.length, 0, "Click was never called");
    assert.equal((await row(order.id)).click_card_token, null);
  });

  await t.test("signed out = 401; wrong body types = 400; Click calls are not made", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    assert.equal((await card(null, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE })).res.status, 401);
    assert.equal((await verify(null, { orderId: order.id, smsCode: SMS })).res.status, 401);
    assert.equal((await invoice(null, { orderId: order.id, phone: PHONE })).res.status, 401);
    for (const body of [{}, { orderId: order.id }, { orderId: 5, cardNumber: CARD, expireDate: EXPIRE }, { orderId: order.id, cardNumber: 8600, expireDate: EXPIRE }]) {
      assert.equal((await card(uid, body)).res.status, 400, JSON.stringify(body));
    }
    assert.equal((await verify(uid, { orderId: order.id })).res.status, 400);
    assert.equal((await invoice(uid, { orderId: order.id, phone: 998901234567 })).res.status, 400);
    assert.equal(calls.length, 0);
  });

  await t.test("state: Payme order = 400; paid / cancelled = 409; Click never called", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const payme = await mkOrder(uid, 25_000, "payme");
    assert.equal((await card(uid, { orderId: payme.id, cardNumber: CARD, expireDate: EXPIRE })).res.status, 400);
    assert.equal((await invoice(uid, { orderId: payme.id, phone: PHONE })).res.status, 400);

    const paid = await mkOrder(uid);
    assert.equal((await settleOrder(paid.id, Date.now())).status, "paid");
    const p = await invoice(uid, { orderId: paid.id, phone: PHONE });
    assert.equal(p.res.status, 409);
    assert.equal(p.json.code, "already_paid");
    assert.equal((await card(uid, { orderId: paid.id, cardNumber: CARD, expireDate: EXPIRE })).res.status, 409);

    const cancelled = await mkOrder(uid);
    assert.equal((await cancelOrder(cancelled.id, Date.now(), 3)).status, "cancelled");
    const c = await card(uid, { orderId: cancelled.id, cardNumber: CARD, expireDate: EXPIRE });
    assert.equal(c.res.status, 409);
    assert.equal(c.json.code, "cancelled");
    assert.equal(calls.length, 0);
  });

  await t.test("not configured: Merchant API credentials missing = 503, nothing is called", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    const saved = env.click.merchantUserId;
    (env.click as { merchantUserId: string }).merchantUserId = "";
    try {
      const r = await invoice(uid, { orderId: order.id, phone: PHONE });
      assert.equal(r.res.status, 503);
      assert.equal(r.json.code, "click_direct_unavailable");
      assert.equal((await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE })).res.status, 503);
    } finally {
      (env.click as { merchantUserId: string }).merchantUserId = saved;
    }
    assert.equal(calls.length, 0);
  });

  // ───────────────────────── validation

  await t.test("validation happens on the server before Click: card, expiry, SMS code, phone", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    const bad = async (body: Json, field: string) => {
      const r = await card(uid, { orderId: order.id, ...body });
      assert.equal(r.res.status, 400, JSON.stringify(body));
      assert.equal(r.json.field, field);
    };
    await bad({ cardNumber: "8600 1234", expireDate: EXPIRE }, "cardNumber");
    await bad({ cardNumber: "4111 1111 1111 111", expireDate: EXPIRE }, "cardNumber");
    await bad({ cardNumber: "86001234123412345678", expireDate: EXPIRE }, "cardNumber");
    await bad({ cardNumber: CARD, expireDate: "01/20" }, "expireDate");
    await bad({ cardNumber: CARD, expireDate: "13/99" }, "expireDate");
    await bad({ cardNumber: CARD, expireDate: "" }, "expireDate");
    const v = await verify(uid, { orderId: order.id, smsCode: "12" });
    assert.equal(v.res.status, 400);
    assert.equal(v.json.field, "smsCode");
    for (const phone of ["", "123", "+7 900 123 45 67", "99890123456789"]) {
      const r = await invoice(uid, { orderId: order.id, phone });
      assert.equal(r.res.status, 400, phone);
      assert.equal(r.json.field, "phone");
    }
    assert.equal(calls.length, 0, "no invalid input reaches Click");
  });

  // ───────────────────────── card flow

  await t.test("card flow: SMS -> confirm -> Click payment -> Shop API settles; token stored then cleared; nothing sensitive logged", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid, 25_000);
    const a = await card(uid, { orderId: order.id, cardNumber: CARD_SPACED, expireDate: EXPIRE });
    assert.equal(a.res.status, 200, JSON.stringify(a.json));
    assert.deepEqual(a.json, { phoneMasked: "+998*******67" });
    assert.deepEqual(calls[0], { path: "/card_token/request", body: { service_id: 777, card_number: CARD, expire_date: "1299", temporary: 1 } });
    let r = await row(order.id);
    assert.equal(r.click_method, "card");
    assert.match(r.click_card_token ?? "", /^TOK-/, "the one-time token waits for the SMS code");
    assert.equal(r.state, "created");

    const b = await verify(uid, { orderId: order.id, smsCode: SMS });
    assert.equal(b.res.status, 200, JSON.stringify(b.json));
    assert.deepEqual(b.json, { status: "paid" }, "the Shop API Complete ran during the payment call");
    assert.deepEqual(
      calls.slice(1).map((c) => c.path),
      ["/card_token/verify", "/card_token/payment"],
    );
    assert.deepEqual(calls[1].body, { service_id: 777, card_token: "TOK-1", sms_code: SMS });
    assert.deepEqual(calls[2].body, { service_id: 777, card_token: "TOK-1", amount: 25_000, transaction_parameter: order.id });
    r = await row(order.id);
    assert.equal(r.state, "paid");
    assert.equal(r.click_card_token, null, "token cleared");
    assert.equal(r.click_payment_id, "598761234");
    assert.deepEqual(await wallet(uid), { points: 2_500, balance: 25_000 }, "credited once + 10 % bonus points");

    const dump = lines.join("\n");
    // Digits-only secrets are matched as whole tokens (a uuid may contain "1299" by chance).
    const leaks = (s: string) => new RegExp(`(?<![0-9a-zA-Z-])${s}(?![0-9a-zA-Z-])`).test(dump);
    assert.ok(!dump.includes(CARD) && !dump.includes(CARD_SPACED), "a log line leaks the card number");
    assert.ok(!leaks("1299"), "a log line leaks the expiry");
    assert.ok(!leaks(SMS), "a log line leaks the SMS code");
    assert.ok(!dump.includes("TOK-1"), "a log line leaks the card token");
    assert.ok(dump.includes(order.id), "the order id IS logged");
  });

  await t.test("the amount sent to Click is the ORDER's amount; body amount / userId fields are ignored", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid, 12_345);
    await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE, amount: 1, amountSoum: 1, userId: "1" });
    await verify(uid, { orderId: order.id, smsCode: SMS, amount: 1 });
    const pay = calls.find((c) => c.path === "/card_token/payment")!;
    assert.equal(pay.body.amount, 12_345);
    assert.equal(pay.body.transaction_parameter, order.id);
  });

  await t.test("wrong SMS code: mapped Uzbek message (422), token KEPT, a corrected code succeeds", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE });
    const w = await verify(uid, { orderId: order.id, smsCode: "000000" });
    assert.equal(w.res.status, 422);
    assert.match(String(w.json.error), /SMS kod noto'g'ri/);
    assert.ok((await row(order.id)).click_card_token, "token kept for the retry");
    assert.ok(!calls.some((c) => c.path === "/card_token/payment"), "no payment on a wrong code");
    const ok = await verify(uid, { orderId: order.id, smsCode: SMS });
    assert.deepEqual(ok.json, { status: "paid" });
  });

  await t.test("verify without a token = 409 no_token (no Click call)", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    const r = await verify(uid, { orderId: order.id, smsCode: SMS });
    assert.equal(r.res.status, 409);
    assert.equal(r.json.code, "no_token");
    assert.equal(calls.length, 0);
  });

  await t.test("SMS attempts are capped at 5 per order (6th = 429), even for a correct code", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE });
    for (let i = 0; i < 5; i++) assert.equal((await verify(uid, { orderId: order.id, smsCode: "000000" })).res.status, 422, `attempt ${i + 1}`);
    const sixth = await verify(uid, { orderId: order.id, smsCode: SMS });
    assert.equal(sixth.res.status, 429);
    assert.equal(calls.filter((c) => c.path === "/card_token/verify").length, 5, "the 6th never reached Click");
  });

  await t.test("card request cap: 3 per order per 15 min (4th = 429)", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    for (let i = 0; i < 3; i++) assert.equal((await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE })).res.status, 200);
    assert.equal((await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE })).res.status, 429);
    assert.equal(calls.length, 3);
  });

  await t.test("card request cap: 6 per user per hour across orders (7th = 429)", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    for (let i = 0; i < 6; i++) {
      const order = await mkOrder(uid);
      assert.equal((await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE })).res.status, 200, `request ${i + 1}`);
    }
    const order = await mkOrder(uid);
    assert.equal((await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE })).res.status, 429);
  });

  await t.test("Click declines the card (error_code + note): 422 with a mapped message, no token stored", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    behave["/card_token/request"] = () => ({ body: { error_code: -403, error_note: "Card not found" } });
    const r = await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE });
    assert.equal(r.res.status, 422);
    assert.match(String(r.json.error), /Karta topilmadi/);
    assert.equal(r.json.code, "click_declined");
    assert.equal((await row(order.id)).click_card_token, null);
    // An unknown code never shows Click's raw text.
    behave["/card_token/request"] = () => ({ body: { error_code: -999, error_note: "Внутренняя ошибка 0xDEADBEEF" } });
    const u = await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE });
    assert.equal(u.res.status, 422);
    assert.ok(!String(u.json.error).includes("0xDEADBEEF"));
  });

  await t.test("Click down (502 / network): 503 click_unavailable, no token", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    behave["/card_token/request"] = () => ({ status: 502, body: {} });
    const r = await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE });
    assert.equal(r.res.status, 503);
    assert.equal(r.json.code, "click_unavailable");
    behave["/card_token/request"] = () => "throw";
    assert.equal((await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE })).res.status, 503);
    assert.equal((await row(order.id)).click_card_token, null);
  });

  await t.test("payment declined by Click: 422, token already spent (restart needed), nothing credited", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE });
    behave["/card_token/payment"] = () => ({ body: { error_code: -401, error_note: "Insufficient funds" } });
    const r = await verify(uid, { orderId: order.id, smsCode: SMS });
    assert.equal(r.res.status, 422);
    assert.match(String(r.json.error), /mablag' yetarli emas/);
    assert.equal((await row(order.id)).click_card_token, null);
    assert.deepEqual(await wallet(uid), { points: 0, balance: 0 });
    const again = await verify(uid, { orderId: order.id, smsCode: SMS });
    assert.equal(again.res.status, 409, "the spent token cannot be reused");
  });

  await t.test("unknown outcome (payment call times out): 200 pending, NOT an error; the late Complete then settles", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid, 10_000);
    await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE });
    behave["/card_token/payment"] = () => "throw";
    const r = await verify(uid, { orderId: order.id, smsCode: SMS });
    assert.equal(r.res.status, 200);
    assert.deepEqual(r.json, { status: "pending" });
    assert.deepEqual(await wallet(uid), { points: 0, balance: 0 }, "nothing credited by the Merchant API call");
    const settled = await clickSettles(order.id, 10_000);
    assert.equal(settled.done.error, 0);
    assert.deepEqual(await wallet(uid), { points: 1_000, balance: 10_000 });
  });

  await t.test("charged but the payment id cannot be saved (BIGINT overflow): NOT an error, the order still settles (review L1)", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid, 25_000);
    // MUTATION: the bookkeeping UPDATE in the same try as the payment call turns this into a 500.
    behave["/card_token/payment"] = async (b) => {
      await clickSettles(String(b.transaction_parameter), Number(b.amount));
      return { body: { error_code: 0, error_note: "Success", payment_id: "9999999999999999999", payment_status: 2 } };
    };
    assert.equal((await card(uid, { orderId: order.id, cardNumber: CARD_SPACED, expireDate: EXPIRE })).res.status, 200);
    const b = await verify(uid, { orderId: order.id, smsCode: SMS });
    assert.equal(b.res.status, 200, JSON.stringify(b.json));
    assert.deepEqual(b.json, { status: "paid" });
    assert.equal((await row(order.id)).click_payment_id, null);
    assert.deepEqual(await wallet(uid), { points: 2_500, balance: 25_000 });
  });

  await t.test("two concurrent confirms submit ONE payment (token claim) and credit once", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid, 10_000);
    await card(uid, { orderId: order.id, cardNumber: CARD, expireDate: EXPIRE });
    const base = defaults["/card_token/payment"];
    // A slow verify makes both requests hold the order (with its token) BEFORE either claims it.
    const slowVerify = defaults["/card_token/verify"];
    behave["/card_token/verify"] = async (b, c) => {
      await new Promise((res) => setTimeout(res, 60));
      return slowVerify(b, c);
    };
    behave["/card_token/payment"] = async (b, c) => {
      await new Promise((res) => setTimeout(res, 40));
      return base(b, c);
    };
    const [x, y] = await Promise.all([verify(uid, { orderId: order.id, smsCode: SMS }), verify(uid, { orderId: order.id, smsCode: SMS })]);
    // Both read the order before either claimed the token: the loser of the claim answers a benign 200 (pending / paid).
    assert.equal(x.res.status, 200, JSON.stringify(x.json));
    assert.equal(y.res.status, 200, JSON.stringify(y.json));
    assert.equal(calls.filter((c) => c.path === "/card_token/payment").length, 1, "exactly one payment call");
    assert.deepEqual(await wallet(uid), { points: 1_000, balance: 10_000 });
  });

  // ───────────────────────── invoice flow

  await t.test("invoice: sent to the app, order amount + id, columns recorded; Click then settles via the Shop API EXACTLY once (+10 % bonus)", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid, 50_000);
    const ph = fresh();
    const r = await invoice(uid, { orderId: order.id, phone: ph, amount: 1 });
    assert.equal(r.res.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { status: "sent" });
    assert.deepEqual(calls, [
      { path: "/invoice/create", body: { service_id: 777, amount: 50_000, phone_number: ph.replace(/\D/g, ""), merchant_trans_id: order.id } },
    ]);
    const before = await row(order.id);
    assert.equal(before.click_method, "phone");
    assert.equal(before.click_invoice_id, "777001");
    assert.equal(before.state, "created", "an invoice credits nothing");
    assert.deepEqual(await wallet(uid), { points: 0, balance: 0 });

    // The user confirms in the Click app -> Click calls OUR Shop API.
    const s = await clickSettles(order.id, 50_000);
    assert.equal(s.done.error, 0, s.done.error_note);
    assert.deepEqual(await wallet(uid), { points: 5_000, balance: 50_000 }, "50 000 + 10 % bonus points");
    assert.equal((await s.again()).error, -4, "a replayed Complete answers Already paid");
    assert.equal((await s.again()).error, -4);
    assert.deepEqual(await wallet(uid), { points: 5_000, balance: 50_000 }, "credited once");
    assert.deepEqual(await ledger(uid), [
      { kind: "topup", points: 0, balance: 50_000 },
      { kind: "bonus", points: 5_000, balance: 0 },
    ]);
    assert.equal((await row(order.id)).state, "paid");
    // A paid order cannot be invoiced / charged again.
    assert.equal((await invoice(uid, { orderId: order.id, phone: ph })).res.status, 409);
  });

  await t.test("invoice declined (phone has no Click): 422 mapped; Click down: 503", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    const ph = fresh();
    behave["/invoice/create"] = () => ({ body: { error_code: -404, error_note: "Subscriber not found" } });
    const r = await invoice(uid, { orderId: order.id, phone: ph });
    assert.equal(r.res.status, 422);
    assert.match(String(r.json.error), /Hisob-faktura yuborilmadi/, "generic: does not confirm whether the phone has Click (review L2)");
    assert.equal((await row(order.id)).click_invoice_id, null);
    behave["/invoice/create"] = () => ({ status: 500, body: {} });
    assert.equal((await invoice(uid, { orderId: order.id, phone: ph })).res.status, 503);
  });

  await t.test("invoice caps: 3 per order, 5 per target phone per day (spam guard), 5 per user per hour", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const order = await mkOrder(uid);
    const own = fresh();
    for (let i = 0; i < 3; i++) assert.equal((await invoice(uid, { orderId: order.id, phone: own })).res.status, 200);
    assert.equal((await invoice(uid, { orderId: order.id, phone: own })).res.status, 429, "4th on one order");

    // Same TARGET phone, different users (a victim must not be spammed): 5 per day in total.
    const victim = fresh();
    let sent = 0;
    let blocked = 0;
    for (let i = 0; i < 7; i++) {
      const u = await mkUser();
      const o = await mkOrder(u);
      const res = await invoice(u, { orderId: o.id, phone: victim });
      if (res.res.status === 200) sent++;
      else {
        assert.equal(res.res.status, 429);
        blocked++;
      }
    }
    assert.equal(sent, 5, "5 invoices per phone per day");
    assert.equal(blocked, 2);

    const heavy = await mkUser();
    let ok = 0;
    for (let i = 0; i < 6; i++) {
      const o = await mkOrder(heavy);
      const res = await invoice(heavy, { orderId: o.id, phone: fresh() });
      if (res.res.status === 200) ok++;
      else assert.equal(res.res.status, 429);
    }
    assert.equal(ok, 5, "5 invoices per user per hour");
  });

  // ───────────────────────── token lifecycle

  await t.test("token lifecycle: cleared on paid, on cancel and by the stale sweep (30 min)", async (tc) => {
    arm(tc);
    const uid = await mkUser();
    const a = await mkOrder(uid);
    const b = await mkOrder(uid);
    const c = await mkOrder(uid);
    for (const o of [a, b, c]) await card(uid, { orderId: o.id, cardNumber: CARD, expireDate: EXPIRE });
    assert.ok((await row(a.id)).click_card_token && (await row(b.id)).click_card_token && (await row(c.id)).click_card_token);
    await settleOrder(a.id, Date.now());
    assert.equal((await row(a.id)).click_card_token, null, "paid clears the token");
    await cancelOrder(b.id, Date.now(), 3);
    assert.equal((await row(b.id)).click_card_token, null, "cancel clears the token");
    assert.equal(await purgeStaleCardTokens(30), 0, "a fresh token is kept");
    assert.ok((await row(c.id)).click_card_token);
    await query(`UPDATE payment_orders SET updated_at = now() - interval '31 minutes' WHERE id = $1`, [c.id]);
    assert.equal(await purgeStaleCardTokens(30), 1, "an abandoned token is dropped");
    assert.equal((await row(c.id)).click_card_token, null);
    assert.equal((await verify(uid, { orderId: c.id, smsCode: SMS })).res.status, 409, "and cannot be used any more");
  });

  // ───────────────────────── orders route: method

  await t.test("POST /api/payments/orders: `method` is validated and stored as click_method (Click only)", async (tc) => {
    arm(tc);
    const mk = async (body: Json) => post(ordersRoute, "/api/payments/orders", await mkUser(), body);
    for (const method of ["page", "card", "phone", "app"]) {
      const r = await mk({ provider: "click", amount: 1_000, method });
      assert.equal(r.res.status, 201, JSON.stringify(r.json));
      const id = (r.json.order as { id: string }).id;
      assert.equal((await row(id)).click_method, method);
      assert.ok(String(r.json.checkoutUrl).startsWith("https://my.click.uz/services/pay?"), "the page / deeplink URL is still returned");
    }
    const none = await mk({ provider: "click", amount: 1_000 });
    assert.equal((await row((none.json.order as { id: string }).id)).click_method, null);
    for (const method of ["visa", "", 1, ["card"], "CARD"]) assert.equal((await mk({ provider: "click", amount: 1_000, method })).res.status, 400, JSON.stringify(method));
  });
});
