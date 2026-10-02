import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { overview } from "@/lib/server/admin-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dashboard KPIs for a range and the equal-length range before it (docs/admin/02-plan.md §6.3); cached 60 s. */
export const GET = adminHandler("admin/metrics/overview", { permission: "dashboard.view" }, async (req) => {
  return json(await overview(new URL(req.url)));
});
