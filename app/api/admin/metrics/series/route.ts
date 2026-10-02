import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { series } from "@/lib/server/admin-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One zero-filled daily series (docs/admin/02-plan.md §6.3); `metric` is whitelisted; cached 60 s. */
export const GET = adminHandler("admin/metrics/series", { permission: "dashboard.view" }, async (req) => {
  return json(await series(new URL(req.url)));
});
