import test, { after } from "node:test";
import assert from "node:assert/strict";

/**
 * Bot update routing added for the mobile sprint (docs/mobile/PLAN.md §4.4):
 *   - `/start <payload>` that is not a login nonce (share/inline deep links,
 *     random text) → welcome + login buttons, never «Bu havola eskirgan»;
 *     a nonce-shaped payload that matches no ticket still gets «eskirgan»;
 *   - a stray `inline_query` → empty `answerInlineQuery` with a
 *     «SlaydX'ni ochish» button (Mini App on https, `/start inline` locally).
 *
 * Real Postgres (`handleUpdate` claims the update id); `fetch` stubbed with a
 * fake token, nothing reaches Telegram.
 *
 * Mutations (each turned a test red):
 *   1. `!isLoginNonce(nonce)` → `!nonce` (old behaviour) — «s_… payload → welcome»;
 *   2. `isLoginNonce` always true — same test; always false — «nonce-shaped unknown → eskirgan»;
 *   3. inline branch removed from `processUpdate` — «inline_query → answerInlineQuery»;
 *   4. `results: []` → one placeholder result — same test;
 *   5. local branch kept `web_app` — «local deployment → start_parameter».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-start-inline-token";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const envMod = await import("../lib/server/env.ts");
const env = envMod.env as unknown as { appUrl: string };
const { query, pool, ensureMigrated } = await import("../lib/server/db.ts");
const { handleUpdate } = await import("../lib/server/telegram.ts");
if (hasDb) await ensureMigrated();

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
function installFetch(): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected URL ${url}`);
    calls.push({ method: m[1], body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ ok: true, result: m[1] === "sendMessage" ? { message_id: 1 } : true }));
  }) as typeof fetch;
}

let seq = Date.now() * 1000 + 900_000;
const fromIds: number[] = [];
function startUpdate(text: string) {
  const fromId = 720_000_000 + Math.floor(Math.random() * 1_000_000);
  fromIds.push(fromId);
  return {
    update_id: ++seq,
    message: { chat: { id: fromId, type: "private" }, from: { id: fromId, first_name: "Start" }, text },
  };
}

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await query("DELETE FROM users WHERE telegram_id = ANY($1::bigint[])", [fromIds.map(String)]);
  await pool().end();
});

function buttons(body: Record<string, unknown>): { text: string; url?: string; web_app?: { url: string } }[] {
  const kb = (body.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined)?.inline_keyboard ?? [];
  return kb.flat();
}

for (const payload of ["s_00000000-0000-4000-8000-000000000001", "share", "inline", "salom dunyo"]) {
  test(`/start ${payload} (not a login nonce) → welcome with login buttons, not «eskirgan»`, { skip }, async () => {
    installFetch();
    await handleUpdate(startUpdate(`/start ${payload}`));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "sendMessage");
    const text = String(calls[0].body.text);
    assert.match(text, /Assalomu alaykum/);
    assert.doesNotMatch(text, /eskirgan/);
    const b = buttons(calls[0].body);
    assert.ok(b.some((x) => x.web_app?.url === "https://slaydx.test/uz"), "Mini App button");
    assert.ok(b.some((x) => /^https:\/\/slaydx\.test\/api\/auth\/telegram\/enter\?t=/.test(x.url ?? "")), "one-time login link");
  });
}

test("/start <nonce-shaped payload with no ticket> → still «Bu havola eskirgan»", { skip }, async () => {
  installFetch();
  await handleUpdate(startUpdate(`/start ${"Q".repeat(32)}`));
  assert.equal(calls.length, 1);
  assert.match(String(calls[0].body.text), /Bu havola eskirgan/);
  assert.equal(buttons(calls[0].body).length, 0);
});

test("m2: an update whose from/chat id is above 2^53 (already rounded by JSON.parse) is ignored — no reply, no user", { skip }, async () => {
  installFetch();
  const unsafe = 2 ** 53 + 2; // what JSON.parse makes of 9007199254740993: a DIFFERENT id
  assert.equal(Number.isSafeInteger(unsafe), false);
  await handleUpdate({ update_id: ++seq, message: { chat: { id: unsafe, type: "private" }, from: { id: unsafe, first_name: "Katta" }, text: "/start" } });
  await handleUpdate({ update_id: ++seq, message: { chat: { id: unsafe, type: "private" }, from: { id: 720_999_010, first_name: "Katta" }, text: "/start" } });
  assert.equal(calls.length, 0);
  const users = await query("SELECT 1 FROM users WHERE telegram_id = ANY($1::bigint[])", [[String(unsafe), "720999010"]]);
  assert.equal(users.length, 0, "nothing registered under a rounded id");
});

test("inline_query → one empty answerInlineQuery with a Mini App button, nothing else", { skip }, async () => {
  installFetch();
  const id = ++seq;
  await handleUpdate({
    update_id: id,
    inline_query: { id: "iq-777", from: { id: 720_999_001, first_name: "Inline" }, query: "slayd", offset: "" },
  });
  assert.deepEqual(calls, [
    {
      method: "answerInlineQuery",
      body: {
        inline_query_id: "iq-777",
        results: [],
        cache_time: 300,
        is_personal: false,
        button: { text: "SlaydX'ni ochish", web_app: { url: "https://slaydx.test/uz" } },
      },
    },
  ]);
  const users = await query("SELECT 1 FROM users WHERE telegram_id = 720999001");
  assert.equal(users.length, 0, "an inline query does not register a bot user");
  // Redelivery of the same update is ignored like any other update.
  await handleUpdate({ update_id: id, inline_query: { id: "iq-777", from: { id: 720_999_001 }, query: "", offset: "" } });
  assert.equal(calls.length, 1);
});

test("inline_query on a local (non-https) deployment → start_parameter button instead of web_app", { skip }, async () => {
  installFetch();
  const prev = env.appUrl;
  env.appUrl = "http://localhost:3000";
  try {
    await handleUpdate({ update_id: ++seq, inline_query: { id: "iq-local", from: { id: 720_999_002 }, query: "", offset: "" } });
  } finally {
    env.appUrl = prev;
  }
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.button, { text: "SlaydX'ni ochish", start_parameter: "inline" });
});

test("inline_query answer failing (query too old, 400) does not throw — the update is done", { skip }, async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: query is too old" }), { status: 400 })) as typeof fetch;
  const id = ++seq;
  await handleUpdate({ update_id: id, inline_query: { id: "iq-old", from: { id: 720_999_003 }, query: "", offset: "" } });
  const rows = await query("SELECT 1 FROM telegram_updates WHERE update_id = $1", [id]);
  assert.equal(rows.length, 1, "the update stays claimed (not redelivered)");
});
