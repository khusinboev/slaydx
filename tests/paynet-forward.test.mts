import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Bandlik.uz (vakant3) shares SlaydX's Paynet endpoint: a request whose serviceId is in PAYNET_VAKANT_SERVICE_IDS, or whose
 * `params.fields` carries a `vk-` / `vk_` payer, is POSTed UNCHANGED (body, Content-Type, Authorization) to
 * VAKANT_PAYNET_FORWARD_URL before SlaydX's own IP / auth checks, and the JSON reply goes back verbatim. SlaydX writes nothing.
 * `fetch` is stubbed (no network).
 *
 * MUTATIONS checked (each turned the named tests red, then reverted):
 *   F1 forward decision removed (never forwarded)                       → «serviceId», «vk- payer»
 *   F2 forward decided AFTER auth                                       → «before SlaydX's IP and auth»
 *   F3 Authorization not passed through                                 → «serviceId»
 *   F4 body re-serialised before forwarding                             → «serviceId» (byte for byte)
 *   F5 upstream failure answered as success                             → «upstream failures»
 *   F6 forwarded call also recorded in payment_events (forward leak)    → «nothing written»
 *   F7 a vk- payer under our serviceId forwarded (payer-prefix routing)  → «NOT forwarded»
 *   F9 forward before the IP allow-list                                  → «IP allow-list runs FIRST»
 *   F8 one in-flight budget shared by Click and Paynet                  → «at most MAX_IN_FLIGHT»
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.PAYNET_USERNAME = "paynet-user";
process.env.PAYNET_PASSWORD = "paynet-pass";
process.env.PAYNET_SERVICE_IDS = "101";
process.env.PAYNET_VAKANT_SERVICE_IDS = "909,910";
process.env.PAYNET_ALLOWED_IPS = "";
process.env.CLICK_SERVICE_ID = "777";
process.env.CLICK_SECRET_KEY = "click-secret-key";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("paynetfwd") : { isolated: false, drop: async () => {} };
const SKIP_DB = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const URL_ = "https://abitur24.test/api/payments/paynet";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; method?: string; headers: Record<string, string>; body: string; init?: RequestInit };
function stubFetch(handler: (seen: Seen) => Response | Promise<Response>): Seen[] {
  const calls: Seen[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const seen: Seen = {
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()),
      body: String(init?.body ?? ""),
      init,
    };
    calls.push(seen);
    return handler(seen);
  }) as unknown as typeof fetch;
  return calls;
}

async function setup() {
  const { env } = await import("../lib/server/env.ts");
  Object.assign(env.paynet, { vakantForwardUrl: URL_, allowedIps: [] });
  return { env, route: await import("../app/api/payments/paynet/route.ts"), fwd: await import("../lib/server/click-forward.ts") };
}

const BANDLIK_AUTH = `Basic ${Buffer.from("bandlik:their-own-pass").toString("base64")}`;
// Odd spacing / key order on purpose: forwarded and returned byte for byte, never re-serialised.
const BY_SERVICE = '{"jsonrpc":"2.0","id":17, "method":"PerformTransaction","params":{"serviceId":909,"amount":500000,"transactionId":88001,"fields":{"phone":"998900000001"}}}';
const BY_PAYER = '{ "jsonrpc":"2.0","method":"GetInformation","id":"g-1","params":{"serviceId":101,"fields":{"client_id":"vk-4521"}} }';
const BY_PAYER_US = '{"jsonrpc":"2.0","id":3,"method":"PerformTransaction","params":{"serviceId":101,"amount":100000,"transactionId":88002,"fields":{"client_id":"vk_77"}}}';
const UPSTREAM = '{ "jsonrpc":"2.0", "id":17,\n "result":{"providerTrnId":5,"timestamp":"2026-10-16 10:00:00","fields":{"balance":1}} }';

const post = (route: { POST(req: Request): Promise<Response> }, body: string, headers: Record<string, string> = {}) =>
  route.POST(new Request("http://x/api/payments/paynet", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }));

