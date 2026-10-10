import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin runtime settings through the REAL routes on a throwaway Postgres
 * (docs/admin/02-plan.md §6.10, §4.3, §8, HANDOFF §3):
 *
 *   - GET lists every catalog key with the exact shape, source (db / env /
 *     default), env value and last writer; the catalog holds no secret;
 *   - PUT validates through the catalog (400 with the validator's message,
 *     unknown key 404), writes row + ONE `settings.update` audit row in the
 *     same transaction (before/after = `{value, source}`), then drops the
 *     local cache;
 *   - DELETE resets (`settings.reset`); a key without an override is 409
 *     `state` and writes no audit row;
 *   - roles: owner/admin edit, finance/viewer read only, support/moderator
 *     get 403 (+ denied audit), stale step-up 401 reauth, no Origin 403,
 *     non-admin 404;
 *   - end to end: `generation.paused` makes the REAL `POST /api/generations`
 *     answer 503 `paused` before charging, and DELETE reopens it;
 *     `free_llm.disabled` makes the free-LLM path refuse.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - drop `invalidateSettingsCache()` after the write → the pause/free-LLM
 *     tests keep seeing the cached value (202 instead of 503);
 *   - write the audit row outside `adminTx` → the rollback test finds a
 *     setting row without its audit row;
 *   - drop the row-exists check in `resetAdminSetting` → the 409 test gets 200
 *     and a `settings.reset` audit row;
 *   - audit `before` from the new value → the before/after assertions fail.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.WORKER_INLINE = "false";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-settings-test-token-never-called";
// Env behind two settings: one set (→ source "env"), the rest unset (→ "default").
process.env.FREE_LLM_DAILY_OUTLINE = "7";
delete process.env.FREE_LLM_DISABLED;
delete process.env.FREE_LLM_DAILY_UDK;
delete process.env.SOUM_PER_USD;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminsettings") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const settings = await import("../lib/server/settings.ts");
const adminSettings = await import("../lib/server/admin-settings.ts");
const { env } = await import("../lib/server/env.ts");
const { basePriceFor, TOOL_BY_ID } = await import("../lib/tools.ts");
const listRoute = await import("../app/api/admin/settings/route.ts");
const keyRoute = await import("../app/api/admin/settings/[key]/route.ts");
const generationsRoute = await import("../app/api/generations/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) {
  await ensureMigrated();
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 10, totalSlots: 8, meanServiceSec: 200, maxWaitSec: 100_000 });
}

// ───────────────────────────── fixtures (admin-wallet.test.mts pattern)

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name = "Settings Test", balance = 0): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, balance) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `s_${randomBytes(5).toString("hex")}`, name, balance],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function mkAdmin(role: Role, name?: string): Promise<TestAdmin> {
  const u = await mkUser(name ?? `Admin ${role}`);
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
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "settings-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

const session = async (role: Role, reauth = true, name?: string) => openSession(await mkAdmin(role, name), reauth);

type Result = { status: number; body: Record<string, unknown> };

async function readResult(res: Response): Promise<Result> {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, body: {} };
  }
}

function headersFor(cookie: string | null, origin: boolean): Record<string, string> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "settings-test", "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = "http://localhost:3000";
  return headers;
}

async function list(cookie: string | null): Promise<Result> {
  const req = new Request("http://localhost:3000/api/admin/settings", { method: "GET", headers: headersFor(cookie, false) });
  return readResult(await inRequest(req, () => listRoute.GET(req, undefined)));
}

async function put(cookie: string | null, key: string, body: unknown, opts: { origin?: boolean; raw?: string } = {}): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: headersFor(cookie, opts.origin !== false),
    body: opts.raw ?? JSON.stringify(body),
  });
  return readResult(await inRequest(req, () => keyRoute.PUT(req, { params: Promise.resolve({ key }) })));
}

async function del(cookie: string | null, key: string, body: unknown, opts: { origin?: boolean } = {}): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/settings/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: headersFor(cookie, opts.origin !== false),
    body: JSON.stringify(body),
  });
  return readResult(await inRequest(req, () => keyRoute.DELETE(req, { params: Promise.resolve({ key }) })));
}

type Item = {
  key: string;
  label: string;
  description: string;
  group: string;
  type: string;
  min: number | null;
  max: number | null;
  value: unknown;
  source: string;
  envValue: unknown;
  updatedBy: string | null;
  updatedAt: string | null;
};

