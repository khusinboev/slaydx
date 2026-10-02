import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBroadcastId, sendTest } from "@/lib/server/admin-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sends the text to the acting admin's own Telegram chat only (plan §6.9). Tighter rate: every call is a real message. */
export const POST = adminHandler(
  "admin/broadcasts/test",
  { permission: "broadcasts.send", mutation: true, rate: [10, 60] },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBroadcastId((await params).id);
    await readJson(req, 8 * 1024);
    return json(await sendTest(admin, id));
  },
);
