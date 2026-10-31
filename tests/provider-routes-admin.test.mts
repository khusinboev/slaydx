import "./helpers/next-request.mts";
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin «Provayderlar» redesign through the REAL routes on a throwaway Postgres (owner request 2026-10-31):
 *
 *   - GET adds purposes (with the «yetarlimi?» verdict computed from what really works), usage (from `ai_usage` and
 *     the free-provider counters), system health and the so'm rate, and still never a key;
 *   - PUT/DELETE of a routing slot: validated against the slot's spec (400 `route_invalid`, nothing written), a fresh
 *     step-up (401 `reauth`), `settings.edit` only, one audit row in the SAME transaction with before/after and the
 *     reason, a repeat is 409 `state` with no audit, the local snapshot reloads at once and the generation layer's
 *     `effectiveRoute` sees the new value;
 *   - the loader ignores a stored row it cannot read (unknown slot, a model that left the price book);
 *   - the free-provider counters: batched upsert per Tashkent day, only registry ids, a failed write is retried.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - write the audit row outside `adminTx` in `setAdminRoute` -> "PUT route ... audit" fails (no row after a refused save);
 *   - skip `checkRoute` in `setAdminRoute` -> "PUT route validation" fails (an unpriced model is stored);
 *   - drop `reloadProviderKeys()` after the write -> "PUT route ... snapshot" fails (effectiveRoute still env);
 *   - make `loadRouteSnapshot` trust the stored JSON -> "the loader ignores unreadable rows" fails;
 *   - clear the buffer before the INSERT succeeds in `flushProviderCalls` -> "a failed flush is retried" fails.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.WORKER_INLINE = "false";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
delete process.env.PROVIDER_KEYS_KEY;
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:provider-routes-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("provroutes") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const resolve = await import("../lib/server/providers/resolve.ts");
const store = await import("../lib/server/providers/store.ts");
const registry = await import("../lib/server/providers/registry.ts");
const routeResolve = await import("../lib/server/providers/route-resolve.ts");
const effective = await import("../lib/server/providers/route-effective.ts");
const usageMod = await import("../lib/server/admin-provider-usage.ts");
const providerUsage = await import("../lib/server/provider-usage.ts");
const listRoute = await import("../app/api/admin/providers/route.ts");
const routeRoute = await import("../app/api/admin/providers/routes/[id]/route.ts");
const enabledRoute = await import("../app/api/admin/providers/[id]/enabled/route.ts");

after(async () => {
  if (!hasDb) return;
  store.stopProviderKeyRefresh();
  providerUsage.stopProviderUsageFlush();
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

beforeEach(async () => {
  for (const id of registry.PROVIDER_IDS) for (const e of registry.providerDef(id)!.envKeys) delete process.env[e];
  for (const v of ["LLM_WRITER", "LLM_RESEARCHER", "LLM_JUDGE", "LLM_FAST", "GEMINI_MODEL", "GEMINI_IMAGE_MODEL", "TTS_GEMINI_MODEL", "AZURE_SPEECH_REGION"]) delete process.env[v];
  if (hasDb) {
    resolve.registerProviderSource(store.loadProviderAndRouteSnapshots);
    await query("DELETE FROM provider_settings");
    await query("DELETE FROM ai_routes");
    await query("DELETE FROM provider_calls");
    await query("DELETE FROM ai_usage");
    usageMod.clearProviderUsageCache();
    await store.reloadProviderKeys();
  }
});

/* ───────────────────────────── fixtures ───────────────────────────── */

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name = "Routes Test"): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, balance) VALUES ($1, $2, $3, 0) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `r_${randomBytes(5).toString("hex")}`, name],
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
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "routes-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}
const session = async (role: Role, reauth = true) => openSession(await mkAdmin(role), reauth);

