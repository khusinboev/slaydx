import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Payment bonus (C-Q4, docs/bonus/BONUS3.md): EVERY paid top-up of ANY amount earns N % of it as
 * bonus POINTS (N = setting `payment_bonus_percent`, 0–50, default 10, 0 = off), no cap — paid
 * inside the settlement transaction (`settleOrder`) through the REAL Click and Payme webhook
 * routes, on a throwaway Postgres. Replaces the Bonus 2 «first top-up only» rule (this file was
 * `topup-bonus.test.mts`; its first-only / ≥ 50 000 / ≤ 20 000 cases are gone with the rule).
 * Plus the service (`setPaymentBonusPercent`: permission, bounds, reason, audit) and
 * `GET /api/users/me` `paymentBonusPercent`.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - percent math `* percent / 100` → `* percent / 1000`           → «rules», «Click 1 000 / 50 000 / 1 000 000»;
 *   - `Math.floor` → `Math.ceil`                                       → «rules» (1 999 → 199), «Payme 12 345»;
 *   - `paymentBonusRef` → `payment-bonus:<userId>` (not per order)     → «second / third top-up each earn»;
 *   - setting bound 50 → 51 (`PAYMENT_BONUS_MAX`)                      → «rules», «service: bounds»;
 *   - permission check removed from `setPaymentBonusPercent`         → «service: permission»;
 *   - `getSettingInTx` → cached `getSetting` in `payPaymentBonusInTx`  → «another process's change applies at once»;
 *   - `if (credited)` guard removed                                    → «the top-up is not credited»;
 *   - savepoint catch removed (rethrow)                                → «duplicate reference race».
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
const iso = hasDb ? await createIsolatedDb("paybonus") : { isolated: false, drop: async () => {} };
const skip = hasDb ? false : "DATABASE_URL yo'q";

test("payment bonus rules (pure)", async () => {
  const r = await import("../lib/payment-bonus.ts");
  assert.deepEqual([r.PAYMENT_BONUS_MIN, r.PAYMENT_BONUS_MAX, r.PAYMENT_BONUS_DEFAULT, r.PAYMENT_BONUS_KEY], [0, 50, 10, "payment_bonus_percent"]);
  assert.equal(r.paymentBonusPoints(1_000, 10), 100);
  assert.equal(r.paymentBonusPoints(50_000, 10), 5_000);
  assert.equal(r.paymentBonusPoints(1_000_000, 10), 100_000, "no cap");
  assert.equal(r.paymentBonusPoints(1_999, 10), 199, "floor");
  assert.equal(r.paymentBonusPoints(9, 10), 0);
  assert.equal(r.paymentBonusPoints(10_000, 50), 5_000);
  assert.equal(r.paymentBonusPoints(10_000, 51), 0, "never above the setting's bound");
  assert.equal(r.paymentBonusPoints(10_000, 0), 0);
  assert.equal(r.paymentBonusPoints(10_000, -5), 0);
  assert.equal(r.paymentBonusPoints(10_000, 2.5), 0);
  assert.equal(r.paymentBonusPoints(0, 10), 0);
  assert.equal(r.paymentBonusPoints(-1_000, 10), 0);
  assert.equal(r.paymentBonusPoints(Number.NaN, 10), 0);
  assert.equal(r.paymentBonusPoints(1_000.5, 10), 0);
  assert.equal(r.paymentBonusRef("o-1"), "payment-bonus:o-1");
  assert.equal(r.paymentBonusNote(10), "To‘lov bonusi (10%)");
  assert.equal(r.paymentBonusHint(15), "Har bir to‘ldirishga +15% bonus");
  for (const ok of [0, 1, 10, 50]) assert.equal(r.isPaymentBonusPercent(ok), true, String(ok));
  for (const bad of [-1, 51, 2.5, "10", null, Number.NaN]) assert.equal(r.isPaymentBonusPercent(bad), false, String(bad));
  const s = await import("../lib/server/settings.ts");
  assert.equal(s.settingDef("payment_bonus_percent").envDefault(), 10);
  assert.equal(s.validateSetting("payment_bonus_percent", 50).ok, true);
  assert.equal(s.validateSetting("payment_bonus_percent", 0).ok, true);
  for (const bad of [51, -1, 2.5, "10", null, true]) assert.equal(s.validateSetting("payment_bonus_percent", bad).ok, false, String(bad));
});

