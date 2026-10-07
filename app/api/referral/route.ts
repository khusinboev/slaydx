import { handler, json, requireUser } from "@/lib/server/api";
import { env } from "@/lib/server/env";
import { referralSummary } from "@/lib/server/referrals";
import { botUsername } from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/referral` — the signed-in user's invite program (profile section
 * «Do'stlarni taklif qiling»): own code and links, how many people joined
 * through them, points earned, the 20 most recent joiners.
 *
 * Other people appear by display name only — never their ids, usernames or phones.
 */
export const GET = handler("referral/summary", async (req) => {
  const { user } = await requireUser(req);
  const summary = await referralSummary(user.id, {
    botUsername: await botUsername(),
    appUrl: env.appUrl || new URL(req.url).origin,
  });
  return json(summary, { headers: { "Cache-Control": "private, no-store" } });
});
