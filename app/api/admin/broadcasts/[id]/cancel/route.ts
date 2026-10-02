import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { cancelBroadcast, parseBroadcastId } from "@/lib/server/admin-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stops a draft / queued / sending broadcast; pending recipients are never sent (plan §6.9). */
export const POST = adminHandler(
  "admin/broadcasts/cancel",
  { permission: "broadcasts.send", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBroadcastId((await params).id);
    const body = await readJson(req, 8 * 1024);
    return json(await cancelBroadcast(admin, id, body));
  },
);