test("payment bonus: Click + Payme settlement, service, /me", { skip }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { createOrder, settleOrder } = await import("../lib/server/payments.ts");
  const pb = await import("../lib/server/payment-bonus.ts");
  const { paymentBonusRef } = await import("../lib/payment-bonus.ts");
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
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

  let userSeq = 0;
  const mkUser = async () =>
    String(
      (
        await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`, [
          `pb-${Date.now()}-${++userSeq}`,
        ])
      )[0].id,
    );
  const mkAdmin = async (role: string) => {
    const userId = await mkUser();
    const a = await queryOne<{ id: string }>("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, $2, 'active') RETURNING id::text AS id", [userId, role]);
    return { id: a!.id, userId, role, ip: null, userAgent: "test", requestId: null };
  };
  const owner = await mkAdmin("owner");
  const REASON = "Aksiya uchun foizni o'zgartirish";
  const setPercent = (n: number) => pb.setPaymentBonusPercent(owner, n, REASON);
  const resetPercent = async () => {
    await query("DELETE FROM app_settings WHERE key = 'payment_bonus_percent'");
    invalidateSettingsCache();
  };

  const wallet = async (uid: string) => {
    const r = (await query<{ points: string; balance: string }>(`SELECT points, balance FROM users WHERE id = $1`, [uid]))[0];
    return { points: Number(r.points), balance: Number(r.balance) };
  };
  const bonusRows = (uid: string) =>
    query<{ kind: string; points_delta: string; balance_delta: string; quota_delta: string; reference: string; note: string }>(
      `SELECT kind, points_delta, balance_delta, quota_delta, reference, note FROM transactions
        WHERE user_id = $1 AND kind = 'bonus' ORDER BY id`,
      [uid],
    );
  /** Wallet = ledger sum (every user starts at 0). */
  const assertLedger = async (uid: string) => {
    const s = (
      await query<{ p: string; b: string }>(`SELECT COALESCE(SUM(points_delta),0) p, COALESCE(SUM(balance_delta),0) b FROM transactions WHERE user_id = $1`, [uid])
    )[0];
    assert.deepEqual(await wallet(uid), { points: Number(s.p), balance: Number(s.b) }, "wallet must equal the ledger sum");
  };
  /** A `topup` order row without `createOrder`'s amount bounds (settled with `settleOrder`). */
  const rawOrder = async (uid: string, amountSoum: number) =>
    (
      await query<{ id: string }>(
        `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum) VALUES (gen_random_uuid(), $1, 'click', 'topup', $2) RETURNING id::text AS id`,
        [uid, amountSoum],
      )
    )[0];
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
  /** Payme Create (+ Perform unless `performNow` is false). */
  const paymeCreate = async (uid: string, amountSoum: number) => {
    const order = await createOrder({ userId: uid, provider: "payme", purpose: "topup", amountSoum });
    const txn = `pm-${order.id.slice(0, 13)}`;
    const created = await rpc("CreateTransaction", { id: txn, time: Date.now(), amount: amountSoum * 100, account: { order_id: order.id } });
    assert.equal(created.result?.state, 1, JSON.stringify(created));
    return { id: order.id, perform: () => rpc("PerformTransaction", { id: txn }) };
  };
  const paymePay = async (uid: string, amountSoum: number) => {
    const o = await paymeCreate(uid, amountSoum);
    const done = await o.perform();
    assert.equal(done.result?.state, 2, JSON.stringify(done));
    return o;
  };

  let clickSeq = 800_000;
  const clickCall = async (p: Record<string, string>) => {
    const full: Record<string, string> = { service_id: "777", sign_time: "2026-10-09 10:00:00", error: "0", ...p };
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
  const clickPrepare = async (uid: string, amountSoum: number) => {
    const order = await createOrder({ userId: uid, provider: "click", purpose: "topup", amountSoum });
    const base = { click_trans_id: String(clickSeq++), merchant_trans_id: order.id, amount: String(amountSoum) };
    const prep = await clickCall({ ...base, action: "0" });
    assert.equal(prep.error, 0, prep.error_note);
    const pid = String(prep.merchant_prepare_id);
    return { id: order.id, txn: base.click_trans_id, complete: (error = "0") => clickCall({ ...base, action: "1", merchant_prepare_id: pid, error }) };
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
              `SELECT count(*) n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
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
  const mePercent = async (uid: string) => {
    const { token } = await createSession(uid);
    const req = new Request("http://localhost/api/users/me", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    const res = await inRequest(req, () => me.GET(req));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { paymentBonusPercent?: unknown; firstTopupEligible?: unknown; user?: unknown; transactions?: unknown };
    assert.ok(body.user && Array.isArray(body.transactions), "the existing /me shape stays");
    assert.equal(body.firstTopupEligible, undefined, "the first top-up field is gone");
    return body.paymentBonusPercent;
  };

  // ───────────────────────── any amount, default 10 %

  await t.test("1 000 / 50 000 / 1 000 000 at the default 10 % → +100 / +5 000 / +100 000; row shape; /me says 10", async () => {
    await resetPercent();
    const uid = await mkUser();
    assert.equal(await mePercent(uid), 10);
    // 1 000 is below `createOrder`'s 5 000 minimum: an order row settled by `settleOrder` itself (the rule has no minimum).
    const a = await rawOrder(uid, 1_000);
    assert.equal((await settleOrder(a.id, Date.now())).status, "paid");
    const b = await clickPay(uid, 50_000);
    const c = await clickPay(uid, 1_000_000);
    assert.deepEqual(await wallet(uid), { points: 105_100, balance: 1_051_000 }, "top-ups to balance, bonus to points, no cap");
    const rows = await bonusRows(uid);
    assert.deepEqual(
      rows.map((r) => ({ ...r, points_delta: Number(r.points_delta), balance_delta: Number(r.balance_delta), quota_delta: Number(r.quota_delta) })),
      [
        { kind: "bonus", points_delta: 100, balance_delta: 0, quota_delta: 0, reference: `payment-bonus:${a.id}`, note: "To‘lov bonusi (10%)" },
        { kind: "bonus", points_delta: 5_000, balance_delta: 0, quota_delta: 0, reference: `payment-bonus:${b.id}`, note: "To‘lov bonusi (10%)" },
        { kind: "bonus", points_delta: 100_000, balance_delta: 0, quota_delta: 0, reference: `payment-bonus:${c.id}`, note: "To‘lov bonusi (10%)" },
      ],
    );
    // Click Complete replays (provider retries) answer -4 «Already paid», and a direct re-settle: nothing more.
    assert.equal((await c.complete()).error, -4);
    assert.equal((await c.complete()).error, -4);
    assert.equal((await settleOrder(a.id, Date.now())).status, "already_paid");
    assert.equal((await bonusRows(uid)).length, 3);
    await assertLedger(uid);
  });

  await t.test("Payme 12 345 → +1 234 (floor); PerformTransaction replay pays once; second / third top-up each earn", async () => {
    await resetPercent();
    const uid = await mkUser();
    const o = await paymePay(uid, 12_345);
    assert.deepEqual(await wallet(uid), { points: 1_234, balance: 12_345 });
    assert.equal((await o.perform()).result?.state, 2, "replayed Perform still answers state 2");
    await o.perform();
    assert.deepEqual(await wallet(uid), { points: 1_234, balance: 12_345 });
    await paymePay(uid, 20_000);
    await clickPay(uid, 30_000);
    assert.deepEqual(await wallet(uid), { points: 1_234 + 2_000 + 3_000, balance: 62_345 }, "every paid top-up earns");
    assert.equal((await bonusRows(uid)).length, 3);
    await assertLedger(uid);
  });

  await t.test("tiny amount (9 so'm) earns 0 → no bonus row; a legacy Pro order earns nothing", async () => {
    await resetPercent();
    const uid = await mkUser();
    assert.equal((await settleOrder((await rawOrder(uid, 9)).id, Date.now())).status, "paid");
    const pro = (
      await query<{ id: string }>(
        `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum) VALUES (gen_random_uuid(), $1, 'payme', 'pro', 30000) RETURNING id::text AS id`,
        [uid],
      )
    )[0].id;
    assert.equal((await rpc("CreateTransaction", { id: `pm-pro-${pro.slice(0, 8)}`, time: Date.now(), amount: 3_000_000, account: { order_id: pro } })).result?.state, 1);
    assert.equal((await rpc("PerformTransaction", { id: `pm-pro-${pro.slice(0, 8)}` })).result?.state, 2);
    assert.deepEqual(await wallet(uid), { points: 0, balance: 30_009 });
    assert.equal((await bonusRows(uid)).length, 0);
    await assertLedger(uid);
  });

  // ───────────────────────── the setting

  await t.test("0 % pays nothing (and /me says 0); a change applies to LATER settlements only — an order created at 10 % and settled at 20 % gets 20 %", async () => {
    await resetPercent();
    const uid = await mkUser();
    const early = await clickPay(uid, 100_000); // 10 %
    const pending = await clickPrepare(uid, 100_000); // created now, settled later
    assert.equal(await setPercent(0), 0);
    assert.equal(await mePercent(uid), 0);
    await clickPay(uid, 100_000);
    assert.deepEqual(await wallet(uid), { points: 10_000, balance: 200_000 }, "0 % → nothing");
    assert.equal(await setPercent(20), 20);
    assert.equal((await pending.complete()).error, 0);
    await paymePay(uid, 50_000);
    const rows = await bonusRows(uid);
    assert.deepEqual(
      rows.map((r) => [Number(r.points_delta), r.note]),
      [
        [10_000, "To‘lov bonusi (10%)"],
        [20_000, "To‘lov bonusi (20%)"],
        [10_000, "To‘lov bonusi (20%)"],
      ],
      "the percent in force at settlement; the early row keeps its 10 %",
    );
    assert.equal(rows[0].reference, paymentBonusRef(early.id));
    // A replay of the early order after the change pays nothing new.
    assert.equal((await early.complete()).error, -4);
    assert.equal((await bonusRows(uid)).length, 3);
    await assertLedger(uid);
    await resetPercent();
  });

  await t.test("another process's change applies to the next settlement at once (read in the transaction, not the 15 s cache)", async () => {
    await resetPercent();
    const uid = await mkUser();
    assert.equal(await pb.getPaymentBonusPercent(), 10, "warms this process's cache at 10");
    // Another process (admin web) writes 30 — this process's cache is NOT invalidated.
    await query(`INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('payment_bonus_percent', '30'::jsonb, $1, now())`, [owner.id]);
    assert.equal(await pb.getPaymentBonusPercent(), 10, "the display value may lag up to 15 s");
    await clickPay(uid, 10_000);
    assert.deepEqual(await wallet(uid), { points: 3_000, balance: 10_000 }, "the settlement used 30 %");
    await resetPercent();
  });

  await t.test("service: bounds / type / reason validated (400), nothing written; audit row per change", async () => {
    await resetPercent();
    for (const bad of [51, -1, 2.5, "10", null, 1e9]) {
      await assert.rejects(pb.setPaymentBonusPercent(owner, bad, REASON), (e: { status?: number }) => e.status === 400, String(bad));
    }
    await assert.rejects(pb.setPaymentBonusPercent(owner, 15, "abc"), (e: { status?: number }) => e.status === 400, "short reason");
    assert.equal((await query("SELECT 1 FROM app_settings WHERE key = 'payment_bonus_percent'")).length, 0);
    assert.equal(await pb.setPaymentBonusPercent(owner, 50, REASON), 50);
    assert.equal(await pb.setPaymentBonusPercent(owner, 0, REASON), 0);
    const audits = await query<{ action: string; target_id: string; reason: string; before: unknown; after: unknown; outcome: string }>(
      `SELECT action, target_id, reason, before, after, outcome FROM admin_audit_log WHERE admin_id = $1 AND target_id = 'payment_bonus_percent' ORDER BY id`,
      [owner.id],
    );
    assert.deepEqual(audits.slice(-2), [
      { action: "settings.update", target_id: "payment_bonus_percent", reason: REASON, before: { value: 10, source: "default" }, after: { value: 50, source: "db" }, outcome: "ok" },
      { action: "settings.update", target_id: "payment_bonus_percent", reason: REASON, before: { value: 50, source: "db" }, after: { value: 0, source: "db" }, outcome: "ok" },
    ]);
    await resetPercent();
  });

  await t.test("service: permission settings.edit — finance / viewer / support refused (403), nothing written", async () => {
    await resetPercent();
    for (const role of ["finance", "viewer", "support", "moderator", "nonsense"]) {
      const a = await mkAdmin(role === "nonsense" ? "viewer" : role);
      const actor = { ...a, role };
      await assert.rejects(pb.setPaymentBonusPercent(actor, 20, REASON), (e: { status?: number }) => e.status === 403, role);
    }
    assert.equal((await query("SELECT 1 FROM app_settings WHERE key = 'payment_bonus_percent'")).length, 0);
    const admin = await mkAdmin("admin");
    assert.equal(await pb.setPaymentBonusPercent(admin, 12, REASON), 12, "admin role may");
    await resetPercent();
  });

  // ───────────────────────── concurrency / idempotency

  await t.test("concurrent payments of two orders (Click ∥ Payme) → each earns its own bonus once", async () => {
    await resetPercent();
    const uid = await mkUser();
    const a = await clickPrepare(uid, 100_000);
    const p = await paymeCreate(uid, 200_000);
    const lock = await holdUserLock(uid);
    const ra = a.complete();
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 1));
    const rb = p.perform();
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 2));
    await lock.release();
    const [ca, pbr] = await Promise.all([ra, rb]);
    assert.equal(ca.error, 0, ca.error_note);
    assert.equal(pbr.result?.state, 2);
    assert.deepEqual((await bonusRows(uid)).map((r) => [r.reference, Number(r.points_delta)]).sort(), [
      [paymentBonusRef(a.id), 10_000],
      [paymentBonusRef(p.id), 20_000],
    ].sort());
    assert.deepEqual(await wallet(uid), { points: 30_000, balance: 300_000 });
    await assertLedger(uid);
  });

  await t.test("Click Complete ∥ Complete replay of one order → one bonus", async () => {
    await resetPercent();
    const uid = await mkUser();
    const o = await clickPrepare(uid, 80_000);
    const lock = await holdUserLock(uid);
    const r1 = o.complete();
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 1));
    const r2 = o.complete();
    await waitFor(async () => (await lock.waiters()) >= 2, 1_000);
    await lock.release();
    const [x, y] = await Promise.all([r1, r2]);
    assert.deepEqual([x.error, y.error].sort(), [-4, 0], `one pays, the replay is -4: ${x.error_note} / ${y.error_note}`);
    assert.deepEqual(await wallet(uid), { points: 8_000, balance: 80_000 });
    assert.equal((await bonusRows(uid)).length, 1);
    await assertLedger(uid);
  });

  await t.test("the top-up is not credited (its reference is already in the ledger) → no bonus either", async () => {
    await resetPercent();
    const uid = await mkUser();
    const o = await clickPrepare(uid, 100_000);
    await query(
      `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note) VALUES ($1, 'topup', 0, 0, 0, $2, 'pre-existing')`,
      [uid, `click:${o.txn}`],
    );
    assert.equal((await o.complete()).error, 0);
    assert.equal(await orderState(o.id), "paid");
    assert.deepEqual(await wallet(uid), { points: 0, balance: 0 });
    assert.equal((await bonusRows(uid)).length, 0);
  });

  await t.test("duplicate reference race: the bonus rolls back alone, the top-up and `paid` stay", async () => {
    await resetPercent();
    const uid = await mkUser();
    const other = await mkUser();
    const o = await clickPrepare(uid, 100_000);
    // Another writer holds an UNCOMMITTED row with the same (kind, reference) on another user's row:
    // our check cannot see it, our INSERT waits on the unique index and gets 23505 when it commits.
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note) VALUES ($1, 'bonus', 0, 0, 0, $2, 'race')`,
      [other, paymentBonusRef(o.id)],
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

  await t.test("legacy first top-up rows stay and count in the earned total", async () => {
    await resetPercent();
    const uid = await mkUser();
    const { topUp } = await import("../lib/server/credits.ts");
    const { firstTopupRef } = await import("../lib/topup-bonus.ts");
    assert.equal(await topUp(uid, { points: 5_000 }, firstTopupRef(uid), "bonus", "Birinchi to‘ldirish bonusi (10%)"), true);
    await clickPay(uid, 30_000);
    assert.equal(await pb.paymentBonusEarned(uid), 8_000);
  });
});
