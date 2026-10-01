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
