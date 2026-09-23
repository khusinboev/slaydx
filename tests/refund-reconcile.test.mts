import test from "node:test";
import assert from "node:assert/strict";

/**
 * YIQILGAN ISH PULINI TIKLASH (AUDIT prod-readiness W2-D2 review N3) —
 * haqiqiy Postgres ga qarshi.
 *
 * `reclaimStaleJobs` ishni FAILED qilib COMMIT qiladi, pul esa KEYIN alohida
 * tranzaksiyada qaytadi (`housekeeping` → `refundThenCleanup`). Shu ikkinchi
 * qadam yiqilsa (ulanish uzilishi, process o'limi) ish FAILED, pul esa
 * qaytmagan holda abadiy qolardi. `refundUnrefundedFailed` — xavfsizlik
 * to'ri: FAILED + charge bor + refund yo'q ishlarga pulni AYNAN BIR MARTA
 * qaytaradi (qator qulfi + `refundInTx` + UNIQUE (kind, reference)).
 *
 * Boshqa agentlar ham shu bazani ishlatadi: o'z qatorlarimiz 20 kun oldin
 * «yiqilgan» qilinadi va oyna `graceSec` = 15 kun, `windowDays` = 30 bilan
 * beriladi — begona yangi qatorlarga tegilmaydi.
 *
 * MUTATSIYALAR (tasdiqlangan — hisobotga qarang):
 *   - `NOT EXISTS refund` sharti olib tashlansa → allaqachon qaytarilgan ish qayta sanaladi;
 *   - `status = 'FAILED'` sharti olib tashlansa → COMPLETED ishga pul qaytadi;
 *   - grace sharti olib tashlansa → endi yiqilgan ish ham olinadi;
 *   - qator qulfi (`FOR UPDATE`) + holat qayta tekshiruvi olib tashlansa → parallel chaqiruvda id ikki marta.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const OPTS = { graceSec: 15 * 86_400, windowDays: 30 };

test("refundUnrefundedFailed", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { enqueueGeneration } = await import("../lib/server/jobs.ts");
  const { refundUnrefundedFailed } = await import("../lib/server/refund-reconcile.ts");
  const { refund } = await import("../lib/server/credits.ts");

  await migrate();

  const suffix = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [u] = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Rec', 0, 0, 10000) RETURNING id`,
    [suffix],
  );
  const uid = String(u.id);

  t.after(async () => {
    await query("DELETE FROM users WHERE id = $1", [uid]);
    await pool().end();
  });

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

  await t.test("FAILED + charge + refund yo'q → pul AYNAN BIR MARTA qaytadi (ikki parallel chaqiruvda ham)", async () => {
    const lost = await job("FAILED", "20 days");
    await query(
      `INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes, expires_at)
       VALUES ($1, 'a.docx', 'application/octet-stream', 1, '\\x01', NULL)`,
      [lost],
    );
    const before = await balance();

    /*
     * Poyga DETERMINISTIK: qatorni alohida tranzaksiyada qulflab turamiz,
     * ikkala chaqiruv ham nomzodni ko'radi va qulfda kutadi.
     */
    const blocker = await pool().connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM generations WHERE id = $1 FOR UPDATE", [lost]);
    const both = Promise.all([refundUnrefundedFailed(OPTS), refundUnrefundedFailed(OPTS)]);
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

    assert.equal([...a, ...b].filter((id) => id === lost).length, 1, "MUTATSIYA: ikki marta tiklandi");
    assert.equal(await refundRows(lost), 1);
    assert.equal(await balance(), before + 1000, "pul qaytmadi yoki ikki marta qaytdi");
    const file = await queryOne("SELECT 1 FROM generation_files WHERE generation_id = $1", [lost]);
    assert.ok(!file, "FAILED ishning fayli qoldi (C03)");

    // Idempotent: qayta chaqiruv hech narsa qilmaydi.
    const again = await refundUnrefundedFailed(OPTS);
    assert.ok(!again.includes(lost));
    assert.equal(await balance(), before + 1000);
  });

  await t.test("allaqachon qaytarilgan FAILED ishga tegilmaydi", async () => {
    const done = await job("FAILED", "20 days");
    await refund(uid, done, "oddiy yo'l");
    const before = await balance();
    const out = await refundUnrefundedFailed(OPTS);
    assert.ok(!out.includes(done), "MUTATSIYA: qaytarilgan ish qayta tanlandi");
    assert.equal(await refundRows(done), 1);
    assert.equal(await balance(), before);
  });

  await t.test("COMPLETED ishga pul qaytmaydi", async () => {
    const ok = await job("COMPLETED", "20 days");
    const before = await balance();
    const out = await refundUnrefundedFailed(OPTS);
    assert.ok(!out.includes(ok), "MUTATSIYA: COMPLETED ishga pul qaytdi");
    assert.equal(await refundRows(ok), 0);
    assert.equal(await balance(), before);
  });

  await t.test("endigina yiqilgan ish (grace ichida) oddiy yo'lga qoldiriladi", async () => {
    const fresh = await job("FAILED", "1 day");
    const out = await refundUnrefundedFailed(OPTS);
    assert.ok(!out.includes(fresh), "MUTATSIYA: grace ichidagi ish olindi");
    assert.equal(await refundRows(fresh), 0);
  });
});
