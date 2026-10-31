import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Ambassador bonus (owner decision D4, docs/program-17/PLAN.md item 11): a referred user's paid
 * top-up earns the INVITER floor(amount × `ambassador.percent` / 100) bonus so'm (ledger kind
 * `bonus`, reference `ambassador:<orderId>`), paid inside the settlement transaction
 * (`settleOrderInTx`) after the payer's credit; on a throwaway Postgres.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - duplicate-reference guard removed (a second settle path paying under a fresh reference)
 *                                                          → «once per order»;
 *   - base = amount + the payer's payment bonus             → «10 % of the money paid, not of the bonus»;
 *   - self-referral check dropped                           → «skips: self-referral» (see test: forced via the CHECK-free NULL path);
 *   - percent 0 check dropped (`points < 1` guard + rules)  → «percent 0 pays nothing»;
 *   - blocked-referrer check dropped                        → «skips: blocked referrer».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("ambassador") : { isolated: false, drop: async () => {} };
const skip = hasDb ? false : "DATABASE_URL yo'q";

test("ambassador rules (pure)", async () => {
  const a = await import("../lib/ambassador.ts");
  assert.deepEqual([a.AMBASSADOR_MIN, a.AMBASSADOR_MAX, a.AMBASSADOR_DEFAULT, a.AMBASSADOR_KEY], [0, 50, 10, "ambassador.percent"]);
  assert.equal(a.ambassadorPoints(50_000, 10), 5_000);
  assert.equal(a.ambassadorPoints(9_999, 10), 999, "floor");
  assert.equal(a.ambassadorPoints(10_000, 15), 1_500);
  assert.equal(a.ambassadorPoints(9, 10), 0);
  assert.equal(a.ambassadorPoints(10_000, 0), 0);
  assert.equal(a.ambassadorPoints(10_000, 51), 0);
  assert.equal(a.ambassadorPoints(10_000, 2.5), 0);
  assert.equal(a.ambassadorPoints(-5, 10), 0);
  assert.equal(a.ambassadorPoints(1_000.5, 10), 0);
  assert.equal(a.ambassadorRef("o-1"), "ambassador:o-1");
  assert.equal(a.ambassadorNote(10), "Do'st to'lovi bonusi (10%)");
  assert.equal(a.ambassadorRuleText(10), "Do'stlaringiz har to'lovidan 10 % bonus so'm");
  assert.equal(a.ambassadorRuleText(0), "");
  const s = await import("../lib/server/settings.ts");
  assert.equal(s.settingDef("ambassador.percent").envDefault(), 10);
  assert.equal(s.validateSetting("ambassador.percent", 50).ok, true);
  assert.equal(s.validateSetting("ambassador.percent", 0).ok, true);
  for (const bad of [51, -1, 2.5, "10", null, true]) assert.equal(s.validateSetting("ambassador.percent", bad).ok, false, String(bad));
});