type Result = { status: number; body: Record<string, unknown>; text: string };
async function readResult(res: Response): Promise<Result> {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, text };
  } catch {
    return { status: res.status, body: {}, text };
  }
}
const headersFor = (cookie: string | null, origin: boolean): Record<string, string> => ({
  host: "localhost:3000",
  "x-forwarded-for": "10.1.2.3",
  "user-agent": "routes-test",
  "content-type": "application/json",
  ...(cookie ? { cookie } : {}),
  ...(origin ? { origin: "http://localhost:3000" } : {}),
});

async function list(cookie: string | null): Promise<Result> {
  const req = new Request("http://localhost:3000/api/admin/providers", { method: "GET", headers: headersFor(cookie, false) });
  return readResult(await inRequest(req, () => listRoute.GET(req, undefined)));
}
async function sendRoute(method: "PUT" | "DELETE", cookie: string | null, id: string, body: unknown, opts: { origin?: boolean } = {}): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/providers/routes/${encodeURIComponent(id)}`, {
    method,
    headers: headersFor(cookie, opts.origin !== false),
    body: JSON.stringify(body),
  });
  return readResult(await inRequest(req, () => routeRoute[method](req, { params: Promise.resolve({ id }) })));
}
const putRoute = (c: string | null, id: string, entries: unknown, reason: unknown = REASON, o?: { origin?: boolean }) => sendRoute("PUT", c, id, { entries, reason }, o);
const delRoute = (c: string | null, id: string, reason: unknown = REASON) => sendRoute("DELETE", c, id, { reason });
async function putEnabled(cookie: string, id: string, enabled: boolean): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/providers/${id}/enabled`, { method: "PUT", headers: headersFor(cookie, true), body: JSON.stringify({ enabled, reason: REASON }) });
  return readResult(await inRequest(req, () => enabledRoute.PUT(req, { params: Promise.resolve({ id }) })));
}

type Purpose = { id: string; verdict: string; headline: string; setting: { enabled: boolean } | null; routes: Array<{ id: string; source: string; entries: Array<{ provider: string; model: string | null; usable: boolean }>; fallbackEntries: unknown[]; updatedBy: string | null }> };
type Item = { id: string; usable: boolean; billing: string; need: string; usage: { today: { calls: number; usd: number }; d30: { calls: number; errors: number | null; usd: number }; lastDay: string | null; kinds: Array<{ kind: string; calls: number }> }; breaker: unknown };
const purposeOf = (r: Result, id: string): Purpose => {
  const found = (r.body.purposes as Purpose[]).find((p) => p.id === id);
  assert.ok(found, `${id} vazifasi yo'q`);
  return found;
};
const itemOf = (r: Result, id: string): Item => {
  const found = (r.body.items as Item[]).find((i) => i.id === id);
  assert.ok(found, `${id} ro'yxatda yo'q`);
  return found;
};
const audits = (adminId: string, action?: string) =>
  query<{ action: string; target_type: string | null; target_id: string | null; reason: string | null; before: unknown; after: unknown }>(
    `SELECT action, target_type, target_id, reason, before, after FROM admin_audit_log WHERE admin_id = $1 AND ($2::text IS NULL OR action = $2) ORDER BY id`,
    [adminId, action ?? null],
  );
const storedRoute = (id: string) => queryOne<{ entries: unknown }>("SELECT entries FROM ai_routes WHERE route = $1", [id]);

const REASON = "Baholovchi Claude bo'lsin";
const JUDGE = [
  { provider: "anthropic", model: "claude-sonnet-5" },
  { provider: "gemini", model: "gemini-3.7-flash" },
];

/* ───────────────────────────── GET: purposes, usage, health ───────────────────────────── */

