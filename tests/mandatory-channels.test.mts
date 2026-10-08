import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Mandatory channels (docs/bonus/BONUS3.md C-Q2/C-Q3, package D2): `lib/server/mandatory-channels.ts`
 * (missingMandatory / assertCanCreate / cache), the POST /api/generations gate, GET
 * /api/channels/required, the admin service's `mandatory` field (+ audit), the bot's /start card
 * and «✅ Tekshirish» (`b:m`), and the `chat_member` cache drop. Real Postgres in a throwaway
 * database; the Bot API is stubbed at `fetch`.
 *
 * Mutations (each turned a test red, then restored):
 *   M1. the `assertCanCreate` call removed from POST /api/generations → «gate: non-member 403, nothing charged»;
 *   M2. the gate moved AFTER `enqueueGeneration` (charge first) → same test (balance / charge rows);
 *   M3. `unknown` treated as «not a member» (fail closed) → «Bot API error → fail open»;
 *   M4. POSITIVE_TTL_MS → 0 → «cache: a member is cached 10 min»;
 *   M5. NEGATIVE_TTL_MS → POSITIVE_TTL_MS → «cache: a non-member is cached 1 min»;
 *   M6. `fresh` ignored → «fresh drops cached non-member answers»;
 *   M7. the admin EXISTS removed → «admin account exempt»;
 *   M8. `WHERE active AND mandatory` → `WHERE mandatory` → «inactive / optional channels ignored»;
 *   M9. the `forgetMembership` call removed from the webhook → «chat_member join drops the cache entry».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-mandatory-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
process.env.WORKER_INLINE = "false";
delete process.env.BOT_PREMIUM_EMOJI;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("mand") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const mc = await import("../lib/server/mandatory-channels.ts");
if (!skip) await ensureMigrated();

/* ── Bot API stub ── */
type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
/** getChatMember answer per `user_id`: a status, an error code or "network" (default "left"). */
let member: Record<string, string | number> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
  const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
  assert.ok(m, `unexpected URL ${url}`);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ method: m[1]!, body });
  if (m[1] === "getChatMember") {
    const a = member[String(body.user_id)] ?? "left";
    if (a === "network") throw new TypeError("fetch failed");
    if (typeof a === "number") return new Response(JSON.stringify({ ok: false, error_code: a, description: "Bad Request: member list is inaccessible" }));
    return new Response(JSON.stringify({ ok: true, result: { status: a } }));
  }
  if (m[1] === "getMe") return new Response(JSON.stringify({ ok: true, result: { id: 123456, username: "slaydx_test_bot" } }));
  return new Response(JSON.stringify({ ok: true, result: m[1] === "sendMessage" ? { message_id: 1 } : true }));
}) as typeof fetch;
const memberCalls = () => calls.filter((c) => c.method === "getChatMember").length;

/* ── Fixtures (synthetic ids) ── */
async function tgUser(balance = 100_000): Promise<{ id: string; tg: number }> {
  const tg = 7_700_000_000 + randomInt(0, 99_999_999);
  const r = await queryOne<{ id: string }>(
    "INSERT INTO users (telegram_id, name, points, quota, balance) VALUES ($1, 'Kanal Test', 0, 0, $2) RETURNING id::text AS id",
    [tg, balance],
  );
  return { id: r!.id, tg };
}
async function phoneUser(): Promise<string> {
  const r = await queryOne<{ id: string }>(
    "INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Telefon', 0, 0, 100000) RETURNING id::text AS id",
    [`ph-${Date.now()}-${randomInt(0, 1e9)}`],
  );
  return r!.id;
}
let chatSeq = -1_002_000_000_000 - randomInt(0, 999_999);
async function channel(o: { mandatory?: boolean; active?: boolean; title?: string; username?: string | null; invite?: string | null; join?: number } = {}) {
  const chat = chatSeq--;
  const r = await queryOne<{ id: string }>(
    `INSERT INTO bonus_channels (chat_id, username, title, join_bonus, stay_bonus, active, mandatory, invite_link)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7) RETURNING id::text AS id`,
    [chat, o.username === undefined ? "slaydx_majburiy" : o.username, o.title ?? "Majburiy kanal", o.join ?? 0, o.active ?? true, o.mandatory ?? true, o.invite ?? null],
  );
  return { id: r!.id, chat };
}
/** The brief's TTLs, as literals: a test that read the module's constants would follow a mutation. */
const POS_MS = 10 * 60_000;
const NEG_MS = 60_000;

