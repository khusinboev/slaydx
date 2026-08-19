import test from "node:test";
import assert from "node:assert/strict";

/**
 * Kredit hisobi — haqiqiy Postgres ga qarshi.
 *
 * `DATABASE_URL` bo'lmasa test o'tkazib yuboriladi (CI da baza bo'lmasligi
 * mumkin), lekin bor bo'lsa eng muhim invariantlar tekshiriladi:
 * idempotentlik, yetarsiz balans va aynan olingan hamyonga qaytarish.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("kredit hisobi", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { charge, refund, topUp, walletTotal } = await import("../lib/server/credits.ts");

  await migrate();

  const suffix = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance)
     VALUES ($1, 'Test', 1000, 500, 2000) RETURNING id`,
    [suffix],
  );
  const uid = String(rows[0].id);

  t.after(async () => {
    await query("DELETE FROM users WHERE id = $1", [uid]);
    await pool().end();
  });

  await t.test("hamyonlar navbat bilan yechiladi: ball → kvota → balans", async () => {
    const res = await charge(uid, 1200, `${suffix}:a`);
    assert.equal(res.ok, true);
    assert.deepEqual(res.ok && res.split, { points: 1000, quota: 200, balance: 0 });
  });

  await t.test("bir xil reference ikkinchi marta yechmaydi", async () => {
    const before = await wallet(uid);
    const res = await charge(uid, 1200, `${suffix}:a`);
    assert.equal(res.ok && res.alreadyCharged, true);
    assert.deepEqual(await wallet(uid), before, "balans o'zgarmasligi kerak");
  });

  await t.test("yetarsiz balansda hech narsa yechilmaydi", async () => {
    const before = await wallet(uid);
    const res = await charge(uid, 999_999, `${suffix}:big`);
    assert.equal(res.ok, false);
    assert.deepEqual(await wallet(uid), before);
  });

  await t.test("qaytarish aynan olingan hamyonga tushadi", async () => {
    await refund(uid, `${suffix}:a`);
    const w = await wallet(uid);
    // Boshlang'ich holat tiklanishi kerak: 1000 / 500 / 2000
    assert.deepEqual(w, { points: 1000, quota: 500, balance: 2000 });
  });

  await t.test("takroriy qaytarish pul ko'paytirmaydi", async () => {
    const before = await wallet(uid);
    const again = await refund(uid, `${suffix}:a`);
    assert.equal(again, false);
    assert.deepEqual(await wallet(uid), before);
  });

  await t.test("to'ldirish idempotent (webhook ikki marta kelsa ham)", async () => {
    const first = await topUp(uid, { balance: 5000 }, `${suffix}:pay`, "topup");
    const second = await topUp(uid, { balance: 5000 }, `${suffix}:pay`, "topup");
    assert.equal(first, true);
    assert.equal(second, false, "ikkinchi webhook pul qo'shmasligi kerak");
    assert.equal((await wallet(uid)).balance, 7000);
  });

  await t.test("balans hech qachon manfiy bo'lmaydi", async () => {
    const w = await wallet(uid);
    assert.ok(w.points >= 0 && w.quota >= 0 && w.balance >= 0);
    assert.ok(walletTotal(w) >= 0);
  });

  async function wallet(id: string) {
    const r = await query<{ points: string; quota: string; balance: string }>(
      "SELECT points, quota, balance FROM users WHERE id = $1",
      [id],
    );
    return {
      points: Number(r[0].points),
      quota: Number(r[0].quota),
      balance: Number(r[0].balance),
    };
  }
});
