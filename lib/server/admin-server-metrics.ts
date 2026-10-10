import "server-only";
import { ApiError } from "./api";
import { readOnlyTx } from "./admin-system";

/**
 * Read side of the server load history (docs/ops/METRICS.md) for «Tizim holati» → «Yuklama tarixi».
 *
 * `GET /api/admin/system/metrics?range=24h|7d|30d` (permission `system.view`, like the page). The
 * stored samples (host every 5 min, app every minute) are downsampled IN SQL with `date_bin`, so a
 * 30 day window is a few hundred points per series, never the raw ~50 000 rows. Within a bucket:
 * peaks use max (a spike must not be averaged away), request counts are rates per minute. Every
 * query has a hard LIMIT; `truncated` tells the UI when one was hit.
 */

export const METRIC_RANGES = {
  "24h": { hours: 24, binSec: 300 },
  "7d": { hours: 24 * 7, binSec: 1800 },
  "30d": { hours: 24 * 30, binSec: 7200 },
} as const;
export type MetricRange = keyof typeof METRIC_RANGES;

/** Hard row caps (a 30 day range is 360 buckets; the caps leave room and bound a bad range value). */
export const MAX_SERIES_POINTS = 800;
export const MAX_CONTAINER_ROWS = 6_000;

export type HostPoint = {
  t: string;
  cpus: number | null;
  load1: number | null;
  load5: number | null;
  /** (total - available) / total, the pressure view of memory. */
  memUsedPct: number | null;
  swapUsedPct: number | null;
  diskPct: number | null;
  /** Requests per minute through the slaydx nginx log; null when no nginx data in the bucket. */
  reqPerMin: number | null;
  s4xxPerMin: number | null;
  s5xxPerMin: number | null;
  p95Ms: number | null;
};

export type AppPoint = {
  t: string;
  activeUsers: number | null;
  queued: number | null;
  running: number | null;
  oldestQueuedSec: number | null;
  waitP95Sec: number | null;
  durP95Sec: number | null;
  completed5m: number | null;
  failed5m: number | null;
  dbConns: number | null;
  dbMaxConns: number | null;
  poolWaiting: number | null;
  loopLagMs: number | null;
  rssMb: number | null;
};

export type ContainerPoint = { t: string; name: string; memMb: number | null; cpuPct: number | null };

export type Peak = { at: string; value: number; queued?: number | null; waitP95Sec?: number | null };

export type ServerMetrics = {
  range: MetricRange;
  from: string;
  to: string;
  bucketSec: number;
  hasData: boolean;
  truncated: boolean;
  host: HostPoint[];
  app: AppPoint[];
  containers: ContainerPoint[];
  peaks: {
    activeUsers: Peak | null;
    memUsedPct: Peak | null;
    oldestQueuedSec: Peak | null;
    waitP95Sec: Peak | null;
    load1: Peak | null;
  };
};

export function parseRange(raw: string | null): MetricRange {
  if (raw === null || raw === "") return "24h";
  if (Object.hasOwn(METRIC_RANGES, raw)) return raw as MetricRange;
  throw new ApiError("Noto'g'ri parametr: range", 400);
}

const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * 10) / 10;
};
const iso = (v: Date | string): string => new Date(v).toISOString();

// Epoch-aligned buckets: the same instant always lands in the same bucket, whatever `now` is.
const BIN_ORIGIN = "TIMESTAMPTZ '2000-01-01 00:00:00+00'";
const J = (path: string, type = "float8") => `(m.data${path})::${type}`;

