import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parsePricingParams, pricingOverview } from "@/lib/server/admin-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every tool's price ladder, adjustment and unit economics over a Tashkent date range (plan §17.5).
 * Admin accounts' jobs are left out unless `admins=1`.
 */
export const GET = adminHandler("admin/pricing/list", { permission: "pricing.view" }, async (req) => {
  const { range, includeAdmins } = parsePricingParams(new URL(req.url));
  return json(await pricingOverview(range, { includeAdmins }));
});
