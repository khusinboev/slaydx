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
