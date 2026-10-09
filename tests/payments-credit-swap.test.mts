import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * TO'LOV YAKUNI — KREDIT YOZISH `credits.ts` ORQALI (W3 wrap-up (a)).
 *
 * `payments.ts` ning o'z `creditInTx` nusxasi olib tashlanib, `settleOrder`
 * endi `credits.ts topUpInTx` ni chaqiradi. Xatti-harakat AYNAN o'sha
 * bo'lishi shart — bu fayl o'sha invariantlarni qulflaydi:
 *
 *   • hamyon = jurnal yig'indisi (`balance == SUM(balance_delta)` va h.k.);
 *   • topup: `kind='topup'`, izoh «<provider> orqali to'ldirish», faqat balans;
 *   • ESKI pro buyurtma (obuna 2026-10 da olib tashlangan, docs/SUBS-REMOVAL.md
 *     §A): `kind='subscription'` (admin SQL purpose → kind moslikka tayanadi),
 *     to'langan summa BALANSGA, kvota 0, `plan`/`plan_expires_at` tegilmaydi;
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
  const { createOrder, attachTransaction, settleOrder, findOrder } = await import("../lib/server/payments.ts");
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
    // C-Q4: the top-up row, then the payment bonus row (default 10 % → points) in the same settlement.
    assert.equal(j.length, 2);
    assert.deepEqual(
      j.map((r) => ({ ...r, points_delta: Number(r.points_delta), quota_delta: Number(r.quota_delta), balance_delta: Number(r.balance_delta) })),
      [
        { kind: "topup", points_delta: 0, quota_delta: 0, balance_delta: 12_345, reference: "click:click-txn-1", note: "click orqali to'ldirish" },
        { kind: "bonus", points_delta: 1_234, quota_delta: 0, balance_delta: 0, reference: `payment-bonus:${order.id}`, note: "To‘lov bonusi (10%)" },
      ],
    );
    // Takror — pul qo'shilmaydi, xato yo'q.
    assert.equal((await settleOrder(order.id, 3_000)).status, "already_paid");
    assert.equal((await journal(uid)).length, 2);
    await assertLedger(uid);
  });

  await t.test("eski pro buyurtma: summa balansga (kind subscription), plan/kvota tegilmaydi, idempotent", async () => {
    // `createOrder` endi `pro` yaratmaydi — eski buyurtma to'g'ridan-to'g'ri SQL bilan.
    const legacyPro = async (uid: string, amountSoum: number) => {
      const [r] = await query<{ id: string }>(
        `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum)
         VALUES (gen_random_uuid(), $1, 'payme', 'pro', $2) RETURNING id::text AS id`,
        [uid, amountSoum],
      );
      return r.id;
    };
    await assert.rejects(
      // @ts-expect-error — `pro` turdan ham olib tashlangan; runtime to'sig'i ham bor.
      createOrder({ userId: await mkUser(), provider: "payme", purpose: "pro", amountSoum: 15_000 }),
      /Obuna to'xtatilgan/,
    );

    const uid = await mkUser();
    const o1 = await legacyPro(uid, 15_000);
    await attachTransaction(o1, "pm-1", 1_000);
    assert.equal((await settleOrder(o1, 2_000)).status, "paid");
    let w = await wallet(uid);
    // MUTATSIYA: eski `activateProInTx` → kvota 15 000, plan 'pro', balans 0.
    assert.equal(Number(w.balance), 15_000, "to'langan summa balansga tushishi kerak");
    assert.equal(Number(w.quota), 0, "kvota o'smasligi kerak");
    assert.equal(w.plan, "free", "plan yozilmasligi kerak");
    assert.equal(w.days, null, "plan_expires_at yozilmasligi kerak");
    const j = await journal(uid);
    assert.equal(j.length, 1);
    assert.deepEqual(
      { ...j[0], points_delta: Number(j[0].points_delta), quota_delta: Number(j[0].quota_delta), balance_delta: Number(j[0].balance_delta) },
      {
        kind: "subscription",
        points_delta: 0,
        quota_delta: 0,
        balance_delta: 15_000,
        reference: "payme:pm-1",
        note: "Pro obuna (eski buyurtma) — balansga",
      },
    );
    assert.equal((await findOrder(o1))?.purpose, "pro", "tarixiy purpose o'qiladi");

    // Takroriy va PARALLEL yakun — pul bir marta.
    assert.equal((await settleOrder(o1, 3_000)).status, "already_paid");
    const o2 = await legacyPro(uid, 20_000);
    await attachTransaction(o2, "pm-2", 1_000);
    const outs = await Promise.all(Array.from({ length: 4 }, () => settleOrder(o2, 2_000)));
    assert.deepEqual(outs.map((o) => o.status).sort(), ["already_paid", "already_paid", "already_paid", "paid"]);
    w = await wallet(uid);
    assert.equal(Number(w.balance), 35_000, "summa buyurtmaning o'zidan (o'chirilgan PRO_PLAN dan emas)");
    assert.equal(Number(w.quota), 0);
    assert.equal((await journal(uid)).length, 2);
    await assertLedger(uid);

    // Faol eski obunasi bor foydalanuvchi: muddat uzaytirilmaydi.
    const vip = await mkUser();
    await query(`UPDATE users SET plan = 'pro', plan_expires_at = now() + interval '5 days' WHERE id = $1`, [vip]);
    const o3 = await legacyPro(vip, 15_000);
    await attachTransaction(o3, "pm-3", 1_000);
    assert.equal((await settleOrder(o3, 2_000)).status, "paid");
    const v = await wallet(vip);
    assert.equal(v.plan, "pro");
    assert.ok(Math.abs(Number(v.days) - 5) < 0.01, `muddat o'zgarmasligi kerak edi: ${v.days}`);
    assert.equal(Number(v.balance), 15_000);
    assert.equal(Number(v.quota), 0);
    await assertLedger(vip);
  });

  await t.test("parallel yakun: bitta `paid`, qolganlari `already_paid`, pul bir marta", async () => {
    const uid = await mkUser();
    const order = await createOrder({ userId: uid, provider: "payme", purpose: "topup", amountSoum: 50_000 });
    await attachTransaction(order.id, "pm-race", 1_000);
    const outs = await Promise.all(Array.from({ length: 6 }, () => settleOrder(order.id, 2_000)));
    const statuses = outs.map((o) => o.status).sort();
    assert.deepEqual(statuses, ["already_paid", "already_paid", "already_paid", "already_paid", "already_paid", "paid"]);
    assert.equal(Number((await wallet(uid)).balance), 50_000);
    // One top-up row + the first top-up bonus (50 000 is the user's first paid top-up → +5 000
    // points, docs/bonus/PLAN.md «Bonus 2»), each exactly once despite six parallel settlements.
    assert.deepEqual(
      (await journal(uid)).map((r) => [r.kind, Number(r.balance_delta), Number(r.points_delta)]),
      [
        ["topup", 50_000, 0],
        ["bonus", 0, 5_000],
      ],
    );
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
