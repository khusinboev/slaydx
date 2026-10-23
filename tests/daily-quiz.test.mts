/**
 * «Kunlik savollar» (docs/program-17/PLAN.md item 16, migration 055): `lib/daily-quiz/rules.ts`,
 * `lib/server/daily-quiz.ts` (service), `lib/server/daily-quiz-send.ts` (sender) and the bot layer
 * (`lib/server/bot/daily-quiz.ts`, callbacks in `router.ts`) on real Postgres (own throwaway database),
 * the Bot API stubbed at `fetch`, synthetic users.
 *
 * Mutation checks (each was broken on purpose, the named test failed, then restored):
 *   1. first-answer lock removed (a replay overwrites the stored answer)      -> «the first answer is final»;
 *   2. monthly cap check removed from `applyReward`                           -> «monthly cap»;
 *   3. advisory lock (or the budget check) removed from `applyReward`          -> «global budget» / «concurrent winners»;
 *   4. per-day send claim removed from `runDailyQuizSend`                      -> «one send pass» / «two workers».
 */
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-daily-quiz-token";
delete process.env.BOT_PREMIUM_EMOJI;
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("dquiz") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const rules = await import("../lib/daily-quiz/rules.ts");
const { DAILY_QUESTIONS } = await import("../lib/daily-quiz/questions.ts");
const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const quiz = await import("../lib/server/daily-quiz.ts");
const settings = await import("../lib/server/settings.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { ApiError } = await import("../lib/server/api.ts");
if (!skip) await ensureMigrated();

const realFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = realFetch;
  if (skip) return;
  await pool().end();
  await iso.drop();
});

/* ───────────────────────── helpers ───────────────────────── */

async function setSetting(key: string, value: unknown): Promise<void> {
  await query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
  settings.invalidateSettingsCache();
}
async function resetSettings(): Promise<void> {
  await query("DELETE FROM app_settings WHERE key LIKE 'daily_quiz.%'");
  settings.invalidateSettingsCache();
}

const userIds: string[] = [];
async function newUser(language = "uz"): Promise<{ id: string; tg: string }> {
  const tg = String(7_600_000_000 + randomInt(0, 99_999_999));
  const u = await upsertTelegramUser({ telegramId: tg, username: null, name: "Quiz Test", photoUrl: null });
  userIds.push(u.id);
  if (language !== "uz") await query("UPDATE users SET language = $2 WHERE id = $1", [u.id, language]);
  return { id: u.id, tg };
}

/** Past days only: ledger rows are stamped with the real clock, and the budget query is bounded below by the day's start. */
let dayCounter = 0;
function freshDay(): string {
  const d = new Date(Date.UTC(2026, 0, 1 + dayCounter++));
  return d.toISOString().slice(0, 10);
}
/** An instant inside the Tashkent `day` (noon). */
const noon = (day: string) => new Date(`${day}T07:00:00Z`);

const points = async (id: string) => Number((await queryOne<{ p: string }>("SELECT points::text AS p FROM users WHERE id = $1", [id]))!.p);
const ledgerOf = (id: string) =>
  query<{ reference: string; points_delta: string; note: string }>(
    "SELECT reference, points_delta::text AS points_delta, note FROM transactions WHERE user_id = $1 AND reference LIKE 'daily-quiz:%' ORDER BY id",
    [id],
  );
async function rejects(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof ApiError && e.status === status && e.extra.code === code, `${status} ${code}`);
}

/** Answers the day's questions with `rights[i]` = true for a correct choice, false for a wrong one. */
async function play(userId: string, day: string, rights: boolean[]): Promise<Awaited<ReturnType<typeof quiz.answer>>[]> {
  const qs = quiz.todaysQuestions(day);
  const out = [];
  for (let i = 0; i < rights.length; i++) {
    const right = qs[i]!.answer;
    out.push(await quiz.answer(userId, day, i, rights[i] ? right : (right + 1) % 4, { now: noon(day) }));
  }
  return out;
}

beforeEach(async () => {
  if (skip) return;
  await resetSettings();
  await setSetting("daily_quiz.enabled", true);
});

/* ───────────────────────── selection (no DB) ───────────────────────── */

test("rules: the Tashkent day, hour and day number", () => {
  // 2026-10-23 19:30 UTC is already the 24th in Tashkent (UTC+5).
  assert.equal(rules.tashkentDay(new Date("2026-10-23T19:30:00Z")), "2026-10-24");
  assert.equal(rules.tashkentDay(new Date("2026-10-23T18:59:59Z")), "2026-10-23");
  assert.equal(rules.tashkentHour(new Date("2026-10-23T04:00:00Z")), 9);
  assert.equal(rules.tashkentHour(new Date("2026-10-23T19:00:00Z")), 0);
  assert.equal(rules.dayNumber("1970-01-02"), 1);
  assert.equal(rules.dayFromNumber(rules.dayNumber("2026-10-23")), "2026-10-23");
  assert.equal(rules.monthStart("2026-10-23"), "2026-10-01");
  assert.ok(rules.isDayString("2026-02-28") && !rules.isDayString("2026-02-30") && !rules.isDayString("2026-2-3") && !rules.isDayString(5));
});

test("selection is deterministic: three distinct questions per day, the same for everybody and every call", () => {
  const a = quiz.todaysQuestions("2026-10-23").map((q) => q.id);
  const b = quiz.todaysQuestions("2026-10-23").map((q) => q.id);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.equal(new Set(a).size, 3);
  assert.notDeepEqual(a, quiz.todaysQuestions("2026-10-24").map((q) => q.id), "the next day differs");
  assert.throws(() => quiz.todaysQuestions("2026-13-45"), ApiError);
});

