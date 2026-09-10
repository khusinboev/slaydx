import { ApiError, handler, json, requireUser } from "@/lib/server/api";
import { deleteSource } from "@/lib/server/source-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manbani o'chirish — egalik SQL da (`WHERE user_id = $1 AND asset_id = $2`). */
export const DELETE = handler("uploads-source-delete", async (req, ctx: { params: Promise<{ assetId: string }> }) => {
  const { user } = await requireUser(req);
  const { assetId } = await ctx.params;
  const ok = await deleteSource(user.id, assetId);
  if (!ok) throw new ApiError("Fayl topilmadi", 404);
  return json({ ok: true });
});
