import { ApiError, checkOrigin, handler, json, limit, optionalUser, readJson } from "@/lib/server/api";
import { normalizeRefCode } from "@/lib/referral";
import { REF_COOKIE, REF_COOKIE_MAX_AGE_SEC, refCookieOptions } from "@/lib/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/referral/capture {code}` — a visitor opened `/uz?ref=<code>`.
 *
 * Remembers the code in an httpOnly cookie (30 days, SameSite=Lax, sent only to
 * `/api/auth/*`) until this browser's first Telegram sign-in, which applies it
 * if — and only if — that sign-in creates the account. Nothing is credited
 * here and the code is not looked up (it is public anyway); a signed-in
 * visitor is already a user, so nothing is stored for them.
 */
export const POST = handler("referral/capture", async (req) => {
  if (!checkOrigin(req)) throw new ApiError("So'rov manbasi noto'g'ri", 403);
  const { user, ip } = await optionalUser(req);
  await limit(`refcap:${ip}`, 30, 600);
  const body = await readJson<{ code?: unknown }>(req, 1_000);
  const code = normalizeRefCode(body.code);
  if (!code) throw new ApiError("Taklif kodi noto'g'ri", 400);
  if (user) return json({ captured: false });
  const res = json({ captured: true });
  res.cookies.set(REF_COOKIE, code, refCookieOptions(REF_COOKIE_MAX_AGE_SEC));
  return res;
});