const itemOf = (r: Result, key: string): Item => {
  const found = (r.body.items as Item[]).find((i) => i.key === key);
  assert.ok(found, `${key} ro'yxatda yo'q`);
  return found;
};

const rows = () => query<{ key: string; value: unknown; updated_by: string | null }>(`SELECT key, value, updated_by::text AS updated_by FROM app_settings ORDER BY key`);
const audits = (adminId: string, action?: string) =>
  query<{ action: string; outcome: string; target_type: string | null; target_id: string | null; reason: string | null; before: unknown; after: unknown }>(
    `SELECT action, outcome, target_type, target_id, reason, before, after FROM admin_audit_log
      WHERE admin_id = $1 AND ($2::text IS NULL OR action = $2) ORDER BY id`,
    [adminId, action ?? null],
  );
const resetAll = async () => {
  await query("DELETE FROM app_settings");
  settings.invalidateSettingsCache();
};

const REASON = "Texnik ishlar uchun vaqtincha";

// ───────────────────────────── unit (no DB)

test("katalog: hech bir kalit sirga bog'lanmagan va faqat bool/son/vositalar ro'yxati (envValue klientga ketadi)", () => {
  const SECRET_WORDS = /KEY|TOKEN|SECRET|PASSWORD|PASS|DATABASE|URL|DSN|CREDENTIAL|SALT/i;
  const envVars = new Map<string, string>();
  for (const k of settings.SETTING_KEYS) {
    const def = settings.settingDef(k);
    assert.ok(["bool", "int", "number", "tool_ids"].includes(def.type), `${k}: ${def.type}`);
    if (def.envVar) {
      assert.ok(!SECRET_WORDS.test(def.envVar), `${k}: ${def.envVar} sirga o'xshaydi`);
      envVars.set(k, def.envVar);
    }
    // The env value is what a browser receives: it must be a plain bool, a finite number or tool ids.
    const v = def.envDefault() as unknown;
    const plain =
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v)) ||
      (Array.isArray(v) && v.every((x) => typeof x === "string" && Object.hasOwn(TOOL_BY_ID, x)));
    assert.ok(plain, `${k}: envValue oddiy qiymat emas`);
  }
  // Pinned: adding an env-backed setting must be a conscious decision (review it for secrecy).
  assert.deepEqual(
    [...envVars.values()].sort(),
    ["FREE_LLM_DAILY_GLOBAL", "FREE_LLM_DAILY_OUTLINE", "FREE_LLM_DAILY_POLISH", "FREE_LLM_DAILY_REWRITE", "FREE_LLM_DAILY_UDK", "FREE_LLM_DISABLED", "SOUM_PER_USD"],
  );
  assert.ok(settings.SETTING_KEYS.includes("pricing.target_markup"));
});

test("requireSettingKey: faqat katalog kalitlari; prototip kalitlari ham 404 {code:not_found}", () => {
  for (const k of settings.SETTING_KEYS) assert.equal(adminSettings.requireSettingKey(k), k);
  for (const bad of ["nope", "constructor", "__proto__", "toString", "", "FREE_LLM.DISABLED", 5, null, undefined, ["generation.paused"]]) {
    assert.throws(
      () => adminSettings.requireSettingKey(bad),
      (e: { status: number; extra: { code: string } }) => e.status === 404 && e.extra.code === "not_found",
      `MUTATSIYA: ${String(bad)}`,
    );
  }
});

// ───────────────────────────── GET

