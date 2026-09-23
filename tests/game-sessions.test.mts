import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/**
 * O'YIN SESSIYALARI (AUDIT-22 R0, C36 prod-readiness) — `lib/server/game-sessions.ts`.
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
 *   • IP manzil XESHLANADI `env.sessionSecret` bilan (loginsiz xizmatda
 *     maxfiylik talabi, DEPS-02 — qattiq yozilgan "slaydx" zaxirasi YO'Q);
 *   • `purgeExpiredSessions` NATIJASI BOR sessiyani O'CHIRMAYDI (BEA-08);
 *   • `listResults` HAQIQIY `count(*)` qaytaradi, sahifa emas (DB-15/BEA-16).
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
 *   6. `newToken` qisqartirildi — «token 22 belgi» testi;
 *   7. `ipHash` qayta `process.env.SESSION_SECRET ?? "slaydx"` ga
 *      qaytarilsa — «env.sessionSecret orqali» testi qizaradi;
 *   8. `purgeExpiredSessions` dan `NOT EXISTS` sharti olib tashlansa —
 *      «natijasi bor sessiya saqlanadi» testi qizaradi;
 *   9. `addResult` submissionId bilan ON CONFLICT o'rniga shartsiz
 *      INSERT qilsa — «takroriy submissionId — ikkinchi qator yo'q» testi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { env } = await import("../lib/server/env.ts");
const {
  PLAYER_NAME_MAX,
  RESULT_CAP_PER_SESSION,
  SESSION_TTL_DAYS,
  SUBMISSION_ID_RE,
  TOKEN_CHARS,
  TOKEN_RE,
  ResultCapError,
  addResult,
  createGameSession,
  getGameSessionByToken,
  ipHash,
  iterateAllResults,
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

test("listResults / listGameSessions: natijalar FAQAT egasiga (JOIN + user_id), HAQIQIY son (DB-15)", async (t) => {
  const seen = mockDb(t, (q) => {
    if (/count\(\*\)/.test(q)) return [{ n: "1" }];
    if (/FROM game_results/.test(q)) return [{ id: "r1", player_name: "Ali", score: 7, total: 10, seconds: 63, answers_json: { results: {} }, created_at: NOW }];
    return [sessionRow()];
  });

  const page = await listResults(GEN, USER);
  assert.equal(page.rows.length, 1);
  // MUTATSIYA: `total` ni `rows.length` bilan almashtirish — DB-15 ning
  // o'zi: bir necha havolaga tarqalgan 501+ natijada eng eskilari
  // "haqiqiy son"dan ham jimgina yo'qolib qolardi.
  assert.equal(page.total, 1, "HAQIQIY count(*) qaytmadi");
  assert.equal(page.nextCursor, null, "sahifa to'liq kelmadi — keyingisi bo'lmasligi kerak");
  assert.deepEqual(
    { name: page.rows[0].playerName, score: page.rows[0].score, total: page.rows[0].total, seconds: page.rows[0].seconds },
    { name: "Ali", score: 7, total: 10, seconds: 63 },
  );
  const sql = seen[0].text;
  assert.match(sql, /JOIN game_sessions s ON s\.id = r\.session_id/);
  // MUTATSIYA: `s.user_id = $2` ni olib tashlash — id ni bilgan begona
  // foydalanuvchi o'quvchilar ro'yxatini olardi.
  assert.match(sql, /WHERE s\.generation_id = \$1 AND s\.user_id = \$2/, "egalik tekshiruvi yo'q");
  assert.equal(seen[0].params[1], USER);

  await listGameSessions(GEN, USER);
  const lastSql = seen[seen.length - 1].text;
  assert.match(lastSql, /WHERE generation_id = \$1 AND user_id = \$2/);
});

test("listResults: sahifa TO'LIQ kelsa `nextCursor` beriladi, kursor SQL da ishlatiladi", async (t) => {
  const row1 = { id: "r1", player_name: "Ali", score: 1, total: 2, seconds: 5, answers_json: {}, created_at: NOW };
  const seen = mockDb(t, (q) => (/count\(\*\)/.test(q) ? [{ n: "5" }] : /FROM game_results/.test(q) ? [row1] : [sessionRow()]));

  const page1 = await listResults(GEN, USER, { limit: 1 });
  assert.ok(page1.nextCursor, "to'liq sahifa keyingi kursorsiz qaytdi");
  assert.deepEqual(page1.nextCursor, { createdAt: row1.created_at.toISOString(), id: row1.id });

  await listResults(GEN, USER, { limit: 1, before: page1.nextCursor! });
  const withCursor = seen.find((s) => /FROM game_results/.test(s.text) && /r\.created_at, r\.id\) < /.test(s.text));
  assert.ok(withCursor, "kursor SQL WHERE ga tushmadi");
  assert.deepEqual([withCursor!.params[3], withCursor!.params[4]], [page1.nextCursor!.createdAt, page1.nextCursor!.id]);
});

test("iterateAllResults: BARCHA qatorlarni partiyalab beradi (DB-15 — CSV kesilmasin)", async (t) => {
  // 2 ta partiya: 2+2+1 = 5 qator, batchSize=2.
  const allRows = Array.from({ length: 5 }, (_, i) => ({
    id: `r${i}`,
    player_name: `P${i}`,
    score: 1,
    total: 1,
    seconds: 1,
    answers_json: {},
    created_at: new Date(NOW.getTime() - i * 1000),
  }));
  let call = 0;
  mockDb(t, (q) => {
    if (/count\(\*\)/.test(q)) return [{ n: String(allRows.length) }];
    if (/FROM game_results/.test(q)) {
      const cursorApplied = /r\.created_at, r\.id\) < /.test(q);
      const start = cursorApplied ? call * 2 : 0;
      call += 1;
      return allRows.slice(start, start + 2);
    }
    return [sessionRow()];
  });

  const batches: string[][] = [];
  for await (const batch of iterateAllResults(GEN, USER, 2)) {
    batches.push(batch.map((r) => r.id));
  }
  const flat = batches.flat();
  assert.equal(flat.length, 5, "qator yo'qoldi — eski 500 chegarasi kabi");
  assert.deepEqual(new Set(flat).size, 5, "takrorlangan qator (kursor noto'g'ri surildi)");
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

test("addResult: submissionId bilan — TAKRORIY yuborish IKKINCHI qator YOZMAYDI (UX-06)", async (t) => {
  const sessionId = "11111111-0000-4000-8000-000000000001";
  const submissionId = "22222222-0000-4000-8000-000000000002";
  const insertedRow = { id: "r1", player_name: "Ali", score: 2, total: 3, seconds: 8, answers_json: {}, created_at: NOW };
  const seen = mockDb(t, (q) => {
    if (/SELECT id, player_name, score, total, seconds, answers_json, created_at\s+FROM game_results WHERE session_id = \$1 AND submission_id = \$2/.test(q)) {
      // Birinchi chaqiruvda hali yozilmagan (bo'sh) — INSERT davom etadi.
      return [];
    }
    if (/SELECT count\(\*\)::text AS n FROM game_results WHERE session_id = \$1/.test(q)) return [{ n: "0" }];
    if (/INSERT INTO game_results/.test(q)) return [insertedRow];
    return [];
  });

  const first = await addResult({ sessionId, submissionId, playerName: "Ali", score: 2, total: 3, seconds: 8, answers: {} });
  assert.equal(first.id, "r1");

  const insertSql = seen.find((s) => /INSERT INTO game_results/.test(s.text));
  assert.ok(insertSql, "INSERT chaqirilmadi");
  assert.match(insertSql!.text, /ON CONFLICT \(session_id, submission_id\) DO NOTHING/, "MUTATSIYA: shartsiz INSERT — takroriy qator yozilardi");
  assert.equal(insertSql!.params[8], submissionId, "submissionId parametrga tushmadi");

  // Endi "allaqachon yozilgan" holatni simulyatsiya qilamiz: SELECT existing qator qaytaradi.
  const seen2 = mockDb(t, (q) =>
    /submission_id = \$2/.test(q) && /^SELECT/.test(q) ? [insertedRow] : [],
  );
  const retry = await addResult({ sessionId, submissionId, playerName: "Ali", score: 999, total: 999, seconds: 999, answers: {} });
  // MUTATSIYA: mavjud qatorni tekshirmasdan yangisini INSERT qilish —
  // bu yerda `retry.score` yangi (999) bo'lib qolardi, eski (2) emas.
  assert.equal(retry.score, 2, "retry YANGI ball bilan qaytdi — dedupe ishlamayapti");
  assert.ok(!seen2.some((s) => /INSERT INTO game_results/.test(s.text)), "takroriy submissionId bilan baribir INSERT yuborildi");
});

test("addResult: submissionId bilan — sessiya chegarasiga yetgan bo'lsa `ResultCapError` (ABUSE-04)", async (t) => {
  const sessionId = "s-cap";
  mockDb(t, (q) => {
    if (/submission_id = \$2/.test(q) && /^SELECT/.test(q)) return []; // hali yozilmagan
    if (/count\(\*\)::text AS n/.test(q)) return [{ n: String(RESULT_CAP_PER_SESSION) }]; // chegaraga YETGAN
    return [];
  });
  await assert.rejects(
    () => addResult({ sessionId, submissionId: "33333333-0000-4000-8000-000000000003", playerName: "X", score: 1, total: 1, seconds: 1, answers: {} }),
    ResultCapError,
    "chegaraga yetgan sessiyada yangi natija yozildi",
  );
});

test("SUBMISSION_ID_RE / RESULT_CAP_PER_SESSION — shartnoma o'zgarmasin", () => {
  assert.equal(RESULT_CAP_PER_SESSION, 500);
  assert.ok(SUBMISSION_ID_RE.test("11111111-1111-4111-8111-111111111111"));
  assert.ok(!SUBMISSION_ID_RE.test("not-a-uuid"));
  assert.ok(!SUBMISSION_ID_RE.test(""));
});

test("ipHash: `env.sessionSecret` orqali — CALL VAQTIDAGI `process.env`ni EMAS (DEPS-02)", () => {
  // `env.ts` modul yuklanishida `process.env.SESSION_SECRET` ni O'QIB
  // KESHLAYDI (fayl boshida o'rnatilgan qiymat bilan). Endi shu qiymatni
  // JONLI o'zgartiramiz — eski (buzuq) kod `process.env.SESSION_SECRET
  // ?? "slaydx"` ni CHAQIRUV vaqtida o'qigani uchun bu YANGI qiymatni
  // ko'rardi; to'g'rilangan kod esa `env.sessionSecret` (keshlangan,
  // ESKI qiymat) ni ishlatadi — ikkalasi endi FARQ QILADI.
  const original = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const got = ipHash("9.9.9.9");
    const expected = createHash("sha256").update(`${env.sessionSecret}:9.9.9.9`).digest("hex").slice(0, 32);
    // MUTATSIYA: `env.sessionSecret` o'rniga `process.env.SESSION_SECRET`
    // qaytarilsa, `got` shu (yangi, "bbbb…") qiymatdan hisoblanardi va
    // quyidagi tenglik BUZILARDI.
    assert.equal(got, expected, "ipHash env.sessionSecret orqali ishlamayapti");
    const liveWrong = createHash("sha256").update(`${process.env.SESSION_SECRET}:9.9.9.9`).digest("hex").slice(0, 32);
    assert.notEqual(got, liveWrong, "ipHash JONLI process.env dan o'qiyapti — DEPS-02 tuzatilmagan");
    const hardcoded = createHash("sha256").update(`slaydx:9.9.9.9`).digest("hex").slice(0, 32);
    assert.notEqual(got, hardcoded, "qattiq yozilgan \"slaydx\" zaxirasi ishlatilyapti");
  } finally {
    process.env.SESSION_SECRET = original;
  }
});

test("purgeExpiredSessions: faqat muddati o'tgan VA NATIJASIZ havolalarni o'chiradi (BEA-08)", async (t) => {
  const seen = mockDb(t, []);
  await purgeExpiredSessions();
  const sql = seen[0].text;
  assert.match(sql, /DELETE FROM game_sessions/);
  assert.match(sql, /WHERE expires_at IS NOT NULL AND expires_at < now\(\)/);
  // MUTATSIYA: shartsiz `DELETE` — barcha havolalar o'chib ketardi.
  assert.ok(!/DELETE FROM game_sessions\s*$/.test(sql));
  // MUTATSIYA (BEA-08): `NOT EXISTS` sharti olib tashlansa — natijasi
  // BOR sessiya ham o'chib, natijalar FK CASCADE bilan yo'qolib ketardi.
  assert.match(
    sql,
    /AND NOT EXISTS \(SELECT 1 FROM game_results r WHERE r\.session_id = game_sessions\.id\)/,
    "natijasi bor sessiya himoyalanmagan",
  );
});
