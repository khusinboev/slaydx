import { ApiError, handler, json, requireUser } from "@/lib/server/api";
import { deleteTemplate } from "@/lib/server/template-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Namunani o'chirish — egalik SQL da (`WHERE user_id = $1 AND asset_id = $2`). */
export const DELETE = handler("uploads-template-delete", async (req, ctx: { params: Promise<{ assetId: string }> }) => {
  const { user } = await requireUser(req);
  const { assetId } = await ctx.params;
  const ok = await deleteTemplate(user.id, assetId);
  if (!ok) throw new ApiError("Namuna topilmadi", 404);
  return json({ ok: true });
});
