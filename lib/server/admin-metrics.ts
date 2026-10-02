import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { transaction } from "./db";
import { parseDateRange, type DateRange } from "./admin-list";
import { soumPerUsd, spendBy, spendCoverage, spendTotals, type SpendCoverage } from "./admin-cost";
import { HEARTBEAT_STALE_SEC } from "./admin-heartbeat";
import { TOOL_BY_ID } from "../tools";

/**
 * Dashboard metrics (docs/admin/02-plan.md §6.3, §7.1 S3, §9).
 *
 * Every number is defined once, next to its SQL, in plain words. Ranges are
 * Asia/Tashkent calendar days (`parseDateRange`: `[fromTs, toTsExclusive)`,
 * at most 366 days). All reads run in a READ ONLY transaction with a 10 s
 * statement timeout; overview/series/tools are cached for 60 s per process,
 * keyed by (endpoint, params). `live` is never cached.
 *
 * Money units:
 *   - so'm: what users paid through Click/Payme (`payment_orders.amount_soum`);
 *   - tanga: the wallet unit (1 tanga = `SOUM_PER_COIN` = 1 so'm at top-up);
 *   - points: the sign-up bonus wallet, NOT cash (lib/server/spend.ts
 *     `assertPaidDocument`: only `balance`/`quota` count as paid money).
 * AI cost comes only from `admin-cost.ts`, so it equals the AI-cost and
 * pricing pages for the same range.
 */

const TZ = "Asia/Tashkent";
const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 300;
/** A worker is alive while its heartbeat is not stale (the shared rule, admin-heartbeat.ts: 90 s). */
export const WORKER_STALE_AFTER_MS = HEARTBEAT_STALE_SEC * 1000;

// ---------------------------------------------------------------------------
// Types (mirrored by lib/admin-api/metrics.ts for the client)

export type MetricsRange = { from: string; to: string; days: number };

export type Kpis = {
  newUsers: number;
  activeUsers: number;
  generations: { total: number; completed: number; failed: number; revoked: number };
  /** completed ÷ (completed + failed) × 100, 2 decimals; `null` when nothing finished. */
  successRate: number | null;
  revenueSoum: { total: number; click: number; payme: number; topup: number; pro: number };
  paidOrders: number;
  cashSpendTanga: number;
  bonusSpendPoints: number;
  refunds: { count: number; tanga: number; points: number };
  aiCostUsd: number;
  aiCoverage: SpendCoverage;
  marginSoum: number;
  pendingOrders: number;
};

export type Overview = {
  range: MetricsRange & { previous: MetricsRange };
  /** The `finance.soum_per_usd` rate used for `marginSoum` (both periods). */
  soumPerUsd: number;
  current: Kpis;
  previous: Kpis;
};

export const SERIES_METRICS = ["revenue", "generations", "signups", "ai_cost", "refunds"] as const;
export type SeriesMetric = (typeof SERIES_METRICS)[number];

export type SeriesPoint = { day: string; values: Record<string, number> };
export type Series = { metric: SeriesMetric; range: MetricsRange; points: SeriesPoint[] };

export type ToolRow = {
  toolId: string;
  title: string;
  count: number;
  completed: number;
  failed: number;
  /** failed ÷ (completed + failed) × 100, 2 decimals; `null` when nothing finished. */
  failRate: number | null;
  /** Net cash (balance + quota) charged in range minus cash refunded in range, tanga. */
  cashSpend: number;
  aiCostUsd: number;
  /** Mean `finished_at − started_at` of COMPLETED jobs, seconds (1 decimal); `null` when none. */
  avgDurationSec: number | null;
};

export type ToolsResult = { range: MetricsRange; items: ToolRow[] };

export type Live = {
  queued: number;
  running: number;
  oldestQueuedSec: number | null;
  inflightUsers: number;
  workersAlive: number;
  workersStale: number;
};

// ---------------------------------------------------------------------------
// Params

/** One query value; a repeated param (`?from=a&from=b`) is a 400, as in admin-list. */
function single(url: URL, name: string): string | null {
  const all = url.searchParams.getAll(name);
  if (all.length > 1) throw new ApiError(`Noto'g'ri parametr: ${name}`, 400);
  return all[0] === undefined || all[0] === "" ? null : all[0];
}

