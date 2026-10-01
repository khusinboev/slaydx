import { ApiError, json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { clearAdminCookie } from "@/lib/server/admin-session";
import { parseBigintId, parseReason, revokeOwnSession } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ends one of the caller's own admin sessions; ending the current one also clears the cookie. */
export const POST = adminHandler(
  "admin/me/sessions/revoke",
  { permission: "self", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Sessiya topilmadi", 404);
    const body = await readJson(req, 8_000);
    const { current } = await revokeOwnSession(admin, id, parseReason(body.reason, { optional: true }));
    const res = json({ ok: true });
    if (current) clearAdminCookie(res);
    return res;
  },
);
