import "server-only";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { pool, query, queryOne, transaction } from "./db";

/**
 * APP load sample for the server load history (docs/ops/METRICS.md).
 *
 * Once a minute the housekeeping LEADER (the one worker holding the advisory lock,
 * `worker.ts housekeepingTick`) writes one `server_metrics` row of kind 'app':
 *
 *   users   active_5m   distinct users doing something in the last 5 minutes (see ACTIVE_USERS_SQL)
 *           seen_1h     distinct users whose session was "seen" in the last hour (the session
 *                       timestamp is throttled to one write per hour, so this is a LOWER bound)
 *   queue   queued / running now, age of the oldest runnable QUEUED job
 *   jobs    completed / failed in the last 5 minutes + wait and duration p50/p95 of those jobs
 *   db      connections used / max (and per application_name), DB size, this process's pool
 *   proc    RSS / heap of the sampling process, event-loop delay p99 / max since the last sample
 *
 * Nothing here adds a write to any request path: it only reads tables the app already maintains.
 * The host side (CPU, memory, containers, nginx) is `deploy/ops/slaydx-metrics.sh`.
 */

/** A sample is written at most once per this many seconds, whichever process is the leader. */
export const APP_SAMPLE_MIN_GAP_SEC = 45;
/** Retention of `server_metrics`, both kinds. */
export const METRICS_RETENTION_DAYS = 90;
/** Statement timeout of the sampler's queries: a slow sample must never hold a connection for long. */
const SAMPLE_TIMEOUT_MS = 10_000;

export type AppSample = {
  v: 1;
  users: { active_5m: number; seen_1h: number };
  queue: { queued: number; running: number; oldest_age_s: number };
  jobs: {
    window_min: number;
    completed: number;
    failed: number;
    wait_p50_s: number | null;
    wait_p95_s: number | null;
    dur_p50_s: number | null;
    dur_p95_s: number | null;
  };
  db: {
    conns: number;
    conns_active: number;
    max_conns: number;
    by_app: Record<string, number>;
    size_mb: number;
    pool: { total: number; idle: number; waiting: number };
  };
  proc: { rss_mb: number; heap_mb: number; loop_lag_p99_ms: number | null; loop_lag_max_ms: number | null };
};

/**
 * Users that did something in the last 5 minutes, from data the app already writes:
 *   - anyone with a job waiting or running (they are on the page, polling);
 *   - anyone who created or finished a job in the window;
 *   - anyone whose session was created (login) or seen in the window;
 *   - anyone who hit a per-user rate-limit bucket (form draft autosave, document edit, source
 *     extraction, download polling, uploads, ...) in a window that STARTED inside the last 5 minutes.
 * The sources overlap on purpose; `count(DISTINCT)` makes it a set. Per-user buckets are `name:<id>`.
 */
export const ACTIVE_USERS_SQL = `
  SELECT count(DISTINCT uid)::int AS n FROM (
    SELECT user_id AS uid FROM generations WHERE status IN ('QUEUED', 'IN_PROGRESS')
    UNION ALL
    SELECT user_id FROM generations
     WHERE created_at > now() - interval '6 hours'
       AND (created_at > now() - interval '5 minutes' OR finished_at > now() - interval '5 minutes')
    UNION ALL
    SELECT user_id FROM sessions
     WHERE revoked_at IS NULL AND (last_seen_at > now() - interval '5 minutes' OR created_at > now() - interval '5 minutes')
    UNION ALL
    SELECT substring(bucket from '([0-9]+)$')::bigint FROM rate_limits
     WHERE window_start > now() - interval '5 minutes'
       AND bucket ~ '^(gen:burst|draft|edit|extract|curriculum|chreq|dlprep|photo|logo|source|imgup|share|rebuild):[0-9]+$'
  ) t WHERE uid IS NOT NULL`;

const JOBS_SQL = `
  WITH recent AS (
    SELECT status, started_at, finished_at, run_after
      FROM generations
     WHERE created_at > now() - interval '6 hours'
       AND finished_at > now() - interval '5 minutes'
       AND status IN ('COMPLETED', 'FAILED')
  )
  SELECT
    count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
    count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
    percentile_cont(0.5)  WITHIN GROUP (ORDER BY greatest(extract(epoch FROM started_at - run_after), 0)) FILTER (WHERE started_at IS NOT NULL) AS wait_p50,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY greatest(extract(epoch FROM started_at - run_after), 0)) FILTER (WHERE started_at IS NOT NULL) AS wait_p95,
    percentile_cont(0.5)  WITHIN GROUP (ORDER BY greatest(extract(epoch FROM finished_at - started_at), 0)) FILTER (WHERE started_at IS NOT NULL) AS dur_p50,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY greatest(extract(epoch FROM finished_at - started_at), 0)) FILTER (WHERE started_at IS NOT NULL) AS dur_p95
  FROM recent`;

// One partial-index count per status (`generations_queued_created_idx`, `generations_running_user_idx`).
const QUEUE_SQL = `
  SELECT (SELECT count(*) FROM generations WHERE status = 'QUEUED')::int AS queued,
         (SELECT count(*) FROM generations WHERE status = 'IN_PROGRESS')::int AS running,
         -- Age since the job became runnable: a retry waiting for its back-off is not stuck.
         coalesce((SELECT extract(epoch FROM now() - min(run_after))
                     FROM generations WHERE status = 'QUEUED' AND run_after <= now()), 0) AS oldest`;

