import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin Telegram broadcasts through the REAL routes (docs/admin/02-plan.md §6.9,
 * §8, §10 T8/T9) on a throwaway Postgres. `fetch` is stubbed: NOTHING in this
 * file can reach the real Telegram API (any other URL throws). Delivery is
 * driven by the real `deliverBroadcasts` against the same stub.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - dropping `NOT u.is_blocked` from `audienceWhere` → "audience counts equal
 *     an independent model" and "delivery sends exactly to the snapshot" fail;
 *   - `o.state = 'paid'` loosened to any order → "paid audience" fails;
 *   - dropping the `total !== confirmCount` check in `sendBroadcast` →
 *     "send: count_changed is 409, nothing is queued" fails;
 *   - `escapeTelegramHtml(b.text)` replaced by `b.text` in `sendTest` →
 *     "test send goes to the actor only, text escaped" fails;
 *   - dropping `FOR UPDATE` in `sendBroadcast` → "two concurrent sends queue
 *     exactly once" fails;
 *   - the cancel `UPDATE` setting `status = 'queued'` → "cancel stops the real
 *     delivery" fails (messages keep going);
 *   - `broadcasts.send` on the create route changed to `broadcasts.view` →
 *     "support cannot create, test, send or cancel" fails (201 instead of 403).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.WORKER_INLINE = "false";
const TOKEN = "123456:admin-broadcasts-test-token-never-called";
process.env.TELEGRAM_BOT_TOKEN = TOKEN;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminbc") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { env } = await import("../lib/server/env.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const jobs = await import("../lib/server/jobs.ts");
const bd = await import("../lib/server/broadcast-delivery.ts");
const lib = await import("../lib/server/admin-broadcasts.ts");
const routes = {
  list: await import("../app/api/admin/broadcasts/route.ts"),
  audience: await import("../app/api/admin/broadcasts/audience/route.ts"),
  detail: await import("../app/api/admin/broadcasts/[id]/route.ts"),
  test: await import("../app/api/admin/broadcasts/[id]/test/route.ts"),
  send: await import("../app/api/admin/broadcasts/[id]/send/route.ts"),
  cancel: await import("../app/api/admin/broadcasts/[id]/cancel/route.ts"),
};

// ───────────────────────────── Telegram stub (the only network there is)

type TgCall = { chatId: string; text: string; parseMode: unknown };
let tgCalls: TgCall[] = [];
/** chat id → Telegram error code to answer with. */
let tgFail = new Map<string, number>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (!u.startsWith(`https://api.telegram.org/bot${TOKEN}/sendMessage`)) throw new Error(`unexpected network call: ${u}`);
  const body = JSON.parse(String(init?.body)) as { chat_id: string | number; text: string; parse_mode: unknown };
  const chatId = String(body.chat_id);
  const code = tgFail.get(chatId);
  if (code) return new Response(JSON.stringify({ ok: false, error_code: code, description: `err ${code}` }), { status: code });
  tgCalls.push({ chatId, text: body.text, parseMode: body.parse_mode });
  return new Response(JSON.stringify({ ok: true, result: { message_id: tgCalls.length } }));
}) as typeof fetch;

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

const quiet = (t: TestContext) => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
};

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type Session = { cookie: string; adminId: string; userId: string; telegramId: string | null };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const tgId = () => String(randomInt(5_000_000_000, 9_000_000_000));

/** What the test KNOWS about every user, to compute the expected audience without the code under test. */
type Known = { tg: string | null; blocked: boolean; paid: boolean; /** Age in days of the latest activity, null = none. */ activeAgeDays: number | null };
const known = new Map<string, Known>();

async function mkUser(k: Partial<Known> & { name?: string; withSession?: boolean } = {}): Promise<{ id: string; telegramId: string | null; userToken: string }> {
  const telegramId = k.tg === undefined ? tgId() : k.tg;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, is_blocked) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
    [telegramId, `b_${randomBytes(5).toString("hex")}`, k.name ?? "Broadcast Test", k.blocked ?? false],
  );
  let userToken = "";
  if (k.withSession) userToken = (await createSession(row!.id)).token;
  known.set(row!.id, { tg: telegramId, blocked: k.blocked ?? false, paid: k.paid ?? false, activeAgeDays: k.activeAgeDays ?? null });
  return { id: row!.id, telegramId, userToken };
}

async function session(role: Role, opts: { reauth?: boolean; noTelegram?: boolean } = {}): Promise<Session> {
  const u = await mkUser({ withSession: true, tg: opts.noTelegram ? null : undefined, activeAgeDays: 0 });
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: acc!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "bc-test", reauth: opts.reauth ?? true }),
  );
  return { cookie: `${SESSION_COOKIE}=${u.userToken}; ${adminCookieName()}=${s.token}`, adminId: acc!.id, userId: u.id, telegramId: u.telegramId };
}

type Result = { status: number; body: Record<string, unknown> };
async function parse(res: Response): Promise<Result> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

const BASE = "http://localhost:3000/api/admin/broadcasts";
const headersOf = (cookie: string | null, origin = true): Record<string, string> => {
  const h: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.7", "user-agent": "bc-test", "content-type": "application/json" };
  if (cookie) h.cookie = cookie;
  if (origin) h.origin = "http://localhost:3000";
  return h;
};

async function get(which: "list" | "audience" | "detail", cookie: string | null, opts: { id?: string; qs?: string } = {}): Promise<Result> {
  const url = which === "list" ? `${BASE}${opts.qs ?? ""}` : which === "audience" ? `${BASE}/audience${opts.qs ?? ""}` : `${BASE}/${encodeURIComponent(opts.id!)}`;
  const req = new Request(url, { method: "GET", headers: headersOf(cookie, false) });
  const res = await inRequest(req, () => {
    if (which === "list") return routes.list.GET(req, undefined);
    if (which === "audience") return routes.audience.GET(req, undefined);
    return routes.detail.GET(req, { params: Promise.resolve({ id: opts.id! }) });
  });
  return parse(res);
}

