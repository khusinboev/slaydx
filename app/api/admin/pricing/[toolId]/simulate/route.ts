import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseAdjustBody, requireToolId, simulatePricing } from "@/lib/server/admin-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ toolId: string }> };

/**
 * What-if for `{percent, roundTo}`: the re-priced ladder and the last 30 days
 * re-priced at the same volume (plan §17.4). Read-only, so no Origin, reason
 * or audit; it is a POST only because it carries a body.
 */
export const POST = adminHandler("admin/pricing/simulate", { permission: "pricing.view" }, async (req, { params }: Ctx) => {
  const toolId = requireToolId((await params).toolId);
  const body = await readJson(req, 8 * 1024);
  return json(await simulatePricing(toolId, parseAdjustBody(body)));
});
