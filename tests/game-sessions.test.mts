import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * O'YIN SESSIYALARI (AUDIT-22 R0) — `lib/server/game-sessions.ts`.
 *
 * Bazasiz: `pool()` ning `query` i stub qilinadi (`article-polish-route`
 * naqshi) va SQL MATNI tekshiriladi. Bu yerda qulflanadigan narsa —
 * SHARTNOMA:
 *
 *   • EGALIK SQL DARAJASIDA (`WHERE … user_id = $`) — route tekshiruvi
 *     yetarli emas (CLAUDE.md, AUDIT-4 N-1);
 *   • token 22 belgi va har safar boshqa;
 *   • muddat SQL da (`expires_at > now()`), dasturda emas;
 *   • ism va soniya YOZISHDAN OLDIN kesiladi;
 *   • IP manzil XESHLANADI (loginsiz xizmatda maxfiylik talabi).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `createGameSession` da `g.user_id = $3` shartini olib tashlash —
 *      «begona generatsiyaga havola» testi (SQL matni skani);
 *   2. `getGameSessionByToken` dagi `expires_at > now()` olib tashlandi —
 *      «muddat SQL da» testi;
 *   3. `addResult` da ism kesilmadi — «ism 40 belgidan uzun emas» testi;
 *   4. `ipHash` IP ning o'zini yozdi — «IP xeshlanadi» testi;
 *   5. `listResults` dagi `JOIN … s.user_id = $2` tushdi — «natijalar
 *      faqat egasiga» testi;
 *   6. `newToken` qisqartirildi — «token 22 belgi» testi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const {
  PLAYER_NAME_MAX,
  SESSION_TTL_DAYS,
  TOKEN_CHARS,
  TOKEN_RE,
  addResult,
  createGameSession,
  getGameSessionByToken,
  ipHash,
  listGameSessions,
  listResults,
  newToken,
  purgeExpiredSessions,
} = await import("../lib/server/game-sessions.ts");

type Seen = { text: string; params: unknown[] };
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const NOW = new Date("2026-09-17T10:00:00.000Z");
const GEN = "a1b2c3d4-0000-4000-8000-000000000001";
const USER = "42";

function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    generation_id: GEN,
    user_id: USER,
    token: "aaaaaaaaaaaaaaaaaaaaaa",
    kind: "sorting",
    settings_json: {},
    expires_at: new Date("2026-10-17T10:00:00.000Z"),
    created_at: NOW,
    ...over,
  };
}

/** Har SQL ni yozib boradigan stub; javob `rows` bilan beriladi. */
function mockDb(t: TestContext, rows: unknown[] | ((q: string) => unknown[])): Seen[] {
  const seen: Seen[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text: norm(text), params });
    const out = typeof rows === "function" ? rows(norm(text)) : rows;
    return { rows: out, rowCount: out.length };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

test("token: 22 belgi, base64url, har safar boshqa", () => {
  const a = newToken();
  const b = newToken();
  assert.equal(a.length, TOKEN_CHARS, `token uzunligi ${a.length}`);
  assert.equal(TOKEN_CHARS, 22);
  assert.notEqual(a, b, "token takrorlandi — havolalar to'qnashardi");
  assert.match(a, /^[A-Za-z0-9_-]+$/, "URL da xavfsiz bo'lmagan belgi");
  assert.ok(TOKEN_RE.test(a));
  // Shakl tekshiruvi: juda qisqa yoki yot belgili token qabul qilinmaydi.
  for (const bad of ["", "abc", "a".repeat(100), "token/with/slash", "token?x=1", "../../etc"]) {
    assert.ok(!TOKEN_RE.test(bad), `«${bad}» qabul qilindi`);
  }
});

test("createGameSession: egalik SQL da, muddat 30 kun, token yoziladi", async (t) => {
  const seen = mockDb(t, [sessionRow()]);
  const s = await createGameSession(GEN, USER, "sorting", { attempts: 3 });
  assert.ok(s, "sessiya yaratilmadi");
  assert.equal(s!.generationId, GEN);
  assert.equal(s!.kind, "sorting");

  const sql = seen[0].text;
  assert.match(sql, /INSERT INTO game_sessions/);
  // MUTATSIYA: egalik shartini olib tashlash shu yerda qizaradi.
  assert.match(sql, /WHERE g\.id = \$2 AND g\.user_id = \$3/, "egalik SQL darajasida tekshirilmayapti");
  assert.match(sql, /g\.status = 'COMPLETED'/, "tayyor bo'lmagan ishga havola berilardi");
  assert.match(sql, /now\(\) \+ \(\$7 \|\| ' days'\)::interval/, "muddat SQL da qo'yilmadi");
  assert.equal(seen[0].params[6], String(SESSION_TTL_DAYS));
  assert.equal(seen[0].params[1], GEN);
  assert.equal(seen[0].params[2], USER);
  assert.equal(String(seen[0].params[3]).length, TOKEN_CHARS, "token parametrga tushmadi");
  assert.equal(seen[0].params[5], JSON.stringify({ attempts: 3 }), "sozlamalar yozilmadi");
});

test("createGameSession: begona/nomavjud generatsiya — `null` (route 404 qiladi)", async (t) => {
  mockDb(t, []);
  assert.equal(await createGameSession(GEN, "999", "quiz"), null);
});

