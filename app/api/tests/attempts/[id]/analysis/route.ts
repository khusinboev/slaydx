import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { NO_STORE } from "@/lib/server/http-bytes";
import { attemptAnalysis } from "@/lib/server/test-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `GET /api/tests/attempts/{id}/analysis[?retry=1]` -- the AI analysis of the wrong and unanswered questions of the
 * caller's FINISHED attempt (included in the price). Returns at once: ready analyses from the shared cache, the rest
 * `pending` while the model works in the background (the page polls). `retry=1` restarts the failed ones.
 * A foreign or unknown id is a 404; a running attempt is a 409 `not_finished` with nothing about the key.
 */
export const GET = handler("tests/analysis", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  await limit(`tests-analysis:${user.id}`, 60, 60);
  const retry = new URL(req.url).searchParams.get("retry") === "1";
  const r = await attemptAnalysis(user.id, id, { retry });
  if (!r.ok && r.reason === "not_found") throw new ApiError("Topilmadi", 404, { code: "not_found" });
  if (!r.ok) throw new ApiError("Test hali tugamagan", 409, { code: "not_finished" });
  return json(r.view, { headers: { "Cache-Control": NO_STORE } });
});
