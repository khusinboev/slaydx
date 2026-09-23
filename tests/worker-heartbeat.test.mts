import test from "node:test";
import assert from "node:assert/strict";
import { stat, utimes, writeFile } from "node:fs/promises";

/**
 * WORKER «TIRIKLIK» FAYLI (W2 shartnomasi, `audit/designs/w2-contracts.md`).
 *
 * Worker sikli sog'lom ekan `/tmp/slaydx-worker-alive` ning mtime'ini kamida
 * har 30 s da yangilaydi; W2-D1 HEALTHCHECK: `find … -mmin -2 | grep -q .`.
 *
 * Alohida fayl: `stopWorker()` modul holatini qaytarib bo'lmaydigan qilib
 * o'zgartiradi. Baza stub (bo'sh navbat) — sikl `claimJob` dan `null` oladi.
 *
 * MUTATSIYA (tasdiqlangan): sikldagi `touchAlive()` chaqiruvi olib
 * tashlansa mtime eski qoladi va test qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const worker = await import("../lib/server/worker.ts");

test("worker sikli tiriklik faylini yangilaydi", async (t) => {
  assert.equal(worker.WORKER_ALIVE_FILE, "/tmp/slaydx-worker-alive", "shartnoma yo'li o'zgarmasligi kerak");
  t.mock.method(console, "log", () => {});
  const run = async () => ({ rows: [], rowCount: 0 });
  t.mock.method(pool(), "query", run);
  t.mock.method(pool(), "connect", async () => ({ query: run, release() {} }));

  // Faylni ataylab «eski» qilib qo'yamiz (1 soat oldin).
  await writeFile(worker.WORKER_ALIVE_FILE, "old");
  const old = new Date(Date.now() - 3_600_000);
  await utimes(worker.WORKER_ALIVE_FILE, old, old);

  worker.startInlineWorker();
  t.after(() => worker.stopWorker());

  let fresh = false;
  for (let i = 0; i < 100 && !fresh; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const s = await stat(worker.WORKER_ALIVE_FILE);
    fresh = Date.now() - s.mtimeMs < 30_000;
  }
  worker.stopWorker();
  // Sikl uyqudan chiqib to'xtashiga imkon beramiz.
  await new Promise((r) => setTimeout(r, 1700));
  assert.ok(fresh, "MUTATSIYA: sikl tiriklik faylini yangilamadi");
});
