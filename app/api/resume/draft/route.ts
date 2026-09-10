import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { DRAFT_MAX_BYTES, clearDraft, getDraft, putDraft } from "@/lib/server/resume-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rezyume formasi qoralamasi: `GET` tiklaydi, `PUT` saqlaydi (forma
 * o'zgarishidan 1,2 s keyin), `DELETE` — «Tozalash» tugmasi.
 *
 * Chastota `PUT` uchun yumshoq (60 / daqiqa): forma har o'zgarishda emas,
 * debounce bilan yuboradi, lekin uzoq yozish seansi bir necha o'nlab
 * saqlashni bersa ham foydalanuvchi bloklanmasligi kerak.
 */
export const GET = handler("resume-draft-get", async (req) => {
  const { user } = await requireUser(req);
  return json({ draft: await getDraft(user.id) });
});

export const PUT = handler("resume-draft-put", async (req) => {
  const { user } = await requireUser(req);
  await limit(`draft:${user.id}`, 60, 60);
  const body = await readJson<{ data?: unknown }>(req, DRAFT_MAX_BYTES);
  return json(await putDraft(user.id, body?.data));
});

export const DELETE = handler("resume-draft-del", async (req) => {
  const { user } = await requireUser(req);
  await clearDraft(user.id);
  return json({ ok: true });
});