test("no question repeats within a cycle: 50 consecutive days use the whole bank of 150 exactly once", () => {
  const perDay = rules.DAILY_QUIZ_PER_DAY;
  const daysPerCycle = Math.floor(DAILY_QUESTIONS.length / perDay);
  assert.equal(daysPerCycle, 50);
  const startNo = Math.ceil(rules.dayNumber("2026-11-01") / daysPerCycle) * daysPerCycle; // a cycle boundary
  const seen: string[] = [];
  for (let i = 0; i < daysPerCycle; i++) seen.push(...quiz.todaysQuestions(rules.dayFromNumber(startNo + i)).map((q) => q.id));
  assert.equal(seen.length, 150);
  assert.equal(new Set(seen).size, 150, "every question exactly once in the cycle");
  // The next cycle walks a different order (otherwise the bank would repeat in the same sequence forever).
  const next: string[] = [];
  for (let i = 0; i < daysPerCycle; i++) next.push(...quiz.todaysQuestions(rules.dayFromNumber(startNo + daysPerCycle + i)).map((q) => q.id));
  assert.equal(new Set(next).size, 150);
  assert.notDeepEqual(seen, next);
  // A day in the middle of a cycle is a day of that cycle: its three are within the cycle's set and not repeated by other days.
  const inCycle = quiz.todaysQuestions(rules.dayFromNumber(startNo + 17)).map((q) => q.id);
  assert.equal(seen.filter((id) => inCycle.includes(id)).length, 3);
});

/* ───────────────────────── answer flow ───────────────────────── */

test("the first answer to a question is final and a replay is idempotent", { skip }, async () => {
  const u = await newUser();
  const day = freshDay();
  const qs = quiz.todaysQuestions(day);
  const right = qs[0]!.answer;
  const wrong = (right + 1) % 4;

  const first = await quiz.answer(u.id, day, 0, wrong, { now: noon(day) });
  assert.equal(first.correct, false);
  assert.equal(first.right, right);
  assert.equal(first.locked, false);
  assert.equal(first.explanation, qs[0]!.explain);
  assert.equal(first.state.next?.index, 1, "the next question is offered");
  assert.equal(first.state.next?.id, qs[1]!.id);

  // The "corrected" second tap changes nothing: the wrong first answer stands.
  const second = await quiz.answer(u.id, day, 0, right, { now: noon(day) });
  assert.equal(second.locked, true);
  assert.equal(second.choice, wrong);
  assert.equal(second.correct, false);
  const row = await queryOne<{ answers: number[]; correct: number }>("SELECT answers, correct FROM daily_quiz_attempts WHERE user_id = $1 AND day = $2", [u.id, day]);
  assert.deepEqual(row!.answers, [wrong]);
  assert.equal(row!.correct, 0);

  // Answers come in order.
  await rejects(quiz.answer(u.id, day, 2, 0, { now: noon(day) }), 409, "out_of_order");
  // Bad input never reaches the database.
  await rejects(quiz.answer(u.id, day, 3, 0, { now: noon(day) }), 400, "bad_question");
  await rejects(quiz.answer(u.id, day, 1, 4, { now: noon(day) }), 400, "bad_choice");
  await rejects(quiz.answer(u.id, day, 1, "2" as unknown as number, { now: noon(day) }), 400, "bad_choice");
  await rejects(quiz.answer(u.id, day, 1.5, 0, { now: noon(day) }), 400, "bad_question");
  await rejects(quiz.answer(u.id, "not-a-day", 0, 0), 400, "bad_day");
  assert.equal((await queryOne<{ n: string }>("SELECT count(*)::text n FROM daily_quiz_attempts WHERE user_id = $1", [u.id]))!.n, "1");
});

test("two parallel taps on the same question: exactly one answer is stored, both callers get a consistent reply", { skip }, async () => {
  const u = await newUser();
  const day = freshDay();
  const right = quiz.todaysQuestions(day)[0]!.answer;
  const [a, b] = await Promise.all([
    quiz.answer(u.id, day, 0, right, { now: noon(day) }),
    quiz.answer(u.id, day, 0, (right + 1) % 4, { now: noon(day) }),
  ]);
  assert.equal([a, b].filter((r) => !r.locked).length, 1, "exactly one tap won the race");
  const row = await queryOne<{ answers: number[] }>("SELECT answers FROM daily_quiz_attempts WHERE user_id = $1 AND day = $2", [u.id, day]);
  assert.equal(row!.answers.length, 1);
  assert.equal(a.choice, b.choice, "the loser sees the winner's answer");
});

test("3/3 credits the reward exactly once under ref daily-quiz:<id>:<day>, and the result is stable", { skip }, async () => {
  const u = await newUser();
  const day = freshDay();
  const before = await points(u.id);
  const out = await play(u.id, day, [true, true, true]);
  assert.equal(out[2]!.state.finished, true);
  assert.deepEqual(out[2]!.state.result, { correct: 3, outcome: "paid", rewarded: 500, monthlyCap: null });
  assert.equal(await points(u.id), before + 500);
  const led = await ledgerOf(u.id);
  assert.equal(led.length, 1);
  assert.equal(led[0]!.reference, `daily-quiz:${u.id}:${day}`);
  assert.equal(Number(led[0]!.points_delta), 500);
  assert.equal(led[0]!.note, "Kunlik savollar bonusi");

  // Tapping the last button again, or opening the quiz again, pays nothing more.
  const again = await quiz.answer(u.id, day, 2, 0, { now: noon(day) });
  assert.equal(again.locked, true);
  assert.equal(again.state.result?.outcome, "paid");
  const st = await quiz.startOrGet(u.id, day, { now: noon(day) });
  assert.equal(st.finished, true);
  assert.equal(st.next, null);
  assert.equal(st.result?.rewarded, 500);
  assert.equal(await points(u.id), before + 500);
  assert.equal((await ledgerOf(u.id)).length, 1);
});

test("parallel taps on the winning question credit once", { skip }, async () => {
  const u = await newUser();
  const day = freshDay();
  await play(u.id, day, [true, true]);
  const right = quiz.todaysQuestions(day)[2]!.answer;
  const before = await points(u.id);
  await Promise.all([1, 2, 3, 4].map(() => quiz.answer(u.id, day, 2, right, { now: noon(day) })));
  assert.equal(await points(u.id), before + 500);
  assert.equal((await ledgerOf(u.id)).length, 1);
});

