import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { acceptOffer } from "@/lib/server/oferta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/oferta/accept` `{ version }` -- the signed-in user accepts the offer version they were SHOWN
 * (the `version` of the 403 `offer_required` answer) -> `{ ok: true, version }`. A version that is no longer
 * current -> 409 `offer_outdated` (+ the current `version`) and nothing is recorded. Idempotent. Never gated.
 */
export const POST = handler("oferta/accept", async (req) => {
  const { user } = await requireUser(req);
  await limit(`oferta-accept:${user.id}`, 20, 300);
  const body = await readJson<{ version?: unknown }>(req, 1_000);
  if (typeof body.version !== "number") throw new ApiError("Oferta versiyasi ko'rsatilmagan", 400);
  const { version } = await acceptOffer(user.id, body.version);
  return json({ ok: true, version }, { headers: { "Cache-Control": "private, no-store" } });
});
