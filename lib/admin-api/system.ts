"use client";

import { adminGet, adminSend, type AdminCallOptions, type ListResult } from "./core";

/**
 * System health and error log API (docs/admin/02-plan.md §6.11, `system.view`,
 * `errors.view`, `errors.resolve`). Thin typed wrappers over `core.ts`
 * (AbortSignal, 401/403 handling).
 *
 * Types are declared here, not imported from `lib/server/**`: admin client
 * code must not reach server modules (tests/admin-boundary.test.mts).
 */

export type SystemProcess = {
  process: string;
  role: "web" | "worker";
  hostname: string;
  startedAt: string;
  lastSeenAt: string;
  running: number;
  concurrency: number;
  /** Computed by the server with the same rule as the AI screen (three missed beats). */
  stale: boolean;
};

export type SystemStep = {
  step: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastRows: number | null;
  runs: number;
  failures: number;
  lastProcess: string | null;
};

export type SystemStatus = {
  db: {
    ok: boolean;
    latencyMs: number | null;
    migrations: { applied: number; latest: number | null; lastApplied: string | null };
  };
  queue: { queued: number; running: number; oldestQueuedSec: number | null };
  processes: SystemProcess[];
  housekeeping: SystemStep[];
  /** Message text only: never an env value. */
  config: { problems: string[]; warnings: string[] };
  version: string;
  nodeEnv: "production" | "development" | "test" | "unknown";
};

/** Load history («Yuklama tarixi»): GET /api/admin/system/metrics (docs/ops/METRICS.md). */
export type MetricRange = "24h" | "7d" | "30d";

export type HostPoint = {
  t: string;
  cpus: number | null;
  load1: number | null;
  load5: number | null;
  memUsedPct: number | null;
  swapUsedPct: number | null;
  diskPct: number | null;
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

export type MetricPeak = { at: string; value: number; queued?: number | null; waitP95Sec?: number | null };

export type ServerMetrics = {
  range: MetricRange;
  from: string;
  to: string;
  bucketSec: number;
  hasData: boolean;
  /** A server-side row cap was hit: the oldest buckets are missing. */
  truncated: boolean;
  host: HostPoint[];
  app: AppPoint[];
  containers: ContainerPoint[];
  peaks: {
    activeUsers: MetricPeak | null;
    memUsedPct: MetricPeak | null;
    oldestQueuedSec: MetricPeak | null;
    waitP95Sec: MetricPeak | null;
    load1: MetricPeak | null;
  };
};

export type ErrorLevel = "error" | "warn";

export type ErrorItem = {
  id: string;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
  level: ErrorLevel;
  scope: string;
  message: string;
  requestId: string | null;
  userId: string | null;
  jobId: string | null;
  path: string | null;
  process: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type ErrorDetail = ErrorItem & { stack: string | null };

export type ErrorListParams = {
  level?: ErrorLevel | "";
  scope?: string;
  /** `true` = resolved only, `false` = open only, omitted = both. */
  resolved?: boolean;
  from?: string;
  to?: string;
  q?: string;
  cursor?: string | null;
  limit?: number;
};

/** The most rows the server resolves in one bulk call. */
export const BULK_RESOLVE_LIMIT = 100;

/** GET /api/admin/system. 403 `forbidden` without `system.view`. */
export function getSystem(opts?: AdminCallOptions): Promise<SystemStatus> {
  return adminGet<SystemStatus>("/api/admin/system", undefined, opts);
}

/** GET /api/admin/system/metrics?range=. 400 bad range, 403 `forbidden` without `system.view`. */
export function getServerMetrics(range: MetricRange, opts?: AdminCallOptions): Promise<ServerMetrics> {
  return adminGet<ServerMetrics>("/api/admin/system/metrics", { range }, opts);
}

/** GET /api/admin/errors. Errors: 400 bad filter, 403 `forbidden`. */
export function listErrors(params: ErrorListParams, opts?: AdminCallOptions): Promise<ListResult<ErrorItem>> {
  return adminGet<ListResult<ErrorItem>>("/api/admin/errors", { ...params }, opts);
}

/** GET /api/admin/errors/:id (with the stack). 404 `not_found`. */
export async function getError(id: string, opts?: AdminCallOptions): Promise<ErrorDetail> {
  const res = await adminGet<{ error: ErrorDetail }>(`/api/admin/errors/${encodeURIComponent(id)}`, undefined, opts);
  return res.error;
}

/** POST /api/admin/errors/:id/resolve. The reason is optional (5..500 characters when given). */
export async function resolveError(id: string, reason: string, opts?: AdminCallOptions): Promise<ErrorDetail> {
  const res = await adminSend<{ error: ErrorDetail }>("POST", `/api/admin/errors/${encodeURIComponent(id)}/resolve`, reason ? { reason } : {}, opts);
  return res.error;
}

/** POST /api/admin/errors/resolve: at most `BULK_RESOLVE_LIMIT` ids, one audit row. */
export function resolveErrors(ids: ReadonlyArray<string>, reason: string, opts?: AdminCallOptions): Promise<{ resolved: number }> {
  return adminSend<{ resolved: number }>("POST", "/api/admin/errors/resolve", reason ? { ids, reason } : { ids }, opts);
}
