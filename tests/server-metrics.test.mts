import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Server load history, app side (docs/ops/METRICS.md): the minute sampler, its leader-only write
 * and the 90 day retention purge.
 *
 *   - the sampler SQL on seeded rows: queue depth, oldest runnable age (a back-off retry is not
 *     "stuck"), completed/failed in the last 5 minutes, wait and duration percentiles, active users
 *     from every source (queued, running, recent job, session, per-user rate-limit bucket) and the
 *     users it must NOT count;
 *   - `recordAppSample` writes one row and skips when a sample is younger than the minimum gap;
 *   - only the housekeeping leader writes: a session holding the advisory lock blocks the sample,
 *     two ticks in a row make one row;
 *   - `purgeServerMetrics` removes rows older than 90 days and keeps everything younger (both kinds),
 *     and the worker's housekeeping pass runs it.
 *
 * Mutations that turn this red: purge window `< 30 days`; the sampler not filtering the 5 minute
 * window; counting a back-off retry as the oldest queued job; dropping the minimum-gap guard;
 * running the sample outside the advisory lock.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("srvmetrics") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("server metrics: sampler, leader-only write, retention", { skip }, async (t) => {
  const pg = (await import("pg")).default;
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const worker = await import("../lib/server/worker.ts");
  const metrics = await import("../lib/server/server-metrics.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.after(async () => {
    await worker.releaseHousekeepingLock();
    await pool().end().catch(() => {});
    await iso.drop();
  });

  const uid = async (name: string) =>
    String((await query<{ id: string }>(`INSERT INTO users (name) VALUES ($1) RETURNING id::text AS id`, [name]))[0].id);
  const U = {
    u1: await uid("u1"), u2: await uid("u2"), u3: await uid("u3"), u4: await uid("u4"),
    u5: await uid("u5"), u6: await uid("u6"), u7: await uid("u7"), u8: await uid("u8"), u9: await uid("u9"),
  };
  /** created/run_after/started/finished given in seconds AGO (null = not set). */
  const gen = (user: string, status: string, o: { created: number; runAfter?: number; started?: number | null; finished?: number | null }) =>
    query(
      `INSERT INTO generations (id, user_id, tool_id, status, created_at, run_after, started_at, finished_at)
       VALUES ($1, $2, 'slide', $3, now() - make_interval(secs => $4), now() - make_interval(secs => $5),
               CASE WHEN $6::float8 IS NULL THEN NULL ELSE now() - make_interval(secs => $6::float8) END,
               CASE WHEN $7::float8 IS NULL THEN NULL ELSE now() - make_interval(secs => $7::float8) END)`,
      [randomUUID(), user, status, o.created, o.runAfter ?? o.created, o.started ?? null, o.finished ?? null],
    );

  // Queue: 3 QUEUED (u1, u2, u3), the oldest runnable one waiting 120 s; u3's job is a retry whose
  // back-off ends in the FUTURE (run_after = now + 600 s) and must not count as "oldest".
  await gen(U.u1, "QUEUED", { created: 125, runAfter: 120 });
  await gen(U.u2, "QUEUED", { created: 30, runAfter: 30 });
  await gen(U.u3, "QUEUED", { created: 3000, runAfter: -600 });
  // Running: u4, u5.
  await gen(U.u4, "IN_PROGRESS", { created: 200, runAfter: 190, started: 180 });
  await gen(U.u5, "IN_PROGRESS", { created: 100, runAfter: 90, started: 80 });
  // Finished in the last 5 minutes: 4 completed (wait 10/20/30/40 s, duration 60/60/120/300 s) + 1 failed.
  const done = (user: string, wait: number, dur: number, finishedAgo: number, status = "COMPLETED") =>
    gen(user, status, { created: finishedAgo + dur + wait, runAfter: finishedAgo + dur + wait, started: finishedAgo + dur, finished: finishedAgo });
  await done(U.u1, 10, 60, 120);
  await done(U.u2, 20, 60, 130);
  await done(U.u3, 30, 120, 140);
  await done(U.u4, 40, 300, 150);
  await gen(U.u2, "FAILED", { created: 400, runAfter: 400, started: null, finished: 100 });
  // Finished 10 minutes ago: outside the window (its user u8 must not become "active" through it).
  await done(U.u8, 5, 30, 600);
  // u6: session seen 2 minutes ago -> active. u8: session seen 30 minutes ago -> only in seen_1h.
  const session = (user: string, seenAgoSec: number, createdAgoSec: number) =>
    query(
      `INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, now() - make_interval(secs => $3), now() - make_interval(secs => $4), now() + interval '1 day')`,
      [user, randomUUID(), createdAgoSec, seenAgoSec],
    );
  await session(U.u6, 120, 86_400);
  await session(U.u8, 1800, 86_400);
  // u7: autosaves a form draft (per-user rate-limit bucket, window started a minute ago) -> active.
  // u9: only hits an IP-keyed bucket and an old window -> NOT active.
  await query(`INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, now() - interval '1 minute', 3)`, [`draft:${U.u7}`]);
  await query(`INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, now() - interval '30 minutes', 3)`, [`draft:${U.u9}`]);
  await query(`INSERT INTO rate_limits (bucket, window_start, hits) VALUES ('otp:ip:1.2.3.4', now() - interval '1 minute', 3)`);

  await t.test("sampler SQL: queue depth, oldest runnable, jobs, percentiles, active users", async () => {
    const s = await metrics.collectAppSample();
    assert.equal(s.v, 1);
    assert.deepEqual([s.queue.queued, s.queue.running], [3, 2]);
    assert.ok(s.queue.oldest_age_s >= 119 && s.queue.oldest_age_s <= 125, `oldest ${s.queue.oldest_age_s}`);
    assert.deepEqual([s.jobs.completed, s.jobs.failed, s.jobs.window_min], [4, 1, 5]);
    // wait [10 20 30 40] -> p50 25, p95 = 30 + 0.85 * 10 = 38.5 (the failed job never started)
    assert.equal(s.jobs.wait_p50_s, 25);
    assert.equal(s.jobs.wait_p95_s, 38.5);
    // duration [60 60 120 300] -> p50 90, p95 = 120 + 0.85 * 180 = 273
    assert.equal(s.jobs.dur_p50_s, 90);
    assert.equal(s.jobs.dur_p95_s, 273);
    // u1..u5 (queued/running/finished), u6 (session), u7 (draft bucket); NOT u8, u9.
    assert.equal(s.users.active_5m, 7);
    assert.equal(s.users.seen_1h, 2, "sessions seen within the hour: u6 and u8");
    assert.ok(s.db.conns >= 1 && s.db.max_conns >= s.db.conns);
    assert.ok(s.db.size_mb >= 1);
    assert.ok(s.db.pool.total >= 0 && s.db.pool.waiting === 0);
    assert.ok(s.proc.rss_mb > 10);
    assert.equal(typeof s.db.by_app, "object");
  });

  await t.test("empty history: zeros and nulls, never NaN", async () => {
    await query("DELETE FROM generations");
    const s = await metrics.collectAppSample();
    assert.deepEqual([s.queue.queued, s.queue.running, s.queue.oldest_age_s, s.jobs.completed, s.jobs.failed], [0, 0, 0, 0, 0]);
    assert.equal(s.jobs.wait_p95_s, null);
    assert.equal(s.jobs.dur_p50_s, null);
    assert.equal(JSON.stringify(s).includes("NaN"), false);
  });

  await t.test("recordAppSample: one row, then skipped inside the minimum gap, then written again", async () => {
    await query("DELETE FROM server_metrics");
    const first = await metrics.recordAppSample();
    assert.ok(first);
    assert.equal(await metrics.recordAppSample(), null, "a second sample inside the gap must be skipped");
    assert.equal((await query("SELECT 1 FROM server_metrics WHERE kind = 'app'")).length, 1);
    await query("UPDATE server_metrics SET at = now() - interval '2 minutes'");
    assert.ok(await metrics.recordAppSample());
    assert.equal((await query("SELECT 1 FROM server_metrics WHERE kind = 'app'")).length, 2);
    const row = await queryOne<{ data: { v: number; users: object } }>("SELECT data FROM server_metrics ORDER BY id DESC LIMIT 1");
    assert.equal(row?.data.v, 1);
  });

  await t.test("leader only: a session holding the advisory lock blocks the sample; two ticks make one row", async () => {
    await query("DELETE FROM server_metrics");
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    other.on("error", () => {});
    await other.connect();
    try {
      const got = await other.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [worker.HOUSEKEEPING_LOCK_ID]);
      assert.equal(got.rows[0].ok, true);
      assert.equal(await worker.housekeepingTick(), false, "not the leader");
      assert.equal((await query("SELECT 1 FROM server_metrics")).length, 0, "a non-leader wrote a sample");
    } finally {
      await other.end().catch(() => {});
    }
    // The lock is released with the session; this process becomes the leader.
    for (let i = 0; i < 20; i++) {
      if (await worker.housekeepingTick()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal((await query("SELECT 1 FROM server_metrics WHERE kind = 'app'")).length, 1);
    assert.equal(await worker.housekeepingTick(), true);
    assert.equal((await query("SELECT 1 FROM server_metrics WHERE kind = 'app'")).length, 1, "a second tick within the gap must not add a row");
  });

  await t.test("retention: rows older than 90 days go (both kinds), younger rows stay", async () => {
    await query("DELETE FROM server_metrics");
    const put = (kind: string, daysAgo: number) =>
      query(`INSERT INTO server_metrics (at, kind, data) VALUES (now() - make_interval(days => $1) - interval '1 hour', $2, '{}'::jsonb)`, [daysAgo, kind]);
    await put("host", 95);
    await put("app", 91);
    await put("app", 89);
    await put("host", 31);
    await put("app", 0);
    assert.equal(await metrics.purgeServerMetrics(), 2);
    const left = await query<{ kind: string }>("SELECT kind FROM server_metrics ORDER BY at");
    assert.equal(left.length, 3);
    assert.equal(metrics.METRICS_RETENTION_DAYS, 90);
  });

  await t.test("the worker's housekeeping pass runs the purge", async () => {
    await query("DELETE FROM server_metrics");
    await query(`INSERT INTO server_metrics (at, kind, data) VALUES (now() - interval '100 days', 'app', '{}'::jsonb)`);
    worker.resetRetentionScan();
    await worker.purgeHousekeeping();
    assert.equal((await query("SELECT 1 FROM server_metrics WHERE at < now() - interval '90 days'")).length, 0);
  });
});
