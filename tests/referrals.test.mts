import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";

/**
 * Referral program — the money rules (docs/todo-2026-10-07/PLAN.md T3, D1–D3)
 * on a real Postgres: `lib/server/referrals.ts` + the create-branch hook in
 * `lib/server/auth.ts` (`upsertTelegramUser` / `registerBotUser`).
 *
 * Owner's key requirement: deleting the bot, reopening the link or signing in
 * again can NEVER reward twice. Proven here for: an existing account opening a
 * link, the same Telegram account coming back with the same or another code,
 * and concurrent first registrations of one person. Every reward is a ledger
 * row (`balance == sum(transactions)` for every wallet touched).
 *
 * Mutations (each turned a test red, then restored):
 *   1. auth.ts: referral applied outside `if (inserted)` (conflict path)  → «existing account … nothing» (error-sink assertion);
 *   2. referrals.ts: the `fresh` (created in this transaction) guard removed → «not_new guard»;
 *   1+2 together (double reward on the conflict path)                     → «existing account … nothing» (money);
 *   3. self check removed                                                  → «self-referral»;
 *   4. blocked check removed (points always 2000)                          → «blocked inviter»;
 *   5. REFERRAL_REWARD_POINTS 2000 → 200 / reward to the referee            → «new account via /start ref_»;
 *   6. ledger reference random instead of `referral:<referee id>`          → «second apply in the same transaction»;
 *   7. `ON CONFLICT DO NOTHING` dropped from the referrals insert           → «second apply …» (reason error, not duplicate);
 *   8. burst `n <= THRESHOLD` → `n < THRESHOLD`                             → «burst signal»;
 *   9. burst `NOT EXISTS` (resolved row) dropped                            → «burst signal» (second row the same day).
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.WORKER_INLINE = "false";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const shared = await import("../lib/referral.ts");
const { query, queryOne, pool, transaction, ensureMigrated } = await import("../lib/server/db.ts");
const { upsertTelegramUser, registerBotUser, SIGNUP_BONUS_POINTS } = await import("../lib/server/auth.ts");
const referrals = await import("../lib/server/referrals.ts");
const { topUpInTx } = await import("../lib/server/credits.ts");
const { setErrorSink } = await import("../lib/server/log.ts");
if (hasDb) await ensureMigrated();

const { REFERRAL_REWARD_POINTS } = shared;
const { applyReferralInTx, ensureRefCode, resolveReferrer, referralSummary, REFERRAL_BURST_THRESHOLD } = referrals;

const tgIds: string[] = [];
after(async () => {
  if (!hasDb) return;
  // Referees first (their rows SET NULL), then everyone; referral rows of these users go with them.
  await query("DELETE FROM referrals WHERE referee_telegram_id::text = ANY($1)", [tgIds]);
  await query("DELETE FROM error_log WHERE scope = 'referral_burst' AND user_id IN (SELECT id FROM users WHERE telegram_id::text = ANY($1))", [tgIds]);
  await query("DELETE FROM users WHERE telegram_id::text = ANY($1)", [tgIds]);
  await pool().end();
});

/** A random Telegram id far from real ones. */
function tgId(): string {
  const id = String(8_100_000_000 + randomInt(0, 99_999_999));
  tgIds.push(id);
  return id;
}
const profile = (telegramId: string, name = "Sinov Do'st") => ({ telegramId, username: null, name, photoUrl: null });

async function newReferrer(name = "Taklifchi") {
  const u = await upsertTelegramUser(profile(tgId(), name));
  return { id: u.id, code: await ensureRefCode(u.id) };
}

async function pointsOf(id: string): Promise<number> {
  return Number((await queryOne<{ points: string }>("SELECT points FROM users WHERE id = $1", [id]))!.points);
}

