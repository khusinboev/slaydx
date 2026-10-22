import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listRatings } from "@/lib/server/ratings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only app ratings (newest first) with the average and the star distribution; permission `bonus.view`. */
export const GET = adminHandler("admin/ratings/list", { permission: "bonus.view" }, async (req) => {
  const n = Number(new URL(req.url).searchParams.get("limit") ?? 100);
  return json(await listRatings(Number.isFinite(n) ? n : 100));
});
