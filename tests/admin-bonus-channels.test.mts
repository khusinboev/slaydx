import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin «Bonus kanallar» (docs/bonus/PLAN.md K2) through the REAL routes on a throwaway
 * Postgres, with the Bot API stubbed at `fetch`:
 *
 *   - input parsing: `@name`, `name`, t.me links (incl. `/s/`, post links), `tg://resolve`,
 *     numeric chat ids; private invite links and junk are 400 before any Bot API call;
 *   - resolve (preview): getChat → title/username/type, getChatMember(chat, bot id from the
 *     token) → admin / not_admin (+ the warning) / unknown; non-channel types 400 `chat_type`,
 *     unknown chats 400 `chat_not_found`, Telegram down 503; a known chat id is flagged;
 *   - create: validation (amounts 0..1 000 000 integers, at least one > 0, stay days 1..365)
 *     happens BEFORE Telegram; the row + ONE `bonus_channel.create` audit row commit together;
 *     a duplicate chat id is 409 with no second audit row; title override; default sort;
 *   - update: only changed fields go into before/after; no change 409 `state`; bounds 400;
 *   - delete: refused with 409 `has_claims` while claims exist (row and claims stay), else the
 *     row goes with a `bonus_channel.delete` audit row; an audit failure rolls the change back;
 *   - stats per channel from `bonus_channel_claims`;
 *   - permissions: viewer/finance read only (403 + one denied audit row on writes), support and
 *     moderator get 403 on reads, stale step-up 401 reauth, missing Origin 403, non-admin 404.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - `assertSomeBonus` call removed from `createBonusChannel` → "create: validation" (201 for
 *     0 + 0 instead of 400);
 *   - the claims count check removed from `deleteBonusChannel` → "delete: refused while claims
 *     exist" (200 and the claims were cascaded away);
 *   - `before[k] = prev[k]` replaced by `before[k] = next[k]` → "update: only changed fields";
 *   - `botAdminStatus` mapping `creator` → `not_admin` → "resolve: bot admin status";
 *   - `stay_paid > 0` filter dropped from the stay count → "stats" (stay paid count 3, not 2);
 *   - audit written through a separate `transaction()` instead of the `adminTx` client →
 *     "atomicity" (the row survived the failed audit).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.WORKER_INLINE = "false";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: step-up (bonus.edit is an S permission) is part of what these tests pin.
process.env.ADMIN_2FA_REQUIRED = "true";
// The bot id the code must use for getChatMember is the token's numeric prefix.
const BOT_ID = 7_654_321;
process.env.TELEGRAM_BOT_TOKEN = `${BOT_ID}:admin-bonus-test-token-never-leaves-the-process`;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminbonus") : { isolated: false, drop: async () => {} };

// ───────────────────────────── Bot API stub (installed before any lib import)

type TgChat = { id: number; type: string; title?: string; username?: string };
/** Chats the fake Telegram knows, by `@username` and by id. */
const CHATS = new Map<string, TgChat>();
/** Bot membership status per chat id; missing → 400 "member list is inaccessible". */
const BOT_STATUS = new Map<string, string>();
/** When set, every Bot API call answers this HTTP-level failure. */
let telegramDown: null | { code: number } = null;
const botCalls: Array<{ method: string; body: Record<string, unknown> }> = [];

function addChat(chat: TgChat, botStatus: string | null = "administrator"): TgChat {
  CHATS.set(String(chat.id), chat);
  if (chat.username) CHATS.set(`@${chat.username.toLowerCase()}`, chat);
  if (botStatus) BOT_STATUS.set(String(chat.id), botStatus);
  return chat;
}

