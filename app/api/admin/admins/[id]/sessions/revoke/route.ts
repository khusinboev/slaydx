import { ApiError, json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId, revokeSessionsOf } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ends every admin session of another admin (within rank limits). */
export const POST = adminHandler(
  "admin/admins/revoke-sessions",
  { permission: "admins.manage", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Admin topilmadi", 404);
    const body = await readJson(req, 8_000);
    return json(await revokeSessionsOf(admin, id, body.reason));
  },
);
