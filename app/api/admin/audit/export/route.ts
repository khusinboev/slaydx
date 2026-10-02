import { adminHandler } from "@/lib/server/admin-handler";
import { adminTx } from "@/lib/server/admin-audit";
import { CSV_MAX_ROWS, csvResponse, flattenBatches, keysetBatches } from "@/lib/server/admin-csv";
import {
  AUDIT_CSV_HEADER,
  csvRowOf,
  exportPageFetcher,
  filtersForAudit,
  parseAuditQuery,
} from "@/lib/server/admin-audit-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV of the audit log with the same filters (plan §6.0 Exports, §6.12): owner
 * only, step-up, ONE `export.audit` row with `meta.filters` written before the
 * first byte, 1 000-row keyset batches, 100 000-row cap.
 */
export const GET = adminHandler(
  "admin/audit/export",
  { permission: "audit.export", rate: [10, 60] },
  async (req, _ctx, admin) => {
    const q = parseAuditQuery(new URL(req.url));
    await adminTx(admin, (_client, audit) =>
      audit({ action: "export.audit", targetType: "audit_log", meta: { filters: filtersForAudit(q) } }),
    );
    const stamp = new Date().toISOString().slice(0, 10);
    return csvResponse({
      filename: `audit-${stamp}.csv`,
      header: AUDIT_CSV_HEADER,
      rows: flattenBatches(keysetBatches(exportPageFetcher(q), 1000, CSV_MAX_ROWS + 1), csvRowOf),
    });
  },
);
