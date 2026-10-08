import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Bonus channels — the money side (docs/bonus/PLAN.md, K1):
 * `lib/server/bonus-channels.ts` chatMemberStatus / checkChannel / staySweep /
 * bonusTasks, and the signup bonus (B-Q2: 2 000). Real Postgres in a
 * throwaway database (`staySweep` reads every due claim, so no other test's
 * rows may be visible); the Bot API is stubbed at `fetch` (fake token).
 *
 * Mutations (each turned a test red, then restored):
 *   1. `INSERT … ON CONFLICT DO NOTHING` → plain INSERT + the pre-check removed
 *      (double pay → «concurrent taps pay once» fails: unique violation / two rows);
 *   2. `if (member !== "member") return unknown` removed (unknown pays) → «unknown pays nothing»;
 *   3. the blocked pre-check and the in-transaction `is_blocked` check removed → «blocked user»;
 *   4. sweep due condition `<= now()` → `<= now() + interval '7 days'` (stay before day N) → «not due before day N»;
 *   5. sweep `status === "member"` → `status !== "not_member"` (unknown pays the stay) → «unknown → retried later»;
 *   6. sweep without `NOT u.is_blocked` and the in-tx check → «skips blocked / inactive / zero stay»;
 *   7. `SIGNUP_BONUS_POINTS` back to 3000 → «signup bonus is 2 000»;
 *   8. the `chat_member` branch removed from `processUpdate` → «join → claim → leave on day 1»;
 *   9. `restricted` + `is_member: false` not treated as leaving → «kicked / restricted non-member».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-bonus-channels-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
delete process.env.BOT_PREMIUM_EMOJI;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("bonus") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const bc = await import("../lib/server/bonus-channels.ts");
const { upsertTelegramUser, SIGNUP_BONUS_POINTS } = await import("../lib/server/auth.ts");
if (!skip) await ensureMigrated();

/* ── Bot API stub ── */
type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
/** getChatMember answer per `user_id` (a status, an error code, or "network"). */
let member: Record<string, string | number> = {};
const realFetch = globalThis.fetch;
function installFetch(): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    assert.ok(m, `unexpected URL ${url}`);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method: m[1]!, body });
    if (m[1] === "getChatMember") {
      const a = member[String(body.user_id)] ?? "left";
      if (a === "network") throw new TypeError("fetch failed");
      if (typeof a === "number") return new Response(JSON.stringify({ ok: false, error_code: a, description: "Bad Request: member list is inaccessible" }));
      const [status, isMember] = String(a).split(":");
      return new Response(JSON.stringify({ ok: true, result: { status, ...(isMember ? { is_member: isMember === "1" } : {}) } }));
    }
    return new Response(JSON.stringify({ ok: true, result: m[1] === "sendMessage" ? { message_id: 1 } : true }));
  }) as typeof fetch;
}
installFetch();
const memberCalls = () => calls.filter((c) => c.method === "getChatMember").length;

