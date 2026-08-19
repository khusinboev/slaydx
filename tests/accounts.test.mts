import test from "node:test";
import assert from "node:assert/strict";

/**
 * Akkaunt fazolarining ajratilishi.
 *
 * Bu sinov aniq bir zaiflik uchun yozilgan: `upsertLocalUser` ilgari
 * foydalanuvchini `username` bo'yicha qidirardi, `username` ga esa
 * Telegram username ham yozilardi. Natijada OTP orqali «egam_haq»
 * identifikatori bilan kirgan kishi @egam_haq Telegram akkauntiga
 * tushib qolardi.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("akkaunt fazolari", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { upsertTelegramUser, upsertLocalUser } = await import("../lib/server/auth.ts");

  await migrate();

  const tag = `t${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const tgId = String(900_000_000 + Math.floor(Math.random() * 90_000_000));
  const created: string[] = [];

  t.after(async () => {
    if (created.length) {
      await query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [created]);
    }
    await pool().end();
  });

  await t.test("Telegram username OTP identifikatori bilan to'qnashmaydi", async () => {
    const tgUser = await upsertTelegramUser({
      telegramId: tgId,
      username: tag,
      name: "Telegram Egasi",
      photoUrl: null,
    });
    created.push(tgUser.id);

    // Aynan o'sha satrni OTP orqali «egallashga» urinamiz.
    const localUser = await upsertLocalUser(tag);
    created.push(localUser.id);

    assert.notEqual(localUser.id, tgUser.id, "OTP akkaunti Telegram akkauntiga tushmasligi kerak");
    assert.equal(localUser.telegramId, null);
    assert.equal(tgUser.telegramId, tgId);
  });

  await t.test("bir xil OTP identifikatori doim bitta akkaunt", async () => {
    const a = await upsertLocalUser(`${tag}-x`);
    const b = await upsertLocalUser(`  ${tag.toUpperCase()}-X  `);
    created.push(a.id);
    assert.equal(a.id, b.id, "normalizatsiyadan keyin bir xil bo'lishi kerak");
  });

  await t.test("bir xil Telegram ID doim bitta akkaunt", async () => {
    const again = await upsertTelegramUser({
      telegramId: tgId,
      username: `${tag}-renamed`,
      name: "Nomi O'zgardi",
      photoUrl: null,
    });
    assert.equal(again.telegramId, tgId);
    assert.equal(again.name, "Nomi O'zgardi", "profil yangilanishi kerak");
  });

  await t.test("yangi akkaunt bonusi bir marta beriladi", async () => {
    const rows = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM transactions
        WHERE user_id = $1 AND kind = 'bonus' AND note = 'Ro''yxatdan o''tish bonusi'`,
      [created[0]],
    );
    assert.equal(rows[0].count, "1");
  });
});
