import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * SAQLASH MUDDATI (AUDIT prod-readiness C23, `audit/designs/retention.md`)
 * — haqiqiy Postgres ga qarshi.
 *
 * Egasi qarori: FAQAT bonus ball (`points`) bilan to'langan tayyor
 * ishlarning fayli/aktivlari/hujjat matni `RETENTION_BONUS_DAYS` (180)
 * kundan keyin o'chiriladi; `balance`/`quota` bilan to'langanlari —
 * muddatsiz. `generations` qatori O'CHMAYDI.
 *
 * Tranzaksiyalar qo'lda yoziladi (`charge`/`refund` qatorlari) — shunda
 * «qisman qaytarish» chegaralarini aniq yasash mumkin, `splitRatio`
 * yaxlitlashiga bog'lanmasdan.
 *
 * MUTATSIYALAR (tasdiqlangan — hisobotga qarang):
 *   - «pullik» sharti gross (qaytarishsiz) qilinsa → «qisman qaytarish» testi;
 *   - `m.money` sharti olib tashlansa → «balans bilan to'langan» testi;
 *   - kun chegarasi olib tashlansa → «yosh ish» testi;
 *   - `LIMIT` olib tashlansa → «partiya» testi.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("purgeBonusFiles", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { purgeBonusFiles } = await import("../lib/server/retention.ts");

  await migrate();

  const suffix = `ret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [u] = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Ret', 0, 0, 0) RETURNING id`,
    [suffix],
  );
  const uid = String(u.id);

  t.after(async () => {
    await query("DELETE FROM users WHERE id = $1", [uid]);
    await pool().end();
  });

  /**
   * Tayyor generatsiya + fayl + aktiv + tranzaksiyalar.
   * `tx` — `[kind, points_delta, quota_delta, balance_delta]`.
   */
  async function makeGen(
    ageDays: number,
    tx: Array<["charge" | "refund", number, number, number]>,
  ): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, price, doc_json, html, doc_prev,
                                doc_version, file_version, finished_at)
       VALUES ($1, $2, 'slide', 'Mavzu', 'COMPLETED', 1000, '{"a":1}'::jsonb, '<p>x</p>', '{"b":1}'::jsonb,
               3, 1, now() - make_interval(days => $3))`,
      [id, uid, ageDays],
    );
    await query(
      `INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes, expires_at)
       VALUES ($1, 'a.pptx', 'application/octet-stream', 3, '\\x010203', NULL)`,
      [id],
    );
    await query(
      `INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes, expires_at)
       VALUES ($1, 'img1', 'image/png', 3, '\\x010203', NULL)`,
      [id],
    );
    for (const [kind, p, q, b] of tx) {
      await query(
        `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note)
         VALUES ($1, $2, $3, $4, $5, $6, 'test')`,
        [uid, kind, p, q, b, id],
      );
    }
    return id;
  }

  async function state(id: string) {
    const g = await queryOne<{
      doc_json: unknown;
      html: string | null;
      doc_prev: unknown;
      files_purged_at: Date | null;
      doc_version: number;
      file_version: number;
      status: string;
    }>(
      `SELECT doc_json, html, doc_prev, files_purged_at, doc_version, file_version, status
         FROM generations WHERE id = $1`,
      [id],
    );
    const f = await queryOne("SELECT 1 FROM generation_files WHERE generation_id = $1", [id]);
    const a = await queryOne("SELECT 1 FROM generation_assets WHERE generation_id = $1", [id]);
    return { g, file: Boolean(f), asset: Boolean(a) };
  }

  function assertPurged(s: Awaited<ReturnType<typeof state>>, label: string) {
    assert.ok(s.g, `${label}: generatsiya qatori o'chib ketdi`);
    assert.equal(s.g!.status, "COMPLETED", `${label}: holat o'zgarmasligi kerak`);
    assert.ok(s.g!.files_purged_at, `${label}: files_purged_at yozilmadi`);
    assert.equal(s.g!.doc_json, null, `${label}: doc_json qoldi`);
    assert.equal(s.g!.html, null, `${label}: html qoldi`);
    assert.equal(s.g!.doc_prev, null, `${label}: doc_prev qoldi (restore hujjatni qaytarib qo'yardi)`);
    // Fayl yo'li `ensureFreshFile` orqali qayta yasashga urinmasin (404, «eski format» 409 emas).
    assert.ok(s.g!.file_version >= s.g!.doc_version, `${label}: file_version doc_version dan orqada`);
    assert.equal(s.file, false, `${label}: generation_files qoldi`);
    assert.equal(s.asset, false, `${label}: generation_assets qoldi`);
  }

  function assertKept(s: Awaited<ReturnType<typeof state>>, label: string) {
    assert.ok(s.g, `${label}: qator yo'q`);
    assert.equal(s.g!.files_purged_at, null, `${label}: noto'g'ri tozalandi`);
    assert.deepEqual(s.g!.doc_json, { a: 1 }, `${label}: doc_json o'chdi`);
    assert.equal(s.file, true, `${label}: fayl o'chdi`);
    assert.equal(s.asset, true, `${label}: aktiv o'chdi`);
  }

  // Boshqa testlar/eski qatorlar bazada bo'lishi mumkin — har chaqiruvda
  // butun navbat tugaguncha yurgizamiz, keyin FAQAT o'z qatorlarimizni tekshiramiz.
  async function purgeAll(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await purgeBonusFiles({ maxBatches: 50 });
      total += n;
      if (n === 0) return total;
    }
  }

  await t.test("faqat bonus bilan, 180 kundan eski — tozalanadi, qator qoladi", async () => {
    const id = await makeGen(200, [["charge", -1000, 0, 0]]);
    await purgeAll();
    assertPurged(await state(id), "bonus-eski");
  });

  await t.test("balans bilan to'langan — HECH QACHON tozalanmaydi", async () => {
    const onlyBalance = await makeGen(400, [["charge", 0, 0, -1000]]);
    const mixed = await makeGen(400, [["charge", -700, 0, -300]]);
    const quota = await makeGen(400, [["charge", 0, -1000, 0]]);
    await purgeAll();
    assertKept(await state(onlyBalance), "balans");
    assertKept(await state(mixed), "bonus+balans");
    assertKept(await state(quota), "Pro kvota");
  });

  await t.test("faqat bonus, lekin 180 kundan yosh — saqlanadi", async () => {
    const id = await makeGen(179, [["charge", -1000, 0, 0]]);
    await purgeAll();
    assertKept(await state(id), "yosh");
  });

  await t.test("qisman qaytarish — pul qismi to'liq qaytgan bo'lsa bonus-only, qolsa pullik", async () => {
    // Pul qismi (1 tanga balans) qaytarildi, bonus qismining yarmi qoldi →
    // aslida faqat bonus bilan to'langan → tozalanadi.
    const netBonus = await makeGen(200, [
      ["charge", -1000, 0, -1],
      ["refund", 500, 0, 1],
    ]);
    // Pul qismi QISMAN qaytgan (300 dan 100) → hali pullik → saqlanadi.
    const netPaid = await makeGen(200, [
      ["charge", -700, 0, -300],
      ["refund", 350, 0, 100],
    ]);
    // Bonus qismi qisman qaytgan, pul yo'q → tozalanadi.
    const bonusPartial = await makeGen(200, [
      ["charge", -1000, 0, 0],
      ["refund", 400, 0, 0],
    ]);
    await purgeAll();
    assertPurged(await state(netBonus), "pul qismi qaytgan");
    assertKept(await state(netPaid), "pul qismi qisman qaytgan");
    assertPurged(await state(bonusPartial), "bonus qisman qaytgan");
  });

  await t.test("charge qatori yo'q (bepul) — tozalanmaydi", async () => {
    const free = await makeGen(400, []);
    await purgeAll();
    assertKept(await state(free), "charge yo'q");
  });

  await t.test("partiya LIMIT bilan: bitta partiya ≤ batchSize, qayta chaqiruv qolganini oladi; idempotent", async () => {
    // Avval eski qoldiqlarni tozalab olamiz, keyin aniq 5 ta qator yasaymiz.
    await purgeAll();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await makeGen(300 + i, [["charge", -1000, 0, 0]]));

    const first = await purgeBonusFiles({ batchSize: 2, maxBatches: 1 });
    assert.equal(first, 2, "bitta partiya LIMIT dan oshmasligi kerak");
    const purgedAfterFirst = (
      await query<{ n: string }>(
        "SELECT count(*)::text AS n FROM generations WHERE id = ANY($1::uuid[]) AND files_purged_at IS NOT NULL",
        [ids],
      )
    )[0].n;
    assert.equal(purgedAfterFirst, "2");

    // Eng eskisidan boshlanadi (finished_at bo'yicha).
    const oldest = await state(ids[4]);
    assert.ok(oldest.g!.files_purged_at, "eng eski qator birinchi partiyada bo'lishi kerak");

    const second = await purgeBonusFiles({ batchSize: 2, maxBatches: 5 });
    assert.equal(second, 3, "qolgan 3 tasi keyingi partiyalarda");
    for (const id of ids) assertPurged(await state(id), `partiya ${id}`);

    // Idempotent: qayta chaqiruv hech narsa qilmaydi va files_purged_at o'zgarmaydi.
    const before = (await state(ids[0])).g!.files_purged_at!.getTime();
    assert.equal(await purgeBonusFiles(), 0);
    assert.equal((await state(ids[0])).g!.files_purged_at!.getTime(), before);
  });

  await t.test("ikki parallel chaqiruv bir qatorni ikki marta sanamaydi", async () => {
    await purgeAll();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await makeGen(250, [["charge", -1000, 0, 0]]));
    const [a, b] = await Promise.all([purgeBonusFiles(), purgeBonusFiles()]);
    assert.equal(a + b, 4);
    for (const id of ids) assertPurged(await state(id), `parallel ${id}`);
  });
});