async function post(
  which: "create" | "test" | "send" | "cancel",
  cookie: string | null,
  id: string | null,
  body: unknown,
  opts: { origin?: boolean; raw?: string } = {},
): Promise<Result> {
  const url = which === "create" ? BASE : `${BASE}/${encodeURIComponent(id!)}/${which}`;
  const req = new Request(url, { method: "POST", headers: headersOf(cookie, opts.origin !== false), body: opts.raw ?? JSON.stringify(body) });
  const res = await inRequest(req, () => {
    if (which === "create") return routes.list.POST(req, undefined);
    const ctx = { params: Promise.resolve({ id: id! }) };
    return routes[which].POST(req, ctx);
  });
  return parse(res);
}

const audits = (adminId: string, action: string) =>
  query<{ outcome: string; target_id: string | null; target_type: string | null; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; meta: Record<string, unknown> | null }>(
    `SELECT outcome, target_id, target_type, reason, before, after, meta FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id`,
    [adminId, action],
  );
const allAudits = (adminId: string) => query<{ action: string }>(`SELECT action FROM admin_audit_log WHERE admin_id = $1 ORDER BY id`, [adminId]);
const recipientsOf = (id: string) =>
  query<{ user_id: string; telegram_id: string; status: string }>(
    `SELECT user_id::text AS user_id, telegram_id::text AS telegram_id, status FROM broadcast_recipients WHERE broadcast_id = $1 ORDER BY broadcast_recipients.user_id`,
    [id],
  );
const rowOf = (id: string) =>
  queryOne<{ status: string; total: number; sent: number; failed: number; queued_at: Date | null; finished_at: Date | null }>(
    `SELECT status, total, sent, failed, queued_at, finished_at FROM broadcasts WHERE id = $1`,
    [id],
  );

const REASON = "Texnik ishlar haqida ogohlantirish";

/** Cohort for the audience tests, created once. */
const C: Record<string, string> = {};
if (hasDb) {
  const mkOrder = (userId: string, state: string) =>
    query(`INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state) VALUES ($1, $2, 'click', 'topup', 10000, $3)`, [randomUUID(), userId, state]);
  const mkGen = async (userId: string, daysAgo: number) => {
    const enq = await jobs.enqueueGeneration({ userId, toolId: "slide", topic: "Aud", price: 0, format: "pptx", values: { topic: "Aud" } as never, budgetMs: 60_000 });
    assert.ok(enq.ok);
    await query(`UPDATE generations SET created_at = now() - ($2 || ' days')::interval WHERE id = $1`, [enq.id, String(daysAgo)]);
  };
  const mkSess = (userId: string, createdDaysAgo: number, seenDaysAgo: number) =>
    query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES ($1, $2, now() + interval '1 day', now() - ($3 || ' days')::interval, now() - ($4 || ' days')::interval)`,
      [userId, randomBytes(16).toString("hex"), String(createdDaysAgo), String(seenDaysAgo)],
    );

  C.plain = (await mkUser({ name: "Oddiy" })).id;
  C.paid = (await mkUser({ name: "To'lagan", paid: true })).id;
  await mkOrder(C.paid, "paid");
  C.pendingOrder = (await mkUser({ name: "Kutilayotgan buyurtma" })).id;
  await mkOrder(C.pendingOrder, "pending");
  await mkOrder(C.pendingOrder, "cancelled");
  C.paidBlocked = (await mkUser({ name: "Bloklangan to'lagan", paid: true, blocked: true })).id;
  await mkOrder(C.paidBlocked, "paid");
  C.paidNoTg = (await mkUser({ name: "Telegramsiz to'lagan", paid: true, tg: null })).id;
  await mkOrder(C.paidNoTg, "paid");
  C.recentGen = (await mkUser({ name: "Yaqinda generatsiya", activeAgeDays: 3 })).id;
  await mkGen(C.recentGen, 3);
  C.oldGen = (await mkUser({ name: "Eski generatsiya", activeAgeDays: 100 })).id;
  await mkGen(C.oldGen, 100);
  C.recentSession = (await mkUser({ name: "Yaqinda sessiya", activeAgeDays: 5 })).id;
  await mkSess(C.recentSession, 200, 5);
  C.oldSession = (await mkUser({ name: "Eski sessiya", activeAgeDays: 200 })).id;
  await mkSess(C.oldSession, 200, 200);
  C.activeBlocked = (await mkUser({ name: "Bloklangan faol", blocked: true, activeAgeDays: 3 })).id;
  await mkGen(C.activeBlocked, 3);
  C.activeNoTg = (await mkUser({ name: "Telegramsiz faol", tg: null, activeAgeDays: 3 })).id;
  await mkGen(C.activeNoTg, 3);
}

/** The expected audience by an independent model over what the fixtures know. */
function expected(kind: "all" | "paid" | "active_days", days = 0): string[] {
  return [...known.entries()]
    .filter(([, k]) => k.tg !== null && !k.blocked)
    .filter(([, k]) => kind === "all" || (kind === "paid" ? k.paid : k.activeAgeDays !== null && k.activeAgeDays < days))
    .map(([id]) => id)
    .sort((a, b) => Number(a) - Number(b));
}

async function mkDraft(s: Session, text = "Salom, bu e'lon", audience: unknown = { kind: "all" }): Promise<string> {
  const r = await post("create", s.cookie, null, { text, audience });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return String((r.body.broadcast as { id: string }).id);
}

/** Cancels everything still active so one delivery tick only touches the broadcast under test. */
const quiesce = () => query(`UPDATE broadcasts SET status = 'cancelled', finished_at = now() WHERE status IN ('queued', 'sending')`);
const fakeTime = () => {
  let clock = 0;
  return { configured: () => true, now: () => clock, sleep: async (ms: number) => void (clock += ms) };
};

// ───────────────────────────── audience

test("audience: counts equal an independent model for every kind and days", { skip }, async () => {
  const s = await session("support");
  assert.equal(known.size, Number((await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM users`))!.n), "the test knows every user");
  const cases: Array<[string, "all" | "paid" | "active_days", number?]> = [
    ["?kind=all", "all"],
    ["?kind=paid", "paid"],
    ["?kind=active_days&days=1", "active_days", 1],
    ["?kind=active_days&days=4", "active_days", 4],
    ["?kind=active_days&days=7", "active_days", 7],
    ["?kind=active_days&days=90", "active_days", 90],
    ["?kind=active_days&days=365", "active_days", 365],
  ];
  for (const [qs, kind, days] of cases) {
    const r = await get("audience", s.cookie, { qs });
    assert.equal(r.status, 200, `${qs}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(Object.keys(r.body), ["count"]);
    assert.equal(r.body.count, expected(kind, days).length, qs);
  }
  // The cohort makes the cases meaningfully different from each other.
  assert.ok(expected("paid").length >= 1 && expected("paid").length < expected("all").length);
  assert.ok(expected("active_days", 365).length > expected("active_days", 90).length);
  assert.ok(expected("active_days", 90).length > expected("active_days", 4).length);
  assert.ok(expected("active_days", 4).length > expected("active_days", 1).length);
  // The exclusions are not in `all`: blocked, no telegram.
  const snapshotIds = expected("all");
  for (const id of [C.paidBlocked, C.paidNoTg, C.activeBlocked, C.activeNoTg]) assert.ok(!snapshotIds.includes(id));
});

test("audience: 400 for bad kind, bad or missing days, days on a non-days kind, repeated params, injection", { skip }, async () => {
  const s = await session("support");
  const bads = [
    "",
    "?kind=",
    "?kind=everyone",
    "?kind=ALL",
    "?kind=all&kind=paid",
    "?kind=all;DROP%20TABLE%20users",
    "?kind=all'%20OR%20'1'='1",
    "?kind=active_days",
    "?kind=active_days&days=0",
    "?kind=active_days&days=366",
    "?kind=active_days&days=-3",
    "?kind=active_days&days=1.5",
    "?kind=active_days&days=1e2",
    "?kind=active_days&days=abc",
    "?kind=active_days&days=7&days=8",
    "?kind=active_days&days=99999999999999999999",
    "?kind=all&days=7",
    "?kind=paid&days=1",
  ];
  for (const qs of bads) {
    const r = await get("audience", s.cookie, { qs });
    assert.equal(r.status, 400, `${qs} → ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(typeof r.body.error, "string");
  }
  assert.equal((await get("audience", s.cookie, { qs: "?kind=active_days&days=365" })).status, 200);
  assert.equal((await get("audience", s.cookie, { qs: "?kind=active_days&days=1" })).status, 200);
});

