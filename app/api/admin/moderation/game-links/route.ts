import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listModerationLinks, parseLinksQuery } from "@/lib/server/admin-moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S12 game links list: filters, keyset paging, result counts (plan §6.8). */
export const GET = adminHandler("admin/moderation/links", { permission: "moderation.view" }, async (req) => {
  return json(await listModerationLinks(parseLinksQuery(new URL(req.url))));
});
