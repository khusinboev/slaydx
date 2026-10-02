import { ApiError, json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId } from "@/lib/server/admin-accounts";
import { listUserSessions } from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The user's login sessions, newest first (plan §6.4). */
export const GET = adminHandler(
  "admin/users/sessions",
  { permission: "users.sessions" },
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    return json(await listUserSessions(id));
  },
);
