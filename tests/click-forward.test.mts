import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Click callbacks of Bandlik.uz (vakant3, `merchant_trans_id` starts with `vk-`) are forwarded UNCHANGED to abitur24.uz and its JSON
 * reply is returned to Click as is; SlaydX touches nothing for them. Everything else follows the old path. `fetch` is stubbed (no network).
 *
 * MUTATIONS checked (each turned the named tests red, then reverted):
 *   - prefix check removed (every request forwarded / none forwarded)  -> «forwarded», «non-vk»;
 *   - body altered before forwarding (e.g. re-serialised)               -> «byte for byte», «JSON body»;
 *   - an upstream error swallowed as success                            -> «upstream failures»;
 *   - Content-Type not passed through                                   -> «byte for byte».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.CLICK_SERVICE_ID = "777";
process.env.CLICK_MERCHANT_ID = "42";
process.env.CLICK_SECRET_KEY = "click-secret-key";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("clickfwd") : { isolated: false, drop: async () => {} };
const SKIP_DB = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const URL_ = "https://abitur24.test/api/payments/click";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; method?: string; headers: Record<string, string>; body: string };
function stubFetch(handler: (seen: Seen) => Response | Promise<Response>): Seen[] {
  const calls: Seen[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const seen: Seen = {
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()),
      body: String(init?.body ?? ""),
    };
    calls.push(seen);
    return handler(seen);
  }) as unknown as typeof fetch;
  return calls;
}

async function setup() {
  const { env } = await import("../lib/server/env.ts");
  Object.assign(env.click, { vakantForwardUrl: URL_ });
  return { route: await import("../app/api/payments/click/route.ts"), fwd: await import("../lib/server/click-forward.ts") };
}

const FORM_PREPARE =
  "click_trans_id=9001&service_id=777&click_paydoc_id=555&merchant_trans_id=vk-1234&amount=50000.0&action=0&error=0&error_note=Success&sign_time=2026-10-16+10%3A00%3A00&sign_string=0123456789abcdef0123456789abcdef";
const FORM_COMPLETE =
  "click_trans_id=9001&service_id=777&merchant_trans_id=vk-1234&merchant_prepare_id=42&amount=50000.0&action=1&error=0&error_note=Success&sign_time=2026-10-16+10%3A01%3A00&sign_string=fedcba9876543210fedcba9876543210";
// Deliberately odd spacing / key order: the reply must be returned byte for byte, not re-serialised.
const UPSTREAM_REPLY = '{ "merchant_prepare_id" : 42,"click_trans_id":9001, "merchant_trans_id":"vk-1234",\n "error":0,"error_note":"Success" }';

const post = (route: { POST(req: Request): Promise<Response> }, body: string, contentType = "application/x-www-form-urlencoded") =>
  route.POST(new Request("http://x/api/payments/click", { method: "POST", headers: { "content-type": contentType }, body }));

test("helpers: merchant_trans_id of form and JSON bodies; only the vk- prefix counts", async () => {
  const { fwd } = await setup();
  assert.equal(fwd.merchantTransIdOf(FORM_PREPARE, "application/x-www-form-urlencoded"), "vk-1234");
  assert.equal(fwd.merchantTransIdOf(JSON.stringify({ merchant_trans_id: "vk-77" }), "application/json"), "vk-77");
  assert.equal(fwd.merchantTransIdOf(JSON.stringify({ merchant_trans_id: 12 }), "application/json"), "12");
  for (const bad of ["", "{", "not json"]) assert.equal(fwd.merchantTransIdOf(bad, "application/json"), null);
  assert.equal(fwd.merchantTransIdOf("a=1", "application/x-www-form-urlencoded"), null);
  assert.equal(fwd.isVakantOrder("vk-1"), true);
  for (const no of [null, "", "VK-1", "xvk-1", "vk", " vk-1", "1b4e28ba-2fa1-11d2-883f-0016d3cca427"]) assert.equal(fwd.isVakantOrder(no), false, String(no));
});

test("forwarded: vk- Prepare and Complete go to VAKANT_CLICK_FORWARD_URL byte for byte (same Content-Type, X-Forwarded-By); the upstream JSON comes back verbatim", async () => {
  const { route } = await setup();
  for (const body of [FORM_PREPARE, FORM_COMPLETE]) {
    const calls = stubFetch(() => new Response(UPSTREAM_REPLY, { status: 200, headers: { "content-type": "application/json" } }));
    const res = await post(route, body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, URL_);
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.body, body, "body forwarded unchanged");
    assert.equal(calls[0]!.headers["content-type"], "application/x-www-form-urlencoded");
    assert.equal(calls[0]!.headers["x-forwarded-by"], "slaydx");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(await res.text(), UPSTREAM_REPLY, "reply not re-signed, re-shaped or filtered");
  }
});

test("JSON body: vk- is forwarded with its application/json Content-Type and the raw text", async () => {
  const { route } = await setup();
  const body = '{"click_trans_id": 9002 , "service_id":"777","merchant_trans_id":"vk-88","amount":1000,"action":0,"sign_string":"x"}';
  const calls = stubFetch(() => new Response(UPSTREAM_REPLY, { status: 200 }));
  const res = await post(route, body, "application/json");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.body, body);
  assert.equal(calls[0]!.headers["content-type"], "application/json");
  assert.equal(await res.text(), UPSTREAM_REPLY);
});

