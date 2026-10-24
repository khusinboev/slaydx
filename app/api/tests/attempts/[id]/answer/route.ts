import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { answerQuestion } from "@/lib/server/paid-tests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST /api/tests/attempts/{id}/answer` `{ questionId, choice: 0..3 }` -- stores the choice (the last one before the
 * deadline wins). After the server deadline the answer is NOT counted: 409 `expired` and the attempt is finished.
 * The reply says nothing about correctness.
 */
export const POST = handler("tests/answer", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await limit(`tests-answer:${user.id}`, 240, 60);
  const { id } = await ctx.params;
  const body = await readJson<{ questionId?: unknown; choice?: unknown }>(req, 1_000);
  if (typeof body.questionId !== "number" || typeof body.choice !== "number") throw new ApiError("Noto‘g‘ri so‘rov", 400, { code: "bad_request" });
  const r = await answerQuestion(user.id, id, body.questionId, body.choice);
  if (r.ok) return json({ ok: true, answered: r.answered });
  switch (r.reason) {
    case "not_found":
      throw new ApiError("Topilmadi", 404, { code: "not_found" });
    case "finished":
      throw new ApiError("Test tugagan", 409, { code: "finished" });
    case "expired":
      throw new ApiError("Vaqt tugadi — javob hisobga olinmadi", 409, { code: "expired" });
    default:
      throw new ApiError("Noto‘g‘ri so‘rov", 400, { code: "bad_request" });
  }
});