/* ── Fixtures (synthetic ids) ── */
async function newUser(lang = "uz"): Promise<{ id: string; tg: number }> {
  const tg = 7_600_000_000 + randomInt(0, 99_999_999);
  const u = await upsertTelegramUser({ telegramId: String(tg), username: null, name: "Bonus Test", photoUrl: null });
  if (lang !== "uz") await query("UPDATE users SET language = $2 WHERE id = $1", [u.id, lang]);
  return { id: u.id, tg };
}
let chatSeq = -1_001_000_000_000 - randomInt(0, 999_999);
async function newChannel(o: { join?: number; stay?: number; days?: number; active?: boolean; sort?: number; title?: string; username?: string | null } = {}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO bonus_channels (chat_id, username, title, join_bonus, stay_bonus, stay_days, active, sort)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text AS id`,
    [chatSeq--, o.username === undefined ? "slaydx_news" : o.username, o.title ?? "SlaydX yangiliklari", o.join ?? 1000, o.stay ?? 2000, o.days ?? 7, o.active ?? true, o.sort ?? 0],
  );
  return row!.id;
}
const points = async (id: string) => Number((await queryOne<{ p: number }>("SELECT points AS p FROM users WHERE id = $1", [id]))!.p);
const ledger = async (id: string, like = "channel:%") =>
  query<{ reference: string; points_delta: number; note: string }>(
    "SELECT reference, points_delta::int AS points_delta, note FROM transactions WHERE user_id = $1 AND kind = 'bonus' AND reference LIKE $2 ORDER BY id",
    [id, like],
  );
const claim = async (userId: string, channelId: string) =>
  queryOne<{ join_paid: number; stay_paid: number | null; left_at: Date | null; stay_checked_at: Date | null }>(
    "SELECT join_paid, stay_paid, left_at, stay_checked_at FROM bonus_channel_claims WHERE user_id = $1 AND channel_id = $2",
    [userId, channelId],
  );
/** A claim that joined `days` days ago (the join already paid). */
async function joinedAgo(userId: string, channelId: string, days: number): Promise<void> {
  await query(
    "INSERT INTO bonus_channel_claims (user_id, channel_id, joined_at, join_paid) VALUES ($1, $2, now() - make_interval(days => $3), 1000)",
    [userId, channelId, days],
  );
}

after(async () => {
  globalThis.fetch = realFetch;
  if (skip) return;
  await pool().end();
  await iso.drop();
});

/* ───────────────────────── chatMemberStatus ───────────────────────── */

test("chatMemberStatus: member/administrator/creator, left/kicked, restricted by is_member; every API failure is unknown", { skip }, async () => {
  const cases: Array<[string | number, string]> = [
    ["member", "member"],
    ["administrator", "member"],
    ["creator", "member"],
    ["left", "not_member"],
    ["kicked", "not_member"],
    ["restricted:1", "member"],
    ["restricted:0", "not_member"],
    ["restricted", "unknown"],
    ["owner?", "unknown"],
    [400, "unknown"],
    [403, "unknown"],
    [502, "unknown"],
    ["network", "unknown"],
  ];
  for (const [answer, want] of cases) {
    member = { "42": answer };
    assert.equal(await bc.chatMemberStatus("-1001", 42), want, String(answer));
  }
  const last = calls.at(-1)!;
  assert.equal(last.method, "getChatMember");
  assert.deepEqual(last.body, { chat_id: "-1001", user_id: 42 });
});

/* ───────────────────────── checkChannel ───────────────────────── */

test("checkChannel: a member is paid the join bonus once; a second tap is «already» without a Bot API call", { skip }, async () => {
  const u = await newUser();
  const ch = await newChannel({ join: 1000, stay: 2000, days: 7, title: "SlaydX <yangiliklar>" });
  const before = await points(u.id);
  member = { [u.tg]: "member" };
  installFetch();
  const r = await bc.checkChannel(u.id, u.tg, ch);
  assert.deepEqual(r, { status: "paid", points: 1000, title: "SlaydX <yangiliklar>", stayBonus: 2000, stayDays: 7 });
  assert.equal(await points(u.id), before + 1000);
  const rows = await ledger(u.id);
  assert.deepEqual(rows.map((x) => [x.reference, x.points_delta]), [[`channel:${ch}:${u.id}:join`, 1000]]);
  assert.equal(rows[0]!.note, "Kanal obunasi: SlaydX <yangiliklar>");
  const c = await claim(u.id, ch);
  assert.equal(c?.join_paid, 1000);
  assert.equal(c?.stay_paid, null);
  assert.equal(memberCalls(), 1);

  installFetch();
  assert.deepEqual(await bc.checkChannel(u.id, u.tg, ch), { status: "already" });
  assert.equal(memberCalls(), 0, "claimed: no getChatMember");
  assert.equal(await points(u.id), before + 1000);
  assert.equal((await ledger(u.id)).length, 1);
});

test("checkChannel: concurrent taps (replayed callbacks) pay exactly once — MUTATSIYA 1", { skip }, async () => {
  const u = await newUser();
  const ch = await newChannel({ join: 1500 });
  const before = await points(u.id);
  member = { [u.tg]: "member" };
  installFetch();
  const results = await Promise.all(Array.from({ length: 6 }, () => bc.checkChannel(u.id, u.tg, ch)));
  const paid = results.filter((r) => r.status === "paid");
  assert.equal(paid.length, 1, JSON.stringify(results));
  assert.ok(results.every((r) => r.status === "paid" || r.status === "already"));
  assert.equal(await points(u.id), before + 1500);
  assert.equal((await ledger(u.id)).length, 1);
  const n = await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM bonus_channel_claims WHERE user_id = $1", [u.id]);
  assert.equal(n?.n, "1");
});

test("checkChannel: not a member / unknown (API error, network) pay nothing and leave no claim — MUTATSIYA 2", { skip }, async () => {
  const u = await newUser();
  const ch = await newChannel();
  const before = await points(u.id);
  for (const [answer, want] of [["left", "not_member"], ["kicked", "not_member"], [400, "unknown"], [502, "unknown"], ["network", "unknown"], ["restricted", "unknown"]] as const) {
    member = { [u.tg]: answer };
    assert.deepEqual(await bc.checkChannel(u.id, u.tg, ch), { status: want }, String(answer));
  }
  assert.equal(await points(u.id), before);
  assert.equal((await ledger(u.id)).length, 0);
  assert.equal(await claim(u.id, ch), null);
  // Joining afterwards still pays.
  member = { [u.tg]: "member" };
  assert.equal((await bc.checkChannel(u.id, u.tg, ch)).status, "paid");
});

test("checkChannel: inactive, missing or forged channel ids → «inactive», no Bot API call, no money", { skip }, async () => {
  const u = await newUser();
  const off = await newChannel({ active: false });
  member = { [u.tg]: "member" };
  installFetch();
  for (const id of [off, "999999999", "0", "-1", "1e3", "abc", "12345678901234567890"]) {
    assert.deepEqual(await bc.checkChannel(u.id, u.tg, id), { status: "inactive" }, id);
  }
  assert.equal(memberCalls(), 0);
  assert.equal((await ledger(u.id)).length, 0);
});

test("checkChannel: a blocked account is never paid — MUTATSIYA 3; another user's Telegram id is refused", { skip }, async () => {
  const u = await newUser();
  const ch = await newChannel();
  await query("UPDATE users SET is_blocked = true WHERE id = $1", [u.id]);
  member = { [u.tg]: "member" };
  installFetch();
  const before = await points(u.id);
  assert.deepEqual(await bc.checkChannel(u.id, u.tg, ch), { status: "blocked" });
  assert.equal(memberCalls(), 0);
  assert.equal(await points(u.id), before);
  assert.equal(await claim(u.id, ch), null);

  // The Telegram id must be the account's own (checked under the row lock).
  const a = await newUser();
  const b = await newUser();
  member = { [b.tg]: "member" };
  assert.deepEqual(await bc.checkChannel(a.id, b.tg, ch), { status: "unknown" });
  assert.equal((await ledger(a.id)).length, 0);
  assert.equal(await claim(a.id, ch), null);
});

test("checkChannel: join_bonus 0 records the claim (for the stay bonus) without a ledger row", { skip }, async () => {
  const u = await newUser();
  const ch = await newChannel({ join: 0, stay: 2000 });
  member = { [u.tg]: "administrator" };
  const before = await points(u.id);
  const r = await bc.checkChannel(u.id, u.tg, ch);
  assert.equal(r.status, "paid");
  assert.equal(r.status === "paid" && r.points, 0);
  assert.equal(await points(u.id), before);
  assert.equal((await ledger(u.id)).length, 0);
  assert.equal((await claim(u.id, ch))?.join_paid, 0);
});

test("ledger references are unique per (channel, user, join|stay)", { skip }, async () => {
  const dup = await queryOne<{ n: string }>(
    "SELECT count(*)::text AS n FROM (SELECT reference FROM transactions WHERE reference LIKE 'channel:%' GROUP BY kind, reference HAVING count(*) > 1) d",
  );
  assert.equal(dup?.n, "0");
  assert.equal(bc.joinRef("5", "9"), "channel:5:9:join");
  assert.equal(bc.stayRef("5", "9"), "channel:5:9:stay");
});

/* ───────────────────────── staySweep ───────────────────────── */

async function freshSweep(): Promise<void> {
  // Isolated database: only this file's rows exist.
  await query("DELETE FROM bonus_channel_claims");
  await query("DELETE FROM bonus_channels");
}
const noSleep = { sleep: async () => {} };

test("staySweep: pays after N days if still a member (+ notice in the user's language); never twice", { skip }, async () => {
  await freshSweep();
  const u = await newUser("ru");
  const ch = await newChannel({ join: 1000, stay: 2000, days: 7, title: "SlaydX новости" });
  await joinedAgo(u.id, ch, 8);
  const before = await points(u.id);
  member = { [u.tg]: "member" };
  installFetch();
  const r = await bc.staySweep(50, noSleep);
  assert.deepEqual(r, { rows: 1, paid: 1, left: 0, unknown: 0 });
  assert.equal(await points(u.id), before + 2000);
  const rows = await ledger(u.id);
  assert.deepEqual(rows.map((x) => [x.reference, x.points_delta, x.note]), [[`channel:${ch}:${u.id}:stay`, 2000, "Kanalda qolish bonusi: SlaydX новости"]]);
  assert.equal((await claim(u.id, ch))?.stay_paid, 2000);
  const notice = calls.find((c) => c.method === "sendMessage");
  assert.equal(notice?.body.chat_id, String(u.tg));
  assert.match(String(notice?.body.text), /\+2\s000 баллов!/);
  assert.match(String(notice?.body.text), /«SlaydX новости» 7 дн\./);
  assert.equal(((notice?.body.reply_markup as { inline_keyboard: { callback_data?: string }[][] }).inline_keyboard[0]![0]!.callback_data), "b:h");

  installFetch();
  assert.deepEqual(await bc.staySweep(50, noSleep), { rows: 0, paid: 0, left: 0, unknown: 0 });
  assert.equal(memberCalls(), 0);
  assert.equal(await points(u.id), before + 2000);
});

test("staySweep: not due before day N — MUTATSIYA 4", { skip }, async () => {
  await freshSweep();
  const u = await newUser();
  const ch = await newChannel({ days: 7 });
  await joinedAgo(u.id, ch, 6);
  member = { [u.tg]: "member" };
  installFetch();
  assert.deepEqual(await bc.staySweep(50, noSleep), { rows: 0, paid: 0, left: 0, unknown: 0 });
  assert.equal(memberCalls(), 0);
  assert.equal((await claim(u.id, ch))?.stay_paid, null);
});

test("staySweep: a user who left gets left_at and no money, and is never checked again", { skip }, async () => {
  await freshSweep();
  const u = await newUser();
  const ch = await newChannel();
  await joinedAgo(u.id, ch, 10);
  const before = await points(u.id);
  member = { [u.tg]: "left" };
  installFetch();
  assert.deepEqual(await bc.staySweep(50, noSleep), { rows: 1, paid: 0, left: 1, unknown: 0 });
  const c = await claim(u.id, ch);
  assert.ok(c?.left_at);
  assert.equal(c?.stay_paid, null);
  assert.equal(await points(u.id), before);
  assert.equal(calls.filter((x) => x.method === "sendMessage").length, 0);
  // Re-joining later changes nothing: the claim is final.
  member = { [u.tg]: "member" };
  assert.deepEqual(await bc.staySweep(50, noSleep), { rows: 0, paid: 0, left: 0, unknown: 0 });
  assert.deepEqual(await bc.checkChannel(u.id, u.tg, ch), { status: "already" });
});

test("staySweep: unknown → stay_checked_at, no money, retried only after the back-off — MUTATSIYA 5", { skip }, async () => {
  await freshSweep();
  const u = await newUser();
  const ch = await newChannel();
  await joinedAgo(u.id, ch, 9);
  const before = await points(u.id);
  member = { [u.tg]: 400 };
  installFetch();
  assert.deepEqual(await bc.staySweep(50, noSleep), { rows: 1, paid: 0, left: 0, unknown: 1 });
  const c = await claim(u.id, ch);
  assert.ok(c?.stay_checked_at);
  assert.equal(c?.stay_paid, null);
  assert.equal(c?.left_at, null);
  assert.equal(await points(u.id), before);
  // Right away: not retried.
  member = { [u.tg]: "member" };
  installFetch();
  assert.deepEqual(await bc.staySweep(50, noSleep), { rows: 0, paid: 0, left: 0, unknown: 0 });
  assert.equal(memberCalls(), 0);
  // After the back-off: retried and paid.
  await query("UPDATE bonus_channel_claims SET stay_checked_at = now() - make_interval(hours => $3) WHERE user_id = $1 AND channel_id = $2", [u.id, ch, bc.STAY_RETRY_HOURS + 1]);
  assert.deepEqual(await bc.staySweep(50, noSleep), { rows: 1, paid: 1, left: 0, unknown: 0 });
  assert.equal(await points(u.id), before + 2000);
});

test("staySweep: skips blocked users, inactive channels and stay_bonus 0 — MUTATSIYA 6", { skip }, async () => {
  await freshSweep();
  const blocked = await newUser();
  const normal = await newUser();
  const chOk = await newChannel();
  const chOff = await newChannel();
  const chZero = await newChannel({ stay: 0 });
  await joinedAgo(blocked.id, chOk, 8);
  await joinedAgo(normal.id, chOff, 8);
  await joinedAgo(normal.id, chZero, 8);
  await query("UPDATE users SET is_blocked = true WHERE id = $1", [blocked.id]);
  await query("UPDATE bonus_channels SET active = false WHERE id = $1", [chOff]);
  const b0 = await points(blocked.id);
  const n0 = await points(normal.id);
  member = { [blocked.tg]: "member", [normal.tg]: "member" };
  installFetch();
  assert.deepEqual(await bc.staySweep(50, noSleep), { rows: 0, paid: 0, left: 0, unknown: 0 });
  assert.equal(memberCalls(), 0);
  assert.equal(await points(blocked.id), b0);
  assert.equal(await points(normal.id), n0);
  // Blocked between the select and the payment: the in-transaction re-check refuses.
  await query("UPDATE users SET is_blocked = false WHERE id = $1", [blocked.id]);
  const r = await bc.staySweep(50, {
    ...noSleep,
    member: async () => {
      await query("UPDATE users SET is_blocked = true WHERE id = $1", [blocked.id]);
      return "member";
    },
  });
  assert.equal(r.paid, 0);
  assert.equal(await points(blocked.id), b0);
  assert.equal((await claim(blocked.id, chOk))?.stay_paid, null);
});

test("staySweep: bounded batch, paced Bot API calls, time budget; no bot → nothing", { skip }, async () => {
  await freshSweep();
  const ch = await newChannel();
  const users = [];
  for (let i = 0; i < 4; i++) {
    const u = await newUser();
    users.push(u);
    await joinedAgo(u.id, ch, 8);
  }
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  let checks = 0;
  const notices: string[] = [];
  const r = await bc.staySweep(3, {
    sleep,
    member: async () => {
      checks += 1;
      return "member";
    },
    notify: async (tgId) => {
      notices.push(tgId);
    },
  });
  assert.deepEqual(r, { rows: 3, paid: 3, left: 0, unknown: 0 });
  assert.equal(checks, 3, "limit");
  assert.equal(notices.length, 3);
  assert.ok(sleeps.length >= 5 && sleeps.every((ms) => ms === Math.ceil(1000 / bc.STAY_PER_SECOND)), JSON.stringify(sleeps));

  // Budget: the clock passes the budget after the first check → the rest wait for the next run.
  await freshSweep();
  const ch2 = await newChannel();
  for (const u of users) await joinedAgo(u.id, ch2, 8);
  let t = 0;
  const r2 = await bc.staySweep(50, { sleep, now: () => (t += 20_000), member: async () => "unknown", budgetMs: 10_000 });
  assert.equal(r2.rows, 1);

  let called = false;
  const r3 = await bc.staySweep(50, {
    configured: () => false,
    member: async () => {
      called = true;
      return "member";
    },
  });
  assert.deepEqual(r3, { rows: 0, paid: 0, left: 0, unknown: 0 });
  assert.equal(called, false);
});

/* ───────────────────────── chat_member: leaving before day N ───────────────────────── */

let updateSeq = 900_000_000 + randomInt(0, 9_999_999);
async function chatMemberUpdate(chatId: number, tg: number, status: string, isMember?: boolean): Promise<void> {
  const { handleUpdate } = await import("../lib/server/telegram.ts");
  await handleUpdate({
    update_id: updateSeq++,
    chat_member: {
      chat: { id: chatId, type: "channel", title: "Kanal" },
      from: { id: tg },
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { status: "member", user: { id: tg } },
      new_chat_member: { status, user: { id: tg }, ...(isMember === undefined ? {} : { is_member: isMember }) },
    },
  });
}
const chatIdOf = async (channelId: string) =>
  Number((await queryOne<{ c: string }>("SELECT chat_id::text AS c FROM bonus_channels WHERE id = $1", [channelId]))!.c);

test("chat_member: join → claim → leave on day 1 → re-join → day N pays no stay bonus (B-Q3) — MUTATSIYA 8", { skip }, async () => {
  await freshSweep();
  const u = await newUser();
  const other = await newUser();
  const ch = await newChannel({ join: 1000, stay: 2000, days: 7 });
  const chat = await chatIdOf(ch);
  member = { [u.tg]: "member", [other.tg]: "member" };
  installFetch();
  assert.equal((await bc.checkChannel(u.id, u.tg, ch)).status, "paid");
  assert.equal((await bc.checkChannel(other.id, other.tg, ch)).status, "paid");
  const before = await points(u.id);

  installFetch();
  await chatMemberUpdate(chat, u.tg, "left");
  assert.equal(calls.length, 0, "no reply, no Bot API call");
  const leftAt = (await claim(u.id, ch))?.left_at;
  assert.ok(leftAt, "left_at set when the user leaves");
  assert.equal((await claim(other.id, ch))?.left_at, null, "another member's claim untouched");

  // Re-joining does not clear left_at; a replayed / repeated leave keeps the first timestamp.
  await chatMemberUpdate(chat, u.tg, "member");
  await chatMemberUpdate(chat, u.tg, "kicked");
  assert.equal(await bc.recordChannelLeave({ chat: { id: chat }, new_chat_member: { status: "left", user: { id: u.tg } } }), 0);
  assert.equal((await claim(u.id, ch))?.left_at?.getTime(), leftAt!.getTime());

  // Day N: the user is a member again, but the stay bonus is forfeited; the other user is paid.
  await query("UPDATE bonus_channel_claims SET joined_at = now() - interval '8 days' WHERE channel_id = $1", [ch]);
  installFetch();
  assert.deepEqual(await bc.staySweep(50, noSleep), { rows: 1, paid: 1, left: 0, unknown: 0 });
  assert.equal(memberCalls(), 1, "only the other user is checked");
  assert.equal(await points(u.id), before);
  assert.equal((await claim(u.id, ch))?.stay_paid, null);
  assert.equal((await claim(other.id, ch))?.stay_paid, 2000);
});

test("chat_member: kicked / restricted non-member leave, restricted member / member / admin do not; inactive channels count — MUTATSIYA 9", { skip }, async () => {
  await freshSweep();
  const ch = await newChannel();
  const off = await newChannel({ active: false });
  const chat = await chatIdOf(ch);
  const offChat = await chatIdOf(off);
  const cases: Array<[string, boolean | undefined, boolean]> = [
    ["kicked", undefined, true],
    ["restricted", false, true],
    ["restricted", true, false],
    ["restricted", undefined, false],
    ["member", undefined, false],
    ["administrator", undefined, false],
  ];
  for (const [status, isMember, leaves] of cases) {
    const u = await newUser();
    await joinedAgo(u.id, ch, 2);
    await chatMemberUpdate(chat, u.tg, status, isMember);
    assert.equal(Boolean((await claim(u.id, ch))?.left_at), leaves, `${status}:${isMember}`);
  }
  const v = await newUser();
  await joinedAgo(v.id, off, 2);
  await chatMemberUpdate(offChat, v.tg, "left");
  assert.ok((await claim(v.id, off))?.left_at, "an inactive bonus channel still records the leave");
});

test("chat_member: a paid stay bonus, unknown users / chats and unsafe ids change nothing", { skip }, async () => {
  await freshSweep();
  const u = await newUser();
  const ch = await newChannel();
  const chat = await chatIdOf(ch);
  await query("INSERT INTO bonus_channel_claims (user_id, channel_id, join_paid, stay_paid) VALUES ($1, $2, 1000, 2000)", [u.id, ch]);
  await chatMemberUpdate(chat, u.tg, "left");
  assert.equal((await claim(u.id, ch))?.left_at, null, "stay already paid: nothing to forfeit");

  const w = await newUser();
  await joinedAgo(w.id, ch, 1);
  // Unknown Telegram user, unknown chat, a bot, an id above 2^53: no-ops, no errors.
  await chatMemberUpdate(chat, 5_000_000_001, "left");
  await chatMemberUpdate(-1_009_999_999_999, w.tg, "left");
  assert.equal(await bc.recordChannelLeave({ chat: { id: chat }, new_chat_member: { status: "left", user: { id: w.tg, is_bot: true } } }), 0);
  assert.equal(await bc.recordChannelLeave({ chat: { id: chat }, new_chat_member: { status: "left", user: { id: 2 ** 53 + 2 } } }), 0);
  assert.equal((await claim(w.id, ch))?.left_at, null);
  assert.equal(await bc.recordChannelLeave({ chat: { id: chat }, new_chat_member: { status: "left", user: { id: w.tg } } }), 1);
});

/* ───────────────────────── bonusTasks ───────────────────────── */

test("bonusTasks: active channels by sort with the user's own claim state; earned total", { skip }, async () => {
  await freshSweep();
  const u = await newUser();
  const other = await newUser();
  const b = await newChannel({ sort: 2, title: "B", username: "@slaydx_b" });
  const a = await newChannel({ sort: 1, title: "A", username: "bad name" });
  await newChannel({ sort: 0, title: "Off", active: false });
  await query("INSERT INTO bonus_channel_claims (user_id, channel_id, join_paid, stay_paid) VALUES ($1, $2, 1000, 2000)", [u.id, b]);
  await query("INSERT INTO bonus_channel_claims (user_id, channel_id, join_paid) VALUES ($1, $2, 1000)", [other.id, a]);
  const tasks = await bc.bonusTasks(u.id, { botUsername: "slaydx_test_bot", appUrl: "https://slaydx.test" });
  assert.deepEqual(tasks.channels.map((c) => [c.title, c.username, c.claim ? c.claim.stayPaid : "none"]), [
    ["A", null, "none"],
    ["B", "slaydx_b", 2000],
  ]);
  assert.equal(tasks.earnedTotal, 3000);
  assert.match(tasks.referral.link, /^https:\/\/t\.me\/slaydx_test_bot\?start=ref_/);
  assert.equal(tasks.referral.rewardPoints, 2000);
});

test("joinUrl: t.me/<username>, else the stored invite link of a private channel; anything else → no button", { skip }, async () => {
  await freshSweep();
  const u = await newUser();
  const pub = await newChannel({ sort: 1, title: "Pub", username: "slaydx_pub" });
  const priv = await newChannel({ sort: 2, title: "Priv", username: null });
  const evil = await newChannel({ sort: 3, title: "Evil", username: null });
  const none = await newChannel({ sort: 4, title: "None", username: null });
  await query("UPDATE bonus_channels SET invite_link = 'https://t.me/+AbCdEf123456' WHERE id = $1", [priv]);
  await query("UPDATE bonus_channels SET invite_link = 'https://evil.example/+AbCdEf123456' WHERE id = $1", [evil]);
  void pub;
  void none;
  const tasks = await bc.bonusTasks(u.id, { botUsername: "slaydx_test_bot", appUrl: "https://slaydx.test" });
  // MUTATION: passing invite_link through unchecked would put an arbitrary URL on a bot button.
  assert.deepEqual(tasks.channels.map((c) => [c.title, c.joinUrl]), [
    ["Pub", "https://t.me/slaydx_pub"],
    ["Priv", "https://t.me/+AbCdEf123456"],
    ["Evil", null],
    ["None", null],
  ]);
  assert.equal(bc.channelInviteLink("javascript:alert(1)"), null);
  assert.equal(bc.channelInviteLink("https://t.me/+short"), null);
});

/* ───────────────────────── Signup bonus ───────────────────────── */

test("signup bonus is 2 000 (owner B-Q2) — MUTATSIYA 7", { skip }, async () => {
  assert.equal(SIGNUP_BONUS_POINTS, 2000);
  const u = await newUser();
  assert.equal(await points(u.id), 2000);
  const rows = await ledger(u.id, "signup:%");
  assert.deepEqual(rows.map((r) => [r.reference, r.points_delta]), [[`signup:${u.id}`, 2000]]);
});