/** Every wallet equals the sum of its ledger column (credits.ts invariant). */
async function assertLedger(id: string, label: string) {
  const r = (await queryOne<{ points: string; quota: string; balance: string; sp: string; sq: string; sb: string }>(
    `SELECT u.points, u.quota, u.balance,
            COALESCE(sum(t.points_delta), 0) AS sp, COALESCE(sum(t.quota_delta), 0) AS sq, COALESCE(sum(t.balance_delta), 0) AS sb
       FROM users u LEFT JOIN transactions t ON t.user_id = u.id
      WHERE u.id = $1 GROUP BY u.id`,
    [id],
  ))!;
  assert.equal(Number(r.points), Number(r.sp), `${label}: points == sum(points_delta)`);
  assert.equal(Number(r.quota), Number(r.sq), `${label}: quota == sum(quota_delta)`);
  assert.equal(Number(r.balance), Number(r.sb), `${label}: balance == sum(balance_delta)`);
}

async function referralOf(refereeId: string) {
  return query<{ referrer_user_id: string; source: string; reward_points: number; reward_ref: string | null; referee_telegram_id: string }>(
    "SELECT referrer_user_id::text AS referrer_user_id, source, reward_points, reward_ref, referee_telegram_id::text AS referee_telegram_id FROM referrals WHERE referee_user_id = $1",
    [refereeId],
  );
}

async function rewardRows(reference: string) {
  return query<{ user_id: string; kind: string; points_delta: string; quota_delta: string; balance_delta: string; note: string }>(
    "SELECT user_id::text AS user_id, kind, points_delta, quota_delta, balance_delta, note FROM transactions WHERE reference = $1",
    [reference],
  );
}

/** Captures `log()` error records while `fn` runs. */
async function capturingErrors<T>(fn: () => Promise<T>): Promise<{ result: T; errors: string[] }> {
  const errors: string[] = [];
  setErrorSink((r) => {
    if (r.level === "error") errors.push(String(r.msg));
  });
  try {
    const result = await fn();
    // The sink is fed from a microtask; let the last records arrive.
    await new Promise((r) => setImmediate(r));
    return { result, errors };
  } finally {
    setErrorSink(null);
  }
}

/* ───────────────────────────── pure rules ───────────────────────────── */

test("codes: normalised, alphabet without look-alikes, 8–10 chars; payload and link shapes", () => {
  assert.equal(shared.REFERRAL_REWARD_POINTS, 2000, "D1: 2000 points per invited account");
  assert.equal(shared.normalizeRefCode(" K7M3P9QX "), "k7m3p9qx");
  for (const bad of ["k7m3p9q", "k7m3p9qx12345", "k7m3p0qx", "k7m3p1qx", "k7m3pIqx", "k7m3poqx", "../../x", "", null, 12345678, "k7m3 p9qx"]) {
    assert.equal(shared.normalizeRefCode(bad), null, String(bad));
  }
  assert.equal(shared.refCodeFromStartPayload("ref_k7m3p9qx"), "k7m3p9qx");
  assert.equal(shared.refCodeFromStartPayload("REF_K7M3P9QX"), "k7m3p9qx");
  assert.equal(shared.refCodeFromStartPayload("k7m3p9qx"), null, "a bare code is not an invite payload");
  assert.equal(shared.refCodeFromStartPayload("Q".repeat(32)), null, "a login nonce is not an invite");
  assert.equal(shared.refCodeFromStartPayload("s_00000000-0000-4000-8000-000000000001"), null);
  assert.equal(shared.referralBotLink("@slaydx_bot", "k7m3p9qx"), "https://t.me/slaydx_bot?start=ref_k7m3p9qx");
  assert.equal(shared.referralBotLink("", "k7m3p9qx"), null);
  assert.equal(shared.referralBotLink("bad bot", "k7m3p9qx"), null);
  assert.equal(shared.referralWebLink("https://slaydx.test/", "k7m3p9qx"), "https://slaydx.test/uz?ref=k7m3p9qx");
  assert.match(shared.referralRuleText(), /^Har bir yangi do'st uchun 2\s000 ball\. Do'stingiz ilovaga birinchi marta kirganda hisoblanadi\.$/);
  const share = new URL(shared.telegramShareUrl("https://t.me/slaydx_bot?start=ref_k7m3p9qx"));
  assert.equal(share.origin + share.pathname, "https://t.me/share/url");
  assert.equal(share.searchParams.get("url"), "https://t.me/slaydx_bot?start=ref_k7m3p9qx");
});