const tgJson = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
  assert.ok(m, `unexpected fetch ${url}`);
  const method = m[1]!;
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  botCalls.push({ method, body });
  if (telegramDown) return tgJson({ ok: false, error_code: telegramDown.code, description: "Bad Gateway" }, telegramDown.code);
  const key = String(body.chat_id).toLowerCase();
  const chat = CHATS.get(key);
  if (method === "getChat") {
    return chat ? tgJson({ ok: true, result: chat }) : tgJson({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, 400);
  }
  if (method === "getChatMember") {
    assert.equal(body.user_id, BOT_ID, "getChatMember must ask about the bot itself");
    const status = chat ? BOT_STATUS.get(String(chat.id)) : undefined;
    return status
      ? tgJson({ ok: true, result: { status, user: { id: BOT_ID, is_bot: true } } })
      : tgJson({ ok: false, error_code: 400, description: "Bad Request: member list is inaccessible" }, 400);
  }
  return tgJson({ ok: false, error_code: 404, description: "Not Found" }, 404);
}) as typeof fetch;

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const lib = await import("../lib/server/admin-bonus-channels.ts");
const listRoute = await import("../app/api/admin/bonus-channels/route.ts");
const resolveRoute = await import("../app/api/admin/bonus-channels/resolve/route.ts");
const idRoute = await import("../app/api/admin/bonus-channels/[id]/route.ts");
const botRoute = await import("../app/api/admin/bonus-channels/[id]/bot-status/route.ts");

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures (admin-settings.test.mts pattern)

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name = "Bonus Test"): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `b_${randomBytes(5).toString("hex")}`, name],
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
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "bonus-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

const session = async (role: Role, reauth = true) => openSession(await mkAdmin(role), reauth);

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
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "bonus-test", "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = "http://localhost:3000";
  return headers;
}

const BASE = "http://localhost:3000/api/admin/bonus-channels";

async function list(cookie: string | null): Promise<Result> {
  const req = new Request(BASE, { method: "GET", headers: headersFor(cookie, false) });
  return readResult(await inRequest(req, () => listRoute.GET(req, undefined)));
}

async function resolve(cookie: string | null, q: string | null): Promise<Result> {
  const url = q === null ? `${BASE}/resolve` : `${BASE}/resolve?q=${encodeURIComponent(q)}`;
  const req = new Request(url, { method: "GET", headers: headersFor(cookie, false) });
  return readResult(await inRequest(req, () => resolveRoute.GET(req, undefined)));
}

async function create(cookie: string | null, body: unknown, opts: { origin?: boolean } = {}): Promise<Result> {
  const req = new Request(BASE, { method: "POST", headers: headersFor(cookie, opts.origin !== false), body: JSON.stringify(body) });
  return readResult(await inRequest(req, () => listRoute.POST(req, undefined)));
}

async function patch(cookie: string | null, id: string, body: unknown): Promise<Result> {
  const req = new Request(`${BASE}/${id}`, { method: "PATCH", headers: headersFor(cookie, true), body: JSON.stringify(body) });
  return readResult(await inRequest(req, () => idRoute.PATCH(req, { params: Promise.resolve({ id }) })));
}

async function del(cookie: string | null, id: string, body: unknown = {}): Promise<Result> {
  const req = new Request(`${BASE}/${id}`, { method: "DELETE", headers: headersFor(cookie, true), body: JSON.stringify(body) });
  return readResult(await inRequest(req, () => idRoute.DELETE(req, { params: Promise.resolve({ id }) })));
}

async function botStatus(cookie: string | null, id: string): Promise<Result> {
  const req = new Request(`${BASE}/${id}/bot-status`, { method: "GET", headers: headersFor(cookie, false) });
  return readResult(await inRequest(req, () => botRoute.GET(req, { params: Promise.resolve({ id }) })));
}

type Item = {
  id: string;
  chatId: string;
  username: string | null;
  title: string;
  joinBonus: number;
  stayBonus: number;
  stayDays: number;
  active: boolean;
  sort: number;
  stats: Record<string, number>;
};

const audits = (adminId: string, action?: string) =>
  query<{ action: string; outcome: string; target_type: string | null; target_id: string | null; reason: string | null; before: unknown; after: unknown; meta: unknown }>(
    `SELECT action, outcome, target_type, target_id, reason, before, after, meta FROM admin_audit_log
      WHERE admin_id = $1 AND ($2::text IS NULL OR action = $2) ORDER BY id`,
    [adminId, action ?? null],
  );

