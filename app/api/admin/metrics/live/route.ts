import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { live } from "@/lib/server/admin-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live queue strip (docs/admin/02-plan.md §6.3); never cached, polled every 15 s by a visible dashboard. */
export const GET = adminHandler("admin/metrics/live", { permission: "dashboard.view" }, async () => {
  return json(await live());
});
