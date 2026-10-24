import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { cancelProposal } from "@/lib/server/chat/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `POST /api/chat/cancel` `{ token }` -- «Bekor qilish»: the proposal's token stops working. Nothing is charged either way. */
export const POST = handler("chat/cancel", async (req) => {
  const { user } = await requireUser(req);
  await limit(`chat:confirm:${user.id}`, 20, 60);
  const body = await readJson<{ token?: unknown }>(req, 2_000);
  return json({ ok: await cancelProposal({ userId: user.id, token: body.token }) });
});