test("2/3 gets nothing", { skip }, async () => {
  const u = await newUser();
  const before = await points(u.id);
  for (const rights of [[true, true, false], [false, true, true], [true, false, false]]) {
    const d = freshDay();
    const out = await play(u.id, d, rights);
    const want = rights.filter(Boolean).length;
    assert.deepEqual(out[2]!.state.result, { correct: want, outcome: "lost", rewarded: 0, monthlyCap: null });
  }
  assert.equal(await points(u.id), before);
  assert.equal((await ledgerOf(u.id)).length, 0);
});

test("a second day is a fresh attempt and pays again", { skip }, async () => {
  const u = await newUser();
  const d1 = freshDay();
  const d2 = freshDay();
  const before = await points(u.id);
  await play(u.id, d1, [true, true, true]);
  const st = await quiz.startOrGet(u.id, d2, { now: noon(d2) });
  assert.equal(st.finished, false);
  assert.equal(st.answers.length, 0);
  assert.equal(st.next?.id, quiz.todaysQuestions(d2)[0]!.id);
  await play(u.id, d2, [true, true, true]);
  assert.equal(await points(u.id), before + 1000);
  assert.deepEqual((await ledgerOf(u.id)).map((l) => l.reference), [`daily-quiz:${u.id}:${d1}`, `daily-quiz:${u.id}:${d2}`]);
});

test("a stale day (yesterday's button) is refused: nothing is answered, nothing created", { skip }, async () => {
  const u = await newUser();
  const day = freshDay();
  const other = freshDay();
  await rejects(quiz.answer(u.id, day, 0, 0, { now: noon(other) }), 409, "stale_day");
  await rejects(quiz.startOrGet(u.id, day, { now: noon(other) }), 409, "stale_day");
  assert.equal((await queryOne<{ n: string }>("SELECT count(*)::text n FROM daily_quiz_attempts WHERE user_id = $1", [u.id]))!.n, "0");
});

test("monthly cap: at the cap the bonus is paid, one more win over it is not (and the result says so)", { skip }, async () => {
  const u = await newUser();
  const day = "2025-03-20"; // March: the month the fixture rows below belong to
  // 4 500 already earned this month (a row on an earlier day of the same month) + 500 = 5 000 = the cap: still paid.
  await query("INSERT INTO daily_quiz_attempts (user_id, day, answers, correct, finished_at, rewarded_points, outcome) VALUES ($1, '2025-03-02', '{0,0,0}', 3, now(), 4500, 'paid')", [u.id]);
  const before = await points(u.id);
  const paid = await play(u.id, day, [true, true, true]);
  assert.equal(paid[2]!.state.result?.outcome, "paid");
  assert.equal(await points(u.id), before + 500);

  // 5 000 earned in March: the next March win is over the cap.
  const day2 = "2025-03-21";
  const capped = await play(u.id, day2, [true, true, true]);
  assert.deepEqual(capped[2]!.state.result, { correct: 3, outcome: "cap", rewarded: 0, monthlyCap: 5000 });
  assert.equal(await points(u.id), before + 500, "no credit over the cap");
  assert.equal((await ledgerOf(u.id)).length, 1);
  // The finished result stays the same on a later look.
  assert.equal((await quiz.startOrGet(u.id, day2, { now: noon(day2) })).result?.outcome, "cap");

  // The cap is per month: April starts from zero. (Row for April 1st written directly: the budget query only needs the ledger.)
  const april = "2025-04-02";
  const fresh = await play(u.id, april, [true, true, true]);
  assert.equal(fresh[2]!.state.result?.outcome, "paid");

  // The setting is read at the moment of winning.
  await setSetting("daily_quiz.monthly_cap", 0);
  const zero = await play(u.id, "2025-04-03", [true, true, true]);
  assert.equal(zero[2]!.state.result?.outcome, "cap");
});

test("global budget: winners past the day's budget get no credit; the setting 0 pays nobody", { skip }, async () => {
  await setSetting("daily_quiz.daily_budget", 1000);
  const day = freshDay();
  const users = [await newUser(), await newUser(), await newUser()];
  const results = [];
  for (const u of users) results.push((await play(u.id, day, [true, true, true]))[2]!.state.result!.outcome);
  assert.deepEqual(results, ["paid", "paid", "budget"]);
  assert.equal((await ledgerOf(users[2]!.id)).length, 0, "the third winner is not credited");
  const spent = await queryOne<{ n: string }>(
    "SELECT coalesce(sum(points_delta), 0)::text n FROM transactions WHERE kind = 'bonus' AND reference LIKE $1",
    [rules.dailyQuizDayRefPattern(day)],
  );
  assert.equal(Number(spent!.n), 1000);

  // Another day has its own budget.
  const day2 = freshDay();
  assert.equal((await play(users[2]!.id, day2, [true, true, true]))[2]!.state.result?.outcome, "paid");

  // Budget 0: nobody is paid, but the attempt is still stored as a win.
  await setSetting("daily_quiz.daily_budget", 0);
  const day3 = freshDay();
  const r = (await play(users[0]!.id, day3, [true, true, true]))[2]!.state;
  assert.equal(r.result?.outcome, "budget");
  assert.equal(r.result?.correct, 3);
});