// ───────────────────────────── create

test("create: 201 draft with the exact shape, one audit row, extra body fields ignored", { skip }, async () => {
  const s = await session("admin");
  const r = await post("create", s.cookie, null, {
    text: "  Yangi vosita qo'shildi: <b>Tinglash</b> & o'yin  ",
    audience: { kind: "active_days", days: 30 },
    status: "done",
    total: 9999,
    sent: 5,
    createdBy: "1",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body), ["broadcast"]);
  const b = r.body.broadcast as Record<string, unknown>;
  assert.deepEqual(Object.keys(b).sort(), ["audience", "createdAt", "createdBy", "createdByName", "failed", "finishedAt", "id", "queuedAt", "sent", "status", "text", "total"]);
  assert.equal(b.status, "draft");
  assert.equal(b.text, "Yangi vosita qo'shildi: <b>Tinglash</b> & o'yin", "stored trimmed, NOT escaped (escaping happens at send time)");
  assert.deepEqual(b.audience, { kind: "active_days", days: 30 });
  assert.equal(b.total, 0);
  assert.equal(b.sent, 0);
  assert.equal(b.failed, 0);
  assert.equal(b.createdBy, s.adminId);
  assert.equal(b.createdByName, "Broadcast Test");
  assert.equal(b.queuedAt, null);
  assert.equal(b.finishedAt, null);
  assert.equal(typeof b.createdAt, "string");
  const row = await rowOf(String(b.id));
  assert.equal(row!.status, "draft");
  assert.equal(row!.total, 0);
  const a = await audits(s.adminId, "broadcasts.create");
  assert.equal(a.length, 1);
  assert.equal(a[0].outcome, "ok");
  assert.equal(a[0].target_type, "broadcast");
  assert.equal(a[0].target_id, String(b.id));
  assert.deepEqual(a[0].after, { status: "draft", audience: { kind: "active_days", days: 30 }, text: b.text });
  assert.equal(a[0].before, null);
  assert.equal((await allAudits(s.adminId)).length, 1, "no other audit rows");
  assert.equal(tgCalls.length, 0, "creating a draft sends nothing");
});

test("create: text limits count characters after trim (3500 ok, 3501 not, emoji count as one)", { skip }, async () => {
  const s = await session("admin");
  assert.equal((await post("create", s.cookie, null, { text: "a".repeat(3500), audience: { kind: "all" } })).status, 201);
  assert.equal((await post("create", s.cookie, null, { text: `  ${"a".repeat(3500)}  `, audience: { kind: "all" } })).status, 201, "padding is trimmed before the check");
  assert.equal((await post("create", s.cookie, null, { text: "a".repeat(3501), audience: { kind: "all" } })).status, 400);
  assert.equal((await post("create", s.cookie, null, { text: "😀".repeat(3500), audience: { kind: "all" } })).status, 201, "3500 emoji = 3500 characters");
  assert.equal((await post("create", s.cookie, null, { text: "😀".repeat(3501), audience: { kind: "all" } })).status, 400);
  assert.equal((await post("create", s.cookie, null, { text: "x", audience: { kind: "all" } })).status, 201, "1 character is enough");
});