const channelRows = () =>
  query<{ id: string; chat_id: string; title: string; join_bonus: number; stay_bonus: number; stay_days: number; active: boolean; sort: number }>(
    `SELECT id::text AS id, chat_id::text AS chat_id, title, join_bonus, stay_bonus, stay_days, active, sort FROM bonus_channels ORDER BY id`,
  );

const resetChannels = async () => {
  await query("DELETE FROM bonus_channel_claims");
  await query("DELETE FROM bonus_channels");
};

let chatSeq = 1_000_000_000;
/** A fresh public channel the fake Telegram knows (bot is admin unless told otherwise). */
function freshChannel(opts: { username?: string; title?: string; type?: string; botStatus?: string | null } = {}): TgChat {
  chatSeq += 1;
  const username = opts.username ?? `kanal_${chatSeq}`;
  return addChat(
    { id: -1_000_000_000_000 - chatSeq, type: opts.type ?? "channel", title: opts.title ?? `Kanal ${chatSeq}`, username },
    opts.botStatus === undefined ? "administrator" : opts.botStatus,
  );
}

// ───────────────────────────── unit (no DB)

test("parseChannelRef: @name, name, t.me links, tg://resolve and numeric ids", () => {
  const u = (username: string) => ({ kind: "username", username });
  assert.deepEqual(lib.parseChannelRef("@slaydx_news"), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("  slaydx_news "), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("https://t.me/slaydx_news"), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("http://t.me/slaydx_news/"), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("t.me/slaydx_news"), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("https://t.me/s/slaydx_news"), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("https://t.me/slaydx_news/123?single"), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("https://telegram.me/slaydx_news"), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("www.t.me/slaydx_news"), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("tg://resolve?domain=slaydx_news"), u("slaydx_news"));
  assert.deepEqual(lib.parseChannelRef("-1001234567890"), { kind: "id", chatId: "-1001234567890" });
});

test("parseChannelRef: invite links are 400 invite_link; junk, other hosts and bad names are 400 input", () => {
  for (const s of ["https://t.me/+AbCdEf123", "t.me/joinchat/AbCdEf123"]) {
    assert.throws(() => lib.parseChannelRef(s), (e: { status: number; extra: { code: string } }) => e.status === 400 && e.extra.code === "invite_link", s);
  }
  for (const s of [undefined, null, 42, "", "   ", "@", "@ab", "@1abcde", "abc def", "https://evil.example/slaydx_news", "ftp://t.me/slaydx_news", "t.me/", "@name-with-dash", "-0", "99999999999999999999", "x".repeat(400)]) {
    assert.throws(() => lib.parseChannelRef(s), (e: { status: number; extra: { code: string } }) => e.status === 400 && e.extra.code === "input", String(s));
  }
});

test("validators: amounts are JSON integers 0..1 000 000, stay days 1..365, titles trimmed 1..128", () => {
  assert.equal(lib.parseAmount(0, "x"), 0);
  assert.equal(lib.parseAmount(1_000_000, "x"), 1_000_000);
  for (const bad of [-1, 1_000_001, 1.5, "1000", null, Number.NaN, Number.POSITIVE_INFINITY, true]) {
    assert.throws(() => lib.parseAmount(bad, "x"), /0 dan 1 000 000/, String(bad));
  }
  assert.equal(lib.parseStayDays(1), 1);
  assert.equal(lib.parseStayDays(365), 365);
  for (const bad of [0, 366, 7.5, "7"]) assert.throws(() => lib.parseStayDays(bad), /1 dan 365/, String(bad));
  assert.equal(lib.parseTitle("  Yangiliklar \n  kanali "), "Yangiliklar kanali");
  for (const bad of ["", "   ", "\u0000\u0007", "x".repeat(129), 5]) assert.throws(() => lib.parseTitle(bad), String(bad));
  assert.equal(lib.parseTitle("x".repeat(128)).length, 128);
  assert.throws(() => lib.parseChannelId("abc"), (e: { status: number; extra: { code: string } }) => e.status === 404 && e.extra.code === "not_found");
});

