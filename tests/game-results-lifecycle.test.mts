import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * O'YIN NATIJALARI — SAQLASH, TAKRORIY YUBORISH, CHEGARA, CSV (prod-readiness C36).
 *
 * `game-sessions.test.mts`/`game-routes.test.mts` SQL matnini stub bilan
 * qulflaydi; bu fayl esa HAQIQIY Postgres'da (alohida, vaqtinchalik baza)
 * BUTUN yo'lni yuradi — FK CASCADE, UNIQUE `(session_id, submission_id)`,
 * poyga holatlari faqat haqiqiy bazada ko'rinadi (stub ularni yashiradi).
 *
 * Qamrab olinadi:
 *   A. BEA-08 — havola muddati o'tsa ham NATIJALAR qoladi (natijasiz
 *      havola esa oldingidek tozalanadi);
 *   B. UX-06 — bir xil `submissionId` bilan ketma-ket VA parallel
 *      qayta yuborish — bitta qator, BIR XIL javob;
 *   C. ABUSE-04 — sessiya chegarasidan (`RESULT_CAP_PER_SESSION`) keyin
 *      409, aniq xabar bilan;
 *   D. DB-15/BEA-16 — 700 qatorli CSV eksporti HAMMASINI beradi,
 *      JSON `total` HAQIQIY son;
 *   E. BEA-10 — o'ynaladigan savoli yo'q hujjatga havola so'ralsa 4xx;
 *   F. R1 (ko'rib chiqish) — bir millisoniyaga tushgan, turli
 *      mikrosoniyali qatorlar kursor sahifalashda tashlab ketilmaydi.
 *
 * Faqat vaqtinchalik test bazasi: `DATABASE_URL=postgres://slaydx:audit@127.0.0.1:55439/slaydx`
 * (yoki `createIsolatedDb` shu server ustida YANGI, bo'sh baza ochadi).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.APP_URL = "http://localhost:3000";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("game-lifecycle") : { isolated: false, drop: async () => {} };

test("o'yin natijalari: saqlash, takroriy yuborish, chegara, CSV/sahifalash, o'ynalmaydigan hujjat", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const gameSessions = await import("../lib/server/game-sessions.ts");
  const shareRoute = await import("../app/api/generations/[id]/share/route.ts");
  const resultsRoute = await import("../app/api/generations/[id]/results/route.ts");
  const submitRoute = await import("../app/api/o/[token]/submit/route.ts");
  const { sampleTeacherDoc } = await import("../lib/generation/teacher/samples.ts");

  await migrate();

  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mkUser = async (tag: string) => {
    const suffix = `game-life-${tag}-${stamp}`;
    const u = await queryOne<{ id: string }>(
      `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id::text AS id`,
      [suffix],
    );
    const uid = String(u!.id);
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const playableDoc = sampleTeacherDoc("test");
  // BEA-10: faqat "Ochiq savol" (`open`) qolsin — `publicGameView` buni
  // chiqarmaydi (serverda avtomatik baholab bo'lmaydi), ya'ni hujjat
  // "o'ynaladigan" vosita turi bo'lsa ham HAQIQIY o'ynaladigan savoli yo'q.
  const nonPlayableDoc = structuredClone(sampleTeacherDoc("test"));
  nonPlayableDoc.teacher!.test!.questions = nonPlayableDoc.teacher!.test!.questions.filter((q) => q.kind === "open");
  assert.ok(nonPlayableDoc.teacher!.test!.questions.length > 0, "namunada 'open' savol yo'q — sinov asosi noto'g'ri");

  const mkGeneration = async (uid: string, doc: unknown) => {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, doc_json)
       VALUES ($1, $2, 'test', 'Sinov testi', 'COMPLETED', $3::jsonb)`,
      [id, uid, JSON.stringify(doc)],
    );
    return id;
  };

  const doShare = (genId: string, cookie: string) => {
    const req = new Request(`http://localhost:3000/api/generations/${genId}/share`, { method: "POST", headers: { cookie }, body: "{}" });
    return inRequest(req, () => shareRoute.POST(req, { params: Promise.resolve({ id: genId }) }));
  };

  const doSubmit = (token: string, body: unknown) => {
    const req = new Request(`http://localhost:3000/api/o/${token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return submitRoute.POST(req, { params: Promise.resolve({ token }) });
  };

  const doResults = (genId: string, cookie: string, qs = "") => {
    const req = new Request(`http://localhost:3000/api/generations/${genId}/results${qs}`, { headers: { cookie } });
    return inRequest(req, () => resultsRoute.GET(req, { params: Promise.resolve({ id: genId }) }));
  };

  /* ══════════════════════════ A. BEA-08 — natijalar havola muddatidan OMON QOLADI ══════════════════════════ */

  await t.test("A. havola muddati o'tsa ham NATIJALAR qoladi; natijasiz havola tozalanadi", async () => {
    const owner = await mkUser("a-owner");
    const gen = await mkGeneration(owner.uid, playableDoc);

    const shared = await doShare(gen, owner.cookie);
    assert.equal(shared.status, 200, "havola yaratilmadi");
    const { token } = (await shared.json()) as { token: string };

    const submitted = await doSubmit(token, { name: "Ali", answers: {}, seconds: 5, submissionId: crypto.randomUUID() });
    assert.equal(submitted.status, 200, "natija yozilmadi");

    // Ikkinchi, NATIJASIZ havola — solishtirish uchun.
    const emptyShared = await doShare(gen, owner.cookie);
    const { token: emptyToken } = (await emptyShared.json()) as { token: string };

    // Ikkalasini ham "muddati o'tgan" qilamiz.
    await query(`UPDATE game_sessions SET expires_at = now() - interval '1 day' WHERE token IN ($1, $2)`, [token, emptyToken]);

    await gameSessions.purgeExpiredSessions();

    // Natijasi BOR sessiya — TURIBDI (natijalar bilan birga).
    const survivor = await queryOne<{ id: string }>(`SELECT id FROM game_sessions WHERE token = $1`, [token]);
    assert.ok(survivor, "MUTATSIYA: natijasi bor havola ham o'chirilgan — BEA-08 tuzatilmagan");
    const rows = await query(`SELECT r.id FROM game_results r JOIN game_sessions s ON s.id = r.session_id WHERE s.token = $1`, [token]);
    assert.equal(rows.length, 1, "natija sessiya bilan birga o'chib ketdi");

    // Egasi paneli ham hali ko'radi (route darajasida).
    const res = await doResults(gen, owner.cookie);
    const body = (await res.json()) as { results: { playerName: string }[]; total: number };
    assert.equal(body.total, 1, "egasi paneli natijani yo'qotdi");
    assert.equal(body.results[0]?.playerName, "Ali");

    // Natijasiz sessiya — ODATDAGIDEK tozalanadi.
    const emptySurvivor = await queryOne<{ id: string }>(`SELECT id FROM game_sessions WHERE token = $1`, [emptyToken]);
    assert.equal(emptySurvivor, null, "natijasiz muddati o'tgan havola tozalanmadi");
  });

  /* ══════════════════════════ B. UX-06 — TAKRORIY yuborish (idempotent) ══════════════════════════ */

  await t.test("B. bir xil submissionId — ketma-ket VA parallel — BITTA qator, BIR XIL javob", async () => {
    const owner = await mkUser("b-owner");
    const gen = await mkGeneration(owner.uid, playableDoc);
    const shared = await doShare(gen, owner.cookie);
    const { token } = (await shared.json()) as { token: string };

    const submissionId = crypto.randomUUID();
    const body = { name: "Zilola", answers: {}, seconds: 12, submissionId };

    // Ketma-ket: ikkinchi so'rov "Qayta yuborish" (tarmoq xatosidan keyin).
    const r1 = await doSubmit(token, body);
    const j1 = (await r1.json()) as { score: number; total: number; percent: number };
    const r2 = await doSubmit(token, body);
    const j2 = (await r2.json()) as { score: number; total: number; percent: number };
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.deepEqual(j2, j1, "MUTATSIYA: takroriy yuborish YANGI (boshqa) javob qaytardi");

    const rows1 = await query(`SELECT r.id FROM game_results r JOIN game_sessions s ON s.id = r.session_id WHERE s.token = $1`, [token]);
    assert.equal(rows1.length, 1, "ketma-ket takroriy so'rov IKKINCHI qator yozdi");

    // Parallel: ikkita so'rov BIR VAQTDA, AYNI submissionId (yangi urinish).
    const submissionId2 = crypto.randomUUID();
    const body2 = { name: "Zilola", answers: {}, seconds: 9, submissionId: submissionId2 };
    const [pr1, pr2] = await Promise.all([doSubmit(token, body2), doSubmit(token, body2)]);
    assert.equal(pr1.status, 200);
    assert.equal(pr2.status, 200);
    const [pj1, pj2] = await Promise.all([pr1.json(), pr2.json()]);
    assert.deepEqual(pj1, pj2, "parallel poyga — ikkita xil javob qaytdi");

    const rows2 = await query(
      `SELECT r.id FROM game_results r JOIN game_sessions s ON s.id = r.session_id WHERE s.token = $1 AND r.submission_id = $2`,
      [token, submissionId2],
    );
    assert.equal(rows2.length, 1, "MUTATSIYA: parallel poyga IKKI qator yozdi — ON CONFLICT ishlamayapti");

    // Registr (Sharh R3, probe: `submissionId.toUpperCase()` ikkinchi qator
    // ochardi): AYNI id, katta harf bilan — IKKINCHI qator YO'Q.
    const idMixed = crypto.randomUUID();
    const lower = await doSubmit(token, { name: "Country", answers: {}, seconds: 3, submissionId: idMixed });
    assert.equal(lower.status, 200);
    const upper = await doSubmit(token, { name: "Country", answers: {}, seconds: 3, submissionId: idMixed.toUpperCase() });
    assert.equal(upper.status, 200);
    assert.deepEqual(await upper.json(), await lower.json(), "registr farqli id boshqa javob qaytardi");
    const rowsCase = await query(
      `SELECT r.id FROM game_results r JOIN game_sessions s ON s.id = r.session_id WHERE s.token = $1 AND r.submission_id = $2`,
      [token, idMixed.toLowerCase()],
    );
    assert.equal(rowsCase.length, 1, "MUTATSIYA (R3): registr farqli id IKKINCHI qator yaratdi");

    // submissionId YO'Q (Sharh R3) — eski/keshlangan klient: 400 EMAS,
    // server o'zi id yaratadi va urinish baribir yoziladi.
    const noId = await doSubmit(token, { name: "EskiKlient", answers: {}, seconds: 2 });
    assert.equal(noId.status, 200, "MUTATSIYA: submissionId yo'qligi 400 qaytardi — eski klient urinishni yo'qotardi");
  });

  /* ══════════════════════════ C. ABUSE-04 — sessiya chegarasi ══════════════════════════ */

  await t.test("C. sessiya RESULT_CAP_PER_SESSION ga yetsa — 409, aniq xabar", async () => {
    const owner = await mkUser("c-owner");
    const gen = await mkGeneration(owner.uid, playableDoc);
    const shared = await doShare(gen, owner.cookie);
    const { token } = (await shared.json()) as { token: string };
    const sessRow = await queryOne<{ id: string }>(`SELECT id FROM game_sessions WHERE token = $1`, [token]);

    // To'g'ridan-to'g'ri SQL bilan chegaragacha to'ldiramiz (500 ta HTTP
    // so'rov yubormasdan) — `addResult`ning o'zi sinaladi, faqat hajm tez.
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < gameSessions.RESULT_CAP_PER_SESSION; i++) {
      const base = params.length;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, 0, 0, '{}'::jsonb, 0)`);
      params.push(crypto.randomUUID(), sessRow!.id, `P${i}`);
    }
    await query(`INSERT INTO game_results (id, session_id, player_name, score, total, answers_json, seconds) VALUES ${values.join(",")}`, params);

    const res = await doSubmit(token, { name: "Oxirgi", answers: {}, seconds: 1, submissionId: crypto.randomUUID() });
    assert.equal(res.status, 409, "MUTATSIYA: chegaradan oshgan natija baribir qabul qilindi");
    const body = (await res.json()) as { error: string; code?: string };
    assert.equal(body.code, "result_cap");
    assert.ok(body.error && body.error.length > 0, "xato xabari bo'sh");

    const countRow = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM game_results WHERE session_id = $1`, [sessRow!.id]);
    assert.equal(Number(countRow!.n), gameSessions.RESULT_CAP_PER_SESSION, "chegaradan oshgan qator baribir yozildi");
  });

  /* ══════════════════════════ D. DB-15/BEA-16 — 700 qatorli CSV/sahifalash ══════════════════════════ */

  await t.test("D. 700 natija — CSV BARCHASINI beradi, JSON `total` HAQIQIY", async () => {
    const owner = await mkUser("d-owner");
    const gen = await mkGeneration(owner.uid, playableDoc);
    // Ikkita havola (har biri < 500 chegara), jami 700 — generatsiya
    // darajasida eski qattiq `LIMIT 500` buzilgan bo'lardi.
    const s1 = await doShare(gen, owner.cookie);
    const { token: t1 } = (await s1.json()) as { token: string };
    const s2 = await doShare(gen, owner.cookie);
    const { token: t2 } = (await s2.json()) as { token: string };
    const sid1 = (await queryOne<{ id: string }>(`SELECT id FROM game_sessions WHERE token = $1`, [t1]))!.id;
    const sid2 = (await queryOne<{ id: string }>(`SELECT id FROM game_sessions WHERE token = $1`, [t2]))!.id;

    const insertBatch = async (sessionId: string, n: number, offset: number) => {
      const values: string[] = [];
      const params: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const base = params.length;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, 1, 1, '{}'::jsonb, 0, now() + ($${base + 4} || ' seconds')::interval)`);
        params.push(crypto.randomUUID(), sessionId, `Q${offset + i}`, String(offset + i));
      }
      await query(
        `INSERT INTO game_results (id, session_id, player_name, score, total, answers_json, seconds, created_at) VALUES ${values.join(",")}`,
        params,
      );
    };
    await insertBatch(sid1, 400, 0);
    await insertBatch(sid2, 300, 400);

    const jsonRes = await doResults(gen, owner.cookie);
    const jsonBody = (await jsonRes.json()) as { total: number; results: unknown[] };
    assert.equal(jsonBody.total, 700, "MUTATSIYA: `total` haqiqiy son emas — DB-15");

    const csvRes = await doResults(gen, owner.cookie, "?format=csv");
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    const lines = csvText.replace(/^﻿/, "").split("\r\n").filter(Boolean);
    // 1 sarlavha + 700 ma'lumot qatori.
    assert.equal(lines.length, 701, `MUTATSIYA: CSV kesilgan (${lines.length - 1} qator, 700 kutilgan) — DB-15/BEA-16`);
  });

  /* ══════════════════════════ F. R1 — mikrosoniya aniqlikdagi kursor ══════════════════════════ */

  await t.test("F. bir millisoniyaga tushgan (turli mikrosoniyali) qatorlar TASHLAB KETILMAYDI", async () => {
    const owner = await mkUser("f-owner");
    const gen = await mkGeneration(owner.uid, playableDoc);
    const shared = await doShare(gen, owner.cookie);
    const { token } = (await shared.json()) as { token: string };
    const sid = (await queryOne<{ id: string }>(`SELECT id FROM game_sessions WHERE token = $1`, [token]))!.id;

    /*
     * 4 qator, BIR XIL millisoniya (`.123`), TURLI mikrosoniya — sharh
     * probasi aynan shu holatda `iterateAllResults(batch=1)` 4 tadan
     * 2 tasini qaytargan edi (JS `toISOString()` mikrosoniyani kesadi).
     */
    const micros = ["123450", "123451", "123452", "123453"];
    for (const [i, m] of micros.entries()) {
      await query(
        `INSERT INTO game_results (id, session_id, player_name, score, total, answers_json, seconds, created_at)
         VALUES ($1, $2, $3, 0, 0, '{}'::jsonb, 0, ($4)::timestamptz)`,
        [crypto.randomUUID(), sid, `M${i}`, `2026-01-01T12:00:00.${m}Z`],
      );
    }

    // `batchSize=1` — sahifa chegarasi AYNAN shu 4 qator ichida bo'lsin.
    const namesViaIterator: string[] = [];
    for await (const row of gameSessions.iterateAllResultRows(gen, owner.uid, 1)) {
      if (row.playerName.startsWith("M")) namesViaIterator.push(row.playerName);
    }
    assert.equal(namesViaIterator.length, 4, `MUTATSIYA (R1): iterateAllResultRows ${namesViaIterator.length}/4 qator qaytardi`);
    assert.equal(new Set(namesViaIterator).size, 4, "takrorlangan qator bor");

    // AYNI narsa HAQIQIY CSV oqimi orqali ham (route darajasida).
    const csvRes = await doResults(gen, owner.cookie, "?format=csv");
    const csvText = await csvRes.text();
    const mLines = csvText.split("\r\n").filter((l) => /"M\d"/.test(l));
    assert.equal(mLines.length, 4, `MUTATSIYA (R1): CSV eksportida ${mLines.length}/4 «M» qatori bor`);
  });

  /* ══════════════════════════ E. BEA-10 — o'ynaladigan savoli yo'q hujjat ══════════════════════════ */

  await t.test("E. o'ynaladigan savoli yo'q hujjatga havola — 4xx, hech narsa yaratilmaydi", async () => {
    const owner = await mkUser("e-owner");
    const gen = await mkGeneration(owner.uid, nonPlayableDoc);
    const res = await doShare(gen, owner.cookie);
    assert.ok(res.status >= 400 && res.status < 500, `4xx kutilgan edi, ${res.status} keldi`);
    const body = (await res.json()) as { error: string; code?: string };
    assert.equal(body.code, "not_playable");

    const sessions = await query(`SELECT id FROM game_sessions WHERE generation_id = $1`, [gen]);
    assert.equal(sessions.length, 0, "MUTATSIYA: o'ynalmaydigan hujjatga baribir havola yaratildi — BEA-10");
  });
});
