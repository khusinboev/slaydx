import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";

/**
 * «🎁 Bonus olish» in the bot end to end (docs/bonus/PLAN.md, K1): updates go
 * through `handleUpdate` with the Bot API stubbed at `fetch` — Hamyon → Bonus
 * (edit one message), «Tekshirish» pays once (toast + re-rendered screen with
 * the success banner), replayed / forged / foreign / blocked callbacks pay
 * nothing. Real Postgres (test DB only); synthetic ids.
 *
 * Mutations (each turned a test red, then restored):
 *   1. router `bonusCheck` case removed → «Tekshirish pays once»;
 *   2. `handleCallback` without the `from.id === chat.id` check → «someone else's button»;
 *   3. `handleCallback` without the blocked check AND `checkChannel` without its blocked checks → «blocked user»;
 *   4. the per-user rate limit removed → «Tekshirish is rate limited».
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
async function newUser(): Promise<{ id: string; tg: number }> {
  const tgId = 7_700_000_000 + randomInt(0, 99_999_999);
  tgIds.push(String(tgId));
  const u = await upsertTelegramUser({ telegramId: String(tgId), username: null, name: "Bonus Bot", photoUrl: null });
  return { id: u.id, tg: tgId };
}
async function newChannel(title = "SlaydX yangiliklari", join = 1000, stay = 2000): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO bonus_channels (chat_id, username, title, join_bonus, stay_bonus, stay_days, sort)
     VALUES ($1, 'slaydx_news', $2, $3, $4, 7, -1000000) RETURNING id::text AS id`,
    [-1_002_000_000_000 - randomInt(0, 999_999_999), title, join, stay],
  );
  channelIds.push(row!.id);
  return row!.id;
}
const textUpdate = (from: number, text: string) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Bot" }, text },
});
const cbUpdate = (from: number, data: string, messageId = 555, chatId = from) => ({
  update_id: ++seq,
  callback_query: { id: `cq${++seq}`, from: { id: from }, message: { message_id: messageId, chat: { id: chatId, type: "private" } }, data },
});
const edits = () => calls.filter((c) => c.method === "editMessageText");
const toasts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text as string | undefined);
const memberCalls = () => calls.filter((c) => c.method === "getChatMember");
const points = async (id: string) => Number((await queryOne<{ p: number }>("SELECT points AS p FROM users WHERE id = $1", [id]))!.p);
const channelLedger = async (id: string) =>
  Number((await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM transactions WHERE user_id = $1 AND reference LIKE 'channel:%'", [id]))!.n);
type Btn = { text: string; callback_data?: string; url?: string; style?: string };
const buttons = (body: Record<string, unknown>): Btn[] => ((body.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []).flat();

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await query("DELETE FROM bonus_channels WHERE id::text = ANY($1)", [channelIds]);
  await query("DELETE FROM users WHERE telegram_id::text = ANY($1)", [tgIds]);
  await pool().end();
});

test("Hamyon → «🎁 Bonus olish» (b:h) edits the same message into the tasks screen", { skip }, async () => {
  const u = await newUser();
  const ch = await newChannel("Bonus <test>");
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "💰 Hamyon / Bonus"));
  const card = calls.find((c) => c.method === "sendMessage")!;
  assert.deepEqual(buttons(card.body)[0], { text: "🎁 Bonus olish", callback_data: "b:h", style: "success" });

  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:h", 4242));
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 0, "edit, not send");
  assert.equal(edits().length, 1);
  assert.equal(edits()[0]!.body.message_id, 4242);
  const text = String(edits()[0]!.body.text);
  assert.match(text, /🎁 <b>Bonus olish<\/b>/);
  assert.match(text, /<b>\d+\. Bonus &lt;test&gt;<\/b> · \+1\s000, 7 kundan keyin yana \+2\s000\n✨ Yangi/);
  assert.ok(buttons(edits()[0]!.body).some((b) => b.callback_data === `b:c:${ch}` && b.style === "success"));
  assert.ok(buttons(edits()[0]!.body).some((b) => b.url === "https://t.me/slaydx_news"));
  assert.equal(memberCalls().length, 0, "opening the screen checks nothing");
});

test("«Tekshirish»: a member is paid once — toast + banner; a replayed callback pays nothing — MUTATSIYA 1", { skip }, async () => {
  const u = await newUser();
  const ch = await newChannel();
  const before = await points(u.id);
  member = { [u.tg]: "member" };
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, `b:c:${ch}`, 777));
  assert.deepEqual(toasts(), ["🎉 +1 000 ball!"]);
  assert.equal(edits().length, 1);
  assert.equal(edits()[0]!.body.message_id, 777);
  assert.match(String(edits()[0]!.body.text), /^<blockquote>🎉 <b>\+1\s000 ball!<\/b>\n«SlaydX yangiliklari» obunasi uchun/);
  assert.ok(!buttons(edits()[0]!.body).some((b) => b.callback_data === `b:c:${ch}`), "claimed: its buttons are gone");
  assert.equal(await points(u.id), before + 1000);

  // Telegram redelivers / the user taps the old button again.
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, `b:c:${ch}`, 777));
  assert.deepEqual(toasts(), ["Bu vazifa allaqachon bajarilgan"]);
  assert.equal(memberCalls().length, 0);
  assert.equal(await points(u.id), before + 1000);
  assert.equal(await channelLedger(u.id), 1);
});

test("«Tekshirish»: not a member → toast, no edit, no money; forged / unknown channel id → «faol emas»", { skip }, async () => {
  const u = await newUser();
  const ch = await newChannel();
  const before = await points(u.id);
  member = { [u.tg]: "left" };
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, `b:c:${ch}`));
  assert.deepEqual(toasts(), ["Avval kanalga obuna bo‘ling, so‘ng «Tekshirish»ni bosing"]);
  assert.equal(edits().length, 0);

  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:c:999999999999999999"));
  assert.deepEqual(toasts(), ["Bu vazifa endi faol emas"]);
  assert.equal(memberCalls().length, 0);

  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "b:c:0x1f"));
  assert.deepEqual(toasts(), ["Bu tugma eskirgan"], "malformed code never reaches checkChannel");
  assert.equal(await points(u.id), before);
  assert.equal(await channelLedger(u.id), 0);
});

test("someone else's button / a blocked account / no account: no getChatMember, no money — MUTATSIYA 2, 3", { skip }, async () => {
  const owner = await newUser();
  const other = await newUser();
  const ch = await newChannel();
  member = { [owner.tg]: "member", [other.tg]: "member" };
  const before = await points(other.id);
  installFetch();
  // `other` taps a button in `owner`'s chat.
  await tg.handleUpdate(cbUpdate(other.tg, `b:c:${ch}`, 555, owner.tg));
  assert.deepEqual(toasts(), ["Bu tugma siz uchun emas"]);
  assert.equal(memberCalls().length, 0);
  assert.equal(await points(other.id), before);

  await query("UPDATE users SET is_blocked = true WHERE id = $1", [other.id]);
  installFetch();
  await tg.handleUpdate(cbUpdate(other.tg, `b:c:${ch}`));
  assert.match(String(toasts()[0]), /bloklangan/);
  assert.equal(memberCalls().length, 0);
  assert.equal(await points(other.id), before);
  assert.equal(await channelLedger(other.id), 0);

  const stranger = 7_799_000_000 + randomInt(0, 999_999);
  installFetch();
  await tg.handleUpdate(cbUpdate(stranger, `b:c:${ch}`));
  assert.deepEqual(toasts(), ["Avval /start bosing"]);
  assert.equal(memberCalls().length, 0);
});

test("«Tekshirish» is rate limited per user (each tap is a Bot API call) — MUTATSIYA 4", { skip }, async () => {
  const u = await newUser();
  const ch = await newChannel();
  member = { [u.tg]: "left" };
  installFetch();
  for (let i = 0; i < 11; i++) await tg.handleUpdate(cbUpdate(u.tg, `b:c:${ch}`));
  assert.equal(memberCalls().length, 10);
  assert.equal(toasts().at(-1), "Juda tez — bir daqiqadan keyin qayta urinib ko‘ring");
});

test("russian user: toast and screen in Russian", { skip }, async () => {
  const u = await newUser();
  await query("UPDATE users SET language = 'ru' WHERE id = $1", [u.id]);
  const ch = await newChannel("Канал", 2000, 0);
  member = { [u.tg]: "creator" };
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, `b:c:${ch}`));
  assert.deepEqual(toasts(), ["🎉 +2 000 баллов!"]);
  assert.match(String(edits()[0]!.body.text), /Баллы за подписку на «Канал» зачислены в кошелёк\./);
  assert.match(String(edits()[0]!.body.text), /<b>\d+\. Канал<\/b> · \+2\s000\n✅ Получено/);
});
