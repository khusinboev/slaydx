import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * In-bot admin panel «💳 To‘lov bonusi» (C-Q4, docs/bonus/BONUS3.md) end to end: every update goes
 * through `handleUpdate` with the Bot API stubbed at `fetch`, on its OWN throwaway database — the
 * percent is a global setting, so changing it in the shared test DB would race other files that
 * render or pay the bonus (bonus-bot, bonus-channels). Same helpers as bot-admin.test.mts.
 *
 * Owner 2026-10-09: the card is a REPLY keyboard (presets + «Boshqa» + «Orqaga»); a tap arrives as a plain text
 * message mapped back to the `a:*` code (`bot_admin_state.keys`) and runs the same handler. The flows below TYPE the
 * button labels (`press`); `cbUpdate` is kept only for forged / old inline buttons still in the chat history.
 *
 * Mutations (each turned a test red, then restored):
 *   - `PERM.pbSet` "settings.edit" → "settings.view"              → «finance / viewer read-only», «2FA mode»;
 *   - code bound `<= 50` → `<= 99` (admin-codes.ts isPercentCode) → «card → 15% …» (forged a:pk:51);
 *   - typed value bound dropped (`percentFromText` returns any n) → «card → 15% …» («51» accepted);
 *   - `allowed()` skipped in `handleAdminCallback` → «downgraded owner», «finance / viewer»;
 *   - step-up skipped for reply taps (`messageId === null`) → «2FA mode».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-admin-bot-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
