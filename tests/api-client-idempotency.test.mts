import test from "node:test";
import assert from "node:assert/strict";

/**
 * C34 / CONC-10 (klient qismi) — `POST /api/generations` har yuborish
 * NIYATIGA bitta `Idempotency-Key: <uuid v4>` bilan ketadi va shu niyatning
 * takrorida (javobi yo'qolgan so'rovdan keyingi qayta yuborish, sahifa
 * o'tishi paytidagi ikkinchi bosish) O'SHA kalit qayta ishlatiladi.
 * Server (W3-A) kalitni generatsiya id si sifatida oladi — ikkinchi marta
 * pul yechilmaydi.
 */

const api = await import("../lib/api-client.ts");
const { ApiError } = api;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Har chaqiruvda navbatdagi javob; yuborilgan kalitlar yig'iladi. */
function stub(t: import("node:test").TestContext, answers: Array<() => Response>) {
  const keys: Array<string | null> = [];
  t.mock.method(globalThis, "fetch", async (_u: unknown, init?: RequestInit) => {
    keys.push(new Headers(init?.headers).get("idempotency-key"));
    const next = answers.shift();
    if (!next) throw new Error("kutilmagan so'rov");
    return next();
  });
  return keys;
}

const ok = () => json(202, { id: "g1", price: 3000, status: "QUEUED" });
const values = (topic: string) => ({ topic, pages: 10 });

test("C34: har yuborishda `Idempotency-Key` — UUID v4", async (t) => {
  const keys = stub(t, [ok]);
  await api.createGeneration("referat", values("A1"));
  assert.equal(keys.length, 1);
  assert.match(keys[0] ?? "", UUID_V4);
});

test("C34: 502 / vaqt tugashidan keyin XUDDI shu forma — o'sha kalit (ikkinchi to'lov yo'q)", async (t) => {
  const keys = stub(t, [
    () => json(502, {}),
    () => {
      throw new TypeError("Failed to fetch");
    },
    ok,
  ]);
  await assert.rejects(api.createGeneration("referat", values("B1")), ApiError);
  await assert.rejects(api.createGeneration("referat", values("B1")), ApiError);
  await api.createGeneration("referat", values("B1"));
  assert.match(keys[0] ?? "", UUID_V4);
  assert.equal(new Set(keys).size, 1, `bitta niyat — bitta kalit: ${keys.join(", ")}`);
});

test("C34: muvaffaqiyatdan keyingi ikkinchi bosish (≤30 s) — o'sha kalit; 30 s dan keyin — yangi", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const keys = stub(t, [ok, ok, ok]);
  await api.createGeneration("referat", values("C1"));
  t.mock.timers.tick(5_000);
  await api.createGeneration("referat", values("C1"));
  assert.equal(keys[1], keys[0], "sahifa o'tishi paytidagi qayta bosish — o'sha ish");
  t.mock.timers.tick(api.SUBMIT_KEY_AFTER_SUCCESS_MS + 1);
  await api.createGeneration("referat", values("C1"));
  assert.notEqual(keys[2], keys[0], "ongli qayta yaratish — yangi ish");
});

test("C34: boshqa forma — yangi kalit; aniq rad (402) dan keyin — yangi kalit", async (t) => {
  const keys = stub(t, [() => json(502, {}), ok, () => json(402, { error: "Balans yetarli emas." }), ok]);
  await assert.rejects(api.createGeneration("referat", values("D1")));
  await api.createGeneration("referat", values("D2"));
  assert.notEqual(keys[1], keys[0], "qiymatlar boshqa — boshqa niyat");
  await assert.rejects(api.createGeneration("referat", values("D3")));
  await api.createGeneration("referat", values("D3"));
  assert.notEqual(keys[3], keys[2], "402 — server hech narsa yaratmagan, yangi urinish yangi kalit");
});

test("C34: chaqiruvchi kalitni o'zi bersa — aynan u yuboriladi", async (t) => {
  const keys = stub(t, [ok]);
  const k = "0b7c1c5e-8a4f-4d2b-9c1e-2f3a4b5c6d7e";
  await api.createGeneration("referat", values("E1"), { idempotencyKey: k });
  assert.equal(keys[0], k);
});
