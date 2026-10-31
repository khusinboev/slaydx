import "./helpers/next-request.mts";
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin «Provayderlar» API through the REAL routes on a throwaway Postgres (program-17 decision D7):
 *
 *   - GET lists every registry provider with the exact shape and NEVER a key; the masked hint only for roles that
 *     may edit (owner/admin), finance/viewer read without it, support/moderator are refused;
 *   - PUT key: reason and a plausible key are required, a fresh step-up is required (401 `reauth` otherwise),
 *     the key is sealed, the response and the audit row carry the masked hint only, the DB column holds no
 *     plaintext, the next read of the process resolves the new key (DB > env), replace/delete are audited;
 *   - PUT enabled: a disabled provider hides its env key at once; same-state writes are 409 and write no audit;
 *   - «Tekshirish»: the key goes in a header (not the URL), the answer never contains it, errors are redacted;
 *   - the audit row is written in the SAME transaction as the change (a failing audit rolls the change back);
 *   - no sealing key configured: 503 `crypto_unavailable`, nothing written, toggles still work;
 *   - the plaintext never appears in any response body, log line, audit row or table cell.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - return the plaintext in GET (`keyHint` -> the key) -> "GET never carries a key" fails;
 *   - skip step-up on PUT key (`settings.edit` -> `settings.view` in key/route.ts) -> the step-up and the RBAC tests fail;
 *   - ignore `enabled` in `getProviderKey` -> "enabled toggle" fails (env key still resolves);
 *   - drop the AAD binding in providers/crypto.ts -> "swapped ciphertext" fails (and the crypto tests of provider-keys.test.mts);
 *   - write the audit row outside `adminTx` -> "audit failure rolls the change back" fails.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.WORKER_INLINE = "false";
const ADMIN_KEY = randomBytes(32).toString("base64");
process.env.ADMIN_TOTP_KEY = ADMIN_KEY;
delete process.env.PROVIDER_KEYS_KEY;
// 2FA-mode suite: the strengthened flow (step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:provider-keys-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("provadmin") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const resolve = await import("../lib/server/providers/resolve.ts");
const store = await import("../lib/server/providers/store.ts");
const registry = await import("../lib/server/providers/registry.ts");
const crypto = await import("../lib/server/providers/crypto.ts");
const probe = await import("../lib/server/providers/probe.ts");
const listRoute = await import("../app/api/admin/providers/route.ts");
const enabledRoute = await import("../app/api/admin/providers/[id]/enabled/route.ts");
const keyRoute = await import("../app/api/admin/providers/[id]/key/route.ts");
const testRoute = await import("../app/api/admin/providers/[id]/test/route.ts");

// ───────────────────────────── capture everything that is logged or answered

