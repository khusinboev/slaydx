import { handler, json, limit, requireUser } from "@/lib/server/api";
import { listTemplates, uploadTemplate } from "@/lib/server/template-upload";

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
  await limit(`template:${user.id}`, 5, 600);
  return json(await uploadTemplate(req, user.id));
});

/** Foydalanuvchining oldin yuklagan namunalari (baytsiz). */
export const GET = handler("uploads-template-list", async (req) => {
  const { user } = await requireUser(req);
  return json({ templates: await listTemplates(user.id) });
});
