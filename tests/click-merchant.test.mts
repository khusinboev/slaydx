import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * Click Merchant API client (`lib/server/click-merchant.ts`), fetch mocked.
 *
 * Locks:
 *   - the `Auth` header formula `<merchant_user_id>:sha1(timestamp + secret_key):<timestamp>`
 *     against a digest computed OUTSIDE the code (python hashlib), timestamp = 10-digit seconds;
 *   - URL / method / headers / JSON body of every typed call (docs.click.uz Merchant API);
 *   - the answer mapping and the Uzbek error mapping (documented -1..-9 table, keyword rules,
 *     per-stage fallback; unknown codes logged with the code, never silently swallowed);
 *   - outage handling: timeout / network / 5xx = `unavailable` + outcomeUnknown, 401 = config;
 *   - SENSITIVE DATA: the card number, expiry and SMS code never reach a log line, an Error
 *     message or the user message -- even when Click's own `error_note` echoes the card number.
 *
 * Mutations (each verified to fail the named test): digest over `secret + timestamp`
 * ("auth digest"); timestamp in milliseconds ("auth header"); `temporary: 0` ("request body");
 * logging the request body ("redaction: ...").
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.CLICK_SERVICE_ID = "777";
process.env.CLICK_MERCHANT_ID = "42";
process.env.CLICK_SECRET_KEY = "test-secret-key";
process.env.CLICK_MERCHANT_USER_ID = "55";

const cm = await import("../lib/server/click-merchant.ts");
const { env } = await import("../lib/server/env.ts");

const CARD = "8600123412341234";
const EXPIRE = "1228";
const SMS = "482915";
const ORDER = "0b8f6c1e-3d2a-4c8e-9a41-7e5d2f1a9b30";
const TOKEN = "3B1DF3F1-7358-407C-B57F-0F6351310803";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function mockFetch(t: TestContext, answers: Array<{ status?: number; body?: unknown; raw?: string; throws?: Error }>): Call[] {
  const calls: Call[] = [];
  let i = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const a = answers[Math.min(i++, answers.length - 1)];
    if (a.throws) throw a.throws;
    return new Response(a.raw ?? JSON.stringify(a.body ?? {}), { status: a.status ?? 200 });
  });
  return calls;
}

function captureLogs(t: TestContext): string[] {
  const lines: string[] = [];
  const push = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, push);
  return lines;
}

const ok = (extra: Record<string, unknown>) => ({ body: { error_code: 0, error_note: "Success", ...extra } });

test("auth digest: sha1(timestamp + secret_key), computed independently", () => {
  assert.equal(cm.clickAuthDigest("test-secret-key", 1700000000), "81c9fe90fd5fc43ef10a50c801f5103687b4bd00");
  assert.equal(cm.clickAuthDigest("abc", "1760000000"), "357d329b3ecb547ae5aed4c5b97a07688e2c77b0");
  // Order matters: secret + timestamp is a different digest.
  assert.notEqual(cm.clickAuthDigest("1700000000", "test-secret-key"), "81c9fe90fd5fc43ef10a50c801f5103687b4bd00");
  assert.equal(cm.clickAuthDigest("1700000000", "test-secret-key"), "2e232d53578053e8865f225f7cc688f6de0ee3a0");
});

test("auth header: <merchant_user_id>:<digest>:<10-digit unix seconds>", () => {
  const h = cm.clickAuthHeader("55", "test-secret-key", 1700000000_999);
  assert.equal(h, "55:81c9fe90fd5fc43ef10a50c801f5103687b4bd00:1700000000");
  assert.match(h.split(":")[2], /^\d{10}$/);
});

test("not configured: no request is made, config failure", async (t) => {
  const calls = mockFetch(t, [ok({})]);
  const saved = env.click.merchantUserId;
  (env.click as { merchantUserId: string }).merchantUserId = "";
  try {
    assert.equal(cm.clickMerchantConfigured(), false);
    await assert.rejects(
      () => cm.createInvoice({ phone: "998901234567", amountSoum: 1000, orderId: ORDER }),
      (e: unknown) => e instanceof cm.ClickMerchantError && e.failure === "config",
    );
    assert.equal(calls.length, 0);
  } finally {
    (env.click as { merchantUserId: string }).merchantUserId = saved;
  }
  assert.equal(cm.clickMerchantConfigured(), true);
});

