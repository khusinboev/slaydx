import test from "node:test";
import assert from "node:assert/strict";

/**
 * Bot API transport `callBot` (docs/mobile/PLAN.md §4.4): JSON and multipart
 * bodies, Telegram error codes kept, 429 retried once, timeouts, and the
 * token never leaving the URL path. `fetch` is stubbed with a fake token; no
 * network, no DB. The legacy `sendMessage` semantics stay locked by
 * `tests/telegram-429.test.mts` / `telegram-webhook.test.mts`.
 *
 * Mutations (each turned a test red):
 *   1. multipart branch sent `Content-Type: application/json` — «multipart: fetch sets the boundary»;
 *   2. `code` hard-coded to 400 on failures — «403 keeps its code»;
 *   3. 429 retry removed — «429 once then ok»;
 *   4. multipart default timeout = JSON default — «default timeouts»;
 *   5. `NONCE_RE` length 31 — «isLoginNonce accepts real nonces».
 */

const TOKEN = "123456:FAKE-transport-token-never-sent";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.TELEGRAM_BOT_TOKEN = TOKEN;

const tg = await import("../lib/server/telegram.ts");
const { callBot, UPLOAD_TIMEOUT_MS, isTransientBotFailure, isLoginNonce } = tg;

type Seen = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(replies: (() => Response | Promise<Response>)[]): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return replies[Math.min(seen.length - 1, replies.length - 1)]();
  }) as typeof fetch;
  return seen;
}

const reply = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

test("JSON call: POST to /bot<token>/<method>, JSON body, result returned", async () => {
  const seen = stub([reply({ ok: true, result: { message_id: 9 } })]);
  const r = await callBot<{ message_id: number }>("sendDocument", { chat_id: 777, document: "BQ-FAKE" });
  assert.deepEqual(r, { ok: true, result: { message_id: 9 } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `https://api.telegram.org/bot${TOKEN}/sendDocument`);
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(seen[0].init.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { chat_id: 777, document: "BQ-FAKE" });
  assert.ok(!String(seen[0].init.body).includes(TOKEN), "token in a body");
});

test("multipart call: FormData passed as is, no Content-Type header (fetch sets the boundary)", async () => {
  const seen = stub([reply({ ok: true, result: { message_id: 1, document: { file_id: "BQ" } } })]);
  const form = new FormData();
  form.set("chat_id", "777");
  form.set("document", new Blob([new Uint8Array(2048).fill(7)], { type: "application/pdf" }), "Quyosh tizimi.pdf");
  const r = await callBot("sendDocument", form, { multipart: true });
  assert.equal(r.ok, true);
  assert.equal(seen[0].init.body, form, "the FormData object itself is the body");
  assert.equal(seen[0].init.headers, undefined, "multipart must not set Content-Type");
  const sent = seen[0].init.body as FormData;
  const file = sent.get("document") as File;
  assert.equal(file.name, "Quyosh tizimi.pdf");
  assert.equal(file.size, 2048);
  assert.equal(sent.get("chat_id"), "777");
});

test("permanent errors keep Telegram's code and description (403, 400) and are not retried", async () => {
  let seen = stub([reply({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, 403)]);
  assert.deepEqual(await callBot("sendMessage", { chat_id: 1, text: "x" }), {
    ok: false,
    code: 403,
    description: "Forbidden: bot was blocked by the user",
  });
  assert.equal(seen.length, 1);
  seen = stub([reply({ ok: false, error_code: 400, description: "Bad Request: wrong file identifier/HTTP URL specified" }, 400)]);
  const r = await callBot("sendDocument", { chat_id: 1, document: "x" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, 400);
  assert.equal(seen.length, 1);
});

test("429 with retry_after <= 5 s: one retry after waiting, then the result", async () => {
  const seen = stub([
    reply({ ok: false, error_code: 429, description: "Too Many Requests: retry after 1", parameters: { retry_after: 1 } }, 429),
    reply({ ok: true, result: true }),
  ]);
  const t0 = Date.now();
  assert.deepEqual(await callBot("answerInlineQuery", {}), { ok: true, result: true });
  assert.equal(seen.length, 2);
  assert.ok(Date.now() - t0 >= 950, "retry_after was not honoured");
});

test("429 twice: exactly one retry, then { code: 429 }; long retry_after: no retry", async () => {
  let seen = stub([reply({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 0 } }, 429)]);
  const r = await callBot("sendMessage", {});
  assert.equal(seen.length, 2);
  assert.equal(!r.ok && r.code, 429);
  seen = stub([reply({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 30 } }, 429)]);
  const t0 = Date.now();
  const r2 = await callBot("sendMessage", {});
  assert.equal(seen.length, 1);
  assert.equal(!r2.ok && r2.code, 429);
  assert.ok(Date.now() - t0 < 500);
});

test("network failure, non-JSON body (proxy 502 HTML) → code 0, transient", async () => {
  stub([() => Promise.reject(new TypeError("fetch failed"))]);
  const a = await callBot("sendMessage", {});
  assert.equal(a.ok, false);
  assert.equal(!a.ok && a.code, 0);
  stub([() => new Response("<html>502 Bad Gateway</html>", { status: 502 })]);
  const b = await callBot("sendMessage", {});
  assert.equal(!b.ok && b.code, 0);
  for (const r of [a, b]) if (!r.ok) assert.equal(isTransientBotFailure(r), true);
  assert.equal(isTransientBotFailure({ ok: false, code: 503 }), true);
  assert.equal(isTransientBotFailure({ ok: false, code: 429 }), true);
  assert.equal(isTransientBotFailure({ ok: false, code: 403 }), false);
  assert.equal(isTransientBotFailure({ ok: false, code: 400 }), false);
});

test("timeoutMs aborts a hanging request → code 0", async () => {
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof fetch;
  // AbortSignal.timeout's timer is unref'd: keep the event loop alive while waiting.
  const keepAlive = setTimeout(() => {}, 5_000);
  const t0 = Date.now();
  const r = await callBot("sendDocument", new FormData(), { multipart: true, timeoutMs: 60 });
  clearTimeout(keepAlive);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, 0);
  assert.ok(Date.now() - t0 < 2_000, "the timeout did not abort the request");
});