/** Every test starts with no channels at all and an empty cache. */
async function reset(): Promise<void> {
  await query("DELETE FROM bonus_channel_claims");
  await query("DELETE FROM bonus_channels");
  mc.resetMandatoryCache();
  member = {};
  calls = [];
}

after(async () => {
  globalThis.fetch = realFetch;
  if (skip) return;
  await pool().end();
  await iso.drop();
});

/* ───────────────────────── service ───────────────────────── */

test("no mandatory channel → nothing to check; inactive / optional channels ignored", { skip }, async () => {
  await reset();
  const u = await tgUser();
  assert.deepEqual(await mc.missingMandatory(u.id), { exempt: false, needsTelegram: false, channels: [] });
  await channel({ mandatory: false });
  await channel({ active: false });
  const r = await mc.missingMandatory(u.id);
  assert.deepEqual(r.channels, [], "an optional and an inactive mandatory channel never block");
  assert.equal(memberCalls(), 0, "no Bot API call without an active mandatory channel");
  assert.ok(mc.canCreate(r));
  await assert.doesNotReject(mc.assertCanCreate(u.id));
});

test("member → allowed; non-member → the missing channels (title, join url); private channel uses its invite link", { skip }, async () => {
  await reset();
  const a = await channel({ title: "Ochiq", username: "ochiq_kanal" });
  const b = await channel({ title: "Yopiq", username: null, invite: "https://t.me/+AbCdEf123456" });
  const u = await tgUser();
  member[u.tg] = "member";
  assert.ok(mc.canCreate(await mc.missingMandatory(u.id)));
  const v = await tgUser();
  member[v.tg] = "left";
  const r = await mc.missingMandatory(v.id);
  assert.deepEqual(r, {
    exempt: false,
    needsTelegram: false,
    channels: [
      { id: a.id, title: "Ochiq", joinUrl: "https://t.me/ochiq_kanal" },
      { id: b.id, title: "Yopiq", joinUrl: "https://t.me/+AbCdEf123456" },
    ],
  });
  await assert.rejects(mc.assertCanCreate(v.id), (e: { status: number; extra: { code: string; channels: unknown[] }; message: string }) => {
    assert.equal(e.status, 403);
    assert.equal(e.extra.code, "channel_required");
    assert.equal(e.extra.channels.length, 2);
    assert.equal(e.message, "Avval kanalga obuna bo‘ling");
    return true;
  });
});

test("Bot API error → fail open (not blocking, not cached)", { skip }, async () => {
  await reset();
  await channel();
  const u = await tgUser();
  const warns: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => void warns.push(a.map(String).join(" "));
  try {
    member[u.tg] = 400; // the bot is not an admin of the channel
    assert.ok(mc.canCreate(await mc.missingMandatory(u.id)), "a Telegram refusal never blocks");
    member[u.tg] = "network";
    assert.ok(mc.canCreate(await mc.missingMandatory(u.id)), "no answer never blocks");
  } finally {
    console.warn = realWarn;
  }
  assert.equal(memberCalls(), 2, "`unknown` is not cached: the next check asks again");
  assert.equal(warns.filter((w) => w.includes("fail open")).length, 1, "logged once per channel");
  member[u.tg] = "left";
  assert.equal((await mc.missingMandatory(u.id)).channels.length, 1, "once Telegram answers, the gate applies");
});

test("no Telegram on the account → needsTelegram (with the channels); 403 telegram_required", { skip }, async () => {
  await reset();
  const ch = await channel();
  const id = await phoneUser();
  const r = await mc.missingMandatory(id);
  assert.equal(r.needsTelegram, true);
  assert.deepEqual(r.channels.map((c) => c.id), [ch.id]);
  assert.equal(memberCalls(), 0);
  await assert.rejects(mc.assertCanCreate(id), (e: { status: number; extra: { code: string } }) => e.status === 403 && e.extra.code === "telegram_required");
});

test("admin account exempt (active / pending), a disabled admin is not", { skip }, async () => {
  await reset();
  await channel();
  const u = await tgUser();
  member[u.tg] = "left";
  const acc = await queryOne<{ id: string }>("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'viewer', 'active') RETURNING id::text AS id", [u.id]);
  assert.deepEqual(await mc.missingMandatory(u.id), { exempt: true, needsTelegram: false, channels: [] });
  assert.equal(memberCalls(), 0, "an exempt admin costs no Bot API call");
  await query("UPDATE admin_accounts SET status = 'pending' WHERE id = $1", [acc!.id]);
  assert.equal((await mc.missingMandatory(u.id)).exempt, true);
  await query("UPDATE admin_accounts SET status = 'disabled' WHERE id = $1", [acc!.id]);
  assert.equal((await mc.missingMandatory(u.id)).channels.length, 1, "a disabled admin is an ordinary user");
  // A phone-login admin is exempt too (they test from the web).
  const p = await phoneUser();
  await query("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'owner', 'active')", [p]);
  assert.ok(mc.canCreate(await mc.missingMandatory(p)));
});