const logged: string[] = [];
const bodies: string[] = [];
const secrets: string[] = [];
for (const m of ["log", "info", "warn", "error", "debug"] as const) {
  const orig = console[m].bind(console);
  console[m] = (...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    orig(...args);
  };
}
const origStdout = process.stdout.write.bind(process.stdout);
const origStderr = process.stderr.write.bind(process.stderr);
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  logged.push(String(chunk));
  return (origStdout as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;
process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
  logged.push(String(chunk));
  return (origStderr as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stderr.write;

after(async () => {
  if (!hasDb) return;
  store.stopProviderKeyRefresh();
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

const fresh = () => {
  const k = randomBytes(18).toString("base64url");
  secrets.push(k);
  return k;
};

beforeEach(async () => {
  for (const id of registry.PROVIDER_IDS) for (const e of registry.providerDef(id)!.envKeys) delete process.env[e];
  process.env.ADMIN_TOTP_KEY = ADMIN_KEY;
  delete process.env.PROVIDER_KEYS_KEY;
  if (hasDb) {
    resolve.registerProviderSource(store.loadProviderSnapshot);
    await query("DELETE FROM provider_settings");
    await store.reloadProviderKeys();
  }
});

// ───────────────────────────── fixtures (admin-settings.test.mts pattern)

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name = "Providers Test"): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, balance) VALUES ($1, $2, $3, 0) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `p_${randomBytes(5).toString("hex")}`, name],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function mkAdmin(role: Role): Promise<TestAdmin> {
  const u = await mkUser(`Admin ${role}`);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  return { ...u, adminId: row!.id };
}

async function openSession(admin: TestAdmin, reauth = true): Promise<Session> {
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(admin.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "providers-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

const session = async (role: Role, reauth = true) => openSession(await mkAdmin(role), reauth);

type Result = { status: number; body: Record<string, unknown>; text: string };

async function readResult(res: Response): Promise<Result> {
  const text = await res.text();
  bodies.push(text);
  try {
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, text };
  } catch {
    return { status: res.status, body: {}, text };
  }
}

function headersFor(cookie: string | null, origin: boolean): Record<string, string> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "providers-test", "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = "http://localhost:3000";
  return headers;
}

async function list(cookie: string | null): Promise<Result> {
  const req = new Request("http://localhost:3000/api/admin/providers", { method: "GET", headers: headersFor(cookie, false) });
  return readResult(await inRequest(req, () => listRoute.GET(req, undefined)));
}

type Mod = { PUT?: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>; DELETE?: typeof keyRoute.DELETE; POST?: typeof testRoute.POST };

async function send(route: "enabled" | "key" | "test", method: "PUT" | "DELETE" | "POST", cookie: string | null, id: string, body: unknown, opts: { origin?: boolean; raw?: string } = {}): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/providers/${encodeURIComponent(id)}/${route}`, {
    method,
    headers: headersFor(cookie, opts.origin !== false),
    body: opts.raw ?? JSON.stringify(body),
  });
  const mod: Mod = route === "enabled" ? enabledRoute : route === "key" ? keyRoute : testRoute;
  const fn = mod[method]!;
  return readResult(await inRequest(req, () => fn(req, { params: Promise.resolve({ id }) })));
}

const putEnabled = (c: string | null, id: string, body: unknown, o?: { origin?: boolean }) => send("enabled", "PUT", c, id, body, o);
const putKey = (c: string | null, id: string, body: unknown, o?: { origin?: boolean; raw?: string }) => send("key", "PUT", c, id, body, o);
const delKey = (c: string | null, id: string, body: unknown, o?: { origin?: boolean }) => send("key", "DELETE", c, id, body, o);
const postTest = (c: string | null, id: string) => send("test", "POST", c, id, {});

type Item = {
  id: string;
  label: string;
  kinds: string[];
  implemented: boolean;
  testable: boolean;
  keyFormat: string;
  enabled: boolean;
  hasDbKey: boolean;
  keyHint: string | null;
  envPresent: boolean;
  keySource: string;
  unreadable: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

const itemOf = (r: Result, id: string): Item => {
  const found = (r.body.items as Item[]).find((i) => i.id === id);
  assert.ok(found, `${id} ro'yxatda yo'q`);
  return found;
};

const audits = (adminId: string, action?: string) =>
  query<{ action: string; outcome: string; target_type: string | null; target_id: string | null; reason: string | null; before: unknown; after: unknown; meta: unknown }>(
    `SELECT action, outcome, target_type, target_id, reason, before, after, meta FROM admin_audit_log
      WHERE admin_id = $1 AND ($2::text IS NULL OR action = $2) ORDER BY id`,
    [adminId, action ?? null],
  );
const rowOf = (id: string) => queryOne<{ enabled: boolean; key_ciphertext: Buffer | null; key_hint: string | null }>("SELECT enabled, key_ciphertext, key_hint FROM provider_settings WHERE provider = $1", [id]);

const REASON = "Yangi kalit olindi";

// ───────────────────────────── GET

test("GET: every registry provider with the exact shape; no key anywhere", { skip }, async () => {
  const s = await session("owner");
  process.env.GEMINI_API_KEY = "env-gemini-secret-1234";
  const r = await list(s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["canStoreKeys", "generatedAt", "items", "otherUsage", "propagationSec", "purposes", "sealingKey", "soumPerUsd", "system", "total30"]);
  assert.equal(r.body.canStoreKeys, true);
  assert.equal(r.body.sealingKey, "admin", "only ADMIN_TOTP_KEY is set: the fallback");
  process.env.PROVIDER_KEYS_KEY = randomBytes(32).toString("base64");
  assert.equal((await list(s.cookie)).body.sealingKey, "provider");
  delete process.env.PROVIDER_KEYS_KEY;
  assert.equal(r.body.propagationSec, 30);
  const items = r.body.items as Item[];
  assert.deepEqual(items.map((i) => i.id), [...registry.PROVIDER_IDS]);
  for (const i of items) {
    assert.deepEqual(
      Object.keys(i).sort(),
      [
        "billing", "breaker", "enabled", "envPresent", "hasDbKey", "id", "implemented", "keyFormat", "keyHint", "keySource", "keyUrl", "keyless", "kinds", "label", "need",
        "priceNote", "purposes", "role", "testable", "unreadable", "updatedAt", "updatedBy", "usable", "usage",
      ],
    );
    assert.equal(i.enabled, true);
    assert.equal(i.hasDbKey, false);
    assert.equal(i.keyHint, null);
    assert.equal(i.updatedAt, null);
  }
  const g = itemOf(r, "gemini");
  assert.equal(g.envPresent, true);
  assert.equal(g.keySource, "env");
  assert.deepEqual(g.kinds, ["llm", "image", "tts"]);
  assert.equal(itemOf(r, "anthropic").keySource, "none");
  // Program-17 item 5: Kling, Veo and ElevenLabs have adapters now (no provider is merely reserved any more).
  for (const id of ["kling", "veo", "elevenlabs"]) assert.equal(itemOf(r, id).implemented, true, id);
  assert.equal(itemOf(r, "veo").envPresent, true, "Veo reads the Gemini env var");
  assert.ok(!r.text.includes("env-gemini-secret-1234"), "an env key is never sent");
});

test("GET never carries a key: not the env one, not the stored one, for any role", { skip }, async () => {
  const owner = await session("owner");
  const K = fresh();
  process.env.ELEVENLABS_API_KEY = "env-eleven-secret-5678";
  assert.equal((await putKey(owner.cookie, "elevenlabs", { key: K, reason: REASON })).status, 200);
  for (const role of ["owner", "admin", "finance", "viewer"] as const) {
    const s = await session(role);
    const r = await list(s.cookie);
    assert.equal(r.status, 200, role);
    assert.ok(!r.text.includes(K), `${role}: stored key leaked`);
    assert.ok(!r.text.includes("env-eleven-secret-5678"), `${role}: env key leaked`);
    const eleven = itemOf(r, "elevenlabs");
    assert.equal(eleven.hasDbKey, true, role);
    assert.equal(eleven.keySource, "db");
    // The masked hint only for those who can edit.
    assert.equal(eleven.keyHint, role === "owner" || role === "admin" ? `…${K.slice(-4)}` : null, role);
  }
  for (const role of ["support", "moderator"] as const) {
    const s = await session(role);
    const r = await list(s.cookie);
    assert.equal(r.status, 403, role);
    assert.equal(r.body.code, "forbidden");
  }
  // Not an admin at all: the panel's existence is not revealed.
  const u = await mkUser("Plain user");
  const none = await list(`${SESSION_COOKIE}=${u.userToken}`);
  assert.equal(none.status, 404);
  assert.equal((await list(null)).status, 404);
});

// ───────────────────────────── PUT key

test("PUT key: validation first -- reason, shape of the key, unknown provider, Origin", { skip }, async () => {
  const s = await session("owner");
  const ok = fresh();
  const cases: [string, unknown, number][] = [
    ["no reason", { key: ok }, 400],
    ["short reason", { key: ok, reason: "abc" }, 400],
    ["no key", { reason: REASON }, 400],
    ["empty key", { key: "   ", reason: REASON }, 400],
    ["too short key", { key: "short", reason: REASON }, 400],
    ["key with a space", { key: "abcd efgh ijkl", reason: REASON }, 400],
    ["key with a newline", { key: "abcdefgh\nijkl", reason: REASON }, 400],
    ["non-ASCII key", { key: "kalit-ўзбек-1234", reason: REASON }, 400],
    ["too long key", { key: "a".repeat(513), reason: REASON }, 400],
    ["key is a number", { key: 12345678, reason: REASON }, 400],
  ];
  for (const [label, body, status] of cases) {
    const r = await putKey(s.cookie, "gemini", body);
    assert.equal(r.status, status, `${label}: ${r.text}`);
  }
  assert.equal((await putKey(s.cookie, "no-such-provider", { key: ok, reason: REASON })).status, 404);
  const unknown = await putKey(s.cookie, "constructor", { key: ok, reason: REASON });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "not_found");
  assert.equal((await putKey(s.cookie, "gemini", { key: ok, reason: REASON }, { origin: false })).status, 403);
  assert.equal((await putKey(s.cookie, "gemini", null, { raw: "not json" })).status, 400);
  assert.equal(await rowOf("gemini"), null, "nothing was written by any refused call");
  assert.equal((await audits(s.admin.adminId, "providers.key_set")).length, 0);
});

test("PUT key: sealed in the DB, masked in the answer and the audit row, DB wins over the env var, replace and delete are audited", { skip }, async () => {
  const s = await session("owner");
  const K1 = fresh();
  const K2 = fresh();
  process.env.ELEVENLABS_API_KEY = "env-eleven-key-1";
  assert.equal(resolve.getProviderKey("elevenlabs"), "env-eleven-key-1");

  const r1 = await putKey(s.cookie, "elevenlabs", { key: `  ${K1}  `, reason: REASON });
  assert.equal(r1.status, 200, r1.text);
  const item = r1.body.item as Item;
  assert.equal(item.hasDbKey, true);
  assert.equal(item.keyHint, `…${K1.slice(-4)}`);
  assert.equal(item.keySource, "db");
  assert.equal(item.envPresent, true);
  assert.equal(item.updatedBy, "Admin owner");
  assert.ok(!r1.text.includes(K1), "response holds no key");

  const row = await rowOf("elevenlabs");
  assert.ok(row?.key_ciphertext && row.key_hint === `…${K1.slice(-4)}`);
  for (const enc of ["utf8", "latin1", "base64", "base64url", "hex"] as const) assert.ok(!row!.key_ciphertext!.toString(enc).includes(K1), `ciphertext shows the key as ${enc}`);
  assert.ok(row!.key_ciphertext!.toString("ascii").startsWith("pk1."));
  assert.equal(crypto.openProviderKey("elevenlabs", row!.key_ciphertext!), K1, "trimmed, sealed under the provider id");

  // The very next read in this process resolves the stored key; the env var is only the fallback.
  assert.equal(resolve.getProviderKey("elevenlabs"), K1);

  const a1 = await audits(s.admin.adminId, "providers.key_set");
  assert.equal(a1.length, 1);
  assert.deepEqual([a1[0]!.outcome, a1[0]!.target_type, a1[0]!.target_id, a1[0]!.reason], ["ok", "provider", "elevenlabs", REASON]);
  assert.deepEqual(a1[0]!.before, { hasKey: false, hint: null });
  assert.deepEqual(a1[0]!.after, { hasKey: true, hint: `…${K1.slice(-4)}` });
  assert.ok(!JSON.stringify(a1[0]).includes(K1), "audit row holds no key");

  // Replace.
  const r2 = await putKey(s.cookie, "elevenlabs", { key: K2, reason: "Kalit almashtirildi" });
  assert.equal(r2.status, 200, r2.text);
  assert.equal((r2.body.item as Item).keyHint, `…${K2.slice(-4)}`);
  assert.equal(resolve.getProviderKey("elevenlabs"), K2);
  const a2 = await audits(s.admin.adminId, "providers.key_replace");
  assert.equal(a2.length, 1);
  assert.deepEqual(a2[0]!.before, { hasKey: true, hint: `…${K1.slice(-4)}` });
  assert.deepEqual(a2[0]!.after, { hasKey: true, hint: `…${K2.slice(-4)}` });
  assert.ok(!JSON.stringify(a2[0]).includes(K1) && !JSON.stringify(a2[0]).includes(K2));

  // Delete: the env var applies again.
  const bad = await delKey(s.cookie, "elevenlabs", {});
  assert.equal(bad.status, 400, "reason required");
  const d = await delKey(s.cookie, "elevenlabs", { reason: "Kalit eskirgan" });
  assert.equal(d.status, 200, d.text);
  assert.equal((d.body.item as Item).hasDbKey, false);
  assert.equal((d.body.item as Item).keyHint, null);
  assert.equal((d.body.item as Item).keySource, "env");
  assert.equal(resolve.getProviderKey("elevenlabs"), "env-eleven-key-1");
  const a3 = await audits(s.admin.adminId, "providers.key_delete");
  assert.equal(a3.length, 1);
  assert.deepEqual(a3[0]!.before, { hasKey: true, hint: `…${K2.slice(-4)}` });
  assert.deepEqual(a3[0]!.after, { hasKey: false, hint: null });
  const again = await delKey(s.cookie, "elevenlabs", { reason: "Yana o'chirish" });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "state");
  assert.equal((await audits(s.admin.adminId, "providers.key_delete")).length, 1, "a refused delete writes no audit row");
});

test("PUT key: Kling (video) accepts an <accessKey>:<secretKey> key and is implemented", { skip }, async () => {
  const s = await session("admin");
  const K = `AK${fresh()}:SK${fresh()}`;
  const r = await putKey(s.cookie, "kling", { key: K, reason: REASON });
  assert.equal(r.status, 200, r.text);
  const item = r.body.item as Item;
  assert.equal(item.implemented, true);
  assert.equal(item.hasDbKey, true);
  assert.equal(resolve.getProviderKey("kling"), K);
});

test("step-up: every write needs a fresh re-authentication (401 reauth) and writes nothing without it", { skip }, async () => {
  const stale = await session("owner", false);
  const K = fresh();
  for (const [name, r] of [
    ["PUT key", await putKey(stale.cookie, "elevenlabs", { key: K, reason: REASON })],
    ["DELETE key", await delKey(stale.cookie, "elevenlabs", { reason: REASON })],
    ["PUT enabled", await putEnabled(stale.cookie, "elevenlabs", { enabled: false, reason: REASON })],
    ["POST test", await postTest(stale.cookie, "gemini")],
  ] as const) {
    assert.equal(r.status, 401, name);
    assert.equal(r.body.code, "reauth", name);
  }
  assert.equal(await rowOf("elevenlabs"), null);
  assert.equal((await audits(stale.admin.adminId)).length, 0);
  // A read needs no step-up.
  assert.equal((await list(stale.cookie)).status, 200);
});

test("RBAC: only owner and admin write; finance/viewer/support/moderator are refused with a denied audit row and no change", { skip }, async () => {
  const K = fresh();
  const providersRows = async () => (await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM admin_audit_log WHERE action LIKE 'providers.%'"))!.n;
  const before = await providersRows();
  for (const role of ["finance", "viewer", "support", "moderator"] as const) {
    const s = await session(role);
    for (const [name, r] of [
      ["PUT key", await putKey(s.cookie, "elevenlabs", { key: K, reason: REASON })],
      ["DELETE key", await delKey(s.cookie, "elevenlabs", { reason: REASON })],
      ["PUT enabled", await putEnabled(s.cookie, "elevenlabs", { enabled: false, reason: REASON })],
      ["POST test", await postTest(s.cookie, "gemini")],
    ] as const) {
      assert.equal(r.status, 403, `${role} ${name}`);
      assert.equal(r.body.code, "forbidden");
    }
    const denied = (await audits(s.admin.adminId)).filter((a) => a.outcome === "denied");
    assert.equal(denied.length, 4, `${role}: one denied row per refused call`);
  }
  assert.equal(await rowOf("elevenlabs"), null);
  assert.equal(await providersRows(), before, "no providers.* row from refused calls");
  // owner and admin both may (the owner switches Pexels off, the admin back on).
  const owner = await session("owner");
  const admin = await session("admin");
  assert.equal((await putEnabled(owner.cookie, "pexels", { enabled: false, reason: REASON })).status, 200);
  assert.equal((await putEnabled(admin.cookie, "pexels", { enabled: true, reason: REASON })).status, 200);
  assert.equal((await audits(admin.admin.adminId, "providers.enable")).length, 1);
});

// ───────────────────────────── enabled toggle

test("enabled toggle: off hides the env key at once, is audited, repeats are 409; on restores it", { skip }, async () => {
  const s = await session("owner");
  process.env.GEMINI_API_KEY = "env-gemini-key-1234";
  assert.equal(resolve.getProviderKey("gemini"), "env-gemini-key-1234");

  assert.equal((await putEnabled(s.cookie, "gemini", { enabled: false })).status, 400, "reason required");
  assert.equal((await putEnabled(s.cookie, "gemini", { enabled: "no", reason: REASON })).status, 400, "enabled must be a boolean");
  assert.equal((await putEnabled(s.cookie, "gemini", { reason: REASON })).status, 400);
  assert.equal((await putEnabled(s.cookie, "nope", { enabled: false, reason: REASON })).status, 404);

  const off = await putEnabled(s.cookie, "gemini", { enabled: false, reason: "Kvota tugadi" });
  assert.equal(off.status, 200, off.text);
  const item = off.body.item as Item;
  assert.equal(item.enabled, false);
  assert.equal(item.keySource, "none", "switched off: no key in use although the env var exists");
  assert.equal(item.envPresent, true);
  assert.equal(resolve.isProviderEnabled("gemini"), false);
  assert.equal(resolve.getProviderKey("gemini"), "", "the env key is hidden");
  const a = await audits(s.admin.adminId, "providers.disable");
  assert.equal(a.length, 1);
  assert.deepEqual([a[0]!.target_id, a[0]!.reason, a[0]!.before, a[0]!.after], ["gemini", "Kvota tugadi", { enabled: true }, { enabled: false }]);

  const twice = await putEnabled(s.cookie, "gemini", { enabled: false, reason: REASON });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.code, "state");
  assert.equal((await audits(s.admin.adminId, "providers.disable")).length, 1);

  // GET shows it, for everyone who can read.
  const viewer = await session("viewer");
  assert.equal(itemOf(await list(viewer.cookie), "gemini").enabled, false);

  const on = await putEnabled(s.cookie, "gemini", { enabled: true, reason: "Kvota tiklandi" });
  assert.equal(on.status, 200);
  assert.equal(resolve.getProviderKey("gemini"), "env-gemini-key-1234");
  assert.equal((await audits(s.admin.adminId, "providers.enable")).length, 1);
  assert.equal((await putEnabled(s.cookie, "gemini", { enabled: true, reason: REASON })).status, 409, "already on");
});

test("enabled toggle hides a stored key too, and storing a key does not switch the provider back on", { skip }, async () => {
  const s = await session("owner");
  const K = fresh();
  assert.equal((await putKey(s.cookie, "pixabay", { key: K, reason: REASON })).status, 200);
  assert.equal(resolve.getProviderKey("pixabay"), K);
  assert.equal((await putEnabled(s.cookie, "pixabay", { enabled: false, reason: REASON })).status, 200);
  assert.equal(resolve.getProviderKey("pixabay"), "");
  const K2 = fresh();
  assert.equal((await putKey(s.cookie, "pixabay", { key: K2, reason: REASON })).status, 200);
  assert.equal(resolve.isProviderEnabled("pixabay"), false, "a new key leaves the switch where it was");
  assert.equal(resolve.getProviderKey("pixabay"), "");
  assert.equal((await rowOf("pixabay"))?.enabled, false);
});

// ───────────────────────────── crypto unavailable / unreadable / worker

test("no sealing key: PUT key is 503 crypto_unavailable and writes nothing; toggles still work; GET says so", { skip }, async () => {
  const s = await session("owner");
  delete process.env.ADMIN_TOTP_KEY;
  try {
    const r = await putKey(s.cookie, "elevenlabs", { key: fresh(), reason: REASON });
    assert.equal(r.status, 503, r.text);
    assert.equal(r.body.code, "crypto_unavailable");
    assert.equal(await rowOf("elevenlabs"), null);
    assert.equal((await audits(s.admin.adminId, "providers.key_set")).length, 0);
    const g = await list(s.cookie);
    assert.equal(g.status, 200);
    assert.equal(g.body.canStoreKeys, false);
    assert.equal(g.body.sealingKey, "none");
    assert.equal((await putEnabled(s.cookie, "elevenlabs", { enabled: false, reason: REASON })).status, 200);
  } finally {
    process.env.ADMIN_TOTP_KEY = ADMIN_KEY;
  }
});

test("a stored key that cannot be opened is reported, ignored (env fallback) and can be replaced", { skip }, async () => {
  const s = await session("owner");
  const K = fresh();
  assert.equal((await putKey(s.cookie, "elevenlabs", { key: K, reason: REASON })).status, 200);
  // The row is copied onto another provider (swapped ciphertext): the AAD makes it unreadable there.
  await query(
    "INSERT INTO provider_settings (provider, key_ciphertext, key_hint) SELECT 'pexels', key_ciphertext, key_hint FROM provider_settings WHERE provider = 'elevenlabs'",
  );
  process.env.PEXELS_API_KEY = "env-pexels-key-1";
  await store.reloadProviderKeys();
  assert.equal(resolve.getProviderKey("pexels"), "env-pexels-key-1", "unreadable -> env");
  assert.equal(resolve.getProviderKey("elevenlabs"), K, "the row's own provider still opens it");
  const g = await list(s.cookie);
  const px = itemOf(g, "pexels");
  assert.equal(px.hasDbKey, true);
  assert.equal(px.unreadable, true);
  assert.equal(px.keySource, "env");
  assert.equal(itemOf(g, "elevenlabs").unreadable, false);
  // Entering a key again fixes it.
  const K2 = fresh();
  assert.equal((await putKey(s.cookie, "pexels", { key: K2, reason: REASON })).status, 200);
  assert.equal(resolve.getProviderKey("pexels"), K2);
  assert.equal(itemOf(await list(s.cookie), "pexels").unreadable, false);
  // Changing the master key makes every stored key unreadable; the env vars keep the product working.
  process.env.PROVIDER_KEYS_KEY = randomBytes(32).toString("base64");
  try {
    await store.reloadProviderKeys();
    assert.equal(resolve.getProviderKey("elevenlabs"), "", "unreadable and no env var: not configured, not a crash");
    process.env.ELEVENLABS_API_KEY = "env-eleven-key-1";
    assert.equal(resolve.getProviderKey("elevenlabs"), "env-eleven-key-1");
    assert.equal(itemOf(await list(s.cookie), "elevenlabs").unreadable, true);
  } finally {
    delete process.env.PROVIDER_KEYS_KEY;
  }
});

test("the worker process (fresh cache, same env) opens what the web process stored", { skip }, async () => {
  const s = await session("owner");
  const K = fresh();
  assert.equal((await putKey(s.cookie, "gemini", { key: K, reason: REASON })).status, 200);
  assert.equal((await putEnabled(s.cookie, "anthropic", { enabled: false, reason: REASON })).status, 200);
  process.env.ANTHROPIC_API_KEY = "env-anthropic-key-1234";
  // A different process starts with an empty cache and loads from the same database.
  resolve.resetProviderCache();
  assert.equal(resolve.getProviderKey("gemini"), "", "nothing loaded yet");
  await store.ensureProviderKeys();
  assert.equal(resolve.getProviderKey("gemini"), K);
  assert.equal(resolve.getProviderKey("anthropic"), "", "the switch is visible there too");
});

test("audit failure rolls the change back: the audit row is in the same transaction", { skip }, async () => {
  const s = await session("owner");
  await query(`CREATE OR REPLACE FUNCTION provider_test_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'providers.%' THEN RAISE EXCEPTION 'audit blocked for the test'; END IF; RETURN NEW; END $$`);
  await query("CREATE TRIGGER provider_test_block BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION provider_test_block()");
  try {
    const K = fresh();
    const r = await putKey(s.cookie, "elevenlabs", { key: K, reason: REASON });
    assert.equal(r.status, 500);
    assert.equal(await rowOf("elevenlabs"), null, "the key was not stored without its audit row");
    const e = await putEnabled(s.cookie, "elevenlabs", { enabled: false, reason: REASON });
    assert.equal(e.status, 500);
    assert.equal(await rowOf("elevenlabs"), null, "the switch was not stored either");
    assert.equal(resolve.isProviderEnabled("elevenlabs"), true);
  } finally {
    await query("DROP TRIGGER provider_test_block ON admin_audit_log");
    await query("DROP FUNCTION provider_test_block()");
  }
});

// ───────────────────────────── «Tekshirish»

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

test("test: the stored key goes in a header (not the URL); ok and rejected answers; the key never comes back", { skip }, async () => {
  const s = await session("owner");
  const K = fresh();
  assert.equal((await putKey(s.cookie, "gemini", { key: K, reason: REASON })).status, 200);
  const stub = stubFetch(() => new Response(JSON.stringify({ models: [] }), { status: 200 }));
  try {
    const ok = await postTest(s.cookie, "gemini");
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.body, { ok: true, message: "Kalit qabul qilindi" });
    assert.equal(stub.calls.length, 1);
    assert.ok(stub.calls[0]!.url.startsWith("https://generativelanguage.googleapis.com/"));
    assert.ok(!stub.calls[0]!.url.includes(K), "never in the URL");
    assert.equal((stub.calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"], K);
    assert.equal(stub.calls[0]!.init.redirect, "manual", "redirects are not followed");
  } finally {
    stub.restore();
  }
  // The provider rejects the key and echoes it in the error text: the answer is redacted.
  const echo = stubFetch(() => new Response(JSON.stringify({ error: { message: `API key ${K} is not valid; also ${encodeURIComponent(K)}` } }), { status: 400 }));
  try {
    const bad = await postTest(s.cookie, "gemini");
    assert.equal(bad.status, 200);
    assert.equal(bad.body.ok, false);
    assert.match(String(bad.body.message), /HTTP 400/);
    assert.ok(!bad.text.includes(K), "the echoed key is redacted");
  } finally {
    echo.restore();
  }
  // A network error that mentions the key.
  const boom = stubFetch(() => {
    throw new Error(`connect ECONNREFUSED https://x.invalid/?key=${K}`);
  });
  try {
    const net = await postTest(s.cookie, "gemini");
    assert.equal(net.body.ok, false);
    assert.match(String(net.body.message), /Tarmoq xatosi/);
    assert.ok(!net.text.includes(K));
  } finally {
    boom.restore();
  }
  const rows = await audits(s.admin.adminId, "providers.test");
  assert.deepEqual(rows.map((r) => r.meta), [{ ok: true }, { ok: false }, { ok: false }]);
  assert.ok(rows.every((r) => r.target_id === "gemini" && r.reason === null));
});

