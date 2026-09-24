import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * To'lov buyurtmasi holat mashinasi va webhook dispetcheri (AUDIT prod-readiness
 * C30: TEST-01, CONC-02, DB-09, BEA-05, OBS-09).
 *
 * HAQIQIY route'lar (`POST /api/payments/payme`, `POST /api/payments/click`)
 * alohida Postgres bazaga qarshi chaqiriladi — ya'ni imzo/kalit, JSON-RPC
 * dispetcheri, holat o'tishlari va pul jurnali birga sinaladi.
 *
 * Asosiy invariantlar:
 *   • hamyon = jurnal yig'indisi (`balance == SUM(balance_delta)` va h.k.);
 *   • `cancelled` buyurtmaga hech qachon kredit yozuvi bog'lanmaydi;
 *   • takroriy yetkazish (retry) pul qo'shmaydi va xato qaytarmaydi.
 *
 * Payme spetsifikatsiyasi: developer.help.paycom.uz «Merchant API»
 * (metodlar, xato kodlari, 12 soatlik timeout = 43 200 000 ms).
 * Click: SHOP-API (Prepare/Complete, xato kodlari -1…-9).
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

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
const H13 = 13 * 3600_000;

const iso = hasDb ? await createIsolatedDb("payments") : { isolated: false, drop: async () => {} };

type RpcReply = {
  id: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; data?: unknown; message: unknown };
};
type ClickReply = { error: number; error_note: string; merchant_prepare_id?: number; merchant_confirm_id?: number };

