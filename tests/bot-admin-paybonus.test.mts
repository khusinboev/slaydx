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
 * Mutations (each turned a test red, then restored):
 *   - `PERM.pbSet` "settings.edit" → "settings.view"              → «finance / viewer read-only», «2FA mode»;
 *   - code bound `<= 50` → `<= 99` (admin-codes.ts isPercentCode) → «card → 15% …» (forged a:pk:51);
 *   - typed value bound dropped (`percentFromText` returns any n) → «card → 15% …» («51» accepted).
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
    if (/^send(Message|Photo|Video)$/.test(m[1]!)) return ok({ message_id: ++msgSeq });
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
type Btn = { text: string; callback_data?: string; url?: string; style?: string };
const buttons = (body: Record<string, unknown>): Btn[] => ((body.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []).flat();
const datas = (body: Record<string, unknown>) => buttons(body).map((b) => b.callback_data).filter(Boolean);
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

test("To‘lov bonusi: card → 15% → confirm → saved (audited, via bot); «Boshqa» typed value validated 0–50; panel shows N%", { skip }, async () => {
  await pbReset();
  const a = await newAdmin("owner");
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:p", 800));
  const card = edits()[0]!.body;
  assert.match(String(card.text), /To‘lov bonusi<\/b>\n\nHozir: <b>10%<\/b>/);
  assert.deepEqual(datas(card), ["a:pv:0", "a:pv:5", "a:pv:10", "a:pv:15", "a:pv:20", "a:po", "a:h"]);
  assert.equal(buttons(card).find((b) => b.callback_data === "a:pv:10")!.style, "success", "the current value is marked");

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:pv:15", 800));
  assert.match(String(edits()[0]!.body.text), /<b>10%<\/b> dan <b>15%<\/b> ga o‘zgartirilsinmi/);
  assert.deepEqual(datas(edits()[0]!.body), ["a:pk:15", "a:p"]);
  assert.equal(await pbValue(), null, "the pick alone changes nothing");

  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:pk:15", 800));
  assert.deepEqual(toasts(), ["✅ Saqlandi: 15%"]);
  assert.equal(await pbValue(), 15);
  assert.match(String(edits()[0]!.body.text), /Hozir: <b>15%<\/b>/);
  const rows = await audit(a.adminId, "settings.update");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.target_id, "payment_bonus_percent");
  assert.deepEqual(rows[0]!.meta, { via: "bot" });
  assert.equal(rows[0]!.user_agent, "telegram-bot");
  assert.deepEqual(rows[0]!.after, { value: 15, source: "db" });

  // The panel button follows the setting.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:h", 801));
  assert.ok(buttons(edits()[0]!.body).some((b) => b.callback_data === "a:p" && b.text === "💳 To‘lov bonusi: 15%"));

  // «Boshqa»: a typed value — garbage / 51 re-ask, «33 %» → confirm → saved.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:po", 802));
  assert.match(String(edits()[0]!.body.text), /butun son, 0 dan 50 gacha/);
  for (const bad of ["abc", "51", "-1", "2.5", "100"]) {
    installFetch();
    await tg.handleUpdate(textUpdate(a.tg, bad));
    assert.match(String(sends()[0]!.body.text), /Butun son yuboring: 0 dan 50 gacha/, bad);
  }
  installFetch();
  await tg.handleUpdate(textUpdate(a.tg, "33 %"));
  const confirm = sends()[0]!.body;
  assert.match(String(confirm.text), /<b>15%<\/b> dan <b>33%<\/b> ga/);
  assert.deepEqual(datas(confirm), ["a:pk:33", "a:p"]);
  assert.equal(await pbValue(), 15, "typing alone changes nothing");
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:pk:33", 803));
  assert.equal(await pbValue(), 33);
  // 0 turns it off.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:pk:0", 804));
  assert.equal(await pbValue(), 0);
  assert.match(String(edits()[0]!.body.text), /Hozir: <b>0%<\/b> — to‘lov bonusi o‘chirilgan/);
  assert.equal((await audit(a.adminId, "settings.update")).length, 3);
  // A forged out-of-range code never reaches the service.
  installFetch();
  await tg.handleUpdate(cbUpdate(a.tg, "a:pk:51", 805));
  assert.deepEqual(toasts(), ["Bu tugma eskirgan"]);
  assert.equal(await pbValue(), 0);
  await pbReset();
});

test("To‘lov bonusi: finance / viewer see the card read-only; a forged confirm is refused + auth.denied; support has no card — MUTATSIYA (permission)", { skip }, async () => {
  await pbReset();
  for (const role of ["finance", "viewer"]) {
    const v = await newAdmin(role);
    installFetch();
    await tg.handleUpdate(cbUpdate(v.tg, "a:p", 810));
    const card = edits()[0]!.body;
    assert.match(String(card.text), /faqat ko‘rish huquqi/, role);
    assert.deepEqual(datas(card), ["a:h"], `${role}: no choices`);
    for (const data of ["a:pk:30", "a:pv:30", "a:po"]) {
      installFetch();
      await tg.handleUpdate(cbUpdate(v.tg, data, 810));
      assert.deepEqual(toasts(), ["Ruxsat yo‘q"], `${role} ${data}`);
    }
    const denied = await audit(v.adminId, "auth.denied");
    assert.equal(denied.length, 3);
    assert.deepEqual(denied[0]!.meta, { permission: "settings.edit", scope: "bot/admin" });
    assert.equal(await pbValue(), null, `${role}: nothing written`);
  }
  const s = await newAdmin("support");
  installFetch();
  await tg.handleUpdate(textUpdate(s.tg, "/admin"));
  assert.ok(!datas(sends()[0]!.body).includes("a:p"), "support has no settings.view");
  installFetch();
  await tg.handleUpdate(cbUpdate(s.tg, "a:p", 811));
  assert.deepEqual(toasts(), ["Ruxsat yo‘q"]);
});

test("To‘lov bonusi: 2FA mode — the confirm asks for a code first; nothing changes before it", { skip }, async () => {
  await pbReset();
  const enrolled = await newAdmin("owner");
  await query("UPDATE admin_accounts SET totp_secret_enc = 'sealed', totp_enabled_at = now() WHERE id = $1", [enrolled.adminId]);
  process.env.ADMIN_2FA_REQUIRED = "1";
  try {
    installFetch();
    await tg.handleUpdate(cbUpdate(enrolled.tg, "a:pk:25", 820));
    assert.match(String(edits()[0]!.body.text), /6 xonali kodni/);
    assert.equal(await pbValue(), null);
  } finally {
    delete process.env.ADMIN_2FA_REQUIRED;
    await pbReset();
  }
});
