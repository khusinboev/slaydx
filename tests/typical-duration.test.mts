import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `typicalDurationSec` — per-tool MEDIAN of (finished_at - started_at) over COMPLETED jobs of the last
 * 30 days, for the running panel's ETA. On a throwaway Postgres.
 *
 * Pinned: median (not mean — one 40-minute outlier must not move it); a tool with fewer than 5
 * samples is absent (-> null, UI shows no estimate); failed / old / never-started rows are ignored;
 * one grouped query per 10 min (cache) — later reads do not touch the DB.
 *
 * MUTATIONS checked: `percentile_cont(0.5)` -> `avg(...)` (median test fails); drop `HAVING count(*) >= $2`
 * (min-samples test fails); drop `status = 'COMPLETED'` (failed-rows test fails); TTL bypass (cache test fails).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("typdur") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

after(async () => {
  if (hasDb) {
    const { pool } = await import("../lib/server/db.ts");
    await pool().end();
  }
  await iso.drop();
});

test("typicalDurationSec: median per tool, min samples, status/window filters, 10-min cache", { skip }, async () => {
  const { query, migrate } = await import("../lib/server/db.ts");
  const { typicalDurationSec, resetTypicalDurationCache, MIN_SAMPLES } = await import("../lib/server/typical-duration.ts");
  await migrate();

  const [u] = await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ('typdur', 'Td', 0, 0, 0) RETURNING id`);
  const uid = String(u.id);
  const add = (tool: string, status: string, secs: number | null, ageDays = 1) =>
    query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, values_json, started_at, finished_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, 't', $3, 0, 'docx', '{}'::jsonb,
               CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(days => $5) END,
               now() - make_interval(days => $5) + make_interval(secs => COALESCE($4::int, 0)),
               now() - make_interval(days => $5))`,
      [uid, tool, status, secs, ageDays],
    );

  assert.equal(MIN_SAMPLES, 5);
  // essay: 5 completed -> median 100 (a 2 400 s outlier must not move it).
  for (const s of [80, 90, 100, 110, 2400]) await add("essay", "COMPLETED", s);
  // test: only 4 samples -> absent.
  for (const s of [30, 40, 50, 60]) await add("test", "COMPLETED", s);
  // image: 5 good ones (median 20) + noise that must be ignored: failed, too old, never started.
  for (const s of [10, 15, 20, 25, 30]) await add("image", "COMPLETED", s);
  await add("image", "FAILED", 900);
  await add("image", "COMPLETED", 900, 60);
  await add("image", "COMPLETED", null);

  resetTypicalDurationCache();
  const t0 = Date.now();
  assert.equal(await typicalDurationSec("essay", t0), 100, "median, not mean");
  assert.equal(await typicalDurationSec("image", t0), 20, "failed / old / unstarted rows ignored");
  assert.equal(await typicalDurationSec("test", t0), null, "fewer than 5 samples -> no estimate");
  assert.equal(await typicalDurationSec("podcast", t0), null, "no data");

  // Cache: new rows are invisible inside the TTL, visible after it.
  for (let i = 0; i < 5; i++) await add("podcast", "COMPLETED", 200);
  assert.equal(await typicalDurationSec("podcast", t0 + 60_000), null, "served from cache within 10 min");
  // After the TTL the stale value is served at once (no poll waits for the query) and refreshed in the background.
  assert.equal(await typicalDurationSec("podcast", t0 + 11 * 60_000), null, "stale-while-revalidate: old value now");
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await typicalDurationSec("podcast", t0 + 11 * 60_000 + 1), 200, "refreshed in the background");

  await query("DELETE FROM users WHERE id = $1", [uid]);
});
