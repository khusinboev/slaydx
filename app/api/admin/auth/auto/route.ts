import { json } from "@/lib/server/api";
import { adminAuthHandler } from "@/lib/server/admin-handler";
import { setAdminCookie } from "@/lib/server/admin-session";
import { adminView, autoLogin, newSessionView } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Simple-mode entry (2FA switch off): opens an admin session for a designated
 * admin with no second factor. POST only — a session is never minted on GET.
 * `adminAuthHandler` keeps the cloak (non-admin, disabled, anonymous → 404)
 * and the Origin rule; `autoLogin` answers 404 when the switch is on.
 */
export const POST = adminAuthHandler("admin/auth/auto", { mutation: true }, async (_req, _ctx, auth) => {
  const session = await autoLogin(auth);
  const res = json({ admin: await adminView(auth.account.id), session: newSessionView(session) });
  setAdminCookie(res, session.token, session.expiresAt);
  return res;
});
