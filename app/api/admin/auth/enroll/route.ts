import { json, readJson } from "@/lib/server/api";
import { adminAuthHandler } from "@/lib/server/admin-handler";
import { setAdminCookie } from "@/lib/server/admin-session";
import { confirmEnrollment, enrollmentInfo, requireAdminCrypto } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TOTP enrollment (§3.2). The secret is returned only here, only to the
 * logged-in user the enrollment link was issued for, and only while the link
 * is unused and unexpired (T12).
 */
export const GET = adminAuthHandler("admin/auth/enroll-info", {}, async (req, _ctx, auth) => {
  requireAdminCrypto();
  const token = new URL(req.url).searchParams.get("token");
  return json(await enrollmentInfo(auth, token));
});

export const POST = adminAuthHandler("admin/auth/enroll", { mutation: true }, async (req, _ctx, auth) => {
  requireAdminCrypto();
  const body = await readJson(req, 2_000);
  const { recoveryCodes, session } = await confirmEnrollment(auth, body.token, body.code);
  const res = json({ recoveryCodes });
  setAdminCookie(res, session.token, session.expiresAt);
  return res;
});