test("create: 400 for bad text and bad audience, nothing written", { skip }, async () => {
  const s = await session("admin");
  const before = Number((await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM broadcasts`))!.n);
  const A = { kind: "all" };
  const bads: unknown[] = [
    { audience: A },
    { text: "", audience: A },
    { text: "   \n\t ", audience: A },
    { text: 123, audience: A },
    { text: null, audience: A },
    { text: ["x"], audience: A },
    { text: "a\u0000b", audience: A },
    { text: "Salom" },
    { text: "Salom", audience: null },
    { text: "Salom", audience: "all" },
    { text: "Salom", audience: ["all"] },
    { text: "Salom", audience: {} },
    { text: "Salom", audience: { kind: "nobody" } },
    { text: "Salom", audience: { kind: 1 } },
    { text: "Salom", audience: { kind: "active_days" } },
    { text: "Salom", audience: { kind: "active_days", days: 0 } },
    { text: "Salom", audience: { kind: "active_days", days: 366 } },
    { text: "Salom", audience: { kind: "active_days", days: 1.5 } },
    { text: "Salom", audience: { kind: "active_days", days: "7" } },
    { text: "Salom", audience: { kind: "all", days: 7 } },
    { text: "Salom", audience: { kind: "paid", userIds: [1] } },
    { text: "Salom", audience: { kind: "all", extra: true } },
  ];
  for (const b of bads) {
    const r = await post("create", s.cookie, null, b);
    assert.equal(r.status, 400, `${JSON.stringify(b)} → ${r.status}`);
  }
  assert.equal((await post("create", s.cookie, null, null, { raw: "[]" })).status, 400, "array body");
  assert.equal((await post("create", s.cookie, null, null, { raw: "not json" })).status, 400, "malformed JSON");
  assert.equal((await post("create", s.cookie, null, null, { raw: JSON.stringify({ text: "a".repeat(20_000), audience: A }) })).status, 413, "oversized body");
  assert.equal(Number((await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM broadcasts`))!.n), before);
  assert.equal((await allAudits(s.adminId)).length, 0);
});

// ───────────────────────────── detail

test("detail: broadcast + stats, failure reasons, 404 for unknown and malformed ids", { skip }, async () => {
  const s = await session("support");
  const own = await session("admin");
  const id = await mkDraft(own, "Detail matni", { kind: "paid" });
  await query(`UPDATE broadcasts SET status = 'sending', total = 5, sent = 2, failed = 2, queued_at = now() WHERE id = $1`, [id]);
  const u = Object.values(C);
  await query(
    `INSERT INTO broadcast_recipients (broadcast_id, user_id, telegram_id, status, error) VALUES
       ($1, $2, 7001, 'sent', NULL), ($1, $3, 7002, 'sent', NULL),
       ($1, $4, 7003, 'failed', 'Telegram xabarni qabul qilmadi'), ($1, $5, 7004, 'failed', 'Telegram xabarni qabul qilmadi'),
       ($1, $6, 7005, 'pending', NULL)`,
    [id, u[0], u[1], u[2], u[3], u[4]],
  );
  const r = await get("detail", s.cookie, { id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body), ["broadcast", "stats"]);
  const b = r.body.broadcast as Record<string, unknown>;
  assert.equal(b.id, id);
  assert.equal(b.text, "Detail matni");
  assert.equal(b.status, "sending");
  assert.deepEqual(b.audience, { kind: "paid" });
  assert.deepEqual(r.body.stats, {
    total: 5,
    sent: 2,
    failed: 2,
    pending: 1,
    failedReasons: [{ error: "Telegram xabarni qabul qilmadi", count: 2 }],
  });
  const missing = await get("detail", s.cookie, { id: "999999999" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "not_found");
  for (const bad of ["abc", "0", "-1", "1e3", "01", "1.5", "99999999999999999999", "1%20OR%201=1", "1;DROP"]) {
    assert.equal((await get("detail", s.cookie, { id: bad })).status, 404, `id ${bad}`);
  }
});

// ───────────────────────────── list

test("list: narrow items, newest first, status filter, keyset paging with no gaps or repeats", { skip }, async () => {
  await quiesce();
  await query(`DELETE FROM broadcasts`);
  const s = await session("support");
  const own = await session("admin");
  const long = "Q".repeat(400);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push(await mkDraft(own, i === 0 ? long : `Xabar ${i}`, i % 2 ? { kind: "paid" } : { kind: "all" }));
    await query(`UPDATE broadcasts SET created_at = now() - ($2 || ' minutes')::interval WHERE id = $1`, [ids[i], String((5 - i) * 10)]);
  }
  await query(`UPDATE broadcasts SET status = 'done', total = 3, sent = 3 WHERE id = $1`, [ids[1]]);
  await query(`UPDATE broadcasts SET status = 'cancelled' WHERE id = $1`, [ids[2]]);
  const all = await get("list", s.cookie);
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.deepEqual(Object.keys(all.body).sort(), ["items", "nextCursor", "total", "totalCapped"]);
  const items = all.body.items as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((i) => i.id), [...ids].reverse(), "newest first");
  assert.equal(all.body.total, 5);
  assert.equal(all.body.totalCapped, false);
  assert.ok(!("text" in items[0]), "lists never carry the full text");
  const oldest = items.find((i) => i.id === ids[0])!;
  assert.equal((oldest.preview as string).length, 160);
  assert.equal(oldest.textLength, 400);
  assert.equal(items.find((i) => i.id === ids[3])!.preview, "Xabar 3");
  assert.equal(items.find((i) => i.id === ids[1])!.createdByName, "Broadcast Test");

  const done = await get("list", s.cookie, { qs: "?status=done" });
  assert.deepEqual((done.body.items as Array<{ id: string }>).map((i) => i.id), [ids[1]]);
  assert.equal(done.body.total, 1);
  const two = await get("list", s.cookie, { qs: "?status=done,cancelled" });
  assert.deepEqual((two.body.items as Array<{ id: string }>).map((i) => i.id).sort(), [ids[1], ids[2]].sort());

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r = await get("list", s.cookie, { qs: `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}` });
    assert.equal(r.status, 200);
    seen.push(...(r.body.items as Array<{ id: string }>).map((i) => i.id));
    cursor = r.body.nextCursor as string | null;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(seen, [...ids].reverse());
});