test("GET: purposes with verdicts computed from what really works; the new shape; no key", { skip }, async () => {
  const s = await session("owner");
  process.env.GEMINI_API_KEY = "env-gemini-secret-1234";
  let r = await list(s.cookie);
  assert.equal(r.status, 200, r.text);
  for (const k of ["items", "purposes", "system", "otherUsage", "total30", "soumPerUsd", "generatedAt", "canStoreKeys", "sealingKey", "propagationSec"]) assert.ok(k in r.body, k);
  assert.ok(!r.text.includes("env-gemini-secret-1234"), "an env key is never sent");
  assert.equal(r.body.soumPerUsd, 12_700);

  assert.equal(purposeOf(r, "text").verdict, "single", "Gemini works, Claude has no key: no fallback");
  assert.equal(purposeOf(r, "image").verdict, "ok");
  assert.equal(purposeOf(r, "tts").verdict, "missing", "Gemini voices stay off until TTS_GEMINI_MODEL is set, and Azure has no key");
  assert.equal(purposeOf(r, "stock").verdict, "missing", "a recommended purpose with no Pexels/Pixabay key");
  assert.equal(purposeOf(r, "video").verdict, "off");
  assert.equal(purposeOf(r, "video").setting!.enabled, false, "video.enabled defaults to off");
  assert.equal(purposeOf(r, "stt").verdict, "ok");

  process.env.ANTHROPIC_API_KEY = "env-anthropic-secret";
  process.env.TTS_GEMINI_MODEL = "gemini-2.5-flash-preview-tts";
  process.env.AZURE_SPEECH_KEY = "0123456789abcdef0123456789abcdef";
  r = await list(s.cookie);
  assert.equal(purposeOf(r, "text").verdict, "ok", "a fallback exists now");
  assert.equal(purposeOf(r, "tts").verdict, "single", "Gemini voice works; Azure has a key but no region");
  assert.equal(itemOf(r, "azure").usable, false, "a key without its region cannot synthesise");
  process.env.AZURE_SPEECH_REGION = "westeurope";
  r = await list(s.cookie);
  assert.equal(itemOf(r, "azure").usable, true);
  assert.equal(purposeOf(r, "tts").verdict, "ok");

  const off = await putEnabled(s.cookie, "gemini", false);
  assert.equal(off.status, 200, off.text);
  r = await list(s.cookie);
  assert.equal(purposeOf(r, "text").verdict, "single", "only Claude is left");
  assert.equal(purposeOf(r, "image").verdict, "missing", "image is required and nothing works without Gemini");
  assert.equal(itemOf(r, "gemini").usable, false);
  assert.equal(itemOf(r, "veo").usable, true, "Veo has its own switch and reads the Gemini env key");

  assert.equal(itemOf(r, "pexels").billing, "free");
  assert.equal(itemOf(r, "gemini").billing, "paid");
  assert.equal(itemOf(r, "azure").billing, "free-tier");
});

test("GET: slots carry source, entries with their state, the fallback and the model prices", { skip }, async () => {
  const s = await session("owner");
  process.env.GEMINI_API_KEY = "env-gemini-secret-1234";
  process.env.LLM_JUDGE = "anthropic:claude-sonnet-5,gemini:gemini-3.7-flash";
  const r = await list(s.cookie);
  const judge = purposeOf(r, "text").routes.find((x) => x.id === "llm.judge")!;
  assert.equal(judge.source, "env");
  assert.deepEqual(judge.entries.map((e) => `${e.provider}:${e.model}:${e.usable}`), ["anthropic:claude-sonnet-5:false", "gemini:gemini-3.7-flash:true"]);
  const writer = purposeOf(r, "text").routes.find((x) => x.id === "llm.writer")!;
  assert.equal(writer.source, "default");
  assert.equal((r.body.purposes as Purpose[]).flatMap((p) => p.routes).length, 7, "every slot is shown once");
  const tts = purposeOf(r, "tts").routes[0];
  assert.deepEqual(tts.entries.map((e) => e.provider), ["azure", "aisha", "gemini"]);
});

