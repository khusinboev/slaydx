import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";

/**
 * Bot `/alifbo` (owner request 6): the bot has no converter logic — it explains the tool and opens the Mini App page.
 * Updates go through `handleUpdate` with the Bot API stubbed at `fetch`; real Postgres (test DB only).
 *
 * Mutations (restored): the `/alifbo` branch removed from `telegram.ts` -> «/alifbo sends the explanation»;
 * "alifbo" dropped from BOT_COMMANDS -> «menu command».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-bot-alifbo-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
delete process.env.BOT_PREMIUM_EMOJI;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, ensureMigrated } = await import("../lib/server/db.ts");
const tg = await import("../lib/server/telegram.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { alifboScreen } = await import("../lib/server/bot/screens.ts");
const { t, LANGS } = await import("../lib/server/bot/i18n.ts");
if (hasDb) await ensureMigrated();

type Call = { method: string; body: { text?: string; reply_markup?: { inline_keyboard: { web_app?: { url: string } }[][] } } };
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
const tgIds: string[] = [];
let seq = Date.now() * 1000 + 700_000;
const textUpdate = (from: number, text: string) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Alifbo" }, text },
});
after(async () => {
  globalThis.fetch = realFetch;
  if (hasDb && tgIds.length) await query("DELETE FROM users WHERE telegram_id = ANY($1::text[])", [tgIds]).catch(() => undefined);
});

test("alifboScreen: text in three languages and ONE web_app button to /uz/alifbo", () => {
  for (const lang of LANGS) {
    const s = alifboScreen(lang);
    assert.match(s.text, /ЎРҚ-1184/);
    const buttons = (s.reply_markup as { inline_keyboard: { text: string; web_app?: { url: string } }[][] }).inline_keyboard.flat();
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0]!.web_app?.url, "https://slaydx.test/uz/alifbo");
    assert.ok(buttons[0]!.text.endsWith(t(lang, "alifbo.open")), buttons[0]!.text);
  }
  assert.match(alifboScreen("uz").text, /Alifbo o‘giruvchi/);
  assert.match(alifboScreen("ru").text, /Конвертер алфавита/);
  assert.match(alifboScreen("en").text, /Alphabet converter/);
});

test("menu command: /alifbo is listed with a description in every language", () => {
  assert.ok((tg.BOT_COMMANDS as readonly string[]).includes("alifbo"));
  for (const lang of LANGS) assert.ok(t(lang, "cmd.alifbo").length > 5, lang);
});

test("/alifbo sends the explanation with the Mini App button", { skip }, async () => {
  installFetch();
  const tgId = 7_600_000_000 + randomInt(0, 99_999_999);
  tgIds.push(String(tgId));
  await upsertTelegramUser({ telegramId: String(tgId), username: null, name: "Alifbo Bot", photoUrl: null });
  await tg.handleUpdate(textUpdate(tgId, "/alifbo"));
  const sent = calls.filter((c) => c.method === "sendMessage");
  assert.equal(sent.length, 1);
  assert.match(String(sent[0]!.body.text), /Alifbo o‘giruvchi/);
  assert.equal(sent[0]!.body.reply_markup!.inline_keyboard[0]![0]!.web_app!.url, "https://slaydx.test/uz/alifbo");
});