test("list: 400 for bad status, sort, limit, cursor", { skip }, async () => {
  const s = await session("support");
  for (const qs of ["?status=sent", "?status=draft;DROP", "?status=draft,bogus", "?status=draft&status=done", "?sort=text", "?sort=created_desc;--", "?sort=__proto__", "?limit=0", "?limit=101", "?limit=abc", "?cursor=zzz", `?cursor=${Buffer.from('["x","y"]').toString("base64url")}`]) {
    assert.equal((await get("list", s.cookie, { qs })).status, 400, qs);
  }
  assert.equal((await get("list", s.cookie, { qs: "?limit=100&status=draft,queued,sending,done,cancelled" })).status, 200);
});

// ───────────────────────────── test send

test("test send goes to the actor only, text escaped, one audit row", { skip }, async (t) => {
  quiet(t);
  const s = await session("admin");
  const other = await session("owner");
  const id = await mkDraft(s, `<b>Chegirma</b> & "yangi" 'narx' > 5`, { kind: "all" });
  tgCalls = [];
  const r = await post("test", s.cookie, id, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { sent: true });
  assert.equal(tgCalls.length, 1, "exactly one message");
  assert.equal(tgCalls[0].chatId, s.telegramId, "to the acting admin's own chat");
  assert.notEqual(tgCalls[0].chatId, other.telegramId);
  assert.equal(tgCalls[0].text, "&lt;b&gt;Chegirma&lt;/b&gt; &amp; &quot;yangi&quot; 'narx' &gt; 5");
  assert.equal(tgCalls[0].parseMode, "HTML");
  // A body that tries to redirect it changes nothing.
  tgCalls = [];
  const r2 = await post("test", s.cookie, id, { chatId: other.telegramId, telegramId: other.telegramId, to: "all" });
  assert.equal(r2.status, 200);
  assert.deepEqual(tgCalls.map((c) => c.chatId), [s.telegramId]);
  const a = await audits(s.adminId, "broadcasts.test");
  assert.equal(a.length, 2);
  assert.equal(a[0].target_id, id);
  assert.deepEqual(a[0].meta, { sent: true });
  assert.equal((await rowOf(id))!.status, "draft", "a test send never changes the broadcast");
  assert.equal((await recipientsOf(id)).length, 0);
});

test("test send: 409 no_telegram without a Telegram id (nothing sent), 404, 400", { skip }, async (t) => {
  quiet(t);
  const noTg = await session("admin", { noTelegram: true });
  const id = await mkDraft(noTg, "Matn");
  tgCalls = [];
  const r = await post("test", noTg.cookie, id, {});
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "no_telegram");
  assert.equal(tgCalls.length, 0);
  assert.equal((await audits(noTg.adminId, "broadcasts.test")).length, 0);
  const s = await session("admin");
  assert.equal((await post("test", s.cookie, "999999999", {})).status, 404);
  assert.equal((await post("test", s.cookie, "abc", {})).status, 404);
  assert.equal((await post("test", s.cookie, id, null, { raw: "[]" })).status, 400);
});

test("test send: bot not configured → 503 bot_not_configured, no network; Telegram 403 → sent:false; 5xx → 502 with audit", { skip }, async (t) => {
  quiet(t);
  const s = await session("admin");
  const id = await mkDraft(s, "Matn");

  const token = env.telegramBotToken;
  (env as { telegramBotToken: string }).telegramBotToken = "";
  tgCalls = [];
  try {
    const r = await post("test", s.cookie, id, {});
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "bot_not_configured");
    assert.equal(tgCalls.length, 0);
    assert.equal((await audits(s.adminId, "broadcasts.test")).length, 0, "nothing reached Telegram, nothing to audit");
  } finally {
    (env as { telegramBotToken: string }).telegramBotToken = token;
  }

  tgFail = new Map([[s.telegramId!, 403]]);
  try {
    const r = await post("test", s.cookie, id, {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { sent: false });
    tgFail = new Map([[s.telegramId!, 502]]);
    const r2 = await post("test", s.cookie, id, {});
    assert.equal(r2.status, 502);
    assert.equal(r2.body.code, "telegram_unavailable");
  } finally {
    tgFail = new Map();
  }
  const a = await audits(s.adminId, "broadcasts.test");
  assert.deepEqual(a.map((x) => x.meta), [{ sent: false }, { sent: false, transient: true }]);
});

// ───────────────────────────── send