test("cache: a member is cached 10 min, a non-member 1 min; fresh drops cached non-member answers", { skip }, async () => {
  await reset();
  await channel();
  const u = await tgUser();
  let now = 1_000_000;
  const deps = { now: () => now };
  member[u.tg] = "member";
  assert.ok(mc.canCreate(await mc.missingMandatory(u.id, deps)));
  member[u.tg] = "left";
  now += POS_MS - 1;
  assert.ok(mc.canCreate(await mc.missingMandatory(u.id, deps)), "still the cached member answer");
  assert.equal(memberCalls(), 1);
  now += 2;
  assert.equal((await mc.missingMandatory(u.id, deps)).channels.length, 1, "after 10 min Telegram is asked again");
  assert.equal(memberCalls(), 2);

  member[u.tg] = "member";
  now += NEG_MS - 1;
  assert.equal((await mc.missingMandatory(u.id, deps)).channels.length, 1, "the non-member answer is cached for 1 min");
  assert.equal(memberCalls(), 2);
  assert.ok(mc.canCreate(await mc.missingMandatory(u.id, { ...deps, fresh: true })), "«Tekshirish» asks again at once");
  assert.equal(memberCalls(), 3);
  assert.ok(mc.canCreate(await mc.missingMandatory(u.id, { ...deps, fresh: true })), "fresh keeps a cached member answer");
  assert.equal(memberCalls(), 3);

  // A non-member answer expires after 1 min (not 10): the join is seen without «Tekshirish».
  mc.resetMandatoryCache();
  member[u.tg] = "left";
  assert.equal((await mc.missingMandatory(u.id, deps)).channels.length, 1);
  member[u.tg] = "member";
  now += NEG_MS + 1;
  assert.ok(mc.canCreate(await mc.missingMandatory(u.id, deps)), "after 1 min Telegram is asked again");
  assert.equal(memberCalls(), 5);

  member[u.tg] = "left";
  now += NEG_MS + 1;
  mc.forgetMembership(u.tg, (await queryOne<{ c: string }>("SELECT chat_id::text AS c FROM bonus_channels"))!.c);
  assert.equal((await mc.missingMandatory(u.id, deps)).channels.length, 1, "forgetMembership drops even a fresh member entry");
  assert.equal(memberCalls(), 6);
});

test("chat_member join (webhook) drops the cache entry", { skip }, async () => {
  await reset();
  const ch = await channel();
  const u = await tgUser();
  member[u.tg] = "left";
  assert.equal((await mc.missingMandatory(u.id)).channels.length, 1);
  member[u.tg] = "member";
  const { handleUpdate } = await import("../lib/server/telegram.ts");
  await handleUpdate({
    update_id: 910_000_000 + randomInt(0, 9_999_999),
    chat_member: {
      chat: { id: ch.chat, type: "channel", title: "Majburiy kanal" },
      from: { id: u.tg },
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { status: "left", user: { id: u.tg } },
      new_chat_member: { status: "member", user: { id: u.tg } },
    },
  });
  assert.ok(mc.canCreate(await mc.missingMandatory(u.id)), "the cached «not a member» answer is gone at once");
});

/* ───────────────────────── POST /api/generations gate + GET /api/channels/required ───────────────────────── */

