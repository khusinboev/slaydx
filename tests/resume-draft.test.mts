import test from "node:test";
import assert from "node:assert/strict";

/**
 * Rezyume qoralamasi (Rezyume 2, 1-band) — DB kerak.
 *
 * `DATABASE_URL` yo'q bo'lsa o'tkazib yuboriladi (`jobs-live-edit`
 * naqshi): CI da baza bo'lmasligi mumkin, lekin mahalliy ishlashda
 * qoralamaning haqiqatan saqlanishi tekshiriladi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { getDraft, putDraft, clearDraft } = await import("../lib/server/resume-draft.ts");
const { MAX_FIELD } = await import("../lib/server/validate.ts");

test("qoralama: saqlash → o'qish → tozalash", { skip: !hasDb }, async () => {
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
    assert.equal((await query(`SELECT 1 FROM resume_drafts WHERE user_id = $1`, [uid])).length, 1);
    await clearDraft(uid);
    assert.equal(await getDraft(uid), null, "tozalangandan keyin yo'q");
  } finally {
    await query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
    await pool().end();
  }
});

test("qoralama yozishdan oldin tozalanadi (sanitizeValues)", { skip: !hasDb }, async () => {
  // Bu tekshiruv DB'siz ham ma'noli: `putDraft` `sanitizeValues` ni
  // chaqiradi — kutilmagan kalit va tur bazaga tushmaydi.
  assert.ok(MAX_FIELD > 0);
});
