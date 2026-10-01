import "server-only";
import { ApiError, checkOrigin, handler } from "./api";
import { ensureMigrated } from "./db";
import { addLogContext, currentLogContext, type LogContext } from "./log";
import { clientIp, rateLimit } from "./ratelimit";
import { currentSessionRef, type SessionUser } from "./session";
import { can, needsStepUp, permissionsOf, type Permission, type Role } from "./admin-rbac";
import { writeDeniedAudit } from "./admin-audit";
import {
  getAdminAccountForUser,
  resolveAdminContext,
  slideAdminSession,
  type AdminAccount,
  type AdminSessionInfo,
} from "./admin-session";

/**
 * The single guard for every `/api/admin/**` route (docs/admin/02-plan.md §4.4).
 *
 * Pipeline, in this exact order (each step server-side):
 *   1. `handler(scope)` — request id, ApiError → JSON, 500 without detail;
 *   2. `ensureMigrated()`;
 *   3. mutations: an `Origin` header MUST be present and pass `checkOrigin`
 *      (stricter than user routes, which accept a missing Origin) → 403;
 *   4. no user / no admin account / disabled account → 404 "Topilmadi"
 *      (the panel's existence is not revealed);
 *   5. no valid admin session bound to the current user session → 401 admin_auth;
 *   6. slide the idle expiry (at most one write per 60 s);
 *   7. role lacks the permission → `denied` audit row + 403 forbidden;
 *   8. step-up permission without a reauth in the last 10 min → 401 reauth;
 *   9. per-admin, per-scope rate limit, fail-closed → 429;
 *  10. `addLogContext({ userId, adminId })`;
 *  11. `fn(req, ctx, admin)`.
 */

export type AdminActor = {
  id: string;
  userId: string;
  role: Role;
  permissions: Permission[];
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string | null;
  /** Not part of §4.4's list, but handlers need the session's step-up state and user. */
  user: SessionUser;
  session: AdminSessionInfo;
};

export type AdminHandlerOptions = {
  permission: Permission;
  mutation?: boolean;
  /** [count, windowSec]; defaults: reads 300/60, mutations 30/60. */
  rate?: readonly [number, number];
};

const NOT_FOUND = "Topilmadi";

/** Step 3: mutations need a present, same-site `Origin`. */
export function assertAdminOrigin(req: Request): void {
  if (!req.headers.get("origin") || !checkOrigin(req)) {
    throw new ApiError("So'rov manbasi noto'g'ri", 403);
  }
}

export function rateLimitedError(retryAfterSec: number): ApiError {
  return new ApiError(`Juda ko'p so'rov. ${retryAfterSec} soniyadan keyin urinib ko'ring.`, 429, {
    retryAfter: retryAfterSec,
    retryAfterSec,
  });
}

function userAgentOf(req: Request): string | null {
  const ua = req.headers.get("user-agent");
  return ua ? ua.slice(0, 300) : null;
}

/**
 * Wraps a route method. `C` is the Next route context (`{ params }`); it is
 * `unknown` for static routes so the exported function accepts whatever
 * Next passes.
 */
export function adminHandler<C = unknown>(
  scope: string,
  opts: AdminHandlerOptions,
  fn: (req: Request, ctx: C, admin: AdminActor) => Promise<Response>,
): (req: Request, ctx: C) => Promise<Response> {
  const [rateCount, rateWindow] = opts.rate ?? (opts.mutation ? [30, 60] : [300, 60]);
  return handler(scope, async (req: Request, ctx: C) => {
    await ensureMigrated();
    if (opts.mutation) assertAdminOrigin(req);

    const resolved = await resolveAdminContext(req);
    if (!resolved.ok) {
      if (resolved.reason === "no_user" || resolved.reason === "not_admin" || resolved.reason === "disabled") {
        throw new ApiError(NOT_FOUND, 404);
      }
      throw new ApiError("Admin sessiyasi tugagan. Qaytadan kiring.", 401, { code: "admin_auth" });
    }
    const { user, account, session } = resolved.ctx;

    if (session.needsSlide) await slideAdminSession(session.id);

    const admin: AdminActor = {
      id: account.id,
      userId: account.userId,
      role: account.role,
      permissions: permissionsOf(account.role),
      sessionId: session.id,
      ip: clientIp(req),
      userAgent: userAgentOf(req),
      requestId: currentLogContext().reqId ?? null,
      user,
      session,
    };

    if (!can(account.role, opts.permission)) {
      await writeDeniedAudit(admin, opts.permission, scope);
      throw new ApiError("Bu amal uchun ruxsatingiz yo'q", 403, { code: "forbidden" });
    }

    if (needsStepUp(opts.permission) && !session.reauthFresh) {
      throw new ApiError("Bu amal uchun kodni qayta kiriting", 401, { code: "reauth" });
    }

    const rl = await rateLimit(`admin:${account.id}:${scope}`, rateCount, rateWindow, { failClosed: true });
    if (!rl.ok) throw rateLimitedError(rl.retryAfterSec);

    const logCtx: LogContext & { adminId: string } = { userId: user.id, adminId: account.id };
    addLogContext(logCtx);
    return fn(req, ctx, admin);
  });
}

export type AdminAuthContext = {
  user: SessionUser;
  userSessionId: string;
  account: AdminAccount;
  ip: string;
  userAgent: string | null;
  requestId: string | null;
};

/**
 * For the auth routes (§6.1): a logged-in user with a pending or active admin
 * account, no admin session required. Same 404 cloak and Origin rule as
 * `adminHandler`; each route applies its own brute-force limits.
 */
export function adminAuthHandler<C = unknown>(
  scope: string,
  opts: { mutation?: boolean },
  fn: (req: Request, ctx: C, auth: AdminAuthContext) => Promise<Response>,
): (req: Request, ctx: C) => Promise<Response> {
  return handler(scope, async (req: Request, ctx: C) => {
    await ensureMigrated();
    if (opts.mutation) assertAdminOrigin(req);
    const ref = await currentSessionRef();
    if (!ref) throw new ApiError(NOT_FOUND, 404);
    const account = await getAdminAccountForUser(ref.user.id);
    if (!account) throw new ApiError(NOT_FOUND, 404);
    const logCtx: LogContext & { adminId: string } = { userId: ref.user.id, adminId: account.id };
    addLogContext(logCtx);
    return fn(req, ctx, {
      user: ref.user,
      userSessionId: ref.sessionId,
      account,
      ip: clientIp(req),
      userAgent: userAgentOf(req),
      requestId: currentLogContext().reqId ?? null,
    });
  });
}
