import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBroadcastId, sendBroadcast } from "@/lib/server/admin-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Snapshots the recipients and queues the broadcast; delivery is the worker's job (plan §6.9). */
export const POST = adminHandler(
  "admin/broadcasts/send",
  { permission: "broadcasts.send", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBroadcastId((await params).id);
    const body = await readJson(req, 8 * 1024);
    return json(await sendBroadcast(admin, id, body));
  },
);
