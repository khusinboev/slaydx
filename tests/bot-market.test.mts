/**
 * Bot side of «Ishlar bozori» (docs/market/PLAN.md §7, §10.3): the keyboard button and `/market` exist only with the
 * switch on, the screen lists the 5 newest items of the web's own service with web_app links, the profile toggle calls
 * the web's opt-out service. Nothing here charges or creates anything. Real Postgres in its own throwaway database;
 * Telegram is stubbed at `fetch`.
 *
 * Mutations (each turned the named test red, then restored byte for byte):
 *   1. `...(opts.market ? …)` always adds the row                     -> «keyboard: only with the switch»;
 *   2. the `market` spec without `path`                               -> «keyboard: only with the switch»;
 *   3. `sendMarket` without the `marketEnabled` check                 -> «/market: closed»;
 *   4. `MARKET_SCREEN_ITEMS` slice removed                            -> «screen: at most five»;
 *   5. the item button's path without the id                          -> «/market: the five newest»;
 *   6. `esc` dropped from the title line                              -> «screen: a title is escaped»;
 *   7. `marketOptOutState` always returns a boolean                   -> «profile: no line while the market is off»;
 *   8. the callback sets `!c.optOut`                                  -> «profile: the toggle»;
 *   9. `parseCallback` accepts `m:o:2`                                -> «callback codes»;
 *  10. `refreshBotMenuFor` without `market.enabled`, and `setBotCommands` without the filter -> «menu».
 */
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-market-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
delete process.env.BOT_PREMIUM_EMOJI;
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { clearSetting, setSetting } from "./helpers/chat-fixtures.mts";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("botmarket") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const tg = await import("../lib/server/telegram.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const i18n = await import("../lib/server/bot/i18n.ts");
const kbd = await import("../lib/server/bot/keyboard.ts");
const codes = await import("../lib/server/bot/codes.ts");
const scr = await import("../lib/server/bot/screens.ts");
const { invalidateMarketCatalogCache } = await import("../lib/server/market/search.ts");
if (!skip) await ensureMigrated();

const realFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = realFetch;
  if (skip) return;
  await pool().end();
  await iso.drop();
});

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected outgoing URL ${String(url)}`);
    calls.push({ method: m[1]!, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ ok: true, result: m[1] === "sendMessage" ? { message_id: 9 } : true }));
  }) as typeof fetch;
});

let seq = Date.now() * 1000 + 700_000;
const textUpdate = (from: number, text: string) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Talaba" }, text },
});
const cbUpdate = (from: number, data: string) => ({
  update_id: ++seq,
  callback_query: { id: `cq${++seq}`, from: { id: from }, message: { message_id: 555, chat: { id: from, type: "private" } }, data },
});
async function newUser(): Promise<{ id: string; tg: number }> {
  const tgId = 7_700_000_000 + randomInt(0, 99_999_999);
  const u = await upsertTelegramUser({ telegramId: String(tgId), username: null, name: "Bot Market", photoUrl: null });
  return { id: u.id, tg: tgId };
}
type Btn = { text: string; style?: string; callback_data?: string; web_app?: { url: string } };
const buttons = (c: Call | { reply_markup?: unknown } | undefined): Btn[] => {
  const markup = c && "body" in c ? c.body.reply_markup : (c as { reply_markup?: unknown } | undefined)?.reply_markup;
  return ((markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []).flat();
};
const lastSend = () => calls.filter((c) => c.method === "sendMessage").at(-1)!;
const lastEdit = () => calls.filter((c) => c.method === "editMessageText").at(-1)!;
const toasts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text);

let itemSeq = 0;
async function mkItem(title: string, approvedAgoMin: number): Promise<string> {
  const n = ++itemSeq;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO market_items (tool_id, title, doc_json, params_json, topic_norm, status, approved_at, original_price)
     VALUES ('referat', $1, '{"meta":{}}'::jsonb, '{"pages":10}'::jsonb, $2, 'active', now() - make_interval(mins => $3), 6000) RETURNING id`,
    [title, `bot-${n}`, approvedAgoMin],
  );
  return row!.id;
}

/* ─────────────────────────── pure ─────────────────────────── */

const FEATURES = { llm: true, images: true };