/** `from`/`to` as Tashkent days, inclusive, ≤ 366 days; default: the last 30 days. */
export function metricsRangeOf(url: URL, nowMs?: number): DateRange {
  return parseDateRange(single(url, "from"), single(url, "to"), { maxDays: 366, defaultDays: 30, nowMs });
}

export function seriesMetricOf(url: URL): SeriesMetric {
  const raw = single(url, "metric");
  if (raw === null || !(SERIES_METRICS as readonly string[]).includes(raw)) {
    throw new ApiError("Noto'g'ri parametr: metric", 400);
  }
  return raw as SeriesMetric;
}

const dayString = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The equal-length range that ends the day before `r` starts. */
export function previousRangeOf(r: DateRange): DateRange {
  const len = r.days * DAY_MS;
  const fromDayMs = Date.parse(`${r.fromDay}T00:00:00Z`);
  return {
    fromTs: new Date(Date.parse(r.fromTs) - len).toISOString(),
    toTsExclusive: r.fromTs,
    days: r.days,
    fromDay: dayString(fromDayMs - len),
    toDay: dayString(fromDayMs - DAY_MS),
  };
}

const publicRange = (r: DateRange): MetricsRange => ({ from: r.fromDay, to: r.toDay, days: r.days });

// ---------------------------------------------------------------------------
// Cache and transaction

type CacheEntry = { expires: number; value: Promise<unknown> };
const cache = new Map<string, CacheEntry>();

/**
 * 60 s in-process cache. The promise itself is cached, so concurrent callers
 * share one computation; a failure is evicted at once (never cached).
 */
