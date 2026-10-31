/**
 * Bot `/test` (owner request 7): it opens the Mini App page `/uz/tests` with a WebApp button, shows the server's price,
 * says "closed" while the kill switch is off, and does no business logic itself (nothing charged, no attempt created).
 * Real Postgres in its own throwaway database; Telegram is stubbed at `fetch`.
 *
 * Mutation checks (each broken on purpose, the named test failed, then restored):
 *   1. the kill switch ignored in `entryScreen`                  -> «closed while tests.enabled is off»;
 *   2. the command left out of `BOT_COMMANDS`                    -> «/test is in the bot menu»;
 *   3. the WebApp button pointing at another page               -> «opens the Mini App page».
 */
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-tests-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
delete process.env.BOT_PREMIUM_EMOJI;
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { clearSetting, setSetting } from "./helpers/chat-fixtures.mts";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("testsbot") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const { query, pool, ensureMigrated } = await import("../lib/server/db.ts");
const tg = await import("../lib/server/telegram.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const i18n = await import("../lib/server/bot/i18n.ts");
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

let seq = Date.now() * 1000 + 900_000;
const textUpdate = (from: number, text: string) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Talaba" }, text },
});
async function newUser(lang = "uz"): Promise<number> {
  const tgId = 7_800_000_000 + randomInt(0, 99_999_999);
  const u = await upsertTelegramUser({ telegramId: String(tgId), username: null, name: "Test Bot", photoUrl: null });
  await query("UPDATE users SET language = $2 WHERE id = $1", [u.id, lang]);
  return tgId;
}
const last = () => calls.filter((c) => c.method === "sendMessage").at(-1)!;
const buttons = (c: Call) => ((c.body.reply_markup as { inline_keyboard?: { text: string; web_app?: { url: string } }[][] } | undefined)?.inline_keyboard ?? []).flat();
const attemptsCount = async () => Number((await query<{ n: string }>("SELECT count(*) n FROM test_attempts"))[0]!.n);

test("/test is in the bot menu with a description in all three languages", () => {
  assert.ok(tg.BOT_COMMANDS.includes("test"));
  for (const lang of i18n.LANGS) assert.ok(i18n.t(lang, "tests.cmd").length > 3, lang);
});

test("closed while tests.enabled is off: a notice, no button, nothing charged", { skip }, async () => {
  await clearSetting(query, "tests.enabled");
  const id = await newUser();
  await tg.handleUpdate(textUpdate(id, "/test"));
  assert.match(String(last().body.text), /Testlar hozircha yopiq/);
  assert.equal(buttons(last()).length, 0);
  assert.equal(await attemptsCount(), 0);
});

test("opens the Mini App page with the server's prices per mode (and the free first attempt)", { skip }, async () => {
  await setSetting(query, "tests.enabled", true);
  const id = await newUser();
  await tg.handleUpdate(textUpdate(id, "/test"));
  assert.match(String(last().body.text), /Test ishlash/);
  assert.match(String(last().body.text), /bitta fan — <b>1\s?500 so‘m<\/b>, «Hammasi» — <b>4\s?000 so‘m<\/b>/);
  assert.match(String(last().body.text), /AI tahlili/);
  const btn = buttons(last());
  assert.equal(btn.length, 1, "no result button before any finished attempt");
  assert.equal(btn[0]!.web_app?.url, "https://slaydx.test/uz/tests", "opens the Mini App page");
  assert.equal(await attemptsCount(), 0, "the bot starts nothing and charges nothing");

  await setSetting(query, "tests.price_subject", 3500);
  await setSetting(query, "tests.price_all", 9000);
  await tg.handleUpdate(textUpdate(id, "/test"));
  assert.match(String(last().body.text), /3\s?500 so‘m/);
  assert.match(String(last().body.text), /9\s?000 so‘m/);

  await setSetting(query, "tests.first_attempt_free", true);
  await tg.handleUpdate(textUpdate(id, "/test"));
  assert.match(String(last().body.text), /Birinchi urinish <b>bepul<\/b>/);
  await clearSetting(query, "tests.first_attempt_free");
  await clearSetting(query, "tests.price_subject");
  await clearSetting(query, "tests.price_all");
  await clearSetting(query, "tests.enabled");
});

test("the latest finished attempt gets a button to its web result page (the AI analysis lives there)", { skip }, async () => {
  await setSetting(query, "tests.enabled", true);
  const tgId = await newUser();
  const uid = (await query<{ id: string }>("SELECT id::text AS id FROM users WHERE telegram_id = $1", [String(tgId)]))[0]!.id;
  const bank = (await query<{ id: string }>("INSERT INTO test_banks (slug, title) VALUES ('bot-' || $1, 'B') RETURNING id::text AS id", [String(tgId)]))[0]!.id;
  const mk = async (status: "active" | "finished", startedAt: string) =>
    (await query<{ id: string }>(
      `INSERT INTO test_attempts (id, user_id, bank_id, mode, question_ids, total, status, started_at, deadline_at, finished_at, points_per_correct, correct, score, key_snapshot)
       VALUES (gen_random_uuid(), $1, $2, 'all', '[1]'::jsonb, 1, $3, $4::timestamptz, $4::timestamptz + interval '1 hour',
               CASE WHEN $3 = 'finished' THEN $4::timestamptz END, 1.1, CASE WHEN $3 = 'finished' THEN 0 END, CASE WHEN $3 = 'finished' THEN 0 END,
               CASE WHEN $3 = 'finished' THEN ARRAY[0]::smallint[] END) RETURNING id::text AS id`,
      [uid, bank, status, startedAt],
    ))[0]!.id;
  await mk("finished", "2026-10-01T10:00:00Z");
  const latest = await mk("finished", "2026-10-02T10:00:00Z");
  await tg.handleUpdate(textUpdate(tgId, "/test"));
  const btn = buttons(last());
  assert.equal(btn.length, 2);
  assert.equal(btn[1]!.web_app?.url, `https://slaydx.test/uz/tests?attempt=${latest}`, "the newest finished attempt");
  assert.match(btn[1]!.text, /AI tahlil/);
  await clearSetting(query, "tests.enabled");
});

test("speaks the user's language", { skip }, async () => {
  await setSetting(query, "tests.enabled", true);
  const ru = await newUser("ru");
  await tg.handleUpdate(textUpdate(ru, "/test"));
  assert.match(String(last().body.text), /один предмет/);
  assert.match(buttons(last())[0]!.text, /Открыть тесты/);
  const en = await newUser("en");
  await tg.handleUpdate(textUpdate(en, "/test"));
  assert.match(String(last().body.text), /one subject/);
  await clearSetting(query, "tests.enabled");
});
