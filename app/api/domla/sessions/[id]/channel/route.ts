import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { isDomlaChannel, setChannel } from "@/lib/server/domla";
import { channelError } from "@/lib/server/domla-web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST /api/domla/sessions/{id}/channel` `{ channel: "bot" | "web" }` -- «Botda davom etish» / «Saytda davom etish».
 * To the bot: the waiting question is sent there again (its stored voice); a user without Telegram gets 409
 * `no_telegram`. To the web: the chat takes over.
 */
export const POST = handler("domla/channel", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await limit(`domla-channel:${user.id}`, 20, 60);
  const { id } = await ctx.params;
  const body = await readJson<{ channel?: unknown }>(req, 1_000);
  if (!isDomlaChannel(body.channel)) throw new ApiError("Kanal noto‘g‘ri", 400, { code: "bad_request" });
  const r = await setChannel(user.id, id, body.channel);
  if (!r.ok) throw channelError(r);
  return json({ ok: true, channel: r.channel, resent: r.resent });
});