test("request body: card_token/request, verify, payment, invoice/create (exact bodies, URLs, headers)", async (t) => {
  captureLogs(t);
  const calls = mockFetch(t, [
    ok({ card_token: TOKEN, phone_number: "+998*******97", temporary: true }),
    ok({ card_number: "8600 12** **** 1234" }),
    ok({ payment_id: 598761234, payment_status: 1 }),
    ok({ invoice_id: 1234567 }),
  ]);
  const a = await cm.requestCardToken({ cardNumber: CARD, expireDate: EXPIRE }, { orderId: ORDER, method: "card" });
  assert.deepEqual(a, { cardToken: TOKEN, phoneMasked: "+998*******97" });
  const b = await cm.verifyCardToken({ cardToken: TOKEN, smsCode: SMS }, { orderId: ORDER, method: "card" });
  assert.deepEqual(b, { cardMasked: "8600 12** **** 1234" });
  const c = await cm.payWithCardToken({ cardToken: TOKEN, amountSoum: 25_000, orderId: ORDER }, { orderId: ORDER, method: "card" });
  assert.deepEqual(c, { paymentId: "598761234", paymentStatus: 1 });
  const d = await cm.createInvoice({ phone: "998901234567", amountSoum: 25_000, orderId: ORDER }, { orderId: ORDER, method: "phone" });
  assert.deepEqual(d, { invoiceId: "1234567" });

  const base = "https://api.click.uz/v2/merchant";
  assert.deepEqual(
    calls.map((x) => [x.method, x.url]),
    [
      ["POST", `${base}/card_token/request`],
      ["POST", `${base}/card_token/verify`],
      ["POST", `${base}/card_token/payment`],
      ["POST", `${base}/invoice/create`],
    ],
  );
  assert.deepEqual(calls[0].body, { service_id: 777, card_number: CARD, expire_date: EXPIRE, temporary: 1 }, "request body: one-time token");
  assert.deepEqual(calls[1].body, { service_id: 777, card_token: TOKEN, sms_code: SMS });
  assert.deepEqual(calls[2].body, { service_id: 777, card_token: TOKEN, amount: 25_000, transaction_parameter: ORDER });
  assert.deepEqual(calls[3].body, { service_id: 777, amount: 25_000, phone_number: "998901234567", merchant_trans_id: ORDER });
  for (const x of calls) {
    assert.equal(x.headers.Accept, "application/json");
    assert.equal(x.headers["Content-Type"], "application/json");
    const [uid, digest, ts] = x.headers.Auth.split(":");
    assert.equal(uid, "55");
    assert.match(ts, /^\d{10}$/, "auth header: 10-digit seconds");
    assert.equal(digest, cm.clickAuthDigest("test-secret-key", ts));
    assert.ok(Math.abs(Number(ts) - Date.now() / 1000) < 5);
  }
});

test("status calls: GET urls (invoice, payment, by order id + date)", async (t) => {
  captureLogs(t);
  const calls = mockFetch(t, [
    ok({ invoice_status: -99, invoice_status_note: "Deleted" }),
    ok({ payment_status: 2 }),
    ok({ payment_id: 99 }),
  ]);
  assert.deepEqual(await cm.invoiceStatus("1234567"), { invoiceStatus: -99, note: "Deleted" });
  assert.deepEqual(await cm.paymentStatus("598761234"), { paymentStatus: 2 });
  assert.deepEqual(await cm.paymentStatusByOrder(ORDER, "2026-10-09"), { paymentId: "99" });
  const base = "https://api.click.uz/v2/merchant";
  assert.deepEqual(
    calls.map((x) => [x.method, x.url, x.body]),
    [
      ["GET", `${base}/invoice/status/777/1234567`, undefined],
      ["GET", `${base}/payment/status/777/598761234`, undefined],
      ["GET", `${base}/payment/status_by_mti/777/${ORDER}/2026-10-09`, undefined],
    ],
  );
  // Path parts are validated, never interpolated blindly.
  await assert.rejects(() => cm.invoiceStatus("1/../x"), cm.ClickMerchantError);
  await assert.rejects(() => cm.paymentStatusByOrder("not-an-order", "2026-10-09"), cm.ClickMerchantError);
  await assert.rejects(() => cm.paymentStatusByOrder(ORDER, "09.10.2026"), cm.ClickMerchantError);
  assert.equal(calls.length, 3, "invalid ids make no request");
});

test("payment_status < 0 in an error_code 0 answer is a decline", async (t) => {
  captureLogs(t);
  mockFetch(t, [ok({ payment_id: 5, payment_status: -1 })]);
  await assert.rejects(
    () => cm.payWithCardToken({ cardToken: TOKEN, amountSoum: 1000, orderId: ORDER }),
    (e: unknown) => e instanceof cm.ClickMerchantError && e.failure === "declined" && e.stage === "card_payment",
  );
});