test("GET: usage comes from ai_usage and the free-provider counters; removed providers stay in the totals", { skip }, async () => {
  const s = await session("owner");
  const parts = JSON.stringify([
    { kind: "llm", provider: "gemini", model: "gemini-3.7-flash", calls: 3, inputTokens: 1000, outputTokens: 500, units: 0, usd: 0.4 },
    { kind: "image", provider: "gemini", model: "gemini-3.1-flash-lite-image", calls: 2, inputTokens: 0, outputTokens: 0, units: 2, usd: 0.068 },
    { kind: "llm", provider: "xai", model: "grok-4.3", calls: 1, inputTokens: 10, outputTokens: 10, units: 0, usd: 0.01 },
  ]);
  await query(
    `INSERT INTO ai_usage (source, outcome, tool_id, calls, input_tokens, output_tokens, usd, parts) VALUES ('job', 'completed', 'slide', 6, 1010, 510, 0.478, $1::jsonb)`,
    [parts],
  );
  await query(`INSERT INTO provider_calls (day, provider, calls, errors) VALUES ((now() AT TIME ZONE 'Asia/Tashkent')::date, 'pexels', 12, 2)`);
  const r = await list(s.cookie);
  assert.equal(r.status, 200, r.text);
  const g = itemOf(r, "gemini");
  assert.equal(g.usage.today.calls, 5);
  assert.equal(g.usage.d30.usd, 0.468);
  assert.deepEqual(g.usage.kinds.map((k) => k.kind), ["llm", "image"]);
  assert.ok(g.usage.lastDay);
  const p = itemOf(r, "pexels");
  assert.deepEqual([p.usage.today.calls, p.usage.d30.errors, p.usage.d30.usd], [12, 2, 0]);
  assert.equal(itemOf(r, "anthropic").usage.d30.calls, 0);
  assert.deepEqual(r.body.otherUsage, [{ provider: "xai", calls: 1, usd: 0.01 }]);
  assert.deepEqual(r.body.total30, { calls: 18, usd: 0.478 });
});

test("GET: roles — owner/admin/finance/viewer read, support/moderator and non-admins are refused", { skip }, async () => {
  for (const role of ["owner", "admin", "finance", "viewer"] as const) assert.equal((await list((await session(role)).cookie)).status, 200, role);
  for (const role of ["support", "moderator"] as const) assert.equal((await list((await session(role)).cookie)).status, 403, role);
  assert.equal((await list(null)).status, 404);
});

/* ───────────────────────────── PUT / DELETE a slot ───────────────────────────── */

test("PUT route validation: reason, shape, models of the price book, unknown slot, Origin — nothing is written", { skip }, async () => {
  const s = await session("owner");
  const cases: Array<[string, string, unknown, unknown, number]> = [
    ["no reason", "llm.judge", JUDGE, null, 400],
    ["short reason", "llm.judge", JUDGE, "abc", 400],
    ["empty entries", "llm.judge", [], REASON, 400],
    ["entries is not an array", "llm.judge", "gemini", REASON, 400],
    ["unpriced model", "llm.judge", [{ provider: "gemini", model: "gemini-9-ultra" }], REASON, 400],
    ["foreign provider", "llm.judge", [{ provider: "pexels", model: "x" }], REASON, 400],
    ["duplicate", "llm.judge", [JUDGE[1], JUDGE[1]], REASON, 400],
    ["voice order with a model", "tts.order", [{ provider: "azure", model: "voice" }], REASON, 400],
    ["premium voice in the standard order", "tts.order", [{ provider: "elevenlabs" }], REASON, 400],
  ];
  for (const [label, id, entries, reason, status] of cases) {
    const r = await putRoute(s.cookie, id, entries, reason);
    assert.equal(r.status, status, `${label}: ${r.text}`);
  }
  assert.equal((await putRoute(s.cookie, "no.such.slot", JUDGE)).status, 404);
  assert.equal((await putRoute(s.cookie, "constructor", JUDGE)).body.code, "not_found");
  assert.equal((await putRoute(s.cookie, "llm.judge", JUDGE, REASON, { origin: false })).status, 403);
  assert.equal(await storedRoute("llm.judge"), null, "nothing was written by any refused call");
  assert.equal((await audits(s.admin.adminId, "routes.set")).length, 0);
});