test("default timeouts: 15 s for JSON, UPLOAD_TIMEOUT_MS (>= 60 s) for multipart", async (t) => {
  const asked: number[] = [];
  const real = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    asked.push(ms);
    return real(ms);
  });
  stub([reply({ ok: true, result: true })]);
  await callBot("sendMessage", {});
  await callBot("sendDocument", new FormData(), { multipart: true });
  await callBot("sendDocument", new FormData(), { multipart: true, timeoutMs: 5 });
  assert.deepEqual(asked, [15_000, UPLOAD_TIMEOUT_MS, 5]);
  assert.ok(UPLOAD_TIMEOUT_MS >= 60_000, "a 25 MB upload needs at least a minute");
});

test("a custom fetch implementation is used instead of the global one", async () => {
  const seen = stub([reply({ ok: true, result: "global" })]);
  const calls: string[] = [];
  const own = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ok: true, result: "own" }));
  }) as typeof fetch;
  assert.deepEqual(await callBot("getMe", {}, { fetch: own }), { ok: true, result: "own" });
  assert.equal(calls.length, 1);
  assert.equal(seen.length, 0);
});

test("isLoginNonce: exactly the shape createTicket makes (32 base64url chars)", async () => {
  const { randomBytes } = await import("node:crypto");
  for (let i = 0; i < 50; i++) assert.equal(isLoginNonce(randomBytes(24).toString("base64url")), true);
  assert.equal(isLoginNonce(""), false);
  assert.equal(isLoginNonce("inline"), false);
  assert.equal(isLoginNonce("s_00000000-0000-4000-8000-000000000001"), false);
  assert.equal(isLoginNonce("a".repeat(31)), false);
  assert.equal(isLoginNonce("a".repeat(33)), false);
  assert.equal(isLoginNonce(`${"a".repeat(31)}=`), false);
  assert.equal(isLoginNonce(`${"a".repeat(31)} `), false);
});
