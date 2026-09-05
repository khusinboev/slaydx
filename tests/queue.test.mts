import test from "node:test";
import assert from "node:assert/strict";

/**
 * Navbat byudjeti — uchdan-uchiga (Sprint 12).
 *
 * Sof `budgetFor` testi `generation.test.mts` da. Bu yerda SIMLASH
 * tekshiriladi: byudjet navbatga qo'yishda hisoblanib, qatorga yozilib,
 * `claimJob` orqali worker ga yetib boradimi. Ilgari worker 14 xizmatga
 * bitta global `WORKER_JOB_TIMEOUT_MS` ishlatardi.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("navbat byudjeti", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { enqueueGeneration, claimJob } = await import("../lib/server/jobs.ts");
  const { budgetFor } = await import("../lib/generation/budget.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  await migrate();

  const suffix = `test-queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance)
     VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`,
    [suffix],
  );
  const uid = String(rows[0].id);

  t.after(async () => {
    await query("DELETE FROM generations WHERE user_id = $1", [uid]);
    await query("DELETE FROM transactions WHERE user_id = $1", [uid]);
    await query("DELETE FROM users WHERE id = $1", [uid]);
    await pool().end();
  });

  const CAP = 900_000;
  const enqueue = async (toolId: "coursework" | "essay", values: Record<string, unknown>) => {
    const tool = TOOL_BY_ID[toolId];
    const res = await enqueueGeneration({
      userId: uid,
      toolId: tool.id,
      topic: `${toolId} sinov`,
      price: 100,
      format: tool.output,
      values: values as never,
      budgetMs: budgetFor(tool, values as never, CAP),
    });
    assert.equal(res.ok, true);
    return res.ok ? res.id : "";
  };

  await t.test("byudjet qatorga yoziladi va worker ga yetib boradi", async () => {
    // Katta ish avval navbatga tushadi — `claimJob` `created_at` bo'yicha oladi.
    const bigId = await enqueue("coursework", { topic: "Katta", pages: "40-45" });
    const smallId = await enqueue("essay", { topic: "Kichik", pages: "1" });

    const stored = await query<{ id: string; budget_ms: number }>(
      "SELECT id, budget_ms FROM generations WHERE user_id = $1 ORDER BY created_at",
      [uid],
    );
    const byId = Object.fromEntries(stored.map((r) => [r.id, Number(r.budget_ms)]));
    assert.ok(byId[bigId] >= 420_000, `katta ish byudjeti: ${byId[bigId]}`);
    assert.ok(byId[smallId] <= 120_000, `kichik ish byudjeti: ${byId[smallId]}`);

    // Worker aynan shu qiymatni oladi — global konstanta emas.
    const claimed = await claimJob("test-worker");
    assert.ok(claimed, "ish olinishi kerak");
    assert.equal(claimed!.id, bigId, "navbat tartibi: eng eskisi birinchi");
    assert.equal(claimed!.budgetMs, byId[bigId]);
  });

  await t.test("eski qator (budget_ms = 0) global qiymatga qaytadi", async () => {
    // `claimJob` navbatdagi ENG ESKI ishni oladi, shuning uchun oldingi
    // sinovdan qolgan qatorlar avval navbatdan chiqariladi — aks holda
    // bu sinov ular ustida ishlab qolardi.
    await query("UPDATE generations SET status = 'COMPLETED' WHERE user_id = $1 AND status = 'QUEUED'", [uid]);

    const id = await enqueue("essay", { topic: "Eski", pages: "2" });
    // Migratsiyadan oldin yaratilgan qatorni taqlid qilamiz.
    await query("UPDATE generations SET budget_ms = 0 WHERE id = $1", [id]);

    const claimed = await claimJob("test-worker-2");
    assert.ok(claimed);
    assert.equal(claimed!.id, id);
    assert.equal(claimed!.budgetMs, 0, "0 — worker global qiymatga qaytishi uchun belgi");
  });
});
