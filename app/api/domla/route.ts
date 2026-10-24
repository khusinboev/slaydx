import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { domlaEnabled, domlaPrice, listDefendable, listHistory, openSession, publicSession, startDefence } from "@/lib/server/domla";
import { botUsername } from "@/lib/server/telegram";
import { NO_STORE } from "@/lib/server/http-bytes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/domla` -- everything the «Qattiqqo'l domla» page shows: the switch, the price (the server's only
 * price), the works that can be defended, the open defence and the history (grades). Charges nothing.
 */
export const GET = handler("domla/get", async (req) => {
  const { user } = await requireUser(req);
  const [enabled, price, works, open, history, bot] = await Promise.all([
    domlaEnabled(),
    domlaPrice(),
    listDefendable(user.id, 20),
    openSession(user.id),
    listHistory(user.id, 20),
    botUsername(),
  ]);
  return json(
    {
      enabled,
      price,
      telegramLinked: Boolean(user.telegramId),
      botUrl: bot ? `https://t.me/${bot}` : null,
      works,
      open: open ? publicSession(open) : null,
      history: history.filter((s) => s.status === "finished" || s.status === "expired").map(publicSession),
    },
    { headers: { "Cache-Control": NO_STORE } },
  );
});

/**
 * `POST /api/domla` `{ generationId }` -- starts a defence: charges `domla.price` and queues the questions in one
 * transaction (idempotent while the same work's defence is open). The defence itself happens in the bot chat.
 */
export const POST = handler("domla/start", async (req) => {
  const { user } = await requireUser(req);
  await limit(`domla-start:${user.id}`, 10, 60);
  const body = await readJson<{ generationId?: unknown }>(req, 2_000);
  if (typeof body.generationId !== "string" || !body.generationId) throw new ApiError("Ish tanlanmadi", 400, { code: "bad_request" });
  const r = await startDefence(user.id, body.generationId);
  return json({ ok: true, sessionId: r.session.id, alreadyOpen: r.alreadyOpen, price: r.price, status: r.session.status });
});
