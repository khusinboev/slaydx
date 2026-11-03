import { handler, json, limit, requireUser } from "@/lib/server/api";
import { deleteUserVoice } from "@/lib/server/media/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `DELETE /api/media/voices/<id>` (docs/studio/P5-SPEC.md): the user deletes their own clone. It is gone from the
 * Studio at once (a new clone may be made right away, and is paid again); the ElevenLabs voice is deleted now, or by
 * housekeeping when the provider does not answer (`providerDeleted: false`). Another user's id is a 404 (SQL ownership).
 */
export const DELETE = handler("media/voices/delete", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await limit(`media:voice-delete:${user.id}`, 20, 3600);
  const { id } = await ctx.params;
  return json(await deleteUserVoice(String(user.id), id));
});
