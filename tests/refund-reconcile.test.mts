import test from "node:test";
import assert from "node:assert/strict";

/**
 * YIQILGAN ISH PULINI TIKLASH (W2-D2 review N3 + re-review RR1) — haqiqiy
 * Postgres ga qarshi.
 *
 * `reclaimStaleJobs`/`failAndCleanup` ishni FAILED qilib COMMIT qiladi, pul
 * esa KEYIN alohida tranzaksiyada qaytadi. Ikkinchi qadam yiqilsa ish
 * «FAILED, pul qaytmagan» bo'lib qolardi. `refundUnrefundedFailed` — shu
 * holat uchun xavfsizlik to'ri, AYNAN BIR MARTA.
 *
 * ORKESTRATOR QARORI (RR1): tiklash bu kod chiqqanidan OLDINGI xatolarga
 * HECH QACHON tegmaydi — chegara `022_retention.sql` qo'llangan payt
 * (`schema_migrations.applied_at`), oyna esa oxirgi 2 kun. Tarixiy holatlar
 * egasi tomonidan qo'lda ko'riladi (faylidagi faqat-o'qish SQL).
 *
 * Chegara `schema_migrations` dan o'qiladi, shuning uchun testlar 022
 * qatorining `applied_at` ini vaqtincha suradi va oxirida asliga
 * qaytaradi (boshqa kod bu ustunni o'qimaydi). Begona qatorlarga tegmaslik
 * uchun har chaqiruv `userId` bilan toraytiriladi.
 *
 * MUTATSIYALAR (tasdiqlangan — hisobotga qarang):
 *   - 022 chegarasi olib tashlansa → (1) qizaradi;
 *   - 2 kunlik oyna kengaytirilsa → (2) qizaradi;
 *   - `NOT EXISTS refund` / `status = 'FAILED'` / grace / `refundInTx` natijasi → tegishli test.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("refundUnrefundedFailed", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { enqueueGeneration } = await import("../lib/server/jobs.ts");
  const { refundUnrefundedFailed } = await import("../lib/server/refund-reconcile.ts");
  const { refund } = await import("../lib/server/credits.ts");

  await migrate();

  const orig = await queryOne<{ applied_at: Date }>(
    "SELECT applied_at FROM schema_migrations WHERE name = '022_retention.sql'",
  );
  assert.ok(orig, "022 qo'llanmagan");

  const suffix = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [u] = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Rec', 0, 0, 10000) RETURNING id`,
    [suffix],
  );
  const uid = String(u.id);

  t.after(async () => {
    await query("UPDATE schema_migrations SET applied_at = $1 WHERE name = '022_retention.sql'", [orig!.applied_at]);
    await query("DELETE FROM users WHERE id = $1", [uid]);
    await pool().end();
  });

  /** 022 «qachon qo'llangan» — `now() - ago`. */
  const setCutoff = (ago: string) =>
    query("UPDATE schema_migrations SET applied_at = now() - $1::interval WHERE name = '022_retention.sql'", [ago]);

  const run = (graceSec = 60) => refundUnrefundedFailed({ graceSec, userId: uid });

  const balance = async () =>
    Number((await queryOne<{ balance: string }>("SELECT balance FROM users WHERE id = $1", [uid]))!.balance);
  const refundRows = async (id: string) =>
    (await query("SELECT 1 FROM transactions WHERE kind = 'refund' AND reference = $1", [id])).length;

  /** Navbatga qo'yadi (haqiqiy charge) va holatini/yakun vaqtini o'rnatadi. */
  async function job(status: "FAILED" | "COMPLETED", finishedAgo: string): Promise<string> {
    const res = await enqueueGeneration({
      userId: uid,
      toolId: "referat",
      topic: "Tiklash sinovi",
      price: 1000,
      format: "docx",
      values: { topic: "Tiklash sinovi" } as never,
      budgetMs: 60_000,
    });
    assert.ok(res.ok);
    await query(
      `UPDATE generations SET status = $2, progress = 100, finished_at = now() - $3::interval,
                              error = CASE WHEN $2 = 'FAILED' THEN 'Ish vaqti tugadi' END
        WHERE id = $1`,
      [res.id, status, finishedAgo],
    );
    return res.id;
  }

  await t.test("(1) 022 qo'llanishidan OLDIN yiqilgan ish HECH QACHON qaytarilmaydi", async () => {
    await setCutoff("1 hour");
    const before = await balance();
    const old = await job("FAILED", "2 hours");
    const out = await run();
    assert.ok(!out.includes(old), "MUTATSIYA: kod chiqishidan oldingi xatoga pul qaytdi");
    assert.equal(await refundRows(old), 0);
    assert.equal(await balance(), before - 1000);
  });

  await t.test("(2) 022 dan keyin, lekin 2 kundan eski — qaytarilmaydi", async () => {
    await setCutoff("10 days");
    const stale = await job("FAILED", "3 days");
    const out = await run();
    assert.ok(!out.includes(stale), "MUTATSIYA: 2 kunlik oynadan tashqaridagi ish olindi");
    assert.equal(await refundRows(stale), 0);
  });

  await t.test("(3) yaqinda (022 dan keyin) yiqilgan → AYNAN BIR MARTA qaytadi, ikki parallel chaqiruvda ham", async () => {
    await setCutoff("10 days");
    const lost = await job("FAILED", "1 hour");
    await query(
      `INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes, expires_at)
       VALUES ($1, 'a.docx', 'application/octet-stream', 1, '\\x01', NULL)`,
      [lost],
    );
    const before = await balance();

    // Poyga DETERMINISTIK: qatorni qulflab turamiz — ikkala chaqiruv nomzodni ko'radi va qulfda kutadi.
    const blocker = await pool().connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM generations WHERE id = $1 FOR UPDATE", [lost]);
    const both = Promise.all([run(), run()]);
    for (let i = 0; i < 100; i++) {
      const w = await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%FROM generations%FOR UPDATE%' AND query NOT LIKE '%pg_stat_activity%'`,
      );
      if (Number(w!.n) >= 2) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await blocker.query("COMMIT");
    blocker.release();
    const [a, b] = await both;

    assert.equal([...a, ...b].filter((id) => id === lost).length, 1, "MUTATSIYA: aynan bir marta emas");
    assert.equal(await refundRows(lost), 1);
    assert.equal(await balance(), before + 1000, "pul qaytmadi yoki ikki marta qaytdi");
    const file = await queryOne("SELECT 1 FROM generation_files WHERE generation_id = $1", [lost]);
    assert.ok(!file, "FAILED ishning fayli qoldi (C03)");

    const again = await run();
    assert.ok(!again.includes(lost));
    assert.equal(await balance(), before + 1000);
  });

  await t.test("allaqachon qaytarilgan FAILED ishga tegilmaydi", async () => {
    await setCutoff("10 days");
    const done = await job("FAILED", "1 hour");
    await refund(uid, done, "oddiy yo'l");
    const before = await balance();
    const out = await run();
    assert.ok(!out.includes(done), "MUTATSIYA: qaytarilgan ish qayta tanlandi");
    assert.equal(await refundRows(done), 1);
    assert.equal(await balance(), before);
  });

  await t.test("COMPLETED ishga pul qaytmaydi", async () => {
    await setCutoff("10 days");
    const ok = await job("COMPLETED", "1 hour");
    const before = await balance();
    const out = await run();
    assert.ok(!out.includes(ok), "MUTATSIYA: COMPLETED ishga pul qaytdi");
    assert.equal(await refundRows(ok), 0);
    assert.equal(await balance(), before);
  });

  await t.test("endigina yiqilgan ish (grace ichida) oddiy yo'lga qoldiriladi", async () => {
    await setCutoff("10 days");
    const fresh = await job("FAILED", "1 minute");
    const out = await run(600);
    assert.ok(!out.includes(fresh), "MUTATSIYA: grace ichidagi ish olindi");
    assert.equal(await refundRows(fresh), 0);
  });
});
