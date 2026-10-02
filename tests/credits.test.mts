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
  const { query, migrate } = await import("../lib/server/db.ts");
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
    // Pool ATAYIN bu yerda yopilmaydi: fayldagi keyingi test ham shu
    // ulanishdan foydalanadi. Yopish faqat oxirgi testda.
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

  await t.test("qaytarish: ball balga, kvota ulushi BALANSGA (kvota yopiq, o'smaydi)", async () => {
    await refund(uid, `${suffix}:a`);
    const w = await wallet(uid);
    // 1000 ball + 200 kvota yechilgan edi. Obuna olib tashlangach (docs/SUBS-REMOVAL.md
    // §A) kvota ulushi balansga qaytadi: 1000 / 300 / 2200 — jami 3 500 tiklandi.
    // MUTATSIYA: eski «aynan olingan hamyonga» qoidasi → 1000 / 500 / 2000.
    assert.deepEqual(w, { points: 1000, quota: 300, balance: 2200 });
    const [row] = await query<{ points_delta: string; quota_delta: string; balance_delta: string }>(
      "SELECT points_delta, quota_delta, balance_delta FROM transactions WHERE kind = 'refund' AND reference = $1",
      [`${suffix}:a`],
    );
    assert.deepEqual(
      { p: Number(row.points_delta), q: Number(row.quota_delta), b: Number(row.balance_delta) },
      { p: 1000, q: 0, b: 200 },
      "jurnal qatori hamyon o'zgarishi bilan aynan bir xil",
    );
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
    // 2 200 (kvota ulushi qaytgandan keyin) + 5 000.
    assert.equal((await wallet(uid)).balance, 7200);
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

/**
 * Kvota hech qachon o'smaydi (obuna olib tashlandi, docs/SUBS-REMOVAL.md §A).
 *
 * 034 `quota_merge` kvotani balansga o'tkazgan; undan keyin kvota faqat
 * kamayishi mumkin (almashinuv paytida qolgan qoldiqni yechish, admin
 * `admin_debit`). Har pul yo'li bu yerda ketma-ket yuradi va har qadamdan
 * keyin kvota oldingisidan katta emasligi, hamyon jami esa aynan kutilgan
 * miqdor ekanligi tekshiriladi.
 */
test("kvota hech qachon o'smaydi: charge / refund / refundPartial / refundInTx / topUp / admin", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, transaction } = await import("../lib/server/db.ts");
  const { charge, refund, refundPartial, topUp, topUpInTx, adminAdjustWalletInTx } = await import("../lib/server/credits.ts");
  const { refundInTx } = await import("../lib/server/refund-tx.ts");
  await migrate();

  const suffix = `test-quota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Almashinuvdan qolgan 1 000 kvota (eski konteyner yozgan holat) — himoya yo'lini ham sinaydi.
  const [{ id }] = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 1000, 5000) RETURNING id`,
    [suffix],
  );
  const uid = String(id);
  t.after(async () => {
    await query("DELETE FROM transactions WHERE user_id = $1", [uid]);
    await query("DELETE FROM users WHERE id = $1", [uid]);
  });

  const wallet = async () => {
    const [r] = await query<{ points: string; quota: string; balance: string }>(
      "SELECT points, quota, balance FROM users WHERE id = $1",
      [uid],
    );
    return { points: Number(r.points), quota: Number(r.quota), balance: Number(r.balance) };
  };
  let lastQuota = (await wallet()).quota;
  const step = async (label: string, expected: { points: number; quota: number; balance: number }) => {
    const w = await wallet();
    assert.ok(w.quota <= lastQuota, `${label}: kvota o'sdi ${lastQuota} → ${w.quota}`);
    assert.deepEqual(w, expected, label);
    lastQuota = w.quota;
  };

  // 1. Yechish: tartib ball → kvota → balans (kvota himoya uchun birinchi sarflanadi).
  const a = await charge(uid, 600, `${suffix}:a`);
  assert.deepEqual(a.ok && a.split, { points: 0, quota: 600, balance: 0 });
  await step("charge a", { points: 0, quota: 400, balance: 5000 });

  // 2. To'liq qaytarish — kvota ulushi balansga.
  assert.equal(await refund(uid, `${suffix}:a`), true);
  await step("refund a", { points: 0, quota: 400, balance: 5600 });

  // 3. Kvota oxirigacha sarflanadi.
  const b = await charge(uid, 700, `${suffix}:b`);
  assert.deepEqual(b.ok && b.split, { points: 0, quota: 400, balance: 300 });
  await step("charge b", { points: 0, quota: 0, balance: 5300 });

  // 4. Qisman qaytarish: (400 kvota + 300 balans) × 0.5 = 350 → balansga.
  assert.equal(await refundPartial(uid, `${suffix}:b`, 0.5), true);
  await step("refundPartial b", { points: 0, quota: 0, balance: 5650 });

  // 5. `refundInTx` (bekor qilish, tiklash skaneri) — konversiyadan OLDINGI yechim
  //    qatori (kvota 1 500 + balans 500) to'liq balansga qaytadi.
  await query(
    `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note)
     VALUES ($1, 'charge', 0, -1500, -500, $2, 'eski yechim')`,
    [uid, `${suffix}:c`],
  );
  assert.equal(await transaction((c) => refundInTx(c, uid, `${suffix}:c`)), true);
  await step("refundInTx c", { points: 0, quota: 0, balance: 7650 });
  const [rc] = await query<{ quota_delta: string; balance_delta: string }>(
    "SELECT quota_delta, balance_delta FROM transactions WHERE kind = 'refund' AND reference = $1",
    [`${suffix}:c`],
  );
  // MUTATSIYA: `refundInTx` kvotani kvotaga qaytarsa — quota 1 500, balance_delta 500.
  assert.deepEqual({ q: Number(rc.quota_delta), b: Number(rc.balance_delta) }, { q: 0, b: 2000 });
  assert.equal(await transaction((c) => refundInTx(c, uid, `${suffix}:c`)), false, "idempotent");
  await step("refundInTx c takror", { points: 0, quota: 0, balance: 7650 });

  // 6. Kredit yo'llari kvotaga yozolmaydi (JSON dan kelgan qiymat TS turini chetlab o'tishi mumkin).
  const sneaky = { quota: 100 } as unknown as { balance: number };
  await assert.rejects(topUp(uid, sneaky, `${suffix}:t1`, "bonus"), /Kvota hamyoni yopilgan/);
  await assert.rejects(transaction((c) => topUpInTx(c, uid, sneaky, `${suffix}:t2`, "subscription")), /Kvota hamyoni yopilgan/);
  await assert.rejects(
    transaction((c) => adminAdjustWalletInTx(c, { userId: uid, wallet: "quota", delta: 100, reference: `${suffix}:adm`, note: "x" })),
    /Kvota hamyoni yopilgan/,
  );
  await step("kvotaga kredit urinishlari", { points: 0, quota: 0, balance: 7650 });

  // Hamyon = jurnal yig'indisi (boshlang'ich 1 000 / 5 000 va qo'lda qo'yilgan eski yechim hisobga olinib).
  const [sum] = await query<{ q: string; b: string }>(
    "SELECT COALESCE(SUM(quota_delta),0) AS q, COALESCE(SUM(balance_delta),0) AS b FROM transactions WHERE user_id = $1",
    [uid],
  );
  assert.equal(1000 + Number(sum.q) + 1500, 0, "kvota: boshlang'ich + jurnal (eski yechim qatorisiz) = 0");
  assert.equal(5000 + Number(sum.b) + 500, 7650, "balans: boshlang'ich + jurnal (eski yechim qatorisiz)");
});

