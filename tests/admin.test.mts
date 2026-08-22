import test from "node:test";
import assert from "node:assert/strict";

/**
 * Admin panel — telefon aniqlash, kredit tuzatish, ro'yxat.
 *
 * `DATABASE_URL` bo'lmasa o'tkazib yuboriladi.
 */
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters";

const { normalizePhone, isAdminPhone } = await import("../lib/server/admin-phones.ts");

test("normalizePhone turli formatlarni bitta kalitga tushiradi", () => {
  assert.equal(normalizePhone("+998976063896"), "998976063896");
  assert.equal(normalizePhone("998976063896"), "998976063896");
  assert.equal(normalizePhone("+998 97 606 38 96"), "998976063896");
  assert.equal(normalizePhone("+998-97-606-38-96"), "998976063896");
  // Milliy format — mamlakat kodisiz, 9 xonali.
  assert.equal(normalizePhone("976063896"), "998976063896");
});

test("isAdminPhone faqat ro'yxatdagi raqamni tan oladi", () => {
  assert.equal(isAdminPhone("+998976063896"), true);
  assert.equal(isAdminPhone("998976063896"), true, "formatidan qat'i nazar bir xil odam");
  assert.equal(isAdminPhone("+998901234567"), false);
  assert.equal(isAdminPhone(null), false);
  assert.equal(isAdminPhone(""), false);
});

test("kredit tuzatish (haqiqiy Postgres)", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { adminAdjustWallet } = await import("../lib/server/credits.ts");

  await migrate();

  const suffix = `admtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance)
     VALUES ($1, 'Admin Sinovi', 0, 0, 500) RETURNING id`,
    [suffix],
  );
  const uid = String(rows[0].id);

  t.after(async () => {
    await query("DELETE FROM users WHERE id = $1", [uid]);
    await pool().end();
  });

  const wallet = async () => {
    const [row] = await query<{ balance: string }>("SELECT balance FROM users WHERE id = $1", [uid]);
    return Number(row.balance);
  };

  await t.test("qo'shish", async () => {
    const r = await adminAdjustWallet(uid, "balance", 1_000_000, "admin:test", "birinchi to'ldirish");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual([r.before, r.after], [500, 1_000_500]);
    assert.equal(await wallet(), 1_000_500);
  });

  await t.test("yechish", async () => {
    const r = await adminAdjustWallet(uid, "balance", -500, "admin:test");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.after, 1_000_000);
  });

  await t.test("manfiyga tushirib bo'lmaydi", async () => {
    const before = await wallet();
    const r = await adminAdjustWallet(uid, "balance", -999_999_999, "admin:test");
    assert.equal(r.ok, false);
    assert.equal(await wallet(), before, "muvaffaqiyatsiz urinishda balans o'zgarmasligi kerak");
  });

  await t.test("jurnalda kim bajargani yoziladi va kind ajratilgan", async () => {
    const txs = await query<{ kind: string; note: string | null }>(
      "SELECT kind, note FROM transactions WHERE user_id = $1 ORDER BY created_at",
      [uid],
    );
    assert.equal(txs[0].kind, "admin_credit");
    assert.match(txs[0].note ?? "", /^admin:test/);
    assert.equal(txs[1].kind, "admin_debit");
    // Haqiqiy to'lov/generatsiya kind'laridan (topup/charge) ALOHIDA —
    // moliyaviy hisobot admin tuzatishini aralashtirib hisoblamasin.
    assert.ok(!txs.some((t) => t.kind === "topup" || t.kind === "charge"));
  });

  await t.test("noma'lum hamyon runtime da rad etiladi", async () => {
    // TS turi buni chaqiruv vaqtida ushlaydi, lekin API route JSON'dan
    // kelgan qiymatni uzatadi — shuning uchun runtime tekshiruvi ham bor.
    await assert.rejects(() => adminAdjustWallet(uid, "hacked" as never, 1, "admin:test"));
  });

  // Ro'yxat/qidiruv so'rovi shu yerda, ALOHIDA test emas — `db.ts` dagi
  // pool modul darajasidagi singleton, ikkinchi top-level testda uni
  // qayta ochib bo'lmaydi (birinchisi `t.after` da `pool().end()`
  // chaqiradi). Bitta faylda pool faqat BIR marta yopiladi.
  await t.test("ism bo'yicha ILIKE qidiruvda topiladi", async () => {
    const found = await query<{ id: string }>("SELECT id FROM users WHERE name ILIKE $1", [
      "%Admin Sinovi%",
    ]);
    assert.ok(found.some((r) => String(r.id) === uid));
  });
});
