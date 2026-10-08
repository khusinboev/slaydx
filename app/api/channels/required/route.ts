import { handler, json, limit, requireUser } from "@/lib/server/api";
import { canCreate, missingMandatory } from "@/lib/server/mandatory-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mandatory channels of the signed-in user (docs/bonus/BONUS3.md C-Q2/C-Q3):
 *
 *   GET /api/channels/required[?fresh=1] → { ok, needsTelegram, channels: [{id, title, joinUrl}] }
 *
 * `ok` = new work may be created (the same rule as the POST /api/generations gate). The tool
 * pages call it on load and on «✅ Tekshirish» (`fresh=1`: cached «not a member» answers are
 * asked again). Rate-limited: every miss costs a Bot API call per channel.
 */
export const GET = handler("channels/required", async (req) => {
  const { user } = await requireUser(req);
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  await limit(`chreq:${user.id}`, 30, 60);
  if (fresh) await limit(`chreq:fresh:${user.id}`, 10, 60);
  const c = await missingMandatory(String(user.id), { fresh });
  return json({ ok: canCreate(c), needsTelegram: c.needsTelegram, channels: c.channels });
});