test("getGameSessionByToken: muddat SQL da, hujjat bitta so'rovda keladi", async (t) => {
  const seen = mockDb(t, [{ ...sessionRow(), doc_json: { meta: { topic: "X" } }, topic: "Hayvonlar", status: "COMPLETED" }]);
  const s = await getGameSessionByToken("aaaaaaaaaaaaaaaaaaaaaa");
  assert.ok(s);
  assert.equal(s!.topic, "Hayvonlar");
  assert.equal(s!.status, "COMPLETED");
  assert.ok(s!.doc, "hujjat qaytmadi — ikkinchi SQL kerak bo'lardi");

  const sql = seen[0].text;
  // MUTATSIYA: muddat shartini olib tashlash — tarqalib ketgan havola
  // abadiy ochiq qolardi.
  assert.match(sql, /expires_at IS NULL OR s\.expires_at > now\(\)/, "muddat tekshirilmayapti");
  assert.match(sql, /JOIN generations g ON g\.id = s\.generation_id/);
  assert.equal(seen[0].params[0], "aaaaaaaaaaaaaaaaaaaaaa");
});

test("getGameSessionByToken: yaroqsiz token — SQL UMUMAN yuborilmaydi", async (t) => {
  const seen = mockDb(t, []);
  for (const bad of ["", "abc", "yot/token", "a".repeat(200)]) {
    assert.equal(await getGameSessionByToken(bad), null, `«${bad}»`);
  }
  assert.equal(seen.length, 0, "yaroqsiz token bilan bazaga so'rov ketdi");
});

test("listResults / listGameSessions: natijalar FAQAT egasiga (JOIN + user_id)", async (t) => {
  const seen = mockDb(t, (q) =>
    /FROM game_results/.test(q)
      ? [{ id: "r1", player_name: "Ali", score: 7, total: 10, seconds: 63, answers_json: { results: {} }, created_at: NOW }]
      : [sessionRow()],
  );

  const rows = await listResults(GEN, USER);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { name: rows[0].playerName, score: rows[0].score, total: rows[0].total, seconds: rows[0].seconds },
    { name: "Ali", score: 7, total: 10, seconds: 63 },
  );
  const sql = seen[0].text;
  assert.match(sql, /JOIN game_sessions s ON s\.id = r\.session_id/);
  // MUTATSIYA: `s.user_id = $2` ni olib tashlash — id ni bilgan begona
  // foydalanuvchi o'quvchilar ro'yxatini olardi.
  assert.match(sql, /WHERE s\.generation_id = \$1 AND s\.user_id = \$2/, "egalik tekshiruvi yo'q");
  assert.equal(seen[0].params[1], USER);

  await listGameSessions(GEN, USER);
  assert.match(seen[1].text, /WHERE generation_id = \$1 AND user_id = \$2/);
});

test("addResult: ism/soniya kesiladi, IP XESHLANADI, javoblar JSON bo'lib ketadi", async (t) => {
  const seen = mockDb(t, [
    { id: "r1", player_name: "x", score: 3, total: 5, seconds: 10, answers_json: { results: {} }, created_at: NOW },
  ]);
  const long = "A".repeat(200);
  const r = await addResult({
    sessionId: "11111111-0000-4000-8000-000000000001",
    playerName: `   ${long}   `,
    score: 3.7,
    total: 5,
    seconds: 10.2,
    answers: { results: { i1: true } },
    ipHash: ipHash("1.2.3.4"),
  });
  assert.equal(r.playerName.length, PLAYER_NAME_MAX, "ism kesilmadi");
  assert.equal(r.score, 4, "ball yaxlitlanmadi");

  const sql = seen[0].text;
  assert.match(sql, /INSERT INTO game_results/);
  assert.equal(String(seen[0].params[2]).length, PLAYER_NAME_MAX);
  assert.equal(seen[0].params[5], JSON.stringify({ results: { i1: true } }));
  assert.equal(seen[0].params[6], 10, "soniya yaxlitlanmadi");
  // MUTATSIYA: `ipHash` o'rniga IP ning o'zini yozish shu yerda ko'rinadi.
  const written = String(seen[0].params[7]);
  assert.ok(!written.includes("1.2.3.4"), "IP manzil ochiq yozildi");
  assert.match(written, /^[0-9a-f]{32}$/, "xesh shakli boshqa");
  assert.equal(written, ipHash("1.2.3.4"), "xesh deterministik emas");
  assert.notEqual(ipHash("1.2.3.4"), ipHash("1.2.3.5"));

  // Bo'sh ism — «Noma'lum» (jadvalda bo'sh qator qolmasin).
  await addResult({ sessionId: "s", playerName: "   ", score: 0, total: 0, seconds: 0, answers: {} });
  assert.equal(seen[1].params[2], "Noma'lum");
  // Manfiy/aqldan tashqari qiymatlar chegaraga tushadi.
  await addResult({ sessionId: "s", playerName: "B", score: -5, total: -1, seconds: 999_999, answers: {} });
  assert.deepEqual([seen[2].params[3], seen[2].params[4], seen[2].params[6]], [0, 0, 86_400]);
});

test("purgeExpiredSessions: faqat muddati o'tganlarini o'chiradi", async (t) => {
  const seen = mockDb(t, []);
  await purgeExpiredSessions();
  assert.match(seen[0].text, /DELETE FROM game_sessions WHERE expires_at IS NOT NULL AND expires_at < now\(\)/);
  // MUTATSIYA: shartsiz `DELETE` — barcha havolalar o'chib ketardi.
  assert.ok(!/DELETE FROM game_sessions\s*$/.test(seen[0].text));
});
