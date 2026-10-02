import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseReason } from "@/lib/server/admin-accounts";
import { parseModerationId, revokeLink } from "@/lib/server/admin-moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kills a public link by setting `expires_at = now()`; the public route then answers 404 (plan §6.8). */
export const POST = adminHandler(
  "admin/moderation/revoke",
  { permission: "moderation.act", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseModerationId((await params).id);
    const body = await readJson(req, 8 * 1024);
    return json(await revokeLink(admin, id, parseReason(body.reason)!));
  },
);