test("test: env key is used when none is stored, regardless of the switch; stock APIs that need the key in the URL stay redacted", { skip }, async () => {
  const s = await session("owner");
  const K = fresh();
  process.env.PIXABAY_API_KEY = K;
  const stub = stubFetch((url) => new Response(`bad key in ${url}`, { status: 400 }));
  try {
    assert.equal((await putEnabled(s.cookie, "pixabay", { enabled: false, reason: REASON })).status, 200);
    const r = await postTest(s.cookie, "pixabay");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.ok(stub.calls[0]!.url.includes(encodeURIComponent(K)), "Pixabay takes the key as a query parameter");
    assert.ok(!r.text.includes(K), "but the answer does not repeat it");
  } finally {
    stub.restore();
  }
});

test("test: no key, not testable, reserved and unknown providers", { skip }, async () => {
  const s = await session("owner");
  const stub = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    const none = await postTest(s.cookie, "anthropic");
    assert.equal(none.status, 200);
    assert.equal(none.body.ok, false);
    assert.match(String(none.body.message), /Kalit yo'q/);
    assert.equal(stub.calls.length, 0, "no key, no outbound call");
    assert.equal((await postTest(s.cookie, "openai-image")).status, 409, "no cheap call for the OpenAI image provider");
    assert.equal((await postTest(s.cookie, "elevenlabs")).status, 409, "reserved");
    // Removed providers are unknown ids now.
    for (const id of ["fal", "xai", "openrouter", "openai"]) assert.equal((await postTest(s.cookie, id)).status, 404, `${id} is removed`);
    assert.equal((await postTest(s.cookie, "nope")).status, 404);
    // Azure needs its region.
    process.env.AZURE_SPEECH_KEY = fresh();
    delete process.env.AZURE_SPEECH_REGION;
    const az = await postTest(s.cookie, "azure");
    assert.equal(az.body.ok, false);
    assert.match(String(az.body.message), /AZURE_SPEECH_REGION/);
    assert.equal(stub.calls.length, 0);
  } finally {
    delete process.env.AZURE_SPEECH_KEY;
    stub.restore();
  }
});

