import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { createInviteLink } from "@/lib/server/admin-bonus-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Havola yaratish»: `{input}` → a new Telegram invite link (`createChatInviteLink`) for the
 * dialog's field. Stores nothing in the DB; the Telegram-side effect is audited.
 */
export const POST = adminHandler("admin/bonus-channels/invite-link", { permission: "bonus.edit", mutation: true, rate: [10, 60] }, async (req, _ctx, admin) => {
  const body = await readJson(req, 4 * 1024);
  return json(await createInviteLink(admin, body));
});