test("formatPoints / formatJoinDate: by hand, NBSP groups, Tashkent date — never the runtime's ICU (Chromium wrote «6,000»)", () => {
  const realNum = Number.prototype.toLocaleString;
  const realDate = Date.prototype.toLocaleDateString;
  // A browser whose ICU formats differently must not change what we render (smoke finding).
  Number.prototype.toLocaleString = function () {
    return "ICU";
  };
  Date.prototype.toLocaleDateString = function () {
    return "ICU";
  };
  try {
    assert.equal(shared.formatPoints(2000), "2 000", "MUTATSIYA 10: toLocaleString is back");
    assert.equal(shared.formatPoints(1_234_567), "1 234 567");
    assert.equal(shared.formatPoints(0), "0");
    assert.equal(shared.formatPoints(999), "999");
    assert.equal(shared.formatJoinDate("2026-10-06T20:30:00.000Z"), "07.10.2026", "UTC+5: already the next day in Tashkent");
    assert.equal(shared.formatJoinDate("2026-01-02T03:00:00.000Z"), "02.01.2026");
    assert.equal(shared.formatJoinDate("nonsense"), "");
    assert.equal(shared.referralRuleText(), "Har bir yangi do'st uchun 2 000 ball. Do'stingiz ilovaga birinchi marta kirganda hisoblanadi.");
  } finally {
    Number.prototype.toLocaleString = realNum;
    Date.prototype.toLocaleDateString = realDate;
  }
});

/* ───────────────────────────── codes ───────────────────────────── */

test("ensureRefCode: random 8-char code, stable, never the Telegram id, concurrent first calls agree, unique per user", { skip }, async () => {
  const id = tgId();
  const u = await upsertTelegramUser(profile(id));
  const codes = await Promise.all([ensureRefCode(u.id), ensureRefCode(u.id), ensureRefCode(u.id), ensureRefCode(u.id)]);
  assert.equal(new Set(codes).size, 1, "concurrent first calls agree on one code");
  const code = codes[0]!;
  assert.match(code, /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
  assert.ok(!code.includes(id) && code !== id, "never the Telegram id");
  assert.equal(await ensureRefCode(u.id), code, "stable");
  const other = await newReferrer();
  assert.notEqual(other.code, code);
  assert.deepEqual(await resolveReferrer(code.toUpperCase()), { id: u.id, isBlocked: false }, "lookup is case-insensitive");
  assert.equal(await resolveReferrer("zzzzzzzz"), null);
});

/* ───────────────────────────── reward ───────────────────────────── */

test("new account via /start ref_ (registerBotUser): inviter +2000 once (ledger bonus `referral:<id>`), invitee only the signup bonus", { skip }, async () => {
  const inviter = await newReferrer("Ali Taklifchi");
  const before = await pointsOf(inviter.id);
  const tg = tgId();
  const invitee = await registerBotUser(profile(tg, "Vali Yangi"), { code: inviter.code, source: "bot" });

  assert.equal((await pointsOf(inviter.id)) - before, REFERRAL_REWARD_POINTS, "MUTATSIYA 5: exactly 2000 to the inviter");
  assert.equal(invitee.points, SIGNUP_BONUS_POINTS, "D2: the invitee gets no extra bonus");
  const rows = await referralOf(invitee.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    referrer_user_id: inviter.id,
    source: "bot",
    reward_points: 2000,
    reward_ref: `referral:${invitee.id}`,
    referee_telegram_id: tg,
  });
  const ledger = await rewardRows(`referral:${invitee.id}`);
  assert.equal(ledger.length, 1, "exactly one ledger row for this invite");
  assert.deepEqual(
    { ...ledger[0], note: undefined },
    { user_id: inviter.id, kind: "bonus", points_delta: "2000", quota_delta: "0", balance_delta: "0", note: undefined },
  );
  assert.equal(ledger[0]!.note, "Do'st taklifi: Vali Yangi");
  await assertLedger(inviter.id, "inviter");
  await assertLedger(invitee.id, "invitee");
});

