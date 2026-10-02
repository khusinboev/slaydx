"use client";

import { adminGet, type AdminCallOptions } from "./core";

/**
 * Dashboard API (docs/admin/02-plan.md §6.3, permission `dashboard.view`).
 * Types mirror `lib/server/admin-metrics.ts`; they are declared here, never
 * imported from `lib/server/**` (tests/admin-boundary.test.mts).
 */

/** Inclusive Asia/Tashkent calendar days. */
export type MetricsRange = { from: string; to: string; days: number };

export type AiCoverage = {
  /** COMPLETED jobs finished in range that have cost data. */
  jobsWithCost: number;
  /** COMPLETED jobs finished in range. */
  jobsCompleted: number;
  /** 0–100; 0 when `jobsCompleted` is 0. */
  pct: number;
};

export type Kpis = {
  newUsers: number;
  activeUsers: number;
  generations: { total: number; completed: number; failed: number; revoked: number };
  /** Percent, `null` when nothing finished. */
  successRate: number | null;
  revenueSoum: { total: number; click: number; payme: number; topup: number; pro: number };
  paidOrders: number;
  cashSpendTanga: number;
  bonusSpendPoints: number;
  refunds: { count: number; tanga: number; points: number };
  aiCostUsd: number;
  aiCoverage: AiCoverage;
  marginSoum: number;
  pendingOrders: number;
};

export type Overview = {
  range: MetricsRange & { previous: MetricsRange };
  soumPerUsd: number;
  current: Kpis;
  previous: Kpis;
};

export type SeriesMetric = "revenue" | "generations" | "signups" | "ai_cost" | "refunds";

/** Value keys per metric. */
export type SeriesValues = {
  revenue: { total: number; click: number; payme: number; topup: number; pro: number; orders: number };
  generations: { total: number; completed: number; failed: number; revoked: number };
  signups: { users: number };
  ai_cost: { usd: number; records: number };
  refunds: { count: number; tanga: number; points: number };
};

export type Series<M extends SeriesMetric> = {
  metric: M;
  range: MetricsRange;
  /** One point per Tashkent day of the range, zero-filled, ascending. */
  points: Array<{ day: string; values: SeriesValues[M] }>;
};

export type ToolRow = {
  toolId: string;
  title: string;
  count: number;
  completed: number;
  failed: number;
  failRate: number | null;
  /** Net cash (balance + quota) spent, tanga. */
  cashSpend: number;
  aiCostUsd: number;
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

export type RangeParams = { from: string; to: string };

/** GET /api/admin/metrics/overview: KPIs of the range and of the equal-length range before it. */
export function getOverview(range: RangeParams, opts: AdminCallOptions = {}): Promise<Overview> {
  return adminGet<Overview>("/api/admin/metrics/overview", range, opts);
}

/** GET /api/admin/metrics/series: one zero-filled daily series. */
export function getSeries<M extends SeriesMetric>(metric: M, range: RangeParams, opts: AdminCallOptions = {}): Promise<Series<M>> {
  return adminGet<Series<M>>("/api/admin/metrics/series", { metric, ...range }, opts);
}

/** GET /api/admin/metrics/tools: per-tool rows, by job count. */
export function getTools(range: RangeParams, opts: AdminCallOptions = {}): Promise<ToolsResult> {
  return adminGet<ToolsResult>("/api/admin/metrics/tools", range, opts);
}

/** GET /api/admin/metrics/live: the queue right now (never cached). */
export function getLive(opts: AdminCallOptions = {}): Promise<Live> {
  return adminGet<Live>("/api/admin/metrics/live", undefined, opts);
}
