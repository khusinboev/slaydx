/**
 * «Ilovani baholang» (docs/program-17/PLAN.md item 9): `lib/rating.ts` (validator) and
 * `lib/server/ratings.ts` (service) on real Postgres.
 *
 * Mutation checks (each was broken on purpose, the named test failed, then restored):
 *   1. the COMPLETED-generation query removed from `submitRating`     -> «no finished generation»;
 *   2. `ON CONFLICT DO NOTHING` + already_rated check removed         -> «second submit» / «parallel submits»;
 *   3. `checkFeedback` reduced to the length check only               -> «validator rejects junk»;
 *   4. the `topUpInTx` call removed                                   -> «happy path».
 */
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("rating") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const R = await import("../lib/rating.ts");
const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const svc = await import("../lib/server/ratings.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { ApiError } = await import("../lib/server/api.ts");
if (!skip) await ensureMigrated();

after(async () => {
  if (skip) return;
  await pool().end();
  await iso.drop();
});

const GOOD = "Ilova juda qulay, slaydlar tez tayyorlanadi va dizayni menga yoqdi.";

async function newUser(): Promise<string> {
  const tg = 7_700_000_000 + randomInt(0, 99_999_999);
  return (await upsertTelegramUser({ telegramId: String(tg), username: null, name: "Rating Test", photoUrl: null })).id;
}
async function finish(userId: string, status = "COMPLETED"): Promise<void> {
  await query("INSERT INTO generations (id, user_id, tool_id, status) VALUES ($1, $2, 'slide', $3)", [randomUUID(), userId, status]);
}
const points = async (id: string) => Number((await queryOne<{ p: number }>("SELECT points AS p FROM users WHERE id = $1", [id]))!.p);
const ledger = (id: string) =>
  query<{ reference: string; points_delta: number; note: string }>(
    "SELECT reference, points_delta::int AS points_delta, note FROM transactions WHERE user_id = $1 AND kind = 'bonus' AND reference LIKE 'rating:%'",
    [id],
  );
async function rejects(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof ApiError && e.status === status && e.extra.code === code, `${status} ${code}`);
}

/* ───────────────────────── validator (no DB) ───────────────────────── */

test("validator accepts realistic Uzbek / Russian / English feedback", () => {
  const good = [
    GOOD,
    "Kurs ishini yozishda katta yordam berdi, lekin narxlar biroz qimmatroq tuyuldi.",
    "O'qituvchi sifatida dars rejalarini tayyorlash juda oson bo'ldi, rahmat!",
    "Очень удобное приложение, презентация готова за несколько минут, спасибо!",
    "Хотелось бы больше шаблонов для рефератов и возможность выбрать шрифт.",
    "Great app, the slides looked professional and saved me hours of work.",
    "Rezyume shablonlari chiroyli chiqdi, faqat rasm yuklash biroz sekin ishladi.",
  ];
  for (const text of good) {
    const c = R.checkFeedback(text);
    assert.ok(c.ok, `${text} -> ${c.ok ? "" : c.code}`);
  }
  assert.equal((R.checkFeedback(`   ${GOOD}\n\n  `) as { text: string }).text, GOOD, "trimmed and collapsed");
});