test("serviceId in PAYNET_VAKANT_SERVICE_IDS: forwarded byte for byte with Content-Type + Authorization + X-Forwarded-By; reply verbatim", async () => {
  const { route } = await setup();
  const calls = stubFetch(() => new Response(UPSTREAM, { status: 200, headers: { "content-type": "application/json" } }));
  const res = await post(route, BY_SERVICE, { authorization: BANDLIK_AUTH, "content-type": "application/json; charset=utf-8" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, URL_);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.body, BY_SERVICE, "body forwarded unchanged");
  assert.equal(calls[0]!.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(calls[0]!.headers.authorization, BANDLIK_AUTH, "Bandlik's own Basic header is passed through");
  assert.equal(calls[0]!.headers["x-forwarded-by"], "slaydx");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(await res.text(), UPSTREAM);
});

test("a vk- / vk_ payer under OUR serviceId is NOT forwarded (routing is by serviceId only): SlaydX answers itself", async () => {
  const { route } = await setup();
  for (const body of [BY_PAYER, BY_PAYER_US]) {
    const calls = stubFetch(() => new Response(UPSTREAM, { status: 200 }));
    const res = await post(route, body, { authorization: BANDLIK_AUTH });
    assert.equal(calls.length, 0, body);
    assert.equal(res.status, 401, "meets SlaydX's own auth, not Bandlik's");
  }
});

test("on a config overlap our own serviceIds win: never forwarded", async () => {
  const { route, env } = await setup();
  const saved = { ...env.paynet };
  try {
    Object.assign(env.paynet, { vakantServiceIds: [909, 101] });
    const calls = stubFetch(() => new Response(UPSTREAM, { status: 200 }));
    await post(route, BY_PAYER, { authorization: BANDLIK_AUTH });
    assert.equal(calls.length, 0);
  } finally {
    Object.assign(env.paynet, saved);
  }
});

test("not Bandlik: VK-, xvk-, numeric ids, other serviceIds are NOT forwarded (they meet SlaydX's own auth)", async () => {
  const { route } = await setup();
  for (const body of [
    BY_PAYER.replace("vk-4521", "VK-4521"),
    BY_PAYER.replace("vk-4521", "xvk-4521"),
    BY_PAYER.replace('"vk-4521"', "4521"),
    BY_SERVICE.replace('"serviceId":909', '"serviceId":101'),
    BY_SERVICE.replace('"serviceId":909', '"serviceId":9090'),
    '{"jsonrpc":"2.0","id":1,"method":"GetInformation","params":{"serviceId":101,"note":"vk-1","fields":{"client_id":"5"}}}',
  ]) {
    const calls = stubFetch(() => new Response(UPSTREAM, { status: 200 }));
    const res = await post(route, body, { authorization: BANDLIK_AUTH });
    assert.equal(calls.length, 0, body);
    assert.equal(res.status, 401, "Bandlik's credentials are not SlaydX's");
  }
});

test("the IP allow-list runs FIRST: a caller outside Paynet's ranges is never forwarded (no open relay); an allowed one is forwarded before SlaydX's own auth, even when SlaydX's own Paynet is not configured", async () => {
  const { route, env } = await setup();
  const saved = { ...env.paynet };
  const trust = env.trustProxy;
  try {
    Object.assign(env, { trustProxy: true });
    Object.assign(env.paynet, { allowedIps: ["213.230.106.112/28"], username: "", password: "", serviceIds: [] });
    const denied = stubFetch(() => new Response(UPSTREAM, { status: 200 }));
    const res403 = await post(route, BY_SERVICE, { "x-forwarded-for": "10.0.0.1" });
    assert.equal(denied.length, 0, "forged / foreign caller is not relayed");
    assert.equal(res403.status, 403);
    const allowed = stubFetch(() => new Response(UPSTREAM, { status: 200 }));
    const res = await post(route, BY_SERVICE, { "x-forwarded-for": "213.230.106.115" });
    assert.equal(allowed.length, 1);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), UPSTREAM);
  } finally {
    Object.assign(env.paynet, saved);
    Object.assign(env, { trustProxy: trust });
  }
});

