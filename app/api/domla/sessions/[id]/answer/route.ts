import { handler, json, limit, requireUser } from "@/lib/server/api";
import { readWebAnswer, submitWebAnswer } from "@/lib/server/domla-web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST /api/domla/sessions/{id}/answer` -- the web chat's answer to the waiting question: `multipart/form-data`
 * (`audio` = the recorded voice, `seconds`) or JSON `{ text }`. Only queues the scoring (the worker does it), the
 * voice waits in `domla_audio` until scored and is then deleted. The session moves to the web channel.
 */
export const POST = handler("domla/answer", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await limit(`domla-answer:${user.id}`, 20, 60);
  const { id } = await ctx.params;
  const input = await readWebAnswer(req);
  const r = await submitWebAnswer(user.id, id, input);
  return json({ ok: true, idx: r.idx });
});
