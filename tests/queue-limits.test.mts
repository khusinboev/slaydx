import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Effective admission limits (`lib/server/queue-limits.ts`) on a throwaway Postgres:
 *   - auto mean duration = mean of the last finished jobs, each clipped at 600 s (a runaway job must not move it, a slow TAIL must still count);
 *   - fewer than 20 samples -> the old 200 s fallback; a manual `queue.mean_service_sec` wins over the auto value;
 *   - the admin's `queue.*` settings (written to `app_settings`) reach `admissionDecision` (wait / user cap / slots);
 *   - cached 60 s.
 *
 * MUTATIONS checked: drop the 600 s clip (outlier test fails); clip at p95 (heavy-tail test fails); drop the 20-sample minimum (fallback test fails);
 * ignore the setting (override test fails); TTL bypass (cache test fails).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("qlimits") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

after(async () => {
  if (hasDb) {
    const { pool } = await import("../lib/server/db.ts");
    await pool().end();
  }
  await iso.drop();
});

test("queueLimits: auto mean (clipped at 600 s), fallback, manual override, settings reach the admission decision, 60 s cache", { skip }, async () => {
  const { query, migrate } = await import("../lib/server/db.ts");
  const { queueLimits, autoMeanServiceSec, resetQueueLimitsCache } = await import("../lib/server/queue-limits.ts");
  const { admissionDecision } = await import("../lib/server/admission.ts");
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  await migrate();

  const [u] = await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ('qlim', 'Q', 0, 0, 0) RETURNING id`);
  const uid = String(u.id);
  const add = (secs: number) =>
    query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, values_json, started_at, finished_at)
       VALUES (gen_random_uuid(), $1, 'slide', 't', 'COMPLETED', 0, 'pptx', '{}'::jsonb, now() - interval '1 hour', now() - interval '1 hour' + make_interval(secs => $2))`,
      [uid, secs],
    );

  // < 20 samples -> fallback 200.
  for (let i = 0; i < 10; i++) await add(40);
  resetQueueLimitsCache();
  assert.equal(await autoMeanServiceSec(1_000), 200, "fewer than 20 samples -> 200 s");

  // 40 jobs: 39 x 40 s + one 3 000 s outlier. Unclipped mean would be ~114; clipped at 600 s it is ~54.
  for (let i = 0; i < 29; i++) await add(40);
  await add(3000);
  resetQueueLimitsCache();
  const auto = await autoMeanServiceSec(2_000);
  assert.ok(auto >= 38 && auto <= 60, `auto mean ${auto}`);

  // Cache: a new batch of slow rows is invisible for 60 s, visible after.
  for (let i = 0; i < 40; i++) await add(300);
  assert.equal(await autoMeanServiceSec(2_000 + 30_000), auto, "served from cache");
  assert.ok((await autoMeanServiceSec(2_000 + 61_000)) > auto, "re-measured after 60 s");

  // Defaults come from env; a manual mean wins over auto; the other queue.* settings are read from app_settings.
  resetQueueLimitsCache();
  invalidateSettingsCache();
  const base = await queueLimits();
  assert.equal(base.maxWaitSec, 900);
  assert.equal(base.userMaxInflight, 2);
  assert.equal(base.totalSlots, 8);
  assert.ok(base.meanServiceSec > auto && base.meanServiceSec <= 600, `measured mean after the slow batch: ${base.meanServiceSec}`);

  const put = (key: string, value: number) =>
    query(`INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
  await put("queue.mean_service_sec", 60);
  await put("queue.total_slots", 4);
  await put("queue.max_wait_sec", 300);
  await put("queue.user_max_inflight", 1);
  invalidateSettingsCache();
  const tuned = await queueLimits();
  assert.deepEqual({ ...tuned, ttlSec: 0 }, { meanServiceSec: 60, totalSlots: 4, maxWaitSec: 300, userMaxInflight: 1, ttlSec: 0 });

  // They drive the real decision: 21 queued x 60 s / 4 slots = 315 s > 300 s -> queue_full; 20 -> fine; user cap 1.
  const d = (queued: number, userInflight: number) => admissionDecision({ ...tuned, queued, userInflight });
  assert.equal(d(20, 0).ok, true);
  const full = d(21, 0);
  assert.equal(full.ok, false);
  if (!full.ok) assert.equal(full.code, "queue_full");
  const cap = d(0, 1);
  assert.equal(cap.ok, false);
  if (!cap.ok) assert.equal(cap.code, "user_inflight");

  await query("DELETE FROM app_settings WHERE key LIKE 'queue.%'");
  await query("DELETE FROM users WHERE id = $1", [uid]);
});

test("auto mean keeps a slow tail: 8 pro-slide-like jobs at 240 s among 192 at 10 s -> ~19 s, not the fast-job duration (a p95 clip would hide the tail)", { skip }, async () => {
  const { query, migrate } = await import("../lib/server/db.ts");
  const { autoMeanServiceSec, resetQueueLimitsCache } = await import("../lib/server/queue-limits.ts");
  await migrate();
  const [u] = await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ('qlim2', 'Q', 0, 0, 0) RETURNING id`);
  const uid = String(u.id);
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, values_json, started_at, finished_at)
     SELECT gen_random_uuid(), $1, 'slide', 't', 'COMPLETED', 0, 'pptx', '{}'::jsonb,
            now() - interval '1 hour', now() - interval '1 hour' + make_interval(secs => CASE WHEN g % 25 = 0 THEN 240 ELSE 10 END)
       FROM generate_series(1, 200) g`,
    [uid],
  );
  resetQueueLimitsCache();
  const mean = await autoMeanServiceSec(10_000_000);
  assert.ok(mean >= 17 && mean <= 21, `mean ${mean}`);
  await query("DELETE FROM users WHERE id = $1", [uid]);
  resetQueueLimitsCache();
});
