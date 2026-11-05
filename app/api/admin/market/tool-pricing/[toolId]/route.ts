import { readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { setMarketToolPercent } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sets a tool's share (10–100) or `null` for the global `market.percent`; step-up, reason, `market.tool_pricing` audit (plan §4, §6). */
export const PUT = adminHandler(
  "admin/market/tool-pricing-set",
  { permission: "pricing.edit", mutation: true },
  async (req, { params }: { params: Promise<{ toolId: string }> }, admin) => {
    const toolId = (await params).toolId;
    const key = requireIdempotencyKey(req);
    return idempotentJson(await setMarketToolPercent(admin, toolId, await readJson(req, 8 * 1024), key), 200);
  },
);
