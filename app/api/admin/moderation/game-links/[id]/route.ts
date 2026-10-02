import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { getModerationLink, parseModerationId } from "@/lib/server/admin-moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S12 link detail: the answer-stripped public preview plus the newest 200 results (plan §6.8). */
export const GET = adminHandler(
  "admin/moderation/link",
  { permission: "moderation.view" },
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    return json(await getModerationLink(parseModerationId((await params).id)));
  },
);