test("send: snapshot equals the audience, status queued, total, audit with reason; delivery sends exactly to the snapshot", { skip }, async (t) => {
  quiet(t);
  await quiesce();
  const s = await session("owner");
  for (const [kind, audience] of [
    ["paid", { kind: "paid" }],
    ["active_days", { kind: "active_days", days: 7 }],
    ["all", { kind: "all" }],
  ] as const) {
    await quiesce();
    const id = await mkDraft(s, `Matn <${kind}> & "q"`, audience);
    const exp = expected(kind, kind === "active_days" ? 7 : 0);
    assert.ok(exp.length > 0);
    const r = await post("send", s.cookie, id, { reason: REASON, confirmCount: exp.length });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body), ["broadcast"]);
    const b = r.body.broadcast as Record<string, unknown>;
    assert.equal(b.status, "queued");
    assert.equal(b.total, exp.length);
    assert.equal(typeof b.queuedAt, "string");
    const rec = await recipientsOf(id);
    assert.deepEqual(rec.map((x) => x.user_id), exp, `${kind}: the snapshot is exactly the expected audience`);
    assert.ok(rec.every((x) => x.status === "pending"));
    assert.deepEqual(rec.map((x) => x.telegram_id), exp.map((uid) => known.get(uid)!.tg!), "with each user's telegram id");
    for (const bad of [C.paidBlocked, C.paidNoTg, C.activeBlocked, C.activeNoTg]) assert.ok(!rec.some((x) => x.user_id === bad));
    const a = await audits(s.adminId, "broadcasts.send");
    assert.equal(a.length, kind === "paid" ? 1 : kind === "active_days" ? 2 : 3);
    const last = a[a.length - 1];
    assert.equal(last.reason, REASON);
    assert.equal(last.target_id, id);
    assert.deepEqual(last.before, { status: "draft", total: 0 });
    assert.deepEqual(last.after, { status: "queued", total: exp.length });
    assert.deepEqual(last.meta, { audience, confirmCount: exp.length });

    // The real delivery reaches exactly these chats, with the escaped text.
    tgCalls = [];
    const res = await bd.deliverBroadcasts(fakeTime());
    assert.equal(res.sent, exp.length);
    assert.equal(res.finished, 1);
    assert.deepEqual(tgCalls.map((c) => c.chatId).sort(), exp.map((uid) => known.get(uid)!.tg!).sort(), `${kind}: delivery sends exactly to the snapshot`);
    assert.ok(tgCalls.every((c) => c.text === `Matn &lt;${kind}&gt; &amp; &quot;q&quot;` && c.parseMode === "HTML"));
    const done = await rowOf(id);
    assert.equal(done!.status, "done");
    assert.equal(done!.sent, exp.length);
    assert.equal(done!.failed, 0);
  }
});

test("send: count_changed is 409, nothing is queued, no audit row, no recipients", { skip }, async () => {
  const s = await session("admin");
  const id = await mkDraft(s, "Matn", { kind: "all" });
  const real = expected("all").length;
  for (const wrong of [real - 1, real + 1, 0]) {
    const r = await post("send", s.cookie, id, { reason: REASON, confirmCount: wrong });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, "count_changed");
    assert.equal(r.body.count, real);
  }
  const row = await rowOf(id);
  assert.equal(row!.status, "draft");
  assert.equal(row!.total, 0);
  assert.equal(row!.queued_at, null);
  assert.equal((await recipientsOf(id)).length, 0, "the snapshot was rolled back");
  assert.equal((await audits(s.adminId, "broadcasts.send")).length, 0);
  assert.equal((await post("send", s.cookie, id, { reason: REASON, confirmCount: real })).status, 200, "the right count goes through");
  await quiesce();
});

test("send: the audience is re-counted at send time (a user who got blocked after the page loaded)", { skip }, async () => {
  const s = await session("admin");
  const victim = await mkUser({ name: "Keyin bloklanadigan", paid: true });
  await query(`INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state) VALUES ($1, $2, 'payme', 'topup', 5000, 'paid')`, [randomUUID(), victim.id]);
  const id = await mkDraft(s, "Matn", { kind: "paid" });
  const seen = (await get("audience", s.cookie, { qs: "?kind=paid" })).body.count as number;
  assert.equal(seen, expected("paid").length);
  await query(`UPDATE users SET is_blocked = true WHERE id = $1`, [victim.id]);
  known.get(victim.id)!.blocked = true;
  const r = await post("send", s.cookie, id, { reason: REASON, confirmCount: seen });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "count_changed");
  assert.equal(r.body.count, seen - 1);
});

test("send: only a draft can be sent (409 state, no audit); empty audience is 409; bad bodies are 400", { skip }, async () => {
  await quiesce();
  const s = await session("admin");
  const real = expected("paid").length;
  const id = await mkDraft(s, "Matn", { kind: "paid" });
  assert.equal((await post("send", s.cookie, id, { reason: REASON, confirmCount: real })).status, 200);
  for (const status of ["queued", "sending", "done", "cancelled"]) {
    await query(`UPDATE broadcasts SET status = $2 WHERE id = $1`, [id, status]);
    const r = await post("send", s.cookie, id, { reason: REASON, confirmCount: real });
    assert.equal(r.status, 409, status);
    assert.equal(r.body.code, "state");
  }
  assert.equal((await audits(s.adminId, "broadcasts.send")).length, 1, "failed attempts write no audit row");
  assert.equal((await recipientsOf(id)).length, real, "no second snapshot");

  // An audience nobody belongs to: no paid orders at all for a moment.
  const empty = await mkDraft(s, "Bo'sh", { kind: "paid" });
  const paidOrders = (await query<{ id: string }>(`UPDATE payment_orders SET state = 'pending' WHERE state = 'paid' RETURNING id::text AS id`)).map((x) => x.id);
  try {
    const none = await post("send", s.cookie, empty, { reason: REASON, confirmCount: 0 });
    assert.equal(none.status, 409);
    assert.equal(none.body.code, "empty_audience");
  } finally {
    await query(`UPDATE payment_orders SET state = 'paid' WHERE id = ANY($1::uuid[])`, [paidOrders]);
  }
  assert.equal((await rowOf(empty))!.status, "draft");

  const d = await mkDraft(s, "Matn");
  const cnt = expected("all").length;
  const bads: unknown[] = [
    {},
    { reason: REASON },
    { confirmCount: cnt },
    { reason: "", confirmCount: cnt },
    { reason: "abc", confirmCount: cnt },
    { reason: "x".repeat(501), confirmCount: cnt },
    { reason: 12345, confirmCount: cnt },
    { reason: REASON, confirmCount: String(cnt) },
    { reason: REASON, confirmCount: -1 },
    { reason: REASON, confirmCount: 1.5 },
    { reason: REASON, confirmCount: null },
    { reason: REASON, confirmCount: [cnt] },
    { reason: REASON, confirmCount: 1e21 },
  ];
  for (const b of bads) assert.equal((await post("send", s.cookie, d, b)).status, 400, JSON.stringify(b));
  assert.equal((await post("send", s.cookie, "999999999", { reason: REASON, confirmCount: 1 })).status, 404);
  assert.equal((await post("send", s.cookie, "abc", { reason: REASON, confirmCount: 1 })).status, 404);
  assert.equal((await rowOf(d))!.status, "draft");
  assert.equal((await recipientsOf(d)).length, 0);
});