test("existing account opens a referral link (bot or site) → nothing: no row, no money, no error", { skip }, async () => {
  const inviter = await newReferrer();
  const tg = tgId();
  // First contact without any link (plain /start or a site login).
  const existing = await upsertTelegramUser(profile(tg));
  const before = await pointsOf(inviter.id);
  const { errors } = await capturingErrors(async () => {
    await registerBotUser(profile(tg), { code: inviter.code, source: "bot" });
    await upsertTelegramUser(profile(tg), { code: inviter.code, source: "web" });
  });
  assert.equal(await pointsOf(inviter.id), before, "MUTATSIYA 1+2: no reward for an existing account");
  assert.equal((await referralOf(existing.id)).length, 0);
  assert.equal((await rewardRows(`referral:${existing.id}`)).length, 0);
  assert.deepEqual(
    errors.filter((m) => m.startsWith("[referral]")),
    [],
    "MUTATSIYA 1: the create-branch gate in auth.ts never even calls applyReferralInTx for an existing account",
  );
  await assertLedger(inviter.id, "inviter");
});

test("the same Telegram account again (bot deleted and re-added, link reopened, another inviter's link) → still one reward", { skip }, async () => {
  const first = await newReferrer("Birinchi");
  const second = await newReferrer("Ikkinchi");
  const tg = tgId();
  const invitee = await registerBotUser(profile(tg), { code: first.code, source: "bot" });
  const p1 = await pointsOf(first.id);
  const p2 = await pointsOf(second.id);
  for (let i = 0; i < 3; i++) {
    await registerBotUser(profile(tg), { code: first.code, source: "bot" });
    await registerBotUser(profile(tg), { code: second.code, source: "bot" });
    await upsertTelegramUser(profile(tg), { code: second.code, source: "web" });
  }
  assert.equal(await pointsOf(first.id), p1);
  assert.equal(await pointsOf(second.id), p2);
  const rows = await referralOf(invitee.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.referrer_user_id, first.id, "the first (creating) inviter keeps the credit");
  assert.equal((await rewardRows(`referral:${invitee.id}`)).length, 1);
});

test("concurrency: three simultaneous first registrations of one person with one link → one account, one reward", { skip }, async () => {
  const inviter = await newReferrer();
  const before = await pointsOf(inviter.id);
  const tg = tgId();
  const claim = { code: inviter.code, source: "bot" as const };
  const settled = await Promise.allSettled([
    registerBotUser(profile(tg), claim),
    upsertTelegramUser(profile(tg), { ...claim, source: "web" }),
    registerBotUser(profile(tg), claim),
  ]);
  assert.deepEqual(settled.map((s) => s.status), ["fulfilled", "fulfilled", "fulfilled"], "no 500 for the losers");
  const ids = new Set(settled.map((s) => (s as PromiseFulfilledResult<{ id: string }>).value.id));
  assert.equal(ids.size, 1, "one account");
  const [refereeId] = [...ids];
  assert.equal((await pointsOf(inviter.id)) - before, REFERRAL_REWARD_POINTS, "exactly one reward");
  assert.equal((await referralOf(refereeId!)).length, 1);
  assert.equal((await rewardRows(`referral:${refereeId}`)).length, 1);
  await assertLedger(inviter.id, "inviter");
});

