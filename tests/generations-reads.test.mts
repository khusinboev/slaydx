import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Issiq o'qish yo'llari (prod-readiness C09: BEA-06, DB-03, SCALE-03,
 * CONC-18, FE-08, SCALE-12) — HAQIQIY route'lar orqali, Postgres'da.
 *
 * Ilgari:
 *   - ro'yxat (`GET /api/generations`) va poll (`GET /api/generations/{id}`)
 *     `values_json` ni (200 000 belgigacha `sourceText`) o'qib, keyin
 *     TASHLAB yuborardi — har 3 soniyada;
 *   - ro'yxat faqat eng yangi 100 tasini berardi, eskisiga yo'l yo'q edi;
 *   - tayyor hujjat pollida `doc` va `html` ikkalasi (bir hujjat ikki marta).
 *
 * Shartnoma (`audit/designs/w2-contracts.md`): `?cursor=&limit=1..100`
 * (standart 50), javob kaliti `generations` o'zgarmaydi + `nextCursor`;
 * poll QUEUED bo'lsa `queuePosition` (1 dan) va `etaSec`.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("reads") : { isolated: false, drop: async () => {} };

type Seen = string[];

/** Hovuzdagi HAQIQIY so'rovlarni o'zgartirmasdan yozib boradi. */
async function spySql(t: TestContext): Promise<Seen> {
  const { pool } = await import("../lib/server/db.ts");
  const p = pool();
  const orig = p.query.bind(p) as (...a: unknown[]) => Promise<unknown>;
  const seen: Seen = [];
  t.mock.method(p, "query", (text: unknown, params?: unknown) => {
    seen.push(typeof text === "string" ? text.replace(/\s+/g, " ") : String((text as { text?: string }).text));
    return orig(text, params);
  });
  return seen;
}

