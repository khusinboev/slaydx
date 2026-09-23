import { ApiError, handler, requireUser } from "@/lib/server/api";
import { getPhoto } from "@/lib/server/photo";
import { bytesBody, noStoreOnError } from "@/lib/server/http-bytes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ assetId: string }> };

/**
 * Yuklangan suratni qaytaradi — forma qayta ochilganda ko'rish uchun va
 * «Rasmni markazlash» dialogi ASL nusxani shu yerdan oladi.
 *
 * Egalik SQL da (`getPhoto` `user_id` bilan qidiradi) — route darajasidagi
 * tekshiruv yetarli emas deb hisoblanadi (CLAUDE.md).
 *
 * Kesh (C08): `assetId` — baytning sha256 hashi (`photo.ts assetIdFor`),
 * bir URL hech qachon boshqa baytni bermaydi → `immutable`. Route
 * `next.config.ts` dagi `/api` no-store qoidasidan istisno, shuning uchun
 * xato javobiga `private, no-store` ni `noStoreOnError` qo'yadi.
 */
export const GET = noStoreOnError(
  handler("uploads-photo-get", async (req, ctx: Ctx) => {
    const { user } = await requireUser(req);
    const { assetId } = await ctx.params;
    const row = await getPhoto(user.id, assetId);
    if (!row) throw new ApiError("Surat topilmadi", 404);
    return new Response(bytesBody(row.bytes), {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(row.bytes.byteLength),
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }),
);
