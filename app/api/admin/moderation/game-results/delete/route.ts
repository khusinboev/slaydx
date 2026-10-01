import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseReason } from "@/lib/server/admin-accounts";
import { deleteResults, parseBulkIds } from "@/lib/server/admin-moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bulk delete (<= 100 ids): all-or-nothing, one audit row per id (plan §6.8, §8). */
export const POST = adminHandler(
  "admin/moderation/results-delete",
  { permission: "moderation.act", mutation: true },
  async (req, _ctx, admin) => {
    const body = await readJson(req, 8 * 1024);
    const ids = parseBulkIds(body.ids);
    return json(await deleteResults(admin, ids, parseReason(body.reason)!));
  },
);
