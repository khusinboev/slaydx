import test from "node:test";
import assert from "node:assert/strict";

/**
 * Bot `/start` va `/login`: bitta xabar, ikki qatorli inline klaviatura —
 * 1) «📱 Ilovada ochish» (`web_app`, Telegram ichidagi Mini App),
 * 2) «🌐 Saytda ochish» (bir martalik kirish havolasi, `url`).
 * `/start <nonce>` (saytdan boshlangan kirish) o'zgarmaydi: bitta tugma.
 *
 * `env.appUrl` modul yuklanganda o'qiladi — shu fayl public https manzil bilan
 * ishlaydi; lokal (dev) holat `tests/telegram-webapp-dev.test.mts` da.
 * `fetch` stub: Telegram'ga hech qanday real so'rov ketmaydi.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token-fake-1234567890";

const skip = hasDb ? false : "DATABASE_URL yo'q";

type Caught = { url: string; body: Record<string, unknown> };
let calls: Caught[] = [];
const realFetch = globalThis.fetch;

function installFetchMock(): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), body });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) } as Response;
  }) as typeof fetch;
}

let seq = Date.now() * 1000 + 500;
const nextUpdateId = () => ++seq;
const createdIds: string[] = [];

const mods = hasDb
  ? {
      db: await import("../lib/server/db.ts"),
      tg: await import("../lib/server/telegram.ts"),
    }
  : null;
if (mods) await mods.db.ensureMigrated();

test.after(async () => {
  globalThis.fetch = realFetch;
  if (mods && createdIds.length) {
    await mods.db.query("DELETE FROM users WHERE telegram_id = ANY($1)", [createdIds]);
    await mods.db.query("DELETE FROM login_tickets WHERE telegram_id = ANY($1)", [createdIds]);
  }
});

/** The one-time link inside the keyboard; its token is random, so it is checked by pattern. */
const LINK = /^https:\/\/slaydx\.test\/api\/auth\/telegram\/enter\?t=[A-Za-z0-9_-]{40,}$/;

function assertTwoButtonKeyboard(body: Record<string, unknown>): string {
  const kb = (body.reply_markup as { inline_keyboard: Record<string, unknown>[][] }).inline_keyboard;
  assert.equal(kb.length, 2, "two rows: each button on its own row");
  assert.equal(kb[0]!.length, 1);
  assert.equal(kb[1]!.length, 1);
  assert.deepEqual(kb[0]![0], { text: "📱 Ilovada ochish", web_app: { url: "https://slaydx.test/uz" } });
  const site = kb[1]![0] as { text: string; url: string };
  assert.deepEqual(Object.keys(site).sort(), ["text", "url"]);
  assert.equal(site.text, "🌐 Saytda ochish");
  assert.match(site.url, LINK);
  return site.url;
}

async function send(fromId: number, text: string): Promise<Record<string, unknown>> {
  createdIds.push(String(fromId));
  await mods!.tg.handleUpdate({
    update_id: nextUpdateId(),
    message: { chat: { id: fromId, type: "private" }, text, from: { id: fromId, first_name: "Test" } },
  });
  assert.equal(calls.length, 1, "exactly one sendMessage");
  assert.match(calls[0]!.url, /\/sendMessage$/);
  return calls[0]!.body;
}

test("/start: one message, Mini App button then one-time site link, text explains both", { skip }, async () => {
  installFetchMock();
  const body = await send(700000201, "/start");
  const link = assertTwoButtonKeyboard(body);
  const text = String(body.text);
  assert.match(text, /Ilovada ochish/);
  assert.match(text, /Saytda ochish/);
  assert.ok(!text.includes(link), "with buttons the link is not repeated in the text");
  const result = await mods!.tg.redeemLoginToken(new URL(link).searchParams.get("t")!);
  assert.equal(result.ok, true, "the site button carries a working one-time link");
});

test("/login: the same two-button keyboard with a fresh link", { skip }, async () => {
  installFetchMock();
  const body = await send(700000202, "/login");
  assertTwoButtonKeyboard(body);
  assert.match(String(body.text), /Ilovada ochish/);
});

test("/start <nonce>: unchanged — a single 'Saytga kirish' url button, no web_app", { skip }, async () => {
  installFetchMock();
  const ticket = await mods!.tg.createTicket("SlaydXBot");
  const body = await send(700000203, `/start ${ticket.nonce}`);
  const kb = (body.reply_markup as { inline_keyboard: Record<string, unknown>[][] }).inline_keyboard;
  assert.equal(kb.length, 1);
  assert.equal(kb[0]!.length, 1);
  assert.equal(kb[0]![0]!.text, "🔑 Saytga kirish");
  assert.match(String(kb[0]![0]!.url), LINK);
  assert.ok(!JSON.stringify(body).includes("web_app"), "website login flow never offers the Mini App");
});
