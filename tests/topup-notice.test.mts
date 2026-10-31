import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * «Balansingiz to'ldirildi» (lib/server/topup-notice.ts): the payer gets ONE bot message after a credited top-up
 * (Click / Payme `settleOrder`, Paynet `createPaidPaynetOrder`), carrying the amount, the payment bonus line only when a
 * bonus was paid, and the wallet total read after the commit. Real Postgres (isolated DB on the test server), the Bot API
 * stubbed at `fetch`, synthetic users — nothing leaves the machine.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `void notifyTopup(...)` called on every settle outcome (not only credited ones)   -> «a replay», «cancelled», «concurrent twins», «legacy pro order»;
 *   2. the `bonusPoints > 0` guard removed                                               -> «no bonus line»;
 *   3. `void notifyTopup(...)` -> `await notifyTopup(...)` in settleOrder                -> «a hanging Telegram call» (deadlocks: the gate opens only after settleOrder returns);
 *   4. try/catch removed from sendTopupDm                                                -> «never throws»;
 *   5. `NOT is_blocked AND bot_blocked_at IS NULL` removed from the user query           -> «blocked account», «bot-blocked»;
 *   6. the Paynet `notifyTopup` line removed                                             -> «Paynet: one message», «a hanging Telegram call»;
 *   7. `topup` assigned for a `pro` order too                                            -> «legacy pro order».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-topup-notice-token";
delete process.env.BOT_PREMIUM_EMOJI;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("topupnotice") : { isolated: false, drop: async () => {} };
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { settleOrder, cancelOrder, createPaidPaynetOrder } = await import("../lib/server/payments.ts");
const { notifyTopup, flushTopupNotices } = await import("../lib/server/topup-notice.ts");
const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
if (hasDb) await ensureMigrated();

