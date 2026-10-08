import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";

/**
 * Referral entry points in the bot (T3) — `lib/server/telegram.ts`:
 *   - `/start ref_<code>` registers the person (the creating message is the
 *     moment of reward) and then answers the ordinary welcome + login buttons;
 *   - `/start <nonce>` of a SITE ticket that carries a captured web code
 *     applies it (source web) — the bot, not the site, creates the account;
 *     the login flow itself is untouched;
 *   - `redeemLoginToken` passes the ticket's code too (fallback when the bot
 *     did not create the account);
 *   - `/taklif` answers the user's own link + counters + a t.me/share button;
 *   - `setBotCommands` lists `/taklif`.
 * Real Postgres; `fetch` stubbed with a fake token — nothing reaches Telegram.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `startReferral` ignores `ref_` payloads → «/start ref_<code> … rewarded»;
 *   2. ticket code not looked up for `/start <nonce>` → «site ticket with a captured code»;
 *   3. `createTicket` drops `ref_code` → same test;
 *   4. `/taklif` branch removed → «/taklif → own link»;
 *   5. `taklif` missing from setMyCommands → «setBotCommands lists /taklif».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-referral-bot-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const tg = await import("../lib/server/telegram.ts");
const { upsertTelegramUser, SIGNUP_BONUS_POINTS } = await import("../lib/server/auth.ts");
const { ensureRefCode } = await import("../lib/server/referrals.ts");
if (hasDb) await ensureMigrated();

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
function installFetch(): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected URL ${url}`);
    calls.push({ method: m[1]!, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ ok: true, result: m[1] === "sendMessage" ? { message_id: 1 } : true }));
  }) as typeof fetch;
}

let seq = Date.now() * 1000 + 700_000;
const fromIds: string[] = [];
function newFromId(): number {
  const id = 7_300_000_000 + randomInt(0, 99_999_999);
  fromIds.push(String(id));
  return id;
}
function update(fromId: number, text: string, chatType = "private") {
  const chatId = chatType === "private" ? fromId : -1001234567;
  return { update_id: ++seq, message: { chat: { id: chatId, type: chatType }, from: { id: fromId, first_name: "Do'st", last_name: "Botdan" }, text } };
}

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await query("DELETE FROM referrals WHERE referee_telegram_id::text = ANY($1)", [fromIds]);
  await query("DELETE FROM users WHERE telegram_id::text = ANY($1)", [fromIds]);
  await pool().end();
});

async function inviter() {
  const id = newFromId();
  const u = await upsertTelegramUser({ telegramId: String(id), username: null, name: "Taklifchi", photoUrl: null });
  return { id: u.id, code: await ensureRefCode(u.id) };
}
const userByTg = (id: number) => queryOne<{ id: string; points: string }>("SELECT id::text AS id, points FROM users WHERE telegram_id = $1", [String(id)]);
const pointsOf = async (id: string) => Number((await queryOne<{ points: string }>("SELECT points FROM users WHERE id = $1", [id]))!.points);
const referralOf = (refereeId: string) =>
  query<{ referrer_user_id: string; source: string; reward_points: number }>(
    "SELECT referrer_user_id::text AS referrer_user_id, source, reward_points FROM referrals WHERE referee_user_id = $1",
    [refereeId],
  );
function buttons(body: Record<string, unknown>): { text: string; url?: string; web_app?: { url: string } }[] {
  return ((body.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
}

test("/start ref_<code> from a brand-new person → registered, inviter rewarded (source bot), normal welcome + login buttons", { skip }, async () => {
  const inv = await inviter();
  const before = await pointsOf(inv.id);
  const from = newFromId();
  installFetch();
  await tg.handleUpdate(update(from, `/start ref_${inv.code}`));
  const me = await userByTg(from);
  assert.ok(me, "the message created the account");
  assert.equal(Number(me.points), SIGNUP_BONUS_POINTS);
  assert.equal((await pointsOf(inv.id)) - before, 2000, "MUTATSIYA 1");
  assert.deepEqual(await referralOf(me.id), [{ referrer_user_id: inv.id, source: "bot", reward_points: 2000 }]);
  assert.equal(calls.length, 2, "B2: welcome card + main keyboard");
  assert.match(String(calls[0]!.body.text), /Assalomu alaykum/);
  const b = buttons(calls[0]!.body);
  assert.ok(b.some((x) => x.web_app?.url === "https://slaydx.test/uz"), "Mini App button");
  assert.ok(b.some((x) => /^https:\/\/slaydx\.test\/api\/auth\/telegram\/enter\?t=/.test(x.url ?? "")), "one-time login link");

  // The same person: deletes the bot, comes back through the same link (and through another one).
  const other = await inviter();
  const [p1, p2] = [await pointsOf(inv.id), await pointsOf(other.id)];
  installFetch();
  await tg.handleUpdate(update(from, `/start ref_${inv.code}`));
  await tg.handleUpdate(update(from, `/start ref_${other.code}`));
  assert.equal(await pointsOf(inv.id), p1, "never twice");
  assert.equal(await pointsOf(other.id), p2);
  assert.equal((await referralOf(me.id)).length, 1);
  assert.equal(calls.length, 4, "still a welcome (+ keyboard) each time");
  for (const c of [calls[0]!, calls[2]!]) assert.match(String(c.body.text), /Assalomu alaykum/);
});

test("someone who first came through the site (existing account) opens a bot ref link → nothing", { skip }, async () => {
  const inv = await inviter();
  const before = await pointsOf(inv.id);
  const from = newFromId();
  const existing = await upsertTelegramUser({ telegramId: String(from), username: null, name: "Saytdan", photoUrl: null });
  installFetch();
  await tg.handleUpdate(update(from, `/start ref_${inv.code}`));
  assert.equal(await pointsOf(inv.id), before);
  assert.equal((await referralOf(existing.id)).length, 0);
  assert.equal((await userByTg(from))!.id, existing.id, "one shared base: the same row");
});

test("malformed ref_ payload → welcome, the account is created, no referral", { skip }, async () => {
  const from = newFromId();
  installFetch();
  await tg.handleUpdate(update(from, "/start ref_!!notacode"));
  const me = await userByTg(from);
  assert.ok(me);
  assert.equal((await referralOf(me.id)).length, 0);
  assert.match(String(calls[0]!.body.text), /Assalomu alaykum/);
});

test("site ticket with a captured code: /start <nonce> creates the account with the referral (source web); login flow unchanged", { skip }, async () => {
  const inv = await inviter();
  const before = await pointsOf(inv.id);
  const ticket = await tg.createTicket("slaydx_test_bot", inv.code);
  const stored = await queryOne<{ ref_code: string | null }>("SELECT ref_code FROM login_tickets WHERE nonce = $1", [ticket.nonce]);
  assert.equal(stored!.ref_code, inv.code, "MUTATSIYA 3: the ticket carries the code");
  const from = newFromId();
  installFetch();
  await tg.handleUpdate(update(from, `/start ${ticket.nonce}`));
  const me = await userByTg(from);
  assert.ok(me);
  assert.equal((await pointsOf(inv.id)) - before, 2000, "MUTATSIYA 2");
  assert.deepEqual(await referralOf(me.id), [{ referrer_user_id: inv.id, source: "web", reward_points: 2000 }]);
  // The login flow: the «🔑 Saytga kirish» one-time link, as before.
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.body.text), /Kirish uchun quyidagi tugmani bosing/);
  const link = buttons(calls[0]!.body).find((x) => x.text === "🔑 Saytga kirish")?.url;
  assert.ok(link);
  const r = await tg.redeemLoginToken(new URL(link).searchParams.get("t")!);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.user.id, me.id);
  assert.equal(await pointsOf(inv.id) - before, 2000, "redeeming the ticket does not reward again");
});

test("ticket without a code → no referral; a code-less /start <nonce> for an existing person is unchanged", { skip }, async () => {
  const ticket = await tg.createTicket("slaydx_test_bot");
  const from = newFromId();
  installFetch();
  await tg.handleUpdate(update(from, `/start ${ticket.nonce}`));
  const me = await userByTg(from);
  assert.ok(me);
  assert.equal((await referralOf(me.id)).length, 0);
  assert.match(String(calls[0]!.body.text), /Kirish uchun quyidagi tugmani bosing/);
});

test("redeemLoginToken applies the ticket's code when the account does not exist yet (bot did not create it)", { skip }, async () => {
  const inv = await inviter();
  const before = await pointsOf(inv.id);
  const ticket = await tg.createTicket("slaydx_test_bot", inv.code);
  const from = newFromId();
  const link = await tg.attachTicket(ticket.nonce, { telegramId: String(from), username: null, name: "Chiptadan", photoUrl: null });
  assert.ok(link);
  const r = await tg.redeemLoginToken(new URL(link).searchParams.get("t")!);
  assert.equal(r.ok, true);
  const me = await userByTg(from);
  assert.deepEqual(await referralOf(me!.id), [{ referrer_user_id: inv.id, source: "web", reward_points: 2000 }]);
  assert.equal((await pointsOf(inv.id)) - before, 2000);
});

test("/taklif → the user's own bot link, counters and a t.me/share button; in a group → instruction only, nobody registered", { skip }, async () => {
  const inv = await inviter();
  const invTg = Number((await queryOne<{ t: string }>("SELECT telegram_id::text AS t FROM users WHERE id = $1", [inv.id]))!.t);
  installFetch();
  await tg.handleUpdate(update(newFromId(), `/start ref_${inv.code}`));
  installFetch();
  await tg.handleUpdate(update(invTg, "/taklif"));
  assert.equal(calls.length, 1, "MUTATSIYA 4");
  const text = String(calls[0]!.body.text);
  const link = `https://t.me/slaydx_test_bot?start=ref_${inv.code}`;
  assert.ok(text.includes(link), text);
  assert.match(text, /Har bir yangi do'st uchun 2\s000 ball/);
  assert.match(text, /Taklif qilinganlar: <b>1<\/b> · Ishlangan ball: <b>2\s000<\/b>/);
  const share = buttons(calls[0]!.body).find((x) => x.url?.startsWith("https://t.me/share/url?"));
  assert.ok(share, "share button");
  assert.equal(new URL(share.url!).searchParams.get("url"), link);

  const stranger = newFromId();
  installFetch();
  await tg.handleUpdate(update(stranger, "/taklif", "supergroup"));
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.body.text), /shaxsiy chatda \/taklif/);
  assert.equal(await userByTg(stranger), null, "a group message registers nobody");
});

test("setBotCommands lists /taklif with an Uzbek description", { skip }, async () => {
  installFetch();
  assert.equal(await tg.setBotCommands(), true);
  const cmds = calls[0]!.body.commands as { command: string; description: string }[];
  // B2: + /til; the default (Uzbek) list first, then the ru/en scopes.
  assert.deepEqual(cmds.map((c) => c.command), ["start", "login", "taklif", "admin", "til"], "MUTATSIYA 5");
  assert.equal(cmds.find((c) => c.command === "taklif")!.description, "Do'stlarni taklif qilish havolasi");
  assert.equal(calls[0]!.body.language_code, undefined);
  assert.deepEqual(calls.slice(1).map((c) => c.body.language_code), ["ru", "en"]);
  const ru = calls[1]!.body.commands as { command: string; description: string }[];
  assert.equal(ru.find((c) => c.command === "til")!.description, "Сменить язык бота");
});

test("botUsername: the configured NEXT_PUBLIC_TELEGRAM_BOT, no getMe call", async () => {
  installFetch();
  assert.equal(await tg.botUsername(), "slaydx_test_bot");
  assert.equal(calls.length, 0);
});

test("review MINOR-5: botUsername without the env — a failed getMe is cached 60 s, a success for good, concurrent callers share one call", async () => {
  const env = (await import("../lib/server/env.ts")).env as unknown as { telegramBotUsername: string };
  const prev = env.telegramBotUsername;
  env.telegramBotUsername = "";
  let getMeCalls = 0;
  let answer: unknown = { ok: false, error_code: 502, description: "Bad Gateway" };
  globalThis.fetch = (async (url: string | URL) => {
    assert.match(String(url), /\/getMe$/);
    getMeCalls++;
    return new Response(JSON.stringify(answer));
  }) as typeof fetch;
  try {
    const t0 = 1_900_000_000_000;
    const first = await Promise.all([tg.botUsername(t0), tg.botUsername(t0), tg.botUsername(t0)]);
    assert.deepEqual(first, [null, null, null]);
    assert.equal(getMeCalls, 1, "concurrent callers share one getMe");
    assert.equal(await tg.botUsername(t0 + 59_000), null);
    assert.equal(getMeCalls, 1, "MUTATSIYA 6: a failure is not retried on every request");
    answer = { ok: true, result: { id: 1, username: "found_bot" } };
    assert.equal(await tg.botUsername(t0 + 61_000), "found_bot", "retried after a minute");
    assert.equal(getMeCalls, 2);
    assert.equal(await tg.botUsername(t0 + 10 * 86_400_000), "found_bot");
    assert.equal(getMeCalls, 2, "a success is kept");
  } finally {
    env.telegramBotUsername = prev;
  }
});
