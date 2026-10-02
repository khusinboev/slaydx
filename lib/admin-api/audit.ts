"use client";

import { getAdminSession } from "./auth";
import {
  AdminReauthCancelledError,
  adminGet,
  buildQuery,
  runStepUp,
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

export function auditExportUrl(q: AuditFilterQuery): string {
  return `/api/admin/audit/export${buildQuery({ ...q } as AdminParams)}`;
}

/** Re-confirm the TOTP when the step-up window ends within this margin (a long export must not cross it). */
const REAUTH_MARGIN_MS = 30_000;

/**
 * Starts the CSV download. `audit.export` needs a fresh step-up, and a browser
 * download cannot run the 401 → dialog → retry dance of `core.ts`, so the
 * window is checked first and the step-up dialog opened when needed. The file
 * itself is then fetched by the browser (streamed to disk). `navigate` is
 * injectable for tests.
 */
export async function downloadAuditCsv(
  q: AuditFilterQuery,
  opts: AdminCallOptions & { navigate?: (url: string) => void } = {},
): Promise<void> {
  const { navigate, ...call } = opts;
  const { session } = await getAdminSession(call);
  const until = session?.reauthUntil ? Date.parse(session.reauthUntil) : Number.NaN;
  if (!Number.isFinite(until) || until - Date.now() < REAUTH_MARGIN_MS) {
    if (!(await runStepUp())) throw new AdminReauthCancelledError();
  }
  const url = auditExportUrl(q);
  if (navigate) {
    navigate(url);
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
