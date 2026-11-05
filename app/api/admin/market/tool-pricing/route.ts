import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { marketToolPricing } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-tool percent table (plan §6 «Sozlamalar»). */
export const GET = adminHandler("admin/market/tool-pricing", { permission: "market.view" }, async () => json(await marketToolPricing()));
