import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { createBonusChannel, listBonusChannels } from "@/lib/server/admin-bonus-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every bonus channel with its claim stats, ordered by `sort, id` (docs/bonus/PLAN.md K2). */
export const GET = adminHandler("admin/bonus-channels/list", { permission: "bonus.view" }, async () => {
  return json(await listBonusChannels());
});

/**
 * Adds a channel: `{input, title?, joinBonus, stayBonus?, stayDays?, active?, sort?, reason?}`.
 * The chat is resolved on the server (Bot API `getChat`); row + audit in one transaction.
 */
export const POST = adminHandler("admin/bonus-channels/create", { permission: "bonus.edit", mutation: true, rate: [20, 60] }, async (req, _ctx, admin) => {
  const body = await readJson(req, 8 * 1024);
  return json(await createBonusChannel(admin, body), { status: 201 });
});
