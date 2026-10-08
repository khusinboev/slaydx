import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * First top-up bonus (docs/bonus/PLAN.md «Bonus 2», B2-Q1): the user's FIRST paid top-up order,
 * if it is ≥ 50 000 so'm, earns 10 % as bonus POINTS (≤ 20 000), once per user — paid inside the
 * settlement transaction (`settleOrder`) through the REAL Click and Payme webhook routes, on a
 * throwaway Postgres. Plus `firstTopupEligible` through the real `GET /api/users/me`.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - percent 10 → 11 (`FIRST_TOPUP_PERCENT`)             → «rules», «Payme 120 000»;
 *   - cap removed (`Math.min` dropped)                      → «rules», «Payme 300 000 → cap»;
 *   - minimum `<` → `<=` (50 000 earns nothing)             → «rules», «Click 50 000»;
 *   - first-only: prior-order query always empty           → «second top-up», «first < 50 000»;
 *   - refund clause dropped from the prior-order query      → «fully refunded first order»;
 *   - user lock in `firstTopupBonusDueInTx` removed         → «concurrent 10 000 ∥ 100 000»;
 *   - `credited &&` dropped from the pay condition          → none (order `paid` short-circuits retries
 *     before it; kept as defence in depth, documented);
 *   - savepoint catch removed (rethrow)                     → «duplicate reference race»;
 *   - bonus call moved outside the transaction (own `transaction`) → «concurrent first payments».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.PAYME_MERCHANT_ID = "merchant-1";
process.env.PAYME_KEY = "payme-live-key";
delete process.env.PAYME_TEST_KEY;
delete process.env.PAYME_SANDBOX;
process.env.CLICK_SERVICE_ID = "777";
process.env.CLICK_MERCHANT_ID = "42";
process.env.CLICK_SECRET_KEY = "click-secret-key";
const PAYME_KEY = "payme-live-key";
const CLICK_SECRET = "click-secret-key";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("topupbonus") : { isolated: false, drop: async () => {} };
const skip = hasDb ? false : "DATABASE_URL yo'q";

test("first top-up bonus rules (pure)", async () => {
  const r = await import("../lib/topup-bonus.ts");
  assert.equal(r.FIRST_TOPUP_MIN_SOUM, 50_000);
  assert.equal(r.firstTopupBonus(49_999), 0);
  assert.equal(r.firstTopupBonus(50_000), 5_000);
  assert.equal(r.firstTopupBonus(123_456), 12_345);
  assert.equal(r.firstTopupBonus(199_999), 19_999);
  assert.equal(r.firstTopupBonus(200_000), 20_000);
  assert.equal(r.firstTopupBonus(300_000), 20_000);
  assert.equal(r.firstTopupBonus(10_000_000), 20_000);
  assert.equal(r.firstTopupBonus(Number.NaN), 0);
  assert.equal(r.firstTopupRef("42"), "first-topup:42");
  assert.equal(r.FIRST_TOPUP_NOTE, "Birinchi to‘ldirish bonusi (10%)");
});