test("keyboard: only with the switch; a personal web_app link to the market", () => {
  const off = kbd.mainKeyboard("uz", 7_300_000_001, FEATURES) as { keyboard: Btn[][] };
  assert.equal(off.keyboard.length, 5, "no market row while the switch is off");
  assert.ok(!off.keyboard.flat().some((b) => b.text.includes("Ishlar bozori")));
  const on = kbd.mainKeyboard("uz", 7_300_000_001, FEATURES, { market: true }) as { keyboard: Btn[][] };
  assert.equal(on.keyboard.length, 6);
  const btn = on.keyboard[5]![0]!;
  assert.equal(btn.text, "🛍 Ishlar bozori");
  assert.match(btn.web_app!.url, /^https:\/\/slaydx\.test\/uz\/market\?.*bt=/, "a reply-keyboard WebApp needs the personal link");
  const admin = kbd.mainKeyboard("uz", 1, FEATURES, { market: true, admin: true }) as { keyboard: Btn[][] };
  assert.equal(admin.keyboard.length, 7, "the admin row stays last");
  assert.equal(kbd.keyboardPath("market"), "/uz/market");
  assert.equal(kbd.isToolAction("market"), false, "not a tool: no block reason, no tool label");
});

test("keyboard: the label is matched in every language", () => {
  for (const lang of i18n.LANGS) {
    assert.equal(kbd.matchKeyboard(`🛍 ${i18n.t(lang, "kb.market")}`), "market", lang);
    assert.equal(kbd.matchKeyboard(i18n.t(lang, "kb.market")), "market", lang);
  }
});

test("screen: at most five; a title is escaped; prices are as given; without a public URL no buttons", async () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ id: `id-${i}`, title: `Ish <${i}>`, price: 1500 }));
  const s = scr.marketScreen("uz", items);
  assert.equal(String(s.text).match(/ so‘m/g)!.length, 5);
  assert.ok(String(s.text).includes("Ish &lt;0&gt;"), "HTML parse mode: user-visible text is escaped");
  const b = buttons(s);
  assert.equal(b.length, 6, "five items + «Hammasini ko‘rish»");
  assert.match(b[0]!.text, /^1\. Ko‘rish — 1\s500 so‘m$/);
  assert.equal(b[5]!.web_app!.url, "https://slaydx.test/uz/market");
  assert.equal(b[5]!.style, "primary");
  for (const lang of i18n.LANGS) assert.ok(scr.marketScreen(lang, []).text.includes(i18n.t(lang, "market.empty")), lang);
  const { env } = (await import("../lib/server/env.ts")) as unknown as { env: { appUrl: string } };
  const prev = env.appUrl;
  env.appUrl = "http://localhost:3000";
  try {
    assert.equal(buttons(scr.marketScreen("uz", items)).length, 0);
  } finally {
    env.appUrl = prev;
  }
});

test("callback codes", () => {
  assert.equal(codes.cb.marketOptOut(true), "m:o:1");
  assert.equal(codes.cb.marketOptOut(false), "m:o:0");
  assert.deepEqual(codes.parseCallback("m:o:1"), { kind: "marketOptOut", optOut: true });
  assert.deepEqual(codes.parseCallback("m:o:0"), { kind: "marketOptOut", optOut: false });
  for (const bad of ["m:o:2", "m:o", "m:o:1:1", "m:x:1"]) assert.deepEqual(codes.parseCallback(bad), { kind: "unknown" }, bad);
});

test("menu: /market has a description in all three languages and follows the switch", { skip }, async () => {
  assert.ok((tg.BOT_COMMANDS as readonly string[]).includes("market"));
  for (const lang of i18n.LANGS) assert.ok(i18n.t(lang, "cmd.market").length > 3, lang);
  const listed = () => {
    const uz = calls.filter((c) => c.method === "setMyCommands")[0]!;
    return (uz.body.commands as { command: string }[]).map((c) => c.command);
  };
  await clearSetting(query, "market.enabled");
  await tg.setBotCommands();
  assert.ok(!listed().includes("market"));
  calls = [];
  await setSetting(query, "market.enabled", true);
  await tg.setBotCommands();
  assert.ok(listed().includes("market"));
  await clearSetting(query, "market.enabled");
});

/* ─────────────────────────── through handleUpdate ─────────────────────────── */

test("/market: closed while the switch is off: a notice, no buttons", { skip }, async () => {
  await clearSetting(query, "market.enabled");
  const u = await newUser();
  await tg.handleUpdate(textUpdate(u.tg, "/market"));
  assert.match(String(lastSend().body.text), /hozircha yopiq/);
  assert.equal(buttons(lastSend()).length, 0);
});

