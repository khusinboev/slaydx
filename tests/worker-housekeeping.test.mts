import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * WORKER HOUSEKEEPING — O'YIN HAVOLALARI TOZALASH (AUDIT-22 R).
 *
 * `game-sessions.test.mts` `purgeExpiredSessions`ning O'ZINI (SQL matni)
 * qulflaydi; bu fayl esa ULANISHNI — `lib/server/worker.ts housekeeping()`
 * uni haqiqatan CHAQIRADIMI. Ikkalasi kerak: funksiya to'g'ri yozilib,
 * lekin hech kim chaqirmasa, muddati o'tgan havolalar bazada abadiy
 * qolib ketardi (`game-sessions.ts` izohi — 128 bit token, lekin
 * muddatsiz saqlash o'zi maxfiylik yuki).
 *
 * `pool().query`/`connect` STUBLANADI (`game-sessions.test.mts` naqshi,
 * server importi bazasiz test): bazaga ulanmasdan, HAR chaqirilgan SQL
 * matni yig'iladi va o'yin sessiyasi jadvaliga tegishli `DELETE`
 * qatori borligi tekshiriladi.
 *
 * MUTATSIYA (tasdiqlangan): `housekeeping()` ichidan `purgeExpiredGameSessions()`
 * chaqiruvi olib tashlansa — `DELETE FROM game_sessions …` matni
 * umuman yozilmaydi va test qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { housekeeping } = await import("../lib/server/worker.ts");

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Har SQL ni yozib boradigan stub; barcha so'rovga bo'sh natija beriladi. */
function mockDb(t: TestContext): string[] {
  const seen: string[] = [];
  const run = async (text: string) => {
    seen.push(norm(text));
    return { rows: [], rowCount: 0 };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

test("housekeeping(): muddati o'tgan O'YIN havolalari ham tozalanadi (`game_sessions`)", async (t) => {
  const seen = mockDb(t);
  await housekeeping();
  // MUTATSIYA: `purgeExpiredGameSessions()` chaqiruvi olib tashlansa bu qator topilmaydi.
  assert.ok(
    seen.some((q) => /DELETE FROM game_sessions WHERE expires_at IS NOT NULL AND expires_at < now\(\)/.test(q)),
    "MUTATSIYA: worker housekeeping o'yin sessiyalarini tozalamayapti",
  );
  // Eski AUTH sessiyalari (`session.ts`, boshqa jadval) ham DAVOM ETADI —
  // alias yangi funksiyani eskisi O'RNIGA emas, YONIDA qo'shgan.
  assert.ok(
    seen.some((q) => /DELETE FROM sessions WHERE/.test(q)),
    "MUTATSIYA: auth sessiyalarini tozalash yo'qoldi (alias eskisini almashtirib qo'ydi)",
  );
  // Boshqa housekeeping vazifalari ham baribir ishlaydi (bittasi butun
  // funksiyani to'xtatib qo'ymasin).
  assert.ok(seen.some((q) => /DELETE FROM source_uploads/.test(q)), "manba fayllari tozalanmadi");
  assert.ok(seen.some((q) => /DELETE FROM photo_uploads/.test(q)), "rezyume suratlari tozalanmadi");
});

test("housekeeping(): `source_cache` 60 kundan eskisi tozalanadi (EXT-08); foydalanilmagan logotip/shablon tozalash ULANMAGAN (egasi qarori)", async (t) => {
  const seen = mockDb(t);
  await housekeeping();
  // MUTATSIYA: `step("source-cache", …)` olib tashlansa bu qator topilmaydi.
  assert.ok(
    seen.some((q) => /DELETE FROM source_cache WHERE key IN \(SELECT key FROM source_cache WHERE fetched_at < now\(\)/.test(q)),
    "MUTATSIYA: worker `source_cache` ni tozalamayapti",
  );
  // `purgeUnusedUploads` eksport qilingan va sinalgan, lekin muddati egasi qaroriga bog'liq.
  assert.ok(!seen.some((q) => /DELETE FROM (logo|template)_uploads/.test(q)), "logotip/shablon tozalash egasi qarorisiz ulangan");
});
