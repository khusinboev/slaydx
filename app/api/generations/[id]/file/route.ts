import { ApiError, handler, requireUser } from "@/lib/server/api";
import { getGenerationFile } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fayl nomidagi sarlavha injeksiyasini oldini oladi. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Yaratilgan faylni beradi.
 *
 * Egalik `getGenerationFile` ichida SQL darajasida tekshiriladi — id ni
 * bilgan begona foydalanuvchi hujjatni ololmaydi (IDOR yo'q).
 */
export const GET = handler("generations/file", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  const file = await getGenerationFile(id, user.id);
  if (!file) throw new ApiError("Fayl topilmadi yoki muddati tugagan", 404);

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": contentDisposition(file.fileName),
      // Hujjat shaxsiy — proxy yoki CDN keshlamasin.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
