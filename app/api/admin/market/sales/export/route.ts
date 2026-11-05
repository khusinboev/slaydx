import { adminHandler } from "@/lib/server/admin-handler";
import { adminTx } from "@/lib/server/admin-audit";
import { CSV_MAX_ROWS, csvResponse, flattenBatches, keysetBatches } from "@/lib/server/admin-csv";
import { parseSalesQuery, SALES_CSV_HEADER, salesCsvRow, salesPageFetcher } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of the sales: step-up `finance.export`, one audit row before the first byte, keyset batches (plan §6). */
export const GET = adminHandler("admin/market/sales-export", { permission: "finance.export", rate: [10, 60] }, async (req, _ctx, admin) => {
  const params = parseSalesQuery(new URL(req.url));
  await adminTx(admin, (_client, audit) =>
    audit({ action: "export.market", targetType: "market", meta: { filters: { from: params.range?.fromDay, to: params.range?.toDay } } }),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse({
    filename: `bozor-sotuvlar-${stamp}.csv`,
    header: SALES_CSV_HEADER,
    rows: flattenBatches(keysetBatches(salesPageFetcher(params), 1000, CSV_MAX_ROWS + 1), salesCsvRow),
  });
});