test("concurrency: one new person, two different inviters' links at once → exactly one inviter rewarded", { skip }, async () => {
  const a = await newReferrer("A");
  const b = await newReferrer("B");
  const [pa, pb] = [await pointsOf(a.id), await pointsOf(b.id)];
  const tg = tgId();
  await Promise.all([
    registerBotUser(profile(tg), { code: a.code, source: "bot" }),
    registerBotUser(profile(tg), { code: b.code, source: "bot" }),
  ]);
  const gained = (await pointsOf(a.id)) - pa + ((await pointsOf(b.id)) - pb);
  assert.equal(gained, REFERRAL_REWARD_POINTS);
  const n = await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM referrals WHERE referee_telegram_id = $1", [tg]);
  assert.equal(n!.n, "1");
});

/** Rewards booked for `inviterId`: referral rows (with points) and ledger rows. */
async function rewardCounts(inviterId: string) {
  const r = await queryOne<{ rows: string; ledger: string }>(
    `SELECT (SELECT count(*) FROM referrals WHERE referrer_user_id = $1 AND reward_points = 2000)::text AS rows,
            (SELECT count(*) FROM transactions WHERE user_id = $1 AND kind = 'bonus' AND reference LIKE 'referral:%')::text AS ledger`,
    [inviterId],
  );
  return { rows: Number(r!.rows), ledger: Number(r!.ledger) };
}

test("concurrency (review BLOCKER-1): 12 brand-new invitees of ONE inviter at once → 12 rewards, no deadlock swallowed, ledger invariant", { skip }, async () => {
  const inviter = await newReferrer("Guruhga yuborgan");
  const before = await pointsOf(inviter.id);
  const N = 12;
  const { result: settled, errors } = await capturingErrors(() =>
    Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        i % 2
          ? upsertTelegramUser(profile(tgId(), `Guruh ${i}`), { code: inviter.code, source: "web" })
          : registerBotUser(profile(tgId(), `Guruh ${i}`), { code: inviter.code, source: "bot" }),
      ),
    ),
  );
  assert.deepEqual(settled.map((s) => s.status), Array(N).fill("fulfilled"), "every sign-up succeeds");
  assert.deepEqual(errors.filter((m) => m.startsWith("[referral]")), [], "MUTATSIYA 11: no 40P01 swallowed by the savepoint");
  assert.equal((await pointsOf(inviter.id)) - before, N * REFERRAL_REWARD_POINTS, "every reward granted exactly once");
  assert.deepEqual(await rewardCounts(inviter.id), { rows: N, ledger: N });
  await assertLedger(inviter.id, "inviter of 12");
});

test("concurrency: B (A's invitee) is a referrer too — A's and B's new invitees, A's and B's own sign-ins, all at once → no deadlock", { skip }, async () => {
  const a = await newReferrer("A");
  const bTg = tgId();
  const b = await registerBotUser(profile(bTg, "B"), { code: a.code, source: "bot" });
  const bCode = await ensureRefCode(b.id);
  const aTg = (await queryOne<{ t: string }>("SELECT telegram_id::text AS t FROM users WHERE id = $1", [a.id]))!.t;
  const [pa, pb] = [await pointsOf(a.id), await pointsOf(b.id)];
  const K = 6;
  const { result: settled, errors } = await capturingErrors(() =>
    Promise.allSettled([
      ...Array.from({ length: K }, () => registerBotUser(profile(tgId(), "A dan"), { code: a.code, source: "bot" })),
      ...Array.from({ length: K }, () => upsertTelegramUser(profile(tgId(), "B dan"), { code: bCode, source: "web" })),
      // The inviters' own rows are locked by their own sign-ins at the same time.
      registerBotUser(profile(bTg, "B"), { code: a.code, source: "bot" }),
      upsertTelegramUser(profile(aTg, "A"), { code: bCode, source: "web" }),
    ]),
  );
  assert.ok(settled.every((s) => s.status === "fulfilled"), JSON.stringify(settled.filter((s) => s.status === "rejected")));
  assert.deepEqual(errors.filter((m) => m.startsWith("[referral]")), []);
  assert.equal((await pointsOf(a.id)) - pa, K * REFERRAL_REWARD_POINTS, "A: K new invitees (B's re-sign-in pays nothing)");
  assert.equal((await pointsOf(b.id)) - pb, K * REFERRAL_REWARD_POINTS, "B: K new invitees (A's sign-in with B's code pays nothing)");
  await assertLedger(a.id, "A");
  await assertLedger(b.id, "B");
});

