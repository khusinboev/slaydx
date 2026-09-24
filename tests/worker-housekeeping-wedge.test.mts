import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * OSILGAN YETAKCHI TIKLASHNI TO'XTATMAYDI (W4-B review R1).
 *
 * Housekeeping advisory qulfi (SCALE-16) ulangan holda osilib qolgan
 * process'da (event loop bloklangan, `docker pause`) abadiy qolishi mumkin —
 * TCP keepalive'ga yadro javob beradi, Postgres sessiyani o'ldirmaydi. Agar
 * tiklash qadamlari ham qulf ortida bo'lsa, butun klasterda osilgan ishlar
 * qaytarilmas, pul qaytmas, navbat muddati ishlamasdi.
 *
 * Endi `recoverJobs` (reclaim + o'lik ish puli, navbat muddati, pul
 * qaytarish skaneri) HAR processda qulfsiz yuradi; qulf ortida faqat og'ir
 * tozalashlar. Test: qulfni hech qachon so'rov yubormaydigan alohida sessiya
 * ushlaydi («osilgan yetakchi»), boshqa process(lar)ning uchta PARALLEL tick'i
 * osilgan ishni, navbatda eskirgan ishni va puli qaytmagan FAILED ishni
 * tiklaydi — har biriga pul AYNAN bir marta qaytadi.
 *
 * MUTATSIYA: `recoverJobs` yana qulf ortiga (`purgeHousekeeping` bilan birga)
 * qo'yilsa — hech narsa tiklanmaydi va test qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("hkwedge") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("housekeeping: qulf osilgan sessiyada — tiklash baribir, pul aynan bir marta", { skip }, async (t) => {
  const pg = (await import("pg")).default;
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { enqueueGeneration, claimJob, newLease } = await import("../lib/server/jobs.ts");
  const worker = await import("../lib/server/worker.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});

  // «Osilgan yetakchi»: qulfni oladi va boshqa hech narsa qilmaydi (ulanish tirik).
  const wedged = new pg.Client({ connectionString: process.env.DATABASE_URL });
  // Tashqaridan uzilsa (57P01) ushlanmagan `error` test processini yiqitmasin (review R2);
  // bunday holda qulf bo'shaydi va quyidagi «qulf band» tekshiruvi buni aniq ko'rsatadi.
  wedged.on("error", () => {});
  await wedged.connect();
  t.after(async () => {
    await wedged.end().catch(() => {});
    await worker.releaseHousekeepingLock();
    await pool().end().catch(() => {});
    await iso.drop();
  });
  const got = await wedged.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [worker.HOUSEKEEPING_LOCK_ID]);
  assert.equal(got.rows[0].ok, true);

  // Pul qaytarish skaneri faqat 022 dan keyin FAILED bo'lganlarni ko'radi — alohida bazada uni orqaga suramiz.
  await query(`UPDATE schema_migrations SET applied_at = now() - interval '2 days' WHERE name = '022_retention.sql'`);

  const uid = String(
    (
      await query<{ id: string }>(
        `INSERT INTO users (username, name, points, quota, balance) VALUES ('hkwedge', 'T', 0, 0, 100000) RETURNING id`,
      )
    )[0].id,
  );
  const enqueue = async () => {
    const r = await enqueueGeneration({
      userId: uid, toolId: "essay", topic: "Sinov", price: 3000, format: "docx", values: { topic: "Sinov" }, budgetMs: 60_000,
    });
    assert.ok(r.ok);
    return r.id;
  };

  // A: osilgan ish (o'lgan worker): IN_PROGRESS, 2-urinish, ijara 1 soat eski → FAILED + pul.
  const stale = await enqueue();
  const claimed = await claimJob(newLease("dead-worker"));
  assert.equal(claimed?.id, stale);
  await query(`UPDATE generations SET attempts = 2, locked_at = now() - interval '1 hour' WHERE id = $1`, [stale]);
  // B: navbatda bir kun kutgan ish → navbat muddati: FAILED + pul.
  const expired = await enqueue();
  await query(`UPDATE generations SET created_at = now() - interval '1 day' WHERE id = $1`, [expired]);
  // C: FAILED, lekin puli qaytmagan (alohida refund tranzaksiyasi yiqilgan) → skaner qaytaradi.
  const unrefunded = await enqueue();
  await query(
    `UPDATE generations SET status = 'FAILED', error = 'x', finished_at = now() - interval '1 hour' WHERE id = $1`,
    [unrefunded],
  );
  const balanceAfterCharges = Number((await query<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [uid]))[0].balance);
  assert.equal(balanceAfterCharges, 100_000 - 3 * 3000);

  let purges = 0;
  const run = async () => {
    purges += 1;
  };
  // Uch «boshqa process» tick'i parallel.
  const res = await Promise.all([worker.housekeepingTick({ run }), worker.housekeepingTick({ run }), worker.housekeepingTick({ run })]);
  assert.deepEqual(res, [false, false, false], "qulf band — og'ir tozalash yurmasligi kerak");
  assert.equal(purges, 0);

  for (const [name, id] of [["osilgan", stale], ["navbatda eskirgan", expired], ["puli qaytmagan", unrefunded]] as const) {
    const st = (await query<{ status: string }>(`SELECT status FROM generations WHERE id = $1`, [id]))[0].status;
    assert.equal(st, "FAILED", `${name}: tiklanmadi (holat ${st})`);
    const n = Number(
      (await query<{ n: string }>(`SELECT count(*) AS n FROM transactions WHERE kind = 'refund' AND reference = $1`, [id]))[0].n,
    );
    assert.equal(n, 1, `${name}: pul ${n} marta qaytdi (aynan 1 kutilgan)`);
  }
  const balance = Number((await query<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [uid]))[0].balance);
  assert.equal(balance, 100_000, "balans to'liq tiklanmadi yoki ortiqcha qaytdi");

  // Keyingi tick ham hech narsani ikkinchi marta qaytarmaydi.
  await worker.housekeepingTick({ run });
  const total = Number(
    (await query<{ n: string }>(`SELECT count(*) AS n FROM transactions WHERE kind = 'refund' AND user_id = $1`, [uid]))[0].n,
  );
  assert.equal(total, 3);
});