test("GET: har bir katalog kaliti, aniq shakl, manba (default/env) va env qiymati", { skip }, async () => {
  await resetAll();
  const s = await session("owner");
  const r = await list(s.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body), ["items"]);
  const items = r.body.items as Item[];
  assert.deepEqual(items.map((i) => i.key), [...settings.SETTING_KEYS]);
  for (const i of items) {
    assert.deepEqual(
      Object.keys(i).sort(),
      ["description", "envValue", "group", "key", "label", "max", "min", "source", "type", "updatedAt", "updatedBy", "value"],
    );
    assert.ok(i.label && i.description && i.group);
    assert.equal(i.updatedBy, null);
    assert.equal(i.updatedAt, null);
    assert.deepEqual(i.value, i.envValue, "qator yo'q: samarali qiymat = env/standart");
  }
  const outline = itemOf(r, "free_llm.daily.outline");
  assert.equal(outline.source, "env");
  assert.equal(outline.value, 7);
  assert.equal(outline.type, "int");
  assert.equal(outline.min, 0);
  assert.equal(itemOf(r, "free_llm.daily.udk").source, "default");
  assert.equal(itemOf(r, "generation.paused").source, "default");
  assert.equal(itemOf(r, "generation.paused").value, false);
  assert.deepEqual(itemOf(r, "generation.paused_tools").value, []);
  assert.equal(itemOf(r, "admin.wallet_confirm_threshold").value, 1_000_000);
  const markup = itemOf(r, "pricing.target_markup");
  assert.equal(markup.type, "number");
  assert.equal(markup.value, 3);
  assert.equal(markup.min, 1);
  assert.equal(markup.max, 20);
});

test("GET: ruxsat — owner/admin/finance/viewer 200; support va moderator 403 + denied audit", { skip }, async () => {
  for (const role of ["owner", "admin", "finance", "viewer"] as const) {
    const s = await session(role);
    assert.equal((await list(s.cookie)).status, 200, role);
  }
  for (const role of ["support", "moderator"] as const) {
    const s = await session(role);
    const r = await list(s.cookie);
    assert.equal(r.status, 403, role);
    assert.equal(r.body.code, "forbidden");
    const denied = await audits(s.admin.adminId, "auth.denied");
    assert.equal(denied.length, 1);
    assert.equal(denied[0].outcome, "denied");
  }
});

test("GET: admin emas / sessiyasiz → 404 / 401", { skip }, async () => {
  const plain = await mkUser();
  const cookieOnlyUser = `${SESSION_COOKIE}=${plain.userToken}`;
  assert.equal((await list(cookieOnlyUser)).status, 404);
  assert.equal((await list(null)).status, 404);
  const s = await session("owner");
  const noAdminCookie = `${SESSION_COOKIE}=${s.admin.userToken}`;
  const r = await list(noAdminCookie);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "admin_auth");
});

// ───────────────────────────── PUT

test("PUT bool: 200 {item}, qator + BITTA settings.update audit (before/after = {value, source}), oxirgi yozuvchi ko'rinadi", { skip }, async () => {
  await resetAll();
  const s = await session("owner", true, "Dilnoza Admin");
  const r = await put(s.cookie, "free_llm.disabled", { value: true, reason: REASON });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body), ["item"]);
  const item = r.body.item as Item;
  assert.equal(item.key, "free_llm.disabled");
  assert.equal(item.value, true);
  assert.equal(item.source, "db");
  assert.equal(item.envValue, false);
  assert.equal(item.updatedBy, "Dilnoza Admin");
  assert.ok(item.updatedAt && !Number.isNaN(Date.parse(item.updatedAt)));

  assert.deepEqual(await rows(), [{ key: "free_llm.disabled", value: true, updated_by: s.admin.adminId }]);
  const a = await audits(s.admin.adminId, "settings.update");
  assert.equal(a.length, 1, "BITTA audit qatori");
  assert.equal(a[0].outcome, "ok");
  assert.equal(a[0].target_type, "setting");
  assert.equal(a[0].target_id, "free_llm.disabled");
  assert.equal(a[0].reason, REASON);
  assert.deepEqual(a[0].before, { value: false, source: "default" });
  assert.deepEqual(a[0].after, { value: true, source: "db" });

  // GET agrees (reads the DB directly).
  const g = await list(s.cookie);
  const got = itemOf(g, "free_llm.disabled");
  assert.equal(got.source, "db");
  assert.equal(got.updatedBy, "Dilnoza Admin");
  await resetAll();
});

