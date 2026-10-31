/**
 * «Test ishlash» -- paid tests (owner request 7, migration 060): `lib/tests/rules.ts` (pure selection and scoring),
 * `lib/server/paid-tests.ts` (the service) and the `/api/tests/*` routes on real Postgres (own throwaway database).
 * The question bank is seeded straight into the tables (the importer has its own test).
 *
 * Mutation checks (each broken on purpose, the named test failed, then restored):
 *   1. the answer key leaks into the running attempt's questions (`answer` added to the active view)
 *                                                                   -> «the answer key is never in a pre-finish response»;
 *   2. the deadline check removed from `answerQuestion`             -> «server-side deadline»;
 *   3. start charges twice (the existing-attempt early return and the per-attempt charge reference made per call)
 *                                                                   -> «start charges once»;
 *   5. the finished review built from the LIVE key instead of the snapshot
 *                                                                   -> «key snapshot: a finished result never follows a corrected key…»;
 *   6. «hammasi» charged the one-subject price (`priceFor` returns `prices.subject` for both modes)
 *                                                                   -> «price by mode…»;
 *   4. the explanation / key selected for an ACTIVE attempt (`loadQuestions(ids, false)` -> `true`)
 *                                                                   -> «the answer key is never in a pre-finish response».
 */
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://slaydx.test";
process.env.WORKER_INLINE = "false";
import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { clearSetting, mkUser, setSetting, wallet } from "./helpers/chat-fixtures.mts";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("paidtests") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

const rules = await import("../lib/tests/rules.ts");

/* ───────────────────────── pure rules (no database) ───────────────────────── */

test("answer letters: a-d in any case, nothing else", () => {
  assert.deepEqual(["a", "B", "c", "D", " b "].map(rules.parseAnswerLetter), [0, 1, 2, 3, 1]);
  for (const bad of ["e", "ab", "", "1", null, undefined, 2, "А"]) assert.equal(rules.parseAnswerLetter(bad), null, String(bad));
});

test("scoring: integer hundredths, 7 x 1.1 is exactly 7.7, no negatives", () => {
  assert.equal(rules.scoreOf(7, 1.1), 7.7);
  assert.equal(rules.scoreOf(10, 1.1), 11);
  assert.equal(rules.scoreOf(30, 1.1), 33);
  assert.equal(rules.scoreOf(3, 1.1), 3.3);
  assert.equal(rules.scoreOf(0, 1.1), 0);
  assert.equal(rules.scoreOf(9, 0.3), 2.7);
});

test("deadline is strictly after the limit", () => {
  const d = new Date("2026-10-24T10:20:00.000Z");
  assert.equal(rules.isPastDeadline(d, new Date("2026-10-24T10:20:00.000Z")), false);
  assert.equal(rules.isPastDeadline(d, new Date("2026-10-24T10:20:00.001Z")), true);
});

test("selection: seeded RNG gives a deterministic, single-variant, random-order pick", () => {
  // Variant 1: ids 1-12, variant 2: ids 13-24, variant 3 is too small (ids 25-28).
  const pool = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: 1 + i, variant: 1 })),
    ...Array.from({ length: 12 }, (_, i) => ({ id: 13 + i, variant: 2 })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: 25 + i, variant: 3 })),
  ];
  const a = rules.pickSubjectQuestions(pool, 10, rules.seededRng(7));
  const b = rules.pickSubjectQuestions(pool, 10, rules.seededRng(7));
  assert.deepEqual(a, b, "same seed, same pick");
  assert.deepEqual(a, [6, 10, 12, 9, 3, 2, 8, 4, 5, 7], "pinned: variant 1, this order");
  assert.equal(a.length, 10);
  assert.equal(new Set(a).size, 10);
  const variantOf = (id: number) => pool.find((q) => q.id === id)!.variant;
  for (let seed = 0; seed < 200; seed++) {
    const pick = rules.pickSubjectQuestions(pool, 10, rules.seededRng(seed));
    assert.equal(new Set(pick.map(variantOf)).size, 1, "one variant per subject");
    assert.notEqual(variantOf(pick[0]!), 3, "the too-small variant is skipped while complete ones exist");
  }
  const variants = new Set(Array.from({ length: 40 }, (_, s) => variantOf(rules.pickSubjectQuestions(pool, 10, rules.seededRng(s))[0]!)));
  assert.deepEqual([...variants].sort(), [1, 2], "the variant is random across seeds");
  const orders = new Set(Array.from({ length: 40 }, (_, s) => rules.pickSubjectQuestions(pool, 10, rules.seededRng(s)).join()));
  assert.ok(orders.size > 20, "the order is random across seeds");
  // No complete variant: the largest one is played whole; an empty pool gives nothing.
  assert.deepEqual(rules.pickSubjectQuestions(pool.slice(0, 3), 10, rules.seededRng(1)).sort((x, y) => x - y), [1, 2, 3]);
  assert.deepEqual(rules.pickSubjectQuestions([], 10, rules.seededRng(1)), []);
  // A variant of exactly 20 gives a random half (the BMB variants 6-8).
  const big = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, variant: 6 }));
  const half = rules.pickSubjectQuestions(big, 10, rules.seededRng(3));
  assert.equal(new Set(half).size, 10);
});

/* ───────────────────────── service + routes ───────────────────────── */