// ───────────────────────────── resolve

test("resolve: preview of a public channel; bot admin status admin / creator / not_admin / unknown", { skip }, async () => {
  const s = await session("viewer");
  const ch = freshChannel({ title: "SlaydX Yangiliklar" });
  botCalls.length = 0;
  const r = await resolve(s.cookie, `https://t.me/${ch.username}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    chatId: String(ch.id),
    title: "SlaydX Yangiliklar",
    username: ch.username,
    type: "channel",
    botAdmin: "admin",
    warning: null,
    existingId: null,
  });
  assert.deepEqual(botCalls.map((c) => c.method), ["getChat", "getChatMember"]);
  assert.equal(botCalls[0]!.body.chat_id, `@${ch.username}`);
  assert.equal(botCalls[1]!.body.chat_id, String(ch.id));

  const creator = freshChannel({ botStatus: "creator" });
  assert.equal((await resolve(s.cookie, `@${creator.username}`)).body.botAdmin, "admin");

  for (const status of ["member", "left", null]) {
    const c = freshChannel({ botStatus: status });
    const nr = await resolve(s.cookie, `@${c.username}`);
    assert.equal(nr.status, 200);
    assert.equal(nr.body.botAdmin, "not_admin", String(status));
    assert.equal(nr.body.warning, "Bot kanalda admin emas — obunani tekshira olmaydi");
  }

  // A supergroup by numeric id is fine too.
  const group = freshChannel({ type: "supergroup", username: undefined });
  const gr = await resolve(s.cookie, String(group.id));
  assert.equal(gr.status, 200);
  assert.equal(gr.body.type, "supergroup");
});

test("resolve: non-channel types 400 chat_type, unknown chats 400 chat_not_found, Telegram down 503, invite links and junk never reach Telegram", { skip }, async () => {
  const s = await session("owner");
  for (const type of ["private", "group"]) {
    const c = freshChannel({ type });
    const r = await resolve(s.cookie, `@${c.username}`);
    assert.equal(r.status, 400, type);
    assert.equal(r.body.code, "chat_type");
  }
  const missing = await resolve(s.cookie, "@no_such_channel_here");
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "chat_not_found");

  const c = freshChannel();
  telegramDown = { code: 502 };
  try {
    const r = await resolve(s.cookie, `@${c.username}`);
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "telegram_unavailable");
  } finally {
    telegramDown = null;
  }

  botCalls.length = 0;
  assert.equal((await resolve(s.cookie, "https://t.me/+secretInvite")).body.code, "invite_link");
  assert.equal((await resolve(s.cookie, "not a channel!")).status, 400);
  assert.equal((await resolve(s.cookie, null)).status, 400);
  assert.deepEqual(botCalls, [], "nothing reached the Bot API");
});

// ───────────────────────────── create

test("create: 201, row + ONE bonus_channel.create audit row (after = stored values), default sort at the end, warning when the bot is not admin", { skip }, async () => {
  await resetChannels();
  const s = await session("owner");
  const news = freshChannel({ title: "SlaydX Yangiliklar" });
  const r = await create(s.cookie, { input: `@${news.username}`, joinBonus: 2000, stayBonus: 0, reason: "Yangiliklar kanali" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const item = r.body.item as Item;
  assert.equal(item.chatId, String(news.id));
  assert.equal(item.title, "SlaydX Yangiliklar");
  assert.equal(item.username, news.username);
  assert.deepEqual([item.joinBonus, item.stayBonus, item.stayDays, item.active, item.sort], [2000, 0, 7, true, 1]);
  assert.deepEqual(item.stats, { joined: 0, joinPaidCount: 0, joinPaidSum: 0, stayPaidCount: 0, stayPaidSum: 0, left: 0, stayPending: 0 });
  assert.equal(r.body.botAdmin, "admin");
  assert.equal(r.body.warning, null);

  const a = await audits(s.admin.adminId, "bonus_channel.create");
  assert.equal(a.length, 1);
  assert.equal(a[0]!.outcome, "ok");
  assert.equal(a[0]!.target_type, "bonus_channel");
  assert.equal(a[0]!.target_id, item.id);
  assert.equal(a[0]!.reason, "Yangiliklar kanali");
  assert.equal(a[0]!.before, null);
  assert.deepEqual(a[0]!.after, {
    chatId: String(news.id),
    username: news.username,
    title: "SlaydX Yangiliklar",
    joinBonus: 2000,
    stayBonus: 0,
    stayDays: 7,
    active: true,
    sort: 1,
  });

  // Second channel: bot not an admin → still created, with the warning; title override; sort 2.
  const extra = freshChannel({ botStatus: "member" });
  const r2 = await create(s.cookie, { input: `https://t.me/${extra.username}`, title: "  Hamkor   kanal ", joinBonus: 1000, stayBonus: 2000, stayDays: 7 });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal((r2.body.item as Item).title, "Hamkor kanal");
  assert.equal((r2.body.item as Item).sort, 2);
  assert.equal(r2.body.botAdmin, "not_admin");
  assert.equal(r2.body.warning, "Bot kanalda admin emas — obunani tekshira olmaydi");

  const rows = await channelRows();
  assert.deepEqual(
    rows.map((x) => [x.chat_id, x.title, x.join_bonus, x.stay_bonus, x.stay_days, x.sort]),
    [
      [String(news.id), "SlaydX Yangiliklar", 2000, 0, 7, 1],
      [String(extra.id), "Hamkor kanal", 1000, 2000, 7, 2],
    ],
  );

  // The list returns both in sort order.
  const l = await list(s.cookie);
  assert.equal(l.status, 200);
  assert.deepEqual((l.body.items as Item[]).map((i) => i.chatId), [String(news.id), String(extra.id)]);

  // Duplicate (by link or by id): 409, no second row, no second audit row.
  for (const input of [`@${news.username}`, String(news.id)]) {
    const d = await create(s.cookie, { input, joinBonus: 500 });
    assert.equal(d.status, 409, input);
    assert.equal(d.body.code, "duplicate");
  }
  assert.equal((await channelRows()).length, 2);
  assert.equal((await audits(s.admin.adminId, "bonus_channel.create")).length, 2);

  // The preview now flags the known chat.
  assert.equal((await resolve(s.cookie, `@${news.username}`)).body.existingId, item.id);
});

test("create: validation is 400 before any Bot API call and writes nothing", { skip }, async () => {
  await resetChannels();
  const s = await session("owner");
  const ch = freshChannel();
  const input = `@${ch.username}`;
  const bads: Array<Record<string, unknown>> = [
    {},
    { joinBonus: 1000 },
    { input, joinBonus: -1 },
    { input, joinBonus: 1_000_001 },
    { input, joinBonus: 10.5 },
    { input, joinBonus: "1000" },
    { input, joinBonus: 0, stayBonus: 0 },
    { input, joinBonus: 1000, stayBonus: -5 },
    { input, joinBonus: 1000, stayBonus: 2000, stayDays: 0 },
    { input, joinBonus: 1000, stayBonus: 2000, stayDays: 366 },
    { input, joinBonus: 1000, active: "yes" },
    { input, joinBonus: 1000, sort: 2_000_000 },
    { input, joinBonus: 1000, title: "x".repeat(129) },
    { input, joinBonus: 1000, reason: "abc" },
    { input: "https://t.me/+invite", joinBonus: 1000 },
  ];
  botCalls.length = 0;
  for (const body of bads) {
    const r = await create(s.cookie, body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(r.body)}`);
  }
  assert.deepEqual(botCalls, [], "validation must run before Telegram");
  assert.deepEqual(await channelRows(), []);
  assert.deepEqual(await audits(s.admin.adminId, "bonus_channel.create"), []);

  // Telegram refusals: no row either.
  const user = freshChannel({ type: "private" });
  assert.equal((await create(s.cookie, { input: `@${user.username}`, joinBonus: 1000 })).body.code, "chat_type");
  assert.equal((await create(s.cookie, { input: "@missing_channel", joinBonus: 1000 })).body.code, "chat_not_found");
  assert.deepEqual(await channelRows(), []);
});

// ───────────────────────────── update

async function seedChannel(s: Session, body: Record<string, unknown> = {}): Promise<Item> {
  const ch = freshChannel();
  const r = await create(s.cookie, { input: `@${ch.username}`, joinBonus: 1000, stayBonus: 2000, stayDays: 7, ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.item as Item;
}

test("update: only changed fields go into before/after; no change 409 state; bounds 400; unknown id 404", { skip }, async () => {
  await resetChannels();
  const s = await session("admin");
  const item = await seedChannel(s);

  const r = await patch(s.cookie, item.id, { joinBonus: 1500, stayDays: 7, title: item.title, reason: "Aksiya davomida" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((r.body.item as Item).joinBonus, 1500);
  let a = await audits(s.admin.adminId, "bonus_channel.update");
  assert.equal(a.length, 1);
  assert.deepEqual(a[0]!.before, { joinBonus: 1000 });
  assert.deepEqual(a[0]!.after, { joinBonus: 1500 });
  assert.equal(a[0]!.reason, "Aksiya davomida");
  assert.equal(a[0]!.target_id, item.id);

  const r2 = await patch(s.cookie, item.id, { active: false, sort: 5, title: "Yangi nom", stayBonus: 0 });
  assert.equal(r2.status, 200);
  a = await audits(s.admin.adminId, "bonus_channel.update");
  assert.deepEqual(a[1]!.before, { title: item.title, stayBonus: 2000, active: true, sort: item.sort });
  assert.deepEqual(a[1]!.after, { title: "Yangi nom", stayBonus: 0, active: false, sort: 5 });
  const row = (await channelRows()).find((x) => x.id === item.id)!;
  assert.deepEqual([row.title, row.join_bonus, row.stay_bonus, row.active, row.sort], ["Yangi nom", 1500, 0, false, 5]);

  const same = await patch(s.cookie, item.id, { joinBonus: 1500, active: false });
  assert.equal(same.status, 409);
  assert.equal(same.body.code, "state");

  for (const body of [{}, { joinBonus: -1 }, { stayDays: 400 }, { active: 1 }, { joinBonus: 0 }, { title: "" }, { sort: 1.5 }]) {
    const b = await patch(s.cookie, item.id, body);
    assert.equal(b.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(b.body)}`);
  }
  assert.equal((await audits(s.admin.adminId, "bonus_channel.update")).length, 2, "refusals are not audited");

  const missing = await patch(s.cookie, "900000000000", { joinBonus: 10 });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "not_found");
  assert.equal((await patch(s.cookie, "abc", { joinBonus: 10 })).body.code, "not_found");
});

