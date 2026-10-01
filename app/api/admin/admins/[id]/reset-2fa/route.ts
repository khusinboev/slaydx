import { ApiError, json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId, resetAdmin2fa } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clears another admin's 2FA, revokes their sessions and issues a new enrollment link. */
export const POST = adminHandler(
  "admin/admins/reset-2fa",
  { permission: "admins.manage", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Admin topilmadi", 404);
    const body = await readJson(req, 8_000);
    return json(await resetAdmin2fa(admin, id, body.reason));
  },
);
