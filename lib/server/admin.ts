import "server-only";
import { ApiError, checkOrigin, type AuthedContext } from "./api";
import { clientIp } from "./ratelimit";
import { ensureMigrated } from "./db";
import { addLogContext, type LogContext } from "./log";
import { resolveAdminContext, slideAdminSession } from "./admin-session";

export { isAdminPhone, normalizePhone } from "./admin-phones";

/**
 * LEGACY guard of `app/api/admin/users/**` — kept only until the integration
 * step rewrites those routes on `adminHandler` and deletes this function
 * (docs/admin/02-plan.md §4.4, §13.2 "I").
 *
 * The phone allow-list is no longer an authorization source: this now
 * requires the same valid admin session as `adminHandler` (bound to the
 * current user session, account active) AND role owner or admin. Users
 * without an admin account still get 404, so the panel is not revealed.
 */
export async function requireAdmin(req: Request): Promise<AuthedContext> {
  await ensureMigrated();
  // Same rule as `adminHandler`: mutations need a present, same-site Origin.
  if (req.method !== "GET" && req.method !== "HEAD" && (!req.headers.get("origin") || !checkOrigin(req))) {
    throw new ApiError("So'rov manbasi noto'g'ri", 403);
  }
  const resolved = await resolveAdminContext(req);
  if (!resolved.ok) {
    if (resolved.reason === "no_user" || resolved.reason === "not_admin" || resolved.reason === "disabled") {
      throw new ApiError("Topilmadi", 404);
    }
    throw new ApiError("Admin sessiyasi tugagan. Qaytadan kiring.", 401, { code: "admin_auth" });
  }
  const { user, account, session } = resolved.ctx;
  if (account.role !== "owner" && account.role !== "admin") {
    throw new ApiError("Bu amal uchun ruxsatingiz yo'q", 403, { code: "forbidden" });
  }
  // The legacy mutations include the wallet adjustment (`users.wallet`, step-up
  // in §4.3); without per-route permissions every legacy mutation needs it.
  if (req.method !== "GET" && req.method !== "HEAD" && !session.reauthFresh) {
    throw new ApiError("Bu amal uchun kodni qayta kiriting", 401, { code: "reauth" });
  }
  if (session.needsSlide) await slideAdminSession(session.id);
  const logCtx: LogContext & { adminId: string } = { userId: user.id, adminId: account.id };
  addLogContext(logCtx);
  return { user, ip: clientIp(req) };
}
