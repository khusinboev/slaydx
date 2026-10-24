import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { chatStatus, sendChatMessage, webHistory } from "@/lib/server/chat/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** `GET /api/chat` -- the user's web conversation (last 40 messages, open cards included) and "Bugun tekin: N/10". Charges nothing. */
export const GET = handler("chat/status", async (req) => {
  const { user } = await requireUser(req);
  const [status, messages] = await Promise.all([chatStatus(user.id, {}, user), webHistory(user.id)]);
  return json({ status, messages });
});

/**
 * `POST /api/chat` `{ text, clientId }` -- one message. The first 10 per Tashkent day are free; later ones cost
 * `chat.price_per_message` (charged once per `clientId`). Returns the assistant's reply, possibly with a proposal card;
 * nothing is ever created or charged for a proposal until `POST /api/chat/confirm`.
 */
export const POST = handler("chat/send", async (req) => {
  const { user } = await requireUser(req);
  await limit(`chat:burst:${user.id}`, 12, 60);
  await limit(`chat:hour:${user.id}`, 200, 3600);
  const body = await readJson<{ text?: unknown; clientId?: unknown }>(req, 16_000);
  const reply = await sendChatMessage({ userId: user.id, channel: "web", text: body.text, clientId: body.clientId, signal: req.signal });
  return json(reply);
});