test("send: two concurrent sends queue exactly once", { skip }, async () => {
  await quiesce();
  const s = await session("admin");
  const id = await mkDraft(s, "Matn", { kind: "paid" });
  const real = expected("paid").length;
  const [a, b] = await Promise.all([
    post("send", s.cookie, id, { reason: REASON, confirmCount: real }),
    post("send", s.cookie, id, { reason: REASON, confirmCount: real }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((a.status === 409 ? a : b).body.code, "state");
  assert.equal((await recipientsOf(id)).length, real);
  assert.equal((await audits(s.adminId, "broadcasts.send")).length, 1);
  assert.equal((await rowOf(id))!.total, real);
  await quiesce();
});

test("send takes the row lock: a send racing a concurrent cancel waits and then sees the new status", { skip }, async () => {
  await quiesce();
  const s = await session("admin");
  const id = await mkDraft(s, "Poyga", { kind: "paid" });
  const real = expected("paid").length;
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM broadcasts WHERE id = $1 FOR UPDATE", [id]);
    let settled = false;
    const pending = post("send", s.cookie, id, { reason: REASON, confirmCount: real }).then((r) => ((settled = true), r));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(settled, false, "the send waits for the row lock");
    await client.query("UPDATE broadcasts SET status = 'cancelled' WHERE id = $1", [id]);
    await client.query("COMMIT");
    const r = await pending;
    assert.equal(r.status, 409, "after the lock it re-reads the status and refuses");
    assert.equal(r.body.code, "state");
  } finally {
    client.release();
  }
  assert.equal((await recipientsOf(id)).length, 0);
  assert.equal((await audits(s.adminId, "broadcasts.send")).length, 0);
});

// ───────────────────────────── cancel

test("cancel: a draft, a queued and a half-sent broadcast become cancelled with one audit row each", { skip }, async () => {
  await quiesce();
  const s = await session("admin");
  const real = expected("paid").length;
  const draft = await mkDraft(s, "Qoralama");
  const r1 = await post("cancel", s.cookie, draft, { reason: REASON });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.deepEqual(Object.keys(r1.body), ["broadcast"]);
  assert.equal((r1.body.broadcast as { status: string }).status, "cancelled");
  assert.equal(typeof (r1.body.broadcast as { finishedAt: string }).finishedAt, "string");

  const queued = await mkDraft(s, "Navbatda", { kind: "paid" });
  await post("send", s.cookie, queued, { reason: REASON, confirmCount: real });
  assert.equal((await post("cancel", s.cookie, queued, { reason: REASON })).status, 200);
  assert.equal((await rowOf(queued))!.status, "cancelled");

  const a = await audits(s.adminId, "broadcasts.cancel");
  assert.equal(a.length, 2);
  assert.equal(a[0].reason, REASON);
  assert.deepEqual(a[0].before, { status: "draft" });
  assert.deepEqual(a[0].after, { status: "cancelled" });
  assert.deepEqual(a[1].before, { status: "queued" });
  assert.deepEqual(a[1].meta, { total: real, sent: 0, failed: 0, unsent: real });
});

test("cancel stops the real delivery: pending recipients are never sent", { skip }, async (t) => {
  quiet(t);
  await quiesce();
  const s = await session("owner");
  const exp = expected("all");
  assert.ok(exp.length > 3);
  const id = await mkDraft(s, "To'xtatiladigan xabar", { kind: "all" });
  assert.equal((await post("send", s.cookie, id, { reason: REASON, confirmCount: exp.length })).status, 200);
  tgCalls = [];
  const first = await bd.deliverBroadcasts({ ...fakeTime(), maxPerTick: 2 });
  assert.equal(first.sent, 2, "two messages went out before the cancel");
  assert.equal((await rowOf(id))!.status, "sending");

  const c = await post("cancel", s.cookie, id, { reason: REASON });
  assert.equal(c.status, 200);
  const a = await audits(s.adminId, "broadcasts.cancel");
  assert.deepEqual(a[0].before, { status: "sending" });
  assert.deepEqual(a[0].meta, { total: exp.length, sent: 2, failed: 0, unsent: exp.length - 2 });

  tgCalls = [];
  const after = await bd.deliverBroadcasts(fakeTime());
  assert.equal(after.sent, 0);
  assert.equal(after.rows, 0);
  assert.equal(tgCalls.length, 0, "nothing is sent after the cancel");
  const row = await rowOf(id);
  assert.equal(row!.status, "cancelled", "delivery does not resurrect or finish a cancelled broadcast");
  assert.equal(row!.sent, 2);
  const rec = await recipientsOf(id);
  assert.equal(rec.filter((x) => x.status === "pending").length, exp.length - 2);
  const d = (await get("detail", s.cookie, { id })).body.stats as { pending: number; sent: number };
  assert.equal(d.sent, 2);
  assert.equal(d.pending, exp.length - 2);
});

test("cancel: done / cancelled are 409 state (no audit); bad bodies 400; unknown id 404", { skip }, async () => {
  const s = await session("admin");
  const id = await mkDraft(s, "Matn");
  assert.equal((await post("cancel", s.cookie, id, { reason: REASON })).status, 200);
  const again = await post("cancel", s.cookie, id, { reason: REASON });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "state");
  await query(`UPDATE broadcasts SET status = 'done' WHERE id = $1`, [id]);
  assert.equal((await post("cancel", s.cookie, id, { reason: REASON })).status, 409);
  assert.equal((await audits(s.adminId, "broadcasts.cancel")).length, 1);
  const d = await mkDraft(s, "Matn");
  for (const b of [{}, { reason: "" }, { reason: "abc" }, { reason: 5 }, { reason: "x".repeat(501) }]) {
    assert.equal((await post("cancel", s.cookie, d, b)).status, 400, JSON.stringify(b));
  }
  assert.equal((await rowOf(d))!.status, "draft");
  assert.equal((await post("cancel", s.cookie, "999999999", { reason: REASON })).status, 404);
  assert.equal((await post("cancel", s.cookie, "0", { reason: REASON })).status, 404);
});

// ───────────────────────────── permissions

test("support sees list, detail and audience but cannot create, test, send or cancel (denied audit); finance and viewer see nothing", { skip }, async () => {
  const owner = await session("owner");
  const id = await mkDraft(owner, "Ruxsat testi");
  const support = await session("support");
  assert.equal((await get("list", support.cookie)).status, 200);
  assert.equal((await get("detail", support.cookie, { id })).status, 200);
  assert.equal((await get("audience", support.cookie, { qs: "?kind=all" })).status, 200);
  tgCalls = [];
  const attempts: Array<[string, Result]> = [
    ["create", await post("create", support.cookie, null, { text: "x", audience: { kind: "all" } })],
    ["test", await post("test", support.cookie, id, {})],
    ["send", await post("send", support.cookie, id, { reason: REASON, confirmCount: 1 })],
    ["cancel", await post("cancel", support.cookie, id, { reason: REASON })],
  ];
  for (const [what, r] of attempts) {
    assert.equal(r.status, 403, what);
    assert.equal(r.body.code, "forbidden", what);
  }
  assert.equal(tgCalls.length, 0);
  const denied = (await query<{ outcome: string }>(`SELECT outcome FROM admin_audit_log WHERE admin_id = $1 AND action = 'auth.denied'`, [support.adminId])).map((x) => x.outcome);
  assert.deepEqual(denied, ["denied", "denied", "denied", "denied"]);
  assert.equal((await rowOf(id))!.status, "draft");

  for (const role of ["finance", "viewer", "moderator"] as const) {
    const s = await session(role);
    assert.equal((await get("list", s.cookie)).status, 403, `${role} list`);
    assert.equal((await get("detail", s.cookie, { id })).status, 403, `${role} detail`);
    assert.equal((await get("audience", s.cookie, { qs: "?kind=all" })).status, 403, `${role} audience`);
    assert.equal((await post("create", s.cookie, null, { text: "x", audience: { kind: "all" } })).status, 403, `${role} create`);
  }
  for (const role of ["admin", "owner"] as const) {
    const s = await session(role);
    assert.equal((await get("list", s.cookie)).status, 200, `${role} list`);
    assert.equal((await post("create", s.cookie, null, { text: "x", audience: { kind: "all" } })).status, 201, `${role} create`);
  }
});

test("guard: 401 reauth on every broadcasts.send route when the step-up is stale; 403 without Origin; 404 for non-admins and anonymous", { skip }, async () => {
  const owner = await session("owner");
  const id = await mkDraft(owner, "Guard");
  const stale = await session("admin", { reauth: false });
  assert.equal((await get("list", stale.cookie)).status, 200, "reads need no step-up");
  const calls: Array<[string, Result]> = [
    ["create", await post("create", stale.cookie, null, { text: "x", audience: { kind: "all" } })],
    ["test", await post("test", stale.cookie, id, {})],
    ["send", await post("send", stale.cookie, id, { reason: REASON, confirmCount: 1 })],
    ["cancel", await post("cancel", stale.cookie, id, { reason: REASON })],
  ];
  for (const [what, r] of calls) {
    assert.equal(r.status, 401, what);
    assert.equal(r.body.code, "reauth", what);
  }
  assert.equal((await rowOf(id))!.status, "draft");
  assert.equal((await allAudits(stale.adminId)).length, 0);

  const fresh = await session("admin");
  assert.equal((await post("create", fresh.cookie, null, { text: "x", audience: { kind: "all" } }, { origin: false })).status, 403, "Origin is mandatory");
  const plain = await mkUser({ withSession: true });
  const plainCookie = `${SESSION_COOKIE}=${plain.userToken}`;
  assert.equal((await get("list", plainCookie)).status, 404, "non-admin → cloak");
  assert.equal((await post("create", plainCookie, null, { text: "x", audience: { kind: "all" } })).status, 404);
  assert.equal((await get("list", null)).status, 404, "anonymous → cloak");
  assert.equal((await get("audience", null, { qs: "?kind=all" })).status, 404);
});

test("unit: audience and text parsers", () => {
  assert.deepEqual(lib.parseAudience({ kind: "all" }), { kind: "all" });
  assert.deepEqual(lib.parseAudience({ kind: "active_days", days: 365 }), { kind: "active_days", days: 365 });
  assert.throws(() => lib.parseAudience({ kind: "active_days", days: 366 }));
  assert.throws(() => lib.parseAudience({ kind: "all", extra: 1 }));
  assert.equal(lib.parseText("  Salom  "), "Salom");
  assert.equal(lib.parseBroadcastId("12"), "12");
  assert.throws(() => lib.parseBroadcastId("012"));
  assert.equal(bd.escapeTelegramHtml("<a href=\"x\">&</a>"), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});
