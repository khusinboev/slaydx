import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { marketStats, parseStatsRange } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Sotuvlar»: KPIs, daily series, top items, by tool and subject over 7/30/90 Tashkent days (plan §6). */
export const GET = adminHandler("admin/market/stats", { permission: "market.view" }, async (req) => {
  return json(await marketStats(parseStatsRange(new URL(req.url))));
});