test("ro'yxat va poll: values_json yo'q, kursor sahifalash, navbat o'rni", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const listRoute = await import("../app/api/generations/route.ts");
  const itemRoute = await import("../app/api/generations/[id]/route.ts");
  await migrate();
  // 022_retention.sql (W2-D2) bu tarmoqda hali yo'q bo'lishi mumkin — ustun testda qo'shiladi.
  await query(`ALTER TABLE generations ADD COLUMN IF NOT EXISTS files_purged_at TIMESTAMPTZ`);

  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const mkUser = async (name: string) => {
    const suffix = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const uid = String((await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ($1, 'Test') RETURNING id`, [suffix]))[0].id);
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const a = await mkUser("reads-a");

  const list = async (cookie: string, qs = "") => {
    const req = new Request(`http://localhost/api/generations${qs}`, { headers: { cookie } });
    const res = await inRequest(req, () => listRoute.GET(req));
    return { status: res.status, body: (await res.json()) as { generations: Record<string, unknown>[]; nextCursor: string | null; error?: string } };
  };
  const poll = async (cookie: string, id: string) => {
    const req = new Request(`http://localhost/api/generations/${id}`, { headers: { cookie } });
    const res = await inRequest(req, () => itemRoute.GET(req, { params: Promise.resolve({ id }) }));
    return { status: res.status, body: (await res.json()) as { generation: Record<string, unknown> } };
  };

  /*
   * 7 ta qator, og'ir `values_json` bilan (150 000 belgi). 3- va 4-qator
   * AYNAN bir xil `created_at` ga ega — kursor faqat vaqtga tayansa, ulardan
   * biri sahifalar chegarasida yo'qolardi yoki takrorlanardi.
   */
  const heavy = JSON.stringify({ topic: "og'ir", sourceText: "ж".repeat(150_000) });
  const ids: string[] = [];
  for (let i = 0; i < 7; i++) {
    const id = crypto.randomUUID();
    const minute = i === 4 ? 3 : i;
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, values_json, created_at, html, doc_json)
       VALUES ($1, $2, 'essay', $3, 'COMPLETED', $4::jsonb,
               -- Qat'iy vaqt: har INSERT ning o'z now() i bo'lardi va «teng vaqt» chiqmasdi.
               '2026-01-01T00:00:00Z'::timestamptz + ($5 || ' minutes')::interval, '<p>h</p>', NULL)`,
      [id, a.uid, `t${i}`, heavy, String(minute)],
    );
    ids.push(id);
  }
  const ties = await query<{ n: string }>(
    `SELECT count(*) AS n FROM generations WHERE user_id = $1 GROUP BY created_at HAVING count(*) > 1`,
    [a.uid],
  );
  assert.equal(ties.length, 1, "sinovda teng created_at li juftlik bo'lishi shart");
  // Kutilgan tartib: created_at DESC, id DESC.
  const expected = (
    await query<{ id: string }>(`SELECT id FROM generations WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [a.uid])
  ).map((r) => r.id);

  await t.test("ro'yxat SQL i values_json ni o'qimaydi, javob kaliti va maydonlari saqlangan", async (tt) => {
    const seen = await spySql(tt);
    const { status, body } = await list(a.cookie);
    assert.equal(status, 200);
    const sql = seen.filter((s) => /FROM generations/.test(s) && !/sessions/.test(s));
    assert.ok(sql.length >= 1, "ro'yxat so'rovi ko'rinmadi");
    // MUTATSIYA: `values_json` ni ro'yxat ustunlariga qaytarish → yiqiladi.
    for (const s of sql) assert.ok(!/values_json/.test(s), `ro'yxat values_json o'qiyapti: ${s.slice(0, 200)}`);
    assert.equal(body.generations.length, 7);
    assert.equal(body.nextCursor, null, "hammasi sig'di — keyingi sahifa yo'q");
    const item = body.generations[0];
    for (const k of ["id", "type", "topic", "status", "createdAt", "price", "fileName", "format", "progress", "step", "preview", "docVersion", "fileVersion", "liveSeq", "hasPrev", "filesPurgedAt"]) {
      assert.ok(k in item, `ro'yxat elementida ${k} yo'q (klient o'qiydi)`);
    }
    assert.ok(!("values" in item) && !("values_json" in item));
  });

  await t.test("kursor: limit=3 bilan sahifalar — tartib to'g'ri, takror/tushib qolish yo'q (teng created_at ham)", async () => {
    const got: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { status, body } = await list(a.cookie, qs);
      assert.equal(status, 200);
      assert.ok(body.generations.length <= 3);
      got.push(...body.generations.map((g) => String(g.id)));
      cursor = body.nextCursor;
      pages++;
      assert.ok(pages < 10, "kursor tsikl qildi");
    } while (cursor);
    // MUTATSIYA: kursorda `id` tie-break'ni olib tashlash (faqat created_at <) → teng vaqtli qator yo'qoladi.
    assert.deepEqual(got, expected);
    assert.equal(pages, 3);
  });

  await t.test("kursor barqaror: sahifalar orasida yangi qator qo'shilsa ham eski sahifa siljimaydi", async () => {
    const first = await list(a.cookie, "?limit=3");
    const fresh = crypto.randomUUID();
    await query(`INSERT INTO generations (id, user_id, tool_id, topic, status) VALUES ($1, $2, 'essay', 'yangi', 'QUEUED')`, [fresh, a.uid]);
    const rest: string[] = [];
    let cursor = first.body.nextCursor;
    while (cursor) {
      const { body } = await list(a.cookie, `?limit=3&cursor=${encodeURIComponent(cursor)}`);
      rest.push(...body.generations.map((g) => String(g.id)));
      cursor = body.nextCursor;
    }
    assert.deepEqual([...first.body.generations.map((g) => String(g.id)), ...rest], expected);
    await query(`DELETE FROM generations WHERE id = $1`, [fresh]);
  });

  await t.test("limit chegaralari: 0 → 1, 1000 → 100, noto'g'ri → 50; noto'g'ri kursor → 400", async () => {
    const b = await mkUser("reads-b");
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, created_at)
       SELECT gen_random_uuid(), $1, 'essay', 'n' || i, 'COMPLETED', now() - (i || ' seconds')::interval
         FROM generate_series(1, 120) AS i`,
      [b.uid],
    );
    assert.equal((await list(b.cookie, "?limit=0")).body.generations.length, 1);
    const big = await list(b.cookie, "?limit=1000");
    assert.equal(big.body.generations.length, 100);
    assert.ok(big.body.nextCursor, "100 dan ko'p — keyingi sahifa bor");
    const tail = await list(b.cookie, `?limit=100&cursor=${encodeURIComponent(big.body.nextCursor!)}`);
    assert.equal(tail.body.generations.length, 20, "101–120-qatorlar endi yetib boriladi (FE-08)");
    assert.equal(tail.body.nextCursor, null);
    assert.equal((await list(b.cookie, "?limit=abc")).body.generations.length, 50);
    assert.equal((await list(b.cookie)).body.generations.length, 50, "standart limit 50");
    for (const bad of ["xyz", "e30", encodeURIComponent("W10")]) {
      const r = await list(b.cookie, `?cursor=${bad}`);
      assert.equal(r.status, 400, `kursor ${bad} qabul qilindi`);
    }
    // Begona foydalanuvchining kursori boshqa odamning qatorini ochmaydi — egalik SQL da.
    const other = await list(a.cookie, `?limit=100&cursor=${encodeURIComponent(big.body.nextCursor!)}`);
    assert.ok(other.body.generations.every((g) => ids.includes(String(g.id))));
  });

  await t.test("poll: values_json o'qilmaydi; doc bo'lsa html qayta yuborilmaydi (SCALE-12)", async (tt) => {
    const withDoc = crypto.randomUUID();
    const doc = { meta: { title: "x" }, sections: [] };
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, values_json, html, doc_json)
       VALUES ($1, $2, 'essay', 'doc', 'COMPLETED', $3::jsonb, '<p>katta html</p>', $4::jsonb)`,
      [withDoc, a.uid, heavy, JSON.stringify(doc)],
    );
    const seen = await spySql(tt);
    const r = await poll(a.cookie, withDoc);
    assert.equal(r.status, 200);
    const sql = seen.filter((s) => /FROM generations/.test(s) && /live_json/.test(s));
    assert.equal(sql.length, 1, "poll so'rovi ko'rinmadi");
    // MUTATSIYA: `values_json` ni poll ustunlariga qaytarish → yiqiladi.
    assert.ok(!/values_json/.test(sql[0]), `poll values_json o'qiyapti`);
    assert.deepEqual(r.body.generation.doc, doc);
    // MUTATSIYA: `CASE WHEN doc_json IS NULL THEN html END` o'rniga `html` → yiqiladi.
    assert.equal(r.body.generation.html, null, "doc bor — html ikkinchi nusxa bo'lmasligi kerak");
    // Eski (doc'siz) qator uchun html saqlanadi — ko'ruvchi undan chizadi.
    const legacy = await poll(a.cookie, ids[0]);
    assert.equal(legacy.body.generation.html, "<p>h</p>");
  });

  await t.test("poll: QUEUED → queuePosition (1 dan) va etaSec; boshqa holatda yo'q", { skip: iso.isolated ? false : "alohida baza yaratilmadi" }, async () => {
    Object.assign(env.queue, { totalSlots: 8, meanServiceSec: 200 });
    const c = await mkUser("reads-c");
    // Navbatdagi 3 ta ish (2 tasi boshqa foydalanuvchiniki) + bittasi `run_after` kelajakda (qayta urinish).
    const q: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = crypto.randomUUID();
      const owner = i === 2 ? a.uid : c.uid;
      await query(
        `INSERT INTO generations (id, user_id, tool_id, topic, status, created_at)
         VALUES ($1, $2, 'essay', 'navbat', 'QUEUED', now() - interval '10 minutes' + ($3 || ' seconds')::interval)`,
        [id, owner, String(i)],
      );
      q.push(id);
    }
    const r0 = (await poll(c.cookie, q[0])).body.generation;
    const r1 = (await poll(c.cookie, q[1])).body.generation;
    const r3 = (await poll(c.cookie, q[3])).body.generation;
    // MUTATSIYA: `+ 1` ni olib tashlash yoki `<` o'rniga `<=` → pozitsiyalar siljiydi.
    assert.equal(r0.queuePosition, 1);
    assert.equal(r1.queuePosition, 2);
    assert.equal(r3.queuePosition, 4, "boshqa foydalanuvchining ishi ham oldinda turadi");
    // etaSec = ceil(position × 200 ÷ 8).
    assert.equal(r0.etaSec, 25);
    assert.equal(r3.etaSec, 100);
    // Faqat QUEUED ishlar sanaladi: oldingisi IN_PROGRESS ga o'tsa, o'rin qisqaradi.
    await query(`UPDATE generations SET status = 'IN_PROGRESS', locked_by = 'w', locked_at = now() WHERE id = $1`, [q[0]]);
    const after = (await poll(c.cookie, q[1])).body.generation;
    assert.equal(after.queuePosition, 1);
    const running = (await poll(c.cookie, q[0])).body.generation;
    assert.ok(!("queuePosition" in running) && !("etaSec" in running), "IN_PROGRESS da navbat o'rni bo'lmaydi");
    const done = (await poll(a.cookie, ids[0])).body.generation;
    assert.ok(!("queuePosition" in done));
  });
});