test("first top-up bonus: Click + Payme settlement", { skip }, async (t) => {
  const { query, queryOne, migrate, pool, transaction } = await import("../lib/server/db.ts");
  const { createOrder } = await import("../lib/server/payments.ts");
  const { firstTopupStatus, firstTopupEligible } = await import("../lib/server/topup-bonus.ts");
  const { FIRST_TOPUP_NOTE, firstTopupRef } = await import("../lib/topup-bonus.ts");
  const { adminAdjustWalletInTx } = await import("../lib/server/credits.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const payme = await import("../app/api/payments/payme/route.ts");
  const click = await import("../app/api/payments/click/route.ts");
  const me = await import("../app/api/users/me/route.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  // ───────────────────────── helpers

  const mkUser = async () =>
    String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`,
          [`tb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
        )
      )[0].id,
    );
  const wallet = async (uid: string) => {
    const r = (await query<{ points: string; balance: string }>(`SELECT points, balance FROM users WHERE id = $1`, [uid]))[0];
    return { points: Number(r.points), balance: Number(r.balance) };
  };
  const bonusRows = (uid: string) =>
    query<{ kind: string; points_delta: string; balance_delta: string; quota_delta: string; reference: string; note: string; user_id: string }>(
      `SELECT kind, points_delta, balance_delta, quota_delta, reference, note, user_id::text AS user_id
         FROM transactions WHERE reference = $1 ORDER BY id`,
      [firstTopupRef(uid)],
    );
  /** Wallet = ledger sum (every user starts at 0). */
  const assertLedger = async (uid: string) => {
    const s = (
      await query<{ p: string; b: string }>(
        `SELECT COALESCE(SUM(points_delta),0) p, COALESCE(SUM(balance_delta),0) b FROM transactions WHERE user_id = $1`,
        [uid],
      )
    )[0];
    assert.deepEqual(await wallet(uid), { points: Number(s.p), balance: Number(s.b) }, "wallet must equal the ledger sum");
  };
  const orderState = async (id: string) => (await queryOne<{ state: string }>(`SELECT state FROM payment_orders WHERE id = $1`, [id]))!.state;

  let rpcSeq = 1;
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const id = rpcSeq++;
    const res = await payme.POST(
      new Request("http://x/api/payments/payme", {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`Paycom:${PAYME_KEY}`).toString("base64")}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      }),
    );
    return (await res.json()) as { result?: Record<string, unknown>; error?: { code: number } };
  };
  /** Payme Create → Perform for a new top-up order. Returns the order id and the Perform call (for replays). */
  const paymePay = async (uid: string, amountSoum: number) => {
    const order = await createOrder({ userId: uid, provider: "payme", purpose: "topup", amountSoum });
    const txn = `pm-${order.id.slice(0, 13)}`;
    const amount = amountSoum * 100;
    const created = await rpc("CreateTransaction", { id: txn, time: Date.now(), amount, account: { order_id: order.id } });
    assert.equal(created.result?.state, 1, JSON.stringify(created));
    const perform = () => rpc("PerformTransaction", { id: txn });
    const done = await perform();
    assert.equal(done.result?.state, 2, JSON.stringify(done));
    return { id: order.id, perform };
  };

  let clickSeq = 700_000;
  const clickCall = async (p: Record<string, string>) => {
    const full: Record<string, string> = { service_id: "777", sign_time: "2026-10-08 10:00:00", error: "0", ...p };
    const sign = createHash("md5")
      .update(
        full.click_trans_id + full.service_id + CLICK_SECRET + full.merchant_trans_id +
          (full.action === "1" ? (full.merchant_prepare_id ?? "") : "") + full.amount + full.action + full.sign_time,
      )
      .digest("hex");
    const res = await click.POST(
      new Request("http://x/api/payments/click", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...full, sign_string: sign }).toString(),
      }),
    );
    return (await res.json()) as { error: number; error_note: string; merchant_prepare_id?: number };
  };
  /** Click Prepare for a new top-up order; `complete()` sends Complete (call again = provider replay). */
  const clickPrepare = async (uid: string, amountSoum: number) => {
    const order = await createOrder({ userId: uid, provider: "click", purpose: "topup", amountSoum });
    const base = { click_trans_id: String(clickSeq++), merchant_trans_id: order.id, amount: String(amountSoum) };
    const prep = await clickCall({ ...base, action: "0" });
    assert.equal(prep.error, 0, prep.error_note);
    const pid = String(prep.merchant_prepare_id);
    return {
      id: order.id,
      complete: (error = "0") => clickCall({ ...base, action: "1", merchant_prepare_id: pid, error }),
    };
  };
  const clickPay = async (uid: string, amountSoum: number) => {
    const o = await clickPrepare(uid, amountSoum);
    const done = await o.complete();
    assert.equal(done.error, 0, done.error_note);
    return o;
  };

  /** Holds the user row lock on a separate connection: every settlement of this user waits on it. */
  const holdUserLock = async (uid: string) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query("BEGIN");
    await c.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [uid]);
    return {
      waiters: async () =>
        Number(
          (
            await c.query<{ n: string }>(
              `SELECT count(*) n FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
            )
          ).rows[0].n,
        ),
      release: async () => {
        await c.query("COMMIT");
        await c.end();
      },
    };
  };
  const waitFor = async (cond: () => Promise<boolean>, ms = 3_000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await cond()) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  };

  const meEligible = async (uid: string) => {
    const { token } = await createSession(uid);
    const req = new Request("http://localhost/api/users/me", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    const res = await inRequest(req, () => me.GET(req));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { firstTopupEligible?: unknown; user?: unknown; transactions?: unknown };
    assert.ok(body.user && Array.isArray(body.transactions), "the existing /me shape stays");
    return body.firstTopupEligible;
  };

  // ───────────────────────── Click

  await t.test("Click: first top-up of exactly 50 000 → +5 000 points in the same settlement; ledger row shape", async () => {
    const uid = await mkUser();
    assert.equal(await meEligible(uid), true, "a new user is eligible");
    assert.deepEqual(await firstTopupStatus(uid), { paid: false, points: 0 });

    const o = await clickPay(uid, 50_000);
    assert.equal(await orderState(o.id), "paid");
    assert.deepEqual(await wallet(uid), { points: 5_000, balance: 50_000 }, "top-up to balance, bonus to points");
    const rows = await bonusRows(uid);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { ...rows[0], points_delta: Number(rows[0].points_delta), balance_delta: Number(rows[0].balance_delta), quota_delta: Number(rows[0].quota_delta) },
      { kind: "bonus", points_delta: 5_000, balance_delta: 0, quota_delta: 0, reference: `first-topup:${uid}`, note: FIRST_TOPUP_NOTE, user_id: uid },
    );
    assert.equal(FIRST_TOPUP_NOTE, "Birinchi to‘ldirish bonusi (10%)");
    assert.deepEqual(await firstTopupStatus(uid), { paid: true, points: 5_000 });
    assert.equal(await meEligible(uid), false, "no hint after the first paid top-up");

    // Click Complete replays (provider retries): no second bonus, no error.
    assert.equal((await o.complete()).error, 0);
    assert.equal((await o.complete()).error, 0);
    assert.equal((await bonusRows(uid)).length, 1);
    assert.deepEqual(await wallet(uid), { points: 5_000, balance: 50_000 });
    await assertLedger(uid);
  });

  await t.test("Click: second top-up earns nothing; only one bonus row ever", async () => {
    const uid = await mkUser();
    await clickPay(uid, 60_000);
    assert.deepEqual(await wallet(uid), { points: 6_000, balance: 60_000 });
    await clickPay(uid, 150_000);
    await paymePay(uid, 200_000);
    assert.deepEqual(await wallet(uid), { points: 6_000, balance: 410_000 }, "later top-ups earn no bonus");
    assert.equal((await bonusRows(uid)).length, 1);
    await assertLedger(uid);
  });

  await t.test("Click: first top-up below 50 000 → no bonus, and no later top-up earns it (chance used)", async () => {
    const uid = await mkUser();
    assert.equal(await firstTopupEligible(uid), true);
    await clickPay(uid, 49_999);
    assert.equal(await firstTopupEligible(uid), false);
    assert.deepEqual(await wallet(uid), { points: 0, balance: 49_999 });
    assert.equal(await meEligible(uid), false, "the first paid top-up was used — no hint");
    await clickPay(uid, 100_000);
    await paymePay(uid, 300_000);
    assert.deepEqual(await wallet(uid), { points: 0, balance: 449_999 });
    assert.equal((await bonusRows(uid)).length, 0);
    assert.deepEqual(await firstTopupStatus(uid), { paid: false, points: 0 });
    await assertLedger(uid);
  });

  // ───────────────────────── Payme

  await t.test("Payme: 120 000 → +12 000 (10 %); PerformTransaction replay pays once", async () => {
    const uid = await mkUser();
    const o = await paymePay(uid, 120_000);
    assert.deepEqual(await wallet(uid), { points: 12_000, balance: 120_000 });
    const again = await o.perform();
    assert.equal(again.result?.state, 2, "replayed Perform still answers state 2");
    await o.perform();
    assert.equal((await bonusRows(uid)).length, 1);
    assert.deepEqual(await wallet(uid), { points: 12_000, balance: 120_000 });
    await assertLedger(uid);
  });

  await t.test("Payme: 300 000 → the 20 000 cap", async () => {
    const uid = await mkUser();
    await paymePay(uid, 300_000);
    assert.deepEqual(await wallet(uid), { points: 20_000, balance: 300_000 });
    assert.deepEqual(await firstTopupStatus(uid), { paid: true, points: 20_000 });
    await assertLedger(uid);
  });

  // ───────────────────────── what does / does not count as «a paid top-up»

  await t.test("cancelled / pending orders, a legacy Pro order and admin credits do not use the first chance", async () => {
    const uid = await mkUser();
    // Cancelled on Click's side.
    const c1 = await clickPrepare(uid, 80_000);
    assert.equal((await c1.complete("-5017")).error, -9);
    assert.equal(await orderState(c1.id), "cancelled");
    // Pending (prepared, never completed) and created.
    await clickPrepare(uid, 90_000);
    await createOrder({ userId: uid, provider: "payme", purpose: "topup", amountSoum: 70_000 });
    // Legacy Pro order paid (subscriptions removed): not a top-up.
    const pro = (
      await query<{ id: string }>(
        `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum) VALUES (gen_random_uuid(), $1, 'payme', 'pro', 30000) RETURNING id::text AS id`,
        [uid],
      )
    )[0].id;
    assert.equal((await rpc("CreateTransaction", { id: `pm-pro-${pro.slice(0, 8)}`, time: Date.now(), amount: 3_000_000, account: { order_id: pro } })).result?.state, 1);
    assert.equal((await rpc("PerformTransaction", { id: `pm-pro-${pro.slice(0, 8)}` })).result?.state, 2);
    // Admin manual credit.
    await transaction((c) => adminAdjustWalletInTx(c, { userId: uid, wallet: "balance", delta: 100_000, reference: `admin:${randomUUID()}`, note: "Ma'muriy tuzatish" }));
    assert.equal(await meEligible(uid), true, "still eligible");

    await paymePay(uid, 100_000);
    assert.deepEqual(await wallet(uid), { points: 10_000, balance: 230_000 });
    await assertLedger(uid);
  });

  await t.test("a fully refunded first order does not count; a partially refunded one does", async () => {
    const full = await mkUser();
    const f1 = await clickPay(full, 10_000);
    await query(`INSERT INTO payment_refunds (order_id, amount_soum, kind, reason) VALUES ($1, 10000, 'refund', 'test')`, [f1.id]);
    assert.equal(await meEligible(full), true);
    await clickPay(full, 100_000);
    assert.equal((await wallet(full)).points, 10_000, "the refunded order was not a paid top-up");

    const part = await mkUser();
    const p1 = await clickPay(part, 10_000);
    await query(`INSERT INTO payment_refunds (order_id, amount_soum, kind, reason) VALUES ($1, 9999, 'refund', 'test')`, [p1.id]);
    assert.equal(await meEligible(part), false);
    await clickPay(part, 100_000);
    assert.equal((await wallet(part)).points, 0, "a partial refund keeps the order a paid top-up");
  });

  await t.test("a later refund with clawback does not take the bonus back (documented)", async () => {
    const uid = await mkUser();
    const o = await clickPay(uid, 100_000);
    assert.deepEqual(await wallet(uid), { points: 10_000, balance: 100_000 });
    // What the admin external-refund clawback writes (`admin-order-refund.ts`): an `admin_debit` of the order's own credit from balance.
    await transaction(async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO payment_refunds (order_id, amount_soum, kind, reason, clawback_wallet) VALUES ($1, 100000, 'refund', 'test', 'balance') RETURNING id::text AS id`,
        [o.id],
      );
      const d = await adminAdjustWalletInTx(c, { userId: uid, wallet: "balance", delta: -100_000, reference: `refund:${r.rows[0].id}`, note: "Ma'muriy tuzatish" });
      assert.ok(d.ok);
    });
    assert.deepEqual(await wallet(uid), { points: 10_000, balance: 0 }, "bonus points stay");
    // The bonus is once per user: the refunded order no longer counts, but the next top-up finds the bonus row.
    assert.equal(await meEligible(uid), false, "the bonus row keeps the hint off");
    await clickPay(uid, 100_000);
    assert.deepEqual(await wallet(uid), { points: 10_000, balance: 100_000 }, "no second bonus");
    assert.equal((await bonusRows(uid)).length, 1);
    await assertLedger(uid);
  });

  // ───────────────────────── concurrency / idempotency

  await t.test("concurrent first payments of two orders (Click ∥ Payme) → one bonus", async () => {
    const uid = await mkUser();
    const a = await clickPrepare(uid, 100_000);
    const order = await createOrder({ userId: uid, provider: "payme", purpose: "topup", amountSoum: 200_000 });
    const txn = `pm-cc-${order.id.slice(0, 8)}`;
    assert.equal((await rpc("CreateTransaction", { id: txn, time: Date.now(), amount: 20_000_000, account: { order_id: order.id } })).result?.state, 1);

    const lock = await holdUserLock(uid);
    const ra = a.complete();
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 1));
    const rb = rpc("PerformTransaction", { id: txn });
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 2));
    await lock.release();
    const [ca, pb] = await Promise.all([ra, rb]);
    assert.equal(ca.error, 0, ca.error_note);
    assert.equal(pb.result?.state, 2);

    const rows = await bonusRows(uid);
    assert.equal(rows.length, 1, "exactly one bonus");
    // Lock waiters are served in arrival order: the Click order settled first and is the first top-up.
    assert.equal(Number(rows[0].points_delta), 10_000);
    assert.deepEqual(await wallet(uid), { points: 10_000, balance: 300_000 });
    await assertLedger(uid);
  });

  await t.test("concurrent 10 000 ∥ 100 000: the first settled (< 50 000) uses the chance → no bonus", async () => {
    const uid = await mkUser();
    const small = await clickPrepare(uid, 10_000);
    const big = await clickPrepare(uid, 100_000);
    const lock = await holdUserLock(uid);
    const ra = small.complete();
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 1));
    const rb = big.complete();
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 2));
    await lock.release();
    const [x, y] = await Promise.all([ra, rb]);
    assert.equal(x.error, 0, x.error_note);
    assert.equal(y.error, 0, y.error_note);
    assert.deepEqual(await wallet(uid), { points: 0, balance: 110_000 }, "the 100 000 order was second → no bonus");
    assert.equal((await bonusRows(uid)).length, 0);
    await assertLedger(uid);
  });

  await t.test("Click Complete ∥ Complete replay of the first order → one bonus", async () => {
    const uid = await mkUser();
    const o = await clickPrepare(uid, 80_000);
    const lock = await holdUserLock(uid);
    const r1 = o.complete();
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 1));
    const r2 = o.complete();
    await waitFor(async () => (await lock.waiters()) >= 2, 1_000);
    await lock.release();
    const [a, b] = await Promise.all([r1, r2]);
    assert.equal(a.error, 0, a.error_note);
    assert.equal(b.error, 0, b.error_note);
    assert.deepEqual(await wallet(uid), { points: 8_000, balance: 80_000 });
    assert.equal((await bonusRows(uid)).length, 1);
    await assertLedger(uid);
  });

  await t.test("duplicate reference race: the bonus rolls back alone, the top-up and `paid` stay", async () => {
    const uid = await mkUser();
    const other = await mkUser();
    const o = await clickPrepare(uid, 100_000);
    // Another writer holds an UNCOMMITTED row with the same (kind, reference) — on another user's
    // row, so it does not hold this user's row lock: our check cannot see it, our INSERT waits on
    // the unique index and gets 23505 when it commits.
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note) VALUES ($1, 'bonus', 0, 0, 0, $2, 'race')`,
      [other, firstTopupRef(uid)],
    );
    const waiters = async () =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*) n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
          )
        ).rows[0].n,
      );
    const done = o.complete();
    assert.ok(await waitFor(async () => (await waiters()) >= 1), "the settlement waits on the unique index");
    await c.query("COMMIT");
    await c.end();
    const r = await done;
    assert.equal(r.error, 0, r.error_note);
    assert.equal(await orderState(o.id), "paid");
    assert.deepEqual(await wallet(uid), { points: 0, balance: 100_000 }, "top-up kept, bonus not doubled");
    await assertLedger(uid);
  });
});
