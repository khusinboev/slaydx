import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { aiCost, parseAiCostParams } from "@/lib/server/admin-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** AI spend over a Tashkent date range, grouped by day/tool/provider/model/kind (plan §6.7). */
export const GET = adminHandler("admin/ai/cost", { permission: "ai.view" }, async (req) => {
  const { range, groupBy } = parseAiCostParams(new URL(req.url));
  return json(await aiCost(range, groupBy));
});
