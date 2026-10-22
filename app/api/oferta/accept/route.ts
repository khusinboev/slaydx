import { handler, json, limit, requireUser } from "@/lib/server/api";
import { acceptOffer } from "@/lib/server/oferta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/oferta/accept` -- the signed-in user accepts the CURRENT offer version -> `{ ok: true, version }`.
 * Idempotent. Never gated by the offer itself.
 */
export const POST = handler("oferta/accept", async (req) => {
  const { user } = await requireUser(req);
  await limit(`oferta-accept:${user.id}`, 20, 300);
  const { version } = await acceptOffer(user.id);
  return json({ ok: true, version }, { headers: { "Cache-Control": "private, no-store" } });
});
