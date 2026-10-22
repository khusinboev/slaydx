import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { deleteBonusChannel, updateBonusChannel } from "@/lib/server/admin-bonus-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `{title?, username?, inviteLink?, joinBonus?, stayBonus?, stayDays?, active?, mandatory?, sort?, reason?}`; only changed
 * fields are audited. A new username must name the same Telegram chat (409 `chat_mismatch`); a deleted channel is 404.
 */
export const PATCH = adminHandler("admin/bonus-channels/update", { permission: "bonus.edit", mutation: true, rate: [30, 60] }, async (req, { params }: Ctx, admin) => {
  const id = (await params).id;
  const body = await readJson(req, 8 * 1024);
  return json(await updateBonusChannel(admin, id, body));
});

/** Soft delete (migration 051): the channel disappears everywhere; its claims and ledger rows stay. */
export const DELETE = adminHandler("admin/bonus-channels/delete", { permission: "bonus.edit", mutation: true }, async (req, { params }: Ctx, admin) => {
  const id = (await params).id;
  const body = await readJson(req, 8 * 1024);
  return json(await deleteBonusChannel(admin, id, body));
});