/**
 * Qisman qaytarish (Sprint 10).
 *
 * Rasm vositasida narx SONGA bog'langan (4 ta = 6 000 tanga), lekin
 * yetkazish tekshirilmasdi: 4 tadan 1 tasi kelsa ham ish `COMPLETED`
 * bo'lib, pul to'liq yechilgan holida qolardi.
 */
test("qisman qaytarish", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { charge, refund, refundPartial, walletTotal } = await import("../lib/server/credits.ts");

  await migrate();
  const suffix = `test-partial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance)
     VALUES ($1, 'Test', 0, 0, 6000) RETURNING id`,
    [suffix],
  );
  const uid = String(rows[0].id);
  t.after(async () => {
    await query("DELETE FROM transactions WHERE user_id = $1", [uid]);
    await query("DELETE FROM users WHERE id = $1", [uid]);
    await pool().end();
  });

  const wallet = async () => {
    const r = await query<{ points: string; quota: string; balance: string }>(
      "SELECT points, quota, balance FROM users WHERE id = $1",
      [uid],
    );
    return walletTotal({ points: Number(r[0].points), quota: Number(r[0].quota), balance: Number(r[0].balance) });
  };

  // 4 ta rasm uchun 6 000 tanga yechildi.
  const ref = `job-${suffix}`;
  const charged = await charge(uid, 6000, ref, "4 ta rasm");
  assert.equal(charged.ok, true);
  assert.equal(await wallet(), 0);

  // 4 tadan 3 tasi keldi — chorak qismi qaytadi.
  assert.equal(await refundPartial(uid, ref, 1 - 3 / 4, "3/4 yaratildi"), true);
  assert.equal(await wallet(), 1500, "6 000 ning choragi qaytishi kerak");

  // Ikkinchi urinish hech narsa qilmaydi va to'liq qaytarish ham bloklanadi.
  assert.equal(await refundPartial(uid, ref, 0.25, "takror"), false);
  assert.equal(await refund(uid, ref, "to'liq"), false, "qisman qaytarilgandan keyin to'liq qaytarish bo'lmaydi");
  assert.equal(await wallet(), 1500, "balans o'zgarmasligi kerak");
});
