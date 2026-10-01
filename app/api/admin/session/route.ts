import { json } from "@/lib/server/api";
import { adminAuthHandler } from "@/lib/server/admin-handler";
import { clearAdminCookie, readAdminToken, resolveAdminContext } from "@/lib/server/admin-session";
import { adminView, logout, resolvedSessionView } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The admin's identity and current admin session (`null` when there is none:
 * the UI then shows login or enrollment). Read-only: it does not slide the
 * idle expiry, so a polling tab cannot keep a session alive.
 */
export const GET = adminAuthHandler("admin/session/get", {}, async (req, _ctx, auth) => {
  const resolved = await resolveAdminContext(req);
  return json({
    admin: await adminView(auth.account.id),
    session: resolved.ok ? resolvedSessionView(resolved.ctx.session) : null,
  });
});

/** Logout: revokes the admin session behind the cookie and clears the cookie. */
export const DELETE = adminAuthHandler("admin/session/delete", { mutation: true }, async (req, _ctx, auth) => {
  await logout(auth, await readAdminToken(req));
  const res = json({ ok: true });
  clearAdminCookie(res);
  return res;
});