test("concurrent winners never overshoot the day's budget", { skip }, async () => {
  const budget = 1500; // three winners at 500
  await setSetting("daily_quiz.daily_budget", budget);
  const day = freshDay();
  const users = await Promise.all(Array.from({ length: 8 }, () => newUser()));
  for (const u of users) await play(u.id, day, [true, true]);
  const right = quiz.todaysQuestions(day)[2]!.answer;
  const outs = await Promise.all(users.map((u) => quiz.answer(u.id, day, 2, right, { now: noon(day) })));
  const outcomes = outs.map((o) => o.state.result!.outcome);
  assert.equal(outcomes.filter((o) => o === "paid").length, 3, `outcomes: ${outcomes}`);
  assert.equal(outcomes.filter((o) => o === "budget").length, 5);
  const spent = await queryOne<{ n: string }>(
    "SELECT coalesce(sum(points_delta), 0)::text n FROM transactions WHERE kind = 'bonus' AND reference LIKE $1",
    [rules.dailyQuizDayRefPattern(day)],
  );
  assert.equal(Number(spent!.n), budget, "the ledger total for the day equals the budget, never more");
});

test("reward setting 0: 3/3 is recorded, nothing is paid", { skip }, async () => {
  await setSetting("daily_quiz.reward", 0);
  const u = await newUser();
  const day = freshDay();
  const before = await points(u.id);
  const out = await play(u.id, day, [true, true, true]);
  assert.deepEqual(out[2]!.state.result, { correct: 3, outcome: "none", rewarded: 0, monthlyCap: null });
  assert.equal(await points(u.id), before);
  assert.equal((await ledgerOf(u.id)).length, 0);
});

test("a changed reward setting applies to the next win", { skip }, async () => {
  await setSetting("daily_quiz.reward", 750);
  const u = await newUser();
  const day = freshDay();
  const before = await points(u.id);
  const out = await play(u.id, day, [true, true, true]);
  assert.equal(out[2]!.state.result?.rewarded, 750);
  assert.equal(await points(u.id), before + 750);
});

test("disabled: nothing starts, nothing is answered, nothing is paid", { skip }, async () => {
  const u = await newUser();
  const day = freshDay();
  await play(u.id, day, [true, true]);
  await setSetting("daily_quiz.enabled", false);
  await rejects(quiz.startOrGet(u.id, day, { now: noon(day) }), 403, "disabled");
  await rejects(quiz.answer(u.id, day, 2, quiz.todaysQuestions(day)[2]!.answer, { now: noon(day) }), 403, "disabled");
  assert.equal((await ledgerOf(u.id)).length, 0);
  await resetSettings();
  await rejects(quiz.startOrGet(u.id, day, { now: noon(day) }), 403, "disabled"); // default is OFF
});

test("a blocked or missing account cannot play", { skip }, async () => {
  const u = await newUser();
  const day = freshDay();
  await query("UPDATE users SET is_blocked = true WHERE id = $1", [u.id]);
  await rejects(quiz.startOrGet(u.id, day, { now: noon(day) }), 403, "blocked");
  await rejects(quiz.answer(u.id, day, 0, 0, { now: noon(day) }), 403, "blocked");
  await rejects(quiz.startOrGet("999999999999", day, { now: noon(day) }), 404, "no_user");
});

test("opt-out flag toggles and is read back", { skip }, async () => {
  const u = await newUser();
  assert.equal(await quiz.isQuizOptedOut(u.id), false);
  assert.equal(await quiz.setQuizOptOut(u.id, true), true);
  assert.equal(await quiz.isQuizOptedOut(u.id), true);
  assert.equal(await quiz.setQuizOptOut(u.id, false), false);
  await rejects(quiz.setQuizOptOut("999999999999", true), 404, "no_user");
});

/* ───────────────────────── Bot API stub ───────────────────────── */

