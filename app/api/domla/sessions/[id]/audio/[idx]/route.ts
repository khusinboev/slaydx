import { ApiError, handler, limit, requireUser } from "@/lib/server/api";
import { questionAudio } from "@/lib/server/domla";
import { bytesBody, NO_STORE } from "@/lib/server/http-bytes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; idx: string }> };

/**
 * `GET /api/domla/sessions/{id}/audio/{idx}` -- the examiner's spoken question `idx` (MP3) for the web chat's player.
 * Owner-checked in SQL, only once the question has been asked, never cached (`no-store`); gone when the defence ends.
 */
export const GET = handler("domla/audio", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await limit(`domla-audio:${user.id}`, 60, 60);
  const { id, idx } = await ctx.params;
  const n = /^\d{1,2}$/.test(idx) ? Number(idx) : -1;
  const a = await questionAudio(user.id, id, n);
  if (!a) throw new ApiError("Ovoz topilmadi", 404, { code: "not_found" });
  return new Response(bytesBody(a.bytes), {
    headers: { "Content-Type": a.mime, "Content-Length": String(a.bytes.byteLength), "Cache-Control": NO_STORE },
  });
});
