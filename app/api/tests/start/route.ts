import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { startAttempt } from "@/lib/server/paid-tests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/tests/start` `{ mode: "subject" | "all", subject?: code, key?: string }` -- starts an attempt: picks the
 * questions, charges the mode's price (`tests.price_subject` or `tests.price_all`) and opens the timer in ONE transaction. The body carries no price.
 * Idempotent: the same open attempt (or the same `key`) comes back with `alreadyOpen: true` and nothing is charged again.
 */
export const POST = handler("tests/start", async (req) => {
  const { user } = await requireUser(req);
  await limit(`tests-start:${user.id}`, 10, 60);
  const body = await readJson<{ mode?: unknown; subject?: unknown; key?: unknown }>(req, 2_000);
  if (body.mode !== "subject" && body.mode !== "all") throw new ApiError("Rejim tanlanmadi", 400, { code: "bad_request" });
  if (body.mode === "subject" && (typeof body.subject !== "string" || !body.subject)) throw new ApiError("Fan tanlanmadi", 400, { code: "bad_request" });
  if (body.key !== undefined && typeof body.key !== "string") throw new ApiError("Noto‘g‘ri kalit", 400, { code: "bad_request" });
  const r = await startAttempt(user.id, {
    mode: body.mode,
    subjectCode: body.mode === "subject" ? (body.subject as string) : null,
    key: (body.key as string | undefined) ?? null,
  });
  return json({ ok: true, ...r });
});
