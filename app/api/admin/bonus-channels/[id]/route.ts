import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { deleteBonusChannel, updateBonusChannel } from "@/lib/server/admin-bonus-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** `{title?, joinBonus?, stayBonus?, stayDays?, active?, sort?, reason?}`; only changed fields are audited. */
export const PATCH = adminHandler("admin/bonus-channels/update", { permission: "bonus.edit", mutation: true }, async (req, { params }: Ctx, admin) => {
  const id = (await params).id;
  const body = await readJson(req, 8 * 1024);
  return json(await updateBonusChannel(admin, id, body));
});

/** Hard delete, only for a channel nobody has claimed (409 `has_claims` otherwise — deactivate instead). */
export const DELETE = adminHandler("admin/bonus-channels/delete", { permission: "bonus.edit", mutation: true }, async (req, { params }: Ctx, admin) => {
  const id = (await params).id;
  const body = await readJson(req, 8 * 1024);
  return json(await deleteBonusChannel(admin, id, body));
});
