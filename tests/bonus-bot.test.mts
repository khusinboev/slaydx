import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";

/**
 * «Sizning bonuslaringiz» in the bot end to end (docs/bonus/PLAN.md, Bonus 2:
 * B2-Q2..Q4): updates go through `handleUpdate` with the Bot API stubbed at
 * `fetch` — Hamyon → «🎁 Bonuslar» (edit one message), «🔄 Yangilash» re-checks
 * the channels not joined yet and pays once, a green task only toasts, a
 * `chat_member` join pays automatically (+ one notice) and races «Yangilash»
 * safely; replayed / forged / foreign / blocked callbacks pay nothing. Real
 * Postgres (test DB only); synthetic ids.
 *
 * Mutations (each turned a test red, then restored):
 *   1. router `bonusRefresh` case removed → «Yangilash pays once»;
 *   2. `handleCallback` without the `from.id === chat.id` check → «someone else's button»;
 *   3. `handleCallback` without the blocked check AND `checkChannel` without its blocked checks → «blocked user»;
 *   4. the per-user refresh rate limit removed → «Yangilash is rate limited»;
 *   5. `processUpdate` without the `isJoinStatus` branch → «a chat_member join pays automatically».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-bonus-bot-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
delete process.env.BOT_PREMIUM_EMOJI;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const tg = await import("../lib/server/telegram.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
if (hasDb) await ensureMigrated();

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let member: Record<string, string> = {};
const realFetch = globalThis.fetch;
function installFetch(): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected URL ${url}`);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method: m[1]!, body });
    if (m[1] === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: member[String(body.user_id)] ?? "left" } }));
    return new Response(JSON.stringify({ ok: true, result: m[1] === "sendMessage" ? { message_id: 1 } : true }));
  }) as typeof fetch;
}

let seq = Date.now() * 1000 + 900_000;
const tgIds: string[] = [];
const channelIds: string[] = [];
const chatIds: string[] = [];
async function newUser(): Promise<{ id: string; tg: number }> {
  const tgId = 7_700_000_000 + randomInt(0, 99_999_999);
  tgIds.push(String(tgId));
  const u = await upsertTelegramUser({ telegramId: String(tgId), username: null, name: "Bonus Bot", photoUrl: null });
  return { id: u.id, tg: tgId };
}
/** A channel listed first (sort far below anything else); the previous tests' channels are switched off. */
async function newChannel(title = "SlaydX yangiliklari", join = 1000, stay = 2000, username: string | null = "slaydx_news"): Promise<{ id: string; chat: number }> {
  const chat = -1_002_000_000_000 - randomInt(0, 999_999_999);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO bonus_channels (chat_id, username, title, join_bonus, stay_bonus, stay_days, sort)
     VALUES ($1, $2, $3, $4, $5, 7, -1000000) RETURNING id::text AS id`,
    [chat, username, title, join, stay],
  );
  channelIds.push(row!.id);
  chatIds.push(String(chat));
  return { id: row!.id, chat };
}
async function freshChannels(): Promise<void> {
  await query("UPDATE bonus_channels SET active = false WHERE id::text = ANY($1)", [channelIds]);
}
const textUpdate = (from: number, text: string) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Bot" }, text },
});
const cbUpdate = (from: number, data: string, messageId = 555, chatId = from) => ({
  update_id: ++seq,
  callback_query: { id: `cq${++seq}`, from: { id: from }, message: { message_id: messageId, chat: { id: chatId, type: "private" } }, data },
});
const joinUpdate = (chat: number, from: number, status = "member") => ({
  update_id: ++seq,
  chat_member: {
    chat: { id: chat, type: "channel", title: "Kanal" },
    from: { id: from },
    date: Math.floor(Date.now() / 1000),
    old_chat_member: { status: "left", user: { id: from } },
    new_chat_member: { status, user: { id: from } },
  },
});
const edits = () => calls.filter((c) => c.method === "editMessageText");
const sends = () => calls.filter((c) => c.method === "sendMessage");
const toasts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text as string | undefined);
/** getChatMember calls for THIS file's channels (another file may have active channels in the shared test DB). */
const memberCalls = () => calls.filter((c) => c.method === "getChatMember" && chatIds.includes(String(c.body.chat_id)));
const points = async (id: string) => Number((await queryOne<{ p: number }>("SELECT points AS p FROM users WHERE id = $1", [id]))!.p);
const channelLedger = async (id: string) =>
  Number((await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM transactions WHERE user_id = $1 AND reference LIKE 'channel:%'", [id]))!.n);
type Btn = { text: string; callback_data?: string; url?: string; style?: string; web_app?: { url: string } };
const rowsOf = (body: Record<string, unknown>): Btn[][] => (body.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? [];
const buttons = (body: Record<string, unknown>): Btn[] => rowsOf(body).flat();

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await query("DELETE FROM bonus_channels WHERE id::text = ANY($1)", [channelIds]);
  await query("DELETE FROM users WHERE telegram_id::text = ANY($1)", [tgIds]);
  await pool().end();
});

test("Hamyon card → «🎁 Bonuslar» (b:h) edits the same message into «Sizning bonuslaringiz»; opening checks nothing", { skip }, async () => {
  await freshChannels();
  const u = await newUser();
  const ch = await newChannel("Bonus <test>");
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "💰 Hamyon / Bonus"));
  const card = sends()[0]!.body;
  assert.match(String(card.text), /<blockquote expandable>🧾 <b>So‘nggi amallar<\/b>\n<b>\+2\s000 so‘m<\/b> — Ro‘yxatdan o‘tish bonusi/);
  assert.deepEqual(rowsOf(card), [
    [{ text: "🎁 Bonuslar", callback_data: "b:h", style: "success" }],
    [{ text: "💳 To‘ldirish", web_app: { url: "https://slaydx.test/uz/wallet" }, style: "primary" }],
  ]);

  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:h", 4242));
  assert.equal(sends().length, 0, "edit, not send");
  assert.equal(edits().length, 1);
  assert.equal(edits()[0]!.body.message_id, 4242);
  const text = String(edits()[0]!.body.text);
  assert.match(text, /^🎁 <b>Sizning bonuslaringiz<\/b>/);
  assert.match(text, /Jami olgan bonusingiz: <b>2\s000 so‘m<\/b> · yana olish mumkin: <b>\d[\d\s]* so‘m<\/b>/);
  const b = buttons(edits()[0]!.body);
  assert.deepEqual(b[0], { text: "✅ Ro‘yxatdan o‘tish · +2 000 so‘m", callback_data: "b:d", style: "success" });
  assert.ok(b[1]!.url?.startsWith("https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fslaydx_test_bot%3Fstart%3Dref_"), b[1]!.url);
  assert.deepEqual(b[2], { text: "📢 Bonus <test> · +1 000 so‘m", url: "https://t.me/slaydx_news" });
  assert.ok(b.some((x) => x.web_app?.url === "https://slaydx.test/uz/wallet" && /Birinchi to‘ldirish/.test(x.text)));
  assert.deepEqual(b.slice(-2).map((x) => x.callback_data), ["b:r", "w:h"]);
  assert.equal(memberCalls().length, 0, "opening the message checks nothing");
  void ch;
});

test("«🔄 Yangilash»: a member is paid once — toast + green button; replay pays nothing and checks nothing — MUTATSIYA 1", { skip }, async () => {
  await freshChannels();
  const u = await newUser();
  const ch = await newChannel();
  const before = await points(u.id);
  member = { [u.tg]: "member" };
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:r", 777));
  assert.deepEqual(toasts(), ["🎉 +1 000 so‘m bonus!"]);
  assert.equal(memberCalls().length, 1);
  assert.equal(edits().length, 1);
  assert.equal(edits()[0]!.body.message_id, 777);
  const green = buttons(edits()[0]!.body).find((b) => b.text.startsWith("✅ SlaydX yangi"));
  assert.deepEqual(green, { text: "✅ SlaydX yangi… · +1 000 so‘m · ⏳ 7 kun: 7 kun", callback_data: "b:d", style: "success" });
  assert.equal(await points(u.id), before + 1000);

  // Telegram redelivers / the user taps «Yangilash» again.
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:r", 777));
  assert.equal(memberCalls().length, 0, "claimed: no getChatMember");
  assert.equal(await points(u.id), before + 1000);
  assert.equal(await channelLedger(u.id), 1);
  void ch;
});

test("«🔄 Yangilash»: not a member → toast, re-rendered, no money; green task → «Bajarilgan» toast only; forged codes", { skip }, async () => {
  await freshChannels();
  const u = await newUser();
  const ch = await newChannel();
  const before = await points(u.id);
  member = { [u.tg]: "left" };
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:r"));
  assert.deepEqual(toasts(), ["Obuna topilmadi — avval kanalga obuna bo‘ling"]);
  assert.equal(edits().length, 1);

  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:d"));
  assert.deepEqual(toasts(), ["✅ Bajarilgan"]);
  assert.equal(edits().length + sends().length, 0);

  // One channel without a public link (b:c): forged / unknown ids never reach getChatMember.
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:c:999999999999999999"));
  assert.deepEqual(toasts(), ["Bu vazifa endi faol emas"]);
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:c:0x1f"));
  assert.deepEqual(toasts(), ["Bu tugma eskirgan"], "malformed code never reaches checkChannel");
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, `b:c:${ch.id}`));
  assert.deepEqual(toasts(), ["Obuna topilmadi — avval kanalga obuna bo‘ling"]);
  assert.equal(await points(u.id), before);
  assert.equal(await channelLedger(u.id), 0);
});

test("a private channel without a public link: its button checks that one channel (b:c) and pays once", { skip }, async () => {
  await freshChannels();
  const u = await newUser();
  const ch = await newChannel("Yopiq", 1000, 0, null);
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:h"));
  const btn = buttons(edits()[0]!.body).find((b) => b.text.startsWith("📢 Yopiq"));
  assert.deepEqual(btn, { text: "📢 Yopiq · +1 000 so‘m", callback_data: `b:c:${ch.id}` });
  member = { [u.tg]: "member" };
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, btn!.callback_data!));
  assert.deepEqual(toasts(), ["🎉 +1 000 so‘m bonus!"]);
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, btn!.callback_data!));
  assert.deepEqual(toasts(), ["Bu vazifa allaqachon bajarilgan"]);
  assert.equal(await channelLedger(u.id), 1);
});

test("someone else's button / a blocked account / no account: no getChatMember, no money — MUTATSIYA 2, 3", { skip }, async () => {
  await freshChannels();
  const owner = await newUser();
  const other = await newUser();
  const ch = await newChannel();
  member = { [owner.tg]: "member", [other.tg]: "member" };
  const before = await points(other.id);
  installFetch();
  // `other` taps a button in `owner`'s chat.
  await tg.handleUpdate(cbUpdate(other.tg, "b:r", 555, owner.tg));
  assert.deepEqual(toasts(), ["Bu tugma siz uchun emas"]);
  assert.equal(memberCalls().length, 0);
  assert.equal(await points(other.id), before);

  await query("UPDATE users SET is_blocked = true WHERE id = $1", [other.id]);
  installFetch();
  await tg.handleUpdate(cbUpdate(other.tg, "b:r"));
  await tg.handleUpdate(cbUpdate(other.tg, `b:c:${ch.id}`));
  await tg.handleUpdate(joinUpdate(ch.chat, other.tg));
  assert.match(String(toasts()[0]), /bloklangan/);
  assert.equal(memberCalls().length, 0);
  assert.equal(sends().length, 0, "a blocked account gets no join notice");
  assert.equal(await points(other.id), before);
  assert.equal(await channelLedger(other.id), 0);

  const stranger = 7_799_000_000 + randomInt(0, 999_999);
  installFetch();
  await tg.handleUpdate(cbUpdate(stranger, "b:r"));
  await tg.handleUpdate(joinUpdate(ch.chat, stranger));
  assert.deepEqual(toasts(), ["Avval /start bosing"]);
  assert.equal(memberCalls().length, 0);
  assert.equal(sends().length, 0);
});

test("«🔄 Yangilash» is rate limited per user (one tap checks every channel) — MUTATSIYA 4", { skip }, async () => {
  await freshChannels();
  const u = await newUser();
  await newChannel();
  await newChannel("Ikkinchi");
  member = { [u.tg]: "left" };
  installFetch();
  for (let i = 0; i < 4; i++) await tg.handleUpdate(cbUpdate(u.tg, "b:r"));
  assert.equal(memberCalls().length, 6, "3 taps × 2 channels");
  assert.equal(toasts().at(-1), "Juda tez — bir daqiqadan keyin qayta urinib ko‘ring");
});

test("a chat_member join pays automatically: ONE notice in the user's chat, «Bonuslar» turns green — MUTATSIYA 5", { skip }, async () => {
  await freshChannels();
  const u = await newUser();
  const ch = await newChannel("SlaydX", 1000, 2000);
  const before = await points(u.id);
  installFetch();
  const update = joinUpdate(ch.chat, u.tg);
  await tg.handleUpdate(update);
  await tg.handleUpdate(update);
  assert.equal(await points(u.id), before + 1000);
  assert.equal(sends().length, 1, "replayed update: no second notice");
  assert.equal(sends()[0]!.body.chat_id, String(u.tg));
  assert.equal(sends()[0]!.body.text, "🎉 <b>+1 000 so‘m bonus!</b>\n«SlaydX» kanaliga obuna bo‘lganingiz uchun.\n7 kun obuna bo‘lib qolsangiz — yana +2 000 so‘m.");
  assert.deepEqual(buttons(sends()[0]!.body), [{ text: "🎁 Bonuslar", callback_data: "b:h", style: "success" }]);
  assert.equal(memberCalls().length, 0);

  // The notice's button opens the bonuses message with the channel done.
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:h", 1));
  assert.ok(buttons(edits()[0]!.body).some((b) => b.text === "✅ SlaydX · +1 000 so‘m · ⏳ 7 kun: 7 kun" && b.style === "success"));
});

test("chat_member join ‖ «Yangilash» at the same time: paid exactly once; a notice only if the join path paid", { skip }, async () => {
  for (let round = 0; round < 3; round++) {
    await freshChannels();
    const u = await newUser();
    const ch = await newChannel();
    const before = await points(u.id);
    member = { [u.tg]: "member" };
    installFetch();
    await Promise.all([
      tg.handleUpdate(joinUpdate(ch.chat, u.tg)),
      tg.handleUpdate(cbUpdate(u.tg, "b:r")),
      tg.handleUpdate(joinUpdate(ch.chat, u.tg)),
    ]);
    assert.equal(await points(u.id), before + 1000, `round ${round}`);
    assert.equal(await channelLedger(u.id), 1);
    const notices = sends().filter((c) => String(c.body.text).includes("kanaliga obuna bo‘lganingiz uchun")).length;
    const refreshPaid = toasts().includes("🎉 +1 000 so‘m bonus!");
    assert.equal(notices + (refreshPaid ? 1 : 0), 1, `exactly one of the two paths paid (round ${round})`);
  }
});

test("russian user: toast, buttons and notice in Russian, amounts in сум", { skip }, async () => {
  await freshChannels();
  const u = await newUser();
  await query("UPDATE users SET language = 'ru' WHERE id = $1", [u.id]);
  const ch = await newChannel("Канал", 2000, 0);
  member = { [u.tg]: "creator" };
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:r"));
  assert.deepEqual(toasts(), ["🎉 +2 000 сум бонуса!"]);
  assert.match(String(edits()[0]!.body.text), /^🎁 <b>Ваши бонусы<\/b>/);
  assert.ok(buttons(edits()[0]!.body).some((b) => b.text === "✅ Канал · +2 000 сум" && b.style === "success"));
  void ch;
});