test("to'lov buyurtmalari: Payme JSON-RPC + Click holat mashinasi", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createOrder } = await import("../lib/server/payments.ts");
  const payme = await import("../app/api/payments/payme/route.ts");
  const click = await import("../app/api/payments/click/route.ts");
  await migrate();

  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  // ───────────────────────── yordamchilar

  const mkUser = async () => {
    const name = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await query<{ id: string }>(
      `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`,
      [name],
    );
    return String(r[0].id);
  };
  const mkOrder = async (provider: "payme" | "click", amountSoum = 10_000, purpose: "topup" | "pro" = "topup") => {
    const uid = await mkUser();
    const order = await createOrder({ userId: uid, provider, purpose, amountSoum });
    return { uid, order };
  };
  let rpcSeq = 1;
  const rpc = async (method: string, params: Record<string, unknown>, auth = PAYME_KEY): Promise<RpcReply> => {
    const id = rpcSeq++;
    const res = await payme.POST(
      new Request("http://x/api/payments/payme", {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`Paycom:${auth}`).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      }),
    );
    const body = (await res.json()) as RpcReply;
    assert.equal(body.id, id, "javob so'rov id sini qaytaradi");
    return body;
  };
  const clickSign = (p: Record<string, string>) =>
    createHash("md5")
      .update(
        p.click_trans_id +
          p.service_id +
          CLICK_SECRET +
          p.merchant_trans_id +
          (p.action === "1" ? (p.merchant_prepare_id ?? "") : "") +
          p.amount +
          p.action +
          p.sign_time,
      )
      .digest("hex");
  const clickCall = async (p: Record<string, string>, opts: { badSign?: boolean } = {}): Promise<ClickReply> => {
    const full = { service_id: "777", sign_time: "2026-09-24 10:00:00", error: "0", ...p };
    const form = new URLSearchParams({ ...full, sign_string: opts.badSign ? "0".repeat(32) : clickSign(full) });
    const res = await click.POST(
      new Request("http://x/api/payments/click", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }),
    );
    return (await res.json()) as ClickReply;
  };
  const wallet = async (uid: string) => {
    const r = await query<{ points: string; quota: string; balance: string; plan: string }>(
      `SELECT points, quota, balance, plan FROM users WHERE id = $1`,
      [uid],
    );
    return { points: Number(r[0].points), quota: Number(r[0].quota), balance: Number(r[0].balance), plan: r[0].plan };
  };
  const orderRow = async (id: string) =>
    (
      await query<{ state: string; cancel_reason: number | null; provider_txn: string | null; perform_time: string }>(
        `SELECT state, cancel_reason, provider_txn, perform_time FROM payment_orders WHERE id = $1`,
        [id],
      )
    )[0];
  /** Hamyon = jurnal yig'indisi. Har foydalanuvchi 0 dan boshlaydi. */
  const assertLedger = async (uid: string) => {
    const r = await query<{ p: string; q: string; b: string }>(
      `SELECT COALESCE(SUM(points_delta),0) p, COALESCE(SUM(quota_delta),0) q, COALESCE(SUM(balance_delta),0) b
         FROM transactions WHERE user_id = $1`,
      [uid],
    );
    const w = await wallet(uid);
    assert.deepEqual(
      { points: w.points, quota: w.quota, balance: w.balance },
      { points: Number(r[0].p), quota: Number(r[0].q), balance: Number(r[0].b) },
      "hamyon jurnal yig'indisiga teng bo'lishi shart",
    );
  };
  /** `cancelled` buyurtma + unga bog'langan kredit yozuvi — hech qachon bo'lmasligi kerak. */
  const cancelledWithCredit = async () =>
    query<{ id: string }>(
      `SELECT o.id FROM payment_orders o
         JOIN transactions t
           ON t.kind IN ('topup','subscription')
          AND t.reference = o.provider || ':' || COALESCE(o.provider_txn, o.id::text)
        WHERE o.state = 'cancelled'`,
    );
  const assertAccountError = (r: RpcReply, what: string) => {
    assert.ok(r.error, `${what}: xato kutilgan, natija keldi: ${JSON.stringify(r.result)}`);
    assert.ok(r.error!.code <= -31050 && r.error!.code >= -31099, `${what}: -31050…-31099 kutilgan, keldi ${r.error!.code}`);
    assert.equal(r.error!.data, "order_id", `${what}: data maydoni hisob maydonini ko'rsatadi`);
  };

  /**
   * Foydalanuvchi qatorini ALOHIDA ulanishda qulflab turadi — kredit yozuvchi
   * har qanday so'rov shu yerda kutadi. Shunda «Perform ∥ Cancel» poygasi
   * tasodifga emas, aniq tartibga bog'liq bo'ladi.
   */
  const holdUserLock = async (uid: string) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query("BEGIN");
    await c.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [uid]);
    return {
      /** Shu bazada qulf kutayotgan boshqa sessiyalar soni. */
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

  // ───────────────────────── Payme

  await t.test("Payme: to'liq yo'l — Check → Create → Perform → Check → GetStatement; to'langanni bekor qilib bo'lmaydi", async () => {
    const { uid, order } = await mkOrder("payme");
    const account = { order_id: order.id };
    const amount = 1_000_000; // 10 000 so'm = 1 000 000 tiyin
    const txn = `pm-happy-${order.id.slice(0, 8)}`;
    const time = Date.now();

    assert.deepEqual((await rpc("CheckPerformTransaction", { amount, account })).result, { allow: true });

    const created = await rpc("CreateTransaction", { id: txn, time, amount, account });
    assert.deepEqual(created.result, { create_time: time, transaction: order.id, state: 1 });

    const chk1 = await rpc("CheckTransaction", { id: txn });
    assert.equal(chk1.result?.state, 1);
    assert.equal(chk1.result?.perform_time, 0);

    const perf = await rpc("PerformTransaction", { id: txn });
    assert.equal(perf.result?.state, 2);
    assert.ok(Number(perf.result?.perform_time) > 0);
    assert.equal((await wallet(uid)).balance, 10_000);

    const chk2 = await rpc("CheckTransaction", { id: txn });
    assert.equal(chk2.result?.state, 2);
    assert.equal(chk2.result?.perform_time, perf.result?.perform_time);
    assert.equal(chk2.result?.create_time, time);

    const st = await rpc("GetStatement", { from: time - 1, to: time + 1 });
    const row = (st.result?.transactions as Array<Record<string, unknown>>).find((x) => x.id === txn);
    assert.ok(row, "GetStatement tranzaksiyani qaytaradi");
    assert.equal(row!.state, 2);
    assert.equal(row!.amount, amount);

    // To'langan buyurtma — xizmat ko'rsatilgan, bekor qilib bo'lmaydi (-31007).
    const cancel = await rpc("CancelTransaction", { id: txn, reason: 5 });
    assert.equal(cancel.error?.code, -31007);
    assert.equal((await orderRow(order.id)).state, "paid");
    assert.equal((await wallet(uid)).balance, 10_000);
    await assertLedger(uid);
  });

  await t.test("Payme: Pro buyurtma — kvota + plan bitta tranzaksiyada", async () => {
    const { uid, order } = await mkOrder("payme", 0, "pro");
    const txn = `pm-pro-${order.id.slice(0, 8)}`;
    const amount = order.amountSoum * 100;
    await rpc("CreateTransaction", { id: txn, time: Date.now(), amount, account: { order_id: order.id } });
    assert.equal((await rpc("PerformTransaction", { id: txn })).result?.state, 2);
    const w = await wallet(uid);
    assert.equal(w.quota, 15_000);
    assert.equal(w.plan, "pro");
    await assertLedger(uid);
  });

  await t.test("Payme: noto'g'ri summa → -31001", async () => {
    const { order } = await mkOrder("payme");
    const account = { order_id: order.id };
    assert.equal((await rpc("CheckPerformTransaction", { amount: 999_999, account })).error?.code, -31001);
    assert.equal((await rpc("CreateTransaction", { id: "pm-amt", time: Date.now(), amount: 10_000, account })).error?.code, -31001);
    assert.equal((await orderRow(order.id)).state, "created");
  });

  await t.test("Payme: noma'lum buyurtma → -31050 (data=order_id); noma'lum tranzaksiya → -31003", async () => {
    const account = { order_id: "00000000-0000-4000-8000-000000000000" };
    assertAccountError(await rpc("CheckPerformTransaction", { amount: 100, account }), "CheckPerform");
    assertAccountError(await rpc("CreateTransaction", { id: "pm-x", time: Date.now(), amount: 100, account }), "Create");
    for (const m of ["PerformTransaction", "CancelTransaction", "CheckTransaction"]) {
      assert.equal((await rpc(m, { id: "yo'q-txn", reason: 3 })).error?.code, -31003, m);
    }
    // Click buyurtmasi Payme orqali to'lanmaydi (BEA-05 #6).
    const { order } = await mkOrder("click");
    assertAccountError(
      await rpc("CheckPerformTransaction", { amount: order.amountSoum * 100, account: { order_id: order.id } }),
      "boshqa provayder buyurtmasi",
    );
  });

  await t.test("Payme: takroriy yetkazish idempotent (Create/Perform/Cancel)", async () => {
    const { uid, order } = await mkOrder("payme");
    const account = { order_id: order.id };
    const amount = order.amountSoum * 100;
    const txn = `pm-dup-${order.id.slice(0, 8)}`;
    const time = Date.now();
    const c1 = await rpc("CreateTransaction", { id: txn, time, amount, account });
    const c2 = await rpc("CreateTransaction", { id: txn, time: time + 5, amount, account });
    assert.deepEqual(c2.result, c1.result, "ikkinchi Create birinchisining natijasini qaytaradi");

    const p1 = await rpc("PerformTransaction", { id: txn });
    const p2 = await rpc("PerformTransaction", { id: txn });
    assert.deepEqual(p2.result, p1.result);
    assert.equal((await wallet(uid)).balance, 10_000, "pul faqat bir marta");
    await assertLedger(uid);

    // Bekor qilishning takrori — birinchi cancel_time va sabab saqlanadi.
    const { order: o2 } = await mkOrder("payme");
    const t2 = `pm-dupc-${o2.id.slice(0, 8)}`;
    await rpc("CreateTransaction", { id: t2, time: Date.now(), amount: o2.amountSoum * 100, account: { order_id: o2.id } });
    const k1 = await rpc("CancelTransaction", { id: t2, reason: 3 });
    assert.equal(k1.result?.state, -1);
    await new Promise((r) => setTimeout(r, 5));
    const k2 = await rpc("CancelTransaction", { id: t2, reason: 5 });
    assert.deepEqual(k2.result, k1.result);
    const chk = await rpc("CheckTransaction", { id: t2 });
    assert.equal(chk.result?.reason, 3, "takroriy Cancel sababni qayta yozmaydi");
    assert.equal(chk.result?.cancel_time, k1.result?.cancel_time);
    // Bekor qilingan tranzaksiyani bajarib bo'lmaydi.
    assert.equal((await rpc("PerformTransaction", { id: t2 })).error?.code, -31008);
  });

  await t.test("Payme: band / yopiq buyurtma → -31008 (Payme «Песочница» talabi)", async () => {
    // Payme sandbox: «CreateTransaction c новой транзакцией и состоянием счета
    // «В ожидании оплаты» — ответ с ошибкой -31008»; rasmiy PHP shablon
    // (`Order::validate`, CheckPerformTransaction) ham -31008 qaytaradi.
    // Hisob xatosi (-31050…) faqat noma'lum buyurtma uchun (W3-C review R1).
    const { order } = await mkOrder("payme");
    const account = { order_id: order.id };
    const amount = order.amountSoum * 100;
    const t1 = `pm-busy1-${order.id.slice(0, 8)}`;
    await rpc("CreateTransaction", { id: t1, time: Date.now(), amount, account });

    const busy = await rpc("CheckPerformTransaction", { amount, account });
    assert.equal(busy.error?.code, -31008, `CheckPerform band: ${JSON.stringify(busy)}`);
    const busy2 = await rpc("CreateTransaction", { id: `pm-busy2-${order.id.slice(0, 8)}`, time: Date.now(), amount, account });
    assert.equal(busy2.error?.code, -31008, `Create boshqa id bilan: ${JSON.stringify(busy2)}`);
    // Birinchi tranzaksiya o'zgarmay qoladi.
    assert.equal((await rpc("CheckTransaction", { id: t1 })).result?.state, 1);

    // Bekor qilingach ham buyurtma yopiq — bir martalik to'lov.
    await rpc("CancelTransaction", { id: t1, reason: 3 });
    const closed = await rpc("CheckPerformTransaction", { amount, account });
    assert.equal(closed.error?.code, -31008, `CheckPerform bekor qilingan: ${JSON.stringify(closed)}`);

    // To'langan buyurtma ham -31008.
    const { order: o2 } = await mkOrder("payme");
    const a2 = { order_id: o2.id };
    const t2 = `pm-paidc-${o2.id.slice(0, 8)}`;
    await rpc("CreateTransaction", { id: t2, time: Date.now(), amount: o2.amountSoum * 100, account: a2 });
    await rpc("PerformTransaction", { id: t2 });
    assert.equal((await rpc("CheckPerformTransaction", { amount: o2.amountSoum * 100, account: a2 })).error?.code, -31008);
    assert.equal(
      (await rpc("CreateTransaction", { id: `${t2}-b`, time: Date.now(), amount: o2.amountSoum * 100, account: a2 })).error?.code,
      -31008,
    );
  });

  await t.test("Payme: 12 soatlik timeout — eski Create rad; eski tranzaksiya Perform/Create'da reason 4 bilan bekor", async () => {
    // (a) `time` 13 soat oldin — yangi tranzaksiya ochilmaydi.
    const { order: o1 } = await mkOrder("payme");
    const r1 = await rpc("CreateTransaction", {
      id: `pm-old-${o1.id.slice(0, 8)}`,
      time: Date.now() - H13,
      amount: o1.amountSoum * 100,
      account: { order_id: o1.id },
    });
    assert.equal(r1.error?.code, -31008, "13 soatlik Create rad etiladi");
    assert.equal((await orderRow(o1.id)).state, "created");

    // (b) Faol tranzaksiya 13 soat eskirgan — Perform uni bekor qiladi, pul yo'q.
    const { uid, order: o2 } = await mkOrder("payme");
    const t2 = `pm-exp-${o2.id.slice(0, 8)}`;
    await rpc("CreateTransaction", { id: t2, time: Date.now(), amount: o2.amountSoum * 100, account: { order_id: o2.id } });
    await query(`UPDATE payment_orders SET create_time = create_time - $2 WHERE id = $1`, [o2.id, H13]);
    assert.equal((await rpc("PerformTransaction", { id: t2 })).error?.code, -31008);
    const chk = await rpc("CheckTransaction", { id: t2 });
    assert.equal(chk.result?.state, -1);
    assert.equal(chk.result?.reason, 4);
    assert.equal((await wallet(uid)).balance, 0);
    await assertLedger(uid);

    // (c) Takroriy Create eskirgan tranzaksiyaga — xuddi shunday.
    const { order: o3 } = await mkOrder("payme");
    const t3 = `pm-exp3-${o3.id.slice(0, 8)}`;
    const args = { id: t3, time: Date.now(), amount: o3.amountSoum * 100, account: { order_id: o3.id } };
    await rpc("CreateTransaction", args);
    await query(`UPDATE payment_orders SET create_time = create_time - $2 WHERE id = $1`, [o3.id, H13]);
    assert.equal((await rpc("CreateTransaction", args)).error?.code, -31008);
    const row = await orderRow(o3.id);
    assert.equal(row.state, "cancelled");
    assert.equal(row.cancel_reason, 4);
  });

  await t.test("Payme: Perform ∥ Cancel — faqat bittasi yutadi, bekor qilinganda kredit qolmaydi", async () => {
    const { uid, order } = await mkOrder("payme");
    const txn = `pm-race-${order.id.slice(0, 8)}`;
    await rpc("CreateTransaction", { id: txn, time: Date.now(), amount: order.amountSoum * 100, account: { order_id: order.id } });

    const lock = await holdUserLock(uid);
    const perform = rpc("PerformTransaction", { id: txn });
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 1), "Perform kredit qulfida kutmoqda");
    let cancelDone = false;
    const cancel = rpc("CancelTransaction", { id: txn, reason: 3 }).finally(() => {
      cancelDone = true;
    });
    // Cancel yo tugaydi (tuzatilmagan kod), yo buyurtma qulfida navbatga turadi.
    await waitFor(async () => cancelDone || (await lock.waiters()) >= 2);
    await lock.release();
    const [p, c] = await Promise.all([perform, cancel]);

    const performWon = p.result?.state === 2;
    const cancelWon = c.result?.state === -1;
    assert.equal(Number(performWon) + Number(cancelWon), 1, `aynan bittasi yutadi: ${JSON.stringify({ p, c })}`);
    const row = await orderRow(order.id);
    assert.equal(row.state, performWon ? "paid" : "cancelled");
    assert.equal((await wallet(uid)).balance, performWon ? 10_000 : 0);
    assert.deepEqual(await cancelledWithCredit(), []);
    await assertLedger(uid);
  });

  await t.test("Payme: Perform ∥ Perform (provayder retry) — ikkalasi ham state 2, pul bir marta", async () => {
    const { uid, order } = await mkOrder("payme");
    const txn = `pm-rr-${order.id.slice(0, 8)}`;
    await rpc("CreateTransaction", { id: txn, time: Date.now(), amount: order.amountSoum * 100, account: { order_id: order.id } });
    const lock = await holdUserLock(uid);
    const a = rpc("PerformTransaction", { id: txn });
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 1));
    const b = rpc("PerformTransaction", { id: txn });
    await waitFor(async () => (await lock.waiters()) >= 2, 1_000);
    await lock.release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.result?.state, 2, JSON.stringify(ra));
    assert.equal(rb.result?.state, 2, JSON.stringify(rb));
    assert.equal(ra.result?.perform_time, rb.result?.perform_time);
    assert.equal((await wallet(uid)).balance, 10_000);
    await assertLedger(uid);
  });

  await t.test("Payme: tasodifiy Perform ∥ Cancel poygalari — invariant buzilmaydi", async () => {
    const users: string[] = [];
    await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const { uid, order } = await mkOrder("payme");
        users.push(uid);
        const txn = `pm-rnd${i}-${order.id.slice(0, 8)}`;
        await rpc("CreateTransaction", { id: txn, time: Date.now(), amount: order.amountSoum * 100, account: { order_id: order.id } });
        const calls = [rpc("PerformTransaction", { id: txn }), rpc("CancelTransaction", { id: txn, reason: 3 })];
        if (i % 2) calls.reverse();
        const [x, y] = await Promise.all(calls);
        const wins = [x, y].filter((r) => r.result && (r.result.state === 2 || r.result.state === -1)).length;
        assert.equal(wins, 1, JSON.stringify({ x, y }));
      }),
    );
    assert.deepEqual(await cancelledWithCredit(), []);
    for (const uid of users) await assertLedger(uid);
  });

  await t.test("Payme: AUTH xatosi so'rov id sini qaytaradi; noma'lum metod → -32601", async () => {
    const res = await payme.POST(
      new Request("http://x/api/payments/payme", {
        method: "POST",
        headers: { authorization: "Basic " + Buffer.from("Paycom:xato").toString("base64"), "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4242, method: "CheckTransaction", params: { id: "a" } }),
      }),
    );
    const body = (await res.json()) as RpcReply;
    assert.equal(body.error?.code, -32504);
    assert.equal(body.id, 4242);
    assert.equal((await rpc("NimadirTransaction", {})).error?.code, -32601);
  });

  // ───────────────────────── Click

  await t.test("Click: Prepare → Complete → takroriy Complete idempotent; to'langanga Prepare → -4", async () => {
    const { uid, order } = await mkOrder("click");
    const base = { click_trans_id: "900001", merchant_trans_id: order.id, amount: "10000.00" };
    const prep = await clickCall({ ...base, action: "0" });
    assert.equal(prep.error, 0, prep.error_note);
    assert.ok(Number.isSafeInteger(prep.merchant_prepare_id));
    const pid = String(prep.merchant_prepare_id);

    const done = await clickCall({ ...base, action: "1", merchant_prepare_id: pid });
    assert.equal(done.error, 0, done.error_note);
    assert.equal((await wallet(uid)).balance, 10_000);

    const again = await clickCall({ ...base, action: "1", merchant_prepare_id: pid });
    assert.equal(again.error, 0, "takroriy Complete — muvaffaqiyat, pul qo'shilmaydi");
    assert.equal((await wallet(uid)).balance, 10_000);

    assert.equal((await clickCall({ ...base, action: "0" })).error, -4);
    await assertLedger(uid);
  });

  await t.test("Click: imzo -1, summa -2, noma'lum buyurtma -5, prepare_id -6, boshqa provayder -5", async () => {
    const { order } = await mkOrder("click");
    const base = { click_trans_id: "900002", merchant_trans_id: order.id, amount: "10000" };
    assert.equal((await clickCall({ ...base, action: "0" }, { badSign: true })).error, -1);
    assert.equal((await clickCall({ ...base, amount: "9999", action: "0" })).error, -2);
    assert.equal(
      (await clickCall({ ...base, merchant_trans_id: "00000000-0000-4000-8000-000000000000", action: "0" })).error,
      -5,
    );
    const prep = await clickCall({ ...base, action: "0" });
    assert.equal(prep.error, 0);
    assert.equal(
      (await clickCall({ ...base, action: "1", merchant_prepare_id: String(Number(prep.merchant_prepare_id) + 1) })).error,
      -6,
    );
    const { order: pm } = await mkOrder("payme");
    assert.equal((await clickCall({ ...base, click_trans_id: "900003", merchant_trans_id: pm.id, action: "0" })).error, -5);
  });

  await t.test("Click: Complete error<0 — kutilayotgan buyurtma bekor; TO'LANGAN buyurtma bekor qilinmaydi", async () => {
    const { uid, order } = await mkOrder("click");
    const base = { click_trans_id: "900010", merchant_trans_id: order.id, amount: "10000" };
    const prep = await clickCall({ ...base, action: "0" });
    const pid = String(prep.merchant_prepare_id);
    assert.equal((await clickCall({ ...base, action: "1", merchant_prepare_id: pid, error: "-5017" })).error, -9);
    assert.equal((await orderRow(order.id)).state, "cancelled");
    assert.equal((await clickCall({ ...base, action: "1", merchant_prepare_id: pid })).error, -9);
    assert.equal((await wallet(uid)).balance, 0);

    const { uid: u2, order: o2 } = await mkOrder("click");
    const b2 = { click_trans_id: "900011", merchant_trans_id: o2.id, amount: "10000" };
    const p2 = String((await clickCall({ ...b2, action: "0" })).merchant_prepare_id);
    assert.equal((await clickCall({ ...b2, action: "1", merchant_prepare_id: p2 })).error, 0);
    const late = await clickCall({ ...b2, action: "1", merchant_prepare_id: p2, error: "-1" });
    assert.equal(late.error, -4, "to'langan buyurtma — Already paid, bekor qilinmaydi");
    assert.equal((await orderRow(o2.id)).state, "paid");
    assert.equal((await wallet(u2)).balance, 10_000);
    assert.deepEqual(await cancelledWithCredit(), []);
    await assertLedger(u2);
  });

  await t.test("Click: Complete ∥ Complete (retry) — ikkalasi 0, pul bir marta", async () => {
    const { uid, order } = await mkOrder("click");
    const base = { click_trans_id: "900020", merchant_trans_id: order.id, amount: "10000" };
    const pid = String((await clickCall({ ...base, action: "0" })).merchant_prepare_id);
    const lock = await holdUserLock(uid);
    const a = clickCall({ ...base, action: "1", merchant_prepare_id: pid });
    assert.ok(await waitFor(async () => (await lock.waiters()) >= 1));
    const b = clickCall({ ...base, action: "1", merchant_prepare_id: pid });
    await waitFor(async () => (await lock.waiters()) >= 2, 1_000);
    await lock.release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.error, 0, ra.error_note);
    assert.equal(rb.error, 0, rb.error_note);
    assert.equal((await wallet(uid)).balance, 10_000);
    await assertLedger(uid);
  });

  // ───────────────────────── Audit izi (OBS-09)

  await t.test("payment_events: har webhook yoziladi, imzo/parol TOZALANGAN", async () => {
    const { uid, order } = await mkOrder("click");
    const base = { click_trans_id: "900030", merchant_trans_id: order.id, amount: "10000" };
    const full = { ...base, action: "0", service_id: "777", sign_time: "2026-09-24 10:00:00", error: "0" };
    const sign = clickSign(full);
    await clickCall({ ...base, action: "0" });
    // ChangePassword — yangi kalit tanada keladi; u hech qachon saqlanmasligi kerak.
    await rpc("ChangePassword", { password: "YANGI-MAXFIY-KALIT-123" });

    const rows = await query<{ provider: string; method: string; order_id: string | null; provider_txn: string | null; payload: unknown; response_code: number | null }>(
      `SELECT provider, method, order_id, provider_txn, payload, response_code FROM payment_events ORDER BY id`,
    );
    const mine = rows.filter((r) => r.order_id === order.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].provider, "click");
    assert.equal(mine[0].method, "prepare");
    assert.equal(mine[0].provider_txn, "900030");
    assert.equal(mine[0].response_code, 0);
    const all = JSON.stringify(rows.map((r) => r.payload));
    assert.ok(!all.includes(sign), "Click sign_string saqlanmaydi");
    assert.ok(!all.includes("YANGI-MAXFIY-KALIT-123"), "Payme paroli saqlanmaydi");
    assert.ok(all.includes("[REDACTED]"));
    assert.ok(rows.some((r) => r.provider === "payme" && r.method === "PerformTransaction" && r.response_code === 0));
    assert.ok(rows.some((r) => r.provider === "payme" && r.method === "CancelTransaction" && r.response_code === -31007));
    await query(`DELETE FROM users WHERE id = $1`, [uid]);
  });

  await t.test("payment_events: redactPayload va 1 yillik tozalash", async () => {
    const { redactPayload, purgePaymentEvents } = await import("../lib/server/payment-events.ts");
    assert.deepEqual(
      redactPayload({ a: 1, sign_string: "x", nested: { password: "p", Authorization: "B", list: [{ secret_key: "s" }] }, sign_time: "t" }),
      { a: 1, sign_string: "[REDACTED]", nested: { password: "[REDACTED]", Authorization: "[REDACTED]", list: [{ secret_key: "[REDACTED]" }] }, sign_time: "t" },
    );
    await query(
      `INSERT INTO payment_events (provider, method, payload, received_at) VALUES
         ('payme', 'eski', '{}', now() - interval '400 days'),
         ('payme', 'yangi', '{}', now() - interval '300 days')`,
    );
    const n = await purgePaymentEvents(365);
    assert.ok(n >= 1);
    const left = await query<{ method: string }>(`SELECT method FROM payment_events WHERE method IN ('eski','yangi')`);
    assert.deepEqual(left.map((r) => r.method), ["yangi"]);
  });
});
