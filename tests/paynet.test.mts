import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Paynet (UZPAYNET) provider endpoint — docs/payments/PAYNET.md. The REAL route (`POST /api/payments/paynet`) runs against an
 * isolated Postgres database, so auth, IP allow-list, JSON-RPC envelope, every method, every error code, the atomic
 * insert + settle, idempotency, the ledger, the payment bonus and the audit rows are exercised together. `fetch` is stubbed to
 * FAIL: nothing on our own orders may call out. Forwarding to Bandlik.uz is covered in `tests/paynet-forward.test.mts`.
 *
 * MUTATIONS checked (each broke the named subtests, then was reverted) — see the report in docs/payments/PAYNET.md:
 *   M1 settleOrderInTx called twice in createPaidPaynetOrder (credit twice)            → «Perform: credited», «duplicate», «concurrent»
 *   M2 duplicate check removed (unique violation not mapped to 201)                     → «duplicate», «concurrent»
 *   M3 auth skipped (authorized forced true)                                            → «auth»
 *   M4 IP allow-list bypassed                                                           → «IP allow-list»
 *   M5 CancelTransaction honoured (cancels the order)                                   → «Cancel never cancels»
 *   M6 amount not divided by 100 (credited in tiyin)                                    → «Perform: credited», «amount rules»
 *   M7 insert and settle in two transactions (order committed before the credit)        → «atomicity»
 *   M8 statement end exclusive at the second (no +1000 ms) / GMT instead of GMT+5        → «GetStatement»
 *   M9 bonus credited to balance instead of points                                      → «Perform: credited»
 *   M10 amount multiple-of-100 check dropped                                            → «amount rules»
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.PAYNET_USERNAME = "paynet-user";
process.env.PAYNET_PASSWORD = "Pn-pass:with-colon-S3cret";
process.env.PAYNET_SERVICE_IDS = "101,102";
process.env.PAYNET_CLIENT_PARAM = "";
process.env.PAYNET_ALLOWED_IPS = "";
process.env.PAYNET_VAKANT_SERVICE_IDS = "909";
process.env.VAKANT_PAYNET_FORWARD_URL = "https://abitur24.test/api/payments/paynet";
process.env.TRUST_PROXY = "true";

const USER = "paynet-user";
const PASS = "Pn-pass:with-colon-S3cret";
const BASIC = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;