test("PUT int / number / tool_ids: har tur saqlanadi; ikkinchi yozuv before = oldingi DB qiymati; vositalar reestr tartibida", { skip }, async () => {
  await resetAll();
  const s = await session("admin");

  const a = await put(s.cookie, "free_llm.daily.outline", { value: 3, reason: REASON });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal((a.body.item as Item).value, 3);
  assert.equal((a.body.item as Item).envValue, 7, "env qiymati o'zgarmaydi");
  const b = await put(s.cookie, "free_llm.daily.outline", { value: 0, reason: REASON });
  assert.equal((b.body.item as Item).value, 0);

  const n = await put(s.cookie, "pricing.target_markup", { value: 2.5, reason: REASON });
  assert.equal(n.status, 200, JSON.stringify(n.body));
  assert.equal((n.body.item as Item).value, 2.5);

  const ids = Object.keys(TOOL_BY_ID);
  const pick = [ids[ids.length - 1], ids[0], ids[0]];
  const t = await put(s.cookie, "generation.paused_tools", { value: pick, reason: REASON });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.deepEqual((t.body.item as Item).value, [ids[0], ids[ids.length - 1]], "takror yo'q, reestr tartibida");

  const outlineAudits = await audits(s.admin.adminId, "settings.update");
  const forOutline = outlineAudits.filter((x) => x.target_id === "free_llm.daily.outline");
  assert.equal(forOutline.length, 2);
  assert.deepEqual(forOutline[0].before, { value: 7, source: "env" });
  assert.deepEqual(forOutline[0].after, { value: 3, source: "db" });
  assert.deepEqual(forOutline[1].before, { value: 3, source: "db" });
  assert.deepEqual(forOutline[1].after, { value: 0, source: "db" });
  assert.equal(outlineAudits.length, 4);
  await resetAll();
});