test("paid tests: service and API", { skip }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const svc = await import("../lib/server/paid-tests.ts");
  const startRoute = await import("../app/api/tests/start/route.ts");
  const overviewRoute = await import("../app/api/tests/route.ts");
  const attemptRoute = await import("../app/api/tests/attempts/[id]/route.ts");
  const answerRoute = await import("../app/api/tests/attempts/[id]/answer/route.ts");
  const finishRoute = await import("../app/api/tests/attempts/[id]/finish/route.ts");
  const imageRoute = await import("../app/api/tests/attempts/[id]/image/[qid]/route.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  /* fixtures */
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082", "hex");
  const SUBJECTS = [
    { code: "math", name: "Matematika" },
    { code: "ona_tili", name: "Ona tili" },
    { code: "tarix", name: "Tarix" },
  ];
  const bank = (await queryOne<{ id: string }>("INSERT INTO test_banks (slug, title) VALUES ('bmb', 'Tayyor testlar') RETURNING id::text AS id"))!.id;
  const asset = (await queryOne<{ id: string }>(
    "INSERT INTO test_assets (sha256, mime, size_bytes, bytes) VALUES ($1, 'image/png', $2, $3) RETURNING id::text AS id",
    ["ab".repeat(32), PNG.length, PNG],
  ))!.id;
  const imageQuestion: Record<string, number> = {};
  for (const [si, s] of SUBJECTS.entries()) {
    const sid = (await queryOne<{ id: string }>("INSERT INTO test_subjects (bank_id, code, name, sort) VALUES ($1, $2, $3, $4) RETURNING id::text AS id", [bank, s.code, s.name, si]))!.id;
    // Variants 1 and 2 hold 12 questions, variant 3 only 4 (never complete for 10 per attempt).
    for (const [variant, n] of [[1, 12], [2, 12], [3, 4]] as const) {
      for (let k = 0; k < n; k++) {
        const withImage = variant === 1 && k === 0;
        const r = await queryOne<{ id: string }>(
          `INSERT INTO test_questions (subject_id, variant, question_text, image_asset_id, options, answer, explanation, legacy_ref)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8) RETURNING id::text AS id`,
          [
            sid,
            variant,
            withImage ? null : `${s.name} v${variant} savol ${k}`,
            withImage ? asset : null,
            withImage ? null : JSON.stringify(["birinchi", "ikkinchi", "uchinchi", "to'rtinchi"]),
            (k + variant) % 4,
            k % 2 === 0 ? `IZOH-${s.code}-${variant}-${k}` : null,
            `test:${s.code}:${variant}:${k}`,
          ],
        );
        if (withImage) imageQuestion[s.code] = Number(r!.id);
      }
    }
  }
  const keyOf = async (qid: number) => (await queryOne<{ answer: number }>("SELECT answer FROM test_questions WHERE id = $1", [qid]))!.answer;

  const login = async (opts: { points?: number; balance?: number } = { points: 20_000 }) => {
    const uid = await mkUser(query, opts);
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };
  async function call(
    handler: (r: Request, ctx: never) => Promise<Response>,
    url: string,
    method: string,
    cookie: string | null,
    body?: unknown,
    id?: string,
    extra: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = { "content-type": "application/json", ...extra };
    if (cookie) headers.cookie = cookie;
    const req = new Request(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const ctx = id === undefined ? undefined : { params: Promise.resolve({ id }) };
    const res = await inRequest(req, () => (handler as (r: Request, c?: unknown) => Promise<Response>)(req, ctx));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  const enable = () => setSetting(query, "tests.enabled", true);
  const ledger = (uid: string) => query<{ reference: string; points_delta: string; balance_delta: string }>("SELECT reference, points_delta::text AS points_delta, balance_delta::text AS balance_delta FROM transactions WHERE user_id = $1 AND kind = 'charge' AND reference LIKE 'test:%'", [uid]);
  const attempts = (uid: string) => query<{ id: string; status: string; total: number; charged_points: string }>("SELECT id, status, total, charged_points::text AS charged_points FROM test_attempts WHERE user_id = $1 ORDER BY started_at", [uid]);
  const seeded = (seed: number) => ({ rng: rules.seededRng(seed) });
  const T0 = new Date("2026-10-24T10:00:00.000Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);
  const MIN = 60_000;
  /** Reads the active attempt the way the API shows it. */
  const active = async (uid: string, id: string, now?: Date) => (await svc.getAttemptView(uid, id, now)) as import("../lib/server/paid-tests.ts").ActiveView;

  /** Every property name and string value of a JSON tree. */
  function walk(v: unknown, keys: string[] = [], strings: string[] = []): { keys: string[]; strings: string[] } {
    if (Array.isArray(v)) for (const x of v) walk(x, keys, strings);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      keys.push(k);
      walk(x, keys, strings);
    }
    else if (typeof v === "string") strings.push(v);
    return { keys, strings };
  }
  const FORBIDDEN_KEYS = ["answer", "correct", "correctLetter", "isCorrect", "explanation", "score", "key"];
  function assertNoKey(label: string, body: unknown) {
    const { keys, strings } = walk(body);
    for (const k of keys) assert.ok(!FORBIDDEN_KEYS.includes(k), `${label}: leaks the property «${k}»`);
    assert.ok(!strings.some((s) => s.includes("IZOH-")), `${label}: leaks an explanation`);
  }

  await t.test("kill switch: ships dark -- nothing starts, nothing is charged", async () => {
    const u = await login();
    await assert.rejects(svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }), (e: { status?: number; extra?: { code?: string } }) => e.status === 503 && e.extra?.code === "disabled");
    assert.deepEqual(await attempts(u.uid), []);
    assert.equal((await wallet(query, u.uid)).total, 20_000);
    const r = await call(startRoute.POST, "/api/tests/start", "POST", u.cookie, { mode: "subject", subject: "math" });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "disabled");
    const o = await call(overviewRoute.GET, "/api/tests", "GET", u.cookie);
    assert.equal(o.status, 200);
    assert.equal(o.body.enabled, false);
  });

  await enable();

  await t.test("start charges once: price from settings, one ledger row, repeats and races change nothing", async () => {
    const u = await login();
    const first = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(1), now: T0 });
    assert.equal(first.alreadyOpen, false);
    assert.equal(first.price, 1500, "one subject = tests.price_subject");
    assert.equal((await wallet(query, u.uid)).total, 18_500);
    const rows = await ledger(u.uid);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.reference, `test:${first.attemptId}`);
    assert.equal(Number(rows[0]!.points_delta), -1500, "bonus so'm is spent first");

    const again = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(2), now: at(MIN) });
    assert.equal(again.attemptId, first.attemptId);
    assert.equal(again.alreadyOpen, true);
    assert.equal((await wallet(query, u.uid)).total, 18_500, "no second charge");
    assert.equal((await ledger(u.uid)).length, 1);

    // A different subject while one is open: refused, nothing charged.
    await assert.rejects(svc.startAttempt(u.uid, { mode: "subject", subjectCode: "tarix" }, { now: at(2 * MIN) }), (e: { status?: number; extra?: { code?: string; attemptId?: string } }) => e.status === 409 && e.extra?.code === "open_attempt" && e.extra?.attemptId === first.attemptId);
    await assert.rejects(svc.startAttempt(u.uid, { mode: "all" }, { now: at(2 * MIN) }), (e: { status?: number }) => e.status === 409);

    // Five parallel taps (two tabs, a double click): one attempt, one charge.
    const race = await login();
    const results = await Promise.all(Array.from({ length: 5 }, () => svc.startAttempt(race.uid, { mode: "subject", subjectCode: "tarix" })));
    assert.equal(new Set(results.map((r) => r.attemptId)).size, 1);
    assert.equal(results.filter((r) => !r.alreadyOpen).length, 1);
    assert.equal((await attempts(race.uid)).length, 1);
    assert.equal((await ledger(race.uid)).length, 1);
    assert.equal((await wallet(query, race.uid)).total, 18_500);
  });

  await t.test("start is idempotent by key, even after the attempt ended", async () => {
    const u = await login();
    const key = "k-1234567890";
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math", key });
    assert.ok(await svc.finishAttempt(u.uid, a.attemptId));
    const b = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math", key });
    assert.equal(b.attemptId, a.attemptId);
    assert.equal(b.alreadyOpen, true);
    assert.equal((await ledger(u.uid)).length, 1);
    const c = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math", key: "k-other-key-99" });
    assert.notEqual(c.attemptId, a.attemptId);
    assert.equal((await ledger(u.uid)).length, 2);
    await assert.rejects(svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math", key: "bad key!" }), (e: { status?: number }) => e.status === 400);
  });

  await t.test("insufficient balance: 402, no attempt, wallet untouched", async () => {
    const poor = await login({ points: 1000, balance: 499 });
    await assert.rejects(svc.startAttempt(poor.uid, { mode: "subject", subjectCode: "math" }), (e: { status?: number; extra?: { code?: string; required?: number; available?: number } }) => e.status === 402 && e.extra?.code === "insufficient" && e.extra.required === 1500 && e.extra.available === 1499);
    assert.deepEqual(await attempts(poor.uid), []);
    assert.deepEqual(await ledger(poor.uid), []);
    assert.deepEqual(await wallet(query, poor.uid), { points: 1000, balance: 499, total: 1499 });
    const r = await call(startRoute.POST, "/api/tests/start", "POST", poor.cookie, { mode: "subject", subject: "math" });
    assert.equal(r.status, 402);
    // Bonus so'm and money together pay: 1000 + 500 exactly covers the price.
    const mixed = await login({ points: 1000, balance: 500 });
    await svc.startAttempt(mixed.uid, { mode: "subject", subjectCode: "math" });
    assert.deepEqual(await wallet(query, mixed.uid), { points: 0, balance: 0, total: 0 });
    const row = (await ledger(mixed.uid))[0]!;
    assert.deepEqual([Number(row.points_delta), Number(row.balance_delta)], [-1000, -500]);
  });

  await t.test("first attempt free is a setting; the price is the server's (body price ignored)", async () => {
    await setSetting(query, "tests.first_attempt_free", true);
    const u = await login({ points: 3000 });
    const ov = await svc.overview(u.uid);
    assert.equal(ov.firstFree, true);
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" });
    assert.equal(a.price, 0);
    assert.deepEqual(await ledger(u.uid), [], "a free attempt writes no charge");
    assert.equal((await wallet(query, u.uid)).total, 3000);
    assert.equal((await svc.overview(u.uid)).firstFree, false);
    await svc.finishAttempt(u.uid, a.attemptId);
    const b = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" });
    assert.equal(b.price, 1500);
    assert.equal((await wallet(query, u.uid)).total, 1500);
    await clearSetting(query, "tests.first_attempt_free");

    await setSetting(query, "tests.price_subject", 500);
    const v = await login({ points: 5000 });
    const r = await call(startRoute.POST, "/api/tests/start", "POST", v.cookie, { mode: "subject", subject: "math", price: 1, amount: 1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.price, 500, "the client's price field is ignored");
    assert.equal((await wallet(query, v.uid)).total, 4500);
    await setSetting(query, "tests.price_subject", 0);
    const w = await login({ points: 0 });
    assert.equal((await svc.startAttempt(w.uid, { mode: "subject", subjectCode: "math" })).price, 0);
    await clearSetting(query, "tests.price_subject");
  });

  await t.test("price by mode: one subject 1 500, «hammasi» 4 000; each from its own setting; first-free covers both modes", async () => {
    const u = await login({ points: 10_000 });
    const all = await svc.startAttempt(u.uid, { mode: "all" }, seeded(5));
    assert.equal(all.price, 4000, "«hammasi» = tests.price_all");
    assert.equal((await wallet(query, u.uid)).total, 6000);
    assert.deepEqual((await ledger(u.uid)).map((r) => [r.reference, Number(r.points_delta)]), [[`test:${all.attemptId}`, -4000]]);
    assert.equal((await attempts(u.uid))[0]!.charged_points, "4000");
    // The same «hammasi» start again (open attempt) and a retried key change nothing.
    assert.equal((await svc.startAttempt(u.uid, { mode: "all" })).alreadyOpen, true);
    assert.equal((await wallet(query, u.uid)).total, 6000);
    await svc.finishAttempt(u.uid, all.attemptId);
    const one = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "tarix" });
    assert.equal(one.price, 1500);
    assert.equal((await wallet(query, u.uid)).total, 4500);
    await svc.finishAttempt(u.uid, one.attemptId);

    // Each mode reads ITS key: changing one leaves the other alone.
    await setSetting(query, "tests.price_all", 3000);
    await setSetting(query, "tests.price_subject", 700);
    assert.deepEqual((await svc.overview(u.uid)).prices, { subject: 700, all: 3000 });
    const r = await call(startRoute.POST, "/api/tests/start", "POST", u.cookie, { mode: "all", price: 1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.price, 3000, "the client's price is ignored for «hammasi» too");
    assert.equal((await wallet(query, u.uid)).total, 1500);
    await svc.finishAttempt(u.uid, String(r.body.attemptId));
    const o = await call(overviewRoute.GET, "/api/tests", "GET", u.cookie);
    assert.deepEqual(o.body.prices, { subject: 700, all: 3000 });
    assert.equal("price" in o.body, false, "the single price is gone");
    await clearSetting(query, "tests.price_all");
    await clearSetting(query, "tests.price_subject");

    // Not enough for «hammasi» but enough for one subject.
    const p = await login({ points: 3999 });
    await assert.rejects(svc.startAttempt(p.uid, { mode: "all" }), (e: { status?: number; extra?: { required?: number } }) => e.status === 402 && e.extra?.required === 4000);
    assert.equal((await svc.startAttempt(p.uid, { mode: "subject", subjectCode: "math" })).price, 1500);

    // First attempt free also covers a «hammasi» first attempt.
    await setSetting(query, "tests.first_attempt_free", true);
    const f = await login({ points: 5000 });
    assert.equal((await svc.startAttempt(f.uid, { mode: "all" })).price, 0);
    assert.deepEqual(await ledger(f.uid), []);
    await clearSetting(query, "tests.first_attempt_free");
  });

  await t.test("selection in the service: seeded, one variant per subject, fixed option order, «hammasi» = 3 x 10", async () => {
    const u = await login({ points: 50_000 });
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "ona_tili" }, { ...seeded(11), now: T0 });
    const view = await active(u.uid, a.attemptId, T0);
    assert.equal(view.total, 10);
    assert.equal(view.questions.length, 10);
    assert.equal(new Set(view.questions.map((q) => q.id)).size, 10);
    assert.deepEqual(view.questions.map((q) => q.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.ok(view.questions.every((q) => q.subject === "Ona tili"));
    const variants = await query<{ variant: number }>("SELECT DISTINCT variant FROM test_questions WHERE id = ANY($1::bigint[])", [view.questions.map((q) => q.id)]);
    assert.equal(variants.length, 1);
    assert.notEqual(variants[0]!.variant, 3);
    for (const q of view.questions) {
      if (q.options) assert.deepEqual(q.options, ["birinchi", "ikkinchi", "uchinchi", "to'rtinchi"], "option order is fixed");
    }
    // Same seed, same attempt (a fresh user, a fresh attempt).
    await svc.finishAttempt(u.uid, a.attemptId);
    const b = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "ona_tili" }, { ...seeded(11), now: T0 });
    assert.deepEqual((await active(u.uid, b.attemptId, T0)).questions.map((q) => q.id), view.questions.map((q) => q.id));
    await svc.finishAttempt(u.uid, b.attemptId);
    const c = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "ona_tili" }, { ...seeded(12), now: T0 });
    assert.notDeepEqual((await active(u.uid, c.attemptId, T0)).questions.map((q) => q.id), view.questions.map((q) => q.id));
    await svc.finishAttempt(u.uid, c.attemptId);

    // «Hammasi»: 10 per subject in subject order, 60 minutes.
    const all = await svc.startAttempt(u.uid, { mode: "all" }, { ...seeded(5), now: T0 });
    assert.equal(all.deadlineAt, at(60 * MIN).toISOString());
    const av = await active(u.uid, all.attemptId, T0);
    assert.equal(av.total, 30);
    assert.deepEqual([...new Set(av.questions.map((q) => q.subject))], ["Matematika", "Ona tili", "Tarix"]);
    for (let s = 0; s < 3; s++) assert.equal(new Set(av.questions.slice(s * 10, s * 10 + 10).map((q) => q.subject)).size, 1);
    // A subject attempt gets 20 minutes.
    await svc.finishAttempt(u.uid, all.attemptId);
    const one = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { now: T0 });
    assert.equal(one.deadlineAt, at(20 * MIN).toISOString());
    await svc.finishAttempt(u.uid, one.attemptId);

    await assert.rejects(svc.startAttempt(u.uid, { mode: "subject", subjectCode: "nope" }), (e: { status?: number }) => e.status === 404);
  });

  await t.test("settings drive the attempt: questions per subject and minutes", async () => {
    await setSetting(query, "tests.questions_per_subject", 5);
    await setSetting(query, "tests.minutes_per_subject", 7);
    await setSetting(query, "tests.minutes_all", 33);
    const u = await login({ points: 50_000 });
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { now: T0 });
    assert.equal((await active(u.uid, a.attemptId, T0)).total, 5);
    assert.equal(a.deadlineAt, at(7 * MIN).toISOString());
    await svc.finishAttempt(u.uid, a.attemptId);
    const b = await svc.startAttempt(u.uid, { mode: "all" }, { now: T0 });
    assert.equal((await active(u.uid, b.attemptId, T0)).total, 15);
    assert.equal(b.deadlineAt, at(33 * MIN).toISOString());
    const ov = await svc.overview(u.uid);
    assert.deepEqual(ov.all, { questions: 15, minutes: 33, available: true });
    await svc.finishAttempt(u.uid, b.attemptId);
    for (const k of ["tests.questions_per_subject", "tests.minutes_per_subject", "tests.minutes_all"]) await clearSetting(query, k);
  });

  await t.test("the answer key is never in a pre-finish response", async () => {
    const u = await login({ points: 50_000 });
    const start = await call(startRoute.POST, "/api/tests/start", "POST", u.cookie, { mode: "subject", subject: "math" });
    assert.equal(start.status, 200);
    assertNoKey("start", start.body);
    const id = start.body.attemptId as string;
    const view = await call(attemptRoute.GET, `/api/tests/attempts/${id}`, "GET", u.cookie, undefined, id);
    assert.equal(view.status, 200);
    assert.equal(view.body.state, "active");
    assertNoKey("attempt (running)", view.body);
    const qs = view.body.questions as { id: number }[];
    assert.equal(qs.length, 10);

    // After answering (right and wrong) nothing about correctness comes back either.
    const a1 = await call(answerRoute.POST, `/api/tests/attempts/${id}/answer`, "POST", u.cookie, { questionId: qs[0]!.id, choice: await keyOf(qs[0]!.id) }, id);
    const a2 = await call(answerRoute.POST, `/api/tests/attempts/${id}/answer`, "POST", u.cookie, { questionId: qs[1]!.id, choice: (await keyOf(qs[1]!.id) + 1) % 4 }, id);
    assert.deepEqual(a1.body, { ok: true, answered: 1 });
    assert.deepEqual(a2.body, { ok: true, answered: 2 });
    const mid = await call(attemptRoute.GET, `/api/tests/attempts/${id}`, "GET", u.cookie, undefined, id);
    assertNoKey("attempt (after answers)", mid.body);
    assert.equal(Object.keys(mid.body.answers as object).length, 2);
    const ov = await call(overviewRoute.GET, "/api/tests", "GET", u.cookie);
    assertNoKey("overview", ov.body);

    // The raw view from the service has no key either, and the first image question is reachable without one.
    const raw = await svc.getAttemptView(u.uid, id);
    assertNoKey("service view", raw);
    assert.ok(!JSON.stringify(raw).includes("IZOH"));

    // Finished: the key appears (and only then).
    const fin = await call(finishRoute.POST, `/api/tests/attempts/${id}/finish`, "POST", u.cookie, undefined, id);
    assert.equal(fin.body.state, "finished");
    assert.ok(walk(fin.body).keys.includes("correctLetter"));
  });

  await t.test("images: owner only, only questions of the attempt, cached by hash", async () => {
    const u = await login({ points: 50_000 });
    const o = await login({ points: 50_000 });
    const a = await svc.startAttempt(u.uid, { mode: "all" }, { ...seeded(21) });
    const view = await active(u.uid, a.attemptId);
    const imgQ = view.questions.find((q) => q.imageUrl);
    assert.ok(imgQ, "seed 21 includes an image question");
    const get = async (cookie: string | null, url: string, headers: Record<string, string> = {}) => {
      const req = new Request(`http://localhost${url}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
      const m = /attempts\/([^/]+)\/image\/(\d+)/.exec(url)!;
      return inRequest(req, () => imageRoute.GET(req, { params: Promise.resolve({ id: m[1]!, qid: m[2]! }) }));
    };
    const ok = await get(u.cookie, imgQ!.imageUrl!);
    assert.equal(ok.status, 200);
    assert.match(imgQ!.imageUrl!, /\?v=abababab$/, "the URL carries the first 8 hex of the image hash");
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal(ok.headers.get("cache-control"), "private, max-age=86400");
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG);
    const etag = ok.headers.get("etag")!;
    assert.equal(etag, `"${"ab".repeat(32)}"`);
    assert.equal((await get(u.cookie, imgQ!.imageUrl!, { "if-none-match": etag })).status, 304);
    assert.equal((await get(o.cookie, imgQ!.imageUrl!)).status, 404, "another user's attempt");
    assert.equal((await get(null, imgQ!.imageUrl!)).status, 401);
    const notMine = Object.values(imageQuestion).find((q) => !view.questions.some((x) => x.id === q));
    if (notMine) assert.equal((await get(u.cookie, `/api/tests/attempts/${a.attemptId}/image/${notMine}`)).status, 404, "a question outside the attempt");
    assert.equal((await get(u.cookie, `/api/tests/attempts/${a.attemptId}/image/999999`)).status, 404);
    const err = await get(o.cookie, imgQ!.imageUrl!);
    assert.equal(err.headers.get("cache-control"), "private, no-store", "an error is never cached");
  });

  await t.test("views: every question says hasFigure; a text question's image stays reachable (migration 064)", async () => {
    const u = await login({ points: 50_000 });
    const a = await svc.startAttempt(u.uid, { mode: "all" }, { ...seeded(21) });
    const first = await active(u.uid, a.attemptId);
    const textQs = first.questions.filter((q) => q.text);
    assert.ok(textQs.length >= 3);
    const [fig, plain, other] = textQs as [(typeof textQs)[number], (typeof textQs)[number], (typeof textQs)[number]];
    try {
      // `fig`: text + an image that holds a drawing; `plain`: text + the original screenshot; `other`: text only.
      await query("UPDATE test_questions SET image_asset_id = $2, has_figure = TRUE WHERE id = $1", [fig.id, asset]);
      await query("UPDATE test_questions SET image_asset_id = $2 WHERE id = $1", [plain.id, asset]);
      const view = await active(u.uid, a.attemptId);
      const by = (id: number) => view.questions.find((q) => q.id === id)!;
      assert.deepEqual([by(fig.id).hasFigure, Boolean(by(fig.id).imageUrl), Boolean(by(fig.id).text), by(fig.id).options?.length], [true, true, true, 4]);
      assert.deepEqual([by(plain.id).hasFigure, Boolean(by(plain.id).imageUrl), Boolean(by(plain.id).text)], [false, true, true], "text + screenshot: the page shows text, «Asl rasm» opens the image");
      assert.deepEqual([by(other.id).hasFigure, by(other.id).imageUrl], [false, null]);
      const imageOnly = view.questions.find((q) => !q.text)!;
      assert.deepEqual([imageOnly.hasFigure, Boolean(imageOnly.imageUrl), imageOnly.options], [false, true, null], "an image-only question is unchanged");
      // The image of a text question is served like any other.
      const req = new Request(`http://localhost${by(plain.id).imageUrl}`, { headers: { cookie: u.cookie } });
      const res = await inRequest(req, () => imageRoute.GET(req, { params: Promise.resolve({ id: a.attemptId, qid: String(plain.id) }) }));
      assert.equal(res.status, 200);
      // The review carries the same flag.
      assert.ok(await svc.finishAttempt(u.uid, a.attemptId));
      const fin = (await svc.getAttemptView(u.uid, a.attemptId)) as import("../lib/server/paid-tests.ts").FinishedView;
      const rv = (id: number) => fin.review.find((r) => r.id === id)!;
      assert.deepEqual([rv(fig.id).hasFigure, rv(plain.id).hasFigure, rv(other.id).hasFigure], [true, false, false]);
      assert.ok(rv(fig.id).imageUrl && rv(plain.id).imageUrl && rv(plain.id).text);
    } finally {
      await query("UPDATE test_questions SET image_asset_id = NULL, has_figure = FALSE WHERE id = ANY($1::bigint[])", [[fig.id, plain.id]]);
    }
  });

  await t.test("server-side deadline: late answers are not stored or counted, the attempt finishes itself", async () => {
    const u = await login({ points: 50_000 });
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(3), now: T0 });
    const view = await active(u.uid, a.attemptId, at(MIN));
    const [q1, q2, q3] = view.questions;
    assert.equal(a.deadlineAt, at(20 * MIN).toISOString());
    assert.deepEqual(await svc.answerQuestion(u.uid, a.attemptId, q1!.id, await keyOf(q1!.id), at(5 * MIN)), { ok: true, answered: 1 });
    // Exactly at the deadline instant is still in time.
    assert.deepEqual(await svc.answerQuestion(u.uid, a.attemptId, q2!.id, await keyOf(q2!.id), at(20 * MIN)), { ok: true, answered: 2 });
    // One millisecond later: refused, not stored, attempt finished as a timeout.
    assert.deepEqual(await svc.answerQuestion(u.uid, a.attemptId, q3!.id, await keyOf(q3!.id), at(20 * MIN + 1)), { ok: false, reason: "expired" });
    const stored = await query("SELECT question_id FROM test_attempt_answers WHERE attempt_id = $1", [a.attemptId]);
    assert.equal(stored.length, 2, "the late answer was not stored");
    const row = await queryOne<{ status: string; finish_reason: string; correct: number; score: string; finished_at: Date }>("SELECT status, finish_reason, correct, score::text AS score, finished_at FROM test_attempts WHERE id = $1", [a.attemptId]);
    assert.equal(row!.status, "finished");
    assert.equal(row!.finish_reason, "timeout");
    assert.equal(row!.correct, 2);
    assert.equal(row!.score, "2.20");
    assert.equal(row!.finished_at.toISOString(), at(20 * MIN).toISOString(), "a timeout is dated at the deadline");
    assert.deepEqual(await svc.answerQuestion(u.uid, a.attemptId, q3!.id, 0, at(21 * MIN)), { ok: false, reason: "finished" });

    // An abandoned attempt is finished by a read after the deadline...
    const b = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "tarix" }, { ...seeded(4), now: T0 });
    const bView = await active(u.uid, b.attemptId, at(MIN));
    await svc.answerQuestion(u.uid, b.attemptId, bView.questions[0]!.id, await keyOf(bView.questions[0]!.id), at(2 * MIN));
    assert.equal((await svc.getAttemptView(u.uid, b.attemptId, at(19 * MIN)))!.state, "active");
    const done = await svc.getAttemptView(u.uid, b.attemptId, at(25 * MIN));
    assert.equal(done!.state, "finished");
    assert.equal((done as import("../lib/server/paid-tests.ts").FinishedView).reason, "timeout");
    assert.equal((done as import("../lib/server/paid-tests.ts").FinishedView).correct, 1);

    // ...by the worker sweep...
    const c = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(5), now: T0 });
    assert.equal(await svc.sweepExpiredAttempts(at(19 * MIN)), 0, "not due yet");
    assert.ok((await svc.sweepExpiredAttempts(at(21 * MIN))) >= 1);
    assert.equal((await queryOne<{ status: string }>("SELECT status FROM test_attempts WHERE id = $1", [c.attemptId]))!.status, "finished");

    // ...and by a new start (the old open attempt must not block it).
    const d = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(6), now: T0 });
    const e = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "tarix" }, { ...seeded(7), now: at(30 * MIN) });
    assert.notEqual(e.attemptId, d.attemptId);
    assert.equal((await queryOne<{ finish_reason: string }>("SELECT finish_reason FROM test_attempts WHERE id = $1", [d.attemptId]))!.finish_reason, "timeout");
  });

  await t.test("scoring: +1.1 per correct, no negative marking, unanswered score nothing", async () => {
    const u = await login({ points: 80_000 });
    const play = async (mode: "subject" | "all", right: number, wrong: number, seed: number) => {
      const a = await svc.startAttempt(u.uid, mode === "all" ? { mode } : { mode, subjectCode: "math" }, { ...seeded(seed), now: T0 });
      const v = await active(u.uid, a.attemptId, T0);
      let r = 0;
      let w = 0;
      for (const q of v.questions) {
        const key = await keyOf(q.id);
        if (r < right) {
          await svc.answerQuestion(u.uid, a.attemptId, q.id, key, at(MIN));
          r++;
        } else if (w < wrong) {
          await svc.answerQuestion(u.uid, a.attemptId, q.id, (key + 2) % 4, at(MIN));
          w++;
        }
      }
      await svc.finishAttempt(u.uid, a.attemptId, at(2 * MIN));
      return (await svc.getAttemptView(u.uid, a.attemptId, at(3 * MIN))) as import("../lib/server/paid-tests.ts").FinishedView;
    };
    const r7 = await play("subject", 7, 3, 31);
    assert.deepEqual([r7.correct, r7.total, r7.score, r7.pointsPerCorrect, r7.reason], [7, 10, 7.7, 1.1, "manual"]);
    const r10 = await play("subject", 10, 0, 32);
    assert.equal(r10.score, 11);
    const r0 = await play("subject", 0, 10, 33);
    assert.deepEqual([r0.correct, r0.score], [0, 0], "wrong answers cost nothing");
    const rNone = await play("subject", 0, 0, 34);
    assert.deepEqual([rNone.correct, rNone.score], [0, 0]);
    const rAll = await play("all", 30, 0, 35);
    assert.deepEqual([rAll.correct, rAll.total, rAll.score], [30, 30, 33]);
    const stored = await queryOne<{ score: string }>("SELECT score::text AS score FROM test_attempts WHERE id = $1", [r7.id]);
    assert.equal(stored!.score, "7.70");

    // The points of an attempt are fixed at its start.
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(36), now: T0 });
    await setSetting(query, "tests.points_per_correct", 2);
    const v = await active(u.uid, a.attemptId, T0);
    await svc.answerQuestion(u.uid, a.attemptId, v.questions[0]!.id, await keyOf(v.questions[0]!.id), at(MIN));
    await svc.finishAttempt(u.uid, a.attemptId, at(2 * MIN));
    assert.equal(((await svc.getAttemptView(u.uid, a.attemptId, at(3 * MIN))) as import("../lib/server/paid-tests.ts").FinishedView).score, 1.1, "start-time snapshot");
    const b = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(37), now: T0 });
    const bv = await active(u.uid, b.attemptId, T0);
    await svc.answerQuestion(u.uid, b.attemptId, bv.questions[0]!.id, await keyOf(bv.questions[0]!.id), at(MIN));
    await svc.finishAttempt(u.uid, b.attemptId, at(2 * MIN));
    assert.equal(((await svc.getAttemptView(u.uid, b.attemptId, at(3 * MIN))) as import("../lib/server/paid-tests.ts").FinishedView).score, 2, "the new setting applies to new attempts");
    await clearSetting(query, "tests.points_per_correct");
  });

  await t.test("result: the answers are revealed only after finish, with letters, correctness and explanations", async () => {
    const u = await login({ points: 50_000 });
    const a = await svc.startAttempt(u.uid, { mode: "all" }, { ...seeded(41), now: T0 });
    const v = await active(u.uid, a.attemptId, T0);
    assert.equal((v as unknown as { review?: unknown }).review, undefined);
    // Answer the first 12 questions: 5 right, rest wrong; the last choice for question 1 overrides the first.
    const keys: number[] = [];
    for (const q of v.questions) keys.push(await keyOf(q.id));
    await svc.answerQuestion(u.uid, a.attemptId, v.questions[0]!.id, (keys[0]! + 1) % 4, at(MIN));
    for (let i = 0; i < 12; i++) await svc.answerQuestion(u.uid, a.attemptId, v.questions[i]!.id, i < 5 ? keys[i]! : (keys[i]! + 3) % 4, at(2 * MIN));
    await svc.finishAttempt(u.uid, a.attemptId, at(3 * MIN));
    const fin = (await svc.getAttemptView(u.uid, a.attemptId, at(4 * MIN))) as import("../lib/server/paid-tests.ts").FinishedView;
    assert.equal(fin.state, "finished");
    assert.equal(fin.correct, 5);
    assert.equal(fin.score, 5.5);
    assert.equal(fin.review.length, 30);
    fin.review.forEach((r, i) => {
      assert.equal(r.id, v.questions[i]!.id, "same order as the attempt");
      assert.equal(r.correct, keys[i]);
      assert.equal(r.correctLetter, "ABCD"[keys[i]!]);
      if (i < 12) {
        assert.equal(r.isCorrect, i < 5);
        assert.equal(r.chosenLetter, "ABCD"[i < 5 ? keys[i]! : (keys[i]! + 3) % 4]);
      } else {
        assert.equal(r.chosen, null);
        assert.equal(r.isCorrect, false);
      }
    });
    const withExplanation = fin.review.filter((r) => r.explanation);
    assert.ok(withExplanation.length > 5 && withExplanation.every((r) => /^IZOH-/.test(r.explanation!)));
    assert.ok(fin.review.some((r) => r.explanation === null), "an explanation is optional");
    assert.ok(fin.review.some((r) => r.imageUrl) && fin.review.some((r) => r.options === null), "image questions keep letters only");
    assert.deepEqual(fin.bySubject.map((s) => [s.subject, s.total]), [["Matematika", 10], ["Ona tili", 10], ["Tarix", 10]]);
    assert.equal(fin.bySubject.reduce((n, s) => n + s.correct, 0), 5);

    // Finishing again changes nothing; the result is stable.
    assert.ok(await svc.finishAttempt(u.uid, a.attemptId, at(30 * MIN)));
    assert.deepEqual(await svc.getAttemptView(u.uid, a.attemptId, at(31 * MIN)), fin);
    // The history lists it.
    const hist = (await svc.overview(u.uid, at(40 * MIN))).history;
    assert.equal(hist[0]!.id, a.attemptId);
    assert.deepEqual([hist[0]!.status, hist[0]!.correct, hist[0]!.score, hist[0]!.total], ["finished", 5, 5.5, 30]);
  });

  await t.test("key snapshot: a finished result never follows a corrected key; a running attempt is scored with the key at finish time", async () => {
    const u = await login({ points: 50_000 });
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(71), now: T0 });
    const v = await active(u.uid, a.attemptId, T0);
    const ids = v.questions.map((q) => q.id);
    const keys = await Promise.all(ids.map(keyOf));
    for (let i = 0; i < 6; i++) await svc.answerQuestion(u.uid, a.attemptId, ids[i]!, keys[i]!, at(MIN));
    // The owner corrects the key of question 1 WHILE the attempt runs: the finish uses the key as it is then.
    await query("UPDATE test_questions SET answer = (answer + 1) % 4 WHERE id = $1", [ids[0]]);
    await svc.finishAttempt(u.uid, a.attemptId, at(2 * MIN));
    const fin = (await svc.getAttemptView(u.uid, a.attemptId, at(3 * MIN))) as import("../lib/server/paid-tests.ts").FinishedView;
    assert.equal(fin.correct, 5, "the answer to the corrected question no longer counts");
    assert.equal(fin.score, 5.5);
    assert.equal(fin.review[0]!.isCorrect, false);
    assert.equal(fin.review[0]!.correct, (keys[0]! + 1) % 4);
    const snap = (await queryOne<{ key_snapshot: number[] }>("SELECT key_snapshot FROM test_attempts WHERE id = $1", [a.attemptId]))!.key_snapshot;
    assert.equal(snap.length, 10, "every question is in the snapshot, unanswered ones too");
    assert.deepEqual(snap, [(keys[0]! + 1) % 4, ...keys.slice(1)]);

    // Corrections AFTER the finish change nothing: the review, the counts and the stored score stay as they were.
    for (const i of [1, 2, 8]) await query("UPDATE test_questions SET answer = (answer + 2) % 4 WHERE id = $1", [ids[i]]);
    const later = (await svc.getAttemptView(u.uid, a.attemptId, at(60 * MIN))) as import("../lib/server/paid-tests.ts").FinishedView;
    assert.deepEqual(later, fin, "the old review is unchanged");
    assert.equal(later.review.filter((r) => r.isCorrect).length, later.correct, "the review matches the score");
    assert.equal(later.bySubject.reduce((n, s) => n + s.correct, 0), later.correct);
    assert.equal((await queryOne<{ score: string }>("SELECT score::text AS score FROM test_attempts WHERE id = $1", [a.attemptId]))!.score, "5.50");
    await svc.finishAttempt(u.uid, a.attemptId, at(61 * MIN));
    assert.deepEqual(await svc.getAttemptView(u.uid, a.attemptId, at(62 * MIN)), fin, "finishing again does not re-snapshot");

    // A timeout finish snapshots too, and a NEW attempt sees the corrected key.
    const b = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(71), now: T0 });
    const bv = await active(u.uid, b.attemptId, T0);
    const q1 = bv.questions.find((q) => q.id === ids[1])!;
    await svc.answerQuestion(u.uid, b.attemptId, q1.id, (keys[1]! + 2) % 4, at(MIN));
    const bFin = (await svc.getAttemptView(u.uid, b.attemptId, at(30 * MIN))) as import("../lib/server/paid-tests.ts").FinishedView;
    assert.equal(bFin.reason, "timeout");
    assert.equal(bFin.review.find((r) => r.id === q1.id)!.isCorrect, true, "the new attempt uses the corrected key");
    assert.equal(bFin.correct, 1);
    for (const i of [0, 1, 2, 8]) await query("UPDATE test_questions SET answer = $2 WHERE id = $1", [ids[i], keys[i]]);
  });

  await t.test("clock: without an injected time the database clock sets the deadline and the answer time", async () => {
    const u = await login({ points: 50_000 });
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, seeded(81));
    const row = await queryOne<{ span: boolean; near: boolean }>(
      "SELECT deadline_at - started_at = interval '20 minutes' AS span, abs(extract(epoch FROM started_at - clock_timestamp())) < 5 AS near FROM test_attempts WHERE id = $1",
      [a.attemptId],
    );
    assert.deepEqual(row, { span: true, near: true });
    const v = await svc.getAttemptView(u.uid, a.attemptId);
    assert.ok(v && v.state === "active" && Math.abs(Date.parse(v.serverNow) - Date.now()) < 5000, "serverNow comes from the database clock");
    assert.deepEqual(await svc.answerQuestion(u.uid, a.attemptId, (v as import("../lib/server/paid-tests.ts").ActiveView).questions[0]!.id, 1), { ok: true, answered: 1 });
    const ans = await queryOne<{ near: boolean }>("SELECT abs(extract(epoch FROM answered_at - clock_timestamp())) < 5 AS near FROM test_attempt_answers WHERE attempt_id = $1", [a.attemptId]);
    assert.equal(ans!.near, true);
    await svc.sweepExpiredAttempts();
    assert.equal((await queryOne<{ status: string }>("SELECT status FROM test_attempts WHERE id = $1", [a.attemptId]))!.status, "active", "a fresh attempt is not swept");
  });

  await t.test("a foreign attempt is rejected everywhere (looks like a missing one)", async () => {
    const owner = await login({ points: 50_000 });
    const thief = await login({ points: 50_000 });
    const a = await svc.startAttempt(owner.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(51) });
    const v = await active(owner.uid, a.attemptId);
    const q = v.questions[0]!.id;
    assert.equal(await svc.getAttemptView(thief.uid, a.attemptId), null);
    assert.deepEqual(await svc.answerQuestion(thief.uid, a.attemptId, q, 0), { ok: false, reason: "not_found" });
    assert.equal(await svc.finishAttempt(thief.uid, a.attemptId), false);
    assert.equal(await svc.attemptImage(thief.uid, a.attemptId, imageQuestion.math!), null);
    assert.equal((await call(attemptRoute.GET, `/api/tests/attempts/${a.attemptId}`, "GET", thief.cookie, undefined, a.attemptId)).status, 404);
    assert.equal((await call(answerRoute.POST, `/api/tests/attempts/${a.attemptId}/answer`, "POST", thief.cookie, { questionId: q, choice: 0 }, a.attemptId)).status, 404);
    assert.equal((await call(finishRoute.POST, `/api/tests/attempts/${a.attemptId}/finish`, "POST", thief.cookie, undefined, a.attemptId)).status, 404);
    // Nothing happened to the owner's attempt.
    const row = await queryOne<{ status: string }>("SELECT status FROM test_attempts WHERE id = $1", [a.attemptId]);
    assert.equal(row!.status, "active");
    assert.equal((await query("SELECT 1 FROM test_attempt_answers WHERE attempt_id = $1", [a.attemptId])).length, 0);
    // Unknown and malformed ids.
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid", "1"]) {
      assert.equal((await call(attemptRoute.GET, `/api/tests/attempts/${id}`, "GET", owner.cookie, undefined, id)).status, 404, id);
    }
  });

  await t.test("answer validation: choice range, question must belong to the attempt, last choice wins", async () => {
    const u = await login({ points: 50_000 });
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "math" }, { ...seeded(61) });
    const v = await active(u.uid, a.attemptId);
    const q = v.questions[0]!.id;
    const post = (body: unknown) => call(answerRoute.POST, `/api/tests/attempts/${a.attemptId}/answer`, "POST", u.cookie, body, a.attemptId);
    for (const choice of [4, -1, 1.5, "1", null]) assert.equal((await post({ questionId: q, choice })).status, 400, String(choice));
    assert.equal((await post({ questionId: "x", choice: 1 })).status, 400);
    assert.equal((await post({ choice: 1 })).status, 400);
    const outside = Number((await queryOne<{ id: string }>("SELECT id::text AS id FROM test_questions WHERE subject_id = (SELECT id FROM test_subjects WHERE code = 'tarix') LIMIT 1"))!.id);
    assert.equal((await post({ questionId: outside, choice: 1 })).status, 400, "a question of another subject");
    assert.equal((await post({ questionId: q, choice: 1 })).status, 200);
    assert.equal((await post({ questionId: q, choice: 3 })).status, 200);
    const mine = (await active(u.uid, a.attemptId)).answers;
    assert.deepEqual(mine, { [q]: 3 });
    await call(finishRoute.POST, `/api/tests/attempts/${a.attemptId}/finish`, "POST", u.cookie, undefined, a.attemptId);
    const late = await post({ questionId: q, choice: 2 });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, "finished");
  });

  await t.test("routes: login required, CSRF, bad bodies", async () => {
    const u = await login({ points: 50_000 });
    assert.equal((await call(overviewRoute.GET, "/api/tests", "GET", null)).status, 401);
    assert.equal((await call(startRoute.POST, "/api/tests/start", "POST", null, { mode: "all" })).status, 401);
    assert.equal((await call(attemptRoute.GET, "/api/tests/attempts/x", "GET", null, undefined, "x")).status, 401);
    assert.equal((await call(startRoute.POST, "/api/tests/start", "POST", u.cookie, { mode: "all" }, undefined, { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status, 403);
    assert.equal((await attempts(u.uid)).length, 0, "the cross-site start charged nothing");
    for (const body of [{}, { mode: "x" }, { mode: "subject" }, { mode: "subject", subject: 5 }, { mode: "all", key: 5 }]) {
      assert.equal((await call(startRoute.POST, "/api/tests/start", "POST", u.cookie, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call(startRoute.POST, "/api/tests/start", "POST", u.cookie, { mode: "subject", subject: "nope" })).status, 404);
    assert.equal((await attempts(u.uid)).length, 0);
  });

  await t.test("overview: subjects in order with counts, the open attempt, readiness", async () => {
    const u = await login({ points: 50_000 });
    const ov = await svc.overview(u.uid, T0);
    assert.equal(ov.enabled, true);
    assert.deepEqual(ov.prices, { subject: 1500, all: 4000 });
    assert.equal(ov.pointsPerCorrect, 1.1);
    assert.deepEqual(ov.subjects, [
      { code: "math", name: "Matematika", questions: 10, minutes: 20, available: true },
      { code: "ona_tili", name: "Ona tili", questions: 10, minutes: 20, available: true },
      { code: "tarix", name: "Tarix", questions: 10, minutes: 20, available: true },
    ]);
    assert.deepEqual(ov.all, { questions: 30, minutes: 60, available: true });
    assert.equal(ov.open, null);
    const a = await svc.startAttempt(u.uid, { mode: "subject", subjectCode: "tarix" }, { now: new Date() });
    const ov2 = await svc.overview(u.uid);
    assert.deepEqual(ov2.open && [ov2.open.id, ov2.open.mode, ov2.open.subject], [a.attemptId, "subject", "Tarix"]);
    // A subject without active questions makes «hammasi» unavailable.
    await query("UPDATE test_questions SET active = FALSE WHERE subject_id = (SELECT id FROM test_subjects WHERE code = 'tarix')");
    const ov3 = await svc.overview(u.uid);
    assert.equal(ov3.all.available, false);
    assert.equal(ov3.subjects.find((s) => s.code === "tarix")!.available, false);
    await svc.finishAttempt(u.uid, a.attemptId);
    await assert.rejects(svc.startAttempt(u.uid, { mode: "all" }), (e: { status?: number; extra?: { code?: string } }) => e.status === 409 && e.extra?.code === "not_ready");
    await assert.rejects(svc.startAttempt(u.uid, { mode: "subject", subjectCode: "tarix" }), (e: { status?: number }) => e.status === 409);
    assert.equal((await ledger(u.uid)).length, 1, "a refused start charges nothing");
    await query("UPDATE test_questions SET active = TRUE");
  });
});