const iso = hasDb ? await createIsolatedDb("paynet") : { isolated: false, drop: async () => {} };
const SKIP_DB = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const realFetch = globalThis.fetch;
let outbound = 0;
function forbidFetch(): void {
  globalThis.fetch = (async () => {
    outbound++;
    throw new Error("no outbound call is allowed for SlaydX's own Paynet orders");
  }) as unknown as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Captures stdout + stderr (console.log / console.warn) while `fn` runs. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ out: T; text: string }> {
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
    return { out: await fn(), text: chunks.join("") };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

// ───────────────────────────── pure helpers

test("formatTashkent / parseTashkent: GMT+5, strict YYYY-MM-DD HH:mm:ss, real dates only", async () => {
  const p = await import("../lib/server/paynet.ts");
  assert.equal(p.formatTashkent(Date.UTC(2026, 9, 16, 0, 0, 0)), "2026-10-16 05:00:00");
  assert.equal(p.formatTashkent(Date.UTC(2026, 11, 31, 20, 30, 15, 999)), "2027-01-01 01:30:15");
  assert.equal(p.parseTashkent("2026-10-16 05:00:00"), Date.UTC(2026, 9, 16, 0, 0, 0));
  assert.equal(p.parseTashkent("2024-02-29 00:00:00"), Date.UTC(2024, 1, 28, 19, 0, 0));
  for (const bad of [
    "2026-02-30 10:00:00", "2025-02-29 10:00:00", "2026-13-01 00:00:00", "2026-00-10 00:00:00", "2026-10-16 24:00:00",
    "2026-10-16 23:60:00", "2026-10-16 23:59:60", "2026-10-16T10:00:00", "2026-10-16 10:00", "2026-10-16 10:00:00Z",
    " 2026-10-16 10:00:00", "", 1760000000000, null, undefined,
  ]) {
    assert.equal(p.parseTashkent(bad), null, JSON.stringify(bad));
  }
  const ms = Date.UTC(2026, 4, 5, 6, 7, 8);
  assert.equal(p.parseTashkent(p.formatTashkent(ms)), ms, "round trip");
});

test("maskName: first token + initial of the second; one token as is; empty → SlaydX", async () => {
  const { maskName } = await import("../lib/server/paynet.ts");
  assert.equal(maskName("Adham Bekov"), "Adham B.");
  assert.equal(maskName("  Adham   bekov  Xusinboyev "), "Adham B.");
  assert.equal(maskName("Adham"), "Adham");
  assert.equal(maskName("Олег Иванов"), "Олег И.");
  assert.equal(maskName("Ali 𝒳yz"), "Ali 𝒳.", "the initial is a whole code point");
  for (const empty of ["", "   ", null, undefined]) assert.equal(maskName(empty), "SlaydX");
});

test("ipAllowed: IPv4 exact, CIDR ranges, IPv4-mapped IPv6, malformed entries never match", async () => {
  const { ipAllowed } = await import("../lib/server/paynet.ts");
  const paynet = ["213.230.106.112/28", "213.230.65.80/28"];
  for (const ok of ["213.230.106.112", "213.230.106.127", "213.230.65.80", "213.230.65.95", "::ffff:213.230.106.120"]) {
    assert.equal(ipAllowed(ok, paynet), true, ok);
  }
  for (const no of ["213.230.106.111", "213.230.106.128", "213.230.65.96", "10.0.0.1", "direct", "unknown", "", "213.230.106", "::1"]) {
    assert.equal(ipAllowed(no, paynet), false, no);
  }
  assert.equal(ipAllowed("1.2.3.4", ["1.2.3.4"]), true);
  assert.equal(ipAllowed("1.2.3.5", ["1.2.3.4"]), false);
  assert.equal(ipAllowed("1.2.3.4", ["1.2.3.4/32"]), true);
  assert.equal(ipAllowed("9.9.9.9", ["0.0.0.0/0"]), true);
  for (const bad of ["1.2.3.4/33", "1.2.3/24", "300.1.1.1/8", "1.2.3.4/x", "/24"]) assert.equal(ipAllowed("1.2.3.4", [bad]), false, bad);
  assert.equal(ipAllowed("2001:db8::1", ["2001:DB8::1"]), true, "a non-IPv4 entry matches exactly (case-insensitive)");
});

test("paynetBasicAuthorized: exact login and password, constant-time digests, malformed headers refused", async () => {
  const { paynetBasicAuthorized: ok } = await import("../lib/server/paynet.ts");
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  assert.equal(ok(BASIC, USER, PASS), true);
  assert.equal(ok(`basic ${b64(`${USER}:${PASS}`)}`, USER, PASS), true, "scheme is case-insensitive");
  assert.equal(ok(`Basic ${b64(`${USER}:${PASS}x`)}`, USER, PASS), false, "wrong password");
  assert.equal(ok(`Basic ${b64(`${USER}x:${PASS}`)}`, USER, PASS), false, "wrong login");
  assert.equal(ok(`Basic ${b64(`${PASS}:${USER}`)}`, USER, PASS), false, "swapped");
  assert.equal(ok(`Basic ${b64(`${USER}:`)}`, USER, PASS), false, "empty password");
  assert.equal(ok(`Basic ${b64(USER)}`, USER, PASS), false, "no colon");
  for (const h of [null, undefined, "", "Basic", `Bearer ${b64(`${USER}:${PASS}`)}`, `Basic !!${b64(`${USER}:${PASS}`)}`, `${BASIC} extra`]) {
    assert.equal(ok(h, USER, PASS), false, String(h));
  }
  assert.equal(ok(BASIC, "", PASS), false, "not configured: no login");
  assert.equal(ok(BASIC, USER, ""), false, "not configured: no password");
  assert.equal(ok(`Basic ${b64(":")}`, "", ""), false, "empty credentials never match empty config");
});

test("toTransactionId / toServiceId / parseEnvelope / isVakantPaynet", async () => {
  const p = await import("../lib/server/paynet.ts");
  assert.equal(p.toTransactionId(123), "123");
  assert.equal(p.toTransactionId("000123"), "123", "a digit string is canonicalised (same duplicate key)");
  for (const bad of [0, -1, 1.5, "0", "-5", "1e3", "abc", "", null, 2 ** 53, "9007199254740993", true]) {
    assert.equal(p.toTransactionId(bad), null, String(bad));
  }
  assert.equal(p.toServiceId(101), 101);
  assert.equal(p.toServiceId("101"), 101);
  for (const bad of [1.5, "10a", "", null, -1.5]) assert.equal(p.toServiceId(bad), null, String(bad));

  assert.deepEqual(p.parseEnvelope('{"jsonrpc":"2.0","id":5,"method":"X","params":{}}').ok, true);
  const cases: Array<[string | null, number, string | number | null]> = [
    [null, -32600, null],
    ["{", -32700, null],
    ["[]", -32600, null],
    ['[{"jsonrpc":"2.0","id":1,"method":"X","params":{}}]', -32600, null],
    ['{"id":1,"method":"X","params":{}}', -32600, 1],
    ['{"jsonrpc":"1.0","id":"a","method":"X","params":{}}', -32600, "a"],
    ['{"jsonrpc":"2.0","id":1,"method":5,"params":{}}', -32600, 1],
    ['{"jsonrpc":"2.0","id":1,"method":"X","params":[]}', -32600, 1],
    ['{"jsonrpc":"2.0","id":1,"method":"X"}', -32600, 1],
    ['{"jsonrpc":"2.0","method":"X","params":{}}', -32600, null],
    ['{"jsonrpc":"2.0","id":{},"method":"X","params":{}}', -32600, null],
  ];
  for (const [raw, code, id] of cases) {
    const r = p.parseEnvelope(raw);
    assert.equal(r.ok, false, String(raw));
    if (!r.ok) {
      assert.equal(r.code, code, String(raw));
      assert.equal(r.id, id, String(raw));
    }
  }

  const v = [909];
  assert.equal(p.isVakantPaynet({ params: { serviceId: 909 } }, v), true);
  assert.equal(p.isVakantPaynet({ params: { serviceId: "909" } }, v), true);
  assert.equal(p.isVakantPaynet({ params: { serviceId: 101, fields: { client_id: "vk-12" } } }, v), true);
  assert.equal(p.isVakantPaynet({ params: { serviceId: 101, fields: { other: "vk_12" } } }, v), true);
  for (const no of [
    { params: { serviceId: 101, fields: { client_id: "12" } } },
    { params: { serviceId: 101, fields: { client_id: "VK-12" } } },
    { params: { serviceId: 101, fields: { client_id: "xvk-12" } } },
    { params: { serviceId: 101, fields: { client_id: 12 } } },
    { params: { serviceId: 101, fields: { nested: { a: "vk-1" } } } },
    { params: { serviceId: 101, note: "vk-1" } },
    { params: [] },
    [],
    null,
    "vk-1",
  ]) {
    assert.equal(p.isVakantPaynet(no, v), false, JSON.stringify(no));
  }
});

// ───────────────────────────── the route against Postgres

type RpcReply = { jsonrpc: string; id: string | number | null; result?: Record<string, unknown>; error?: { code: number; message: string } };

test("Paynet route (real Postgres)", { skip: SKIP_DB }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/payments/paynet/route.ts");
  const payments = await import("../lib/server/payments.ts");
  const { formatTashkent } = await import("../lib/server/paynet.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  forbidFetch();

  // ── helpers
  let seq = 0;
  const mkUser = async (name = "Adham Bekov", opts: { blocked?: boolean; balance?: number } = {}) => {
    const r = await query<{ id: string }>(
      `INSERT INTO users (username, name, points, quota, balance, is_blocked) VALUES ($1, $2, 0, 0, $3, $4) RETURNING id`,
      [`pn-${Date.now()}-${++seq}`, name, opts.balance ?? 0, opts.blocked ?? false],
    );
    return String(r[0]!.id);
  };
  let txnSeq = 5_000_000;
  const nextTxn = () => ++txnSeq;
  const send = async (
    body: unknown,
    o: { auth?: string | null; ip?: string; raw?: string; method?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...(o.headers ?? {}) };
    const auth = o.auth === undefined ? BASIC : o.auth;
    if (auth) headers.authorization = auth;
    if (o.ip) headers["x-forwarded-for"] = o.ip;
    const method = o.method ?? "POST";
    const req = new Request("http://x/api/payments/paynet", {
      method,
      headers,
      ...(method === "GET" || method === "HEAD" ? {} : { body: o.raw ?? JSON.stringify(body) }),
    });
    const handler = (route as unknown as Record<string, (r: Request) => Promise<Response> | Response>)[method]!;
    const res = await handler(req);
    return { status: res.status, headers: res.headers, body: (await res.json()) as RpcReply };
  };
  const rpc = (method: string, params: Record<string, unknown>, o: Parameters<typeof send>[1] & { id?: unknown } = {}) =>
    send({ jsonrpc: "2.0", id: o.id === undefined ? 1 : o.id, method, params }, o);
  const perform = (userId: string | number, amount: unknown, transactionId: unknown, extra: Record<string, unknown> = {}) =>
    rpc("PerformTransaction", { serviceId: 101, amount, transactionId, fields: { client_id: userId }, ...extra });
  const wallet = async (uid: string) =>
    (await query<{ points: string; balance: string }>(`SELECT points, balance FROM users WHERE id = $1`, [uid])).map((r) => ({
      points: Number(r.points),
      balance: Number(r.balance),
    }))[0]!;
  const ledger = async (uid: string) =>
    await query<{ kind: string; reference: string; balance_delta: string; points_delta: string }>(
      `SELECT kind, reference, balance_delta, points_delta FROM transactions WHERE user_id = $1 ORDER BY id`,
      [uid],
    );
  const ordersOf = async (txn: string | number) =>
    await query<{ id: string; user_id: string; provider: string; purpose: string; state: string; amount_soum: string; create_time: string; perform_time: string; paynet_trn_id: string | null; provider_txn: string }>(
      `SELECT id, user_id, provider, purpose, state, amount_soum, create_time, perform_time, paynet_trn_id, provider_txn
         FROM payment_orders WHERE provider = 'paynet' AND provider_txn = $1`,
      [String(txn)],
    );
  const countAll = async () => ({
    orders: Number((await query<{ n: string }>(`SELECT count(*) n FROM payment_orders`))[0]!.n),
    events: Number((await query<{ n: string }>(`SELECT count(*) n FROM payment_events`))[0]!.n),
    ledger: Number((await query<{ n: string }>(`SELECT count(*) n FROM transactions`))[0]!.n),
  });
  const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  // ───────── first route call: the empty allow-list warns exactly once

  await t.test("empty PAYNET_ALLOWED_IPS: the allow-list is off and ONE warning is logged per process", async () => {
    const uid = await mkUser();
    const { text } = await captureLogs(async () => {
      for (let i = 0; i < 3; i++) assert.equal((await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } }, { ip: "8.8.8.8" })).status, 200);
    });
    assert.equal(text.split("\n").filter((l) => l.includes("PAYNET_ALLOWED_IPS is empty")).length, 1, text);
  });

  await t.test("migration 050 applied on a fresh DB: CHECKs accept 'paynet', sequence, column and indexes exist", async () => {
    const applied = await query<{ name: string }>(`SELECT name FROM schema_migrations WHERE name = '050_paynet.sql'`);
    assert.equal(applied.length, 1);
    const checks = await query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname IN ('payment_orders_provider_check', 'payment_events_provider_check') ORDER BY conname`,
    );
    assert.equal(checks.length, 2, "exactly the two widened CHECKs (old ones dropped, not duplicated)");
    for (const c of checks) assert.match(c.def, /'click'.*'payme'.*'paynet'/, c.conname);
    const other = await query<{ n: string }>(
      `SELECT count(*) n FROM pg_constraint WHERE contype = 'c' AND conrelid IN ('payment_orders'::regclass, 'payment_events'::regclass) AND pg_get_constraintdef(oid) LIKE '%provider%'`,
    );
    assert.equal(Number(other[0]!.n), 2, "no stale provider CHECK left behind");
    assert.equal((await query(`SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'paynet_trn_seq'`)).length, 1);
    assert.equal((await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_orders' AND column_name = 'paynet_trn_id' AND data_type = 'bigint'`)).length, 1);
    const idx = await query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN ('payment_orders_paynet_trn_idx', 'payment_orders_paynet_paid_idx') ORDER BY indexname`,
    );
    assert.equal(idx.length, 2);
    assert.match(idx.find((i) => i.indexname === "payment_orders_paynet_trn_idx")!.indexdef, /UNIQUE/);
    await assert.rejects(query(`INSERT INTO payment_events (provider, method, payload) VALUES ('stripe', 'x', '{}'::jsonb)`), /check/i, "unknown providers still refused");
  });

  // ───────── auth / IP / config

  await t.test("auth: missing / wrong / malformed credentials → HTTP 401 + WWW-Authenticate + 412, id null, nothing recorded", async () => {
    const uid = await mkUser();
    const before = await countAll();
    const b64 = (s: string) => `Basic ${Buffer.from(s).toString("base64")}`;
    for (const auth of [null, b64(`${USER}:wrong`), b64(`wrong:${PASS}`), "Bearer abc", "Basic", b64(`${USER}:${PASS.split(":")[0]}`)]) {
      const r = await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } }, { auth, id: 77 });
      assert.equal(r.status, 401, String(auth));
      assert.equal(r.headers.get("www-authenticate"), 'Basic realm="paynet"');
      assert.deepEqual(r.body, { jsonrpc: "2.0", id: null, error: { code: 412, message: "Неверный логин или пароль" } });
    }
    // Unauthenticated PerformTransaction credits nothing.
    const r = await perform(uid, 1_000_000, nextTxn(), {});
    assert.equal(r.status, 200, "sanity: the right credentials work");
    const bad = await rpc("PerformTransaction", { serviceId: 101, amount: 1_000_000, transactionId: nextTxn(), fields: { client_id: uid } }, { auth: null });
    assert.equal(bad.status, 401);
    const after = await countAll();
    assert.equal(after.orders - before.orders, 1, "only the authenticated Perform created an order");
    assert.equal(after.events - before.events, 1, "unauthenticated calls write no payment_events row");
  });

  await t.test("not configured (no login, password or serviceIds) → every call is a 401", async () => {
    const uid = await mkUser();
    const saved = { ...env.paynet };
    try {
      for (const patch of [{ serviceIds: [] as number[] }, { username: "" }, { password: "" }]) {
        Object.assign(env.paynet, saved, patch);
        const r = await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } });
        assert.equal(r.status, 401, JSON.stringify(patch));
        assert.equal(r.body.error?.code, 412);
      }
    } finally {
      Object.assign(env.paynet, saved);
    }
  });

  await t.test("IP allow-list: Paynet ranges pass, others get HTTP 403 + 601 before auth; without a trusted proxy nobody passes", async () => {
    const uid = await mkUser();
    const saved = { allowedIps: env.paynet.allowedIps, trustProxy: env.trustProxy };
    try {
      Object.assign(env.paynet, { allowedIps: ["213.230.106.112/28", "213.230.65.80/28"] });
      Object.assign(env, { trustProxy: true });
      const ok = await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } }, { ip: "213.230.106.120" });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.result?.status, "0");
      for (const ip of ["10.0.0.1", "213.230.106.128", "213.230.65.79"]) {
        for (const auth of [BASIC, null]) {
          const r = await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } }, { ip, auth, id: 5 });
          assert.equal(r.status, 403, ip);
          assert.deepEqual(r.body, { jsonrpc: "2.0", id: null, error: { code: 601, message: "Доступ запрещен" } });
        }
      }
      // The LAST X-Forwarded-For hop (set by our nginx) is the client: a spoofed first hop does not help.
      assert.equal((await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } }, { ip: "213.230.106.120, 10.0.0.1" })).status, 403);
      const before = await wallet(uid);
      const refused = await rpc("PerformTransaction", { serviceId: 101, amount: 1_000_000, transactionId: nextTxn(), fields: { client_id: uid } }, { ip: "10.0.0.1" });
      assert.equal(refused.status, 403);
      assert.deepEqual(await wallet(uid), before, "a refused IP credits nothing");
      Object.assign(env, { trustProxy: false });
      assert.equal((await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } }, { ip: "213.230.106.120" })).status, 403, "no trusted proxy → client IP unknown → refused");
    } finally {
      Object.assign(env.paynet, { allowedIps: saved.allowedIps });
      Object.assign(env, { trustProxy: saved.trustProxy });
    }
  });

  // ───────── JSON-RPC envelope

  await t.test("JSON-RPC errors: -32700, -32600, -32601 (incl. ChangePassword), -32300 for non-POST, body over 64 KB", async () => {
    const parse = await send(null, { raw: "{not json" });
    assert.equal(parse.status, 200);
    assert.deepEqual(parse.body.error?.code, -32700);
    assert.equal(parse.body.id, null);
    assert.equal(parse.body.jsonrpc, "2.0");
    for (const raw of ["[]", '"x"', "1", '{"jsonrpc":"2.0","id":1,"params":{}}', '{"jsonrpc":"2.0","id":1,"method":"GetInformation","params":[1]}', '{"jsonrpc":"2.0","method":"GetInformation","params":{}}']) {
      const r = await send(null, { raw });
      assert.equal(r.body.error?.code, -32600, raw);
    }
    const noVersion = await send(null, { raw: '{"id":"abc","method":"GetInformation","params":{}}' });
    assert.equal(noVersion.body.error?.code, -32600);
    assert.equal(noVersion.body.id, "abc", "id echoed when it is readable");
    for (const m of ["ChangePassword", "getinformation", "toString", "constructor", "__proto__", ""]) {
      const r = await rpc(m, { serviceId: 101 }, { id: "m-1" });
      assert.equal(r.body.error?.code, -32601, m);
      assert.equal(r.body.id, "m-1");
    }
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const r = await send(null, { method, raw: "{}" });
      assert.equal(r.status, 200, method);
      assert.equal(r.body.error?.code, -32300, method);
    }
    const big = await send(null, { raw: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "GetInformation", params: { pad: "x".repeat(70_000) } }) });
    assert.equal(big.body.error?.code, -32600, "over 64 KB is refused while reading");
    // The envelope errors still need auth first (no unauthenticated oracle).
    assert.equal((await send(null, { raw: "{not json", auth: null })).status, 401);
  });

  await t.test("id echo: string and number ids come back as sent, in results and in errors", async () => {
    const uid = await mkUser();
    for (const id of ["abc-1", 0, 42, "", 9_007_199_254_740_991]) {
      assert.equal((await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } }, { id })).body.id, id);
      assert.equal((await rpc("GetInformation", { serviceId: 999, fields: { client_id: uid } }, { id })).body.id, id);
    }
  });

  await t.test("serviceId: not ours → 305 on every method; missing → -32602; digit string accepted", async () => {
    const uid = await mkUser();
    const ts = formatTashkent(Date.now());
    for (const [m, extra] of [
      ["GetInformation", { fields: { client_id: uid } }],
      ["PerformTransaction", { amount: 1_000_000, transactionId: nextTxn(), fields: { client_id: uid } }],
      ["CheckTransaction", { transactionId: 1, timestamp: ts }],
      ["CancelTransaction", { transactionId: 1, timestamp: ts }],
      ["GetStatement", { dateFrom: ts, dateTo: ts }],
    ] as const) {
      assert.equal((await rpc(m, { serviceId: 999, ...extra })).body.error?.code, 305, m);
      assert.equal((await rpc(m, { serviceId: 909.5, ...extra })).body.error?.code, 305, `${m} non-integer`);
      assert.equal((await rpc(m, { ...extra })).body.error?.code, -32602, `${m} missing serviceId`);
    }
    assert.equal((await rpc("GetInformation", { serviceId: "102", fields: { client_id: uid } })).body.result?.status, "0");
    assert.deepEqual(await wallet(uid), { points: 0, balance: 0 }, "the 305 Perform credited nothing");
  });

  // ───────── GetInformation

  await t.test("GetInformation: masked name, balance in so'm, status \"0\", GMT+5 timestamp", async () => {
    const uid = await mkUser("Adham Bekov", { balance: 12_345 });
    const before = Date.now();
    const r = await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } });
    assert.equal(r.status, 200);
    assert.equal(r.body.result?.status, "0");
    assert.deepEqual(r.body.result?.fields, { name: "Adham B.", balance: 12_345 });
    const ts = String(r.body.result?.timestamp);
    assert.match(ts, TS);
    const { parseTashkent } = await import("../lib/server/paynet.ts");
    assert.ok(Math.abs(parseTashkent(ts)! - before) < 5_000, `timestamp ${ts} is now in Tashkent time`);
    assert.equal((await rpc("GetInformation", { serviceId: 101, fields: { client_id: Number(uid) } })).body.result?.status, "0", "numeric client_id");
    const one = await mkUser("Adham");
    assert.equal(((await rpc("GetInformation", { serviceId: 101, fields: { client_id: one } })).body.result!.fields as { name: string }).name, "Adham");
    const empty = await mkUser("");
    assert.equal(((await rpc("GetInformation", { serviceId: 101, fields: { client_id: empty } })).body.result!.fields as { name: string }).name, "SlaydX");
  });

  await t.test("client lookup errors: 411 absent, 401 malformed, 302 unknown / too large / zero, 501 blocked, -32602 no fields", async () => {
    const blocked = await mkUser("Blocked User", { blocked: true });
    const cases: Array<[unknown, number]> = [
      [{}, 411],
      [{ client_id: "" }, 411],
      [{ client_id: null }, 411],
      [{ other: "5" }, 411],
      [{ client_id: "abc" }, 401],
      [{ client_id: "12a" }, 401],
      [{ client_id: " 12" }, 401],
      [{ client_id: "-5" }, 401],
      [{ client_id: 1.5 }, 401],
      [{ client_id: "1234567890123456789" }, 401],
      [{ client_id: true }, 401],
      [{ client_id: "999999999999999999" }, 302],
      [{ client_id: "0000000000" }, 302],
      [{ client_id: 0 }, 302],
      [{ client_id: blocked }, 501],
    ];
    for (const [fields, code] of cases) {
      assert.equal((await rpc("GetInformation", { serviceId: 101, fields })).body.error?.code, code, JSON.stringify(fields));
    }
    for (const fields of [undefined, "5", [1]]) {
      assert.equal((await rpc("GetInformation", { serviceId: 101, fields })).body.error?.code, -32602, JSON.stringify(fields));
    }
    // The same rules guard PerformTransaction, and nothing is created.
    const before = await countAll();
    for (const [fields, code] of [[{ client_id: blocked }, 501], [{ client_id: "999999999999999999" }, 302], [{}, 411], [{ client_id: "x" }, 401]] as const) {
      assert.equal((await rpc("PerformTransaction", { serviceId: 101, amount: 1_000_000, transactionId: nextTxn(), fields })).body.error?.code, code);
    }
    const after = await countAll();
    assert.equal(after.orders, before.orders, "no order for a refused payer");
    assert.equal(after.ledger, before.ledger);
    assert.deepEqual(await wallet(blocked), { points: 0, balance: 0 });
  });

  // ───────── PerformTransaction

  await t.test("Perform: credited amount/100 so'm to balance + 10 % bonus to POINTS, one transaction, order row, ledger paynet:<id>", async () => {
    const uid = await mkUser("Adham Bekov", { balance: 500 });
    const txn = nextTxn();
    const before = Date.now();
    const r = await perform(uid, 5_000_000, txn, {}); // 50 000 so'm
    assert.equal(r.status, 200);
    assert.equal(r.body.error, undefined, JSON.stringify(r.body));
    const res = r.body.result!;
    assert.deepEqual(res.fields, { client_id: uid, balance: 50_500 }, "new balance in so'm");
    assert.ok(Number.isSafeInteger(res.providerTrnId) && (res.providerTrnId as number) > 0);
    assert.match(String(res.timestamp), TS);
    assert.deepEqual(await wallet(uid), { balance: 50_500, points: 5_000 });

    const [o, ...rest] = await ordersOf(txn);
    assert.equal(rest.length, 0);
    assert.equal(o!.user_id, uid);
    assert.equal(o!.purpose, "topup");
    assert.equal(o!.state, "paid");
    assert.equal(Number(o!.amount_soum), 50_000);
    assert.equal(Number(o!.paynet_trn_id), res.providerTrnId);
    assert.equal(o!.create_time, o!.perform_time, "create_time = perform_time = now");
    assert.ok(Math.abs(Number(o!.perform_time) - before) < 5_000);
    assert.equal(formatTashkent(Number(o!.perform_time)), res.timestamp);

    const l = await ledger(uid);
    assert.deepEqual(
      l.map((x) => [x.kind, x.reference, Number(x.balance_delta), Number(x.points_delta)]),
      [
        ["topup", `paynet:${txn}`, 50_000, 0],
        ["bonus", `payment-bonus:${o!.id}`, 0, 5_000],
      ],
    );
    assert.equal(outbound, 0, "no outbound call for our own order");
  });

  await t.test("duplicate transactionId → 201, credited exactly once (number and digit-string forms are the same id)", async () => {
    const uid = await mkUser();
    const txn = nextTxn();
    assert.equal((await perform(uid, 1_000_000, txn, {})).body.result !== undefined, true);
    const afterFirst = await wallet(uid);
    for (const again of [txn, String(txn), `000${txn}`]) {
      const r = await perform(uid, 1_000_000, again, {});
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.error, { code: 201, message: "Транзакция уже существует" }, String(again));
    }
    // Another payer, same transactionId: still a duplicate, nothing credited to them.
    const other = await mkUser();
    assert.equal((await perform(other, 1_000_000, txn, {})).body.error?.code, 201);
    assert.deepEqual(await wallet(other), { points: 0, balance: 0 });
    assert.deepEqual(await wallet(uid), afterFirst);
    assert.equal((await ordersOf(txn)).length, 1);
    assert.equal((await ledger(uid)).filter((x) => x.kind === "topup").length, 1);
  });

  await t.test("CONCURRENT PerformTransaction with the same transactionId → exactly one credit, the rest 201", async () => {
    const uid = await mkUser();
    const txn = nextTxn();
    const replies = await Promise.all(Array.from({ length: 8 }, () => perform(uid, 2_000_000, txn, {})));
    const ok = replies.filter((r) => r.body.result);
    const dup = replies.filter((r) => r.body.error?.code === 201);
    assert.equal(ok.length, 1, JSON.stringify(replies.map((r) => r.body)));
    assert.equal(dup.length, 7);
    assert.deepEqual(await wallet(uid), { balance: 20_000, points: 2_000 });
    assert.equal((await ordersOf(txn)).length, 1);
    assert.equal((await ledger(uid)).length, 2, "one top-up + one bonus");
  });

  await t.test("atomicity: a failure after the order insert leaves NO order and NO credit; -32603 without details; a retry succeeds", async () => {
    const uid = await mkUser();
    const txn = nextTxn();
    await query(`CREATE OR REPLACE FUNCTION paynet_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
                 BEGIN IF NEW.reference = 'paynet:${txn}' THEN RAISE EXCEPTION 'injected failure after the order insert'; END IF; RETURN NEW; END $$`);
    await query(`CREATE TRIGGER paynet_test_fail BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION paynet_test_fail()`);
    let text = "";
    try {
      const { out: r, text: logs } = await captureLogs(() => perform(uid, 3_000_000, txn, {}));
      text = logs;
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.error, { code: -32603, message: "Системная ошибка" }, "no internal detail leaks to Paynet");
    } finally {
      await query(`DROP TRIGGER IF EXISTS paynet_test_fail ON transactions`);
      await query(`DROP FUNCTION IF EXISTS paynet_test_fail()`);
    }
    assert.match(text, /\[paynet\] internal error/);
    assert.equal((await ordersOf(txn)).length, 0, "the order insert was rolled back with the failed credit");
    assert.deepEqual(await wallet(uid), { points: 0, balance: 0 });
    assert.equal((await ledger(uid)).length, 0);
    // Paynet retries the same transactionId: it is not a «duplicate» of the failed attempt.
    const retry = await perform(uid, 3_000_000, txn, {});
    assert.equal(retry.body.error, undefined, JSON.stringify(retry.body));
    assert.deepEqual(await wallet(uid), { balance: 30_000, points: 3_000 });
  });

  await t.test("amount rules: tiyin, integer > 0, whole so'm, MIN..MAX so'm (413 / 415); nothing created for a refused amount", async () => {
    const uid = await mkUser();
    const before = await countAll();
    const cases: Array<[unknown, number]> = [
      [0, 413],
      [-100_000, 413],
      [100_050, 413], // not whole so'm
      [1_000_001, 413],
      [100_000.5, 413],
      ["abc", 413],
      ["1e6", 413],
      [true, 413],
      [99_900, 413], // 999 so'm < MIN
      [1_000_000_100, 415], // 10 000 001 so'm > MAX
      [9_000_000_000, 415],
    ];
    for (const [amount, code] of cases) {
      assert.equal((await perform(uid, amount, nextTxn(), {})).body.error?.code, code, JSON.stringify(amount));
    }
    const after = await countAll();
    assert.equal(after.orders, before.orders);
    assert.equal(after.ledger, before.ledger);
    // Edges that are accepted: exactly MIN and exactly MAX so'm; a digit-string amount.
    assert.equal((await perform(uid, 100_000, nextTxn(), {})).body.result?.fields !== undefined, true, "1 000 so'm");
    assert.equal((await wallet(uid)).balance, 1_000);
    assert.equal((await perform(uid, "200000", nextTxn(), {})).body.result !== undefined, true, "digit string");
    assert.equal((await wallet(uid)).balance, 3_000);
    assert.equal((await perform(uid, 1_000_000_000, nextTxn(), {})).body.result !== undefined, true, "10 000 000 so'm");
    assert.equal((await wallet(uid)).balance, 10_003_000);
  });

  await t.test("transactionId must be a positive safe integer (digit string ok) → else -32602; missing params → -32602", async () => {
    const uid = await mkUser();
    for (const bad of [0, -1, 1.5, "abc", "", "-7", 2 ** 53, true, {}]) {
      assert.equal((await perform(uid, 1_000_000, bad, {})).body.error?.code, -32602, JSON.stringify(bad));
    }
    for (const missing of ["amount", "transactionId", "fields"]) {
      const params: Record<string, unknown> = { serviceId: 101, amount: 1_000_000, transactionId: nextTxn(), fields: { client_id: uid } };
      delete params[missing];
      assert.equal((await rpc("PerformTransaction", params)).body.error?.code, -32602, missing);
    }
    assert.deepEqual(await wallet(uid), { points: 0, balance: 0 });
  });

  // ───────── CheckTransaction / CancelTransaction

  await t.test("CheckTransaction: paid → state 1 + our providerTrnId + perform time; unknown → state 3, providerTrnId 0; 414; -32602", async () => {
    const uid = await mkUser();
    const txn = nextTxn();
    const p = (await perform(uid, 1_000_000, txn, {})).body.result!;
    const ts = formatTashkent(Date.now());
    const r = await rpc("CheckTransaction", { serviceId: 101, transactionId: txn, timestamp: ts }, { id: "chk" });
    assert.equal(r.body.id, "chk");
    assert.deepEqual(r.body.result, { transactionState: 1, providerTrnId: p.providerTrnId, timestamp: p.timestamp });
    assert.equal((await rpc("CheckTransaction", { serviceId: 101, transactionId: String(txn), timestamp: ts })).body.result?.transactionState, 1);
    const none = await rpc("CheckTransaction", { serviceId: 101, transactionId: 123_456_789_012, timestamp: ts });
    assert.equal(none.body.result?.transactionState, 3);
    assert.equal(none.body.result?.providerTrnId, 0);
    assert.match(String(none.body.result?.timestamp), TS);
    for (const bad of ["2026-10-16", "2026-02-30 00:00:00", 5, "now"]) {
      assert.equal((await rpc("CheckTransaction", { serviceId: 101, transactionId: txn, timestamp: bad })).body.error?.code, 414, String(bad));
    }
    assert.equal((await rpc("CheckTransaction", { serviceId: 101, transactionId: txn })).body.error?.code, -32602);
    assert.equal((await rpc("CheckTransaction", { serviceId: 101, transactionId: "x", timestamp: ts })).body.error?.code, -32602);
  });

  await t.test("Cancel never cancels: found → 77 (balance, ledger, order unchanged); unknown → 203; 414 for a bad timestamp", async () => {
    const uid = await mkUser();
    const txn = nextTxn();
    await perform(uid, 4_000_000, txn, {});
    const w = await wallet(uid);
    const l = (await ledger(uid)).length;
    const ts = formatTashkent(Date.now());
    for (let i = 0; i < 2; i++) {
      const r = await rpc("CancelTransaction", { serviceId: 101, transactionId: txn, timestamp: ts }, { id: i });
      assert.equal(r.status, 200);
      assert.equal(r.body.id, i);
      assert.equal(r.body.error?.code, 77);
    }
    assert.deepEqual(await wallet(uid), w);
    assert.equal((await ledger(uid)).length, l);
    const [o] = await ordersOf(txn);
    assert.equal(o!.state, "paid");
    const cancel = await query<{ cancel_time: string; cancel_reason: number | null }>(`SELECT cancel_time, cancel_reason FROM payment_orders WHERE id = $1`, [o!.id]);
    assert.deepEqual(cancel[0], { cancel_time: "0", cancel_reason: null });
    assert.equal((await rpc("CheckTransaction", { serviceId: 101, transactionId: txn, timestamp: ts })).body.result?.transactionState, 1, "still paid");
    assert.equal((await rpc("CancelTransaction", { serviceId: 101, transactionId: 987_654_321, timestamp: ts })).body.error?.code, 203);
    assert.equal((await rpc("CancelTransaction", { serviceId: 101, transactionId: txn, timestamp: "bad" })).body.error?.code, 414);
  });

  // ───────── GetStatement

  await t.test("GetStatement: paid Paynet orders in [dateFrom, dateTo] Tashkent time, inclusive to the second, ordered, amount in tiyin", async () => {
    const uid = await mkUser();
    // 2020-03-01 00:00:00 Tashkent = 2020-02-29 19:00:00 UTC.
    const t0 = Date.UTC(2020, 1, 29, 19, 0, 0);
    const mk = async (txn: number, at: number, soum: number) => {
      const out = await payments.createPaidPaynetOrder({ userId: uid, amountSoum: soum, transactionId: String(txn), now: at });
      assert.equal(out.status, "paid");
      return out.status === "paid" ? out.providerTrnId : 0;
    };
    const a = await mk(7_100_001, t0 + 3_600_000, 2_000); // 01:00:00
    const b = await mk(7_100_002, t0, 1_000); //            00:00:00 (inserted later, earlier time)
    const c = await mk(7_100_003, t0 + 86_399_500, 3_000); // 23:59:59.500
    await mk(7_100_004, t0 + 86_400_000, 4_000); //          next day 00:00:00
    await mk(7_100_005, t0 - 1, 5_000); //                   the day before, 23:59:59.999
    // A Click order paid inside the window never shows up.
    const click = await payments.createOrder({ userId: uid, provider: "click", purpose: "topup", amountSoum: 9_000 });
    await query(`UPDATE payment_orders SET state = 'paid', perform_time = $2 WHERE id = $1`, [click.id, t0 + 1_000]);

    const r = await rpc("GetStatement", { serviceId: 101, dateFrom: "2020-03-01 00:00:00", dateTo: "2020-03-01 23:59:59" }, { id: "st" });
    assert.equal(r.body.id, "st");
    assert.deepEqual(r.body.result, {
      statements: [
        { amount: 100_000, transactionId: 7_100_002, providerTrnId: b, timestamp: "2020-03-01 00:00:00" },
        { amount: 200_000, transactionId: 7_100_001, providerTrnId: a, timestamp: "2020-03-01 01:00:00" },
        { amount: 300_000, transactionId: 7_100_003, providerTrnId: c, timestamp: "2020-03-01 23:59:59" },
      ],
    });
    const one = await rpc("GetStatement", { serviceId: 101, dateFrom: "2020-03-01 00:00:00", dateTo: "2020-03-01 00:00:00" });
    assert.deepEqual((one.body.result!.statements as Array<{ transactionId: number }>).map((s) => s.transactionId), [7_100_002], "a one-second window");
    const empty = await rpc("GetStatement", { serviceId: 101, dateFrom: "2019-01-01 00:00:00", dateTo: "2019-12-31 23:59:59" });
    assert.deepEqual(empty.body.result, { statements: [] });
    for (const [dateFrom, dateTo] of [
      ["2020-03-02 00:00:00", "2020-03-01 00:00:00"],
      ["2020-03-01", "2020-03-01 23:59:59"],
      ["2020-03-01 00:00:00", "2020-02-30 00:00:00"],
      [1, 2],
    ]) {
      assert.equal((await rpc("GetStatement", { serviceId: 101, dateFrom, dateTo })).body.error?.code, 414, `${dateFrom}..${dateTo}`);
    }
    assert.equal((await rpc("GetStatement", { serviceId: 101, dateFrom: "2020-03-01 00:00:00" })).body.error?.code, -32602);
  });

  // ───────── audit + logs

  await t.test("payment_events: one row per authenticated call (method, order, transactionId, code), never the password", async () => {
    const uid = await mkUser();
    const txn = nextTxn();
    const since = Number((await query<{ m: string }>(`SELECT COALESCE(max(id), 0) m FROM payment_events`))[0]!.m);
    await perform(uid, 1_000_000, txn, { password: "should-be-redacted" });
    await perform(uid, 1_000_000, txn, {});
    await rpc("CancelTransaction", { serviceId: 101, transactionId: txn, timestamp: formatTashkent(Date.now()) });
    await rpc("ChangePassword", { serviceId: 101, password: "new-secret-pass" });
    await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } }, { auth: null });
    const rows = await query<{ provider: string; method: string; order_id: string | null; provider_txn: string | null; response_code: number; payload: unknown }>(
      `SELECT provider, method, order_id, provider_txn, response_code, payload FROM payment_events WHERE id > $1 ORDER BY id`,
      [since],
    );
    const [order] = await ordersOf(txn);
    assert.deepEqual(
      rows.map((r) => [r.provider, r.method, r.order_id, r.provider_txn, r.response_code]),
      [
        ["paynet", "PerformTransaction", order!.id, String(txn), 0],
        ["paynet", "PerformTransaction", order!.id, String(txn), 201],
        ["paynet", "CancelTransaction", order!.id, String(txn), 77],
        ["paynet", "ChangePassword", null, null, -32601],
      ],
    );
    const all = JSON.stringify(rows);
    for (const secret of [PASS, "should-be-redacted", "new-secret-pass", BASIC]) assert.ok(!all.includes(secret), secret);
    assert.match(all, /\[REDACTED\]/);
  });

  await t.test("log: exactly one «[paynet] call» line per call (method, serviceId, code, ms); never the Authorization or password", async () => {
    const uid = await mkUser();
    const { text } = await captureLogs(async () => {
      await perform(uid, 1_000_000, nextTxn(), {});
    });
    const lines = text.split("\n").filter((l) => l.includes("[paynet] call"));
    assert.equal(lines.length, 1, text);
    assert.match(lines[0]!, /"method":"PerformTransaction"/);
    assert.match(lines[0]!, /"serviceId":101/);
    assert.match(lines[0]!, /"code":0/);
    assert.match(lines[0]!, /"ms":\d+/);
    const { text: denied } = await captureLogs(async () => {
      await rpc("GetInformation", { serviceId: 101, fields: { client_id: uid } }, { auth: `Basic ${Buffer.from(`${USER}:leaked-guess-pass`).toString("base64")}` });
    });
    assert.equal(denied.split("\n").filter((l) => l.includes("[paynet] call")).length, 1);
    assert.match(denied, /"code":412/);
    for (const s of [text, denied]) {
      for (const secret of [PASS, BASIC.slice(6), "leaked-guess-pass", Buffer.from(`${USER}:leaked-guess-pass`).toString("base64")]) {
        assert.ok(!s.includes(secret), `log leaks ${secret}`);
      }
    }
    assert.equal(outbound, 0);
  });
});
