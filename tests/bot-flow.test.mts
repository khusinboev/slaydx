import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

/**
 * Bot screens end to end (docs/bot/PLAN.md, B2): updates go through
 * `handleUpdate` (dedup + retry semantics) with the Bot API stubbed at
 * `fetch` — keyboard texts, callback_query routing, the pending-input state
 * machine in `bot_chat_state`, replay idempotency, language switching,
 * Ishlarim / Hamyon / Yordam. Real Postgres (test DB only); synthetic ids.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `claimInput` without `expires_at > now()` → «expired prompt»;
 *   2. keyboard texts matched AFTER the pending input → «a keyboard text cancels»;
 *   3. `handleCallback` without the `from.id === chat.id` check → «someone else's button»;
 *   4. `claimInput` without `OR claimed_update = $3` → «replay after a transient failure»;
 *   5. `botUser` re-runs `registerBotUser` on every message → «a saved name is not reverted»;
 *   6. `answerCallbackQuery` skipped when the handler throws (no finally) → «always answered»;
 *   7. `processUpdate` ignores `callback_query` → every callback test.
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-bot-flow-token";
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
let nextMessageId = 1000;
/** Methods that answer 502 the next N times. */
let failNext: Record<string, number> = {};
const realFetch = globalThis.fetch;
function installFetch(): void {
  calls = [];
  failNext = {};
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected URL ${url}`);
    const method = m[1]!;
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (failNext[method]) {
      failNext[method]! -= 1;
      return new Response(JSON.stringify({ ok: false, error_code: 502, description: "Bad Gateway" }));
    }
    const result = method === "sendMessage" ? { message_id: ++nextMessageId } : true;
    return new Response(JSON.stringify({ ok: true, result }));
  }) as typeof fetch;
}

let seq = Date.now() * 1000 + 300_000;
const tgIds: string[] = [];
async function newUser(name = "Bot Flow"): Promise<{ id: string; tg: number }> {
  const tgId = 7_500_000_000 + randomInt(0, 99_999_999);
  tgIds.push(String(tgId));
  const u = await upsertTelegramUser({ telegramId: String(tgId), username: null, name, photoUrl: null });
  return { id: u.id, tg: tgId };
}
const textUpdate = (from: number, text: string, extra: Record<string, unknown> = {}) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Bot", ...extra }, text },
});
const cbUpdate = (from: number, data: string, messageId = 555, chatId = from, chatType = "private") => ({
  update_id: ++seq,
  callback_query: { id: `cq${++seq}`, from: { id: from }, message: { message_id: messageId, chat: { id: chatId, type: chatType } }, data },
});
const sends = () => calls.filter((c) => c.method === "sendMessage");
const edits = () => calls.filter((c) => c.method === "editMessageText");
const answers = () => calls.filter((c) => c.method === "answerCallbackQuery");
const pending = async (chatId: number) =>
  (await queryOne<{ field: string | null }>("SELECT field FROM bot_chat_state WHERE chat_id = $1", [chatId]))?.field ?? null;
const col = async (id: string, c: string) => (await queryOne<{ v: string }>(`SELECT "${c}" AS v FROM users WHERE id = $1`, [id]))!.v;
const auditCount = async (id: string) =>
  Number((await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM admin_audit_log WHERE action = 'profile.update' AND target_id = $1", [id]))!.n);
type Btn = { text: string; callback_data?: string; web_app?: { url: string }; url?: string; copy_text?: { text: string }; style?: string };
const buttons = (body: Record<string, unknown>): Btn[] =>
  ((body.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []).flat();

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await query("DELETE FROM users WHERE telegram_id::text = ANY($1)", [tgIds]);
  await pool().end();
});

test("«👤 Profilim» → the card (+ fresh keyboard once); the card's buttons edit ONE message", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "👤 Profilim"));
  assert.equal(sends().length, 2, "card + stale keyboard refreshed");
  assert.match(String(sends()[0]!.body.text), /<b>Profilim<\/b>/);
  assert.ok(buttons(sends()[0]!.body).some((b) => b.copy_text?.text.startsWith("https://t.me/slaydx_test_bot?start=ref_")));
  assert.ok((sends()[1]!.body.reply_markup as { keyboard?: unknown }).keyboard);

  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "👤 Profilim"));
  assert.equal(sends().length, 1, "keyboard is fresh now — card only");

  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:s:oqish", 777));
  assert.equal(sends().length, 0, "MUTATSIYA 7");
  assert.equal(edits().length, 1);
  assert.equal(edits()[0]!.body.message_id, 777);
  assert.match(String(edits()[0]!.body.text), /O‘qish joyi/);
  assert.equal(answers().length, 1);
});

test("field → prompt → value → saved (DB + audit via bot), prompt loses its cancel button", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:e:department", 800));
  assert.equal(await pending(u.tg), "department");
  assert.match(String(edits()[0]!.body.text), /Kafedra nomini yozing/);
  assert.deepEqual(buttons(edits()[0]!.body).map((b) => [b.callback_data, b.style]), [["p:x", "danger"]]);

  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "Jahon tarixi kafedrasi"));
  assert.equal(await col(u.id, "department"), "Jahon tarixi kafedrasi");
  assert.equal(await auditCount(u.id), 1);
  assert.equal(sends().length, 1);
  assert.match(String(sends()[0]!.body.text), /Saqlandi!<\/b>\n<blockquote>🏷 Kafedra: <b>Jahon tarixi kafedrasi<\/b>/);
  const strip = calls.find((c) => c.method === "editMessageReplyMarkup");
  assert.equal(strip?.body.message_id, 800);
  assert.equal(await pending(u.tg), null);

  // The next text is ordinary again.
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "salom"));
  assert.match(String(sends()[0]!.body.text), /\/login/);
});

test("«Bekor qilish» clears the state and goes back to the section", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:e:group", 810));
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:x", 810));
  assert.equal(await pending(u.tg), null);
  assert.match(String(edits()[0]!.body.text), /O‘qish joyi/);
  assert.equal(answers()[0]!.body.text, "Bekor qilindi");
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "302"));
  assert.equal(await col(u.id, "group"), "");
});

test("expired prompt (10 min) → the text is treated normally", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:e:group", 820));
  await query("UPDATE bot_chat_state SET expires_at = now() - interval '1 minute' WHERE chat_id = $1", [u.tg]);
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "303"));
  assert.equal(await col(u.id, "group"), "", "MUTATSIYA 1");
  assert.match(String(sends()[0]!.body.text), /\/login/);
});

test("a keyboard text / a command always wins over a pending prompt (and cancels it)", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:e:faculty", 830));
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "💰 Hamyon"));
  assert.equal(await col(u.id, "faculty"), "", "MUTATSIYA 2");
  assert.match(String(sends()[0]!.body.text), /<b>Hamyon<\/b>/);
  assert.equal(await pending(u.tg), null);

  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:e:faculty", 830));
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "/til"));
  assert.equal(await pending(u.tg), null);
  assert.match(String(sends()[0]!.body.text), /Bot tilini tanlang/);
  assert.equal(await col(u.id, "faculty"), "");
});

test("validation: empty and > 200 characters re-ask politely; the state stays", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:e:teacher", 840));
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "x".repeat(201)));
  assert.match(String(sends()[0]!.body.text), /Juda uzun: 200 belgidan oshmasin \(hozir 201\)/);
  assert.equal(await pending(u.tg), "teacher");
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "   "));
  assert.match(String(sends()[0]!.body.text), /Qiymat bo‘sh bo‘lmasin/);
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "Aliyev Jasur"));
  assert.equal(await col(u.id, "teacher"), "Aliyev Jasur");
  assert.equal(await pending(u.tg), null);
});

test("someone else's button (or a group chat) is rejected: answered, nothing edited, no state", { skip }, async () => {
  const victim = await newUser();
  const other = await newUser();
  installFetch();
  await tg.handleUpdate(cbUpdate(other.tg, "p:e:department", 850, victim.tg));
  assert.equal(edits().length, 0, "MUTATSIYA 3");
  assert.equal(answers().length, 1);
  assert.equal(answers()[0]!.body.text, "Bu tugma siz uchun emas");
  assert.equal(await pending(victim.tg), null);
  assert.equal(await pending(other.tg), null);

  installFetch();
  await tg.handleUpdate(cbUpdate(victim.tg, "p:h", 851, -1001234, "supergroup"));
  assert.equal(edits().length, 0);
  assert.equal(answers().length, 1);
});

test("replay after a transient failure: saved once, confirmed once, nobody else takes the value", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:e:city", 860));
  installFetch();
  failNext = { sendMessage: 2 }; // the 429/5xx retry inside callBot is for 429 only: 502 → transient at once
  const answer = textUpdate(u.tg, "Samarqand");
  await assert.rejects(tg.handleUpdate(answer), (e: Error) => e.name === "TelegramTransientError");
  assert.equal(await col(u.id, "city"), "Samarqand", "saved before the confirmation failed");
  assert.equal(await pending(u.tg), "city", "still claimed by that update");

  // Another message meanwhile cannot take the claimed value.
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "Buxoro"));
  assert.equal(await col(u.id, "city"), "Samarqand");

  // Telegram redelivers the SAME update.
  installFetch();
  await tg.handleUpdate(answer);
  assert.equal(sends().length, 1, "MUTATSIYA 4");
  assert.match(String(sends()[0]!.body.text), /Saqlandi!/);
  assert.equal(await pending(u.tg), null);
  assert.equal(await auditCount(u.id), 1, "the replayed (unchanged) value writes no second audit row");

  // A successful update is never processed twice (telegram_updates dedup).
  installFetch();
  await tg.handleUpdate(answer);
  assert.equal(calls.length, 0);
});

test("a callback is always answered, even when the edit fails", { skip }, async () => {
  const u = await newUser();
  installFetch();
  failNext = { editMessageText: 1 };
  await assert.rejects(tg.handleUpdate(cbUpdate(u.tg, "p:s:ish", 870)));
  assert.equal(answers().length, 1, "MUTATSIYA 6");
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "zzz", 870));
  assert.equal(answers()[0]!.body.text, "Bu tugma eskirgan");
});

test("a name saved in the bot is not reverted by the next message", { skip }, async () => {
  const u = await newUser("Telegram Ism");
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "p:e:name", 880));
  await tg.handleUpdate(textUpdate(u.tg, "Dilnoza"));
  await tg.handleUpdate(textUpdate(u.tg, "👤 Profilim", { last_name: "Telegramdan" }));
  assert.equal(await col(u.id, "name"), "Dilnoza", "MUTATSIYA 5");
});

test("language: Profilim → Til → Русский: card re-rendered in Russian, keyboard re-sent, stored", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "l:m:p", 890));
  assert.match(String(edits()[0]!.body.text), /Bot tilini tanlang/);
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "l:s:ru:p", 890));
  assert.equal(await col(u.id, "language"), "ru");
  assert.match(String(edits()[0]!.body.text), /<b>Мой профиль<\/b>/);
  const kb = sends()[0]!.body.reply_markup as { keyboard: { text: string }[][] };
  assert.deepEqual(kb.keyboard[2]!.map((b) => b.text), ["👤 Мой профиль", "❓ Помощь"]);
  assert.equal(answers()[0]!.body.text, "Язык бота: русский");

  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "❓ Помощь"));
  assert.match(String(sends()[0]!.body.text), /<b>Помощь<\/b>/);
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "/start"));
  assert.match(String(sends()[0]!.body.text), /Здравствуйте/);
});

test("a NEW user gets the bot language from Telegram's language_code; an existing one keeps theirs", { skip }, async () => {
  const tgId = 7_500_000_000 + randomInt(0, 99_999_999);
  tgIds.push(String(tgId));
  installFetch();
  await tg.handleUpdate(textUpdate(tgId, "/start", { language_code: "en" }));
  const row = await queryOne<{ id: string; language: string }>("SELECT id::text AS id, language FROM users WHERE telegram_id = $1", [String(tgId)]);
  assert.equal(row!.language, "en");
  assert.match(String(sends()[0]!.body.text), /^👋 <b>Hello, Bot!<\/b>/);

  const old = await newUser();
  await tg.handleUpdate(textUpdate(old.tg, "/start", { language_code: "ru" }));
  assert.equal(await col(old.id, "language"), "uz");
});

test("Ishlarim: own files only, 5 per page, ◀️/▶️ edit the same message", { skip }, async () => {
  const u = await newUser();
  const stranger = await newUser();
  for (let i = 0; i < 7; i++) {
    await query(
      "INSERT INTO generations (id, user_id, tool_id, topic, status, progress, created_at) VALUES ($1, $2, 'slide', $3, 'COMPLETED', 100, now() - make_interval(mins => $4))",
      [randomUUID(), u.id, `Mavzu ${i}`, i],
    );
  }
  await query("INSERT INTO generations (id, user_id, tool_id, topic, status) VALUES ($1, $2, 'image', 'Begona', 'QUEUED')", [randomUUID(), stranger.id]);
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "📂 Ishlarim"));
  const page0 = String(sends()[0]!.body.text);
  assert.match(page0, /Ishlarim<\/b> · 1–5/);
  assert.match(page0, /«Mavzu 0»/);
  assert.doesNotMatch(page0, /Begona/);
  const b0 = buttons(sends()[0]!.body);
  assert.equal(b0.filter((b) => b.web_app?.url.includes("/uz/files/")).length, 5);
  assert.deepEqual(b0.filter((b) => b.callback_data).map((b) => b.callback_data), ["f:1"]);

  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "f:1", 900));
  const page1 = String(edits()[0]!.body.text);
  assert.match(page1, /6–7/);
  assert.match(page1, /«Mavzu 6»/);
  assert.deepEqual(buttons(edits()[0]!.body).filter((b) => b.callback_data).map((b) => b.callback_data), ["f:0"]);

  const empty = await newUser();
  installFetch();
  await tg.handleUpdate(textUpdate(empty.tg, "📂 Ishlarim"));
  assert.match(String(sends()[0]!.body.text), /Hali ishlaringiz yo‘q/);
  assert.equal(buttons(sends()[0]!.body)[0]!.web_app?.url, "https://slaydx.test/uz/create");
});

test("Hamyon → «Do‘st taklif qilish» → back; Yordam; a blocked tool answers «vaqtincha o‘chiq»", { skip }, async () => {
  const u = await newUser();
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "💰 Hamyon"));
  const w = String(sends()[0]!.body.text);
  assert.match(w, /Ro‘yxatdan o‘tish bonusi/);
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "w:r", 910));
  assert.ok(buttons(edits()[0]!.body).some((b) => b.copy_text?.text.startsWith("https://t.me/slaydx_test_bot?start=ref_")));
  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "w:h", 910));
  assert.match(String(edits()[0]!.body.text), /<b>Hamyon<\/b>/);

  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "❓ Yordam"));
  assert.match(String(sends()[0]!.body.text), /<blockquote expandable>/);

  // The hermetic test env has no LLM/image keys: every tool is blocked → a text button.
  installFetch();
  await tg.handleUpdate(textUpdate(u.tg, "📊 Slayd"));
  assert.match(String(sends()[0]!.body.text), /«Slayd» vaqtincha o‘chiq/);

  installFetch();
  await tg.handleUpdate(cbUpdate(u.tg, "r:n", 1));
  assert.equal(sends().length, 1, "welcome «Taklif» → a NEW referral message");
  assert.match(String(sends()[0]!.body.text), /Do'stlarni taklif qiling/);
});
