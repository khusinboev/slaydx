import { handler, json, limit, requireUser } from "@/lib/server/api";
import { uploadSource } from "@/lib/server/source-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * PDF matn qatlamini o'qish (`unpdf`) katta hujjatda 20–40 s oladi —
 * logotipdagi standart 30 s yetmaydi, namunadagi 120 s esa ortiqcha
 * (bu yerda LibreOffice chaqirilmaydi).
 */
export const maxDuration = 60;

/**
 * Tarjima manbasini yuklash (Tarjimon 2, WP1).
 *
 * `multipart/form-data`, maydon `file`. Javob — `SourceUploadResult`:
 * `{ assetId, name, kind, size, chars, text, truncatedPreview }`.
 * Hajm, sniff, o'lchash, saqlash — `lib/server/source-upload.ts` da; bu
 * yerda faqat autentifikatsiya va chastota.
 *
 * 20 ta / 10 daqiqa: namunadagi 5 tadan yumshoqroq, chunki bu yerda
 * LibreOffice chaqirilmaydi va foydalanuvchi bir necha faylni ketma-ket
 * sinab ko'rishi normal hol.
 */
export const POST = handler("uploads-source", async (req) => {
  const { user } = await requireUser(req);
  await limit(`source:${user.id}`, 20, 600);
  return json(await uploadSource(req, user.id));
});