type Call = { chat: string; text: string; markup: unknown };
let calls: Call[] = [];
const OK = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
let respond: () => Response | Promise<Response> = OK;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
  const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
  assert.ok(m, `unexpected URL ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (m[1] === "sendMessage") calls.push({ chat: String(body.chat_id), text: body.text, markup: body.reply_markup });
  return respond();
}) as typeof fetch;

const userIds: string[] = [];
async function newUser(o: { language?: string; telegram?: boolean; blocked?: boolean; botBlocked?: boolean } = {}): Promise<{ id: string; tg: string }> {
  const tg = String(7_900_000_000 + randomInt(0, 99_999_999));
  const u = o.telegram === false
    ? { id: String((await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ($1, 'NoTg') RETURNING id`, [`notg-${randomUUID().slice(0, 8)}`]))[0].id) }
    : await upsertTelegramUser({ telegramId: tg, username: null, name: "Topup", photoUrl: null });
  userIds.push(u.id);
  // The signup grant is zeroed so every expected wallet total below is exact.
  await query("UPDATE users SET points = 0, quota = 0, balance = 0, language = $2, is_blocked = $3, bot_blocked_at = CASE WHEN $4 THEN now() ELSE NULL END WHERE id = $1", [
    u.id,
    o.language ?? "uz",
    o.blocked ?? false,
    o.botBlocked ?? false,
  ]);
  return { id: u.id, tg };
}
async function order(userId: string, amount: number, o: { provider?: string; purpose?: string; txn?: string } = {}): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state, provider_txn) VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
    [id, userId, o.provider ?? "click", o.purpose ?? "topup", amount, o.txn ?? `t-${id.slice(0, 12)}`],
  );
  return id;
}
async function setBonus(percent: number): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('payment_bonus_percent', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`,
    [JSON.stringify(percent)],
  );
  invalidateSettingsCache();
}
/** Amounts are written with a NBSP between the thousands groups (`formatPoints`): «50 000». */
const nb = (s: string) => s.replace(/(\d) (\d)/g, "$1\u00a0$2");
const to = (tg: string) => calls.filter((c) => c.chat === tg);
const botBlockedAt = async (id: string) => (await queryOne<{ b: Date | null }>("SELECT bot_blocked_at AS b FROM users WHERE id = $1", [id]))!.b;
/** Every message this process started has finished. */
const settled = () => flushTopupNotices();

beforeEach(async () => {
  calls = [];
  respond = OK;
  if (hasDb) await setBonus(10);
});
after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await settled();
  await pool().end();
  await iso.drop();
});

test("Click: one message on the first settle - amount, bonus line, balance after commit", { skip }, async () => {
  const u = await newUser();
  const id = await order(u.id, 50_000);
  const out = await settleOrder(id, Date.now());
  assert.equal(out.status, "paid");
  await settled();
  const msgs = to(u.tg);
  assert.equal(msgs.length, 1, "exactly one message");
  const lines = msgs[0].text.split("\n");
  assert.equal(lines[0], nb("✅ Balansingiz <b>50 000</b> so‘mga to‘ldirildi"));
  assert.equal(lines[1], nb("🎁 +5 000 bonus so‘m"), "10 % payment bonus");
  assert.equal(lines[2], nb("Joriy balans: <b>55 000</b> so‘m"), "balance 50 000 + bonus 5 000, read after the commit");
  assert.equal(lines.length, 3);
  assert.equal(msgs[0].markup, undefined, "plain message, no keyboard");
});

test("a replay of the same order sends nothing (already_paid)", { skip }, async () => {
  const u = await newUser();
  const id = await order(u.id, 20_000);
  await settleOrder(id, Date.now());
  await settled();
  assert.equal(to(u.tg).length, 1);
  const again = await settleOrder(id, Date.now());
  assert.equal(again.status, "already_paid");
  await settled();
  assert.equal(to(u.tg).length, 1, "still one - the replay was silent");
});

test("concurrent twins of one settle: one message", { skip }, async () => {
  const u = await newUser();
  const id = await order(u.id, 30_000);
  const r = await Promise.all([settleOrder(id, Date.now()), settleOrder(id, Date.now()), settleOrder(id, Date.now())]);
  assert.equal(r.filter((x) => x.status === "paid").length, 1);
  await settled();
  assert.equal(to(u.tg).length, 1);
});

test("a cancelled order sends nothing", { skip }, async () => {
  const u = await newUser();
  const id = await order(u.id, 10_000);
  assert.equal((await cancelOrder(id, Date.now(), 5)).status, "cancelled");
  assert.equal((await settleOrder(id, Date.now())).status, "cancelled");
  await settled();
  assert.equal(to(u.tg).length, 0);
});

test("no bonus line when the payment bonus is 0 %", { skip }, async () => {
  await setBonus(0);
  const u = await newUser();
  await settleOrder(await order(u.id, 12_500), Date.now());
  await settled();
  const lines = to(u.tg)[0].text.split("\n");
  assert.deepEqual(lines, [nb("✅ Balansingiz <b>12 500</b> so‘mga to‘ldirildi"), nb("Joriy balans: <b>12 500</b> so‘m")]);
  assert.ok(!/🎁|bonus/.test(to(u.tg)[0].text));
});

test("language follows users.language (ru, en); unknown falls back to uz", { skip }, async () => {
  const ru = await newUser({ language: "ru" });
  const en = await newUser({ language: "en" });
  const xx = await newUser({ language: "de" });
  for (const u of [ru, en, xx]) await settleOrder(await order(u.id, 40_000), Date.now());
  await settled();
  assert.equal(to(ru.tg)[0].text, nb("✅ Ваш баланс пополнен на <b>40 000</b> сум\n🎁 +4 000 бонусных сум\nТекущий баланс: <b>44 000</b> сум"));
  assert.equal(to(en.tg)[0].text, nb("✅ Your balance was topped up by <b>40 000</b> UZS\n🎁 +4 000 bonus UZS\nCurrent balance: <b>44 000</b> UZS"));
  assert.match(to(xx.tg)[0].text, /^✅ Balansingiz <b>40\u00a0000<\/b> so‘mga to‘ldirildi/);
});

test("the balance line is the wallet total (points + quota + balance), not the order alone", { skip }, async () => {
  const u = await newUser();
  await query("UPDATE users SET points = 1500, quota = 200, balance = 300 WHERE id = $1", [u.id]);
  await settleOrder(await order(u.id, 10_000), Date.now());
  await settled();
  // 1500 + 200 + 300 before; +10 000 balance, +1 000 bonus points
  assert.match(to(u.tg)[0].text, /Joriy balans: <b>13\u00a0000<\/b> so‘m$/);
});

test("Paynet: one message on PerformTransaction, none on a duplicate transactionId", { skip }, async () => {
  const u = await newUser();
  const txn = String(8_100_000 + randomInt(0, 800_000));
  const first = await createPaidPaynetOrder({ userId: u.id, amountSoum: 25_000, transactionId: txn });
  assert.equal(first.status, "paid");
  await settled();
  assert.equal(to(u.tg).length, 1);
  assert.equal(to(u.tg)[0].text.split("\n")[0], nb("✅ Balansingiz <b>25 000</b> so‘mga to‘ldirildi"));
  assert.match(to(u.tg)[0].text, /🎁 \+2\u00a0500 bonus so‘m/);
  const dup = await createPaidPaynetOrder({ userId: u.id, amountSoum: 25_000, transactionId: txn });
  assert.equal(dup.status, "duplicate");
  await settled();
  assert.equal(to(u.tg).length, 1, "the duplicate was silent");
});

test("users without telegram_id, a blocked account and a bot-blocked chat get nothing (the money is still credited)", { skip }, async () => {
  const noTg = await newUser({ telegram: false });
  const blocked = await newUser({ blocked: true });
  const botBlocked = await newUser({ botBlocked: true });
  for (const u of [noTg, blocked, botBlocked]) {
    const out = await settleOrder(await order(u.id, 10_000), Date.now());
    assert.equal(out.status, "paid");
    const w = (await queryOne<{ balance: string }>("SELECT balance FROM users WHERE id = $1", [u.id]))!;
    assert.equal(Number(w.balance), 10_000, "credited regardless");
  }
  await settled();
  assert.equal(calls.length, 0, "no sendMessage at all");
});

test("a legacy pro order (credited to the balance) sends no top-up message", { skip }, async () => {
  const u = await newUser();
  const id = await order(u.id, 15_000, { purpose: "pro" });
  assert.equal((await settleOrder(id, Date.now())).status, "paid");
  await settled();
  assert.equal(to(u.tg).length, 0);
});

test("Telegram failures never reach the provider: 500, 403 (marks the chat blocked), network error", { skip }, async () => {
  for (const [name, failing] of [
    ["500", () => new Response(JSON.stringify({ ok: false, error_code: 500, description: "boom" }), { status: 500 })],
    ["403", () => new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 })],
    ["network", () => { throw new Error("ECONNRESET"); }],
  ] as const) {
    respond = failing as () => Response;
    const u = await newUser();
    const out = await settleOrder(await order(u.id, 10_000), Date.now());
    assert.equal(out.status, "paid", name);
    await settled();
    assert.equal(to(u.tg).length, 1, `${name}: it was attempted once`);
    const w = (await queryOne<{ balance: string }>("SELECT balance FROM users WHERE id = $1", [u.id]))!;
    assert.equal(Number(w.balance), 10_000, `${name}: credited`);
    if (name === "403") assert.ok(await botBlockedAt(u.id), "403 marks users.bot_blocked_at");
    else assert.equal(await botBlockedAt(u.id), null, `${name}: not marked blocked`);
  }
});

test("notifyTopup never throws or rejects, even when its own query fails", { skip }, async () => {
  await assert.doesNotReject(notifyTopup({ userId: "not-a-uuid", orderId: "o", amountSoum: 1_000, bonusPoints: 0 }));
  await assert.doesNotReject(notifyTopup(null));
  await assert.doesNotReject(notifyTopup(undefined));
  assert.equal(calls.length, 0);
});

test("a hanging Telegram call does not delay settleOrder or the Paynet answer", { skip }, async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  respond = async () => {
    await gate;
    return OK();
  };
  const u = await newUser();
  const t0 = Date.now();
  const out = await settleOrder(await order(u.id, 10_000), Date.now());
  const pn = await createPaidPaynetOrder({ userId: u.id, amountSoum: 10_000, transactionId: String(8_900_000 + randomInt(0, 90_000)) });
  assert.equal(out.status, "paid");
  assert.equal(pn.status, "paid");
  assert.ok(Date.now() - t0 < 5_000, "the answers came back while Telegram was still hanging");
  release();
  await settled();
  assert.equal(to(u.tg).length, 2, "both messages went out once Telegram answered");
});
