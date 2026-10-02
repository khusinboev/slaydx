import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { tools } from "@/lib/server/admin-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-tool jobs, failures, cash and AI cost for a range (docs/admin/02-plan.md §6.3); cached 60 s. */
export const GET = adminHandler("admin/metrics/tools", { permission: "dashboard.view" }, async (req) => {
  return json(await tools(new URL(req.url)));
});
