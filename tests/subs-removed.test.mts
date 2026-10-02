import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Obuna olib tashlandi — server shartnomasi (docs/SUBS-REMOVAL.md §A, WP1).
 *
 *   • `POST /api/payments/orders` `purpose: "pro"` → 400
 *     `{ error: "Obuna to'xtatilgan", code: "pro_removed" }`, buyurtma yozilmaydi;
 *     `topup` (va `purpose` siz eski klient) odatdagidek 201;
 *   • `GET /api/payments/orders` da `plan` yo'q;
 *   • `SessionUser` (`/api/auth/session`, `/api/users/me` GET/PATCH) da
 *     `plan`/`planExpiresAt`/`premium` yo'q, `quota` esa bir reliz qoladi (son) —
 *     bazada `plan = 'pro'` qolgan foydalanuvchida ham.
 *
 * HAQIQIY route'lar alohida Postgres bazaga qarshi chaqiriladi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.CLICK_SERVICE_ID = "777";
process.env.CLICK_MERCHANT_ID = "42";
process.env.CLICK_SECRET_KEY = "click-secret-key";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("subsrm") : { isolated: false, drop: async () => {} };
const skip = hasDb ? false : "DATABASE_URL yo'q";

const PLAN_KEYS = ["plan", "planExpiresAt", "premium"];

test("obuna olib tashlandi: buyurtma route'i va sessiya shartnomasi", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const orders = await import("../app/api/payments/orders/route.ts");
  const session = await import("../app/api/auth/session/route.ts");
  const me = await import("../app/api/users/me/route.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  // Eski Pro foydalanuvchi: `users.plan` ustunlari tarix uchun qoladi, lekin o'qilmaydi.
  const [{ id }] = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance, plan, plan_expires_at)
     VALUES ($1, 'Test', 50, 0, 7000, 'pro', now() + interval '10 days') RETURNING id::text AS id`,
    [`subs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
  );
  const { token } = await createSession(id);
  const cookie = `${SESSION_COOKIE}=${token}`;

  const call = async (
    route: (req: Request) => Promise<Response>,
    url: string,
    init: { method?: string; body?: unknown } = {},
  ) => {
    const req = new Request(`http://localhost${url}`, {
      method: init.method ?? "GET",
      headers: { cookie, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const res = await inRequest(req, () => route(req));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const orderCount = async () =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM payment_orders WHERE user_id = $1`, [id]))[0].n);

  const assertNoPlan = (user: unknown, where: string) => {
    assert.ok(user && typeof user === "object", `${where}: user yo'q`);
    const u = user as Record<string, unknown>;
    for (const k of PLAN_KEYS) assert.ok(!(k in u), `${where}: «${k}» kaliti qolgan`);
    // Ochiq eski tab `points + quota + balance` hisoblaydi — `quota` son bo'lib qolishi shart.
    assert.equal(u.quota, 0, `${where}: quota`);
    assert.equal(u.points, 50, `${where}: points`);
    assert.equal(u.balance, 7000, `${where}: balance`);
  };

  await t.test("POST pro → 400 pro_removed, buyurtma yozilmaydi", async () => {
    for (const provider of ["click", "payme", undefined]) {
      const r = await call(orders.POST, "/api/payments/orders", { method: "POST", body: { provider, purpose: "pro", amount: 15_000 } });
      // MUTATSIYA: route `pro` ni `topup` ga jim aylantirsa — 201 va 15 000 lik buyurtma.
      assert.equal(r.status, 400, `${provider}: ${JSON.stringify(r.body)}`);
      assert.deepEqual(r.body, { error: "Obuna to'xtatilgan", code: "pro_removed" });
    }
    assert.equal(await orderCount(), 0);
  });

  await t.test("POST topup (va purpose siz eski klient) → 201 topup", async () => {
    const a = await call(orders.POST, "/api/payments/orders", { method: "POST", body: { provider: "click", purpose: "topup", amount: 10_000 } });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal((a.body.order as { purpose: string }).purpose, "topup");
    assert.equal((a.body.order as { amountSoum: number }).amountSoum, 10_000);
    const b = await call(orders.POST, "/api/payments/orders", { method: "POST", body: { provider: "click", amount: 6_000 } });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.equal((b.body.order as { purpose: string }).purpose, "topup");
    assert.equal(await orderCount(), 2);
  });

  await t.test("GET orders: `plan` yo'q", async () => {
    const r = await call(orders.GET, "/api/payments/orders");
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ["orders", "providers"]);
  });

  await t.test("sessiya: plan/planExpiresAt/premium yo'q, quota = 0 qoladi", async () => {
    const s = await call(session.GET, "/api/auth/session");
    assert.equal(s.status, 200);
    assertNoPlan(s.body.user, "auth/session");

    const g = await call(me.GET, "/api/users/me");
    assert.equal(g.status, 200);
    assertNoPlan(g.body.user, "users/me GET");

    // PATCH `plan` ni qabul qilmaydi va javobda ham qaytarmaydi.
    const p = await call(me.PATCH, "/api/users/me", { method: "PATCH", body: { name: "Yangi", plan: "free", premium: true } });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assertNoPlan(p.body.user, "users/me PATCH");
    assert.equal((p.body.user as { name: string }).name, "Yangi");
    const [row] = await query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1`, [id]);
    assert.equal(row.plan, "pro", "tarixiy ustun tegilmaydi");
  });
});
