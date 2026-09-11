import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { DRAFT_MAX_BYTES, clearDraft, getDraft, putDraft } from "@/lib/server/form-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rezyume formasi qoralamasi — ESKI marshrut.
 *
 * Maqola 2 / AUDIT-17 WP4 dan keyin ichki klient (`useResumeDraft`)
 * umumiy `/api/forms/resume/draft` ga chiqadi (`useFormDraft` o'rami).
 * Bu yo'l faqat orqaga moslik uchun qoladi (masalan eskirgan keshlangan
 * klient) — bir xil `form-draft.ts` handlerlarini `toolId="resume"`
 * bilan to'g'ridan-to'g'ri chaqiradi, alohida saqlash yo'q.
 *
 * Chastota `PUT` uchun yumshoq (60 / daqiqa): forma har o'zgarishda
 * emas, debounce bilan yuboradi, lekin uzoq yozish seansi bir necha
 * o'nlab saqlashni bersa ham foydalanuvchi bloklanmasligi kerak.
 */
export const GET = handler("resume-draft-get", async (req) => {
  const { user } = await requireUser(req);
  return json({ draft: await getDraft(user.id, "resume") });
});

export const PUT = handler("resume-draft-put", async (req) => {
  const { user } = await requireUser(req);
  await limit(`draft:${user.id}`, 60, 60);
  const body = await readJson<{ data?: unknown }>(req, DRAFT_MAX_BYTES);
  return json(await putDraft(user.id, "resume", body?.data));
});

export const DELETE = handler("resume-draft-del", async (req) => {
  const { user } = await requireUser(req);
  await clearDraft(user.id, "resume");
  return json({ ok: true });
});
