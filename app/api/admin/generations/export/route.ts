import { adminHandler } from "@/lib/server/admin-handler";
import { adminTx } from "@/lib/server/admin-audit";
import { CSV_MAX_ROWS, csvResponse, flattenBatches, keysetBatches } from "@/lib/server/admin-csv";
import {
  GENERATIONS_CSV_HEADER,
  csvRowOf,
  exportPageFetcher,
  filtersForAudit,
  parseGenerationsQuery,
} from "@/lib/server/admin-generations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV of the jobs list with the same filters (plan §6.0 Exports, §6.5):
 * step-up permission, one audit row with `meta.filters` before the first
 * byte, 1 000-row keyset batches, 100 000-row cap.
 */
export const GET = adminHandler(
  "admin/generations/export",
  { permission: "jobs.export", rate: [10, 60] },
  async (req, _ctx, admin) => {
    const params = parseGenerationsQuery(new URL(req.url));
    await adminTx(admin, (_client, audit) =>
      audit({ action: "export.generations", targetType: "generation", meta: { filters: filtersForAudit(params) } }),
    );
    const stamp = new Date().toISOString().slice(0, 10);
    return csvResponse({
      filename: `generatsiyalar-${stamp}.csv`,
      header: GENERATIONS_CSV_HEADER,
      rows: flattenBatches(keysetBatches(exportPageFetcher(params), 1000, CSV_MAX_ROWS + 1), csvRowOf),
    });
  },
);
