import { ApiError, json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId } from "@/lib/server/admin-accounts";
import { getAdminUser, parseReveal } from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPE = "admin/users/get";

/**
 * S5 user detail (plan §6.4): masked by default; `reveal=1` needs `users.pii`
 * and is audited (`users.pii.view`). The legacy PATCH (wallet) and PUT (block)
 * are gone: `wallet-adjustments` (F6) and `block` replace them.
 */
export const GET = adminHandler(SCOPE, { permission: "users.view" }, async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
  const id = parseBigintId((await params).id);
  if (!id) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  const reveal = parseReveal(new URL(req.url));
  return json(await getAdminUser(admin, id, reveal, SCOPE));
});