test("PUT pricing.payment_fee_percent: 0–10 qadam 0,1 saqlanadi, BITTA settings.update audit; 11 / NaN / qadamsiz → 400 va hech narsa yozilmaydi; RBAC", { skip }, async () => {
  await resetAll();
  const key = "pricing.payment_fee_percent";
  const owner = await session("owner");

  const g = itemOf(await list(owner.cookie), key);
  assert.equal(g.type, "number");
  assert.equal(g.group, "Narxlar");
  assert.equal(g.label, "To'lov komissiyasi (%)");
  assert.equal(g.value, 0);
  assert.equal(g.source, "default");
  assert.equal(g.min, 0);
  assert.equal(g.max, 10);

  const ok = await put(owner.cookie, key, { value: 1.5, reason: REASON });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((ok.body.item as Item).value, 1.5);
  assert.equal((ok.body.item as Item).source, "db");
  assert.deepEqual(await rows(), [{ key, value: 1.5, updated_by: owner.admin.adminId }]);
  const a = await audits(owner.admin.adminId, "settings.update");
  assert.equal(a.length, 1, "BITTA audit qatori");
  assert.equal(a[0].target_id, key);
  assert.equal(a[0].reason, REASON);
  assert.deepEqual(a[0].before, { value: 0, source: "default" });
  assert.deepEqual(a[0].after, { value: 1.5, source: "db" });
  // The margin reads the stored value once the 15 s snapshot is dropped.
  settings.invalidateSettingsCache();
  assert.equal(await settings.getSetting(key), 1.5);

  const cases: Array<[unknown, RegExp]> = [
    [11, /0 dan 10 gacha/],
    [10.1, /0 dan 10 gacha/],
    [-0.1, /0 dan 10 gacha/],
    [0.25, /0,1 qadam/],
    [null, /son bo'lishi/], // JSON.stringify(NaN) is null
    ["2", /son bo'lishi/],
  ];
  for (const [value, msg] of cases) {
    const r = await put(owner.cookie, key, { value, reason: REASON });
    assert.equal(r.status, 400, `${JSON.stringify(value)} → ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), msg, JSON.stringify(value));
  }
  assert.deepEqual(await rows(), [{ key, value: 1.5, updated_by: owner.admin.adminId }], "rad etilganlar hech narsani o'zgartirmadi");
  assert.equal((await audits(owner.admin.adminId, "settings.update")).length, 1);

  // Same permission path as every setting: finance reads, support/viewer cannot write.
  const viewer = await session("viewer");
  const denied = await put(viewer.cookie, key, { value: 2, reason: REASON });
  assert.equal(denied.status, 403);
  assert.deepEqual(await rows(), [{ key, value: 1.5, updated_by: owner.admin.adminId }]);
  const back = await del(owner.cookie, key, { reason: REASON });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal((back.body.item as Item).value, 0);
  assert.deepEqual(await rows(), []);
  await resetAll();
});

test("PUT: noto'g'ri qiymat → 400 (validator xabari), qator ham audit ham yo'q", { skip }, async () => {
  await resetAll();
  const s = await session("owner");
  const cases: Array<[string, unknown, RegExp]> = [
    ["free_llm.disabled", "true", /true yoki false/],
    ["free_llm.disabled", 1, /true yoki false/],
    ["free_llm.daily.udk", -1, /0 dan .* gacha/],
    ["free_llm.daily.udk", 1.5, /butun son/],
    ["free_llm.daily.udk", "5", /butun son/],
    ["free_llm.daily.udk", 1e15, /gacha/],
    ["free_llm.daily.udk", null, /butun son/],
    ["finance.soum_per_usd", 0, /1 dan 1000000 gacha/],
    ["pricing.target_markup", 0.5, /1 dan 20 gacha/],
    ["pricing.target_markup", 21, /1 dan 20 gacha/],
    ["pricing.target_markup", "3", /son bo'lishi/],
    ["generation.paused_tools", "essay", /ro'yxati/],
    ["generation.paused_tools", ["essay", "no-such-tool"], /Noma'lum vosita: no-such-tool/],
    ["generation.paused_tools", [{ id: "essay" }], /Noma'lum vosita/],
  ];
  for (const [key, value, msg] of cases) {
    const r = await put(s.cookie, key, { value, reason: REASON });
    assert.equal(r.status, 400, `${key} = ${JSON.stringify(value)} → ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), msg, `${key} = ${JSON.stringify(value)}`);
  }
  // `value` missing entirely.
  const missing = await put(s.cookie, "free_llm.disabled", { reason: REASON });
  assert.equal(missing.status, 400);
  assert.deepEqual(await rows(), []);
  assert.deepEqual(await audits(s.admin.adminId, "settings.update"), []);
});

test("PUT: sabab 5–500 belgi; tana obyekt va ≤ 8 KB; noma'lum / prototip kalit → 404 not_found", { skip }, async () => {
  await resetAll();
  const s = await session("owner");
  for (const reason of [undefined, "", "    ", "kam", 42, "x".repeat(501), ["Texnik ishlar"]]) {
    const r = await put(s.cookie, "free_llm.disabled", { value: true, reason });
    assert.equal(r.status, 400, `reason = ${JSON.stringify(reason)}`);
    assert.match(String(r.body.error), /Sabab/);
  }
  assert.equal((await put(s.cookie, "free_llm.disabled", null, { raw: "not json" })).status, 400);
  assert.equal((await put(s.cookie, "free_llm.disabled", null, { raw: "[1,2]" })).status, 400);
  assert.equal((await put(s.cookie, "free_llm.disabled", { value: true, reason: REASON, pad: "x".repeat(9_000) })).status, 413);

  for (const key of ["nope", "constructor", "__proto__", "free_llm", "FREE_LLM.DISABLED"]) {
    const r = await put(s.cookie, key, { value: true, reason: REASON });
    assert.equal(r.status, 404, key);
    assert.equal(r.body.code, "not_found");
    const d = await del(s.cookie, key, { reason: REASON });
    assert.equal(d.status, 404, key);
    assert.equal(d.body.code, "not_found");
  }
  // Extra body fields are ignored (never spread anywhere).
  const extra = await put(s.cookie, "free_llm.disabled", { value: true, reason: REASON, updated_by: "1", key: "generation.paused" });
  assert.equal(extra.status, 200);
  assert.deepEqual((await rows()).map((r) => r.key), ["free_llm.disabled"]);
  assert.equal((await audits(s.admin.adminId, "settings.update")).length, 1, "faqat muvaffaqiyatli yozuv audit qilinadi");
  await resetAll();
});

test("PUT / DELETE: finance va viewer o'qiydi, o'zgartira olmaydi (403 + denied audit); support 403; step-up eskirgan → 401 reauth; Origin yo'q → 403; admin emas → 404", { skip }, async () => {
  await resetAll();
  for (const role of ["finance", "viewer", "support", "moderator"] as const) {
    const s = await session(role);
    const p = await put(s.cookie, "generation.paused", { value: true, reason: REASON });
    assert.equal(p.status, 403, `${role} PUT`);
    assert.equal(p.body.code, "forbidden");
    const d = await del(s.cookie, "generation.paused", { reason: REASON });
    assert.equal(d.status, 403, `${role} DELETE`);
    assert.equal((await audits(s.admin.adminId, "auth.denied")).length, 2);
    assert.equal((await audits(s.admin.adminId, "settings.update")).length, 0);
  }
  const stale = await session("owner", false);
  const r = await put(stale.cookie, "generation.paused", { value: true, reason: REASON });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "reauth");
  const d = await del(stale.cookie, "generation.paused", { reason: REASON });
  assert.equal(d.status, 401);
  assert.equal(d.body.code, "reauth");

  const fresh = await session("owner");
  assert.equal((await put(fresh.cookie, "generation.paused", { value: true, reason: REASON }, { origin: false })).status, 403);
  assert.equal((await del(fresh.cookie, "generation.paused", { reason: REASON }, { origin: false })).status, 403);
  const plain = await mkUser();
  assert.equal((await put(`${SESSION_COOKIE}=${plain.userToken}`, "generation.paused", { value: true, reason: REASON })).status, 404);
  assert.deepEqual(await rows(), [], "hech bir urinish yozmadi");
});

