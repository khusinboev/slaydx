import { handler, json, requireUser } from "@/lib/server/api";
import { handleTemplateUpload, listTemplates } from "@/lib/server/template-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** LibreOffice rasterlash 20–40 s — logotipdagi 30 s yetmaydi. */
export const maxDuration = 120;

/**
 * «O'z shablonim» — PPTX namunasini yuklash (Shablonlar 2, B1).
 *
 * `multipart/form-data`, maydon `file`. Javob: `{ assetId, name, size,
 * template }` — `template` ko'ruvchi/galereya uchun yengil nusxa (profil +
 * rol fonlari). Hajm, sniff, tahlil, rasterlash, saqlash —
 * `lib/server/template-upload.ts` da; bu yerda faqat autentifikatsiya va
 * chastota (rasterlash qimmat: 5 ta / 10 daqiqa).
 */
export const POST = handler("uploads-template", async (req) => {
  const { user } = await requireUser(req);
  // Chastota (5 / 10 daqiqa), band LibreOffice → 503 — `handleTemplateUpload` da.
  return handleTemplateUpload(req, user.id);
});

/** Foydalanuvchining oldin yuklagan namunalari (baytsiz). */
export const GET = handler("uploads-template-list", async (req) => {
  const { user } = await requireUser(req);
  return json({ templates: await listTemplates(user.id) });
});
