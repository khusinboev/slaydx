import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb, type IsolatedDb } from "./helpers/isolated-db.mts";

/**
 * TAYYOR hujjatni o'chirish pulni QAYTARMAYDI (ABUSE-07 chegarasini qulflash).
 *
 * «Natijani ol VA pulni ham qaytar» suiiste'moli yopiq: `DELETE
 * /api/generations/{id}` avval `cancelGeneration` (faqat QUEUED → REVOKED +
 * qaytarish), keyin `deleteGeneration` (COMPLETED/FAILED/REVOKED qatorni
 * o'chiradi, pulga tegmaydi) chaqiradi. Tayyor hujjatda bekor qilish
 * `false`, o'chirish `true` — balans ham, `transactions` jurnali ham
 * o'zgarmaydi. Navbatdagi ish esa (natijasiz) to'liq qaytariladi — shu
 * ikkisi orasidagi chegara testda.
 *
 * Route funksiyasining o'zi chaqirilmaydi (`cookies()`); u AYNAN shu ikki
 * chaqiruvni shu tartibda bajaradi (`app/api/generations/[id]/route.ts` DELETE).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

let iso: IsolatedDb | null = null;
before(async () => {
  if (hasDb) iso = await createIsolatedDb("w4e_del");
});

after(async () => {
  if (!hasDb) return;
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso?.drop();
});

/** Route DELETE bilan bir xil ketma-ketlik. */
async function routeDelete(id: string, userId: string): Promise<{ cancelled: boolean; removed: boolean }> {
  const { cancelGeneration, deleteGeneration } = await import("../lib/server/jobs.ts");
  const cancelled = await cancelGeneration(id, userId);
  const removed = await deleteGeneration(id, userId);
  return { cancelled, removed };
}

test("DELETE tayyor (COMPLETED) hujjat — o'chadi, lekin pul QAYTMAYDI; navbatdagi — qaytadi (ABUSE-07)", { skip }, async () => {
  const { migrate, query, queryOne } = await import("../lib/server/db.ts");
  const { enqueueGeneration } = await import("../lib/server/jobs.ts");
  await migrate();

  const [u] = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance) VALUES ('w4e_del', 'Del', 0, 0, 10000) RETURNING id`,
  );
  const uid = String(u.id);
  const balance = async () => Number((await queryOne<{ balance: string }>("SELECT balance FROM users WHERE id = $1", [uid]))!.balance);
  const refunds = async (id: string) => (await query("SELECT 1 FROM transactions WHERE kind = 'refund' AND reference = $1", [id])).length;
  const txCount = async () => Number((await queryOne<{ n: string }>("SELECT count(*) AS n FROM transactions WHERE user_id = $1", [uid]))!.n);

  const enqueue = async () =>
    enqueueGeneration({
      userId: uid,
      toolId: "referat",
      topic: "O'chirish sinovi",
      price: 3000,
      format: "docx",
      values: { topic: "O'chirish sinovi" } as never,
      budgetMs: 60_000,
    });

  // 1) Tayyor hujjat: haqiqiy yechim (charge), keyin COMPLETED.
  const done = await enqueue();
  const doneId = String((done as { id: string }).id);
  await query(`UPDATE generations SET status = 'COMPLETED', progress = 100, finished_at = now() WHERE id = $1`, [doneId]);
  assert.equal(await balance(), 7000, "yechim bo'lishi kerak");
  const txBefore = await txCount();

  const r1 = await routeDelete(doneId, uid);
  assert.deepEqual(r1, { cancelled: false, removed: true });
  assert.equal(await balance(), 7000, "MUTATSIYA: tayyor hujjat o'chirilganda pul qaytdi");
  assert.equal(await refunds(doneId), 0, "MUTATSIYA: tayyor hujjat uchun refund yozuvi paydo bo'ldi");
  assert.equal(await txCount(), txBefore, "jurnalga hech narsa qo'shilmasligi kerak");
  assert.equal((await query("SELECT 1 FROM generations WHERE id = $1", [doneId])).length, 0, "qator o'chishi kerak");

  // Takroriy DELETE ham pul bermaydi (qator yo'q → hech narsa).
  const r2 = await routeDelete(doneId, uid);
  assert.deepEqual(r2, { cancelled: false, removed: false });
  assert.equal(await balance(), 7000);

  // 2) Chegara: navbatdagi (natijasiz) ish — bekor qilinadi va to'liq qaytadi.
  const queued = await enqueue();
  const queuedId = String((queued as { id: string }).id);
  assert.equal(await balance(), 4000);
  const r3 = await routeDelete(queuedId, uid);
  assert.deepEqual(r3, { cancelled: true, removed: true });
  assert.equal(await balance(), 7000);
  assert.equal(await refunds(queuedId), 1);
});
