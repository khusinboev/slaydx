import { ApiError, handler, requireUser } from "@/lib/server/api";
import { busyResponse, SofficeBusyError } from "@/lib/server/soffice-gate";
import { getOrBuildThumb } from "@/lib/server/thumb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Birinchi so'rovda LibreOffice o'giradi (2–8 s); keyingilari aktivdan. */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fayl kartasi eskizi (AUDIT-14): DOCX/PPTX natijaning 1-sahifasi, kichik JPEG.
 * Egalik SQL da (`getOrBuildThumb`). O'girib bo'lmasa 404 — karta matn
 * ko'rinishiga qaytadi. LibreOffice slotlari band bo'lsa 503 + `Retry-After`
 * (C07) — karta ham matn ko'rinishida qoladi.
 */
export const GET = handler("generations/thumb", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);
  let jpeg: Buffer | null;
  try {
    jpeg = await getOrBuildThumb(id, user.id);
  } catch (e) {
    if (e instanceof SofficeBusyError) return busyResponse(e);
    throw e;
  }
  if (!jpeg) throw new ApiError("Eskiz yo'q", 404);
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.byteLength),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
