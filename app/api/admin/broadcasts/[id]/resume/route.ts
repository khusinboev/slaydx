import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBroadcastId, resumeBroadcast } from "@/lib/server/admin-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resumes a paused broadcast; pending recipients continue where delivery stopped (docs/bonus/BONUS3.md C-Q5). */
export const POST = adminHandler(
  "admin/broadcasts/resume",
  { permission: "broadcasts.send", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBroadcastId((await params).id);
    const body = await readJson(req, 8 * 1024);
    return json(await resumeBroadcast(admin, id, body));
  },
);
