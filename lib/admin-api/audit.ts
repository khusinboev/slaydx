"use client";

import {
  adminDownload,
  adminGet,
  type AdminCallOptions,
  type AdminParams,
  type ListResult,
} from "./core";

/**
 * Audit log API (docs/admin/02-plan.md §6.12). Types mirror
 * `lib/server/admin-audit-query.ts` (admin client code never imports
 * `lib/server/**`, tests/admin-boundary.test.mts).
 */

export const AUDIT_OUTCOMES = ["ok", "denied", "failed"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export type AuditItem = {
  id: string;
  at: string;
  /** `null` for CLI / system rows. */
  adminId: string | null;
  adminName: string | null;
  adminUsername: string | null;
  /** Role at the time of the action. */
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: AuditOutcome;
  reason: string | null;
  ip: string | null;
};

export type AuditEntry = AuditItem & {
  actorUserId: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  requestId: string | null;
  userAgent: string | null;
};

/** Filters shared by the list and the CSV export. Empty values are dropped. */
export type AuditFilterQuery = {
  adminId?: string;
  /** Action PREFIX (`users.` finds every `users.*`). */
  action?: string;
  targetType?: string;
  /** Exact. */
  targetId?: string;
  outcome?: AuditOutcome | "";
  /** `YYYY-MM-DD`, Asia/Tashkent, inclusive. */
  from?: string;
  to?: string;
};

export type AuditListQuery = AuditFilterQuery & { cursor?: string | null; limit?: number };

/** GET /api/admin/audit. Errors: 400 bad filter, 403 `forbidden`. */
export function listAudit(q: AuditListQuery, opts?: AdminCallOptions): Promise<ListResult<AuditItem>> {
  return adminGet<ListResult<AuditItem>>("/api/admin/audit", { ...q } as AdminParams, opts);
}

/** GET /api/admin/audit/:id: the full row. 404 `not_found`. */
export async function getAuditEntry(id: string, opts?: AdminCallOptions): Promise<AuditEntry> {
  const res = await adminGet<{ entry: AuditEntry }>(`/api/admin/audit/${encodeURIComponent(id)}`, undefined, opts);
  return res.entry;
}

/**
 * GET /api/admin/audit/export (audit.export, step-up) through the shared
 * `adminDownload`: a 401 `reauth` opens the step-up dialog and retries once,
 * and an error response is never saved as the file.
 */
export async function downloadAuditCsv(q: AuditFilterQuery, opts: AdminCallOptions = {}): Promise<void> {
  await adminDownload("/api/admin/audit/export", { ...q } as AdminParams, { ...opts, fallbackName: "audit.csv" });
}
