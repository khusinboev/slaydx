import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { DRAFT_MAX_BYTES, clearDraft, getDraft, putDraft } from "@/lib/server/form-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Umumiy forma qoralamasi (Maqola 2 / AUDIT-17, WP4): `GET` tiklaydi,
 * `PUT` saqlaydi (forma o'zgarishidan 1,2 s keyin, debounce), `DELETE` —
 * «Tozalash» tugmasi. `toolId` `form-draft.ts` da `TOOL_BY_ID` bo'yicha
 * tekshiriladi — noma'lum vosita 400 bilan qaytadi.
 *
 * Eski `/api/resume/draft` shu handlerlarni `toolId="resume"` bilan
 * to'g'ridan-to'g'ri chaqiradi (orqaga moslik) — ikkalasi bitta
 * `form-draft.ts` ustida.
 */
type Ctx = { params: Promise<{ toolId: string }> };

export const GET = handler("form-draft-get", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { toolId } = await ctx.params;
  return json({ draft: await getDraft(user.id, toolId) });
});

export const PUT = handler("form-draft-put", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { toolId } = await ctx.params;
  await limit(`draft:${user.id}`, 60, 60);
  const body = await readJson<{ data?: unknown }>(req, DRAFT_MAX_BYTES);
  return json(await putDraft(user.id, toolId, body?.data));
});

export const DELETE = handler("form-draft-del", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { toolId } = await ctx.params;
  await clearDraft(user.id, toolId);
  return json({ ok: true });
});