function cached<T>(key: string, compute: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  if (hit) cache.delete(key);
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Map keeps insertion order: drop expired entries, then the oldest ones.
    for (const [k, e] of cache) if (e.expires <= now) cache.delete(k);
    while (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  }
  const value = compute();
  cache.set(key, { expires: now + CACHE_TTL_MS, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

/** Test seam: forget every cached result. */
export function clearMetricsCache(): void {
  cache.clear();
}

/** Bounded read-only aggregation (§9); a statement timeout becomes a clear 503. */
export async function readOnlyMetricsTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  try {
    return await transaction(async (c) => {
      await c.query("SET TRANSACTION READ ONLY");
      await c.query("SET LOCAL statement_timeout = '10s'");
      return fn(c);
    });
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "57014") {
      throw new ApiError("Hisoblash juda uzoq davom etdi — davrni qisqartirib qayta urinib ko'ring", 503, { code: "timeout" });
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// SQL helpers

const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const pct = (part: number, whole: number): number | null => (whole > 0 ? round((part / whole) * 100, 2) : null);

/** `$1, $2` = the range instants; `$3, $4` = the same instants in epoch ms (for `perform_time`). */
function rangeParams(r: DateRange): [string, string, number, number] {
  return [r.fromTs, r.toTsExclusive, Date.parse(r.fromTs), Date.parse(r.toTsExclusive)];
}

/**
 * Tool of a ledger row (`t`, a charge or refund; `c`, the refunded charge):
 * the generation's tool, else the `<toolId>: <topic>` prefix of the charge note
 * (jobs.ts `enqueueGeneration`; the note survives a deleted generation), else
 * 'unknown'. Used only by the tools table, so its money adds up to the overview.
 */
const LEDGER_TOOL = `COALESCE(g.tool_id, NULLIF(substring(COALESCE(c.note, t.note) FROM '^([a-z0-9-]{1,40}): '), ''), 'unknown')`;
const UUID_RE_SQL = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;

// ---------------------------------------------------------------------------
// Overview

type KpiRow = Record<string, string | number | null>;

/** Every KPI except AI cost and margin, in one statement over one range. */
const KPI_SQL = `SELECT
  -- newUsers: accounts created in range.
  (SELECT count(*) FROM users WHERE created_at >= $1 AND created_at < $2) AS new_users,

  -- activeUsers: distinct users who created a generation in range, or logged
  -- in (a session created) in range, or whose session was last seen in range.
  -- sessions.last_seen_at keeps only the LATEST touch (written at most once an
  -- hour, session.ts), so for past ranges this is a lower bound.
  (SELECT count(*) FROM (
      SELECT user_id FROM generations WHERE created_at >= $1 AND created_at < $2
      UNION
      SELECT user_id FROM sessions
       WHERE (created_at >= $1 AND created_at < $2) OR (last_seen_at >= $1 AND last_seen_at < $2)
    ) a) AS active_users,

  -- generations: jobs CREATED in range, by their current status. total also
  -- counts jobs still QUEUED / IN_PROGRESS.
  g.total AS gen_total, g.completed AS gen_completed, g.failed AS gen_failed, g.revoked AS gen_revoked,

  -- revenueSoum / paidOrders: orders in state 'paid' whose perform_time (epoch
  -- ms, set by payments.ts settleOrder) falls in range. Gross: external refunds
  -- and chargebacks (payment_refunds) are not subtracted.
  p.orders AS paid_orders, p.total AS rev_total, p.click AS rev_click, p.payme AS rev_payme,
  p.topup AS rev_topup, p.pro AS rev_pro,

  -- cashSpendTanga: cash wallets (balance + quota) charged for jobs in range,
  -- minus cash refunded in range (refund rows restore exactly what the charge
  -- took, refund-tx.ts). bonusSpendPoints: the same for the points wallet.
  -- refunds: refund ledger rows in range (full and partial), per wallet type.
  l.charge_cash - l.refund_cash AS cash_spend, l.charge_points - l.refund_points AS bonus_spend,
  l.refund_count, l.refund_cash, l.refund_points,

  -- pendingOrders: orders created in range that are still 'pending' now
  -- (provider transaction opened, neither performed nor cancelled).
  (SELECT count(*) FROM payment_orders WHERE state = 'pending' AND created_at >= $1 AND created_at < $2) AS pending_orders
FROM
  (SELECT count(*) AS total,
          count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
          count(*) FILTER (WHERE status = 'FAILED') AS failed,
          count(*) FILTER (WHERE status = 'REVOKED') AS revoked
     FROM generations WHERE created_at >= $1 AND created_at < $2) g,
  (SELECT count(*) AS orders,
          COALESCE(sum(amount_soum), 0) AS total,
          COALESCE(sum(amount_soum) FILTER (WHERE provider = 'click'), 0) AS click,
          COALESCE(sum(amount_soum) FILTER (WHERE provider = 'payme'), 0) AS payme,
          COALESCE(sum(amount_soum) FILTER (WHERE purpose = 'topup'), 0) AS topup,
          COALESCE(sum(amount_soum) FILTER (WHERE purpose = 'pro'), 0) AS pro
     FROM payment_orders WHERE state = 'paid' AND perform_time >= $3 AND perform_time < $4) p,
  (SELECT COALESCE(sum(-(balance_delta + quota_delta)) FILTER (WHERE kind = 'charge'), 0) AS charge_cash,
          COALESCE(sum(-points_delta) FILTER (WHERE kind = 'charge'), 0) AS charge_points,
          count(*) FILTER (WHERE kind = 'refund') AS refund_count,
          COALESCE(sum(balance_delta + quota_delta) FILTER (WHERE kind = 'refund'), 0) AS refund_cash,
          COALESCE(sum(points_delta) FILTER (WHERE kind = 'refund'), 0) AS refund_points
     FROM transactions WHERE kind IN ('charge', 'refund') AND created_at >= $1 AND created_at < $2) l`;

async function kpisFor(c: PoolClient, r: DateRange, rate: number): Promise<Kpis> {
  const res = await c.query<KpiRow>(KPI_SQL, rangeParams(r));
  const k = res.rows[0] ?? {};
  // aiCostUsd / aiCoverage: the canonical spend set (admin-cost.ts), same range.
  const spend = await spendTotals(c, r);
  const coverage = await spendCoverage(c, r);
  const completed = num(k.gen_completed);
  const failed = num(k.gen_failed);
  const revenueTotal = num(k.rev_total);
  return {
    newUsers: num(k.new_users),
    activeUsers: num(k.active_users),
    generations: { total: num(k.gen_total), completed, failed, revoked: num(k.gen_revoked) },
    // successRate: of the jobs that finished either way; user cancellations (REVOKED) are not failures.
    successRate: pct(completed, completed + failed),
    revenueSoum: {
      total: revenueTotal,
      click: num(k.rev_click),
      payme: num(k.rev_payme),
      topup: num(k.rev_topup),
      pro: num(k.rev_pro),
    },
    paidOrders: num(k.paid_orders),
    cashSpendTanga: num(k.cash_spend),
    bonusSpendPoints: num(k.bonus_spend),
    refunds: { count: num(k.refund_count), tanga: num(k.refund_cash), points: num(k.refund_points) },
    aiCostUsd: spend.usd,
    aiCoverage: coverage,
    // marginSoum: cash received minus AI spend converted at the CURRENT
    // finance.soum_per_usd rate (rounded to whole so'm). A cash-flow proxy:
    // wallet balances bought but not yet spent are not deferred, and other
    // costs (hosting, provider fees) are not included.
    marginSoum: revenueTotal - Math.round(spend.usd * rate),
    pendingOrders: num(k.pending_orders),
  };
}

export async function overview(url: URL): Promise<Overview> {
  const r = metricsRangeOf(url);
  const prev = previousRangeOf(r);
  return cached(`overview|${r.fromDay}|${r.toDay}`, async () => {
    const rate = await soumPerUsd();
    return readOnlyMetricsTx(async (c) => ({
      range: { ...publicRange(r), previous: publicRange(prev) },
      soumPerUsd: rate,
      current: await kpisFor(c, r, rate),
      previous: await kpisFor(c, prev, rate),
    }));
  });
}

// ---------------------------------------------------------------------------
// Series

/** Every Tashkent day of the range ($1, $2 = `YYYY-MM-DD`), for zero-filling. */
const DAYS = `SELECT gs::date AS d FROM generate_series($1::date, $2::date, interval '1 day') AS gs`;
const tkDay = (col: string): string => `(${col} AT TIME ZONE '${TZ}')::date`;

/**
 * Per-metric SQL: `$1, $2` = days; `$3, $4` = the range bounds, as instants
 * (`bounds: "ts"`) or epoch ms (`bounds: "ms"`). Columns = value keys.
 */
const SERIES_SQL: Record<Exclude<SeriesMetric, "ai_cost">, { keys: readonly string[]; bounds: "ts" | "ms"; sql: string }> = {
  // revenue: paid orders by the Tashkent day of perform_time (ms), so'm.
  revenue: {
    keys: ["total", "click", "payme", "topup", "pro", "orders"],
    bounds: "ms",
    sql: `WITH agg AS (
        SELECT ${tkDay("to_timestamp(perform_time / 1000.0)")} AS d,
               sum(amount_soum) AS total,
               sum(amount_soum) FILTER (WHERE provider = 'click') AS click,
               sum(amount_soum) FILTER (WHERE provider = 'payme') AS payme,
               sum(amount_soum) FILTER (WHERE purpose = 'topup') AS topup,
               sum(amount_soum) FILTER (WHERE purpose = 'pro') AS pro,
               count(*) AS orders
          FROM payment_orders
         WHERE state = 'paid' AND perform_time >= $3 AND perform_time < $4
         GROUP BY 1)
      SELECT to_char(days.d, 'YYYY-MM-DD') AS day, agg.total, agg.click, agg.payme, agg.topup, agg.pro, agg.orders
        FROM (${DAYS}) days LEFT JOIN agg ON agg.d = days.d ORDER BY days.d`,
  },
  // generations: jobs by the Tashkent day they were created, by current status.
  generations: {
    keys: ["total", "completed", "failed", "revoked"],
    bounds: "ts",
    sql: `WITH agg AS (
        SELECT ${tkDay("created_at")} AS d, count(*) AS total,
               count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
               count(*) FILTER (WHERE status = 'FAILED') AS failed,
               count(*) FILTER (WHERE status = 'REVOKED') AS revoked
          FROM generations WHERE created_at >= $3 AND created_at < $4
         GROUP BY 1)
      SELECT to_char(days.d, 'YYYY-MM-DD') AS day, agg.total, agg.completed, agg.failed, agg.revoked
        FROM (${DAYS}) days LEFT JOIN agg ON agg.d = days.d ORDER BY days.d`,
  },
  // signups: users by the Tashkent day their account was created.
  signups: {
    keys: ["users"],
    bounds: "ts",
    sql: `WITH agg AS (
        SELECT ${tkDay("created_at")} AS d, count(*) AS users
          FROM users WHERE created_at >= $3 AND created_at < $4
         GROUP BY 1)
      SELECT to_char(days.d, 'YYYY-MM-DD') AS day, agg.users
        FROM (${DAYS}) days LEFT JOIN agg ON agg.d = days.d ORDER BY days.d`,
  },
  // refunds: refund ledger rows by the Tashkent day they were written.
  refunds: {
    keys: ["count", "tanga", "points"],
    bounds: "ts",
    sql: `WITH agg AS (
        SELECT ${tkDay("created_at")} AS d, count(*) AS count,
               sum(balance_delta + quota_delta) AS tanga, sum(points_delta) AS points
          FROM transactions WHERE kind = 'refund' AND created_at >= $3 AND created_at < $4
         GROUP BY 1)
      SELECT to_char(days.d, 'YYYY-MM-DD') AS day, agg.count, agg.tanga, agg.points
        FROM (${DAYS}) days LEFT JOIN agg ON agg.d = days.d ORDER BY days.d`,
  },
};

export async function series(url: URL): Promise<Series> {
  const metric = seriesMetricOf(url);
  const r = metricsRangeOf(url);
  return cached(`series|${metric}|${r.fromDay}|${r.toDay}`, () =>
    readOnlyMetricsTx(async (c) => {
      let points: SeriesPoint[];
      if (metric === "ai_cost") {
        // ai_cost: the canonical spend rows by Tashkent day (admin-cost.ts, zero-filled there).
        const rows = await spendBy(c, r, "day");
        points = rows.map((row) => ({ day: row.key, values: { usd: row.usd, records: row.records } }));
      } else {
        const def = SERIES_SQL[metric];
        const [fromTs, toTs, fromMs, toMs] = rangeParams(r);
        const bounds = def.bounds === "ms" ? [fromMs, toMs] : [fromTs, toTs];
        const res = await c.query<Record<string, string | number | null>>(def.sql, [r.fromDay, r.toDay, ...bounds]);
        points = res.rows.map((row) => ({
          day: String(row.day),
          values: Object.fromEntries(def.keys.map((k) => [k, num(row[k])])),
        }));
      }
      return { metric, range: publicRange(r), points };
    }),
  );
}

// ---------------------------------------------------------------------------
// Tools

/** Titles of the free-LLM spend keys (`ai_usage.tool_id` = 'free:<endpoint>', spend.ts). */
const FREE_TITLES: Record<string, string> = {
  "free:outline": "Bepul AI: reja",
  "free:udk": "Bepul AI: UDK",
  "free:rewrite": "Bepul AI: tuzatish",
  "free:polish": "Bepul AI: sayqal",
};

export function toolTitle(toolId: string): string {
  const tool = (TOOL_BY_ID as Record<string, { title: string } | undefined>)[toolId];
  if (tool) return tool.title;
  if (FREE_TITLES[toolId]) return FREE_TITLES[toolId];
  if (toolId === "unknown") return "Noma'lum";
  return toolId;
}

type ToolAcc = Omit<ToolRow, "title" | "failRate">;

export async function tools(url: URL): Promise<ToolsResult> {
  const r = metricsRangeOf(url);
  return cached(`tools|${r.fromDay}|${r.toDay}`, () =>
    readOnlyMetricsTx(async (c) => {
      const byTool = new Map<string, ToolAcc>();
      const row = (id: string): ToolAcc => {
        let acc = byTool.get(id);
        if (!acc) {
          acc = { toolId: id, count: 0, completed: 0, failed: 0, cashSpend: 0, aiCostUsd: 0, avgDurationSec: null };
          byTool.set(id, acc);
        }
        return acc;
      };

      // count / completed / failed: jobs created in range, by current status.
      // avgDurationSec: COMPLETED jobs only (a failed run's length says little).
      const jobs = await c.query<{ tool_id: string; total: string; completed: string; failed: string; avg_sec: string | null }>(
        `SELECT tool_id, count(*) AS total,
                count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
                count(*) FILTER (WHERE status = 'FAILED') AS failed,
                avg(extract(epoch FROM finished_at - started_at))
                  FILTER (WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND finished_at >= started_at) AS avg_sec
           FROM generations WHERE created_at >= $1 AND created_at < $2
          GROUP BY tool_id`,
        [r.fromTs, r.toTsExclusive],
      );
      for (const j of jobs.rows) {
        const acc = row(j.tool_id);
        acc.count = num(j.total);
        acc.completed = num(j.completed);
        acc.failed = num(j.failed);
        acc.avgDurationSec = j.avg_sec === null ? null : round(num(j.avg_sec), 1);
      }

      // cashSpend: the overview's cashSpendTanga split by tool (same ledger
      // rows, same sign rules), so the column sums to the KPI exactly.
      const cash = await c.query<{ tool_id: string; cash: string }>(
        `SELECT ${LEDGER_TOOL} AS tool_id, sum(-(t.balance_delta + t.quota_delta)) AS cash
           FROM transactions t
           LEFT JOIN generations g
             ON g.id = CASE WHEN t.reference ~ ${UUID_RE_SQL} THEN t.reference::uuid END
           LEFT JOIN transactions c
             ON t.kind = 'refund' AND c.kind = 'charge' AND c.reference = t.reference
          WHERE t.kind IN ('charge', 'refund') AND t.created_at >= $1 AND t.created_at < $2
          GROUP BY 1`,
        [r.fromTs, r.toTsExclusive],
      );
      for (const m of cash.rows) row(m.tool_id).cashSpend += num(m.cash);

      // aiCostUsd: canonical spend by tool (admin-cost.ts); free-LLM keys get their own rows.
      for (const s of await spendBy(c, r, "tool")) row(s.key).aiCostUsd = s.usd;

      const items: ToolRow[] = [...byTool.values()]
        .filter((t) => t.count > 0 || t.cashSpend !== 0 || t.aiCostUsd > 0)
        .map((t) => ({
          toolId: t.toolId,
          title: toolTitle(t.toolId),
          count: t.count,
          completed: t.completed,
          failed: t.failed,
          failRate: pct(t.failed, t.completed + t.failed),
          cashSpend: t.cashSpend,
          aiCostUsd: t.aiCostUsd,
          avgDurationSec: t.avgDurationSec,
        }))
        // Sorted by job count (§7.1 S3), then by AI cost, then id for a stable order.
        .sort((a, b) => b.count - a.count || b.aiCostUsd - a.aiCostUsd || (a.toolId < b.toolId ? -1 : 1));
      return { range: publicRange(r), items };
    }),
  );
}

// ---------------------------------------------------------------------------
// Live (never cached)

export async function live(): Promise<Live> {
  return readOnlyMetricsTx(async (c) => {
    // queued / running: jobs in those states now. oldestQueuedSec: age of the
    // oldest QUEUED job since it was created (a retried job keeps its age).
    // inflightUsers: distinct users with a QUEUED or IN_PROGRESS job.
    // Two `status = …` branches so the partial queue indexes apply (jobs.ts ADMISSION_COUNTS_SQL).
    const q = await c.query<{ queued: string; running: string; oldest: string | null; users: string }>(
      `WITH inflight AS (
          SELECT 'q' AS s, user_id, created_at FROM generations WHERE status = 'QUEUED'
          UNION ALL
          SELECT 'r' AS s, user_id, created_at FROM generations WHERE status = 'IN_PROGRESS')
        SELECT count(*) FILTER (WHERE s = 'q') AS queued,
               count(*) FILTER (WHERE s = 'r') AS running,
               GREATEST(0, floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE s = 'q')))) AS oldest,
               count(DISTINCT user_id) AS users
          FROM inflight`,
    );
    // workersAlive / workersStale: worker heartbeat rows (one per worker
    // process, every 30 s, heartbeat.ts) seen within HEARTBEAT_STALE_SEC / older
    // than that (the same rule as the AI and system screens). Rows silent for a day are purged by the worker (purgeHeartbeats).
    const w = await c.query<{ alive: string; stale: string }>(
      `SELECT count(*) FILTER (WHERE last_seen_at >= now() - $1::int * interval '1 millisecond') AS alive,
              count(*) FILTER (WHERE last_seen_at <  now() - $1::int * interval '1 millisecond') AS stale
         FROM process_heartbeats WHERE role = 'worker'`,
      [WORKER_STALE_AFTER_MS],
    );
    const row = q.rows[0];
    return {
      queued: num(row?.queued),
      running: num(row?.running),
      oldestQueuedSec: row?.oldest === null || row?.oldest === undefined ? null : num(row.oldest),
      inflightUsers: num(row?.users),
      workersAlive: num(w.rows[0]?.alive),
      workersStale: num(w.rows[0]?.stale),
    };
  });
}