// ───────────────────────────── DELETE

test("DELETE: standartga qaytadi, BITTA settings.reset audit (before = db, after = env/standart); ikkinchi marta 409 state, audit yo'q", { skip }, async () => {
  await resetAll();
  const s = await session("owner");
  await put(s.cookie, "free_llm.daily.outline", { value: 99, reason: REASON });
  await put(s.cookie, "generation.paused", { value: true, reason: REASON });

  const r = await del(s.cookie, "free_llm.daily.outline", { reason: "Standartga qaytarish" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body), ["item"]);
  const item = r.body.item as Item;
  assert.equal(item.value, 7);
  assert.equal(item.source, "env");
  assert.equal(item.updatedBy, null);
  assert.equal(item.updatedAt, null);
  assert.deepEqual((await rows()).map((x) => x.key), ["generation.paused"], "boshqa kalit tegilmadi");

  const resets = await audits(s.admin.adminId, "settings.reset");
  assert.equal(resets.length, 1);
  assert.equal(resets[0].outcome, "ok");
  assert.equal(resets[0].target_type, "setting");
  assert.equal(resets[0].target_id, "free_llm.daily.outline");
  assert.equal(resets[0].reason, "Standartga qaytarish");
  assert.deepEqual(resets[0].before, { value: 99, source: "db" });
  assert.deepEqual(resets[0].after, { value: 7, source: "env" });

  const again = await del(s.cookie, "free_llm.daily.outline", { reason: "Standartga qaytarish" });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "state");
  const never = await del(s.cookie, "free_llm.daily.udk", { reason: REASON });
  assert.equal(never.status, 409);
  assert.equal(never.body.code, "state");
  assert.equal((await audits(s.admin.adminId, "settings.reset")).length, 1, "409 audit yozmaydi");

  assert.equal((await del(s.cookie, "generation.paused", {})).status, 400, "sabab majburiy");
  assert.equal((await del(s.cookie, "generation.paused", { reason: "kam" })).status, 400);
  assert.deepEqual((await rows()).map((x) => x.key), ["generation.paused"]);
  const last = await del(s.cookie, "generation.paused", { reason: REASON });
  assert.equal(last.status, 200);
  assert.equal((last.body.item as Item).source, "default");
  const lastAudit = (await audits(s.admin.adminId, "settings.reset"))[1];
  assert.deepEqual(lastAudit.before, { value: true, source: "db" });
  assert.deepEqual(lastAudit.after, { value: false, source: "default" });
  await resetAll();
});

test("atomiklik: audit yozuvi yiqilsa sozlama qatori ham yozilmaydi (bitta tranzaksiya)", { skip }, async (t) => {
  await resetAll();
  const s = await session("owner");
  await query(`
    CREATE OR REPLACE FUNCTION wp8_fail_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'wp8 test: audit yozib bo''lmadi'; END $$ LANGUAGE plpgsql`);
  await query(`CREATE TRIGGER wp8_fail_audit_trg BEFORE INSERT ON admin_audit_log FOR EACH ROW WHEN (NEW.action = 'settings.update') EXECUTE FUNCTION wp8_fail_audit()`);
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  try {
    const r = await put(s.cookie, "generation.paused", { value: true, reason: REASON });
    assert.equal(r.status, 500);
    assert.deepEqual(await rows(), [], "audit bilan birga qaytarildi");
  } finally {
    await query("DROP TRIGGER wp8_fail_audit_trg ON admin_audit_log");
    await query("DROP FUNCTION wp8_fail_audit()");
  }
  settings.invalidateSettingsCache();
  const ok = await put(s.cookie, "generation.paused", { value: true, reason: REASON });
  assert.equal(ok.status, 200, "xato bartaraf bo'lgach yozuv o'tadi");
  await resetAll();
});