test("unknown or malformed code → the account is created, nobody is credited, no row", { skip }, async () => {
  for (const code of ["zzzzzzzz", "../../x", "ref_k7m3p9qx"]) {
    const tg = tgId();
    const u = await registerBotUser(profile(tg), { code, source: "bot" });
    assert.equal(u.points, SIGNUP_BONUS_POINTS, `${code}: signup still works`);
    assert.equal((await referralOf(u.id)).length, 0, code);
    assert.equal((await rewardRows(`referral:${u.id}`)).length, 0, code);
  }
});

test("blocked inviter → the invite is recorded (who invited whom) with 0 points and no ledger row", { skip }, async () => {
  const inviter = await newReferrer();
  await query("UPDATE users SET is_blocked = true WHERE id = $1", [inviter.id]);
  const before = await pointsOf(inviter.id);
  const u = await registerBotUser(profile(tgId()), { code: inviter.code, source: "bot" });
  assert.equal(await pointsOf(inviter.id), before, "MUTATSIYA 4: a blocked inviter earns nothing");
  const rows = await referralOf(u.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.reward_points, 0);
  assert.equal(rows[0]!.reward_ref, null);
  assert.equal((await rewardRows(`referral:${u.id}`)).length, 0);
  await assertLedger(inviter.id, "blocked inviter");
});

/* ───────────── applyReferralInTx guards, called directly (defence in depth) ───────────── */

/** Inside one transaction: a fresh user created HERE (like the create branch does). */
async function inFreshUserTx<T>(fn: (client: import("pg").PoolClient, userId: string) => Promise<T>, rollback = true): Promise<T> {
  let out!: T;
  await transaction(async (client) => {
    const tg = tgId();
    const id = (await client.query<{ id: string }>("INSERT INTO users (telegram_id, name) VALUES ($1, 'Yangi') RETURNING id::text AS id", [tg])).rows[0]!.id;
    out = await fn(client, id);
    if (rollback) throw Object.assign(new Error("rollback"), { rollback: true });
  }).catch((e: { rollback?: boolean }) => {
    if (!e.rollback) throw e;
  });
  return out;
}

test("guard self-referral: a code that resolves to the referee itself → reason self, no row", { skip }, async () => {
  const out = await inFreshUserTx(async (client, id) => {
    // A code from the alphabet (no 0/1/i/l/o); the transaction is rolled back afterwards.
    const own = "m7s3a9q2";
    await client.query("UPDATE users SET ref_code = $2 WHERE id = $1", [id, own]);
    const r = await applyReferralInTx(client, { refereeId: id, code: own, source: "bot" });
    const n = (await client.query("SELECT 1 FROM referrals WHERE referee_user_id = $1", [id])).rowCount;
    return { r, n };
  });
  assert.equal(out.r.applied, false);
  assert.equal(out.r.applied === false && out.r.reason, "self", "MUTATSIYA 3");
  assert.equal(out.n, 0);
});

test("guard not_new: an account this transaction did not create → reason not_new, error logged, no row, no money", { skip }, async () => {
  const inviter = await newReferrer();
  const old = await upsertTelegramUser(profile(tgId()));
  const before = await pointsOf(inviter.id);
  const { result, errors } = await capturingErrors(() =>
    transaction((client) => applyReferralInTx(client, { refereeId: old.id, code: inviter.code, source: "web" })),
  );
  assert.equal(result.applied === false && result.reason, "not_new", "MUTATSIYA 2");
  assert.ok(errors.some((m) => m.startsWith("[referral] mavjud akkaunt")), "a caller bypassing the gate is visible in the admin errors");
  assert.equal(await pointsOf(inviter.id), before);
  assert.equal((await referralOf(old.id)).length, 0);
});

