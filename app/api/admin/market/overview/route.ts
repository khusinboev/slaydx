import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { marketOverview } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tab badges and the page strip: counts by status, the master switch, `pg_trgm` and preview availability (plan §9). */
export const GET = adminHandler("admin/market/overview", { permission: "market.view" }, async () => json(await marketOverview()));
