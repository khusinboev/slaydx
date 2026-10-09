import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Click Shop API vs Click's `api-testing` tool (Prepare/Complete scenarios).
 *
 * The REAL route (`POST /api/payments/click`) runs against an isolated Postgres
 * database, so signature, service_id, order state machine, ledger and the payment
 * bonus are exercised together. One subtest per api-testing case:
 *
 *   -1 bad sign / wrong service_id      -2 amount mismatch        -3 unknown action
 *   -4 Prepare after paid               -5 unknown / Payme order  -6 Complete without
 *   Prepare, wrong prepare id, wrong click_trans_id               -9 cancelled
 *   repeated Complete credits (and pays the bonus) exactly once
 *
 * Mutation notes (each was broken on purpose, the named subtests went red, then reverted):
 *   - route back to the OLD guard (`order.providerTxn && …`, empty prepare id skipped)
 *       → «-6: Complete without Prepare», «-6: merchant_prepare_id is mandatory»;
 *   - `checkClickComplete`: a missing / empty `merchant_prepare_id` accepted
 *       → «pure rules», «-6: merchant_prepare_id is mandatory»;
 *   - `already_paid` no longer answered with -4 → «repeated Complete»;
 *   - `Access-Control-Allow-Origin: *` instead of the docs origin → «CORS».
 * (The "never Prepared" branch of `checkClickComplete` is also covered by the id and
 *  click_trans_id comparisons — defense in depth, so it has no mutation of its own.)
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
delete process.env.PAYME_TEST_KEY;
delete process.env.PAYME_SANDBOX;
process.env.PAYME_MERCHANT_ID = "merchant-1";
process.env.PAYME_KEY = "payme-live-key";
process.env.CLICK_SERVICE_ID = "777";
process.env.CLICK_MERCHANT_ID = "42";
process.env.CLICK_SECRET_KEY = "click-secret-key";

const CLICK_SECRET = "click-secret-key";
const SKIP = hasDb ? false : "DATABASE_URL yo'q";

// Must run BEFORE the first `test()` registers: node:test starts it at once, and any
// `lib/server/*` import captures `DATABASE_URL` at that moment.
const iso = hasDb ? await createIsolatedDb("clickshop") : { isolated: false, drop: async () => {} };

type ClickReply = {
  click_trans_id: number;
  merchant_trans_id: string;
  error: number;
  error_note: string;
  merchant_prepare_id?: number;
  merchant_confirm_id?: number;
};

test("checkClickComplete: pure rules", async () => {
  const { checkClickComplete } = await import("../lib/server/payments.ts");
  const prepared = { providerTxn: "5001", prepareId: 42 };
  assert.deepEqual(checkClickComplete(prepared, { click_trans_id: "5001", merchant_prepare_id: "42" }), { ok: true });

  // Never prepared: no txn / no prepare id → rejected whatever the request says.
  for (const o of [
    { providerTxn: null, prepareId: null },
    { providerTxn: "5001", prepareId: null },
    { providerTxn: null, prepareId: 42 },
  ]) {
    assert.equal(checkClickComplete(o, { click_trans_id: "5001", merchant_prepare_id: "42" }).ok, false);
  }
  // merchant_prepare_id: mandatory, integer, equal to the order's.
  for (const sent of [undefined, "", "  ", "43", "4x", "42.5", "-42", "0x2a"]) {
    assert.equal(
      checkClickComplete(prepared, { click_trans_id: "5001", merchant_prepare_id: sent }).ok,
      false,
      `merchant_prepare_id=${JSON.stringify(sent)} must be rejected`,
    );
  }
  assert.equal(checkClickComplete(prepared, { click_trans_id: "5001", merchant_prepare_id: "042" }).ok, true);
  // click_trans_id must be the Prepare's one.
  assert.equal(checkClickComplete(prepared, { click_trans_id: "5002", merchant_prepare_id: "42" }).ok, false);
  assert.equal(checkClickComplete(prepared, { merchant_prepare_id: "42" }).ok, false);
});