test("second apply in the same transaction (a retry) → duplicate: one row, one ledger row, one reward", { skip }, async () => {
  const inviter = await newReferrer();
  const before = await pointsOf(inviter.id);
  const out = await inFreshUserTx(async (client, id) => {
    const r1 = await applyReferralInTx(client, { refereeId: id, code: inviter.code, source: "bot" });
    const r2 = await applyReferralInTx(client, { refereeId: id, code: inviter.code, source: "web" });
    return { id, r1, r2 };
  }, false);
  assert.equal(out.r1.applied, true);
  assert.equal(out.r2.applied === false && out.r2.reason, "duplicate", "MUTATSIYA 7");
  assert.equal((await pointsOf(inviter.id)) - before, REFERRAL_REWARD_POINTS);
  assert.equal((await referralOf(out.id)).length, 1);
  const ledger = await query("SELECT 1 FROM transactions WHERE user_id = $1 AND reference LIKE 'referral:%' AND created_at > now() - interval '1 minute' AND reference = $2", [inviter.id, `referral:${out.id}`]);
  assert.equal(ledger.length, 1, "MUTATSIYA 6: the reward reference is `referral:<referee id>`");
  await assertLedger(inviter.id, "inviter");
});

test("review MINOR-2: the reward reference already in the ledger → the row is kept but claims 0 points (row ⇔ ledger)", { skip }, async () => {
  const inviter = await newReferrer();
  const before = await pointsOf(inviter.id);
  const out = await inFreshUserTx(async (client, id) => {
    // e.g. a restored ledger that already paid this referee id
    await topUpInTx(client, inviter.id, { points: 2000 }, `referral:${id}`, "bonus", "oldindan");
    const r = await applyReferralInTx(client, { refereeId: id, code: inviter.code, source: "bot" });
    const row = (await client.query<{ reward_points: number; reward_ref: string | null }>(
      "SELECT reward_points, reward_ref FROM referrals WHERE referee_user_id = $1",
      [id],
    )).rows;
    return { r, row };
  }, false);
  assert.equal(out.r.applied === false && out.r.reason, "duplicate");
  assert.deepEqual(out.row, [{ reward_points: 0, reward_ref: null }], "MUTATSIYA 12: the row must not claim money that did not move");
  assert.equal((await pointsOf(inviter.id)) - before, 2000, "only the pre-existing ledger row");
  const s = await referralSummary(inviter.id, { botUsername: null, appUrl: "https://slaydx.test" });
  assert.equal(s.earnedPoints, 0, "counters follow the ledger");
  await assertLedger(inviter.id, "inviter");
});

test("a failing referral never costs the sign-up: rolled back to its savepoint, error logged, account created", { skip }, async () => {
  const inviter = await newReferrer();
  const before = await pointsOf(inviter.id);
  const tg = tgId();
  // An impossible source violates the table CHECK inside applyReferralInTx.
  const { result, errors } = await capturingErrors(() => registerBotUser(profile(tg), { code: inviter.code, source: "evil" as never }));
  assert.equal(result.points, SIGNUP_BONUS_POINTS, "the account and its signup bonus committed");
  assert.equal(await pointsOf(inviter.id), before);
  assert.equal((await referralOf(result.id)).length, 0);
  assert.ok(errors.some((m) => m.startsWith("[referral] taklif yozilmadi")));
  await assertLedger(result.id, "invitee");
});

/* ───────────────────────────── burst signal (D3) ───────────────────────────── */

