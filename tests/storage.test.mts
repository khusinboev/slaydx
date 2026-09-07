import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Fayl va aktiv egaligi (Sprint 14, N-1).
 *
 * `getGenerationFile` va `hasGenerationFile` egalikni SQL darajasida
 * so'raydi, `deleteGenerationFile` esa so'ramasdi — ya'ni naqsh bor edi,
 * bitta funksiya undan chetda qolgan edi. `DELETE /api/generations/{id}`
 * uni egalik tekshiruvidan OLDIN chaqirar, natijada begona `id` bilan
 * kelgan so'rov 409 olsa ham, fayl allaqachon o'chgan bo'lardi.
 *
 * Bu yerda HTTP emas, MA'LUMOT qatlami sinaladi: to'siq route da emas,
 * SQL da turishi kerak — shunda keyingi chaqiruvchi ham teshik ocha olmaydi.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("fayl egaligi", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const {
    putGenerationFile,
    getGenerationFile,
    hasGenerationFile,
    deleteGenerationFile,
  } = await import("../lib/server/storage.ts");
  const { putAssets } = await import("../lib/server/assets.ts");
  const { deleteGeneration } = await import("../lib/server/jobs.ts");

  await migrate();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mkUser = async (tag: string) => {
    const rows = await query<{ id: string }>(
      `INSERT INTO users (username, name, points, quota, balance)
       VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`,
      [`test-storage-${tag}-${stamp}`],
    );
    return String(rows[0].id);
  };

  const owner = await mkUser("owner");
  const stranger = await mkUser("stranger");

  t.after(async () => {
    for (const uid of [owner, stranger]) {
      await query("DELETE FROM generations WHERE user_id = $1", [uid]);
      await query("DELETE FROM transactions WHERE user_id = $1", [uid]);
      await query("DELETE FROM users WHERE id = $1", [uid]);
    }
    await pool().end();
  });

  /** Tayyor generatsiya + unga biriktirilgan fayl yaratadi. */
  const mkGeneration = async (userId: string): Promise<string> => {
    // `generations.id` da DB default yo'q — uni `enqueueGeneration` beradi.
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms, status, expires_at)
       VALUES ($1, $2, 'essay', 'Sinov', 100, 'docx', '{}'::jsonb, 'Tayyor', 90000, 'COMPLETED', now() + interval '1 day')`,
      [id, userId],
    );
    await putGenerationFile(id, {
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "sinov.docx",
    });
    return id;
  };

  await t.test("begona foydalanuvchi faylni o'chira olmaydi", async () => {
    const id = await mkGeneration(owner);
    assert.equal(await hasGenerationFile(id, owner), true, "fayl boshida mavjud bo'lishi kerak");

    // AYNAN N-1: begona `userId` bilan chaqiruv hech narsani o'chirmasligi kerak.
    await deleteGenerationFile(id, stranger);

    assert.equal(
      await hasGenerationFile(id, owner),
      true,
      "begona so'rov egasining faylini o'chirmasligi kerak",
    );
    const still = await getGenerationFile(id, owner);
    assert.ok(still, "fayl egasi uchun hali ham o'qilishi kerak");
    assert.equal(still.bytes.byteLength, 8);
  });

  await t.test("egasi o'z faylini o'chira oladi", async () => {
    const id = await mkGeneration(owner);
    await deleteGenerationFile(id, owner);
    assert.equal(await hasGenerationFile(id, owner), false);
  });

  await t.test("begona foydalanuvchi generatsiyani o'chira olmaydi", async () => {
    const id = await mkGeneration(owner);
    assert.equal(await deleteGeneration(id, stranger), false);
    const rows = await query<{ id: string }>("SELECT id FROM generations WHERE id = $1", [id]);
    assert.equal(rows.length, 1, "qator o'z joyida qolishi kerak");
    assert.equal(await hasGenerationFile(id, owner), true);
  });

  /**
   * Route endi fayl va aktivni ALOHIDA o'chirmaydi — u CASCADE ga tayanadi.
   * Tayanch tekshirilishi shart: FK yo'qolsa yoki `ON DELETE` o'zgarsa,
   * o'chirilgan hujjatning megabaytlari bazada abadiy qolib ketardi va
   * buni hech narsa ushlamasdi.
   */
  await t.test("generatsiya o'chsa fayl va aktivlar CASCADE bilan ketadi", async () => {
    const id = await mkGeneration(owner);
    await putAssets(id, [
      { assetId: "a".repeat(24), mime: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ]);

    const assetsBefore = await query("SELECT 1 FROM generation_assets WHERE generation_id = $1", [id]);
    assert.equal(assetsBefore.length, 1, "aktiv yozilgan bo'lishi kerak");

    assert.equal(await deleteGeneration(id, owner), true);

    const files = await query("SELECT 1 FROM generation_files WHERE generation_id = $1", [id]);
    assert.equal(files.length, 0, "fayl CASCADE bilan o'chishi kerak");
    const assets = await query("SELECT 1 FROM generation_assets WHERE generation_id = $1", [id]);
    assert.equal(assets.length, 0, "aktivlar CASCADE bilan o'chishi kerak");
  });

  /**
   * 011_no_expiry.sql: fayl/aktiv/generatsiya endi MUDDATSIZ.
   *
   * `putGenerationFile` endi har doim `expires_at = NULL` yozadi, lekin
   * bu yolg'iz o'zi yetarli emas — agar `getGenerationFile`/
   * `hasGenerationFile` hamon `expires_at > now()` deb so'rasa, YANGI
   * fayl ham (NULL bo'lgani uchun) "topilmadi" bo'lib qolardi. Shuning
   * uchun bu yerda ATAYLAB o'tmishdagi muddat bilan qator yoziladi —
   * eski TTL filtri qaytarilsa, aynan shu holat uni ushlaydi.
   */
  await t.test("o'tmishdagi expires_at bilan ham fayl o'qiladi (TTL olib tashlangan)", async () => {
    const id = await mkGeneration(owner);
    await query("UPDATE generation_files SET expires_at = now() - interval '1 year' WHERE generation_id = $1", [
      id,
    ]);

    assert.equal(
      await hasGenerationFile(id, owner),
      true,
      "o'tmishdagi expires_at endi hech narsani yashirmasligi kerak",
    );
    const file = await getGenerationFile(id, owner);
    assert.ok(file, "muddati o'tgan (eski uslub) fayl ham o'qilishi kerak");
  });
});