test("upstream failures (timeout, network, 500, 302, 404, invalid JSON, array, empty, >16 KB) → JSON-RPC -32603 «forward_failed», id echoed", async () => {
  const { route, fwd } = await setup();
  const cases: Array<[string, () => Response | Promise<Response>]> = [
    ["timeout", () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }],
    ["network", () => { throw new TypeError("fetch failed"); }],
    ["500", () => new Response("boom", { status: 500 })],
    ["302", () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } })],
    ["404", () => new Response("{}", { status: 404 })],
    ["not json", () => new Response("<html>ok</html>", { status: 200 })],
    ["json array", () => new Response("[1,2]", { status: 200 })],
    ["empty", () => new Response("", { status: 200 })],
    ["too large", () => new Response(`{"pad":"${"x".repeat(fwd.MAX_REPLY_BYTES)}"}`, { status: 200 })],
  ];
  for (const [name, h] of cases) {
    for (const [body, id] of [[BY_SERVICE, 17], [BY_SERVICE.replace(/"id"\s*:\s*17/, '"id":"g-1"'), "g-1"]] as const) {
      const calls = stubFetch(h);
      const res = await post(route, body, { authorization: BANDLIK_AUTH });
      assert.equal(calls.length, 1, name);
      assert.equal(res.status, 200, name);
      assert.deepEqual(await res.json(), { jsonrpc: "2.0", id, error: { code: -32603, message: "forward_failed" } }, name);
    }
  }
});

test("hardening: 8 s timeout signal, redirects not followed, oversized request body not forwarded", async () => {
  const { route, fwd } = await setup();
  assert.equal(fwd.FORWARD_TIMEOUT_MS, 8_000);
  const realTimeout = AbortSignal.timeout;
  let timeoutMs = -1;
  AbortSignal.timeout = ((ms: number) => {
    timeoutMs = ms;
    return realTimeout.call(AbortSignal, ms);
  }) as typeof AbortSignal.timeout;
  let calls: Seen[];
  try {
    calls = stubFetch(() => new Response(UPSTREAM, { status: 200 }));
    await post(route, BY_SERVICE);
  } finally {
    AbortSignal.timeout = realTimeout;
  }
  assert.equal(calls[0]!.init?.redirect, "manual");
  assert.ok(calls[0]!.init?.signal instanceof AbortSignal);
  assert.equal(timeoutMs, 8_000);

  const big = stubFetch(() => new Response(UPSTREAM, { status: 200 }));
  const huge = BY_SERVICE.replace('"phone":"998900000001"', `"phone":"998900000001","pad":"${"x".repeat(70_000)}"`);
  const res = await post(route, huge, { authorization: BANDLIK_AUTH });
  assert.equal(big.length, 0, "over 64 KB is never forwarded");
  assert.equal(res.status, 401, "…and is answered by SlaydX's own checks");
});

test("at most MAX_IN_FLIGHT Paynet forwards at once (next → -32603); the Click forward has its own budget", async () => {
  const { route, fwd } = await setup();
  const click = await import("../app/api/payments/click/route.ts");
  const { env } = await import("../lib/server/env.ts");
  Object.assign(env.click, { vakantForwardUrl: "https://abitur24.test/api/payments/click" });
  const gates: Array<() => void> = [];
  stubFetch((seen) =>
    seen.url === URL_
      ? new Promise<Response>((resolve) => gates.push(() => resolve(new Response(UPSTREAM, { status: 200 }))))
      : new Response('{"error":0}', { status: 200 }),
  );
  const pending = Array.from({ length: fwd.MAX_IN_FLIGHT }, () => post(route, BY_SERVICE));
  try {
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(gates.length, fwd.MAX_IN_FLIGHT);
    const over = await post(route, BY_SERVICE);
    assert.deepEqual(await over.json(), { jsonrpc: "2.0", id: 17, error: { code: -32603, message: "forward_failed" } });
    assert.equal(gates.length, fwd.MAX_IN_FLIGHT, "the extra request never reached upstream");
    const clickRes = await click.POST(
      new Request("http://x/api/payments/click", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "click_trans_id=1&service_id=777&merchant_trans_id=vk-1&amount=1&action=0&sign_time=t&sign_string=x",
      }),
    );
    assert.equal(await clickRes.text(), '{"error":0}', "Click forwards are not starved by Paynet's burst");
  } finally {
    // Released even when an assertion fails, so the slots do not leak into the next tests.
    for (const g of gates) g();
  }
  for (const r of await Promise.all(pending)) assert.equal(await r.text(), UPSTREAM);
  stubFetch(() => new Response(UPSTREAM, { status: 200 }));
  assert.equal(await (await post(route, BY_SERVICE)).text(), UPSTREAM, "slots are released");
});

