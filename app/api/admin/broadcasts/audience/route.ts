import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { audienceCount, parseAudienceQuery } from "@/lib/server/admin-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live recipient count of an audience: users with a Telegram chat who are not blocked (plan §6.9). */
export const GET = adminHandler("admin/broadcasts/audience", { permission: "broadcasts.view" }, async (req) => {
  return json(await audienceCount(parseAudienceQuery(new URL(req.url))));
});