export async function getServerMetrics(
  range: MetricRange,
  now: number = Date.now(),
  /** Row caps; a parameter only so a test can hit them without 800 real buckets. */
  caps: { series: number; containers: number } = { series: MAX_SERIES_POINTS, containers: MAX_CONTAINER_ROWS },
): Promise<ServerMetrics> {
  const { hours, binSec } = METRIC_RANGES[range];
  const to = new Date(now);
  const from = new Date(now - hours * 3_600_000);
  const bin = `make_interval(secs => ${binSec})`; // binSec is one of three constants, never user input
  const window = "m.at >= $1 AND m.at <= $2";

  const data = await readOnlyTx(async (client) => {
    const host = await client.query(
      `SELECT date_bin(${bin}, m.at, ${BIN_ORIGIN}) AS t,
              max(${J("->>'cpus'")}) AS cpus,
              max(${J("->>'load1'")}) AS load1,
              max(${J("->>'load5'")}) AS load5,
              max(CASE WHEN ${J("->>'mem_total_mb'")} > 0 THEN (${J("->>'mem_total_mb'")} - ${J("->>'mem_avail_mb'")}) * 100.0 / ${J("->>'mem_total_mb'")} END) AS mem_used_pct,
              max(CASE WHEN ${J("->>'swap_total_mb'")} > 0 THEN ${J("->>'swap_used_mb'")} * 100.0 / ${J("->>'swap_total_mb'")} ELSE 0 END) AS swap_used_pct,
              max(${J("->>'disk_pct'")}) AS disk_pct,
              sum(${J("->'nginx'->>'requests'")}) * 60.0 / nullif(sum(${J("->'nginx'->>'window_s'")}), 0) AS req_per_min,
              sum(${J("->'nginx'->>'s4xx'")}) * 60.0 / nullif(sum(${J("->'nginx'->>'window_s'")}), 0) AS s4xx_per_min,
              sum(${J("->'nginx'->>'s5xx'")}) * 60.0 / nullif(sum(${J("->'nginx'->>'window_s'")}), 0) AS s5xx_per_min,
              max(${J("->'nginx'->>'p95_ms'")}) AS p95_ms
         FROM server_metrics m
        WHERE m.kind = 'host' AND ${window}
        GROUP BY 1 ORDER BY 1 DESC LIMIT ${caps.series + 1}`,
      [from, to],
    );
    const app = await client.query(
      `SELECT date_bin(${bin}, m.at, ${BIN_ORIGIN}) AS t,
              max(${J("->'users'->>'active_5m'")}) AS active_users,
              max(${J("->'queue'->>'queued'")}) AS queued,
              max(${J("->'queue'->>'running'")}) AS running,
              max(${J("->'queue'->>'oldest_age_s'")}) AS oldest,
              max(${J("->'jobs'->>'wait_p95_s'")}) AS wait_p95,
              max(${J("->'jobs'->>'dur_p95_s'")}) AS dur_p95,
              avg(${J("->'jobs'->>'completed'")}) AS completed,
              avg(${J("->'jobs'->>'failed'")}) AS failed,
              max(${J("->'db'->>'conns'")}) AS db_conns,
              max(${J("->'db'->>'max_conns'")}) AS db_max,
              max(${J("->'db'->'pool'->>'waiting'")}) AS pool_waiting,
              max(${J("->'proc'->>'loop_lag_p99_ms'")}) AS loop_lag,
              max(${J("->'proc'->>'rss_mb'")}) AS rss
         FROM server_metrics m
        WHERE m.kind = 'app' AND ${window}
        GROUP BY 1 ORDER BY 1 DESC LIMIT ${caps.series + 1}`,
      [from, to],
    );
    const containers = await client.query(
      `SELECT date_bin(${bin}, m.at, ${BIN_ORIGIN}) AS t,
              c->>'name' AS name,
              max((c->>'mem_mb')::float8) AS mem_mb,
              max((c->>'cpu_pct')::float8) AS cpu_pct
         FROM server_metrics m
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.data->'containers') = 'array' THEN m.data->'containers' ELSE '[]'::jsonb END) c
        WHERE m.kind = 'host' AND ${window}
        GROUP BY 1, 2 ORDER BY 1 DESC LIMIT ${caps.containers + 1}`,
      [from, to],
    );
    // One «top 1» per metric over the RAW samples (a bucket max would hide the exact moment).
    const peak = async (kind: "host" | "app", value: string, extra = "") =>
      (
        await client.query(
          `SELECT m.at, ${value} AS v ${extra} FROM server_metrics m
            WHERE m.kind = '${kind}' AND ${window} AND ${value} IS NOT NULL
            ORDER BY ${value} DESC, m.at DESC LIMIT 1`,
          [from, to],
        )
      ).rows[0] as { at: Date; v: number; queued?: number; wait?: number } | undefined;
    const memExpr = `CASE WHEN ${J("->>'mem_total_mb'")} > 0 THEN (${J("->>'mem_total_mb'")} - ${J("->>'mem_avail_mb'")}) * 100.0 / ${J("->>'mem_total_mb'")} END`;
    const peaks = {
      users: await peak("app", J("->'users'->>'active_5m'"), `, ${J("->'queue'->>'queued'")} AS queued, ${J("->'jobs'->>'wait_p95_s'")} AS wait`),
      mem: await peak("host", `(${memExpr})`),
      queue: await peak("app", J("->'queue'->>'oldest_age_s'")),
      wait: await peak("app", J("->'jobs'->>'wait_p95_s'")),
      load: await peak("host", J("->>'load1'")),
    };
    return { host: host.rows, app: app.rows, containers: containers.rows, peaks };
  }, 10);

  const truncated =
    data.host.length > caps.series || data.app.length > caps.series || data.containers.length > caps.containers;
  // Rows came newest first so the cap drops the OLDEST buckets; the UI wants ascending time.
  const asc = <T,>(rows: T[], cap: number): T[] => rows.slice(0, cap).reverse();
  const pk = (p: { at: Date; v: number; queued?: number; wait?: number } | undefined, withContext = false): Peak | null =>
    p ? { at: iso(p.at), value: r1(p.v) ?? 0, ...(withContext ? { queued: num(p.queued), waitP95Sec: r1(p.wait) } : {}) } : null;

  const hostPts: HostPoint[] = asc(data.host, caps.series).map((r) => ({
    t: iso(r.t),
    cpus: num(r.cpus),
    load1: r1(r.load1),
    load5: r1(r.load5),
    memUsedPct: r1(r.mem_used_pct),
    swapUsedPct: r1(r.swap_used_pct),
    diskPct: r1(r.disk_pct),
    reqPerMin: r1(r.req_per_min),
    s4xxPerMin: r1(r.s4xx_per_min),
    s5xxPerMin: r1(r.s5xx_per_min),
    p95Ms: r1(r.p95_ms),
  }));
  const appPts: AppPoint[] = asc(data.app, caps.series).map((r) => ({
    t: iso(r.t),
    activeUsers: num(r.active_users),
    queued: num(r.queued),
    running: num(r.running),
    oldestQueuedSec: num(r.oldest),
    waitP95Sec: r1(r.wait_p95),
    durP95Sec: r1(r.dur_p95),
    completed5m: r1(r.completed),
    failed5m: r1(r.failed),
    dbConns: num(r.db_conns),
    dbMaxConns: num(r.db_max),
    poolWaiting: num(r.pool_waiting),
    loopLagMs: r1(r.loop_lag),
    rssMb: num(r.rss),
  }));
  const ctrs: ContainerPoint[] = asc(data.containers, caps.containers).map((r) => ({
    t: iso(r.t),
    name: String(r.name),
    memMb: r1(r.mem_mb),
    cpuPct: r1(r.cpu_pct),
  }));

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    bucketSec: binSec,
    hasData: hostPts.length > 0 || appPts.length > 0,
    truncated,
    host: hostPts,
    app: appPts,
    containers: ctrs,
    peaks: {
      activeUsers: pk(data.peaks.users, true),
      memUsedPct: pk(data.peaks.mem),
      oldestQueuedSec: pk(data.peaks.queue),
      waitP95Sec: pk(data.peaks.wait),
      load1: pk(data.peaks.load),
    },
  };
}
