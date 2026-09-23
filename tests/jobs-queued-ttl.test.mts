import test from "node:test";
import assert from "node:assert/strict";

/**
 * NAVBAT MUDDATI (`audit/designs/capacity.md` §4) — haqiqiy Postgres ga qarshi.
 *
 * QUEUED qator `ttlSec` dan eski bo'lsa → FAILED («Navbat juda uzun edi —
 * pul qaytarildi») va pul qaytadi — BITTA tranzaksiyada va FAQAT BIR MARTA,
 * ikki housekeeper parallel yursa ham. Yosh ishga tegilmaydi.
 *
 * Boshqa agentlar/testlar ham shu bazadan foydalanishi mumkin, shuning
 * uchun o'z qatorlarimiz 10 kunga «qaritiladi» va `ttlSec` 5 kun
 * beriladi — begona yangi qatorlarga tegilmaydi.
 *
 * MUTATSIYALAR (tasdiqlangan — hisobotga qarang):
 *   - UPDATE dan `AND status = 'QUEUED'` olib tashlansa → id ikki marta qaytadi;
 *   - `refundInTx` chaqiruvi olib tashlansa → balans tiklanmaydi;
 *   - yosh sharti olib tashlansa → yosh ish FAILED bo'ladi.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const TTL = 5 * 86_400;

test("expireQueuedJobs", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { enqueueGeneration } = await import("../lib/server/jobs.ts");
  const { expireQueuedJobs, QUEUE_TTL_MESSAGE } = await import("../lib/server/queue-ttl.ts");

  await migrate();

  const suffix = `ttl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [u] = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Ttl', 300, 0, 5000) RETURNING id`,
    [suffix],
  );
  const uid = String(u.id);

  t.after(async () => {
    await query("DELETE FROM users WHERE id = $1", [uid]);
    await pool().end();
  });

  const wallet = async () => {
    const r = await queryOne<{ points: string; balance: string }>(
      "SELECT points, balance FROM users WHERE id = $1",
      [uid],
    );
    return { points: Number(r!.points), balance: Number(r!.balance) };
  };

  async function enqueue(): Promise<string> {
    const res = await enqueueGeneration({
      userId: uid,
      toolId: "referat",
      topic: "Navbat sinovi",
      price: 1000,
      format: "docx",
      values: { topic: "Navbat sinovi" } as never,
      budgetMs: 60_000,
    });
    assert.ok(res.ok, "navbatga qo'yilmadi");
    return res.id;
  }

  await t.test("eskirgan QUEUED → FAILED + to'liq qaytarish, ikki parallel chaqiruvda ham BIR MARTA", async () => {
    const old = await enqueue();
    const young = await enqueue();
    // Pul yechildi: 300 bonus + 700 balans, keyin 1000 balans.
    assert.deepEqual(await wallet(), { points: 0, balance: 3300 });
    await query("UPDATE generations SET created_at = now() - interval '10 days' WHERE id = $1", [old]);
    // O'lgan urinishdan qolgan fayl (C03) ham tozalanishi kerak.
    await query(
      `INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes, expires_at)
       VALUES ($1, 'a.docx', 'application/octet-stream', 1, '\\x01', NULL)`,
      [old],
    );

    /*
     * Poygani DETERMINISTIK qilamiz: qatorni alohida tranzaksiyada qulflab
     * turamiz — ikkala chaqiruv ham nomzodni (oddiy SELECT, qulfga
     * bog'liq emas) ko'radi va ikkalasining UPDATE i qulfda kutadi. Qulf
     * bo'shagach biri yutadi, ikkinchisi shartni qayta tekshiradi.
     * Qulfsiz birinchi chaqiruv ko'pincha ikkinchisi SELECT qilguncha
     * tugab qolardi va test poygani umuman sinamasdi.
     */
    const blocker = await pool().connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM generations WHERE id = $1 FOR UPDATE", [old]);
    const both = Promise.all([expireQueuedJobs({ ttlSec: TTL }), expireQueuedJobs({ ttlSec: TTL })]);
    // Ikkala UPDATE qulfda kutayotganini kutamiz (pg_locks orqali).
    for (let i = 0; i < 100; i++) {
      const w = await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%SET status = ''FAILED''%'`,
      );
      if (Number(w!.n) >= 2) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await blocker.query("COMMIT");
    blocker.release();
    const [a, b] = await both;
    const mine = [...a, ...b].filter((id) => id === old);
    assert.equal(mine.length, 1, "MUTATSIYA: ish ikki marta yakunlandi");
    assert.ok(![...a, ...b].includes(young), "yosh ish yakunlanmasligi kerak");

    const g = await queryOne<{ status: string; error: string; finished_at: Date | null }>(
      "SELECT status, error, finished_at FROM generations WHERE id = $1",
      [old],
    );
    assert.equal(g!.status, "FAILED");
    assert.equal(g!.error, QUEUE_TTL_MESSAGE);
    assert.equal(QUEUE_TTL_MESSAGE, "Navbat juda uzun edi — pul qaytarildi");
    assert.ok(g!.finished_at);

    const refunds = await query<{ points_delta: string; balance_delta: string; note: string }>(
      "SELECT points_delta, balance_delta, note FROM transactions WHERE kind = 'refund' AND reference = $1",
      [old],
    );
    assert.equal(refunds.length, 1, "qaytarish aynan bitta bo'lishi kerak");
    assert.equal(Number(refunds[0].points_delta), 300, "bonus bonusga qaytadi");
    assert.equal(Number(refunds[0].balance_delta), 700, "balans balansga qaytadi");
    assert.deepEqual(await wallet(), { points: 300, balance: 4000 }, "MUTATSIYA: pul qaytmadi yoki ikki marta qaytdi");

    const file = await queryOne("SELECT 1 FROM generation_files WHERE generation_id = $1", [old]);
    assert.ok(!file, "FAILED ishning fayli qoldi");

    // Yosh ish tegilmagan: hali QUEUED, puli yechilgan holda.
    const y = await queryOne<{ status: string }>("SELECT status FROM generations WHERE id = $1", [young]);
    assert.equal(y!.status, "QUEUED", "MUTATSIYA: yosh ish ham yakunlandi");
    const yRefund = await queryOne("SELECT 1 FROM transactions WHERE kind = 'refund' AND reference = $1", [young]);
    assert.ok(!yRefund, "yosh ishga pul qaytmasligi kerak");
  });

  await t.test("takroriy chaqiruv hech narsa qilmaydi (idempotent)", async () => {
    const before = await wallet();
    const again = await expireQueuedJobs({ ttlSec: TTL });
    const mineAgain = await query<{ id: string }>(
      "SELECT id FROM generations WHERE user_id = $1 AND id = ANY($2::uuid[])",
      [uid, again],
    );
    assert.equal(mineAgain.length, 0);
    assert.deepEqual(await wallet(), before);
  });

  await t.test("IN_PROGRESS (worker olgan) eski ishga tegilmaydi", async () => {
    const id = await enqueue();
    await query(
      `UPDATE generations SET status = 'IN_PROGRESS', locked_by = 'w-test', locked_at = now(),
                              created_at = now() - interval '10 days'
        WHERE id = $1`,
      [id],
    );
    const out = await expireQueuedJobs({ ttlSec: TTL });
    assert.ok(!out.includes(id));
    const g = await queryOne<{ status: string }>("SELECT status FROM generations WHERE id = $1", [id]);
    assert.equal(g!.status, "IN_PROGRESS");
  });
});