test("validator rejects junk (short, mash, repeats, digits, emoji, single letters)", () => {
  const junk: Array<[string, string]> = [
    ["juda yaxshi", "too_short"],
    ["", "too_short"],
    ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaa aaaaaa aaaaaaaa aaaaaaaa aaaaa", "repetitive"],
    ["asdfghjkl asdfghjkl asdfghjkl asdfghjkl asdfghjkl", "repetitive"],
    ["asdfgh qwerty zxcvbn poiuyt lkjhgf mnbvcx", "gibberish"],
    ["sdfsdf dfgdfg ghjghj hjkhjk jklhjk lkjlkj", "gibberish"],
    ["asd asd fgh fgh jkl jkl zxc zxc qwe qwe", "gibberish"],
    ["yaxshi yaxshi yaxshi yaxshi yaxshi yaxshi yaxshi", "repetitive"],
    ["ha ha ha ha ha ha ha ha ha ha ha ha ha ha ha ha", "repetitive"],
    ["1234567890 1234567890 1234567890 1234567890", "not_text"],
    ["😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀", "not_text"],
    ["a b c d e f g h i j k l m n o p q r s t u v w x y z", "too_few_words"],
    ["ыыыыыыыыы ыыыыыыыы ыыыыыыыыы ыыыыыыы ыыыыыыыыы", "repetitive"],
    ["йцукен фывапр ячсмит ролдже гшщзхъ укенгш", "gibberish"],
    ["!!!!! ????? ..... ,,,,, ----- ;;;;; ===== +++++ #####", "not_text"],
    ["x".repeat(1001), "too_long"],
  ];
  for (const [text, code] of junk) {
    const c = R.checkFeedback(text);
    assert.ok(!c.ok, `must reject: ${text.slice(0, 40)}`);
    if (!c.ok) assert.equal(c.code, code, text.slice(0, 40));
  }
  assert.equal(R.isStars(0), false);
  assert.equal(R.isStars(6), false);
  assert.equal(R.isStars(3.5), false);
  assert.equal(R.isStars("5"), false);
  assert.equal(R.isStars(5), true);
});

test("feedbackHint: shows what is missing, null when valid", () => {
  assert.match(R.feedbackHint("")!, /30/);
  assert.match(R.feedbackHint("juda yaxshi")!, /19 ta belgi/);
  assert.equal(R.feedbackHint(GOOD), null);
  assert.ok(R.feedbackHint("qwertyuiop asdfghjkl zxcvbnm qwerty asdfgh"));
});

/* ───────────────────────── service ───────────────────────── */

test("settings: bonus.rating_points defaults to 500, 0..100000 integers only", { skip }, async () => {
  const s = await import("../lib/server/settings.ts");
  assert.equal(s.settingDef("bonus.rating_points").envDefault(), 500);
  assert.equal(s.validateSetting("bonus.rating_points", 0).ok, true);
  for (const bad of [-1, 100_001, 2.5, "500", null]) assert.equal(s.validateSetting("bonus.rating_points", bad).ok, false, String(bad));
});

test("happy path: 500 bonus once, ledger rating:<id>, status flips to rated", { skip }, async () => {
  const id = await newUser();
  const before = await points(id);
  assert.deepEqual(await svc.getRatingStatus(id), { rated: false, stars: null, hasFinished: false, rewardPoints: 500 });
  await finish(id);
  assert.equal((await svc.getRatingStatus(id)).hasFinished, true);

  const r = await svc.submitRating(id, 5, `  ${GOOD}  `);
  assert.deepEqual(r, { stars: 5, rewardPoints: 500, credited: true });
  assert.equal((await points(id)) - before, 500);
  assert.deepEqual(await ledger(id), [{ reference: `rating:${id}`, points_delta: 500, note: "Baholash bonusi" }]);
  const row = await queryOne<{ stars: number; feedback: string }>("SELECT stars, feedback FROM app_ratings WHERE user_id = $1", [id]);
  assert.deepEqual(row, { stars: 5, feedback: GOOD });
  assert.deepEqual(await svc.getRatingStatus(id), { rated: true, stars: 5, hasFinished: true, rewardPoints: 500 });
});

test("second submit: already_rated, no extra credit, first rating kept", { skip }, async () => {
  const id = await newUser();
  await finish(id);
  await svc.submitRating(id, 4, GOOD);
  const after1 = await points(id);
  await rejects(svc.submitRating(id, 1, "Boshqa fikr yozaman, lekin bu ikkinchi urinish bo'ladi."), 409, "already_rated");
  assert.equal(await points(id), after1);
  assert.equal((await ledger(id)).length, 1);
  assert.equal((await queryOne<{ stars: number }>("SELECT stars FROM app_ratings WHERE user_id = $1", [id]))!.stars, 4);
});

