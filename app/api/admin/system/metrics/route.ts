import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { getServerMetrics, parseRange } from "@/lib/server/admin-server-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Yuklama tarixi»: downsampled server load history (host + app samples, peaks). Read-only, same
 * permission as the system page. `?range=24h|7d|30d` (default 24h); anything else is a 400.
 */
export const GET = adminHandler("admin/system/metrics", { permission: "system.view" }, async (req) => {
  const range = parseRange(new URL(req.url).searchParams.get("range"));
  return json(await getServerMetrics(range));
});
