import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * TO'LOV YAKUNI — KREDIT YOZISH `credits.ts` ORQALI (W3 wrap-up (a)).
 *
 * `payments.ts` ning o'z `creditInTx` nusxasi olib tashlanib, `settleOrder`
 * endi `credits.ts topUpInTx`/`activateProInTx` ni chaqiradi. Xatti-harakat
 * AYNAN o'sha bo'lishi shart — bu fayl o'sha invariantlarni qulflaydi:
 *
 *   • hamyon = jurnal yig'indisi (`balance == SUM(balance_delta)` va h.k.);
 *   • topup: `kind='topup'`, izoh «<provider> orqali to'ldirish», faqat balans;
 *   • pro: `kind='subscription'`, izoh «Pro obuna», kvota 15 000, `plan='pro'`,
 *     muddat +30 kun (faol obuna ustiga qo'shiladi);
 *   • takroriy va PARALLEL yakun pul qo'shmaydi va xato bermaydi.
 *
 * Postgres talab qilinadi (alohida baza).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("payswap") : { isolated: false, drop: async () => {} };
const skip = hasDb ? false : "DATABASE_URL yo'q";

test("settleOrder → credits.ts: jurnal invarianti va yozuv shakli o'zgarmagan", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createOrder, attachTransaction, settleOrder, PRO_PLAN } = await import("../lib/server/payments.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const mkUser = async () =>
    String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`,
          [`swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
        )
      )[0].id,
    );
  const wallet = async (uid: string) =>
    (
      await query<{ points: string; quota: string; balance: string; plan: string; days: string | null }>(
        `SELECT points, quota, balance, plan,
                EXTRACT(EPOCH FROM (plan_expires_at - now())) / 86400 AS days
           FROM users WHERE id = $1`,
        [uid],
      )
    )[0];
  const journal = async (uid: string) =>
    await query<{ kind: string; points_delta: string; quota_delta: string; balance_delta: string; reference: string; note: string }>(
      `SELECT kind, points_delta, quota_delta, balance_delta, reference, note FROM transactions WHERE user_id = $1 ORDER BY id`,
      [uid],
    );
  const assertLedger = async (uid: string) => {
    const w = await wallet(uid);
    const [s] = await query<{ p: string; q: string; b: string }>(
      `SELECT COALESCE(SUM(points_delta),0) AS p, COALESCE(SUM(quota_delta),0) AS q, COALESCE(SUM(balance_delta),0) AS b
         FROM transactions WHERE user_id = $1`,
      [uid],
    );
    assert.equal(Number(w.points), Number(s.p), "points ≠ jurnal");
    assert.equal(Number(w.quota), Number(s.q), "quota ≠ jurnal");
    assert.equal(Number(w.balance), Number(s.b), "balance ≠ jurnal");
  };

  await t.test("topup: faqat balans, kind/izoh/reference aynan", async () => {
    const uid = await mkUser();
    const order = await createOrder({ userId: uid, provider: "click", purpose: "topup", amountSoum: 12_345 });
    assert.equal(await attachTransaction(order.id, "click-txn-1", 1_000), true);
    const out = await settleOrder(order.id, 2_000);
    assert.equal(out.status, "paid");
    const w = await wallet(uid);
    assert.equal(Number(w.balance), 12_345);
    assert.equal(Number(w.quota), 0);
    assert.equal(w.plan, "free");
    const j = await journal(uid);
    assert.equal(j.length, 1);
    assert.deepEqual(
      { ...j[0], points_delta: Number(j[0].points_delta), quota_delta: Number(j[0].quota_delta), balance_delta: Number(j[0].balance_delta) },
      { kind: "topup", points_delta: 0, quota_delta: 0, balance_delta: 12_345, reference: "click:click-txn-1", note: "click orqali to'ldirish" },
    );
    // Takror — pul qo'shilmaydi, xato yo'q.
    assert.equal((await settleOrder(order.id, 3_000)).status, "already_paid");
    assert.equal((await journal(uid)).length, 1);
    await assertLedger(uid);
  });

  await t.test("pro: kvota + tarif bir tranzaksiyada, faol obuna ustiga +30 kun", async () => {
    const uid = await mkUser();
    const o1 = await createOrder({ userId: uid, provider: "payme", purpose: "pro", amountSoum: 0 });
    await attachTransaction(o1.id, "pm-1", 1_000);
    assert.equal((await settleOrder(o1.id, 2_000)).status, "paid");
    let w = await wallet(uid);
    assert.equal(w.plan, "pro");
    assert.equal(Number(w.quota), PRO_PLAN.quota);
    assert.ok(Math.abs(Number(w.days) - PRO_PLAN.days) < 0.01, `muddat ${w.days} kun`);
    const j = await journal(uid);
    assert.equal(j.length, 1);
    assert.equal(j[0].kind, "subscription");
    assert.equal(j[0].note, "Pro obuna");
    assert.equal(j[0].reference, "payme:pm-1");
    assert.equal(Number(j[0].quota_delta), PRO_PLAN.quota);
    assert.equal(Number(j[0].balance_delta), 0);

    const o2 = await createOrder({ userId: uid, provider: "payme", purpose: "pro", amountSoum: 0 });
    await attachTransaction(o2.id, "pm-2", 1_000);
    assert.equal((await settleOrder(o2.id, 2_000)).status, "paid");
    w = await wallet(uid);
    assert.equal(Number(w.quota), PRO_PLAN.quota * 2);
    assert.ok(Math.abs(Number(w.days) - 2 * PRO_PLAN.days) < 0.01, `ustiga qo'shilmadi: ${w.days}`);
    await assertLedger(uid);
  });

  await t.test("parallel yakun: bitta `paid`, qolganlari `already_paid`, pul bir marta", async () => {
    const uid = await mkUser();
    const order = await createOrder({ userId: uid, provider: "payme", purpose: "topup", amountSoum: 50_000 });
    await attachTransaction(order.id, "pm-race", 1_000);
    const outs = await Promise.all(Array.from({ length: 6 }, () => settleOrder(order.id, 2_000)));
    const statuses = outs.map((o) => o.status).sort();
    assert.deepEqual(statuses, ["already_paid", "already_paid", "already_paid", "already_paid", "already_paid", "paid"]);
    assert.equal(Number((await wallet(uid)).balance), 50_000);
    assert.equal((await journal(uid)).length, 1);
    await assertLedger(uid);
  });

  await t.test("kredit oldindan yozilgan (qo'lda/boshqa yo'l) — buyurtma `paid`, ikkinchi kredit yo'q", async () => {
    const uid = await mkUser();
    const order = await createOrder({ userId: uid, provider: "click", purpose: "topup", amountSoum: 7_000 });
    await attachTransaction(order.id, "click-pre", 1_000);
    const { topUp } = await import("../lib/server/credits.ts");
    assert.equal(await topUp(uid, { balance: 7_000 }, "click:click-pre", "topup", "click orqali to'ldirish"), true);
    assert.equal((await settleOrder(order.id, 2_000)).status, "paid");
    assert.equal(Number((await wallet(uid)).balance), 7_000);
    assert.equal((await journal(uid)).length, 1);
    await assertLedger(uid);
  });
});
