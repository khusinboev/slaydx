import { ApiError, json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId } from "@/lib/server/admin-accounts";
import { parseBlockBody, setUserBlocked } from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Block or unblock (plan §6.4): `blocked` must be a strict boolean (A5/T9);
 * optional side effects in the same transaction; 409 self / unchanged;
 * 403 when the target is an admin the actor may not manage.
 */
export const POST = adminHandler(
  "admin/users/block",
  { permission: "users.block", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    const input = parseBlockBody(await readJson(req, 8 * 1024));
    return json(await setUserBlocked(admin, id, input));
  },
);