const DB_SQL = `
  SELECT count(*)::int AS conns,
         count(*) FILTER (WHERE state = 'active')::int AS active,
         current_setting('max_connections')::int AS max_conns,
         (pg_database_size(current_database()) / 1048576)::int AS size_mb,
         coalesce(jsonb_object_agg(app, n) FILTER (WHERE app <> ''), '{}'::jsonb) AS by_app
    FROM (SELECT application_name AS app, state, count(*) OVER (PARTITION BY application_name) AS n
            FROM pg_stat_activity WHERE datname = current_database()) a`;

type Num = number | string | null;
const n0 = (v: Num | undefined): number => (v === null || v === undefined || !Number.isFinite(Number(v)) ? 0 : Number(v));
const nOrNull = (v: Num | undefined): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : round1(Number(v)));
const round1 = (x: number): number => Math.round(x * 10) / 10;

// Event-loop delay of THIS process since the previous sample. The histogram runs only in the
// housekeeping leader (the only caller) and is reset after every read.
let loopHist: IntervalHistogram | null = null;
function loopLag(): { p99: number | null; max: number | null } {
  try {
    if (!loopHist) {
      loopHist = monitorEventLoopDelay({ resolution: 20 });
      loopHist.enable();
      return { p99: null, max: null };
    }
    const out = loopHist.count > 0 ? { p99: round1(loopHist.percentile(99) / 1e6), max: round1(loopHist.max / 1e6) } : { p99: null, max: null };
    loopHist.reset();
    return out;
  } catch {
    return { p99: null, max: null };
  }
}

/** Reads one sample. Sequential queries on one short transaction: the sampler holds ONE connection. */
export async function collectAppSample(): Promise<AppSample> {
  const raw = await transaction(async (c) => {
    await c.query("SET TRANSACTION READ ONLY");
    await c.query(`SET LOCAL statement_timeout = ${SAMPLE_TIMEOUT_MS}`);
    const users = (await c.query<{ n: number }>(ACTIVE_USERS_SQL)).rows[0];
    const seen = (await c.query<{ n: number }>(
      "SELECT count(DISTINCT user_id)::int AS n FROM sessions WHERE revoked_at IS NULL AND last_seen_at > now() - interval '1 hour'",
    )).rows[0];
    const queue = (await c.query(QUEUE_SQL)).rows[0];
    const jobs = (await c.query(JOBS_SQL)).rows[0];
    const db = (await c.query(DB_SQL)).rows[0];
    return { users, seen, queue, jobs, db };
  });
  const p = pool();
  const lag = loopLag();
  const mem = process.memoryUsage();
  const byApp: Record<string, number> = {};
  for (const [k, v] of Object.entries((raw.db?.by_app ?? {}) as Record<string, number>)) byApp[k.slice(0, 60)] = n0(v);
  return {
    v: 1,
    users: { active_5m: n0(raw.users?.n), seen_1h: n0(raw.seen?.n) },
    queue: { queued: n0(raw.queue?.queued), running: n0(raw.queue?.running), oldest_age_s: Math.round(n0(raw.queue?.oldest)) },
    jobs: {
      window_min: 5,
      completed: n0(raw.jobs?.completed),
      failed: n0(raw.jobs?.failed),
      wait_p50_s: nOrNull(raw.jobs?.wait_p50),
      wait_p95_s: nOrNull(raw.jobs?.wait_p95),
      dur_p50_s: nOrNull(raw.jobs?.dur_p50),
      dur_p95_s: nOrNull(raw.jobs?.dur_p95),
    },
    db: {
      conns: n0(raw.db?.conns),
      conns_active: n0(raw.db?.active),
      max_conns: n0(raw.db?.max_conns),
      by_app: byApp,
      size_mb: n0(raw.db?.size_mb),
      pool: { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount },
    },
    proc: { rss_mb: Math.round(mem.rss / 1048576), heap_mb: Math.round(mem.heapUsed / 1048576), loop_lag_p99_ms: lag.p99, loop_lag_max_ms: lag.max },
  };
}

/**
 * Writes one app sample unless another one was written in the last `minGapSec` (a second leader
 * during a lock hand-over, or a manual run). Returns the stored sample or `null` when skipped.
 */
export async function recordAppSample(minGapSec: number = APP_SAMPLE_MIN_GAP_SEC): Promise<AppSample | null> {
  const recent = await queryOne(
    "SELECT 1 FROM server_metrics WHERE kind = 'app' AND at > now() - make_interval(secs => $1)",
    [minGapSec],
  );
  if (recent) return null;
  const sample = await collectAppSample();
  await query("INSERT INTO server_metrics (kind, data) VALUES ('app', $1::jsonb)", [JSON.stringify(sample)]);
  return sample;
}

/** Deletes samples older than the retention window. Returns the number of rows removed. */
export async function purgeServerMetrics(retentionDays: number = METRICS_RETENTION_DAYS): Promise<number> {
  const rows = await query(
    "DELETE FROM server_metrics WHERE at < now() - make_interval(days => $1) RETURNING id",
    [retentionDays],
  );
  return rows.length;
}
