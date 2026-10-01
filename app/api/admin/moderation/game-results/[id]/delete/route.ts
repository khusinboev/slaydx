import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseReason } from "@/lib/server/admin-accounts";
import { deleteResult, parseModerationId } from "@/lib/server/admin-moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deletes one result; the audit row's `before` holds the full row (plan §6.8, §8). */
export const POST = adminHandler(
  "admin/moderation/result-delete",
  { permission: "moderation.act", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseModerationId((await params).id);
    const body = await readJson(req, 8 * 1024);
    return json(await deleteResult(admin, id, parseReason(body.reason)!));
  },
);