test("probe: 10 s timeout contract, redirects not followed, request builders", async () => {
  assert.equal(probe.PROBE_TIMEOUT_MS, 10_000);
  const K = "Probe1234Key5678";
  // A hung provider: the abort fires and the answer says so.
  const hung = ((_url: string, init: RequestInit) =>
    new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
  const started = Date.now();
  const r = await probe.probeProvider("gemini", K, { fetchImpl: hung, timeoutMs: 40 });
  assert.equal(r.ok, false);
  assert.match(r.message, /Vaqt tugadi/);
  assert.ok(Date.now() - started < 3_000);
  // Header placement per provider.
  const header = (id: string) => (probe.probeRequest(id, K) as { headers?: Record<string, string> }).headers;
  assert.equal(header("gemini")!["x-goog-api-key"], K);
  assert.equal(header("anthropic")!["x-api-key"], K);
  assert.equal(header("pexels")!.Authorization, K);
  for (const id of ["gemini", "anthropic", "pexels"]) assert.ok(!(probe.probeRequest(id, K) as { url: string }).url.includes(K), `${id}: key not in URL`);
  // The removed providers have no probe any more.
  for (const id of ["openai", "xai", "openrouter", "fal"]) assert.ok("error" in probe.probeRequest(id, K), `${id}: no probe`);
  // The Azure region is validated before it becomes a host name.
  assert.ok("error" in probe.probeRequest("azure", K, { azureRegion: "evil.example.com/x" }));
  assert.ok(!("error" in probe.probeRequest("azure", K, { azureRegion: "westeurope" })));
  assert.equal((await probe.probeProvider("nope", K)).ok, false);
  assert.equal((await probe.probeProvider("gemini", "")).ok, false);
  // redactProbeText: the key itself, its URL-encoded form and the usual shapes.
  const red = probe.redactProbeText(`key=${K} enc=${encodeURIComponent("a b" + K)} AIzaSyA1234567890123456789012345 sk-abcdefgh1234`, K);
  assert.ok(!red.includes(K) && !red.includes("AIzaSyA1234567890123456789012345") && !red.includes("sk-abcdefgh1234"), red);
  assert.ok(probe.redactProbeText("x".repeat(500), K).length <= 160);
});

// ───────────────────────────── nothing leaked anywhere

test("the plaintext of every key used in this file appears in no response, log line, audit row or table cell", { skip }, async () => {
  assert.ok(secrets.length >= 10, "the file exercised many keys");
  const dump = JSON.stringify(await query("SELECT * FROM admin_audit_log")) + JSON.stringify(await query("SELECT provider, enabled, key_hint, encode(key_ciphertext, 'escape') AS ct FROM provider_settings"));
  const everything = [...bodies, ...logged].join("\n");
  for (const k of secrets) {
    assert.ok(!everything.includes(k), `a key appeared in a response body or log line: …${k.slice(-4)}`);
    assert.ok(!everything.includes(encodeURIComponent(k)) || encodeURIComponent(k) === k);
    assert.ok(!dump.includes(k), `a key appeared in the audit log or provider_settings: …${k.slice(-4)}`);
  }
  // The env-only secrets used here as well.
  for (const k of ["env-gemini-secret-1234", "env-eleven-secret-5678"]) assert.ok(!everything.includes(k), k);
});