// ───────────────────────────── claims: stats, delete

async function claim(userId: string, channelId: string, c: { joinPaid?: number; stayPaid?: number | null; left?: boolean } = {}): Promise<void> {
  await query(
    `INSERT INTO bonus_channel_claims (user_id, channel_id, join_paid, stay_paid, left_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, channelId, c.joinPaid ?? 1000, c.stayPaid ?? null, c.left ? new Date() : null],
  );
}

test("stats: joined, join paid count/sum, stay paid count/sum, left, stay pending — per channel", { skip }, async () => {
  await resetChannels();
  const s = await session("owner");
  const a = await seedChannel(s);
  const b = await seedChannel(s, { joinBonus: 2000, stayBonus: 0 });
  const users = await Promise.all(Array.from({ length: 5 }, () => mkUser()));
  await claim(users[0]!.id, a.id, { joinPaid: 1000, stayPaid: 2000 });
  await claim(users[1]!.id, a.id, { joinPaid: 1000, stayPaid: 2000 });
  await claim(users[2]!.id, a.id, { joinPaid: 1000, stayPaid: 0, left: true });
  await claim(users[3]!.id, a.id, { joinPaid: 1000 });
  await claim(users[4]!.id, a.id, { joinPaid: 0 });
  await claim(users[0]!.id, b.id, { joinPaid: 2000 });

  const l = await list(s.cookie);
  const items = l.body.items as Item[];
  assert.deepEqual(items.find((i) => i.id === a.id)!.stats, {
    joined: 5,
    joinPaidCount: 4,
    joinPaidSum: 4000,
    stayPaidCount: 2,
    stayPaidSum: 4000,
    left: 1,
    stayPending: 2,
  });
  assert.deepEqual(items.find((i) => i.id === b.id)!.stats, {
    joined: 1,
    joinPaidCount: 1,
    joinPaidSum: 2000,
    stayPaidCount: 0,
    stayPaidSum: 0,
    left: 0,
    stayPending: 1,
  });
});

test("delete: refused with 409 has_claims while claims exist (row and claims stay, no audit); deactivation works; without claims the row goes with an audit row", { skip }, async () => {
  await resetChannels();
  const s = await session("owner");
  const used = await seedChannel(s);
  const u = await mkUser();
  await claim(u.id, used.id, { joinPaid: 1000 });

  const r = await del(s.cookie, used.id, { reason: "Hamkorlik tugadi" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "has_claims");
  assert.equal(r.body.claims, 1);
  assert.equal((await channelRows()).length, 1);
  assert.equal((await query(`SELECT 1 FROM bonus_channel_claims WHERE channel_id = $1`, [used.id])).length, 1, "the claim survived");
  assert.deepEqual(await audits(s.admin.adminId, "bonus_channel.delete"), []);

  const off = await patch(s.cookie, used.id, { active: false });
  assert.equal(off.status, 200);
  assert.equal((off.body.item as Item).active, false);

  const unused = await seedChannel(s);
  const d = await del(s.cookie, unused.id, {});
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual(d.body, { id: unused.id, deleted: true });
  assert.deepEqual((await channelRows()).map((x) => x.id), [used.id]);
  const a = await audits(s.admin.adminId, "bonus_channel.delete");
  assert.equal(a.length, 1);
  assert.equal(a[0]!.target_id, unused.id);
  assert.equal(a[0]!.after, null);
  assert.deepEqual(
    Object.keys(a[0]!.before as Record<string, unknown>).sort(),
    ["active", "chatId", "joinBonus", "sort", "stayBonus", "stayDays", "title", "username"],
  );

  const again = await del(s.cookie, unused.id, {});
  assert.equal(again.status, 404);
  assert.equal(again.body.code, "not_found");
});

test("atomicity: when the audit insert fails, the channel change rolls back", { skip }, async (t) => {
  await resetChannels();
  const s = await session("owner");
  const item = await seedChannel(s);
  await query(`
    CREATE OR REPLACE FUNCTION k2_fail_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'k2 test: audit write failed'; END $$ LANGUAGE plpgsql`);
  await query(
    `CREATE TRIGGER k2_fail_audit_trg BEFORE INSERT ON admin_audit_log FOR EACH ROW
     WHEN (NEW.action IN ('bonus_channel.update', 'bonus_channel.create', 'bonus_channel.delete')) EXECUTE FUNCTION k2_fail_audit()`,
  );
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  try {
    assert.equal((await patch(s.cookie, item.id, { joinBonus: 777 })).status, 500);
    const ch = freshChannel();
    assert.equal((await create(s.cookie, { input: `@${ch.username}`, joinBonus: 1000 })).status, 500);
    assert.equal((await del(s.cookie, item.id, {})).status, 500);
  } finally {
    await query("DROP TRIGGER k2_fail_audit_trg ON admin_audit_log");
    await query("DROP FUNCTION k2_fail_audit()");
  }
  const rows = await channelRows();
  assert.equal(rows.length, 1, "neither the create nor the delete committed");
  assert.equal(rows[0]!.join_bonus, 1000, "the update rolled back");
});

// ───────────────────────────── bot status

test("bot-status: live re-check per stored channel (admin / not_admin / unknown), 404 for an unknown id", { skip }, async () => {
  await resetChannels();
  const s = await session("viewer");
  const owner = await session("owner");
  const ch = freshChannel();
  const created = await create(owner.cookie, { input: `@${ch.username}`, joinBonus: 2000 });
  const id = (created.body.item as Item).id;

  assert.deepEqual((await botStatus(s.cookie, id)).body, { id, botAdmin: "admin", warning: null });
  BOT_STATUS.set(String(ch.id), "left");
  assert.deepEqual((await botStatus(s.cookie, id)).body, { id, botAdmin: "not_admin", warning: "Bot kanalda admin emas — obunani tekshira olmaydi" });
  telegramDown = { code: 500 };
  try {
    const r = await botStatus(s.cookie, id);
    assert.equal(r.body.botAdmin, "unknown");
    assert.match(String(r.body.warning), /tekshirib bo'lmadi/);
  } finally {
    telegramDown = null;
  }
  const missing = await botStatus(s.cookie, "900000000000");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "not_found");
});

// ───────────────────────────── permissions

test("permissions: viewer/finance read only (403 + one denied audit row per write), support/moderator 403 on reads, stale step-up 401 reauth, no Origin 403, non-admin 404", { skip }, async () => {
  await resetChannels();
  const owner = await session("owner");
  const item = await seedChannel(owner);
  const ch = freshChannel();

  for (const role of ["viewer", "finance"] as const) {
    const s = await session(role);
    assert.equal((await list(s.cookie)).status, 200, `${role} list`);
    const writes = [
      await create(s.cookie, { input: `@${ch.username}`, joinBonus: 1000 }),
      await patch(s.cookie, item.id, { joinBonus: 5 }),
      await del(s.cookie, item.id, {}),
    ];
    for (const w of writes) {
      assert.equal(w.status, 403, `${role}: ${JSON.stringify(w.body)}`);
      assert.equal(w.body.code, "forbidden");
    }
    const denied = await audits(s.admin.adminId, "auth.denied");
    assert.deepEqual(
      denied.map((d) => (d.meta as { permission: string; scope: string }).scope).sort(),
      ["admin/bonus-channels/create", "admin/bonus-channels/delete", "admin/bonus-channels/update"],
    );
    for (const d of denied) assert.equal((d.meta as { permission: string }).permission, "bonus.edit");
  }

  for (const role of ["support", "moderator"] as const) {
    const s = await session(role);
    const r = await list(s.cookie);
    assert.equal(r.status, 403, role);
    assert.equal(r.body.code, "forbidden");
    assert.equal((await resolve(s.cookie, `@${ch.username}`)).status, 403);
    assert.equal((await botStatus(s.cookie, item.id)).status, 403);
  }

  const stale = await session("owner", false);
  const sr = await patch(stale.cookie, item.id, { joinBonus: 5 });
  assert.equal(sr.status, 401);
  assert.equal(sr.body.code, "reauth");
  assert.equal((await list(stale.cookie)).status, 200, "reads need no step-up");

  assert.equal((await create(owner.cookie, { input: `@${ch.username}`, joinBonus: 1000 }, { origin: false })).status, 403);

  const plain = await mkUser();
  assert.equal((await list(`${SESSION_COOKIE}=${plain.userToken}`)).status, 404);
  assert.equal((await list(null)).status, 404);

  // Nothing above changed the channel.
  const row = (await channelRows())[0]!;
  assert.equal(row.join_bonus, 1000);
});
