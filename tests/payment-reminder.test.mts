import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

/**
 * «To'lovingiz yakunlanmadi» (migration 051, lib/server/payment-reminder.ts): the worker's
 * `payment-reminder` step messages a Click order unpaid for 5..60 minutes exactly once. Real Postgres
 * (test DB only), the Bot API stubbed at `fetch`, synthetic users.
 *
 * Mutations (each turned a test red, then restored):
 *   1. lower bound `created_at <= now() - 5 min` removed      -> «younger than 5 minutes is left alone»;
 *   2. claim before send removed (reminded_at never written)   -> «a second tick sends nothing» / concurrent;
 *   3. «no later paid order» exclusion removed                 -> «a user who paid a later order».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-payment-reminder-token";
process.env.SUPPORT_URL = "https://t.me/slaydx_support_test";
delete process.env.BOT_PREMIUM_EMOJI;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { remindUnpaidOrders } = await import("../lib/server/payment-reminder.ts");
const { LANGS, t } = await import("../lib/server/bot/i18n.ts");
if (hasDb) await ensureMigrated();

type Btn = { text: string; url?: string; web_app?: { url: string } };
type Call = { chat: string; text: string; markup: { inline_keyboard: Btn[][] } | undefined };
let calls: Call[] = [];
const OK = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
let respond: () => Response = OK;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
  const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
  assert.ok(m, `unexpected URL ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (m[1] === "sendMessage") calls.push({ chat: String(body.chat_id), text: body.text, markup: body.reply_markup });
  return respond();
}) as typeof fetch;

const userIds: string[] = [];
async function newUser(language = "uz"): Promise<{ id: string; tg: string }> {
  const tg = String(7_800_000_000 + randomInt(0, 99_999_999));
  const u = await upsertTelegramUser({ telegramId: tg, username: null, name: "Remind", photoUrl: null });
  userIds.push(u.id);
  await query("UPDATE users SET language = $2 WHERE id = $1", [u.id, language]);
  return { id: u.id, tg };
}
async function order(userId: string, ageMin: number, o: { provider?: string; state?: string; reminded?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state, created_at, reminded_at)
     VALUES ($1, $2, $3, 'topup', 10000, $4, now() - make_interval(mins => $5::int), $6)`,
    [id, userId, o.provider ?? "click", o.state ?? "created", ageMin, o.reminded ? new Date() : null],
  );
  return id;
}
const remindedAt = async (id: string) =>
  (await queryOne<{ r: Date | null }>("SELECT reminded_at AS r FROM payment_orders WHERE id = $1", [id]))!.r;
const to = (tg: string) => calls.filter((c) => c.chat === tg);
const blockedAt = async (id: string) =>
  (await queryOne<{ b: Date | null }>("SELECT bot_blocked_at AS b FROM users WHERE id = $1", [id]))!.b;

beforeEach(() => {
  calls = [];
  respond = OK;
});
after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await query("DELETE FROM users WHERE id::text = ANY($1)", [userIds]);
  await pool().end();
});

test("reminds a 6-minute-old unpaid click order exactly once, in the user's language", { skip }, async () => {
  const u = await newUser("ru");
  const id = await order(u.id, 6);
  await remindUnpaidOrders();
  assert.equal(to(u.tg).length, 1);
  const c = to(u.tg)[0]!;
  assert.equal(c.text, t("ru", "payReminder.text"));
  const btns = c.markup!.inline_keyboard.flat();
  assert.ok(btns.some((b) => b.url === "https://t.me/slaydx_support_test"), "support url button");
  assert.ok(btns.some((b) => b.web_app?.url.startsWith("https://slaydx.test") && b.web_app.url.includes("/wallet")), "wallet web_app button");
  assert.ok(await remindedAt(id), "claimed");
  await remindUnpaidOrders();
  assert.equal(to(u.tg).length, 1, "a second tick sends nothing");
});

test("pending orders are reminded too; default language is uz", { skip }, async () => {
  const u = await newUser("uz");
  await order(u.id, 10, { state: "pending" });
  await remindUnpaidOrders();
  assert.equal(to(u.tg)[0]?.text, t("uz", "payReminder.text"));
});

test("one user, two unpaid orders due in the same tick → one message, both orders marked", { skip }, async () => {
  const u = await newUser();
  const a = await order(u.id, 7);
  const b = await order(u.id, 6);
  await remindUnpaidOrders();
  assert.equal(to(u.tg).length, 1, "MUTATSIYA: per-tick user dedupe");
  assert.ok((await remindedAt(a)) && (await remindedAt(b)), "both claimed");
});

test("a second order becoming due within 60 minutes of a reminder is not reminded again", { skip }, async () => {
  const u = await newUser();
  await order(u.id, 10);
  await remindUnpaidOrders();
  const later = await order(u.id, 6);
  await remindUnpaidOrders();
  assert.equal(to(u.tg).length, 1, "MUTATSIYA: recent-reminder exclusion");
  assert.equal(await remindedAt(later), null, "left unclaimed");
});

test("younger than 5 minutes is left alone, then reminded once it ages", { skip }, async () => {
  const u = await newUser();
  const id = await order(u.id, 2);
  await remindUnpaidOrders();
  assert.equal(to(u.tg).length, 0);
  assert.equal(await remindedAt(id), null);
  await query("UPDATE payment_orders SET created_at = now() - interval '6 minutes' WHERE id = $1", [id]);
  await remindUnpaidOrders();
  assert.equal(to(u.tg).length, 1);
});

test("skips: older than 60 minutes, paid, cancelled, non-click, already reminded", { skip }, async () => {
  const u = await newUser();
  await order(u.id, 90);
  await order(u.id, 6, { provider: "payme" });
  await order(u.id, 6, { provider: "paynet" });
  await order(u.id, 6, { reminded: true });
  await order(u.id, 6, { state: "cancelled" });
  const paid = await order(u.id, 7, { state: "paid" });
  await remindUnpaidOrders();
  assert.equal(to(u.tg).length, 0);
  assert.equal(await remindedAt(paid), null);
});

test("skips: user without telegram_id, bot_blocked user", { skip }, async () => {
  const web = await newUser();
  await query("UPDATE users SET telegram_id = NULL WHERE id = $1", [web.id]);
  const wid = await order(web.id, 6);
  const blocked = await newUser();
  await query("UPDATE users SET bot_blocked_at = now() WHERE id = $1", [blocked.id]);
  await order(blocked.id, 6);
  await remindUnpaidOrders();
  assert.equal(to(blocked.tg).length, 0);
  assert.equal(await remindedAt(wid), null);
});

test("skips: a user who paid a later order", { skip }, async () => {
  const u = await newUser();
  const id = await order(u.id, 8);
  await order(u.id, 6, { state: "paid" });
  await remindUnpaidOrders();
  assert.equal(to(u.tg).length, 0);
  assert.equal(await remindedAt(id), null);
});

test("two concurrent ticks send one message", { skip }, async () => {
  const u = await newUser();
  await order(u.id, 6);
  await Promise.all([remindUnpaidOrders(), remindUnpaidOrders()]);
  assert.equal(to(u.tg).length, 1);
});

test("a permanent send failure marks the user bot-blocked", { skip }, async () => {
  const u = await newUser();
  await order(u.id, 6);
  respond = () => new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
  await remindUnpaidOrders();
  assert.ok(await blockedAt(u.id), "bot_blocked_at set");
});

test("a transient failure is not resent and does not block the user", { skip }, async () => {
  const u = await newUser();
  const id = await order(u.id, 6);
  respond = () => new Response("oops", { status: 502 });
  await remindUnpaidOrders();
  respond = OK;
  await remindUnpaidOrders();
  assert.equal(to(u.tg).length, 1, "only the failed first attempt, no resend");
  assert.ok(await remindedAt(id));
  assert.equal(await blockedAt(u.id), null);
});

test("payReminder texts exist in uz, ru and en", () => {
  for (const key of ["payReminder.text", "payReminder.help", "payReminder.retry"] as const) {
    const seen = new Set<string>();
    for (const l of LANGS) {
      const s = t(l, key);
      assert.ok(s.length > 0, `${key} ${l}`);
      seen.add(s);
    }
    assert.equal(seen.size, 3, `${key}: three distinct translations`);
  }
});
