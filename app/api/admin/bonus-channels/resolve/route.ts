import { ApiError, json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseChannelRef, resolveChannel } from "@/lib/server/admin-bonus-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preview for the add dialog: `?q=@name | t.me/name | -100…` → title, username, type, the bot's
 * admin status and a duplicate hint. Read-only (nothing is stored); every call reaches the Bot
 * API, hence the tighter rate limit.
 */
export const GET = adminHandler("admin/bonus-channels/resolve", { permission: "bonus.view", rate: [30, 60] }, async (req) => {
  const q = new URL(req.url).searchParams.get("q");
  if (q === null) throw new ApiError("Kanal manzili berilmagan", 400, { code: "input" });
  return json(await resolveChannel(parseChannelRef(q)));
});
