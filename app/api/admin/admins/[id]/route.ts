import { ApiError, json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId, updateAdmin } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Role and/or status change within rank limits; disabling revokes every session. */
export const PATCH = adminHandler(
  "admin/admins/update",
  { permission: "admins.manage", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Admin topilmadi", 404);
    const body = await readJson(req, 8_000);
    return json(await updateAdmin(admin, id, { role: body.role, status: body.status, reason: body.reason }));
  },
);
