import test from "node:test";
import assert from "node:assert/strict";

/**
 * Umumiy forma qoralamasi (Maqola 2 / AUDIT-17, WP4) — `form_drafts`
 * jadvali, (user, tool) bo'yicha BITTA qator. `DATABASE_URL` yo'q bo'lsa
 * DB talab qiladigan testlar o'tkazib yuboriladi (`resume-draft.test.mts`
 * naqshi).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { getDraft, putDraft, clearDraft, DRAFT_MAX_BYTES } = await import("../lib/server/form-draft.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { MAX_FIELD } = await import("../lib/server/validate.ts");

test("DRAFT_MAX_BYTES musbat", () => {
  assert.ok(DRAFT_MAX_BYTES > 0);
});

test(
  "form-draft: toolId tekshiruvi, vositalar mustaqil, upsert, sanitize, tozalash",
  { skip: hasDb ? false : "DATABASE_URL yo'q" },
  async (t) => {
    const { query, queryOne, pool, migrate } = await import("../lib/server/db.ts");
    await migrate();

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await queryOne<{ id: string }>(
      `INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`,
      [`form_draft_${stamp}`],
    );
    const uid = String(user!.id);

    t.after(async () => {
      await query(`DELETE FROM form_drafts WHERE user_id = $1`, [uid]).catch(() => {});
      await query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
      await pool().end();
    });

    await t.test("noma'lum toolId — ApiError 400 (TOOL_BY_ID da yo'q)", async () => {
      await assert.rejects(
        () => getDraft(uid, "notatool"),
        (e: unknown) => e instanceof ApiError && e.status === 400,
      );
      await assert.rejects(
        () => putDraft(uid, "notatool", { a: 1 }),
        (e: unknown) => e instanceof ApiError && e.status === 400,
      );
      await assert.rejects(
        () => clearDraft(uid, "notatool"),
        (e: unknown) => e instanceof ApiError && e.status === 400,
      );
    });

    await t.test("saqlash → o'qish; ikki vosita bir-biridan mustaqil", async () => {
      assert.equal(await getDraft(uid, "article"), null, "boshida qoralama yo'q");
      await putDraft(uid, "article", { topic: "Sun'iy intellekt" });
      assert.equal((await getDraft(uid, "article"))?.data.topic, "Sun'iy intellekt");

      // Bitta foydalanuvchi, boshqa vosita — mustaqil qator (PRIMARY KEY (user_id, tool_id)).
      await putDraft(uid, "resume", { fullName: "Aliyev Ali" });
      assert.equal(
        (await getDraft(uid, "article"))?.data.topic,
        "Sun'iy intellekt",
        "article qoralamasi resume yozuvidan ta'sirlanmadi",
      );
      assert.equal((await getDraft(uid, "resume"))?.data.fullName, "Aliyev Ali");
    });

    await t.test("ON CONFLICT (user_id, tool_id) — ikkinchi yozuv USTIGA, bitta qator qoladi", async () => {
      await putDraft(uid, "article", { topic: "Yangi mavzu" });
      assert.equal((await getDraft(uid, "article"))?.data.topic, "Yangi mavzu");
      const rows = await query(
        `SELECT 1 FROM form_drafts WHERE user_id = $1 AND tool_id = 'article'`,
        [uid],
      );
      assert.equal(rows.length, 1, "ikkinchi PUT dan keyin ham BITTA qator (upsert)");
    });

    await t.test("sanitizeValues qo'llaniladi — uzun matn kesiladi, oq ro'yxatdan tashqari kalit o'tmaydi", async () => {
      const long = "a".repeat(MAX_FIELD + 500);
      await putDraft(uid, "article", { topic: long, "bad key": "x" });
      const got = await getDraft(uid, "article");
      assert.equal(got?.data.topic?.toString().length, MAX_FIELD);
      assert.equal(Object.prototype.hasOwnProperty.call(got?.data ?? {}, "bad key"), false);
    });

    await t.test("tozalash — faqat SHU vositaning qatori", async () => {
      await clearDraft(uid, "article");
      assert.equal(await getDraft(uid, "article"), null);
      assert.equal(
        (await getDraft(uid, "resume"))?.data.fullName,
        "Aliyev Ali",
        "resume qoralamasi article tozalanganda qolishi kerak",
      );
    });
  },
);
