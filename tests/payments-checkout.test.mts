import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * `POST /api/payments/orders` — provider checkout URL, incl. Click «Karta orqali»
 * (docs.click.uz «Click tugmasi»: the same `my.click.uz/services/pay` link plus
 * `card_type=uzcard|humo`).
 *
 * The REAL route runs (session cookie, rate limit, `createOrder`) against an isolated
 * database. Invariants:
 *   - plain Click link has NO `card_type`; the card variant adds exactly it, the rest identical;
 *   - both create an ordinary `provider = 'click'` order (one Prepare/Complete flow);
 *   - `card` is validated server side (unknown value / Payme + card → 400, nothing created);
 *   - nothing is offered when Click is not configured (503).
 *
 * Mutation notes: `card_type` dropped from the URL → «card variant»; `isCardType` accepting
 * any string → «invalid card».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://app.example.test";
process.env.CLICK_SERVICE_ID = "777";
process.env.CLICK_MERCHANT_ID = "42";
process.env.CLICK_SECRET_KEY = "click-secret-key";
delete process.env.PAYME_MERCHANT_ID;
delete process.env.PAYME_KEY;
delete process.env.PAYME_TEST_KEY;

// Before the first `test()`: node:test starts it at once and `lib/server/*` captures env on import.
const iso = hasDb ? await createIsolatedDb("checkout") : { isolated: false, drop: async () => {} };

test("payments/orders: Click and «Karta orqali» checkout URLs", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const orders = await import("../app/api/payments/orders/route.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const mkUser = async () => {
    const r = await query<{ id: string }>(
      `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`,
      [`co-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
    );
    return String(r[0].id);
  };
  const post = async (body: Record<string, unknown>, uid?: string) => {
    const userId = uid ?? (await mkUser());
    const { token } = await createSession(userId);
    const req = new Request("http://localhost/api/payments/orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify(body),
    });
    const res = await inRequest(req, () => orders.POST(req));
    return { res, json: (await res.json()) as Record<string, any>, userId };
  };
  const orderCount = async (uid: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) n FROM payment_orders WHERE user_id = $1`, [uid]))[0].n);

  await t.test("plain Click link: documented params, amount N.NN, no card_type", async () => {
    const { res, json } = await post({ provider: "click", amount: 25_000 });
    assert.equal(res.status, 201, JSON.stringify(json));
    const u = new URL(json.checkoutUrl);
    assert.equal(`${u.origin}${u.pathname}`, "https://my.click.uz/services/pay");
    assert.deepEqual(Object.fromEntries(u.searchParams), {
      service_id: "777",
      merchant_id: "42",
      amount: "25000.00",
      transaction_param: json.order.id,
      return_url: `https://app.example.test/uz/purchase?order=${json.order.id}`,
    });
    assert.equal(json.order.provider, "click");
    assert.equal(json.order.amountSoum, 25_000);
  });

  await t.test("card variant: the same Click order and link plus card_type (uzcard / humo)", async () => {
    for (const card of ["uzcard", "humo"]) {
      const { res, json, userId } = await post({ provider: "click", amount: 10_000, card });
      assert.equal(res.status, 201, JSON.stringify(json));
      const u = new URL(json.checkoutUrl);
      assert.equal(`${u.origin}${u.pathname}`, "https://my.click.uz/services/pay");
      assert.equal(u.searchParams.get("card_type"), card);
      assert.equal(u.searchParams.get("amount"), "10000.00");
      assert.equal(u.searchParams.get("transaction_param"), json.order.id);
      assert.equal(u.searchParams.get("return_url"), `https://app.example.test/uz/purchase?order=${json.order.id}`);
      assert.equal(json.order.provider, "click", "same provider: one Prepare/Complete flow");
      assert.equal(await orderCount(userId), 1);
    }
    // Explicit null / absent card = the plain link.
    const { json } = await post({ provider: "click", amount: 10_000, card: null });
    assert.equal(new URL(json.checkoutUrl).searchParams.has("card_type"), false);
  });

  await t.test("invalid card: unknown value, wrong type, Payme + card → 400 and no order", async () => {
    for (const body of [
      { provider: "click", amount: 10_000, card: "visa" },
      { provider: "click", amount: 10_000, card: "UZCARD" },
      { provider: "click", amount: 10_000, card: "" },
      { provider: "click", amount: 10_000, card: 1 },
      { provider: "click", amount: 10_000, card: ["humo"] },
      { provider: "payme", amount: 10_000, card: "humo" },
    ]) {
      const { res, json, userId } = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(String(json.error ?? json.message ?? ""), /Karta turi/);
      assert.equal(await orderCount(userId), 0, "no order is created");
    }
  });

  await t.test("amount bounds still apply to the card variant", async () => {
    const { res, userId } = await post({ provider: "click", amount: 1_000, card: "humo" });
    assert.equal(res.status, 400);
    assert.equal(await orderCount(userId), 0);
  });

  await t.test("Click not configured: neither variant is offered (503)", async () => {
    const { env } = await import("../lib/server/env.ts");
    const saved = env.click.secretKey;
    (env.click as { secretKey: string }).secretKey = "";
    try {
      for (const body of [
        { provider: "click", amount: 10_000 },
        { provider: "click", amount: 10_000, card: "uzcard" },
      ]) {
        const { res, userId } = await post(body);
        assert.equal(res.status, 503);
        assert.equal(await orderCount(userId), 0);
      }
    } finally {
      (env.click as { secretKey: string }).secretKey = saved;
    }
  });
});
