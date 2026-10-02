import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { runReconciliation } from "@/lib/server/admin-finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S10 "Muvofiqlashtirish": on-demand consistency checks, each bounded to 10 s (plan §6.6, §9). */
export const GET = adminHandler("admin/finance/reconciliation", { permission: "finance.view", rate: [10, 60] }, async (req) => {
  return json(await runReconciliation(new URL(req.url)));
});
