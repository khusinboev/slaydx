import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `027_queue_indexes.sql` (AUDIT prod-readiness DB-12, SCALE-13, W4-B) —
 * haqiqiy Postgres, ALOHIDA baza.
 *
 * 1. HOT: heartbeat/progress/jonli deka yozuvlari endi HOT update. Ilgari
 *    `generations_stale_idx ON generations(locked_at)` sabab HAR heartbeat
 *    (`locked_at = now()`) keng qatorning yangi nusxasini va barcha
 *    indekslarga (PK, user, stale) yangi yozuvni talab qilardi. Indeks endi
 *    `(user_id) WHERE status = 'IN_PROGRESS'` — ish davomida o'zgarmaydigan
 *    ustunda. Tekshiruv: `pg_stat_get_xact_tuples_hot_updated` SHU
 *    tranzaksiya ichida (asinxron statistikaga bog'liq emas); `jobs.ts`
 *    ning HAQIQIY SQL i tranzaksiya client'iga yo'naltiriladi.
 * 2. `generations_queue_idx(run_after)` ortiqcha — hamma QUEUED so'rovi
 *    `generations_queued_created_idx(created_at)` (023) dan foydalanadi.
 *    O'chirilgandan keyin ham navbat/qabul/muddat/reclaim so'rovlari
 *    rejasida Seq Scan YO'Q (`enable_seqscan = off`).
 *
 * Tuzatishsiz (027 yo'q): HOT testi 0 ta HOT update bilan qizaradi, indeks
 * ro'yxati testi eski ikki indeksni topadi.
 * MUTATSIYA: 027 dan `DROP INDEX IF EXISTS generations_stale_idx;` olib
 * tashlansa — HOT testi qizaradi.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const iso = hasDb ? await createIsolatedDb("qidx") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("027: navbat indekslari", { skip }, async (t) => {
  const { query, migrate, pool, transaction } = await import("../lib/server/db.ts");
  const jobs = await import("../lib/server/jobs.ts");
  await migrate();
  t.after(async () => {
    await pool().end().catch(() => {});
    await iso.drop();
  });

  const uid = String(
    (await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ('qidx', 'T') RETURNING id`))[0].id,
  );

  await t.test("indekslar: running_user bor, stale(locked_at) va queue(run_after) yo'q", async () => {
    const names = (
      await query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename = 'generations'`)
    ).map((r) => r.indexname);
    assert.ok(names.includes("generations_running_user_idx"), names.join(", "));
    assert.ok(!names.includes("generations_stale_idx"), "locked_at indekslangan — heartbeat HOT bo'lolmaydi");
    assert.ok(!names.includes("generations_queue_idx"), "ortiqcha run_after indeksi qoldi");
    assert.ok(names.includes("generations_queued_created_idx"));
    // Indekslangan ustunlar ro'yxatida heartbeat/progress yozadigan ustun yo'q.
    const cols = (
      await query<{ attname: string }>(
        `SELECT DISTINCT a.attname FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'generations'::regclass`,
      )
    ).map((r) => r.attname);
    for (const c of ["locked_at", "progress", "step", "live_json", "live_seq", "locked_by"]) {
      assert.ok(!cols.includes(c), `${c} indekslangan`);
    }
  });

  await t.test("heartbeat, setProgress, setLive — HOT update (SHU tranzaksiyada o'lchanadi)", async (tt) => {
    const id = randomUUID();
    const lease = "w-hot:1";
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, locked_by, locked_at, values_json)
       VALUES ($1, $2, 'essay', 'hot', 'IN_PROGRESS', $3, now(), $4::jsonb)`,
      [id, uid, lease, JSON.stringify({ topic: "x".repeat(200) })],
    );
    const writes: Array<[string, () => Promise<unknown>]> = [
      ["heartbeat", () => jobs.heartbeat(id, lease)],
      ["setProgress", () => jobs.setProgress(id, lease, 40, "Yozilmoqda")],
      ["setLive", () => jobs.setLive(id, lease, { slides: [] }, 45, "Slayd 1")],
    ];
    for (const [name, write] of writes) {
      // Har yozuv `locked_at` ni HAQIQATAN o'zgartirsin (tranzaksiya ichida `now()` o'zgarmas).
      await query(`UPDATE generations SET locked_at = now() - interval '1 hour' WHERE id = $1`, [id]);
      await transaction(async (c) => {
        // Sanoqlar backend'ning hali yuborilmagan statistikasini ham o'z ichiga oladi — farq o'lchanadi.
        const counters = async () => {
          const r = await c.query<{ upd: string; hot: string }>(
            `SELECT pg_stat_get_xact_tuples_updated('generations'::regclass) AS upd,
                    pg_stat_get_xact_tuples_hot_updated('generations'::regclass) AS hot`,
          );
          return { upd: Number(r.rows[0].upd), hot: Number(r.rows[0].hot) };
        };
        const before = await counters();
        // `jobs.ts` pool().query orqali yozadi — shu tranzaksiya client'iga yo'naltiramiz.
        tt.mock.method(pool(), "query", (text: string, params?: unknown[]) => c.query(text, params as never[]));
        try {
          await write();
        } finally {
          tt.mock.restoreAll();
        }
        const after = await counters();
        const fresh = await c.query<{ fresh: boolean }>(`SELECT locked_at = now() AS fresh FROM generations WHERE id = $1`, [id]);
        assert.equal(after.upd - before.upd, 1, `${name}: qatorga tegmadi (lease to'g'ri?)`);
        assert.equal(fresh.rows[0].fresh, true, `${name}: ijara (locked_at) yangilanmadi`);
        assert.equal(after.hot - before.hot, 1, `${name}: HOT emas`);
      });
    }
  });

  const plan = (sql: string, params: unknown[] = []) =>
    transaction(async (c) => {
      await c.query("SET LOCAL enable_seqscan = off");
      const r = await c.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params as never[]);
      return r.rows.map((x) => x["QUERY PLAN"]).join("\n");
    });

  /*
   * Har so'rov `lib/server/*.ts` dagi haqiqiy SQL (parametrlar bilan):
   * claimJob (navbat + adolat ichki sanog'i), qabul sanoqlari, navbat o'rni,
   * navbat muddati (`queue-ttl.ts`), reclaim (`reclaimStaleJobs`).
   */
  const CASES: Array<{ name: string; sql: string; params?: unknown[] }> = [
    {
      name: "claimJob: navbatdagi eng eski ish (+ adolat sanog'i)",
      sql: `SELECT q.id FROM generations q
             WHERE q.status = 'QUEUED' AND q.run_after <= now()
               AND (SELECT count(*) FROM generations r
                     WHERE r.status = 'IN_PROGRESS' AND r.user_id = q.user_id) < $1
             ORDER BY q.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      params: [2],
    },
    { name: "qabul sanoqlari", sql: jobs.ADMISSION_COUNTS_SQL, params: [uid] },
    {
      name: "navbat o'rni (getGeneration)",
      sql: `SELECT count(*) FROM generations q
             WHERE q.status = 'QUEUED' AND (q.created_at, q.id) < (now(), '00000000-0000-0000-0000-000000000000'::uuid)`,
    },
    {
      name: "navbat muddati (expireQueuedJobs)",
      sql: `SELECT id FROM generations
             WHERE status = 'QUEUED' AND created_at < now() - $1::int * interval '1 second'
             ORDER BY created_at LIMIT $2`,
      params: [2700, 100],
    },
    {
      name: "reclaimStaleJobs",
      sql: `UPDATE generations SET status = 'QUEUED', locked_by = NULL, locked_at = NULL
             WHERE status = 'IN_PROGRESS' AND attempts < 2
               AND locked_at < now() - ((CASE WHEN budget_ms > 0 THEN budget_ms / 1000 ELSE $1::int END) + 30 || ' seconds')::interval`,
      params: ["300"],
    },
  ];

  await t.test("QUEUED/IN_PROGRESS so'rovlari indeksdan (Seq Scan yo'q)", async () => {
    for (const c of CASES) {
      const p = await plan(c.sql, c.params);
      assert.ok(!/Seq Scan on generations/.test(p), `${c.name}: Seq Scan\n${p}`);
      assert.ok(/Index (Only )?Scan|Bitmap Index Scan/.test(p), `${c.name}: indeks yo'q\n${p}`);
    }
  });

  await t.test("027 qayta qo'llash xavfsiz", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../lib/server/migrations/027_queue_indexes.sql", import.meta.url), "utf8");
    await transaction(async (c) => {
      await c.query(sql);
    });
  });
});
