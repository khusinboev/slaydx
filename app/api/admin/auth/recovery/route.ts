import { json, readJson } from "@/lib/server/api";
import { adminAuthHandler } from "@/lib/server/admin-handler";
import { setAdminCookie } from "@/lib/server/admin-session";
import { adminView, loginWithRecovery, newSessionView, requireAdminCrypto } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Login with a one-time recovery code instead of a TOTP (§3.2 Recovery login). */
export const POST = adminAuthHandler("admin/auth/recovery", { mutation: true }, async (req, _ctx, auth) => {
  requireAdminCrypto();
  const body = await readJson(req, 2_000);
  const { session, remaining } = await loginWithRecovery(auth, body.code);
  const res = json({ admin: await adminView(auth.account.id), session: newSessionView(session), remaining });
  setAdminCookie(res, session.token, session.expiresAt);
  return res;
});
