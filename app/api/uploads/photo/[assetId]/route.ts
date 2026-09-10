import { ApiError, handler, requireUser } from "@/lib/server/api";
import { getPhoto } from "@/lib/server/photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ assetId: string }> };

/**
 * Yuklangan suratni qaytaradi — forma qayta ochilganda ko'rish uchun va
 * «Rasmni markazlash» dialogi ASL nusxani shu yerdan oladi.
 *
 * Egalik SQL da (`getPhoto` `user_id` bilan qidiradi) — route darajasidagi
 * tekshiruv yetarli emas deb hisoblanadi (CLAUDE.md).
 */
export const GET = handler("uploads-photo-get", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { assetId } = await ctx.params;
  const row = await getPhoto(user.id, assetId);
  if (!row) throw new ApiError("Surat topilmadi", 404);
  return new Response(new Uint8Array(row.bytes), {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.bytes.byteLength),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
