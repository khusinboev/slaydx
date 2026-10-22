import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { refreshBonusChannel } from "@/lib/server/admin-bonus-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Telegramdan yangilash»: `getChat(chat_id)` → the stored username follows Telegram's current one
 * (`bonus_channel.refresh` audit row only when it changed). Every call reaches the Bot API.
 */
export const POST = adminHandler(
  "admin/bonus-channels/refresh",
  { permission: "bonus.edit", mutation: true, rate: [30, 60] },
  async (_req, { params }: { params: Promise<{ id: string }> }, admin) => {
    return json(await refreshBonusChannel(admin, (await params).id));
  },
);