test("gate: non-member 403 channel_required, nothing charged or queued; member / admin 202; telegram_required", { skip }, async () => {
  await reset();
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  const required = await import("../app/api/channels/required/route.ts");
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 10, totalSlots: 8, meanServiceSec: 200, maxWaitSec: 100_000 });
  const ch = await channel({ title: "Majburiy <b>", username: "majburiy_kanal" });
  const cookieOf = async (uid: string) => `${SESSION_COOKIE}=${(await createSession(uid)).token}`;
  const ESSAY = { slug: "essay", values: { topic: "Suv aylanishi", essayContext: "academic", essayKind: "argumentative" } };
  const post = async (cookie: string) => {
    const req = new Request("http://localhost/api/generations", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(ESSAY) });
    const res = await inRequest(req, () => route.POST(req));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const get = async (cookie: string, fresh = false) => {
    const req = new Request(`http://localhost/api/channels/required${fresh ? "?fresh=1" : ""}`, { headers: { cookie } });
    const res = await inRequest(req, () => required.GET(req));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const state = async (uid: string) =>
    (await queryOne<{ balance: number; jobs: number; charges: number }>(
      `SELECT u.balance::int AS balance,
              (SELECT count(*)::int FROM generations g WHERE g.user_id = u.id) AS jobs,
              (SELECT count(*)::int FROM transactions t WHERE t.user_id = u.id AND t.kind = 'charge') AS charges
         FROM users u WHERE u.id = $1`,
      [uid],
    ))!;

  const u = await tgUser();
  member[u.tg] = "left";
  const cu = await cookieOf(u.id);
  const blocked = await post(cu);
  assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, "channel_required");
  assert.deepEqual(blocked.body.channels, [{ id: ch.id, title: "Majburiy <b>", joinUrl: "https://t.me/majburiy_kanal" }]);
  assert.deepEqual(await state(u.id), { balance: 100_000, jobs: 0, charges: 0 }, "never charged before the gate");

  const g1 = await get(cu);
  assert.equal(g1.status, 200);
  assert.deepEqual(g1.body, { ok: false, needsTelegram: false, channels: [{ id: ch.id, title: "Majburiy <b>", joinUrl: "https://t.me/majburiy_kanal" }] });
  member[u.tg] = "member";
  assert.equal((await get(cu)).body.ok, false, "the 1-minute «not a member» answer still holds");
  assert.deepEqual((await get(cu, true)).body, { ok: true, needsTelegram: false, channels: [] }, "«Tekshirish» (fresh) sees the join");
  const ok = await post(cu);
  assert.equal(ok.status, 202, JSON.stringify(ok.body));
  assert.equal((await state(u.id)).charges, 1);

  const p = await phoneUser();
  const cp = await cookieOf(p);
  const tgReq = await post(cp);
  assert.equal(tgReq.status, 403);
  assert.equal(tgReq.body.code, "telegram_required");
  assert.deepEqual((await state(p)), { balance: 100_000, jobs: 0, charges: 0 });
  assert.equal((await get(cp)).body.needsTelegram, true);

  const admin = await tgUser();
  member[admin.tg] = "left";
  await query("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'admin', 'active')", [admin.id]);
  assert.equal((await post(await cookieOf(admin.id))).status, 202, "an admin account is exempt (they must be able to test)");

  // Deactivating the channel lifts the gate at once.
  await query("UPDATE bonus_channels SET active = false WHERE id = $1", [ch.id]);
  const v = await tgUser();
  assert.equal((await post(await cookieOf(v.id))).status, 202);
});

/* ───────────────────────── admin service: mandatory toggle + audit ───────────────────────── */

test("admin: create mandatory (bonus optional) / toggle — audited before/after; an optional channel still needs a bonus", { skip }, async () => {
  await reset();
  const svc = await import("../lib/server/admin-bonus-channels.ts");
  const owner = await tgUser();
  const acc = await queryOne<{ id: string }>("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'owner', 'active') RETURNING id::text AS id", [owner.id]);
  const actor = { id: acc!.id, userId: owner.id, role: "owner" };
  const chat = chatSeq--;
  // getChat → a channel; getChatMember(bot) → administrator.
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const method = /\/(\w+)$/.exec(String(url))![1];
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (method === "getChat") return new Response(JSON.stringify({ ok: true, result: { id: Number(body.chat_id), type: "channel", title: "Rasmiy kanal" } }));
    if (method === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: "administrator" } }));
    return new Response(JSON.stringify({ ok: true, result: true }));
  }) as typeof fetch;
  try {
    await assert.rejects(svc.createBonusChannel(actor, { input: String(chat), joinBonus: 0, stayBonus: 0 }), /Kamida bitta bonus/);
    await assert.rejects(svc.createBonusChannel(actor, { input: String(chat), joinBonus: 0, mandatory: "yes" }), /Majburiylik/);
    const r = await svc.createBonusChannel(actor, { input: String(chat), joinBonus: 0, stayBonus: 0, mandatory: true });
    assert.equal(r.item.mandatory, true);
    assert.equal(r.item.joinBonus, 0);
    const created = await queryOne<{ after: Record<string, unknown> }>(
      "SELECT after FROM admin_audit_log WHERE action = 'bonus_channel.create' AND target_id = $1",
      [r.item.id],
    );
    assert.equal(created?.after.mandatory, true, "create audit carries mandatory");
    const off = await svc.updateBonusChannel(actor, r.item.id, { mandatory: false, joinBonus: 2000 });
    assert.equal(off.item.mandatory, false);
    const upd = await queryOne<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
      "SELECT before, after FROM admin_audit_log WHERE action = 'bonus_channel.update' AND target_id = $1 ORDER BY id DESC LIMIT 1",
      [r.item.id],
    );
    assert.deepEqual(upd, { before: { mandatory: true, joinBonus: 0 }, after: { mandatory: false, joinBonus: 2000 } });
    // Optional with no bonus left → refused, nothing written.
    await assert.rejects(svc.updateBonusChannel(actor, r.item.id, { joinBonus: 0 }), /Kamida bitta bonus/);
    assert.equal((await svc.listBonusChannels()).items.find((i) => i.id === r.item.id)?.mandatory, false);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

