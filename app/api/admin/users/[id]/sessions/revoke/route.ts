import { ApiError, json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId } from "@/lib/server/admin-accounts";
import { revokeUserSessions } from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revokes every live session of the user (plan §6.4): `{reason}` → `{revoked}`; 409 self. */
export const POST = adminHandler(
  "admin/users/sessions-revoke",
  { permission: "users.sessions", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    const body = await readJson(req, 8 * 1024);
    return json(await revokeUserSessions(admin, id, body.reason));
  },
);
