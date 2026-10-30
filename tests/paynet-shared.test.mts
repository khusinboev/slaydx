import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * ONE Paynet service for SlaydX AND Bandlik.uz (owner 2026-10-30): with PAYNET_SHARED_WITH_VAKANT on, payers `vk-…` / `vk_…`
 * (GetInformation / PerformTransaction) are relayed to Bandlik AFTER our own Basic auth, a successful forwarded Perform leaves a
 * `paynet_routes` row so its Check / Cancel follow, GetStatement merges both lists (all or nothing). Flag off = nothing changes.
 * `fetch` is stubbed (no network); real Postgres.
 *
 * MUTATIONS checked (each turned the named test red, then reverted):
 *   S1 flag ignored (always relay vk- payers)                        → «flag off»
 *   S2 relay BEFORE our auth                                         → «unauthenticated»
 *   S3 route row written on a Bandlik ERROR reply                    → «Perform … failure»
 *   S4 route row never written                                       → «Check / Cancel follow the route»
 *   S5 own order under the id ignored (a SlaydX txn handed to Bandlik) → «SlaydX order under the id»
 *   S6 Check relayed without the route row (every unknown id relayed) → «unknown id answered locally»
 *   S7 statement: Bandlik failure answered with own rows only        → «GetStatement … all or nothing»
 *   S8 statement merge without de-duplication / ordering             → «mergeStatements»
 *   S9 foreign serviceId relayed                                     → «foreign serviceId»
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.PAYNET_USERNAME = "paynet-user";
process.env.PAYNET_PASSWORD = "paynet-pass";
process.env.PAYNET_SERVICE_IDS = "101";
process.env.PAYNET_VAKANT_SERVICE_IDS = "";
process.env.PAYNET_ALLOWED_IPS = "";
process.env.PAYNET_APP_URL = "";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("paynetshared") : { isolated: false, drop: async () => {} };
const SKIP_DB = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const URL_ = "https://abitur24.test/api/payments/paynet";
const BASIC = `Basic ${Buffer.from("paynet-user:paynet-pass").toString("base64")}`;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; headers: Record<string, string>; body: string };
function stubFetch(handler: (seen: Seen) => Response | Promise<Response>): Seen[] {
  const calls: Seen[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const seen: Seen = { url: String(input), headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()), body: String(init?.body ?? "") };
    calls.push(seen);
    return handler(seen);
  }) as unknown as typeof fetch;
  return calls;
}
const ok = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200 });

// ── pure helpers
test("isVakantPayer: only «vk-» / «vk_» prefixes (case-sensitive, strings only)", async () => {
  const p = await import("../lib/server/paynet.ts");
  for (const yes of ["vk-1", "vk_77", "vk-abc"]) assert.equal(p.isVakantPayer(yes), true, yes);
  for (const no of ["VK-1", "xvk-1", "vk", "vk1", " vk-1", "2", "", null, undefined, 12, { a: "vk-1" }]) assert.equal(p.isVakantPayer(no), false, String(no));
});

test("parseVakantStatement / mergeStatements: strict rows, one per transactionId (ours win), ordered by time then id", async () => {
  const p = await import("../lib/server/paynet.ts");
  const row = (transactionId: number, timestamp: string, amount = 1000, providerTrnId = 1) => ({ amount, transactionId, providerTrnId, timestamp });
  const good = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { statements: [row(9, "2026-10-30 10:00:00"), { ...row(10, "2026-10-30 09:00:00"), transactionId: "10" }] } });
  assert.deepEqual(p.parseVakantStatement(good), [row(9, "2026-10-30 10:00:00"), row(10, "2026-10-30 09:00:00")]);
  assert.deepEqual(p.parseVakantStatement('{"result":{"statements":[]}}'), []);
  for (const bad of [
    "not json",
    "[]",
    '{"error":{"code":1},"result":{"statements":[]}}',
    '{"result":{}}',
    '{"result":{"statements":[1]}}',
    JSON.stringify({ result: { statements: [row(1, "2026-10-30 10:00:00", 0)] } }),
    JSON.stringify({ result: { statements: [row(1, "30.10.2026 10:00")] } }),
    JSON.stringify({ result: { statements: [{ ...row(1, "2026-10-30 10:00:00"), amount: "10" }] } }),
    JSON.stringify({ result: { statements: [{ ...row(1, "2026-10-30 10:00:00"), transactionId: -4 }] } }),
  ]) {
    assert.equal(p.parseVakantStatement(bad), null, bad.slice(0, 60));
  }
  // MUTATION S8: no de-duplication / ordering.
  const own = [row(5, "2026-10-30 12:00:00"), row(3, "2026-10-30 08:00:00")];
  const theirs = [row(5, "2026-10-30 12:00:00", 777), row(4, "2026-10-30 08:00:00")];
  assert.deepEqual(
    p.mergeStatements(own, theirs).map((r) => [r.transactionId, r.amount]),
    [[3, 1000], [4, 1000], [5, 1000]],
    "ordered by time then id; the duplicate id keeps OUR row",
  );
});