// ───────────────────────────── end to end: behaviour of the product

test("generation.paused: haqiqiy POST /api/generations 503 paused (pul yechilmaydi), DELETE dan keyin yana ishlaydi; paused_tools faqat o'z vositasini to'xtatadi", { skip }, async () => {
  await resetAll();
  const admin = await session("owner");
  const buyer = await mkUser("Buyer", 100_000);
  const buyerCookie = `${SESSION_COOKIE}=${buyer.userToken}`;
  const ESSAY_VALUES = { topic: "Suv aylanishi", essayContext: "academic", essayKind: "argumentative" };
  const PRICE = basePriceFor(TOOL_BY_ID.essay, ESSAY_VALUES);
  const generate = async (slug = "essay") => {
    // The route allows 5 POSTs per user per minute; this test sends more on purpose.
    await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
    const req = new Request("http://localhost:3000/api/generations", {
      method: "POST",
      headers: { cookie: buyerCookie, "content-type": "application/json", host: "localhost:3000" },
      body: JSON.stringify({ slug, values: ESSAY_VALUES }),
    });
    const res = await inRequest(req, () => generationsRoute.POST(req));
    return readResult(res);
  };
  const jobs = async () => Number((await queryOne<{ n: string }>(`SELECT count(*) AS n FROM generations WHERE user_id = $1`, [buyer.id]))!.n);
  const charges = async () => Number((await queryOne<{ n: string }>(`SELECT count(*) AS n FROM transactions WHERE user_id = $1 AND kind = 'charge'`, [buyer.id]))!.n);
  const balance = async () => Number((await queryOne<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [buyer.id]))!.balance);

  // Warm this process's 15 s cache with the "open" value: only invalidation can make the change visible at once.
  assert.equal(await settings.getSetting("generation.paused"), false);

  const p = await put(admin.cookie, "generation.paused", { value: true, reason: REASON });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const paused = await generate();
  assert.equal(paused.status, 503, JSON.stringify(paused.body));
  assert.equal(paused.body.code, "paused");
  assert.equal(await jobs(), 0, "ish yaratilmadi");
  assert.equal(await charges(), 0, "ledgerda yechim yo'q");
  assert.equal(await balance(), 100_000, "pul yechilmadi");

  const d = await del(admin.cookie, "generation.paused", { reason: "Texnik ishlar tugadi" });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const open = await generate();
  assert.equal(open.status, 202, JSON.stringify(open.body));
  assert.equal(await jobs(), 1);
  assert.equal(await charges(), 1);
  assert.equal(await balance(), 100_000 - PRICE);

  // Per-tool pause: only the listed tool stops.
  const t = await put(admin.cookie, "generation.paused_tools", { value: ["essay"], reason: REASON });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const blocked = await generate();
  assert.equal(blocked.status, 503);
  assert.equal(blocked.body.code, "paused");
  assert.equal(await jobs(), 1, "to'xtatilgan vosita yangi ish yaratmadi");
  const other = await put(admin.cookie, "generation.paused_tools", { value: ["slide"], reason: REASON });
  assert.equal(other.status, 200);
  assert.equal((await generate()).status, 202, "boshqa vosita to'xtatilgan: essay ishlaydi");
  await del(admin.cookie, "generation.paused_tools", { reason: REASON });
  await resetAll();
});

