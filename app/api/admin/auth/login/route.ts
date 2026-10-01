import { json, readJson } from "@/lib/server/api";
import { adminAuthHandler } from "@/lib/server/admin-handler";
import { setAdminCookie } from "@/lib/server/admin-session";
import { adminView, loginWithTotp, newSessionView, requireAdminCrypto } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Second factor: a 6-digit TOTP opens a new admin session (§3.2 Login). */
export const POST = adminAuthHandler("admin/auth/login", { mutation: true }, async (req, _ctx, auth) => {
  requireAdminCrypto();
  const body = await readJson(req, 2_000);
  const session = await loginWithTotp(auth, body.code);
  const res = json({ admin: await adminView(auth.account.id), session: newSessionView(session) });
  setAdminCookie(res, session.token, session.expiresAt);
  return res;
});