test("ambassador: bot ledger title, referral rule line (uz/ru/en), web wallet title", async () => {
  const scr = await import("../lib/server/bot/screens.ts");
  const { describeEntry } = await import("../components/wallet/wallet-model.ts");
  const note = "Do'st to'lovi bonusi (10%)";
  assert.equal(scr.ledgerTitle("uz", { kind: "bonus", note }), note);
  assert.match(scr.ledgerTitle("ru", { kind: "bonus", note }), /друга \(10%\)/);
  assert.match(scr.ledgerTitle("en", { kind: "bonus", note }), /Friend's payment bonus \(10%\)/);
  const input = { link: "https://t.me/x?start=ref_abc", rewardPoints: 1000, invitedCount: 0, earnedPoints: 0 };
  assert.match(scr.referralScreen("uz", { ...input, ambassadorPercent: 10 }, null).text, /Do'stlaringiz har to'lovidan 10 % bonus so'm/);
  assert.match(scr.referralScreen("ru", { ...input, ambassadorPercent: 10 }, null).text, /10 % бонусных сум с каждого платежа/);
  assert.match(scr.referralScreen("en", { ...input, ambassadorPercent: 10 }, null).text, /10 % bonus UZS from every payment/);
  assert.ok(!/to'lovidan/.test(scr.referralScreen("uz", { ...input, ambassadorPercent: 0 }, null).text), "hidden at 0");
  assert.ok(!/to'lovidan/.test(scr.referralScreen("uz", input, null).text), "hidden when absent");
  assert.equal(describeEntry({ kind: "bonus", note, pointsDelta: 100, balanceDelta: 0, quotaDelta: 0 } as never).title, note);
});

test("ambassador bonus: settlement, guards, isolation, concurrency", { skip }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { settleOrder, createPaidPaynetOrder } = await import("../lib/server/payments.ts");
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  const { adminReferralInfo, referralSummary } = await import("../lib/server/referrals.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  let seq = 0;
  const mkUser = async (blocked = false) =>
    String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance, is_blocked) VALUES ($1, 'Test', 0, 0, 0, $2) RETURNING id`,
          [`amb-${Date.now()}-${++seq}`, blocked],
        )
      )[0].id,
    );
  /** `referee` was invited by `referrer` (null referrer = the inviter row was deleted). */
  const refer = async (referee: string, referrer: string | null) => {
    await query(
      `INSERT INTO referrals (referee_user_id, referee_telegram_id, referrer_user_id, source) VALUES ($1, $2, $3, 'bot')`,
      [referee, 9_000_000 + ++seq, referrer],
    );
  };
  const setPercent = async (n: number | null) => {
    if (n === null) await query("DELETE FROM app_settings WHERE key = 'ambassador.percent'");
    else await query(`INSERT INTO app_settings (key, value) VALUES ('ambassador.percent', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`, [JSON.stringify(n)]);
    invalidateSettingsCache();
  };
  const setPayBonus = async (n: number) => {
    await query(`INSERT INTO app_settings (key, value) VALUES ('payment_bonus_percent', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`, [JSON.stringify(n)]);
    invalidateSettingsCache();
  };
  const order = async (uid: string, amountSoum: number, purpose = "topup") =>
    (
      await query<{ id: string }>(
        `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum) VALUES (gen_random_uuid(), $1, 'click', $2, $3) RETURNING id::text AS id`,
        [uid, purpose, amountSoum],
      )
    )[0].id;
  const wallet = async (uid: string) => {
    const r = (await query<{ points: string; balance: string }>(`SELECT points, balance FROM users WHERE id = $1`, [uid]))[0];
    return { points: Number(r.points), balance: Number(r.balance) };
  };
  const ambRows = (uid: string) =>
    query<{ kind: string; points_delta: string; balance_delta: string; reference: string; note: string }>(
      `SELECT kind, points_delta, balance_delta, reference, note FROM transactions WHERE user_id = $1 AND reference LIKE 'ambassador:%' ORDER BY id`,
      [uid],
    );
  const assertLedger = async (uid: string) => {
    const s = (await query<{ p: string; b: string }>(`SELECT COALESCE(SUM(points_delta),0) p, COALESCE(SUM(balance_delta),0) b FROM transactions WHERE user_id = $1`, [uid]))[0];
    assert.deepEqual(await wallet(uid), { points: Number(s.p), balance: Number(s.b) }, "wallet must equal the ledger sum");
  };
  const state = async (id: string) => (await queryOne<{ state: string }>(`SELECT state FROM payment_orders WHERE id = $1`, [id]))!.state;
  /** A fresh referred payer + their inviter, percent 10, payment bonus 10. */
  const pair = async () => {
    const referrer = await mkUser();
    const payer = await mkUser();
    await refer(payer, referrer);
    return { referrer, payer };
  };

  await setPercent(10);
  await setPayBonus(10);

  await t.test("10 % of the money paid, not of the bonus; the payer's own bonus is unaffected", async () => {
    const { referrer, payer } = await pair();
    const id = await order(payer, 100_000);
    assert.equal((await settleOrder(id, Date.now())).status, "paid");
    const rows = await ambRows(referrer);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].kind, Number(rows[0].points_delta), Number(rows[0].balance_delta), rows[0].reference], ["bonus", 10_000, 0, `ambassador:${id}`]);
    assert.equal(rows[0].note, "Do'st to'lovi bonusi (10%)");
    assert.ok(!/test|amb-/i.test(rows[0].note), "no referee PII in the note");
    assert.deepEqual(await wallet(referrer), { points: 10_000, balance: 0 });
    // The payer: balance from the top-up, 10 % payment bonus in points — exactly as without a referral.
    assert.deepEqual(await wallet(payer), { points: 10_000, balance: 100_000 });
    await assertLedger(referrer);
    await assertLedger(payer);
  });

  await t.test("every payment counts: a second order pays again; floor on 9 999", async () => {
    const { referrer, payer } = await pair();
    await settleOrder(await order(payer, 9_999), Date.now());
    await settleOrder(await order(payer, 20_000), Date.now());
    assert.deepEqual((await ambRows(referrer)).map((r) => Number(r.points_delta)), [999, 2_000]);
  });

  await t.test("percent 15 pays 15 %; the setting is read at settlement", async () => {
    const { referrer, payer } = await pair();
    await setPercent(15);
    await settleOrder(await order(payer, 10_000), Date.now());
    assert.deepEqual((await ambRows(referrer)).map((r) => Number(r.points_delta)), [1_500]);
    await setPercent(10);
  });

  await t.test("percent 0 pays nothing", async () => {
    const { referrer, payer } = await pair();
    await setPercent(0);
    const id = await order(payer, 100_000);
    assert.equal((await settleOrder(id, Date.now())).status, "paid");
    assert.equal((await ambRows(referrer)).length, 0);
    assert.deepEqual(await wallet(referrer), { points: 0, balance: 0 });
    await setPercent(10);
  });

  await t.test("once per order: re-settle and concurrent duplicate settles credit once", async () => {
    const { referrer, payer } = await pair();
    const id = await order(payer, 50_000);
    const outs = await Promise.all(Array.from({ length: 6 }, () => settleOrder(id, Date.now())));
    assert.equal(outs.filter((o) => o.status === "paid").length, 1);
    assert.equal(outs.filter((o) => o.status === "already_paid").length, 5);
    assert.equal((await settleOrder(id, Date.now())).status, "already_paid");
    assert.deepEqual((await ambRows(referrer)).map((r) => Number(r.points_delta)), [5_000]);
    assert.deepEqual(await wallet(payer), { points: 5_000, balance: 50_000 }, "payer credited once as well");
  });

  await t.test("the duplicate-reference guard: a pre-existing ledger row for the order is not paid twice", async () => {
    const { referrer, payer } = await pair();
    const id = await order(payer, 50_000);
    await query(`INSERT INTO transactions (user_id, kind, points_delta, reference, note) VALUES ($1, 'bonus', 0, $2, 'pre')`, [referrer, `ambassador:${id}`]);
    assert.equal((await settleOrder(id, Date.now())).status, "paid");
    assert.deepEqual(await wallet(referrer), { points: 0, balance: 0 });
    assert.equal((await ambRows(referrer)).length, 1);
    assert.equal(await state(id), "paid");
  });

  await t.test("Paynet paid order pays the inviter", async () => {
    const { referrer, payer } = await pair();
    const out = await createPaidPaynetOrder({ userId: payer, amountSoum: 40_000, transactionId: String(7_700_000 + ++seq) });
    assert.equal(out.status, "paid");
    assert.deepEqual((await ambRows(referrer)).map((r) => Number(r.points_delta)), [4_000]);
    await assertLedger(referrer);
  });

  await t.test("skips: no referral row", async () => {
    const payer = await mkUser();
    const id = await order(payer, 100_000);
    assert.equal((await settleOrder(id, Date.now())).status, "paid");
    assert.equal(Number((await queryOne<{ n: string }>(`SELECT count(*)::text n FROM transactions WHERE reference LIKE $1`, [`ambassador:${id}`]))!.n), 0);
  });

  await t.test("skips: referrer deleted (NULL referrer)", async () => {
    const payer = await mkUser();
    await refer(payer, null);
    const id = await order(payer, 100_000);
    assert.equal((await settleOrder(id, Date.now())).status, "paid");
    assert.equal(Number((await queryOne<{ n: string }>(`SELECT count(*)::text n FROM transactions WHERE reference = $1`, [`ambassador:${id}`]))!.n), 0);
    assert.deepEqual(await wallet(payer), { points: 10_000, balance: 100_000 });
  });

  await t.test("skips: self-referral (the DB CHECK is dropped for this probe)", async () => {
    const u = await mkUser();
    await query("ALTER TABLE referrals DROP CONSTRAINT referrals_not_self");
    try {
      await refer(u, u);
      const id = await order(u, 100_000);
      assert.equal((await settleOrder(id, Date.now())).status, "paid");
      assert.equal((await ambRows(u)).length, 0);
      assert.deepEqual(await wallet(u), { points: 10_000, balance: 100_000 }, "only the payer's own bonus");
    } finally {
      await query("DELETE FROM referrals WHERE referee_user_id = referrer_user_id");
      await query("ALTER TABLE referrals ADD CONSTRAINT referrals_not_self CHECK (referee_user_id IS NULL OR referrer_user_id IS NULL OR referee_user_id <> referrer_user_id)");
    }
  });

  await t.test("skips: blocked referrer", async () => {
    const referrer = await mkUser(true);
    const payer = await mkUser();
    await refer(payer, referrer);
    const id = await order(payer, 100_000);
    assert.equal((await settleOrder(id, Date.now())).status, "paid");
    assert.equal((await ambRows(referrer)).length, 0);
    assert.deepEqual(await wallet(referrer), { points: 0, balance: 0 });
  });

  await t.test("skips: non-topup purpose (old 'pro' order)", async () => {
    const { referrer, payer } = await pair();
    const id = await order(payer, 100_000, "pro");
    assert.equal((await settleOrder(id, Date.now())).status, "paid");
    assert.equal((await ambRows(referrer)).length, 0);
    assert.deepEqual(await wallet(payer), { points: 0, balance: 100_000 });
  });

  await t.test("a failure in the ambassador step does not undo the payer's settlement", async () => {
    const { referrer, payer } = await pair();
    await query(`CREATE OR REPLACE FUNCTION amb_boom() RETURNS trigger AS $$ BEGIN
      IF NEW.reference LIKE 'ambassador:%' THEN RAISE EXCEPTION 'forced ambassador failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await query("CREATE TRIGGER amb_boom BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION amb_boom()");
    try {
      const id = await order(payer, 100_000);
      assert.equal((await settleOrder(id, Date.now())).status, "paid");
      assert.equal(await state(id), "paid");
      assert.deepEqual(await wallet(payer), { points: 10_000, balance: 100_000 }, "top-up + payment bonus kept");
      assert.deepEqual(await wallet(referrer), { points: 0, balance: 0 });
      await assertLedger(payer);
      await assertLedger(referrer);
    } finally {
      await query("DROP TRIGGER amb_boom ON transactions");
      await query("DROP FUNCTION amb_boom()");
    }
  });

  await t.test("opposite-direction concurrent payments (referrer pays while the referee pays) do not deadlock", async () => {
    const { referrer, payer } = await pair();
    const grand = await mkUser();
    await refer(referrer, grand);
    const ids = await Promise.all([order(payer, 30_000), order(referrer, 30_000), order(payer, 30_000), order(referrer, 30_000)]);
    await Promise.all(ids.map((id) => settleOrder(id, Date.now())));
    for (const id of ids) assert.equal(await state(id), "paid");
    assert.deepEqual((await ambRows(grand)).map((r) => Number(r.points_delta)), [3_000, 3_000]);
    // referrer: own payment bonus (2 × 3 000) + 2 × 3 000 from the payer.
    assert.deepEqual(await wallet(referrer), { points: 12_000, balance: 60_000 });
    await assertLedger(referrer);
  });

  await t.test("admin referral info totals the ambassador bonus", async () => {
    const { referrer, payer } = await pair();
    await settleOrder(await order(payer, 20_000), Date.now());
    await settleOrder(await order(payer, 30_000), Date.now());
    const c = await pool().connect();
    try {
      assert.equal((await adminReferralInfo(c, referrer)).ambassadorPoints, 5_000);
      assert.equal((await adminReferralInfo(c, payer)).ambassadorPoints, 0);
    } finally {
      c.release();
    }
  });

  await t.test("user referral summary shows the ambassador total (the «Elchi dasturi» block)", async () => {
    const { referrer, payer } = await pair();
    const links = { botUsername: "slaydx_test_bot", appUrl: "https://slaydx.test" };
    assert.equal((await referralSummary(referrer, links)).ambassadorEarned, 0);
    await settleOrder(await order(payer, 20_000), Date.now());
    await settleOrder(await order(payer, 30_000), Date.now());
    const s = await referralSummary(referrer, links);
    assert.equal(s.ambassadorEarned, 5_000, "10 % of 50 000");
    assert.equal(s.ambassadorPercent, 10);
    assert.equal((await referralSummary(payer, links)).ambassadorEarned, 0, "the payer earned nothing");
  });
});