type Btn = { text: string; callback_data?: string };
type Call = { method: string; chat: string; text: string; markup: { inline_keyboard: Btn[][] } | undefined; toast?: string };
let calls: Call[] = [];
/** Per-chat refusals: a chat id listed here answers 403 «bot was blocked» to sendMessage. */
const blockedChats = new Set<string>();
globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
  const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
  assert.ok(m, `unexpected URL ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}"));
  calls.push({ method: m[1]!, chat: String(body.chat_id ?? ""), text: String(body.text ?? ""), markup: body.reply_markup, toast: m[1] === "answerCallbackQuery" ? String(body.text ?? "") : undefined });
  if (m[1] === "sendMessage" && blockedChats.has(String(body.chat_id))) {
    return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
  }
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const sentTo = (tg: string) => calls.filter((c) => c.method === "sendMessage" && c.chat === tg);
const edits = () => calls.filter((c) => c.method === "editMessageText");
const toasts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.toast ?? "");
const buttons = (c: Call) => (c.markup?.inline_keyboard ?? []).flat();

beforeEach(() => {
  calls = [];
  blockedChats.clear();
});

/* ───────────────────────── sender ───────────────────────── */

const { runDailyQuizSend } = await import("../lib/server/daily-quiz-send.ts");
const { LANGS, t } = await import("../lib/server/bot/i18n.ts");

const fakeLimiter = { acquire: async () => {}, pauseFor: () => {}, pausedUntil: () => 0, whenResumed: async () => {}, granted: () => 0 };
type Dm = { userId: string; telegramId: string; language: string | null };
type SendFn = NonNullable<NonNullable<Parameters<typeof runDailyQuizSend>[0]>["send"]>;
function recorder() {
  const got: Dm[] = [];
  const send = (async (target: Dm) => {
    got.push(target);
    return "sent" as const;
  }) as unknown as SendFn;
  return { got, send };
}
/** Sender days live in the far future: the claim row is per day and independent of the (past-day) ledger tests above. */
let sendDayCounter = 0;
function sendDay(): string {
  return new Date(Date.UTC(2040, 0, 1 + sendDayCounter++)).toISOString().slice(0, 10);
}
/** The instant at `hour`:00 Tashkent time on `day`. */
const at = (day: string, hour: number) => new Date(Date.parse(`${day}T00:00:00Z`) + (hour - 5) * 3_600_000);
const sendsRow = (day: string) =>
  queryOne<{ finished_at: Date | null; sent: number; last_user_id: string }>("SELECT finished_at, sent, last_user_id::text AS last_user_id FROM daily_quiz_sends WHERE day = $1", [day]);
/** The sender tests count recipients exactly, so every user created by earlier tests is switched off first. */
async function quietEveryoneElse(): Promise<void> {
  await query("UPDATE users SET daily_quiz_off = true");
}

test("test clock: at() is the Tashkent hour of the day", () => {
  const d = sendDay();
  assert.equal(rules.tashkentDay(at(d, 9)), d);
  assert.equal(rules.tashkentHour(at(d, 9)), 9);
  assert.equal(rules.tashkentHour(at(d, 8)), 8);
  assert.equal(rules.tashkentDay(at(d, 0)), d);
});

test("sender: disabled or before the hour sends nothing and claims nothing; the hour is a setting", { skip }, async () => {
  await quietEveryoneElse();
  const u = await newUser();
  const d = sendDay();
  const r = recorder();
  await setSetting("daily_quiz.enabled", false);
  assert.equal(await runDailyQuizSend({ now: at(d, 10), limiter: fakeLimiter, send: r.send }), 0);
  assert.equal(await sendsRow(d), null, "no claim while disabled");
  await setSetting("daily_quiz.enabled", true);
  assert.equal(await runDailyQuizSend({ now: at(d, 8), limiter: fakeLimiter, send: r.send }), 0, "09:00 is the default hour");
  assert.equal(await sendsRow(d), null, "no claim before the hour");
  await setSetting("daily_quiz.hour", 7);
  assert.equal(await runDailyQuizSend({ now: at(d, 8), limiter: fakeLimiter, send: r.send }), 1);
  assert.deepEqual(r.got.map((g) => g.userId), [u.id]);
});

test("sender recipients: opted-out, bot-blocked, admin-blocked, inactive, no-Telegram and already-finished users are skipped", { skip }, async () => {
  await quietEveryoneElse();
  const d = sendDay();
  const ok = await newUser();
  const optedOut = await newUser();
  await query("UPDATE users SET daily_quiz_off = true WHERE id = $1", [optedOut.id]);
  const botBlocked = await newUser();
  await query("UPDATE users SET bot_blocked_at = now() WHERE id = $1", [botBlocked.id]);
  const blocked = await newUser();
  await query("UPDATE users SET is_blocked = true WHERE id = $1", [blocked.id]);
  const inactive = await newUser();
  await query("UPDATE users SET updated_at = now() - interval '45 days' WHERE id = $1", [inactive.id]);
  const finished = await newUser();
  await query("INSERT INTO daily_quiz_attempts (user_id, day, answers, correct, finished_at, outcome) VALUES ($1, $2, '{0,0,0}', 1, now(), 'lost')", [finished.id, d]);
  const noTelegram = (await queryOne<{ id: string }>("INSERT INTO users (username, name, phone) VALUES ($1, 'No Telegram', '+998901112233') RETURNING id", [`dq_nt_${randomInt(1_000_000_000)}`]))!.id;
  userIds.push(noTelegram);
  // Quiet on the account for 45 days but with a recent generation / web session: still active.
  const viaGeneration = await newUser();
  await query("UPDATE users SET updated_at = now() - interval '45 days' WHERE id = $1", [viaGeneration.id]);
  await query("INSERT INTO generations (id, user_id, tool_id, status) VALUES (gen_random_uuid(), $1, 'slide', 'COMPLETED')", [viaGeneration.id]);
  const viaSession = await newUser();
  await query("UPDATE users SET updated_at = now() - interval '45 days' WHERE id = $1", [viaSession.id]);
  await query(
    "INSERT INTO sessions (user_id, token_hash, expires_at, last_seen_at, created_at) VALUES ($1, $2, now() + interval '1 day', now() - interval '2 days', now() - interval '60 days')",
    [viaSession.id, `dq-sess-${randomInt(1_000_000_000)}`],
  );

  const r = recorder();
  await runDailyQuizSend({ now: at(d, 10), limiter: fakeLimiter, send: r.send, batch: 3 });
  assert.deepEqual(r.got.map((g) => g.userId).sort(), [ok.id, viaGeneration.id, viaSession.id].sort());
  const row = await sendsRow(d);
  assert.ok(row?.finished_at);
  assert.equal(row?.sent, 3);
});

test("sender: one send pass per day — a second tick and two parallel workers never message anybody twice", { skip }, async () => {
  await quietEveryoneElse();
  const d = sendDay();
  const users = await Promise.all(Array.from({ length: 7 }, () => newUser()));
  const r = recorder();
  const deps = { now: at(d, 10), limiter: fakeLimiter, send: r.send, batch: 2 };
  // Two workers tick at the same moment.
  await Promise.all([runDailyQuizSend(deps), runDailyQuizSend(deps)]);
  // Keep ticking until the pass is finished (the parallel workers may each have lost some batch races).
  for (let i = 0; i < 20 && !(await sendsRow(d))?.finished_at; i++) await runDailyQuizSend(deps);
  assert.ok((await sendsRow(d))?.finished_at, "the pass finished");
  const ids = r.got.map((g) => g.userId);
  assert.equal(new Set(ids).size, ids.length, "nobody got the message twice");
  assert.deepEqual([...ids].sort(), users.map((u) => u.id).sort(), "everybody got it once");
  assert.equal((await queryOne<{ n: string }>("SELECT count(*)::text n FROM daily_quiz_sends WHERE day = $1", [d]))!.n, "1", "one claim row");
  assert.equal((await sendsRow(d))?.sent, 7);

  // Later ticks the same day send nothing, even to a user who became eligible after the pass.
  const late = await newUser();
  assert.equal(await runDailyQuizSend(deps), 0);
  assert.equal(r.got.some((g) => g.userId === late.id), false);
  // The next day is a new pass.
  const d2 = sendDay();
  const r2 = recorder();
  await runDailyQuizSend({ now: at(d2, 10), limiter: fakeLimiter, send: r2.send });
  assert.ok(r2.got.some((g) => g.userId === late.id));
  assert.equal(r2.got.length, 8);
});

test("sender: paced in batches across ticks, resumes from the cursor, and an interruption never double-sends", { skip }, async () => {
  await quietEveryoneElse();
  const d = sendDay();
  const users = await Promise.all(Array.from({ length: 6 }, () => newUser()));
  const ordered = [...users].sort((a, b) => Number(a.id) - Number(b.id));

  // A tick with no time budget left sends exactly one batch and stops.
  const r = recorder();
  const deps = { now: at(d, 10), limiter: fakeLimiter, batch: 2, budgetMs: 0 };
  assert.equal(await runDailyQuizSend({ ...deps, send: r.send }), 2);
  assert.deepEqual(r.got.map((g) => g.userId), ordered.slice(0, 2).map((u) => u.id));
  const mid = await sendsRow(d);
  assert.equal(mid?.finished_at, null);
  assert.equal(mid?.last_user_id, ordered[1]!.id, "the cursor is at the last user of the batch");

  // The next tick continues after the cursor; its 2nd send crashes (a restart in the middle of a batch).
  let n = 0;
  const crashing = (async (target: Dm) => {
    if (++n === 2) throw new Error("simulated crash");
    r.got.push(target);
    return "sent" as const;
  }) as unknown as SendFn;
  await assert.rejects(runDailyQuizSend({ ...deps, send: crashing }), /simulated crash/);
  // Resume: the crashed batch was already claimed (at-most-once), so only the rest is sent.
  for (let i = 0; i < 10 && !(await sendsRow(d))?.finished_at; i++) await runDailyQuizSend({ ...deps, send: r.send });
  const ids = r.got.map((g) => g.userId);
  assert.equal(new Set(ids).size, ids.length, "no duplicates after an interruption");
  assert.deepEqual(ids, [ordered[0]!.id, ordered[1]!.id, ordered[2]!.id, ordered[4]!.id, ordered[5]!.id], "only the batch in flight (user 4) is lost");
  assert.ok((await sendsRow(d))?.finished_at);
});

test("sender end to end: the invitation text, both buttons, the user's language; a blocked bot is marked", { skip }, async () => {
  await quietEveryoneElse();
  const d = sendDay();
  const uz = await newUser("uz");
  const ru = await newUser("ru");
  const gone = await newUser("en");
  blockedChats.add(gone.tg);
  const sentCount = await runDailyQuizSend({ now: at(d, 10), limiter: fakeLimiter });
  assert.equal(sentCount, 2);

  const m1 = sentTo(uz.tg);
  assert.equal(m1.length, 1);
  assert.equal(m1[0]!.text, "🧠 Kunlik savollar: 3 ta savolga to‘g‘ri javob bering — +500 bonus so‘m!");
  assert.deepEqual(buttons(m1[0]!).map((b) => [b.text, b.callback_data]), [["Boshlash", "dq:s"], ["Obunani o‘chirish", "dq:off"]]);
  const m2 = sentTo(ru.tg);
  assert.match(m2[0]!.text, /Вопросы дня.*\+500 бонусных сум/);
  assert.deepEqual(buttons(m2[0]!).map((b) => b.callback_data), ["dq:s", "dq:off"]);
  assert.ok((await queryOne<{ b: Date | null }>("SELECT bot_blocked_at AS b FROM users WHERE id = $1", [gone.id]))!.b, "403 marks the user bot-blocked");

  // Reward 0: the invitation does not promise a bonus.
  const d2 = sendDay();
  await setSetting("daily_quiz.reward", 0);
  calls = [];
  await runDailyQuizSend({ now: at(d2, 10), limiter: fakeLimiter });
  assert.equal(sentTo(uz.tg)[0]!.text, "🧠 Kunlik savollar: bugungi 3 ta mantiqiy savolga javob bering!");
});

/* ───────────────────────── bot: commands and callbacks ───────────────────────── */

const tg = await import("../lib/server/telegram.ts");
const router = await import("../lib/server/bot/router.ts");
const { parseCallback } = await import("../lib/server/bot/codes.ts");
const dqBot = await import("../lib/server/bot/daily-quiz.ts");
let seq = Date.now() * 1000 + 900_000;
const textUpdate = (from: number, text: string) => ({
  update_id: ++seq,
  message: { message_id: ++seq, chat: { id: from, type: "private" as const }, from: { id: from, first_name: "Quiz" }, text },
});
const today = () => rules.tashkentDay();
const dayNo = () => rules.dayNumber(today());
const tap = (chat: { id: number; type?: string }, from: number, data: string, messageId = 11) =>
  router.handleCallback({ id: `cq${++seq}`, from: { id: from }, message: { message_id: messageId, chat }, data }, ++seq);
const privateChat = (id: number) => ({ id, type: "private" });

test("bot commands: /savol and /obuna are menu commands with text in every language", () => {
  assert.ok((tg.BOT_COMMANDS as readonly string[]).includes("savol"));
  assert.ok((tg.BOT_COMMANDS as readonly string[]).includes("obuna"));
  for (const lang of LANGS) {
    assert.ok(t(lang, "cmd.savol").length > 5, lang);
    assert.ok(t(lang, "cmd.obuna").length > 5, lang);
  }
});

test("callback data: compact and strictly parsed", () => {
  assert.deepEqual(parseCallback("dq:s"), { kind: "dqStart" });
  assert.deepEqual(parseCallback("dq:off"), { kind: "dqOff" });
  assert.deepEqual(parseCallback("dq:on"), { kind: "dqOn" });
  assert.deepEqual(parseCallback("dq:a:20384:2:3"), { kind: "dqAnswer", day: 20384, q: 2, choice: 3 });
  for (const bad of ["dq:a:20384:3:0", "dq:a:20384:0:4", "dq:a:0:0:0", "dq:a:20384:0", "dq:a:20384:0:1:9", "dq:a:x:0:1", "dq:a:20384:0:1 ", "dq:x", "dq:a:1234567:0:0", "dq:s:1"]) {
    assert.deepEqual(parseCallback(bad), { kind: "unknown" }, bad);
  }
  assert.ok(Buffer.byteLength("dq:a:999999:2:3") <= 64);
});

test("/savol when disabled is refused and creates nothing", { skip }, async () => {
  await setSetting("daily_quiz.enabled", false);
  const u = await newUser();
  await tg.handleUpdate(textUpdate(Number(u.tg), "/savol"));
  const out = sentTo(u.tg);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.text, "Kunlik savollar hozircha o‘chiq.");
  assert.equal((await queryOne<{ n: string }>("SELECT count(*)::text n FROM daily_quiz_attempts WHERE user_id = $1", [u.id]))!.n, "0");
});

const htmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

test("/savol -> answers by callback: ✅/❌ + explanation, the next question in the same message, then the result; replays change nothing", { skip }, async () => {
  const u = await newUser();
  const tgId = Number(u.tg);
  const qs = quiz.todaysQuestions(today());
  await tg.handleUpdate(textUpdate(tgId, "/savol"));
  const first = sentTo(u.tg);
  assert.equal(first.length, 1);
  assert.match(first[0]!.text, /Savol 1\/3/);
  assert.ok(first[0]!.text.includes(htmlEsc(qs[0]!.q)));
  assert.deepEqual(buttons(first[0]!).map((b) => b.text), ["A", "B", "C", "D"]);
  assert.deepEqual(buttons(first[0]!).map((b) => b.callback_data), [0, 1, 2, 3].map((c) => `dq:a:${dayNo()}:0:${c}`));

  // Q1 wrong -> ❌ with the right letter + explanation, and question 2 is offered in the same message.
  const wrong = (qs[0]!.answer + 1) % 4;
  await tap(privateChat(tgId), tgId, `dq:a:${dayNo()}:0:${wrong}`);
  const e1 = edits().at(-1)!;
  assert.match(e1.text, /❌ Noto‘g‘ri\. To‘g‘ri javob: [A-D]\)/);
  assert.ok(e1.text.includes(`${"ABCD"[qs[0]!.answer]}) ${htmlEsc(qs[0]!.options[qs[0]!.answer])}`));
  assert.ok(e1.text.includes(htmlEsc(qs[0]!.explain)), "the explanation follows the verdict");
  assert.match(e1.text, /Savol 2\/3/);
  assert.deepEqual(buttons(e1).map((b) => b.callback_data), [0, 1, 2, 3].map((c) => `dq:a:${dayNo()}:1:${c}`));
  assert.equal(toasts().at(-1), "❌ Noto‘g‘ri");

  // The same question tapped again with the right option (double tap / redelivery): the first answer stands.
  const sendsBefore = calls.filter((c) => c.method === "sendMessage").length;
  await tap(privateChat(tgId), tgId, `dq:a:${dayNo()}:0:${qs[0]!.answer}`);
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, sendsBefore, "no second message");
  assert.match(edits().at(-1)!.text, /❌ Noto‘g‘ri/);
  assert.equal(toasts().at(-1), "Bu savolga javob allaqachon qabul qilingan");

  await tap(privateChat(tgId), tgId, `dq:a:${dayNo()}:1:${qs[1]!.answer}`);
  assert.match(edits().at(-1)!.text, /✅ To‘g‘ri!/);
  assert.match(edits().at(-1)!.text, /Savol 3\/3/);
  assert.equal(toasts().at(-1), "✅ To‘g‘ri!");

  // 2/3: the third answer is right, but Q1 was wrong.
  await tap(privateChat(tgId), tgId, `dq:a:${dayNo()}:2:${qs[2]!.answer}`);
  assert.match(edits().at(-1)!.text, /2\/3 — ertaga yana urinib ko‘ring/);
  assert.equal(edits().at(-1)!.markup?.inline_keyboard.length ?? 0, 0, "no buttons on the final message");
  assert.equal(await points(u.id), 2000, "the signup bonus only");
  // /savol again: already answered.
  calls = [];
  await tg.handleUpdate(textUpdate(tgId, "/savol"));
  assert.equal(sentTo(u.tg)[0]!.text, "Siz bugungi savollarga allaqachon javob berdingiz (2/3). Yangi savollar ertaga.");
});

test("bot 3/3: the credit message, the ledger row, one credit even when the last button is tapped twice", { skip }, async () => {
  const u = await newUser("en");
  const tgId = Number(u.tg);
  const qs = quiz.todaysQuestions(today());
  await tg.handleUpdate(textUpdate(tgId, "/savol"));
  for (let i = 0; i < 3; i++) await tap(privateChat(tgId), tgId, `dq:a:${dayNo()}:${i}:${qs[i]!.answer}`);
  assert.match(edits().at(-1)!.text, /3\/3 — \+500 bonus UZS added to your wallet!/);
  await tap(privateChat(tgId), tgId, `dq:a:${dayNo()}:2:${qs[2]!.answer}`);
  assert.equal(await points(u.id), 2000 + 500);
  assert.equal((await ledgerOf(u.id)).length, 1);
  // The question text is Uzbek for everybody; the chrome follows the user's language.
  assert.ok(edits()[0]!.text.includes("Question 2/3"));
});

test("uz result copy: credited, lost, cap, budget, no reward", () => {
  assert.equal(dqBot.resultText("uz", { correct: 3, outcome: "paid", rewarded: 500, monthlyCap: null }), "3/3 — +500 bonus so‘m hamyoningizga tushdi!");
  assert.equal(dqBot.resultText("uz", { correct: 2, outcome: "lost", rewarded: 0, monthlyCap: null }), "2/3 — ertaga yana urinib ko‘ring");
  assert.match(dqBot.resultText("uz", { correct: 3, outcome: "cap", rewarded: 0, monthlyCap: 5000 }), /bu oy .*chegarasi \(5\s000 bonus so‘m\).*bonus berilmaydi/);
  assert.match(dqBot.resultText("uz", { correct: 3, outcome: "budget", rewarded: 0, monthlyCap: null }), /bugungi bonus fondi tugadi/);
  assert.equal(dqBot.resultText("uz", { correct: 3, outcome: "none", rewarded: 0, monthlyCap: null }), "3/3 — barakalla!");
});

test("bot: over the global budget the winner is told the fund is empty and gets no credit", { skip }, async () => {
  await setSetting("daily_quiz.daily_budget", 0);
  const u = await newUser();
  const tgId = Number(u.tg);
  const qs = quiz.todaysQuestions(today());
  await tg.handleUpdate(textUpdate(tgId, "/savol"));
  for (let i = 0; i < 3; i++) await tap(privateChat(tgId), tgId, `dq:a:${dayNo()}:${i}:${qs[i]!.answer}`);
  assert.match(edits().at(-1)!.text, /bugungi bonus fondi tugadi/);
  assert.equal((await ledgerOf(u.id)).length, 0);
});

test("callbacks reject a forged user, a group chat and a stale day; nothing is stored", { skip }, async () => {
  const a = await newUser();
  const b = await newUser();
  const aId = Number(a.tg);
  const bId = Number(b.tg);
  const right = quiz.todaysQuestions(today())[0]!.answer;
  const attempts = async () => Number((await queryOne<{ n: string }>("SELECT count(*)::text n FROM daily_quiz_attempts WHERE user_id = ANY($1)", [[a.id, b.id]]))!.n);

  // B taps a button on a message in A's private chat: from.id != chat.id.
  await tap(privateChat(aId), bId, `dq:a:${dayNo()}:0:${right}`);
  assert.equal(toasts().at(-1), "Bu tugma siz uchun emas");
  // A button inside a group the bot is in (the sender is a real user, the chat is not private).
  await tap({ id: -1001234567, type: "supergroup" }, aId, `dq:a:${dayNo()}:0:${right}`);
  assert.equal(toasts().at(-1), "Bu tugma siz uchun emas");
  await tap({ id: aId, type: "group" }, aId, "dq:s");
  assert.equal(toasts().at(-1), "Bu tugma siz uchun emas");
  assert.equal(await attempts(), 0, "no attempt row for anybody");
  assert.equal(edits().length, 0);

  // Yesterday's keyboard: the day number in the data is not today's.
  await tap(privateChat(aId), aId, `dq:a:${dayNo() - 1}:0:${right}`);
  assert.equal(toasts().at(-1), "Bu savol eskirgan — yangisini /savol bilan oling.");
  assert.equal(await attempts(), 0);

  // The user is whoever sent the callback: B tapping in B's own chat answers for B only.
  await tap(privateChat(bId), bId, `dq:a:${dayNo()}:0:${right}`);
  const rows = await query<{ user_id: string }>("SELECT user_id::text FROM daily_quiz_attempts WHERE user_id = ANY($1)", [[a.id, b.id]]);
  assert.deepEqual(rows.map((r) => r.user_id), [b.id]);

  // Out-of-order answers and a closed quiz.
  await tap(privateChat(bId), bId, `dq:a:${dayNo()}:2:0`);
  assert.equal(toasts().at(-1), "Bu savol eskirgan — yangisini /savol bilan oling.");
  await setSetting("daily_quiz.enabled", false);
  await tap(privateChat(bId), bId, `dq:a:${dayNo()}:1:0`);
  assert.equal(toasts().at(-1), "Kunlik savollar hozircha o‘chiq.");
  const row = await queryOne<{ answers: number[] }>("SELECT answers FROM daily_quiz_attempts WHERE user_id = $1", [b.id]);
  assert.equal(row!.answers.length, 1, "nothing was recorded while disabled");
});

test("/obuna and the buttons turn the morning message off and on", { skip }, async () => {
  const u = await newUser();
  const tgId = Number(u.tg);
  await tg.handleUpdate(textUpdate(tgId, "/obuna"));
  assert.equal(await quiz.isQuizOptedOut(u.id), true);
  assert.match(sentTo(u.tg).at(-1)!.text, /o‘chirildi/);
  assert.deepEqual(buttons(sentTo(u.tg).at(-1)!).map((b) => b.callback_data), ["dq:on"]);
  await tap(privateChat(tgId), tgId, "dq:on");
  assert.equal(await quiz.isQuizOptedOut(u.id), false);
  assert.match(edits().at(-1)!.text, /yoqildi/);
  await tap(privateChat(tgId), tgId, "dq:off");
  assert.equal(await quiz.isQuizOptedOut(u.id), true);
  assert.deepEqual(buttons(edits().at(-1)!).map((b) => b.callback_data), ["dq:on"]);
  await tg.handleUpdate(textUpdate(tgId, "/obuna"));
  assert.equal(await quiz.isQuizOptedOut(u.id), false);
  // An opted-out user can still play with /savol.
  await tap(privateChat(tgId), tgId, "dq:off");
  calls = [];
  await tg.handleUpdate(textUpdate(tgId, "/savol"));
  assert.match(sentTo(u.tg)[0]!.text, /Savol 1\/3/);
});

test("ledger title: «Kunlik savollar bonusi» in the bot (all languages) and the web wallet", async () => {
  const scr = await import("../lib/server/bot/screens.ts");
  const { describeEntry } = await import("../components/wallet/wallet-model.ts");
  assert.equal(scr.ledgerTitle("uz", { kind: "bonus", note: "Kunlik savollar bonusi" }), "Kunlik savollar bonusi");
  assert.equal(scr.ledgerTitle("ru", { kind: "bonus", note: "Kunlik savollar bonusi" }), "Бонус за вопросы дня");
  assert.equal(scr.ledgerTitle("en", { kind: "bonus", note: "Kunlik savollar bonusi" }), "Daily questions bonus");
  assert.deepEqual(describeEntry({ kind: "bonus", note: "Kunlik savollar bonusi" }), { title: "Kunlik savollar bonusi", detail: "" });
});
