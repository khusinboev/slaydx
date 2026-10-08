import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { channelBotStatus } from "@/lib/server/admin-bonus-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live `getChatMember(chat, bot)`: is the bot still an admin of this channel? Nothing is stored. */
export const GET = adminHandler(
  "admin/bonus-channels/bot-status",
  { permission: "bonus.view", rate: [60, 60] },
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    return json(await channelBotStatus((await params).id));
  },
);