test("/market: the five newest from the web's service, each a web_app deep link; nothing is bought", { skip }, async () => {
  await setSetting(query, "market.enabled", true);
  await query("DELETE FROM market_items");
  invalidateMarketCatalogCache();
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) ids.push(await mkItem(`Bozor ishi ${i}`, i + 1));
  const u = await newUser();
  await tg.handleUpdate(textUpdate(u.tg, "/market"));
  const send = lastSend();
  assert.match(String(send.body.text), /Ishlar bozori/);
  assert.ok(String(send.body.text).includes("1. Bozor ishi 0"), "newest first");
  assert.ok(!String(send.body.text).includes("Bozor ishi 5"), "the sixth is left out");
  const b = buttons(send);
  assert.equal(b[0]!.web_app!.url, `https://slaydx.test/uz/market/${ids[0]}`);
  assert.match(b[0]!.text, /^1\. Ko‘rish — \d/);
  assert.equal(Number((await queryOne<{ n: string }>("SELECT count(*) AS n FROM market_purchases"))!.n), 0);
  await clearSetting(query, "market.enabled");
});

test("the keyboard text opens the same screen (no public URL, or a keyboard older than the switch)", { skip }, async () => {
  await clearSetting(query, "market.enabled");
  const u = await newUser();
  await tg.handleUpdate(textUpdate(u.tg, "🛍 Ishlar bozori"));
  assert.match(String(calls.filter((c) => c.method === "sendMessage")[0]!.body.text), /hozircha yopiq/);
});

test("the main keyboard carries the button once the switch is on", { skip }, async () => {
  const u = await newUser();
  await clearSetting(query, "market.enabled");
  await tg.handleUpdate(textUpdate(u.tg, "👤 Profil"));
  const has = () => calls.some((c) => JSON.stringify((c.body.reply_markup as { keyboard?: unknown } | undefined)?.keyboard ?? "").includes("Ishlar bozori"));
  assert.ok(calls.some((c) => (c.body.reply_markup as { keyboard?: unknown } | undefined)?.keyboard), "the keyboard went out");
  assert.ok(!has());
  await query("UPDATE bot_chat_state SET keyboard_at = NULL WHERE chat_id = $1", [u.tg]);
  await setSetting(query, "market.enabled", true);
  calls = [];
  await tg.handleUpdate(textUpdate(u.tg, "👤 Profil"));
  assert.ok(has());
  await clearSetting(query, "market.enabled");
});

test("profile: no line while the market is off", { skip }, async () => {
  await clearSetting(query, "market.enabled");
  const u = await newUser();
  await tg.handleUpdate(textUpdate(u.tg, "/start"));
  calls = [];
  await tg.handleUpdate(textUpdate(u.tg, "👤 Profil"));
  assert.ok(!buttons(calls.filter((c) => c.method === "sendMessage")[0]).some((b) => b.callback_data?.startsWith("m:o:")));
});

test("profile: the toggle goes through the web's service: the flag, the waiting candidates, the card", { skip }, async () => {
  await setSetting(query, "market.enabled", true);
  const u = await newUser();
  await query(
    `INSERT INTO market_items (source_user_id, tool_id, title, doc_json, topic_norm, status) VALUES ($1, 'referat', 'Kutayotgan', '{}'::jsonb, 'kutayotgan', 'candidate')`,
    [u.id],
  );
  await tg.handleUpdate(cbUpdate(u.tg, "p:h"));
  const off = buttons(lastEdit()).find((b) => b.callback_data?.startsWith("m:o:"))!;
  assert.equal(off.text, "⬜️ Mening ishlarim bozorga chiqmasin");
  assert.equal(off.callback_data, "m:o:1");

  await tg.handleUpdate(cbUpdate(u.tg, off.callback_data!));
  assert.equal((await queryOne<{ v: boolean }>("SELECT market_opt_out AS v FROM users WHERE id = $1", [u.id]))!.v, true);
  assert.equal(Number((await queryOne<{ n: string }>("SELECT count(*) AS n FROM market_items WHERE source_user_id = $1", [u.id]))!.n), 0, "the queue row is gone");
  assert.equal(toasts().at(-1), "Ishlaringiz bozorga chiqmaydi");
  const on = buttons(lastEdit()).find((b) => b.callback_data?.startsWith("m:o:"))!;
  assert.equal(on.text, "✅ Mening ishlarim bozorga chiqmasin");
  assert.equal(on.callback_data, "m:o:0");

  await tg.handleUpdate(cbUpdate(u.tg, on.callback_data!));
  assert.equal((await queryOne<{ v: boolean }>("SELECT market_opt_out AS v FROM users WHERE id = $1", [u.id]))!.v, false);
  assert.equal(toasts().at(-1), "Tanlov bekor qilindi");
  await clearSetting(query, "market.enabled");
});