/* ───────────────────────── bot: /start card, «✅ Tekshirish», «Bonuslar» ───────────────────────── */

test("bot: /start adds the mandatory card; «✅ Tekshirish» re-checks; «Bonuslar» lists mandatory first", { skip }, async () => {
  await reset();
  const opt = await channel({ mandatory: false, title: "Ixtiyoriy", username: "ixtiyoriy_kanal", join: 1000 });
  const man = await channel({ title: "Rasmiy", username: "rasmiy_kanal", join: 2000 });
  const tg = 7_800_000_000 + randomInt(0, 99_999_999);
  member[tg] = "left";
  const { handleUpdate } = await import("../lib/server/telegram.ts");
  await handleUpdate({
    update_id: 920_000_000 + randomInt(0, 9_999_999),
    message: { message_id: 5, from: { id: tg, first_name: "Ali" }, chat: { id: tg, type: "private" }, date: Math.floor(Date.now() / 1000), text: "/start" },
  } as never);
  const sends = calls.filter((c) => c.method === "sendMessage");
  const card = sends.find((c) => String(c.body.text).includes("Botdan to‘liq foydalanish uchun kanalga obuna bo‘ling"));
  assert.ok(card, `the mandatory card was sent: ${sends.map((s) => String(s.body.text).slice(0, 40)).join(" | ")}`);
  const kb = (card.body.reply_markup as { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] }).inline_keyboard;
  assert.deepEqual(kb.map((r) => r[0]!.url ?? r[0]!.callback_data), ["https://t.me/rasmiy_kanal", "b:m"], "only the mandatory channel, then «Tekshirish»");

  const user = await queryOne<{ id: string }>("SELECT id::text AS id FROM users WHERE telegram_id = $1", [tg]);
  const { handleCallback } = await import("../lib/server/bot/router.ts");
  const tap = async () => {
    calls = [];
    await handleCallback({ id: "q1", from: { id: tg }, message: { message_id: 9, chat: { id: tg, type: "private" } }, data: "b:m" }, 930_000_000 + randomInt(0, 9_999_999));
    return {
      toast: String(calls.find((c) => c.method === "answerCallbackQuery")?.body.text ?? ""),
      edit: calls.find((c) => c.method === "editMessageText")?.body,
    };
  };
  const still = await tap();
  assert.match(still.toast, /Hali hamma kanalga obuna bo‘lmagansiz/);
  member[tg] = "member";
  const done = await tap();
  assert.match(done.toast, /Rahmat/);
  assert.match(String(done.edit?.text), /Rahmat! Endi botdan to‘liq foydalanishingiz mumkin/);

  // «🎁 Bonuslar»: the mandatory channel comes first even though the optional one sorts first.
  const { bonusTasks } = await import("../lib/server/bonus-channels.ts");
  const tasks = await bonusTasks(user!.id, { botUsername: "slaydx_test_bot", appUrl: "https://slaydx.test" });
  assert.deepEqual(tasks.channels.map((c) => [c.id, c.mandatory]), [[man.id, true], [opt.id, false]]);

  // A member gets no card on /start.
  calls = [];
  await handleUpdate({
    update_id: 940_000_000 + randomInt(0, 9_999_999),
    message: { message_id: 6, from: { id: tg, first_name: "Ali" }, chat: { id: tg, type: "private" }, date: Math.floor(Date.now() / 1000), text: "/start" },
  } as never);
  assert.ok(!calls.some((c) => c.method === "sendMessage" && String(c.body.text).includes("kanalga obuna bo‘ling")));
});