test("Click Shop API: api-testing scenarios", { skip: SKIP }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createOrder } = await import("../lib/server/payments.ts");
  const click = await import("../app/api/payments/click/route.ts");
  await migrate();

  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  // ───────────────────────── helpers

  let userSeq = 0;
  const mkOrder = async (provider: "click" | "payme" = "click", amountSoum = 10_000) => {
    const r = await query<{ id: string }>(
      `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`,
      [`ck-${Date.now()}-${++userSeq}`],
    );
    const uid = String(r[0].id);
    const order = await createOrder({ userId: uid, provider, purpose: "topup", amountSoum });
    return { uid, order };
  };
  const sign = (p: Record<string, string>, secret = CLICK_SECRET) =>
    createHash("md5")
      .update(
        (p.click_trans_id ?? "") +
          (p.service_id ?? "") +
          secret +
          (p.merchant_trans_id ?? "") +
          (p.action === "1" ? (p.merchant_prepare_id ?? "") : "") +
          (p.amount ?? "") +
          (p.action ?? "") +
          (p.sign_time ?? ""),
      )
      .digest("hex");
  /**
   * One signed Click request. Omit a field by passing `undefined`; the signature always
   * follows the request that is actually sent (so only the named defect is under test).
   */
  const call = async (
    p: Record<string, string | undefined>,
    opts: { badSign?: boolean; signSecret?: string } = {},
  ): Promise<ClickReply> => {
    const full: Record<string, string> = {};
    for (const [k, v] of Object.entries({ service_id: "777", sign_time: "2026-10-09 10:00:00", error: "0", ...p })) {
      if (v !== undefined) full[k] = v;
    }
    const sign_string = opts.badSign ? "0".repeat(32) : sign(full, opts.signSecret);
    const res = await click.POST(
      new Request("http://x/api/payments/click", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...full, sign_string }).toString(),
      }),
    );
    return (await res.json()) as ClickReply;
  };
  const prepare = async (base: Record<string, string>) => {
    const r = await call({ ...base, action: "0" });
    assert.equal(r.error, 0, r.error_note);
    assert.ok(Number.isSafeInteger(r.merchant_prepare_id), "merchant_prepare_id is an integer");
    return String(r.merchant_prepare_id);
  };
  const wallet = async (uid: string) =>
    (await query<{ points: string; balance: string }>(`SELECT points, balance FROM users WHERE id = $1`, [uid]))
      .map((r) => ({ points: Number(r.points), balance: Number(r.balance) }))[0];
  const txCount = async (uid: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) n FROM transactions WHERE user_id = $1`, [uid]))[0].n);
  const bonusCount = async (uid: string) =>
    Number(
      (await query<{ n: string }>(`SELECT count(*) n FROM transactions WHERE user_id = $1 AND kind = 'bonus'`, [uid]))[0].n,
    );
  const orderRow = async (id: string) =>
    (
      await query<{ state: string; provider_txn: string | null; prepare_id: string | null }>(
        `SELECT state, provider_txn, prepare_id FROM payment_orders WHERE id = $1`,
        [id],
      )
    )[0];
  /** Nothing was credited and no ledger row exists for the user. */
  const untouched = async (uid: string) => {
    assert.deepEqual(await wallet(uid), { points: 0, balance: 0 });
    assert.equal(await txCount(uid), 0, "no ledger row");
  };

  // ───────────────────────── happy path

  await t.test("Prepare → Complete: credited, fractional amount accepted, merchant ids are integers", async () => {
    const { uid, order } = await mkOrder();
    const base = { click_trans_id: "910001", merchant_trans_id: order.id, amount: "10000.00" };
    const pid = await prepare(base);
    const done = await call({ ...base, action: "1", merchant_prepare_id: pid });
    assert.equal(done.error, 0, done.error_note);
    assert.equal(done.merchant_confirm_id, Number(pid));
    assert.equal(done.merchant_prepare_id, Number(pid));
    assert.equal(done.click_trans_id, 910001);
    assert.equal(done.merchant_trans_id, order.id);
    assert.equal((await wallet(uid)).balance, 10_000);
    assert.equal((await orderRow(order.id)).state, "paid");
  });

  await t.test("Prepare retry with the same click_trans_id returns the same prepare id", async () => {
    const { order } = await mkOrder();
    const base = { click_trans_id: "910002", merchant_trans_id: order.id, amount: "10000" };
    const a = await prepare(base);
    const b = await prepare(base);
    assert.equal(a, b);
  });

  // ───────────────────────── -1

  await t.test("-1: bad sign_string (Prepare and Complete), wrong secret, wrong service_id", async () => {
    const { uid, order } = await mkOrder();
    const base = { click_trans_id: "910010", merchant_trans_id: order.id, amount: "10000" };
    assert.equal((await call({ ...base, action: "0" }, { badSign: true })).error, -1);
    assert.equal((await call({ ...base, action: "0" }, { signSecret: "not-the-secret" })).error, -1);
    assert.equal((await call({ ...base, action: "0", service_id: "778" })).error, -1, "wrong service_id");
    const pid = await prepare(base);
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: pid }, { badSign: true })).error, -1);
    // A Complete whose signature was computed WITHOUT the prepare id (Prepare formula) is rejected.
    const noPrepareInSign = await click.POST(
      new Request("http://x/api/payments/click", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...base,
          service_id: "777",
          sign_time: "2026-10-09 10:00:00",
          error: "0",
          action: "1",
          merchant_prepare_id: pid,
          sign_string: sign({ ...base, service_id: "777", sign_time: "2026-10-09 10:00:00", action: "0" }),
        }).toString(),
      }),
    );
    assert.equal(((await noPrepareInSign.json()) as ClickReply).error, -1);
    assert.equal((await orderRow(order.id)).state, "pending", "none of the rejected requests settled the order");
    assert.equal((await wallet(uid)).balance, 0);
  });

  // ───────────────────────── -2

  await t.test("-2: amount mismatch on Prepare and on Complete; nothing credited", async () => {
    const { uid, order } = await mkOrder();
    const base = { click_trans_id: "910020", merchant_trans_id: order.id, amount: "10000" };
    assert.equal((await call({ ...base, amount: "9999", action: "0" })).error, -2);
    assert.equal((await call({ ...base, amount: "10000.00", action: "0" })).error, 0, "Click's N.NN format is accepted");
    const pid = String((await orderRow(order.id)).prepare_id);
    assert.equal((await call({ ...base, amount: "10001", action: "1", merchant_prepare_id: pid })).error, -2);
    assert.equal((await call({ ...base, amount: "abc", action: "1", merchant_prepare_id: pid })).error, -2);
    assert.equal((await wallet(uid)).balance, 0);
    assert.equal((await orderRow(order.id)).state, "pending");
  });

  // ───────────────────────── -3

  await t.test("-3: unknown action", async () => {
    const { uid, order } = await mkOrder();
    const base = { click_trans_id: "910030", merchant_trans_id: order.id, amount: "10000" };
    for (const action of ["2", "-1", "x"]) {
      assert.equal((await call({ ...base, action })).error, -3, `action=${action}`);
    }
    await untouched(uid);
    assert.equal((await orderRow(order.id)).state, "created", "an unknown action does not Prepare the order");
  });

  // ───────────────────────── repeated Complete

  await t.test("repeated Complete: -4 «Already paid» each time, credited and bonus paid exactly once", async () => {
    const { uid, order } = await mkOrder("click", 100_000);
    const base = { click_trans_id: "910040", merchant_trans_id: order.id, amount: "100000" };
    const pid = await prepare(base);
    const first = await call({ ...base, action: "1", merchant_prepare_id: pid });
    assert.equal(first.error, 0, first.error_note);
    const afterFirst = await wallet(uid);
    assert.equal(afterFirst.balance, 100_000);
    assert.equal(afterFirst.points, 10_000, "10 % payment bonus");
    assert.equal(await bonusCount(uid), 1);

    for (let i = 0; i < 3; i++) {
      const again = await call({ ...base, action: "1", merchant_prepare_id: pid });
      assert.equal(again.error, -4, `repeat #${i + 1}: ${again.error_note}`);
    }
    assert.deepEqual(await wallet(uid), afterFirst, "wallet unchanged by repeats");
    assert.equal(await bonusCount(uid), 1, "the payment bonus is paid once");
    const topups = Number(
      (await query<{ n: string }>(`SELECT count(*) n FROM transactions WHERE user_id = $1 AND kind = 'topup'`, [uid]))[0].n,
    );
    assert.equal(topups, 1, "one top-up ledger row");
  });

  // ───────────────────────── -4

  await t.test("-4: Prepare after the order is paid", async () => {
    const { uid, order } = await mkOrder();
    const base = { click_trans_id: "910050", merchant_trans_id: order.id, amount: "10000" };
    const pid = await prepare(base);
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: pid })).error, 0);
    assert.equal((await call({ ...base, action: "0" })).error, -4);
    // Even a Prepare with another click_trans_id (a second payment attempt) is -4, not a new txn.
    assert.equal((await call({ ...base, click_trans_id: "910051", action: "0" })).error, -4);
    assert.equal((await wallet(uid)).balance, 10_000);
    assert.equal((await orderRow(order.id)).provider_txn, "910050");
  });

  // ───────────────────────── -5

  await t.test("-5: unknown order, malformed order id, Payme order", async () => {
    const { uid, order: pm } = await mkOrder("payme");
    const base = { click_trans_id: "910060", amount: "10000" };
    assert.equal(
      (await call({ ...base, merchant_trans_id: "00000000-0000-4000-8000-000000000000", action: "0" })).error,
      -5,
    );
    assert.equal((await call({ ...base, merchant_trans_id: "12345", action: "0" })).error, -5, "not a uuid");
    assert.equal(
      (await call({ ...base, merchant_trans_id: "00000000-0000-4000-8000-000000000000", action: "1", merchant_prepare_id: "1" }))
        .error,
      -5,
    );
    assert.equal((await call({ ...base, merchant_trans_id: pm.id, action: "0" })).error, -5, "Payme order via Click");
    assert.equal(
      (await call({ ...base, merchant_trans_id: pm.id, action: "1", merchant_prepare_id: "1" })).error,
      -5,
      "Payme order cannot be completed via Click",
    );
    await untouched(uid);
    assert.equal((await orderRow(pm.id)).provider_txn, null);
  });

  // ───────────────────────── -6

  await t.test("-6: Complete without Prepare credits nothing and the order can still be paid properly", async () => {
    const { uid, order } = await mkOrder("click", 50_000);
    const base = { click_trans_id: "910070", merchant_trans_id: order.id, amount: "50000" };
    // The api-testing tool sends some prepare id even though it never called Prepare.
    for (const pid of ["1", "12345", String(Math.floor(Math.random() * 1e6))]) {
      const r = await call({ ...base, action: "1", merchant_prepare_id: pid });
      assert.equal(r.error, -6, `prepare id ${pid}: ${r.error_note}`);
    }
    // ... and without any prepare id at all.
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: undefined })).error, -6);
    await untouched(uid);
    assert.equal(await bonusCount(uid), 0);
    const row = await orderRow(order.id);
    assert.equal(row.state, "created", "still unpaid");
    assert.equal(row.provider_txn, null);

    // The correct flow still works afterwards.
    const pid = await prepare(base);
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: pid })).error, 0);
    assert.equal((await wallet(uid)).balance, 50_000);
    assert.equal(await bonusCount(uid), 1);
  });

  await t.test("-6: merchant_prepare_id is mandatory on Complete (missing / empty)", async () => {
    const { uid, order } = await mkOrder();
    const base = { click_trans_id: "910080", merchant_trans_id: order.id, amount: "10000" };
    await prepare(base);
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: undefined })).error, -6, "missing");
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: "" })).error, -6, "empty");
    assert.equal((await orderRow(order.id)).state, "pending");
    await untouched(uid);
  });

  await t.test("-6: wrong prepare id (off by one, non-numeric, another order's) and wrong click_trans_id", async () => {
    const { uid, order } = await mkOrder();
    const { uid: otherUid, order: other } = await mkOrder();
    const base = { click_trans_id: "910090", merchant_trans_id: order.id, amount: "10000" };
    const otherBase = { click_trans_id: "910091", merchant_trans_id: other.id, amount: "10000" };
    const pid = await prepare(base);
    const otherPid = await prepare(otherBase);
    assert.notEqual(pid, otherPid);

    for (const bad of [String(Number(pid) + 1), String(Number(pid) - 1), "abc", "1.5", otherPid]) {
      const r = await call({ ...base, action: "1", merchant_prepare_id: bad });
      assert.equal(r.error, -6, `merchant_prepare_id=${bad}: ${r.error_note}`);
    }
    // Right prepare id but a different click_trans_id.
    assert.equal((await call({ ...base, click_trans_id: "999999", action: "1", merchant_prepare_id: pid })).error, -6);
    await untouched(uid);
    await untouched(otherUid);
    assert.equal((await orderRow(order.id)).state, "pending");

    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: pid })).error, 0);
    assert.equal((await wallet(uid)).balance, 10_000);
    await untouched(otherUid);
  });

  await t.test("-6 is audited in payment_events with the response code", async () => {
    const { order } = await mkOrder();
    const base = { click_trans_id: "910095", merchant_trans_id: order.id, amount: "10000" };
    await call({ ...base, action: "1", merchant_prepare_id: "7" });
    const rows = await query<{ method: string; response_code: number | null }>(
      `SELECT method, response_code FROM payment_events WHERE order_id = $1 ORDER BY id`,
      [order.id],
    );
    assert.deepEqual(rows.map((r) => [r.method, r.response_code]), [["complete", -6]]);
  });

  // ───────────────────────── Click error < 0 on Complete (-9) and cancelled orders

  await t.test("Complete with Click error<0 → -9 (order cancelled); a paid order stays paid → -4", async () => {
    const { uid, order } = await mkOrder();
    const base = { click_trans_id: "910100", merchant_trans_id: order.id, amount: "10000" };
    const pid = await prepare(base);
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: pid, error: "-5017" })).error, -9);
    assert.equal((await orderRow(order.id)).state, "cancelled");
    // A cancelled order cannot be completed later.
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: pid })).error, -9);
    await untouched(uid);

    const { uid: u2, order: o2 } = await mkOrder();
    const b2 = { click_trans_id: "910101", merchant_trans_id: o2.id, amount: "10000" };
    const p2 = await prepare(b2);
    assert.equal((await call({ ...b2, action: "1", merchant_prepare_id: p2 })).error, 0);
    assert.equal((await call({ ...b2, action: "1", merchant_prepare_id: p2, error: "-1" })).error, -4);
    assert.equal((await orderRow(o2.id)).state, "paid", "paid stays paid");
    assert.equal((await wallet(u2)).balance, 10_000);
    assert.equal(await bonusCount(u2), 1);
  });

  await t.test("Complete with Click error<0 for an order that was never Prepared is -9 (spec), state untouched", async () => {
    const { uid, order } = await mkOrder();
    const base = { click_trans_id: "910110", merchant_trans_id: order.id, amount: "10000" };
    // MUTATION: without the never-prepared guard this is -6 (review L1).
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: "5", error: "-5017" })).error, -9);
    assert.equal((await orderRow(order.id)).state, "created");
    await untouched(uid);
  });

  // ───────────────────────── CORS (Click playground runs in the browser on docs.click.uz)

  await t.test("CORS: only https://docs.click.uz is allowed (POST response + OPTIONS preflight)", async () => {
    const { order } = await mkOrder();
    const base = {
      click_trans_id: "910130",
      merchant_trans_id: order.id,
      amount: "10000",
      service_id: "777",
      sign_time: "2026-10-09 10:00:00",
      action: "0",
      error: "0",
    };
    const post = (origin?: string, badSign = false) =>
      click.POST(
        new Request("http://x/api/payments/click", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) },
          body: new URLSearchParams({ ...base, sign_string: badSign ? "0".repeat(32) : sign(base) }).toString(),
        }),
      );

    const docs = await post("https://docs.click.uz");
    assert.equal(docs.headers.get("access-control-allow-origin"), "https://docs.click.uz");
    assert.match(docs.headers.get("vary") ?? "", /Origin/i);
    assert.equal(((await docs.json()) as ClickReply).error, 0);

    // The error answers are readable by the playground too (signature is still enforced).
    const bad = await post("https://docs.click.uz", true);
    assert.equal(bad.headers.get("access-control-allow-origin"), "https://docs.click.uz");
    assert.equal(((await bad.json()) as ClickReply).error, -1);

    for (const origin of ["https://evil.example", "https://docs.click.uz.evil.example", "http://docs.click.uz", "https://click.uz", undefined]) {
      const r = await post(origin);
      assert.equal(r.headers.get("access-control-allow-origin"), null, `origin ${origin} gets no CORS header`);
      assert.match(r.headers.get("vary") ?? "", /Origin/i);
    }

    const preflight = (origin?: string) =>
      click.OPTIONS(
        new Request("http://x/api/payments/click", {
          method: "OPTIONS",
          headers: {
            ...(origin ? { origin } : {}),
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
          },
        }),
      );
    const ok = await preflight("https://docs.click.uz");
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://docs.click.uz");
    assert.equal(ok.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assert.equal(ok.headers.get("access-control-allow-headers"), "Content-Type");
    assert.match(ok.headers.get("vary") ?? "", /Origin/i);
    for (const origin of ["https://evil.example", undefined]) {
      const no = await preflight(origin);
      assert.equal(no.headers.get("access-control-allow-origin"), null);
      assert.equal(no.headers.get("access-control-allow-methods"), null);
    }
  });

  await t.test("Prepare on a cancelled order → -9", async () => {
    const { uid, order } = await mkOrder();
    const base = { click_trans_id: "910120", merchant_trans_id: order.id, amount: "10000" };
    const pid = await prepare(base);
    assert.equal((await call({ ...base, action: "1", merchant_prepare_id: pid, error: "-1" })).error, -9);
    assert.equal((await call({ ...base, action: "0" })).error, -9);
    assert.equal((await call({ ...base, click_trans_id: "910121", action: "0" })).error, -9);
    await untouched(uid);
  });
});
