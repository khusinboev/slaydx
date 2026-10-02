import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { getBroadcast, parseBroadcastId } from "@/lib/server/admin-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One broadcast with its live delivery stats (polled every 5 s by the UI while it is sending). */
export const GET = adminHandler(
  "admin/broadcasts/detail",
  { permission: "broadcasts.view" },
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    return json(await getBroadcast(parseBroadcastId((await params).id)));
  },
);
