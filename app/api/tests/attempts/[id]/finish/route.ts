import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { finishAttempt, getAttemptView } from "@/lib/server/paid-tests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** `POST /api/tests/attempts/{id}/finish` -- «Tugatish». Idempotent; replies with the finished view (score + review). */
export const POST = handler("tests/finish", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await limit(`tests-finish:${user.id}`, 30, 60);
  const { id } = await ctx.params;
  if (!(await finishAttempt(user.id, id))) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  const view = await getAttemptView(user.id, id);
  if (!view) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  return json(view);
});