test("PUT route: stored, audited with before/after and the reason, the snapshot reloads at once, a repeat is 409", { skip }, async () => {
  const s = await session("owner");
  process.env.LLM_JUDGE = "gemini:gemini-3.7-flash";
  assert.equal(effective.effectiveRoute("llm.judge").source, "env");

  const r = await putRoute(s.cookie, "llm.judge", JUDGE);
  assert.equal(r.status, 200, r.text);
  const route = r.body.route as Purpose["routes"][number];
  assert.equal(route.source, "db");
  assert.deepEqual(route.entries.map((e) => `${e.provider}:${e.model}`), ["anthropic:claude-sonnet-5", "gemini:gemini-3.7-flash"]);
  assert.deepEqual(route.fallbackEntries, [{ provider: "gemini", model: "gemini-3.7-flash", label: "Google Gemini", usable: false }], "reset would restore the env value");
  assert.ok(route.updatedBy);
  assert.deepEqual((await storedRoute("llm.judge"))!.entries, JUDGE);
  assert.equal(effective.effectiveRoute("llm.judge").source, "db", "this process reloaded its snapshot at once");
  assert.deepEqual(effective.effectiveRoute("llm.judge").entries, JUDGE);

  const a = await audits(s.admin.adminId, "routes.set");
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].target_type, a[0].target_id, a[0].reason], ["route", "llm.judge", REASON]);
  assert.deepEqual(a[0].before, { entries: null });
  assert.deepEqual(a[0].after, { entries: JUDGE });

  const again = await putRoute(s.cookie, "llm.judge", JUDGE);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "state");
  assert.equal((await audits(s.admin.adminId, "routes.set")).length, 1, "a repeat writes no audit row");

  const changed = await putRoute(s.cookie, "llm.judge", [JUDGE[1]], "Faqat Gemini");
  assert.equal(changed.status, 200);
  const a2 = await audits(s.admin.adminId, "routes.set");
  assert.deepEqual(a2[1].before, { entries: JUDGE }, "the second audit row carries the first choice as `before`");
});

test("DELETE route: back to the env value, audited, a repeat is 409", { skip }, async () => {
  const s = await session("owner");
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  assert.equal((await putRoute(s.cookie, "llm.model", [{ provider: "gemini", model: "gemini-3.1-pro" }])).status, 200);
  assert.equal(effective.geminiTextModel(), "gemini-3.1-pro");
  const r = await delRoute(s.cookie, "llm.model");
  assert.equal(r.status, 200, r.text);
  assert.equal((r.body.route as Purpose["routes"][number]).source, "env");
  assert.equal(await storedRoute("llm.model"), null);
  assert.equal(effective.geminiTextModel(), "gemini-3.5-flash-lite", "the env value applies again");
  const a = await audits(s.admin.adminId, "routes.reset");
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].after, { entries: null });
  const again = await delRoute(s.cookie, "llm.model");
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "state");
  assert.equal((await audits(s.admin.adminId, "routes.reset")).length, 1);
  assert.equal((await delRoute(s.cookie, "no.such.slot")).status, 404);
  assert.equal((await delRoute(s.cookie, "llm.model", "abc")).status, 400);
});

test("PUT route: step-up and roles — a stale session is 401 reauth and writes nothing; only owner/admin may write", { skip }, async () => {
  const stale = await session("owner", false);
  const r = await putRoute(stale.cookie, "llm.judge", JUDGE);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "reauth");
  assert.equal(await storedRoute("llm.judge"), null);
  for (const role of ["finance", "viewer", "support", "moderator"] as const) {
    const s = await session(role);
    assert.equal((await putRoute(s.cookie, "llm.judge", JUDGE)).status, 403, role);
    assert.equal((await delRoute(s.cookie, "llm.judge")).status, 403, role);
  }
  assert.equal(await storedRoute("llm.judge"), null);
  assert.equal((await putRoute((await session("admin")).cookie, "llm.judge", JUDGE)).status, 200);
});

