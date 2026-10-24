import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";

/**
 * Bot AI chat (owner request 8): `/chat` turns chat mode on, `/stop` or 15 idle minutes turn it off; in chat mode a plain
 * text goes to the assistant but NEVER steals a text another flow owns (profile prompt, keyboard button, `/start <nonce>`,
 * commands); a proposal card's buttons carry the single-use token and are the only way to start a generation.
 * Updates go through `handleUpdate`; Telegram AND Gemini are stubbed at `fetch`; real Postgres.
 *
 * Mutations (restored): the chat branch moved BEFORE `handlePendingInput` in telegram.ts -> «does not steal a pending profile
 * answer»; the idle check removed from `botChatActive` -> «15 idle minutes end chat mode»; the callback handler confirming
 * without the token -> see tests/chat-proposals.test.mts.
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-bot-chat-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
process.env.GEMINI_API_KEY = "test-gemini-key";
delete process.env.LLM_FAST;
delete process.env.BOT_PREMIUM_EMOJI;
process.env.WORKER_INLINE = "false";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, ensureMigrated } = await import("../lib/server/db.ts");
const tg = await import("../lib/server/telegram.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { env } = await import("../lib/server/env.ts");
const { startInput } = await import("../lib/server/bot/state.ts");
if (hasDb) await ensureMigrated();
Object.assign(env.worker, { inline: false });
Object.assign(env.queue, { userMaxInflight: 20, totalSlots: 8, meanServiceSec: 200, maxWaitSec: 100_000 });

type Sent = { method: string; body: Record<string, any> };
let sent: Sent[] = [];
let geminiCalls: Array<{ system: string; user: string }> = [];
let geminiQueue: Array<Record<string, unknown> | string> = [];
const realFetch = globalThis.fetch;
function installFetch(): void {
  sent = [];
  geminiCalls = [];
  geminiQueue = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (u.startsWith("https://generativelanguage.googleapis.com/")) {
      geminiCalls.push({ system: String(body.system_instruction?.parts?.[0]?.text ?? ""), user: String(body.contents?.[0]?.parts?.[0]?.text ?? "") });
      const next = geminiQueue.shift() ?? { reply: "Salom! Qanday yordam bera olaman?", propose: null };
      const text = typeof next === "string" ? next : JSON.stringify(next);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } }));
    }
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(u);
    assert.ok(m, `unexpected URL ${u}`);
    sent.push({ method: m[1]!, body });
    return new Response(JSON.stringify({ ok: true, result: m[1] === "sendMessage" ? { message_id: 1000 + sent.length } : true }));
  }) as typeof fetch;
}
const tgIds: string[] = [];
let seq = Date.now() * 1000 + 900_000;
const textUpdate = (from: number, text: string) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Suhbat" }, text },
});
const cbUpdate = (from: number, data: string) => ({
  update_id: ++seq,
  callback_query: { id: `cb${++seq}`, from: { id: from }, message: { message_id: 555, chat: { id: from, type: "private" } }, data },
});
async function mkUser(balance = 10_000): Promise<{ tgId: number; uid: string }> {
  const tgId = 7_800_000_000 + randomInt(0, 99_999_999);
  tgIds.push(String(tgId));
  await upsertTelegramUser({ telegramId: String(tgId), username: null, name: "Suhbat Bot", photoUrl: null });
  const row = (await queryOne<{ id: string }>("SELECT id::text AS id FROM users WHERE telegram_id = $1", [String(tgId)]))!;
  await query("UPDATE users SET points = 0, balance = $2, university = 'TATU', author = 'Aliyev Ali' WHERE id = $1", [row.id, balance]);
  return { tgId, uid: row.id };
}
const texts = () => sent.filter((c) => c.method === "sendMessage").map((c) => String(c.body.text));
const gens = async (uid: string) => Number((await query<{ n: string }>("SELECT count(*) AS n FROM generations WHERE user_id = $1", [uid]))[0]!.n);
const toast = () => String(sent.filter((c) => c.method === "answerCallbackQuery").at(-1)?.body.text ?? "");
after(async () => {
  globalThis.fetch = realFetch;
  if (hasDb && tgIds.length) await query("DELETE FROM users WHERE telegram_id = ANY($1::text[])", [tgIds]).catch(() => undefined);
});

test("menu commands: /chat and /stop are listed with a description in every language", { skip }, async () => {
  installFetch();
  assert.equal(await tg.setBotCommands(), true);
  for (const call of sent.filter((c) => c.method === "setMyCommands")) {
    const cmds = call.body.commands as { command: string; description: string }[];
    assert.ok(cmds.find((c) => c.command === "chat")!.description.length > 5);
    assert.ok(cmds.find((c) => c.command === "stop")!.description.length > 5);
  }
  assert.equal((sent[0]!.body.commands as { command: string; description: string }[]).find((c) => c.command === "chat")!.description, "AI yordamchi bilan suhbat");
});

test("without chat mode a plain text gets the ordinary fallback and never reaches the model", { skip }, async () => {
  installFetch();
  const { tgId } = await mkUser();
  await tg.handleUpdate(textUpdate(tgId, "Slayd narxi qancha?"));
  assert.equal(geminiCalls.length, 0);
  assert.equal(texts().length, 1);
});

test("/chat -> chat mode on; a text goes to the assistant; /stop ends it", { skip }, async () => {
  installFetch();
  const { tgId, uid } = await mkUser();
  await tg.handleUpdate(textUpdate(tgId, "/chat"));
  assert.match(texts()[0]!, /AI yordamchi yoqildi/);
  assert.match(texts()[0]!, /Bugun tekin: 10\/10/);
  assert.match(texts()[0]!, /\/stop/);
  assert.equal(Number((await query<{ n: string }>("SELECT count(*) AS n FROM chat_conversations WHERE user_id = $1 AND channel = 'bot' AND active", [uid]))[0]!.n), 1);

  sent.length = 0;
  geminiQueue.push({ reply: "Slayd 3 000 so'm dan boshlanadi <b>&</b>", propose: null });
  await tg.handleUpdate(textUpdate(tgId, "Slayd narxi qancha?"));
  assert.equal(geminiCalls.length, 1);
  assert.ok(geminiCalls[0]!.user.includes("Slayd narxi qancha?"));
  assert.ok(geminiCalls[0]!.system.includes("KNOWLEDGE"));
  const reply = sent.find((c) => c.method === "sendMessage")!.body;
  assert.equal(reply.parse_mode, "HTML");
  assert.ok(String(reply.text).includes("Slayd 3 000 so&#39;m dan") || String(reply.text).includes("Slayd 3 000 so'm dan"), reply.text);
  assert.ok(String(reply.text).includes("&lt;b&gt;&amp;&lt;/b&gt;"), "model text is HTML-escaped");
  assert.match(String(reply.text), /Bugun tekin: 9\/10/);
  const row = await queryOne<{ client_id: string }>("SELECT m.client_id FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id WHERE c.user_id = $1 AND m.role = 'user'", [uid]);
  assert.match(row!.client_id, /^tg\d+$/, "the Telegram update id is the message id");

  sent.length = 0;
  await tg.handleUpdate(textUpdate(tgId, "/stop"));
  assert.match(texts()[0]!, /AI suhbat tugadi/);
  sent.length = 0;
  geminiCalls.length = 0;
  await tg.handleUpdate(textUpdate(tgId, "yana savol"));
  assert.equal(geminiCalls.length, 0, "after /stop the text is not an AI message");
  await tg.handleUpdate(textUpdate(tgId, "/stop"));
  assert.match(texts().at(-1)!, /AI suhbat yoqilmagan/);
});

test("15 idle minutes end chat mode", { skip }, async () => {
  installFetch();
  const { tgId, uid } = await mkUser();
  await tg.handleUpdate(textUpdate(tgId, "/chat"));
  await query("UPDATE chat_conversations SET last_at = now() - interval '14 minutes' WHERE user_id = $1", [uid]);
  await tg.handleUpdate(textUpdate(tgId, "hali shu yerdaman"));
  assert.equal(geminiCalls.length, 1, "14 minutes is still chat mode");
  await query("UPDATE chat_conversations SET last_at = now() - interval '16 minutes' WHERE user_id = $1", [uid]);
  geminiCalls.length = 0;
  await tg.handleUpdate(textUpdate(tgId, "qaytdim"));
  assert.equal(geminiCalls.length, 0, "16 idle minutes: not an AI message any more");
  assert.equal(Number((await query<{ n: string }>("SELECT count(*) AS n FROM chat_conversations WHERE user_id = $1 AND active", [uid]))[0]!.n), 0, "the stale flag was cleared");
});

test("chat mode does NOT steal a pending profile answer, a keyboard button, a command or a login nonce", { skip }, async () => {
  installFetch();
  const { tgId, uid } = await mkUser();
  await tg.handleUpdate(textUpdate(tgId, "/chat"));
  // 1. A pending profile prompt claims the next text.
  await startInput(tgId, uid, "university", null);
  geminiCalls.length = 0;
  await tg.handleUpdate(textUpdate(tgId, "Toshkent Axborot Texnologiyalari Universiteti"));
  assert.equal(geminiCalls.length, 0, "the profile prompt got the text");
  assert.equal((await queryOne<{ university: string }>("SELECT university FROM users WHERE id = $1", [uid]))!.university, "Toshkent Axborot Texnologiyalari Universiteti");
  // 2. A reply-keyboard button (the profile card).
  sent.length = 0;
  await tg.handleUpdate(textUpdate(tgId, "👤 Profil"));
  assert.equal(geminiCalls.length, 0);
  assert.ok(sent.some((c) => c.method === "sendMessage"), "the keyboard action answered");
  // 3. A command (language menu) and a login nonce.
  sent.length = 0;
  await tg.handleUpdate(textUpdate(tgId, "/til"));
  assert.equal(geminiCalls.length, 0);
  const nonce = randomBytes(24).toString("base64url");
  await query("INSERT INTO login_tickets (nonce, expires_at) VALUES ($1, now() + interval '5 minutes')", [nonce]);
  sent.length = 0;
  await tg.handleUpdate(textUpdate(tgId, `/start ${nonce}`));
  assert.equal(geminiCalls.length, 0, "the login nonce went to the login flow");
  const t = await queryOne<{ telegram_id: string | null }>("SELECT telegram_id::text AS telegram_id FROM login_tickets WHERE nonce = $1", [nonce]);
  assert.equal(t!.telegram_id, String(tgId), "the ticket was attached by the login flow");
  // Chat mode is still on afterwards: a free text goes to the assistant.
  await tg.handleUpdate(textUpdate(tgId, "endi savolim bor"));
  assert.equal(geminiCalls.length, 1);
});

test("a proposal card in the bot: buttons fit 64 bytes, the tap starts ONE generation, a second tap and a stranger's tap do nothing", { skip }, async () => {
  installFetch();
  const owner = await mkUser(20_000);
  const stranger = await mkUser(20_000);
  await tg.handleUpdate(textUpdate(owner.tgId, "/chat"));
  sent.length = 0;
  geminiQueue.push({ reply: "Mana taklif:", propose: { tool: "slide", values: { topic: "Suv", slideCount: 10 } } });
  await tg.handleUpdate(textUpdate(owner.tgId, "Menga 'Suv' haqida 10 slaydli taqdimot qil"));
  const msgs = sent.filter((c) => c.method === "sendMessage");
  assert.equal(msgs.length, 2, "reply + card");
  const card = msgs[1]!.body;
  assert.match(String(card.text), /Slayd/);
  assert.match(String(card.text), /Mavzu: Suv/);
  assert.match(String(card.text).replace(/[\u00a0\u202f]/g, " "), /Narx: 3 000 so‘m/);
  const buttons = (card.reply_markup.inline_keyboard as Array<Array<{ text: string; callback_data: string }>>).flat();
  assert.equal(buttons.length, 2);
  for (const b of buttons) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
  const yes = buttons.find((b) => b.callback_data.startsWith("chy:"))!;
  const no = buttons.find((b) => b.callback_data.startsWith("chn:"))!;
  assert.ok(yes && no);
  assert.equal(await gens(owner.uid), 0, "a proposal enqueues nothing");

  // A stranger taps the owner's button.
  sent.length = 0;
  await tg.handleUpdate(cbUpdate(stranger.tgId, yes.callback_data));
  assert.match(toast(), /eskirgan/);
  assert.equal(await gens(stranger.uid), 0);
  assert.equal(await gens(owner.uid), 0);

  // The owner taps it.
  sent.length = 0;
  await tg.handleUpdate(cbUpdate(owner.tgId, yes.callback_data));
  assert.equal(await gens(owner.uid), 1);
  assert.match(toast(), /Boshlandi/);
  assert.ok(sent.some((c) => c.method === "editMessageReplyMarkup"), "the buttons are removed");
  assert.equal(Number((await queryOne<{ b: string }>("SELECT (points + balance) AS b FROM users WHERE id = $1", [owner.uid]))!.b), 17_000);

  // A second tap (or Telegram redelivery of another update).
  sent.length = 0;
  await tg.handleUpdate(cbUpdate(owner.tgId, yes.callback_data));
  assert.match(toast(), /allaqachon ishlatilgan/);
  assert.equal(await gens(owner.uid), 1);
  assert.equal(Number((await queryOne<{ b: string }>("SELECT (points + balance) AS b FROM users WHERE id = $1", [owner.uid]))!.b), 17_000);
});

test("«Bekor qilish» kills the token; a garbled callback is harmless", { skip }, async () => {
  installFetch();
  const u = await mkUser(20_000);
  await tg.handleUpdate(textUpdate(u.tgId, "/chat"));
  geminiQueue.push({ reply: "Mana:", propose: { tool: "slide", values: { topic: "Havo" } } });
  sent.length = 0;
  await tg.handleUpdate(textUpdate(u.tgId, "taqdimot qil"));
  const buttons = (sent.filter((c) => c.method === "sendMessage")[1]!.body.reply_markup.inline_keyboard as Array<Array<{ callback_data: string }>>).flat();
  await tg.handleUpdate(cbUpdate(u.tgId, buttons.find((b) => b.callback_data.startsWith("chn:"))!.callback_data));
  assert.match(toast(), /Bekor qilindi/);
  await tg.handleUpdate(cbUpdate(u.tgId, buttons.find((b) => b.callback_data.startsWith("chy:"))!.callback_data));
  assert.equal(await gens(u.uid), 0);
  await tg.handleUpdate(cbUpdate(u.tgId, "chy:short"));
  assert.match(toast(), /eskirgan/);
  assert.equal(await gens(u.uid), 0);
});

test("after the free messages an empty wallet gets the refusal with a top-up button; the model is not called", { skip }, async () => {
  installFetch();
  const u = await mkUser(0);
  await tg.handleUpdate(textUpdate(u.tgId, "/chat"));
  for (let i = 0; i < 10; i++) await tg.handleUpdate(textUpdate(u.tgId, `savol ${i}`));
  assert.equal(geminiCalls.length, 10);
  sent.length = 0;
  await tg.handleUpdate(textUpdate(u.tgId, "o'n birinchi"));
  assert.equal(geminiCalls.length, 10);
  const m = sent.find((c) => c.method === "sendMessage")!.body;
  assert.match(String(m.text), /Bugungi tekin xabarlar tugadi/);
  assert.equal(m.reply_markup.inline_keyboard[0][0].web_app.url, "https://slaydx.test/uz/wallet");
});

test("kill switch chat.enabled=false: /chat says so and no mode starts", { skip }, async () => {
  installFetch();
  const u = await mkUser();
  await query("INSERT INTO app_settings (key, value) VALUES ('chat.enabled', 'false'::jsonb) ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb");
  (await import("../lib/server/settings.ts")).invalidateSettingsCache();
  try {
    await tg.handleUpdate(textUpdate(u.tgId, "/chat"));
    assert.match(texts()[0]!, /o‘chirilgan/);
    assert.equal(Number((await query<{ n: string }>("SELECT count(*) AS n FROM chat_conversations WHERE user_id = $1", [u.uid]))[0]!.n), 0);
  } finally {
    await query("DELETE FROM app_settings WHERE key = 'chat.enabled'");
    (await import("../lib/server/settings.ts")).invalidateSettingsCache();
  }
});
