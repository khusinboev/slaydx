import { ApiError, handler, requireUser } from "@/lib/server/api";
import { bytesBody, NO_STORE, noStoreOnError } from "@/lib/server/http-bytes";
import { busyResponse, SofficeBusyError } from "@/lib/server/soffice-gate";
import { getOrBuildVersionedThumb, type VersionedThumb } from "@/lib/server/thumb";

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
 *
 * Kesh (C08, review W2-B R2; DB-14): route URL i o'zgarmaydi. Shuning uchun
 * brauzer keshi faqat `?v=` eskiz YASALGAN `file_version` ga teng bo'lganda
 * (u joriy versiya kaliti bilan o'qiladi) — kesh kaliti amalda fayl versiyasi,
 * tahrir/qayta yasashdan keyin klient yangi `v` bilan so'raydi. Versiyasiz
 * yoki eski `v` — `private, no-store`. Route `next.config.ts` dagi `/api`
 * no-store qoidasidan istisno, shuning uchun har xato javobi (400/401/404/
 * 500) ham `noStoreOnError` orqali `private, no-store` oladi.
 */
export const GET = noStoreOnError(
  handler("generations/thumb", async (req, ctx: Ctx) => {
    const { user } = await requireUser(req);
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);
    let thumb: VersionedThumb | null;
    try {
      thumb = await getOrBuildVersionedThumb(id, user.id);
    } catch (e) {
      if (e instanceof SofficeBusyError) return busyResponse(e);
      throw e;
    }
    if (!thumb) throw new ApiError("Eskiz yo'q", 404);
    const { jpeg } = thumb;

    // `?v=` eskiz AYNAN yasalgan versiya bilan solishtiriladi (CONC-15): rebuild
    // paytida yo'lda bo'lgan qurilish eski eskizni bersa, u yangi `?v=` ostida
    // immutable keshga tushmaydi.
    const v = new URL(req.url).searchParams.get("v");
    const cacheable = v !== null && v === String(thumb.fileVersion);
    return new Response(bytesBody(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(jpeg.byteLength),
        "Cache-Control": cacheable ? "private, max-age=86400, immutable" : NO_STORE,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }),
);