test("free_llm.disabled: PUT dan keyin bepul AI yo'li provayderni chaqirmasdan 503 disabled; DELETE dan keyin ishlaydi", { skip }, async (t) => {
  await resetAll();
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  const spend = await import("../lib/server/spend.ts");
  const admin = await session("owner");
  const user = await mkUser("Free LLM");
  let n = 0;
  const run = async (provider: () => Promise<unknown>) => {
    try {
      return { value: await spend.withFreeLlm({ endpoint: "udk", userId: user.id }, provider, { bucketPrefix: `wp8-${process.pid}-${++n}:` }) } as { value?: unknown; status?: number; code?: unknown };
    } catch (e) {
      const err = e as { status?: number; extra?: { code?: unknown } };
      return { status: err.status, code: err.extra?.code } as { value?: unknown; status?: number; code?: unknown };
    }
  };

  // Warm the cache with "enabled"; the admin write must show up without waiting 15 s.
  assert.equal((await run(async () => "warm")).value, "warm");

  const p = await put(admin.cookie, "free_llm.disabled", { value: true, reason: REASON });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  let provider = 0;
  const blocked = await run(async () => ++provider);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.code, "disabled");
  assert.equal(provider, 0, "provayder chaqirilmadi");

  const d = await del(admin.cookie, "free_llm.disabled", { reason: "Qayta yoqish" });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal((await run(async () => ++provider)).value, 1, "DELETE dan keyin bepul AI ishlaydi");

  // A numeric cap written through the API is what `withFreeLlm` enforces.
  const cap = await put(admin.cookie, "free_llm.daily.udk", { value: 0, reason: REASON });
  assert.equal(cap.status, 200);
  const capped = await run(async () => ++provider);
  assert.equal(capped.status, 429);
  assert.equal(provider, 1);
  await resetAll();
});

test("admin.wallet_confirm_threshold: PUT/DELETE o'qiladigan qiymatga ta'sir qiladi (getSetting)", { skip }, async () => {
  await resetAll();
  const admin = await session("admin");
  assert.equal(await settings.getSetting("admin.wallet_confirm_threshold"), 1_000_000);
  await put(admin.cookie, "admin.wallet_confirm_threshold", { value: 250_000, reason: REASON });
  assert.equal(await settings.getSetting("admin.wallet_confirm_threshold"), 250_000);
  await del(admin.cookie, "admin.wallet_confirm_threshold", { reason: REASON });
  assert.equal(await settings.getSetting("admin.wallet_confirm_threshold"), 1_000_000);
});

// ───────────────────────────── C-Q4 payment bonus (the same setting the bot admin panel writes)

test("payment_bonus_percent (web): owner/admin PUT 0–50 → 200 + audit; the service reads it; 51 / -1 / 2.5 / \"10\" → 400; finance 403 + denied audit", { skip }, async () => {
  await resetAll();
  const { getPaymentBonusPercent } = await import("../lib/server/payment-bonus.ts");
  const listed = itemOf(await list((await session("viewer")).cookie), "payment_bonus_percent");
  assert.deepEqual(
    { group: listed.group, type: listed.type, min: listed.min, max: listed.max, value: listed.value, source: listed.source, envValue: listed.envValue },
    { group: "Moliya", type: "int", min: 0, max: 50, value: 10, source: "default", envValue: 10 },
  );
  const s = await session("owner");
  const bad: Array<[unknown, RegExp]> = [[51, /0 dan 50 gacha/], [-1, /0 dan 50 gacha/], [2.5, /butun son/], ["10", /butun son/], [null, /butun son/]];
  for (const [value, msg] of bad) {
    const r = await put(s.cookie, "payment_bonus_percent", { value, reason: REASON });
    assert.equal(r.status, 400, JSON.stringify(value));
    assert.match(String(r.body.error), msg);
  }
  assert.deepEqual(await rows(), []);
  const ok = await put(s.cookie, "payment_bonus_percent", { value: 25, reason: REASON });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((ok.body.item as Item).value, 25);
  assert.equal(await getPaymentBonusPercent(), 25, "the wallet / bot read the new value (this process's cache dropped)");
  const a = await audits(s.admin.adminId, "settings.update");
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].target_id, a[0].before, a[0].after], ["payment_bonus_percent", { value: 10, source: "default" }, { value: 25, source: "db" }]);
  const adm = await session("admin");
  assert.equal((await put(adm.cookie, "payment_bonus_percent", { value: 0, reason: REASON })).status, 200);
  assert.equal(await getPaymentBonusPercent(), 0);
  const fin = await session("finance");
  const denied = await put(fin.cookie, "payment_bonus_percent", { value: 50, reason: REASON });
  assert.equal(denied.status, 403);
  assert.equal((await audits(fin.admin.adminId, "auth.denied")).length, 1);
  assert.equal(await getPaymentBonusPercent(), 0, "finance changed nothing");
  await resetAll();
});
