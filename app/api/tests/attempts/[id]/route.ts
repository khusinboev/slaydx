import { ApiError, handler, json, requireUser } from "@/lib/server/api";
import { getAttemptView } from "@/lib/server/paid-tests";
import { NO_STORE } from "@/lib/server/http-bytes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `GET /api/tests/attempts/{id}` -- the caller's own attempt. While it is running: the questions (text / image URL /
 * options) and the caller's own choices -- NEVER the answer key or the explanations. Once finished (by the user, or
 * by the server at the deadline): the score and the full review. A foreign or unknown id is a 404.
 */
export const GET = handler("tests/attempt", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  const view = await getAttemptView(user.id, id);
  if (!view) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  return json(view, { headers: { "Cache-Control": NO_STORE } });
});
