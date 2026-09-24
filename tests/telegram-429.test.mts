import test from "node:test";
import assert from "node:assert/strict";

/**
 * Telegram Bot API `call` — 429 (`retry_after`) ga BITTA cheklangan qayta
 * urinish (audit EXT-05). Ilgari 429 shunchaki `null` qaytarardi va kirish
 * havolasi foydalanuvchiga hech qachon yetmasdi (ko'p `/start` bir paytda).
 * `fetch` stub — Telegram'ga chiqilmaydi; DB ishlatilmaydi.
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token-fake-1234567890";

const { sendMessage } = await import("../lib/server/telegram.ts");

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

const TOO_MANY = (after: number) =>
  new Response(JSON.stringify({ ok: false, error_code: 429, description: `Too Many Requests: retry after ${after}`, parameters: { retry_after: after } }), { status: 429 });
const OK = () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });

function stub(replies: (() => Response)[]) {
  const at: number[] = [];
  globalThis.fetch = (async () => {
    at.push(Date.now());
    return replies[Math.min(at.length - 1, replies.length - 1)]();
  }) as typeof fetch;
  return at;
}

test("429 retry_after → aytilgan vaqt kutiladi va BIR marta qayta yuboriladi", async () => {
  const at = stub([() => TOO_MANY(1), OK]);
  const t0 = Date.now();
  assert.equal(await sendMessage(1, "salom"), true);
  assert.equal(at.length, 2);
  assert.ok(at[1] - t0 >= 950, `retry_after kutilmadi: ${at[1] - t0} ms`);
});

test("429 takrorlansa — faqat bitta qayta urinish, keyin false", async () => {
  const at = stub([() => TOO_MANY(1)]);
  assert.equal(await sendMessage(1, "salom"), false);
  assert.equal(at.length, 2);
});

test("retry_after chegaradan uzun (30 s) — qayta urinish befoyda, darhol false (review nit 3)", async () => {
  const at = stub([() => TOO_MANY(30), OK]);
  const t0 = Date.now();
  assert.equal(await sendMessage(1, "salom"), false);
  assert.equal(at.length, 1);
  assert.ok(Date.now() - t0 < 500);
});

test("boshqa xato (400) qayta yuborilmaydi", async () => {
  const at = stub([() => new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 400 })]);
  assert.equal(await sendMessage(1, "salom"), false);
  assert.equal(at.length, 1);
});
