import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBroadcastId, pauseBroadcast } from "@/lib/server/admin-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pauses a queued / sending broadcast; the delivery engine stops before the next message (docs/bonus/BONUS3.md C-Q5). */
export const POST = adminHandler(
  "admin/broadcasts/pause",
  { permission: "broadcasts.send", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBroadcastId((await params).id);
    const body = await readJson(req, 8 * 1024);
    return json(await pauseBroadcast(admin, id, body));
  },
);