test("parallel submits: exactly one row and one credit", { skip }, async () => {
  const id = await newUser();
  await finish(id);
  const before = await points(id);
  const res = await Promise.allSettled([svc.submitRating(id, 5, GOOD), svc.submitRating(id, 5, GOOD), svc.submitRating(id, 5, GOOD)]);
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await ledger(id)).length, 1);
  assert.equal((await points(id)) - before, 500);
  assert.equal(Number((await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM app_ratings WHERE user_id = $1", [id]))!.n), 1);
});

test("no finished generation: rejected, nothing written (QUEUED / FAILED / REVOKED do not count)", { skip }, async () => {
  const id = await newUser();
  await rejects(svc.submitRating(id, 5, GOOD), 403, "no_generation");
  for (const st of ["QUEUED", "IN_PROGRESS", "FAILED", "REVOKED"]) await finish(id, st);
  await rejects(svc.submitRating(id, 5, GOOD), 403, "no_generation");
  assert.equal((await ledger(id)).length, 0);
  assert.equal((await queryOne("SELECT 1 FROM app_ratings WHERE user_id = $1", [id])), null);
  await finish(id); // a COMPLETED one unlocks it
  assert.equal((await svc.submitRating(id, 3, GOOD)).credited, true);
});

test("stars out of range and bad feedback are rejected before anything is written", { skip }, async () => {
  const id = await newUser();
  await finish(id);
  for (const s of [0, 6, -1, 2.5, "5", null, undefined]) await rejects(svc.submitRating(id, s, GOOD), 400, "bad_stars");
  await rejects(svc.submitRating(id, 5, "yaxshi"), 400, "too_short");
  await rejects(svc.submitRating(id, 5, "asdfgh qwerty zxcvbn poiuyt lkjhgf mnbvcx"), 400, "gibberish");
  assert.equal(await queryOne("SELECT 1 FROM app_ratings WHERE user_id = $1", [id]), null);
  assert.equal((await ledger(id)).length, 0);
});

test("reward setting: 0 stores the rating without paying; a new value applies to the next rating", { skip }, async () => {
  const a = await newUser();
  const b = await newUser();
  await finish(a);
  await finish(b);
  try {
    await query(`INSERT INTO app_settings (key, value) VALUES ('bonus.rating_points', '0'::jsonb) ON CONFLICT (key) DO UPDATE SET value = '0'::jsonb`);
    const base = await points(a);
    assert.deepEqual(await svc.submitRating(a, 2, GOOD), { stars: 2, rewardPoints: 0, credited: false });
    assert.equal(await points(a), base);
    assert.equal((await svc.getRatingStatus(a)).rated, true);
    await query(`UPDATE app_settings SET value = '750'::jsonb WHERE key = 'bonus.rating_points'`);
    const baseB = await points(b);
    assert.equal((await svc.submitRating(b, 5, GOOD)).rewardPoints, 750);
    assert.equal((await points(b)) - baseB, 750);
  } finally {
    await query("DELETE FROM app_settings WHERE key = 'bonus.rating_points'");
  }
});

test("admin list: newest first, average and distribution, no phone", { skip }, async () => {
  await query("DELETE FROM app_ratings");
  const ids = [await newUser(), await newUser(), await newUser()];
  for (const [i, id] of ids.entries()) {
    await finish(id);
    await svc.submitRating(id, [5, 4, 4][i]!, GOOD);
    await query("UPDATE app_ratings SET created_at = now() - make_interval(mins => $2) WHERE user_id = $1", [id, 10 - i]);
  }
  const l = await svc.listRatings(2);
  assert.equal(l.count, 3);
  assert.equal(l.average, 4.33);
  assert.deepEqual(l.distribution, [0, 0, 0, 2, 1]);
  assert.equal(l.items.length, 2);
  assert.equal(l.items[0]!.userId, ids[2]);
  assert.ok(!("phone" in l.items[0]!));
});