test("paynetAppUrl: only when Paynet is live AND the value is an https URL", async () => {
  const { env, paynetAppUrl } = await import("../lib/server/env.ts");
  const saved = { ...env.paynet };
  try {
    Object.assign(env.paynet, { appUrl: "https://app.paynet.test/?m=1" });
    assert.equal(paynetAppUrl(), "https://app.paynet.test/?m=1");
    for (const bad of ["", "http://app.paynet.test", "javascript:alert(1)", "https://x y", 'https://x"y']) {
      Object.assign(env.paynet, { appUrl: bad });
      assert.equal(paynetAppUrl(), null, bad);
    }
    Object.assign(env.paynet, { appUrl: "https://app.paynet.test/?m=1", password: "" });
    assert.equal(paynetAppUrl(), null, "Paynet not live (no password) → no link");
  } finally {
    Object.assign(env.paynet, saved);
  }
});

test("shared service (real Postgres)", { skip: SKIP_DB }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/payments/paynet/route.ts");
  const { paynetRouteOf, recordPaynetRoute } = await import("../lib/server/paynet.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  Object.assign(env.paynet, { vakantForwardUrl: URL_, allowedIps: [], vakantServiceIds: [] });

  let seq = 0;
  const mkUser = async () => {
    const r = await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Adham Bekov', 0, 0, 0) RETURNING id`, [`ps-${Date.now()}-${++seq}`]);
    return String(r[0]!.id);
  };
  type Reply = { jsonrpc?: string; id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } };
  const send = async (raw: string, auth: string | null = BASIC) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (auth) headers.authorization = auth;
    const res = await route.POST(new Request("http://x/api/payments/paynet", { method: "POST", headers, body: raw }));
    return { status: res.status, text: await res.text() };
  };
  const body = (method: string, params: Record<string, unknown>, id: unknown = 7) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
  const parse = (text: string) => JSON.parse(text) as Reply;
  const tables = async () => ({
    orders: Number((await queryOne<{ n: string }>("SELECT count(*)::text n FROM payment_orders"))!.n),
    events: Number((await queryOne<{ n: string }>("SELECT count(*)::text n FROM payment_events"))!.n),
    ledger: Number((await queryOne<{ n: string }>("SELECT count(*)::text n FROM transactions"))!.n),
  });
  const routesOf = async (txn: number) => (await query("SELECT 1 FROM paynet_routes WHERE transaction_id = $1", [txn])).length;
  const BANDLIK_OK = '{ "jsonrpc":"2.0", "id":7,\n "result":{"status":"0","fields":{"name":"Bandlik user"}} }';
  const vkGet = body("GetInformation", { serviceId: 101, fields: { client_id: "vk-4521" } });

  Object.assign(env.paynet, { sharedWithVakant: false });
  await t.test("flag off: a vk- payer is NOT relayed (the old 401-style answer), nothing changes", async () => {
    const calls = stubFetch(() => ok({}));
    const r = await send(vkGet);
    assert.equal(calls.length, 0, "MUTATION S1: relayed with the flag off");
    assert.equal(parse(r.text).error?.code, 401);
  });

  Object.assign(env.paynet, { sharedWithVakant: true });
  await t.test("flag on, UNAUTHENTICATED vk- call: never relayed (our auth first), 401", async () => {
    const calls = stubFetch(() => ok({}));
    const none = await send(vkGet, null);
    const wrong = await send(vkGet, `Basic ${Buffer.from("paynet-user:nope").toString("base64")}`);
    assert.equal(calls.length, 0, "MUTATION S2: relayed before auth");
    assert.equal(none.status, 401);
    assert.equal(wrong.status, 401);
  });

  await t.test("GetInformation of a vk- payer: relayed byte for byte (+ Authorization, Content-Type), reply verbatim, nothing written", async () => {
    const before = await tables();
    const calls = stubFetch(() => new Response(BANDLIK_OK, { status: 200 }));
    const raw = '{ "jsonrpc":"2.0","method":"GetInformation","id":7,"params":{"serviceId":101,"fields":{"client_id":"vk_4521"}} }';
    const r = await send(raw);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, URL_);
    assert.equal(calls[0]!.body, raw);
    assert.equal(calls[0]!.headers.authorization, BASIC);
    assert.equal(calls[0]!.headers["content-type"], "application/json");
    assert.equal(calls[0]!.headers["x-forwarded-by"], "slaydx");
    assert.equal(r.text, BANDLIK_OK);
    assert.deepEqual(await tables(), before, "no order / event / ledger row for a relayed call");
  });

  await t.test("Perform of a vk- payer: success → route recorded; Bandlik ERROR reply → no route; Bandlik down → -32603 forward_failed, no route", async () => {
    const perform = (txn: number) => body("PerformTransaction", { serviceId: 101, amount: 100000, transactionId: txn, fields: { client_id: "vk-9" } }, `p${txn}`);
    // success
    let calls = stubFetch(() => ok({ jsonrpc: "2.0", id: "p1001", result: { providerTrnId: 5, timestamp: "2026-10-30 10:00:00", fields: { balance: 1 } } }));
    let r = await send(perform(1001));
    assert.equal(calls.length, 1);
    assert.ok(parse(r.text).result);
    assert.equal(await routesOf(1001), 1, "MUTATION S4: route never written");
    // Bandlik says «client not found»
    calls = stubFetch(() => ok({ jsonrpc: "2.0", id: "p1002", error: { code: 302, message: "Клиент не найден" } }));
    r = await send(perform(1002));
    assert.equal(parse(r.text).error?.code, 302, "their error is returned verbatim");
    assert.equal(await routesOf(1002), 0, "MUTATION S3: route written on an error reply");
    // Bandlik unreachable / not JSON / 500
    for (const h of [() => { throw new TypeError("fetch failed"); }, () => new Response("<html>", { status: 200 }), () => new Response("boom", { status: 500 })]) {
      stubFetch(h);
      r = await send(perform(1003));
      assert.deepEqual(parse(r.text).error, { code: -32603, message: "forward_failed" });
      assert.equal(parse(r.text).id, "p1003");
      assert.equal(await routesOf(1003), 0);
    }
  });

  await t.test("Perform of a vk- payer under a transactionId that is a SlaydX order → 201, never handed to Bandlik", async () => {
    const uid = await mkUser();
    stubFetch(() => ok({}));
    const own = await send(body("PerformTransaction", { serviceId: 101, amount: 100000, transactionId: 2001, fields: { client_id: uid } }));
    assert.ok(parse(own.text).result, "SlaydX payer credited normally, no relay");
    const calls = stubFetch(() => ok({ jsonrpc: "2.0", id: 7, result: {} }));
    const r = await send(body("PerformTransaction", { serviceId: 101, amount: 100000, transactionId: 2001, fields: { client_id: "vk-9" } }));
    assert.equal(parse(r.text).error?.code, 201);
    assert.equal(calls.length, 0, "MUTATION S5: a SlaydX transaction handed to Bandlik");
  });

  await t.test("Check / Cancel follow the route; a SlaydX order answers itself; an unknown id is answered locally (no relay)", async () => {
    await recordPaynetRoute("3001");
    assert.equal(await paynetRouteOf("3001"), "vakant");
    await recordPaynetRoute("3001"); // idempotent
    assert.equal(await paynetRouteOf("3999"), null);
    const check = (txn: number) => body("CheckTransaction", { serviceId: 101, transactionId: txn, timestamp: "2026-10-30 10:00:00" });
    const cancel = (txn: number) => body("CancelTransaction", { serviceId: 101, transactionId: txn, timestamp: "2026-10-30 10:00:00" });
    // routed → relayed verbatim
    let calls = stubFetch(() => ok({ jsonrpc: "2.0", id: 7, result: { transactionState: 1, providerTrnId: 4 } }));
    let r = await send(check(3001));
    assert.equal(calls.length, 1);
    assert.equal(parse(r.text).result?.transactionState, 1);
    calls = stubFetch(() => ok({ jsonrpc: "2.0", id: 7, error: { code: 77, message: "x" } }));
    r = await send(cancel(3001));
    assert.equal(calls.length, 1);
    assert.equal(parse(r.text).error?.code, 77);
    // Bandlik down → the answer is a failure, never «not found»
    stubFetch(() => new Response("boom", { status: 500 }));
    r = await send(check(3001));
    assert.deepEqual(parse(r.text).error, { code: -32603, message: "forward_failed" });
    // unknown id → local state 3 / 203, no relay
    calls = stubFetch(() => ok({}));
    r = await send(check(3777));
    assert.equal(parse(r.text).result?.transactionState, 3);
    r = await send(cancel(3777));
    assert.equal(parse(r.text).error?.code, 203);
    assert.equal(calls.length, 0, "MUTATION S6: an unknown id was relayed");
    // a SlaydX order wins even when a (stray) route row exists for the id
    const uid = await mkUser();
    stubFetch(() => ok({}));
    await send(body("PerformTransaction", { serviceId: 101, amount: 100000, transactionId: 3002, fields: { client_id: uid } }));
    await recordPaynetRoute("3002");
    calls = stubFetch(() => ok({}));
    r = await send(check(3002));
    assert.equal(parse(r.text).result?.transactionState, 1);
    r = await send(cancel(3002));
    assert.equal(parse(r.text).error?.code, 77);
    assert.equal(calls.length, 0, "an own order is answered by SlaydX");
  });

  await t.test("a foreign serviceId is never relayed (305), and SlaydX payers are untouched (no fetch at all)", async () => {
    const calls = stubFetch(() => ok({}));
    const r = await send(body("GetInformation", { serviceId: 55, fields: { client_id: "vk-1" } }));
    assert.equal(parse(r.text).error?.code, 305);
    const uid = await mkUser();
    const r2 = await send(body("GetInformation", { serviceId: 101, fields: { client_id: uid } }));
    assert.equal(parse(r2.text).result?.status, "0");
    assert.equal(calls.length, 0, "MUTATION S9: relayed");
  });

  await t.test("GetStatement: own + Bandlik rows merged and ordered; Bandlik failure / malformed / too many → the WHOLE call fails (-32603), never half a statement", async () => {
    const uid = await mkUser();
    stubFetch(() => ok({}));
    const perfNow = await send(body("PerformTransaction", { serviceId: 101, amount: 150000, transactionId: 4001, fields: { client_id: uid } }));
    assert.ok(parse(perfNow.text).result);
    const from = "2000-01-01 00:00:00";
    const to = "2999-01-01 00:00:00";
    const stmt = body("GetStatement", { serviceId: 101, dateFrom: from, dateTo: to });
    const theirs = [
      { amount: 500000, transactionId: 4900, providerTrnId: 31, timestamp: "2026-10-01 09:00:00" },
      { amount: 700000, transactionId: 4901, providerTrnId: 32, timestamp: "2999-01-01 00:00:00" },
    ];
    let calls = stubFetch(() => ok({ jsonrpc: "2.0", id: 7, result: { statements: theirs } }));
    let r = await send(stmt);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body, stmt, "the SAME request goes to Bandlik");
    const rows = parse(r.text).result!.statements as Array<{ transactionId: number; amount: number }>;
    // Own rows: the SlaydX orders of the earlier subtests (2001, 3002) and 4001, all «now»; Bandlik's two sit before / after them.
    assert.deepEqual(rows.map((x) => x.transactionId), [4900, 2001, 3002, 4001, 4901], "merged and ordered by time");
    assert.equal(rows.find((x) => x.transactionId === 4001)!.amount, 150000, "own amount in tiyin");
    // all or nothing
    for (const h of [
      () => new Response("boom", { status: 500 }),
      () => ok({ jsonrpc: "2.0", id: 7, result: { statements: [{ amount: 0 }] } }),
      () => ok({ jsonrpc: "2.0", id: 7, error: { code: 1, message: "x" } }),
      () => { throw new TypeError("fetch failed"); },
    ]) {
      stubFetch(h);
      r = await send(stmt);
      assert.deepEqual(parse(r.text).error, { code: -32603, message: "Системная ошибка" }, "MUTATION S7: own rows only");
    }
    // invalid dates are refused locally (414), before any relay
    calls = stubFetch(() => ok({}));
    r = await send(body("GetStatement", { serviceId: 101, dateFrom: "bad", dateTo: to }));
    assert.equal(parse(r.text).error?.code, 414);
    assert.equal(calls.length, 0);
    // flag off: own rows only, no relay
    Object.assign(env.paynet, { sharedWithVakant: false });
    calls = stubFetch(() => ok({}));
    r = await send(stmt);
    assert.equal(calls.length, 0);
    assert.deepEqual((parse(r.text).result!.statements as Array<{ transactionId: number }>).map((x) => x.transactionId), [2001, 3002, 4001]);
    Object.assign(env.paynet, { sharedWithVakant: true });
  });

  await t.test("a big Bandlik statement (well over the one-payment 16 KB cap) is accepted", async () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ amount: 1000, transactionId: 50_000 + i, providerTrnId: i + 1, timestamp: "2026-10-02 10:00:00" }));
    stubFetch(() => ok({ jsonrpc: "2.0", id: 7, result: { statements: many } }));
    const r = await send(body("GetStatement", { serviceId: 101, dateFrom: "2000-01-01 00:00:00", dateTo: "2999-01-01 00:00:00" }));
    const rows = parse(r.text).result!.statements as unknown[];
    assert.ok(rows.length >= 400, `${rows.length} rows`);
  });
});
