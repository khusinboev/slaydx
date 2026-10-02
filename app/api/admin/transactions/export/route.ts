import { adminHandler } from "@/lib/server/admin-handler";
import { exportLedger } from "@/lib/server/admin-finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of the ledger with the list's filters; step-up, audited with `meta.filters` (plan §6.0 Exports). */
export const GET = adminHandler("admin/transactions/export", { permission: "finance.export", rate: [10, 60] }, async (req, _ctx, admin) => {
  return exportLedger(new URL(req.url), admin);
});