delete process.env.BOT_PREMIUM_EMOJI;
delete process.env.ADMIN_2FA_REQUIRED;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("botpaybonus") : { isolated: false, drop: async () => {} };
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const tg = await import("../lib/server/telegram.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
if (hasDb) await ensureMigrated();

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let msgSeq = 1000;
const realFetch = globalThis.fetch;
function installFetch(): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected URL ${url}`);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method: m[1]!, body });
    const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
    if (/^send(Message|Photo|Video)$/.test(m[1]!)) {
      if (m[1] === "sendMessage" && kb(body).length) shown.set(Number(body.chat_id), labels(body));
      return ok({ message_id: ++msgSeq });
    }
    return ok(true);
  }) as typeof fetch;
}

let seq = Date.now() * 1000 + 900_000;
async function newAdmin(role = "owner"): Promise<{ id: string; tg: number; adminId: string }> {
  const tgId = 7_900_000_000 + randomInt(0, 99_999_999);
  const u = await upsertTelegramUser({ telegramId: String(tgId), username: null, name: "Admin Bot", photoUrl: null });
  const a = await queryOne<{ id: string }>("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, $2, 'active') RETURNING id::text AS id", [u.id, role]);
  return { id: u.id, tg: tgId, adminId: a!.id };
}
const textUpdate = (from: number, text: string) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" }, from: { id: from, first_name: "Admin" }, text },
});
const cbUpdate = (from: number, data: string, messageId = 555) => ({
  update_id: ++seq,
  callback_query: { id: `cq${++seq}`, from: { id: from }, message: { message_id: messageId, chat: { id: from, type: "private" } }, data },
});
const sends = () => calls.filter((c) => c.method === "sendMessage");
const edits = () => calls.filter((c) => c.method === "editMessageText");
const toasts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text as string | undefined);
const texts = () => sends().map((c) => String(c.body.text));
type Key = { text: string; style?: string };
const kb = (body: Record<string, unknown>): Key[][] => (body.reply_markup as { keyboard?: Key[][] } | undefined)?.keyboard ?? [];
const labels = (body: Record<string, unknown>): string[] => kb(body).flat().map((b) => b.text);
type ScreenKey = { text: string; code: string };
/** The label → code map the bot stored for the chat's current screen. */
const keysOf = async (chat: number): Promise<ScreenKey[]> =>
  (await queryOne<{ keys: ScreenKey[] | null }>("SELECT keys FROM bot_admin_state WHERE chat_id = $1", [chat]))?.keys ?? [];
const offered = async (chat: number): Promise<string[]> => (await keysOf(chat)).map((k) => k.code);
const stepOf = async (chat: number) => (await queryOne<{ step: string | null }>("SELECT step FROM bot_admin_state WHERE chat_id = $1", [chat]))?.step ?? null;
/** The label of the button for `code` on the current screen (and proof the phone shows it). */
async function labelFor(chat: number, code: string): Promise<string> {
  const k = (await keysOf(chat)).find((x) => x.code === code);
  assert.ok(k, `the current screen has no button for ${code}`);
  assert.ok(shown.get(chat)?.includes(k!.text), `«${k!.text}» is not on the keyboard the chat shows`);
  return k!.text;
}
/** Taps the button for `code`: its label arrives as a plain text message. */
const press = async (a: { tg: number }, code: string): Promise<void> => tg.handleUpdate(textUpdate(a.tg, await labelFor(a.tg, code)));
/** The labels of the reply keyboard each chat last received. */
const shown = new Map<number, string[]>();
const audit = (adminId: string, action: string) =>
  query<{ outcome: string; meta: Record<string, unknown> | null; target_id: string | null; user_agent: string | null; after: Record<string, unknown> | null }>(
    "SELECT outcome, meta, target_id, user_agent, after FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id",
    [adminId, action],
  );

after(async () => {
  globalThis.fetch = realFetch;
  if (hasDb) {
    await pool().end();
    await iso.drop();
  }
});

/* ── To‘lov bonusi (C-Q4): the web's `payment_bonus_percent` through `payment-bonus.ts` ── */

const pbValue = async () =>
  (await queryOne<{ v: unknown }>("SELECT value AS v FROM app_settings WHERE key = 'payment_bonus_percent'"))?.v ?? null;
const pbReset = async () => {
  await query("DELETE FROM app_settings WHERE key = 'payment_bonus_percent'");
  (await import("../lib/server/settings.ts")).invalidateSettingsCache();
};

test("To‘lov bonusi: card → 15% → confirm → saved (audited, via bot); «Boshqa» typed value validated 0–50; every step is a reply button", { skip }, async () => {
  await pbReset();
  const a = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "💳 To‘lov bonusi"));
  assert.equal(edits().length, 0, "a reply keyboard cannot be edited: the card is a new message");
  const card = sends()[0]!.body;
  assert.match(String(card.text), /To‘lov bonusi<\/b>\n\nHozir: <b>10%<\/b>/);
  assert.deepEqual(await offered(a.tg), ["a:pv:0", "a:pv:5", "a:pv:10", "a:pv:15", "a:pv:20", "a:po", "a:h"]);
  assert.deepEqual(kb(card).map((r) => r.map((b) => b.text)), [["0%", "5%", "✅ 10%", "15%", "20%"], ["✏️ Boshqa (0–50)", "⬅️ Orqaga"]]);
  assert.equal(kb(card).flat().find((b) => b.text === "✅ 10%")!.style, "success", "the current value is marked");

  installFetch();
  await press(a, "a:pv:15");
  assert.match(String(sends()[0]!.body.text), /<b>10%<\/b> dan <b>15%<\/b> ga o‘zgartirilsinmi/);
  assert.deepEqual(await offered(a.tg), ["a:pk:15", "a:p"]);
  assert.equal(await pbValue(), null, "the pick alone changes nothing");

  installFetch();
  await press(a, "a:pk:15");
  assert.equal(edits().length, 0);
  assert.match(String(sends()[0]!.body.text), /^✅ Saqlandi: 15%\n\n[\s\S]*Hozir: <b>15%<\/b>/, "the result is the first line of the card");
  assert.equal(await pbValue(), 15);
  const rows = await audit(a.adminId, "settings.update");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.target_id, "payment_bonus_percent");
  assert.deepEqual(rows[0]!.meta, { via: "bot" });
  assert.equal(rows[0]!.user_agent, "telegram-bot");
  assert.deepEqual(rows[0]!.after, { value: 15, source: "db" });

  // «Orqaga» from the card: the reply-keyboard admin menu comes back (the card itself shows N%).
  installFetch();
  await press(a, "a:h");
  assert.ok(labels(sends().at(-1)!.body).includes("💳 To‘lov bonusi"));
  assert.equal(calls.filter((c) => c.method === "deleteMessage").length, 0, "no inline message to delete");

  // «Boshqa»: a typed value — garbage / 51 re-ask, «33 %» → confirm → saved.
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "💳 To‘lov bonusi"));
  installFetch();
  await press(a, "a:po");
  assert.match(String(sends()[0]!.body.text), /butun son, 0 dan 50 gacha/);
  assert.deepEqual(labels(sends()[0]!.body), ["⬅️ Orqaga", "✖️ Bekor qilish"], "the typing step shows only Orqaga / Bekor qilish");
  assert.equal(await stepOf(a.tg), "pb_val");
  for (const bad of ["abc", "51", "-1", "2.5", "100"]) {
    installFetch();
    await tg.handleUpdate(textUpdate(a.tg, bad));
    assert.match(String(sends()[0]!.body.text), /Butun son yuboring: 0 dan 50 gacha/, bad);
    assert.deepEqual(await offered(a.tg), ["a:p", "a:x"], `${bad}: still waiting`);
  }
  // At the typing step the keyboard has only «Orqaga» / «Bekor qilish»: everything else typed is the value.
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "33 %"));
  const confirm = sends()[0]!.body;
  assert.match(String(confirm.text), /<b>15%<\/b> dan <b>33%<\/b> ga/);
  assert.deepEqual(await offered(a.tg), ["a:pk:33", "a:p"]);
  assert.equal(await stepOf(a.tg), null);
  assert.equal(await pbValue(), 15, "typing alone changes nothing");
  installFetch();
  await press(a, "a:pk:33");
  assert.equal(await pbValue(), 33);
  // 0 turns it off (card → «0%» → confirm).
  installFetch();
  await press(a, "a:pv:0");
  installFetch();
  await press(a, "a:pk:0");
  assert.equal(await pbValue(), 0);
  assert.match(String(sends()[0]!.body.text), /Hozir: <b>0%<\/b> — to‘lov bonusi o‘chirilgan/);
  assert.equal((await audit(a.adminId, "settings.update")).length, 3);
  // A forged out-of-range code (an old inline button) never reaches the service.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:pk:51", 805));
  assert.deepEqual(toasts(), ["Bu tugma eskirgan"]);
  assert.equal(await pbValue(), 0);

  // «Orqaga» at the typing step returns to the card and drops the step: a number typed afterwards is NOT a value.
  installFetch();
  await press(a, "a:po");
  installFetch();
  await press(a, "a:p");
  assert.equal(await stepOf(a.tg), null);
  assert.match(String(sends()[0]!.body.text), /To‘lov bonusi<\/b>/);
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "44"));
  assert.ok(!texts().some((t) => /ga o‘zgartirilsinmi/.test(t)));
  assert.equal(await pbValue(), 0);
  // And a preset label tapped on the card is a pick (the same «15%» that is a value at the typing step).
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "15%"));
  assert.match(String(sends()[0]!.body.text), /<b>0%<\/b> dan <b>15%<\/b> ga/);
  await pbReset();
});

test("To‘lov bonusi: finance / viewer see the card read-only; a forged or typed confirm is refused + auth.denied; support has no card — MUTATSIYA (permission)", { skip }, async () => {
  await pbReset();
  for (const role of ["finance", "viewer"]) {
    const v = await newAdmin(role);
    installFetch();
    await tg.handleUpdate(textUpdate(v.tg, "💳 To‘lov bonusi"));
    const card = sends()[0]!.body;
    assert.match(String(card.text), /faqat ko‘rish huquqi/, role);
    assert.deepEqual(labels(card), ["⬅️ Orqaga"], `${role}: no choices`);
    assert.deepEqual(await offered(v.tg), ["a:h"]);
    // Old inline buttons (forged codes) are refused ...
    for (const data of ["a:pk:30", "a:pv:30", "a:po"]) {
      installFetch();
      await tg.handleUpdate(cbUpdate(v.tg, data, 810));
      assert.deepEqual(toasts(), ["Ruxsat yo‘q"], `${role} ${data}`);
    }
    // ... and a preset label TYPED by hand is not a button of this card: it falls through to the ordinary bot.
    installFetch();
    await tg.handleUpdate(textUpdate(v.tg, "15%"));
    assert.ok(!texts().some((t) => /o‘zgartirilsinmi|Saqlandi|Ruxsat/.test(t)), `${role}: typed 15%`);
    const denied = await audit(v.adminId, "auth.denied");
    assert.equal(denied.length, 3);
    assert.deepEqual(denied[0]!.meta, { permission: "settings.edit", scope: "bot/admin" });
    assert.equal(await pbValue(), null, `${role}: nothing written`);
  }
  // Support: no settings.view at all — the menu has no card, a typed menu label is refused and audited.
  const s = await newAdmin("support");
  installFetch();
  await tg.handleUpdate(textUpdate(s.tg, "/admin"));
  assert.ok(!labels(sends()[0]!.body).includes("💳 To‘lov bonusi"), "support has no settings.view");
  installFetch();
  await tg.handleUpdate(cbUpdate(s.tg, "a:p", 811));
  assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
  installFetch();
  await tg.handleUpdate(textUpdate(s.tg, "💳 To‘lov bonusi"));
  assert.deepEqual(texts(), ["Ruxsat yo‘q"]);
  assert.equal((await audit(s.adminId, "auth.denied")).length, 2);
});

test("To‘lov bonusi: a card shown to an owner, then the owner is downgraded to viewer — tapping a preset or the confirm is refused (+ auth.denied), nothing written", { skip }, async () => {
  await pbReset();
  const o = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(textUpdate(o.tg, "💳 To‘lov bonusi"));
  installFetch();
  await press(o, "a:pv:20");
  const confirmLabel = await labelFor(o.tg, "a:pk:20");
  await query("UPDATE admin_accounts SET role = 'viewer' WHERE id = $1", [o.adminId]);
  installFetch();
  await tg.handleUpdate(textUpdate(o.tg, confirmLabel));
  assert.deepEqual(texts(), ["Ruxsat yo‘q"]);
  assert.equal(await pbValue(), null, "the confirm tap wrote nothing");
  const denied = await audit(o.adminId, "auth.denied");
  assert.equal(denied.length, 1);
  assert.deepEqual(denied[0]!.meta, { permission: "settings.edit", scope: "bot/admin" });
  await pbReset();
});

test("To‘lov bonusi: 2FA mode — the confirm (a reply tap) asks for a code first; nothing changes before it", { skip }, async () => {
  await pbReset();
  const enrolled = await newAdmin("owner");
  await query("UPDATE admin_accounts SET totp_secret_enc = 'sealed', totp_enabled_at = now() WHERE id = $1", [enrolled.adminId]);
  process.env.ADMIN_2FA_REQUIRED = "1";
  try {
    installFetch();
    await tg.handleUpdate(textUpdate(enrolled.tg, "💳 To‘lov bonusi"));
    installFetch();
    await press(enrolled, "a:pv:20");
    installFetch();
    await press(enrolled, "a:pk:20");
    assert.match(String(sends()[0]!.body.text), /6 xonali kodni/);
    assert.deepEqual(labels(sends()[0]!.body), ["✖️ Bekor qilish"]);
    assert.equal(await stepOf(enrolled.tg), "totp");
    assert.equal(await pbValue(), null);
    // An old inline confirm is gated the same way.
    installFetch();
    await tg.handleUpdate(cbUpdate(enrolled.tg, "a:pk:25", 820));
    assert.match(String(sends()[0]!.body.text), /6 xonali kodni/);
    assert.equal(await pbValue(), null);
  } finally {
    delete process.env.ADMIN_2FA_REQUIRED;
    await pbReset();
  }
});