test("upstream failures (timeout, network error, 500, 302, 404, invalid JSON, JSON array, empty) -> Click error -7 «forward_failed», never success", async () => {
  const { route } = await setup();
  const cases: Array<[string, () => Response | Promise<Response>]> = [
    ["timeout", () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }],
    ["network", () => { throw new TypeError("fetch failed"); }],
    ["500", () => new Response("boom", { status: 500 })],
    ["302", () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } })],
    ["404", () => new Response("{}", { status: 404 })],
    ["not json", () => new Response("<html>ok</html>", { status: 200 })],
    ["json array", () => new Response("[1,2]", { status: 200 })],
    ["empty", () => new Response("", { status: 200 })],
  ];
  for (const [name, h] of cases) {
    const calls = stubFetch(h);
    const res = await post(route, FORM_COMPLETE);
    const body = (await res.json()) as { error: number; error_note: string; merchant_trans_id: string; click_trans_id: number };
    assert.equal(calls.length, 1, name);
    assert.equal(res.status, 200, name);
    assert.equal(body.error, -7, `${name}: Click must not complete the payment`);
    assert.equal(body.error_note, "forward_failed", name);
    assert.equal(body.merchant_trans_id, "vk-1234", name);
    assert.equal(body.click_trans_id, 9001, name);
  }
});

test("the forward uses an 8 s timeout signal and does not follow redirects", async () => {
  const { route, fwd } = await setup();
  assert.equal(fwd.FORWARD_TIMEOUT_MS, 8_000);
  let init: RequestInit | undefined;
  globalThis.fetch = (async (_u: unknown, i?: RequestInit) => {
    init = i;
    return new Response(UPSTREAM_REPLY, { status: 200 });
  }) as unknown as typeof fetch;
  await post(route, FORM_PREPARE);
  assert.equal(init?.redirect, "manual");
  assert.ok(init?.signal instanceof AbortSignal);
});

test("log: one line per forwarded call (action, merchant_trans_id, upstream status, ms) and never the sign_string", async () => {
  const { route } = await setup();
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => {
    chunks.push(String(c));
    return true;
  }) as typeof process.stdout.write;
  try {
    stubFetch(() => new Response(UPSTREAM_REPLY, { status: 200 }));
    await post(route, FORM_COMPLETE);
  } finally {
    process.stdout.write = realWrite;
  }
  const lines = chunks.join("").split("\n").filter((l) => l.includes("forwarded to vakant"));
  assert.equal(lines.length, 1, chunks.join(""));
  assert.match(lines[0]!, /"action":"1"/);
  assert.match(lines[0]!, /"merchantTransId":"vk-1234"/);
  assert.match(lines[0]!, /"upstreamStatus":200/);
  assert.match(lines[0]!, /"ms":\d+/);
  assert.ok(!chunks.join("").includes("fedcba9876543210"), "sign_string must never be logged");
});

test("an oversized body is not forwarded and not parsed", async () => {
  const { route } = await setup();
  const calls = stubFetch(() => new Response(UPSTREAM_REPLY, { status: 200 }));
  const res = await post(route, `merchant_trans_id=vk-1&${"a=".padEnd(70_000, "x")}`);
  assert.equal(calls.length, 0);
  assert.equal(((await res.json()) as { error: number }).error, -8);
});

test("SlaydX order ids can never start with vk-: the order id is a UUID (hex + dashes) and the prefix has a non-hex letter", async () => {
  const { fwd } = await setup();
  assert.ok(!/^[0-9a-f-]+$/i.test(fwd.VAKANT_PREFIX), "«v» is not a hex digit, so no UUID can start with vk-");
  const src = readFileSync(new URL("../lib/server/payments.ts", import.meta.url), "utf8");
  assert.match(src, /INSERT INTO payment_orders \(id[^)]*\)[\s\S]{0,120}\[randomUUID\(\)/, "createOrder takes the id from randomUUID()");
  assert.ok(!/merchant_trans_id\s*[:=]\s*[`"']vk-/.test(src), "payments.ts never builds a vk- id");
  const { randomUUID } = await import("node:crypto");
  for (let i = 0; i < 2000; i++) assert.equal(fwd.isVakantOrder(randomUUID()), false);
});

test("non-vk request: the old path runs, nothing is forwarded; a vk- callback touches no SlaydX table", { skip: SKIP_DB }, async (t) => {
  const { route } = await setup();
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const count = async () => ({
    orders: Number((await query<{ n: string }>("SELECT count(*) n FROM payment_orders"))[0]!.n),
    events: Number((await query<{ n: string }>("SELECT count(*) n FROM payment_events"))[0]!.n),
  });
  const before = await count();

  // vk-: forwarded, no SlaydX row written.
  stubFetch(() => new Response(UPSTREAM_REPLY, { status: 200 }));
  await post(route, FORM_PREPARE);
  stubFetch(() => new Response("boom", { status: 500 }));
  await post(route, FORM_COMPLETE);
  assert.deepEqual(await count(), before, "no payment_orders / payment_events row for a vk- callback");

  // Own order id: never forwarded; wrong service_id -> the old -1 reply, an unknown UUID with a valid-looking body -> sign/-5 path.
  const calls = stubFetch(() => new Response(UPSTREAM_REPLY, { status: 200 }));
  const res = await post(route, FORM_PREPARE.replace("merchant_trans_id=vk-1234", "merchant_trans_id=3f2b8c1e-0000-4000-8000-000000000001").replace("service_id=777", "service_id=999"));
  assert.equal(calls.length, 0, "a SlaydX order is never forwarded");
  assert.equal(((await res.json()) as { error: number }).error, -1, "old behaviour: service_id mismatch");
  const res2 = await post(route, "click_trans_id=1&service_id=777&merchant_trans_id=abc&amount=1&action=0&sign_time=t&sign_string=bad");
  assert.equal(calls.length, 0);
  assert.equal(((await res2.json()) as { error: number }).error, -1, "old behaviour: bad signature");
});
