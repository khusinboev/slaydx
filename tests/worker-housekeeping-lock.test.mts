import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * HOUSEKEEPING BITTA JOYDA (AUDIT prod-readiness SCALE-16, W4-B).
 *
 * Ilgari `housekeeping()` HAR worker processida har 60 s da ishlardi: 2
 * replika — har tozalash (reclaim, navbat muddati, sessiyalar, …) daqiqasiga
 * ikki marta, parallel. Endi sikl `housekeepingTick()` ni chaqiradi: u
 * Postgres advisory qulfini (`pg_try_advisory_lock`, alohida ulanishda)
 * OLADI yoki — boshqa process ushlab turgan bo'lsa — shu daqiqani O'TKAZIB
 * yuboradi. Qulfni olgan process uni ushlab turadi (yetakchi), ya'ni har
 * daqiqada aynan bitta process tozalaydi; u o'lsa ulanish uziladi, qulf
 * bo'shaydi va keyingi daqiqada boshqasi oladi.
 *
 * (W4-B review R1: qulf ortida endi faqat og'ir TOZALASHLAR — `run` seam'i;
 * ishlarni tiklash `recoverJobs` har processda qulfsiz yuradi,
 * `worker-housekeeping-wedge.test.mts`.)
 *
 * «Boshqa process» — shu testda qulfni ushlab turgan alohida `pg.Client`
 * (boshqa sessiya — Postgres uchun boshqa process bilan bir xil).
 *
 * MUTATSIYA: `pg_try_advisory_lock` natijasi tekshirilmasa (har doim
 * yuritilsa) — «qulf band → o'tkazib yuboriladi» testi qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("hklock") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("housekeepingTick: advisory qulf — bir vaqtda faqat bitta process", { skip }, async (t) => {
  const pg = (await import("pg")).default;
  const { pool } = await import("../lib/server/db.ts");
  const worker = await import("../lib/server/worker.ts");
  t.mock.method(console, "log", () => {});
  t.after(async () => {
    await worker.releaseHousekeepingLock();
    await pool().end().catch(() => {});
    await iso.drop();
  });

  let runs = 0;
  const run = async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 50));
  };

  await t.test("boshqa process qulfni ushlab tursa — o'tkazib yuboriladi", async () => {
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      const got = await other.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [worker.HOUSEKEEPING_LOCK_ID]);
      assert.equal(got.rows[0].ok, true);
      runs = 0;
      assert.equal(await worker.housekeepingTick({ run }), false);
      assert.equal(runs, 0, "MUTATSIYA: qulf band bo'lsa ham housekeeping yurdi");
    } finally {
      await other.end();
    }
  });

  await t.test("ikki parallel chaqiruv — faqat bittasi yuradi; yetakchi keyingi tickda ham yuradi", async () => {
    runs = 0;
    const res = await Promise.all([worker.housekeepingTick({ run }), worker.housekeepingTick({ run })]);
    assert.deepEqual(res.slice().sort(), [false, true], JSON.stringify(res));
    assert.equal(runs, 1);
    assert.equal(await worker.housekeepingTick({ run }), true, "yetakchi qulfni ushlab turishi kerak");
    assert.equal(runs, 2);
  });

  await t.test("yetakchi qulfni ushlab turganda boshqa sessiya ololmaydi; qo'yib yuborilgach — oladi", async () => {
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      const busy = await other.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [worker.HOUSEKEEPING_LOCK_ID]);
      assert.equal(busy.rows[0].ok, false, "ikkinchi process ham housekeeping qila olardi");
      await worker.releaseHousekeepingLock();
      const free = await other.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [worker.HOUSEKEEPING_LOCK_ID]);
      assert.equal(free.rows[0].ok, true, "qo'yib yuborilgan qulf bo'shamadi");
    } finally {
      await other.end();
    }
  });

  await t.test("yetakchining ulanishi uzilsa — keyingi tick qulfni qayta oladi", async () => {
    runs = 0;
    assert.equal(await worker.housekeepingTick({ run }), true);
    // Serverdan yetakchi sessiyani o'ldiramiz (DB qayta ishga tushishi / tarmoq uzilishi).
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_locks
          WHERE locktype = 'advisory' AND objid = $1 AND granted AND pid <> pg_backend_pid()`,
        [worker.HOUSEKEEPING_LOCK_ID],
      );
    } finally {
      await admin.end();
    }
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await worker.housekeepingTick({ run }), true, "uzilgan yetakchi qulfni tiklamadi");
    assert.equal(runs, 2);
  });

  await t.test("baza yo'q bo'lsa — xato tashlamaydi, false (sikl to'xtamasin)", async () => {
    await worker.releaseHousekeepingLock();
    t.mock.method(console, "error", () => {});
    t.mock.method(console, "warn", () => {});
    runs = 0;
    const down = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    };
    assert.equal(await worker.housekeepingTick({ run, connect: down }), false);
    assert.equal(runs, 0);
  });
});