test("burst signal: > 25 invites in 24 h → exactly one error_log row per inviter per day (level error, scope referral_burst); no cap", { skip }, async () => {
  const inviter = await newReferrer();
  const rowsOf = () =>
    query<{ id: string; level: string; scope: string; user_id: string; message: string; resolved_at: Date | null }>(
      "SELECT id::text AS id, level, scope, user_id::text AS user_id, message, resolved_at FROM error_log WHERE scope = 'referral_burst' AND user_id = $1",
      [inviter.id],
    );
  for (let i = 0; i < REFERRAL_BURST_THRESHOLD; i++) await registerBotUser(profile(tgId()), { code: inviter.code, source: "bot" });
  assert.equal((await rowsOf()).length, 0, `MUTATSIYA 8: ${REFERRAL_BURST_THRESHOLD} is not a burst`);
  await registerBotUser(profile(tgId()), { code: inviter.code, source: "bot" });
  const rows = await rowsOf();
  assert.equal(rows.length, 1, "the 26th raises the signal");
  assert.equal(rows[0]!.level, "error", "the watchdog alerts on level error");
  assert.match(rows[0]!.message, /24 soatda 26 ta/);
  await registerBotUser(profile(tgId()), { code: inviter.code, source: "bot" });
  assert.equal((await rowsOf()).length, 1, "the 27th: still one row");
  // Resolved by an admin the same day: no second row today.
  await query("UPDATE error_log SET resolved_at = now() WHERE id = $1", [rows[0]!.id]);
  await registerBotUser(profile(tgId()), { code: inviter.code, source: "bot" });
  assert.equal((await rowsOf()).length, 1, "MUTATSIYA 9: one row per inviter per day, resolved or not");
  // D3: no cap — every one of the 28 was rewarded.
  const n = await queryOne<{ n: string; pts: string }>(
    "SELECT count(*)::text AS n, sum(reward_points)::text AS pts FROM referrals WHERE referrer_user_id = $1",
    [inviter.id],
  );
  assert.deepEqual(n, { n: "28", pts: String(28 * REFERRAL_REWARD_POINTS) });
  await assertLedger(inviter.id, "burst inviter");
});

/* ───────────────────────────── single base ───────────────────────────── */

test("one shared base: a bot-registered person signing in on the site is the SAME users row (and vice versa)", { skip }, async () => {
  const tg = tgId();
  const viaBot = await registerBotUser(profile(tg, "Botdan"));
  const viaSite = await upsertTelegramUser({ ...profile(tg, "Saytdan"), photoUrl: "https://t.me/i/userpic/x.jpg" });
  assert.equal(viaSite.id, viaBot.id);
  const tg2 = tgId();
  const siteFirst = await upsertTelegramUser(profile(tg2));
  const botLater = await registerBotUser(profile(tg2));
  assert.equal(botLater.id, siteFirst.id);
  const n = await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM users WHERE telegram_id::text = ANY($1)", [[tg, tg2]]);
  assert.equal(n!.n, "2", "one row per Telegram account");
  assert.equal(viaSite.points, SIGNUP_BONUS_POINTS, "the signup bonus once, whichever side came first");
});

test("referralSummary: counts, earned points, recent names only (newest first, ≤ 20), links", { skip }, async () => {
  const inviter = await newReferrer();
  for (let i = 0; i < 22; i++) await registerBotUser(profile(tgId(), `Do'st ${String(i).padStart(2, "0")}`), { code: inviter.code, source: i % 2 ? "web" : "bot" });
  const s = await referralSummary(inviter.id, { botUsername: "slaydx_test_bot", appUrl: "https://slaydx.test" });
  assert.equal(s.code, inviter.code);
  assert.equal(s.botLink, `https://t.me/slaydx_test_bot?start=ref_${inviter.code}`);
  assert.equal(s.webLink, `https://slaydx.test/uz?ref=${inviter.code}`);
  assert.equal(s.rewardPoints, 2000);
  assert.equal(s.invitedCount, 22);
  assert.equal(s.earnedPoints, 22 * 2000);
  assert.equal(s.recent.length, 20);
  assert.equal(s.recent[0]!.name, "Do'st 21", "newest first");
  assert.deepEqual(Object.keys(s.recent[0]!).sort(), ["joinedAt", "name"]);
});
