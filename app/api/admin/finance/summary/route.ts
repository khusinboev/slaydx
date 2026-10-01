import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { financeSummary } from "@/lib/server/admin-finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S10 "Xulosa": revenue, spend, refunds, liabilities, external refunds over `from..to` (plan §6.6, §9). */
export const GET = adminHandler("admin/finance/summary", { permission: "finance.view" }, async (req) => {
  return json(await financeSummary(new URL(req.url)));
});