test("the loader ignores unreadable rows: an unknown slot, a model that left the price book, a wrong shape", { skip }, async () => {
  await query(`INSERT INTO ai_routes (route, entries) VALUES ('llm.writer', $1::jsonb)`, [JSON.stringify([{ provider: "gemini", model: "gemini-0-retired" }])]);
  await query(`INSERT INTO ai_routes (route, entries) VALUES ('no.such.slot', $1::jsonb)`, [JSON.stringify(JUDGE)]);
  await query(`INSERT INTO ai_routes (route, entries) VALUES ('tts.order', $1::jsonb)`, [JSON.stringify([{ provider: "azure", model: "voice" }])]);
  await query(`INSERT INTO ai_routes (route, entries) VALUES ('llm.judge', $1::jsonb)`, [JSON.stringify(JUDGE)]);
  const snap = await store.loadRouteSnapshot();
  assert.deepEqual([...snap.keys()], ["llm.judge"], "only the readable row is loaded");
  await store.reloadProviderKeys();
  assert.equal(effective.effectiveRoute("llm.writer").source, "default", "the unreadable stored row never reaches the generation layer");
  assert.equal(effective.effectiveRoute("llm.judge").source, "db");
  assert.equal(routeResolve.getRoute("tts.order"), null);
});

/* ───────────────────────────── free-provider counters ───────────────────────────── */

const callsOf = () => query<{ provider: string; calls: string; errors: string }>("SELECT provider, calls::text, errors::text FROM provider_calls ORDER BY provider");

test("flushProviderCalls: one upsert per day accumulates; only registry ids are counted", { skip }, async () => {
  const { bufferProviderCall, flushProviderCalls } = providerUsage;
  bufferProviderCall("pexels", true);
  bufferProviderCall("pexels", true);
  bufferProviderCall("pexels", false);
  bufferProviderCall("openalex", true);
  bufferProviderCall("not-a-provider", true);
  await flushProviderCalls();
  assert.deepEqual(await callsOf(), [{ provider: "openalex", calls: "1", errors: "0" }, { provider: "pexels", calls: "3", errors: "1" }]);
  bufferProviderCall("pexels", true);
  await flushProviderCalls();
  assert.equal((await callsOf()).find((r) => r.provider === "pexels")!.calls, "4", "the same day's row is added to, not replaced");
  await flushProviderCalls();
  assert.equal((await callsOf()).length, 2, "an empty buffer writes nothing");
  const day = await queryOne<{ same: boolean }>(`SELECT bool_and(day = (now() AT TIME ZONE 'Asia/Tashkent')::date) AS same FROM provider_calls`);
  assert.equal(day!.same, true, "the day is the Tashkent day");
});

test("a failed flush is retried with the next batch and never throws", { skip }, async () => {
  const { bufferProviderCall, flushProviderCalls } = providerUsage;
  await query("ALTER TABLE provider_calls RENAME TO provider_calls_away");
  try {
    bufferProviderCall("pixabay", false);
    bufferProviderCall("pixabay", true);
    await assert.doesNotReject(flushProviderCalls(), "telemetry must not fail a job");
  } finally {
    await query("ALTER TABLE provider_calls_away RENAME TO provider_calls");
  }
  assert.deepEqual(await callsOf(), [], "nothing was written while the table was away");
  bufferProviderCall("pixabay", true);
  await flushProviderCalls();
  assert.deepEqual(await callsOf(), [{ provider: "pixabay", calls: "3", errors: "1" }], "the failed batch was put back and written with the next one");
});
