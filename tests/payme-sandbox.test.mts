import test from "node:test";
import assert from "node:assert/strict";

/**
 * Payme SINOV kaliti faqat `PAYME_SANDBOX=true` bo'lsa qabul qilinadi (C11, EXT-01).
 *
 * Ilgari route `[env.payme.key, env.payme.testKey]` ni SO'ZSIZ uzatardi:
 * prod `.env` da `PAYME_TEST_KEY` qolib ketsa, `checkout.test.paycom.uz`
 * orqali test karta bilan «to'langan» buyurtma haqiqiy balansga tushardi.
 *
 * Ikki qatlam sinaladi:
 *   1. sof `acceptedPaymeKeys` — qaysi kalitlar ro'yxatga kiradi;
 *   2. HAQIQIY route (`POST /api/payments/payme`) — sandbox o'chiq bo'lsa
 *      test kaliti AUTH (-32504) oladi va baza umuman so'ralmaydi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
process.env.PAYME_MERCHANT_ID = "merchant-1";
process.env.PAYME_KEY = "payme-live-key";
process.env.PAYME_TEST_KEY = "payme-test-key";
delete process.env.PAYME_SANDBOX;

const LIVE = "payme-live-key";
const TEST = "payme-test-key";
const basic = (password: string) => `Basic ${Buffer.from(`Paycom:${password}`, "utf8").toString("base64")}`;

const { acceptedPaymeKeys, paymeAuthorized } = await import("../lib/server/payments.ts");
const { env } = await import("../lib/server/env.ts");
const { POST } = await import("../app/api/payments/payme/route.ts");

test("acceptedPaymeKeys: test kaliti FAQAT sandbox rejimida", () => {
  const off = acceptedPaymeKeys({ key: LIVE, testKey: TEST, sandbox: false });
  const on = acceptedPaymeKeys({ key: LIVE, testKey: TEST, sandbox: true });

  assert.equal(paymeAuthorized(basic(TEST), off), false, "prod: test kaliti rad etiladi");
  assert.equal(paymeAuthorized(basic(LIVE), off), true, "prod: jonli kalit ishlaydi");
  assert.equal(paymeAuthorized(basic(TEST), on), true, "sandbox: test kaliti ishlaydi");
  assert.equal(paymeAuthorized(basic(LIVE), on), true, "sandbox: jonli kalit ham ishlaydi");

  // Faqat test kaliti sozlangan prod — Payme umuman yoqilmagan hisoblanadi.
  assert.deepEqual(acceptedPaymeKeys({ key: "", testKey: TEST, sandbox: false }), []);
});

function rpc(auth: string): Request {
  return new Request("http://x/api/payments/payme", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ id: 7, method: "CheckPerformTransaction", params: { amount: 100, account: { order_id: "yo'q" } } }),
  });
}

test("route: sandbox o'chiq — test kaliti bilan kelgan so'rov AUTH (-32504)", async () => {
  assert.equal(env.payme.sandbox, false, "standart qiymat — o'chiq");
  const res = await POST(rpc(basic(TEST)));
  const body = (await res.json()) as { error?: { code: number } };
  assert.equal(body.error?.code, -32504, "MUTATSIYA: test kaliti prod'da qabul qilindi");
});

test("route: sandbox yoqilgan — test kaliti autentifikatsiyadan o'tadi", { skip: process.env.DATABASE_URL.includes("unused") }, async (t) => {
  const mutable = env.payme as { sandbox: boolean };
  mutable.sandbox = true;
  t.after(() => {
    mutable.sandbox = false;
  });
  const res = await POST(rpc(basic(TEST)));
  const body = (await res.json()) as { error?: { code: number } };
  // Buyurtma yo'q — ya'ni AUTH dan o'tib, biznes mantiqqa yetib keldi.
  assert.equal(body.error?.code, -31050);
});

test("paymentsConfigured: faqat test kaliti + sandbox o'chiq — Payme YOQILMAGAN (review R1)", async (t) => {
  const { paymentsConfigured } = await import("../lib/server/env.ts");
  const p = env.payme as { key: string; testKey: string; sandbox: boolean };
  const saved = { ...p };
  t.after(() => {
    Object.assign(p, saved);
  });

  Object.assign(p, { key: "", testKey: TEST, sandbox: false });
  assert.equal(paymentsConfigured().payme, false, "MUTATSIYA: UI checkout taklif qiladi, webhook esa AUTH beradi");
  Object.assign(p, { key: "", testKey: TEST, sandbox: true });
  assert.equal(paymentsConfigured().payme, true, "sandbox: test kaliti yetarli");
  Object.assign(p, { key: LIVE, testKey: "", sandbox: false });
  assert.equal(paymentsConfigured().payme, true, "jonli kalit — yoqilgan");
});
