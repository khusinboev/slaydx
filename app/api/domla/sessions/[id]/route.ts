import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { chatState } from "@/lib/server/domla";
import { NO_STORE } from "@/lib/server/http-bytes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `GET /api/domla/sessions/{id}` -- the web chat of one defence (polled by components/domla/DomlaChat.tsx): the asked
 * questions, the scored answers, the waiting question, scoring / channel / notice, and the grade when finished. The
 * session must be the caller's own (SQL `user_id`); an unanswered question's ideal answer is never in it.
 */
export const GET = handler("domla/session", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await limit(`domla-chat:${user.id}`, 120, 60);
  const { id } = await ctx.params;
  const s = await chatState(user.id, id);
  if (!s) throw new ApiError("Bu himoya topilmadi", 404, { code: "not_found" });
  return json(s, { headers: { "Cache-Control": NO_STORE } });
});
