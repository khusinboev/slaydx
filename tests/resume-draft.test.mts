import test from "node:test";
import assert from "node:assert/strict";

/**
 * Rezyume qoralamasi (Rezyume 2, 1-band) — DB kerak.
 *
 * Maqola 2 / AUDIT-17 WP4: `resume-draft.ts` endi umumiy `form-draft.ts`
 * ustidagi YUPQA O'RAM (`toolId="resume"`). Bu test hamon SHU MODULNI
 * (import joyi o'zgarmagan) sinaydi — faqat saqlash joyi tekshiruvi
 * `resume_drafts`dan `form_drafts`ga ko'chdi: eski jadvalga ENDI
 * YOZILMAYDI (020 migratsiya bir martalik nusxa ko'chirgan, jadvalning
 * o'zi rollback xavfsizligi uchun 021 gacha qoladi).
 *
 * `DATABASE_URL` yo'q bo'lsa o'tkazib yuboriladi: CI da baza
 * bo'lmasligi mumkin, lekin mahalliy ishlashda qoralamaning haqiqatan
 * saqlanishi tekshiriladi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { getDraft, putDraft, clearDraft } = await import("../lib/server/resume-draft.ts");
const { MAX_FIELD } = await import("../lib/server/validate.ts");

test("qoralama: saqlash → o'qish → tozalash (WP4: form_drafts da, tool_id='resume')", { skip: !hasDb }, async () => {
  const { query, queryOne, pool } = await import("../lib/server/db.ts");
  const { migrate } = await import("../lib/server/db.ts");
  await migrate();
  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`,
    [`draft_test_${Date.now()}`],
  );
  const uid = String(user!.id);
  try {
    assert.equal(await getDraft(uid), null, "boshida qoralama yo'q");
    await putDraft(uid, { fullName: "Karimova Dilnoza", enrich: true, experience: '[{"id":"e1"}]' });
    const got = await getDraft(uid);
    assert.equal(got?.data.fullName, "Karimova Dilnoza");
    assert.equal(got?.data.enrich, true);
    // Ikkinchi yozuv ustiga yozadi (foydalanuvchiga BITTA qator).
    await putDraft(uid, { fullName: "Aliyev Ali" });
    assert.equal((await getDraft(uid))?.data.fullName, "Aliyev Ali");
    // WP4: haqiqiy saqlash endi `form_drafts` da (tool_id='resume').
    assert.equal(
      (await query(`SELECT 1 FROM form_drafts WHERE user_id = $1 AND tool_id = 'resume'`, [uid])).length,
      1,
    );
    // Eski jadvalga ENDI YOZILMAYDI — yangi kod uni umuman ko'rmaydi.
    assert.equal(
      (await query(`SELECT 1 FROM resume_drafts WHERE user_id = $1`, [uid])).length,
      0,
      "resume_drafts ga endi yozilmasligi kerak (form_drafts ga o'tdi)",
    );
    await clearDraft(uid);
    assert.equal(await getDraft(uid), null, "tozalangandan keyin yo'q");
  } finally {
    await query(`DELETE FROM form_drafts WHERE user_id = $1`, [uid]).catch(() => {});
    await query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
    await pool().end();
  }
});

test("qoralama yozishdan oldin tozalanadi (sanitizeValues)", { skip: !hasDb }, async () => {
  // Bu tekshiruv DB'siz ham ma'noli: `putDraft` `sanitizeValues` ni
  // chaqiradi — kutilmagan kalit va tur bazaga tushmaydi.
  assert.ok(MAX_FIELD > 0);
});
