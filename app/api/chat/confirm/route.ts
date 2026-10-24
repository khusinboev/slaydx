import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { confirmFailureResponse } from "@/lib/server/chat/api-map";
import { confirmProposal } from "@/lib/server/chat/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/chat/confirm` `{ token, hash }` -- the user tapped «Tasdiqlash» on a proposal card. The ONLY route through
 * which a chat proposal becomes a paid generation: the token is server-issued, single-use, bound to this user and to the
 * exact values and price on the card, and valid for ten minutes.
 */
export const POST = handler("chat/confirm", async (req) => {
  const { user } = await requireUser(req);
  await limit(`chat:confirm:${user.id}`, 20, 60);
  const body = await readJson<{ token?: unknown; hash?: unknown }>(req, 2_000);
  const result = await confirmProposal({ userId: user.id, token: body.token, hash: body.hash });
  if (!result.ok) {
    const { status, body: out } = confirmFailureResponse(result);
    return json(out, { status });
  }
  return json({ id: result.generationId, price: result.price, status: "QUEUED" }, { status: 202, headers: result.replayed ? { "Idempotent-Replayed": "true" } : undefined });
});