test("error mapping: documented codes, keyword rules, stage fallback", () => {
  const m = cm.clickErrorMessage;
  assert.match(m("card_payment", -1, "SIGN CHECK FAILED!").message, /hozircha mavjud emas/);
  assert.equal(m("card_payment", -2, "").message, "Summa noto'g'ri");
  assert.equal(m("card_payment", -4, "Already paid").message, "Bu buyurtma allaqachon to'langan");
  assert.equal(m("card_payment", -5, "").message, "Buyurtma topilmadi");
  assert.equal(m("card_payment", -9, "").message, "To'lov bekor qilingan");
  assert.match(m("card_payment", -400, "Insufficient funds").message, /mablag' yetarli emas/);
  assert.match(m("card_payment", -400, "Недостаточно средств").message, /mablag' yetarli emas/);
  assert.match(m("card_request", -401, "Card expired").message, /muddati/);
  assert.match(m("card_verify", -402, "Wrong SMS code").message, /SMS kod noto'g'ri/);
  assert.match(m("card_request", -403, "Card not found").message, /Karta topilmadi/);
  // No prefix allow-list on our side: Click's own refusal of a card range must read clearly.
  assert.match(m("card_request", -500, "Card type is not supported").message, /Click orqali qabul qilinmaydi/);
  assert.match(m("card_request", -500, "Тип карты не поддерживается").message, /Click orqali qabul qilinmaydi/);
  assert.match(m("invoice_create", -404, "Subscriber not found").message, /Hisob-faktura yuborilmadi/);
  // Stage-scoped: "Card expired" at the invoice stage is not a card message.
  assert.match(m("invoice_create", -405, "Card expired").message, /Hisob yuborilmadi/);
  for (const stage of ["card_request", "card_verify", "card_payment", "invoice_create"] as const) {
    const r = m(stage, -999, "???");
    assert.equal(r.known, false);
    assert.ok(r.message.length > 10 && /[a-z]/.test(r.message));
  }
});

test("declined: known code -> declined + Uzbek message; unknown -> logged with code and note", async (t) => {
  const lines = captureLogs(t);
  mockFetch(t, [
    { body: { error_code: -9, error_note: "Transaction cancelled" } },
    { body: { error_code: -777, error_note: "Something new" } },
  ]);
  await assert.rejects(
    () => cm.createInvoice({ phone: "998901234567", amountSoum: 1000, orderId: ORDER }, { orderId: ORDER, method: "phone" }),
    (e: unknown) =>
      e instanceof cm.ClickMerchantError && e.failure === "declined" && e.errorCode === -9 && e.userMessage === "To'lov bekor qilingan" && !e.outcomeUnknown,
  );
  await assert.rejects(
    () => cm.createInvoice({ phone: "998901234567", amountSoum: 1000, orderId: ORDER }, { orderId: ORDER, method: "phone" }),
    (e: unknown) => e instanceof cm.ClickMerchantError && e.failure === "unknown" && e.errorCode === -777,
  );
  const rows = lines.map((l) => JSON.parse(l));
  const unknown = rows.find((r) => r.errorCode === -777);
  assert.ok(unknown, "unknown error_code is logged");
  assert.equal(unknown.errorNote, "Something new");
  assert.equal(unknown.orderId, ORDER);
  assert.equal(unknown.method, "phone");
  assert.equal(unknown.stage, "invoice_create");
});

test("outages: 5xx / network / timeout = unavailable + outcomeUnknown; 401/403 = config; garbage = unknown", async (t) => {
  const lines = captureLogs(t);
  const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  mockFetch(t, [
    { status: 502, raw: "<html>bad gateway</html>" },
    { throws: new TypeError("fetch failed") },
    { throws: abort },
    { status: 401, body: { error_code: -1, error_note: "auth" } },
    { status: 403, raw: "" },
    { status: 200, raw: "not json" },
    { status: 200, body: { note: "no error_code" } },
  ]);
  const run = () => cm.payWithCardToken({ cardToken: TOKEN, amountSoum: 1000, orderId: ORDER }, { orderId: ORDER, method: "card" });
  const fail = async () => {
    try {
      await run();
    } catch (e) {
      return e as InstanceType<typeof cm.ClickMerchantError>;
    }
    throw new Error("expected a failure");
  };
  for (const [label, failure, unknown] of [
    ["502", "unavailable", true],
    ["network", "unavailable", true],
    ["timeout", "unavailable", true],
    ["401", "config", false],
    ["403", "config", false],
    ["non-json 200", "unknown", true],
    ["no error_code 200", "unknown", true],
  ] as const) {
    const e = await fail();
    assert.ok(e instanceof cm.ClickMerchantError, label);
    assert.equal(e.failure, failure, label);
    assert.equal(e.outcomeUnknown, unknown, label);
  }
  assert.ok(lines.some((l) => JSON.parse(l).reason === "timeout"));
  assert.ok(lines.some((l) => JSON.parse(l).level === "error" && /credentials rejected/.test(l)), "bad credentials are an error-level log");
});

test("request timeout is enforced (AbortController, 15 s)", async (t) => {
  captureLogs(t);
  assert.equal(cm.CLICK_TIMEOUT_MS, 15_000);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) =>
    new Promise((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  );
  const p = cm.createInvoice({ phone: "998901234567", amountSoum: 1000, orderId: ORDER });
  const settled = assert.rejects(p, (e: unknown) => e instanceof cm.ClickMerchantError && e.failure === "unavailable" && e.outcomeUnknown);
  t.mock.timers.tick(cm.CLICK_TIMEOUT_MS + 1);
  await settled;
});

test("redaction: card number, expiry and SMS code never reach a log line, an error or the user message", async (t) => {
  const lines = captureLogs(t);
  const SECRETS = [CARD, "8600 1234 1234 1234", EXPIRE, SMS];
  const echo = `Ref ${CARD} exp=${EXPIRE} sms_code=${SMS} pan ${CARD.slice(0, 4)} ${CARD.slice(4, 8)} ${CARD.slice(8, 12)} ${CARD.slice(12)}`;
  mockFetch(t, [
    ok({ card_token: TOKEN, phone_number: "+998*******97" }),
    { body: { error_code: -123, error_note: echo } },
    { body: { error_code: -124, error_note: echo } },
    { status: 500, raw: echo },
    { throws: new TypeError(`fetch failed ${CARD} ${SMS}`) },
  ]);
  const errors: unknown[] = [];
  await cm.requestCardToken({ cardNumber: CARD, expireDate: EXPIRE }, { orderId: ORDER, method: "card" });
  for (const fn of [
    () => cm.requestCardToken({ cardNumber: CARD, expireDate: EXPIRE }, { orderId: ORDER, method: "card" }),
    () => cm.verifyCardToken({ cardToken: TOKEN, smsCode: SMS }, { orderId: ORDER, method: "card" }),
    () => cm.requestCardToken({ cardNumber: CARD, expireDate: EXPIRE }, { orderId: ORDER, method: "card" }),
    () => cm.verifyCardToken({ cardToken: TOKEN, smsCode: SMS }, { orderId: ORDER, method: "card" }),
  ]) {
    try {
      await fn();
    } catch (e) {
      errors.push(e);
    }
  }
  assert.equal(errors.length, 4);
  const dump = lines.join("\n");
  assert.ok(lines.length >= 5, "something was logged");
  for (const s of SECRETS) assert.ok(!dump.includes(s), `a log line contains ${s.length === 4 ? "the expiry" : s.length === 6 ? "the SMS code" : "the card number"}`);
  for (const e of errors as InstanceType<typeof cm.ClickMerchantError>[]) {
    const text = `${e.message} ${e.userMessage} ${e.stack ?? ""} ${JSON.stringify(e)}`;
    for (const s of SECRETS) assert.ok(!text.includes(s), "an error object contains card data");
  }
  // Click's own note echoed the card number: the log redaction removed it.
  assert.ok(dump.includes("[CARD]"), "the echoed card number was redacted");
  // The card token is a credential too: never logged.
  assert.ok(!dump.includes(TOKEN));
});

test("log redaction layer: card-shaped numbers and card/sms fields are scrubbed", async () => {
  const { redact, log } = await import("../lib/server/log.ts");
  for (const n of ["8600123412341234", "8600 1234 1234 1234", "9860-1234-1234-1234", "5614 1234 1234 1234"]) {
    assert.ok(!redact(`pay ${n} now`).includes(n.slice(0, 8)), n);
  }
  assert.equal(redact("masked 8600 55** **** 3244 stays"), "masked 8600 55** **** 3244 stays");
  assert.equal(redact("order 0b8f6c1e-3d2a-4c8e-9a41-7e5d2f1a9b30 ts 1760000000123"), "order 0b8f6c1e-3d2a-4c8e-9a41-7e5d2f1a9b30 ts 1760000000123");
  assert.equal(redact('{"card_number":"8600123412341234","sms_code":"482915","expire_date":"1228"}').includes("482915"), false);
  assert.equal(redact("sms_code=482915&expire_date=1228").includes("482915"), false);
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    log("info", "x", { cardNumber: CARD, card_number: CARD, expire_date: EXPIRE, sms_code: SMS, card_token: TOKEN, nested: { sms_code: SMS }, orderId: ORDER });
  } finally {
    console.log = orig;
  }
  const row = JSON.parse(lines[0]);
  assert.equal(row.cardNumber, "[REDACTED]");
  assert.equal(row.card_number, "[REDACTED]");
  assert.equal(row.expire_date, "[REDACTED]");
  assert.equal(row.sms_code, "[REDACTED]");
  assert.equal(row.card_token, "[REDACTED]");
  assert.equal(row.nested.sms_code, "[REDACTED]");
  assert.equal(row.orderId, ORDER);
});