test("log: one «[paynet] forwarded to vakant» line (method, serviceId, upstream status, ms); never the Authorization", async () => {
  const { route } = await setup();
  const chunks: string[] = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  const sink = ((c: unknown) => {
    chunks.push(String(c));
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = sink;
  process.stderr.write = sink;
  try {
    stubFetch(() => new Response(UPSTREAM, { status: 200 }));
    await post(route, BY_SERVICE, { authorization: BANDLIK_AUTH });
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
  const text = chunks.join("");
  const lines = text.split("\n").filter((l) => l.includes("[paynet] forwarded to vakant"));
  assert.equal(lines.length, 1, text);
  assert.match(lines[0]!, /"method":"PerformTransaction"/);
  assert.match(lines[0]!, /"serviceId":909/);
  assert.match(lines[0]!, /"upstreamStatus":200/);
  assert.match(lines[0]!, /"ms":\d+/);
  assert.ok(!text.includes(BANDLIK_AUTH.slice(6)) && !text.includes("their-own-pass"), "Authorization never logged");
});

test("config: the default forward URL applies when the variable is EMPTY (docker-compose passes \"\")", async () => {
  const real = process.env.VAKANT_PAYNET_FORWARD_URL;
  try {
    process.env.VAKANT_PAYNET_FORWARD_URL = "";
    const fresh = (await import(`../lib/server/env.ts?pnempty=${Date.now()}`)) as { env: { paynet: { vakantForwardUrl: string } } };
    assert.equal(fresh.env.paynet.vakantForwardUrl, "https://abitur24.uz/api/payments/paynet");
  } finally {
    if (real === undefined) delete process.env.VAKANT_PAYNET_FORWARD_URL;
    else process.env.VAKANT_PAYNET_FORWARD_URL = real;
  }
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  assert.equal(compose.split("\n").filter((l) => l.includes("VAKANT_PAYNET_FORWARD_URL")).length, 1, "web block only");
});

test("nothing written: forwarded calls (ok or failed) leave payment_orders, payment_events and transactions untouched", { skip: SKIP_DB }, async (t) => {
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
    ledger: Number((await query<{ n: string }>("SELECT count(*) n FROM transactions"))[0]!.n),
  });
  const before = await count();
  stubFetch(() => new Response(UPSTREAM, { status: 200 }));
  for (const b of [BY_SERVICE, BY_PAYER, BY_PAYER_US]) await post(route, b, { authorization: BANDLIK_AUTH });
  stubFetch(() => new Response("boom", { status: 500 }));
  for (const b of [BY_SERVICE, BY_PAYER, BY_PAYER_US]) await post(route, b, { authorization: BANDLIK_AUTH });
  assert.deepEqual(await count(), before, "no SlaydX row for a Bandlik request");

  // Sanity: SlaydX's own authenticated call in the same DB IS recorded (the counter above can move).
  stubFetch(() => {
    throw new Error("no outbound call for SlaydX's own request");
  });
  const own = await post(route, '{"jsonrpc":"2.0","id":1,"method":"GetInformation","params":{"serviceId":101,"fields":{"client_id":"1"}}}', {
    authorization: `Basic ${Buffer.from("paynet-user:paynet-pass").toString("base64")}`,
  });
  assert.equal(own.status, 200);
  assert.equal((await count()).events, before.events + 1);
});

test("runtimeWarnings: Paynet live without an IP list, allow-list without TRUST_PROXY, overlapping serviceIds", async () => {
  const { env } = await setup();
  const mod = (await import("../lib/server/env.ts")) as { runtimeWarnings(): string[] };
  const saved = { ...env.paynet };
  const trust = env.trustProxy;
  try {
    Object.assign(env.paynet, { username: "u", password: "p", serviceIds: [101], vakantServiceIds: [909], allowedIps: [] });
    assert.ok(mod.runtimeWarnings().some((w) => /PAYNET_ALLOWED_IPS bo'sh/.test(w)));
    Object.assign(env.paynet, { allowedIps: ["213.230.106.112/28"] });
    Object.assign(env, { trustProxy: false });
    assert.ok(mod.runtimeWarnings().some((w) => /TRUST_PROXY=true emas — barcha Paynet/.test(w)));
    Object.assign(env, { trustProxy: true });
    assert.ok(!mod.runtimeWarnings().some((w) => /Paynet/.test(w)));
    Object.assign(env.paynet, { vakantServiceIds: [101] });
    assert.ok(mod.runtimeWarnings().some((w) => /kesishadi/.test(w)));
  } finally {
    Object.assign(env.paynet, saved);
    Object.assign(env, { trustProxy: trust });
  }
});
