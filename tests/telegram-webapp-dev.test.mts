import test from "node:test";
import assert from "node:assert/strict";

/**
 * Dev fallback: `APP_URL` is not public https (localhost), so Telegram would
 * reject both the `web_app` and the `url` button ("Wrong HTTP URL"). `/start`
 * and `/login` then send the link in the text and no inline keyboard (B2: a
 * private `/start` still gets the main reply keyboard, without web_app tools).
 * `env.appUrl` is read at module load, hence a separate file from
 * `tests/telegram-webapp-buttons.test.mts`. `fetch` is stubbed.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "http://localhost:3000";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token-fake-1234567890";

const skip = hasDb ? false : "DATABASE_URL yo'q";

let calls: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;
function installFetchMock(): void {
  calls = [];
  globalThis.fetch = (async (_url: string | URL, init?: { body?: unknown }) => {
    calls.push(init?.body ? JSON.parse(String(init.body)) : {});
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) } as Response;
  }) as typeof fetch;
}

let seq = Date.now() * 1000 + 900;
const createdIds: string[] = [];
const mods = hasDb
  ? { db: await import("../lib/server/db.ts"), tg: await import("../lib/server/telegram.ts") }
  : null;
if (mods) await mods.db.ensureMigrated();

test.after(async () => {
  globalThis.fetch = realFetch;
  if (mods && createdIds.length) {
    await mods.db.query("DELETE FROM users WHERE telegram_id = ANY($1)", [createdIds]);
    await mods.db.query("DELETE FROM login_tickets WHERE telegram_id = ANY($1)", [createdIds]);
  }
});

for (const [command, fromId] of [["/start", 700000301], ["/login", 700000302]] as const) {
  test(`${command} on localhost: link in the text, no keyboard`, { skip }, async () => {
    installFetchMock();
    createdIds.push(String(fromId));
    await mods!.tg.handleUpdate({
      update_id: ++seq,
      message: { chat: { id: fromId, type: "private" }, text: command, from: { id: fromId, first_name: "Dev" } },
    });
    // B2: a private /start also sends the main reply keyboard (its own message); its
    // chat buttons work locally, the tools get no web_app (no public URL → `botAppUrl` null).
    assert.equal(calls.length, command === "/start" ? 2 : 1);
    const body = calls[0]!;
    assert.ok(!("reply_markup" in body), "no inline keyboard on a non-public APP_URL");
    assert.match(String(body.text), /\n\nhttp:\/\/localhost:3000\/api\/auth\/telegram\/enter\?t=[A-Za-z0-9_-]{40,}$/);
    if (command === "/start") {
      const kb = calls[1]!.reply_markup as { keyboard: Record<string, unknown>[][] };
      assert.ok(kb.keyboard.flat().length === 10, "ten reply buttons (keyboard v2: 5 rows × 2)");
      assert.ok(!JSON.stringify(kb).includes("web_app"), "no web_app on localhost");
    }
  });
}
