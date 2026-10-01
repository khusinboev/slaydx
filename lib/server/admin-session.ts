import "server-only";
import type { PoolClient } from "pg";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { env } from "./env";
import { query, queryOne } from "./db";
import { currentSessionRef, type SessionUser } from "./session";
import { hashToken, randomToken } from "./admin-crypto";
import type { Role } from "./admin-rbac";

/**
 * Admin sessions (docs/admin/02-plan.md §3.1).
 *
 * An admin session is a second layer on top of the normal user session:
 *   • its own cookie (`__Host-` in prod: Secure, Path=/, no Domain — cannot be
 *     planted by a sibling subdomain), HttpOnly, SameSite=Strict;
 *   • 30 min sliding idle timeout, 12 h absolute lifetime;
 *   • bound to the `sessions` row of the CURRENT user cookie. A user logout,
 *     "logout everywhere", expiry or block ends admin access on the next
 *     request, and an admin cookie stolen alone is useless in another browser.
 *
 * Time comparisons happen in SQL (`now()`), so app/DB clock skew cannot
 * stretch a session.
 */

export const ADMIN_IDLE_MIN = 30;
export const ADMIN_ABSOLUTE_HOURS = 12;
export const ADMIN_SLIDE_EVERY_SEC = 60;
export const ADMIN_REAUTH_MIN = 10;

export type AdminStatus = "pending" | "active" | "disabled";

export type AdminAccount = {
  id: string;
  userId: string;
  role: Role;
  status: AdminStatus;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AdminSessionInfo = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  expiresAt: string;
  reauthAt: string | null;
  /** `reauth_at` within the last 10 minutes (computed by the DB). */
  reauthFresh: boolean;
  /** Last write is older than 60 s — the idle expiry may be slid. */
  needsSlide: boolean;
};

export type AdminContext = {
  user: SessionUser;
  userSessionId: string;
  account: AdminAccount;
  session: AdminSessionInfo;
};

export type AdminDenyReason = "no_user" | "not_admin" | "disabled" | "no_session" | "expired";

export type ResolveResult =
  | { ok: true; ctx: AdminContext }
  | {
      ok: false;
      reason: AdminDenyReason;
      user?: SessionUser;
      userSessionId?: string;
      account?: AdminAccount;
    };

type Queryable = Pick<PoolClient, "query">;

// ───────────────────────────── cookie

export function adminCookieName(): string {
  return env.isProd ? "__Host-slaydx_admin" : "slaydx_admin";
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "strict" as const,
    path: "/",
    expires,
  };
}

/** Set on the response object (not `cookies()`), so it works in every route context. */
export function setAdminCookie(res: NextResponse, token: string, expiresAt: Date): void {
  res.cookies.set(adminCookieName(), token, cookieOptions(expiresAt));
}

export function clearAdminCookie(res: NextResponse): void {
  res.cookies.set(adminCookieName(), "", { ...cookieOptions(new Date(0)), maxAge: 0 });
}

function cookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** The admin token from the request (or, without one, from `next/headers` cookies). */
export async function readAdminToken(req?: Request): Promise<string | null> {
  const name = adminCookieName();
  const token = req ? cookieFromHeader(req.headers.get("cookie"), name) : ((await cookies()).get(name)?.value ?? null);
  // Our tokens are 43-char base64url; anything else cannot match and is not looked up.
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

// ───────────────────────────── accounts

type AccountRow = {
  id: string;
  user_id: string;
  role: Role;
  status: AdminStatus;
  totp_enabled: boolean;
  last_login_at: Date | null;
  created_at: Date;
};

export const ACCOUNT_COLUMNS = `a.id::text AS id, a.user_id::text AS user_id, a.role, a.status,
  (a.totp_enabled_at IS NOT NULL AND a.totp_secret_enc IS NOT NULL) AS totp_enabled, a.last_login_at, a.created_at`;

export function rowToAccount(r: AccountRow): AdminAccount {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    role: r.role,
    status: r.status,
    totpEnabled: Boolean(r.totp_enabled),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

async function accountByUserId(userId: string): Promise<AdminAccount | null> {
  const row = await queryOne<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM admin_accounts a WHERE a.user_id = $1`, [userId]);
  return row ? rowToAccount(row) : null;
}

/** For page gates: the user's admin account when it is pending or active, else `null`. */
export async function getAdminAccountForUser(userId: string): Promise<AdminAccount | null> {
  const acc = await accountByUserId(userId);
  return acc && (acc.status === "active" || acc.status === "pending") ? acc : null;
}

// ───────────────────────────── sessions

export async function createAdminSession(
  client: Queryable,
  p: { adminId: string; userSessionId: string; ip: string | null; userAgent: string | null; reauth: boolean },
): Promise<NewAdminSession> {
  // A fresh token at every login (no fixation: nothing the client sent is reused).
  const token = randomToken();
  const res = await client.query<{ id: string; expires_at: Date; idle_expires_at: Date; reauth_until: Date | null }>(
    `INSERT INTO admin_sessions (admin_id, user_session_id, token_hash, ip, user_agent, idle_expires_at, expires_at, reauth_at)
     VALUES ($1, $2, $3, $4, $5,
             now() + make_interval(mins => $6), now() + make_interval(hours => $7),
             CASE WHEN $8::boolean THEN now() END)
     RETURNING id::text AS id, expires_at, idle_expires_at, reauth_at + make_interval(mins => $9) AS reauth_until`,
    [
      p.adminId,
      p.userSessionId,
      hashToken(token),
      p.ip ? p.ip.slice(0, 60) : null,
      p.userAgent ? p.userAgent.slice(0, 300) : null,
      ADMIN_IDLE_MIN,
      ADMIN_ABSOLUTE_HOURS,
      p.reauth,
      ADMIN_REAUTH_MIN,
    ],
  );
  const row = res.rows[0]!;
  return {
    id: row.id,
    token,
    expiresAt: new Date(row.expires_at),
    idleExpiresAt: new Date(row.idle_expires_at),
    reauthUntil: row.reauth_until ? new Date(row.reauth_until) : null,
  };
}

export type NewAdminSession = { id: string; token: string; expiresAt: Date; idleExpiresAt: Date; reauthUntil: Date | null };

type SessionRow = {
  id: string;
  user_session_id: string;
  created_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  expires_at: Date;
  reauth_at: Date | null;
  live: boolean;
  reauth_fresh: boolean;
  needs_slide: boolean;
};

function rowToSession(r: SessionRow): AdminSessionInfo {
  return {
    id: String(r.id),
    createdAt: new Date(r.created_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    idleExpiresAt: new Date(r.idle_expires_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
    reauthAt: r.reauth_at ? new Date(r.reauth_at).toISOString() : null,
    reauthFresh: Boolean(r.reauth_fresh),
    needsSlide: Boolean(r.needs_slide),
  };
}

/**
 * Resolves the full admin context of the current request, or why it fails:
 *   no_user    — no valid (unblocked, unexpired) user session;
 *   not_admin  — the user has no admin account;
 *   disabled   — the account is disabled;
 *   no_session — no admin cookie, unknown/revoked token, a session of another
 *                account, a session bound to a different user session, or an
 *                account that is not `active` (pending enrollment);
 *   expired    — idle or absolute lifetime is over.
 * Read-only: sliding the idle expiry is the caller's job (`slideAdminSession`).
 */
export async function resolveAdminContext(req?: Request): Promise<ResolveResult> {
  const ref = await currentSessionRef();
  if (!ref) return { ok: false, reason: "no_user" };
  const { user, sessionId: userSessionId } = ref;
  const account = await accountByUserId(user.id);
  if (!account) return { ok: false, reason: "not_admin", user, userSessionId };
  if (account.status === "disabled") return { ok: false, reason: "disabled", user, userSessionId, account };

  const token = await readAdminToken(req);
  if (!token) return { ok: false, reason: "no_session", user, userSessionId, account };
  const row = await queryOne<SessionRow>(
    `SELECT s.id::text AS id, s.user_session_id::text AS user_session_id, s.created_at, s.last_seen_at,
            s.idle_expires_at, s.expires_at, s.reauth_at,
            (s.idle_expires_at > now() AND s.expires_at > now()) AS live,
            (s.reauth_at IS NOT NULL AND s.reauth_at > now() - make_interval(mins => $3)) AS reauth_fresh,
            (s.last_seen_at <= now() - make_interval(secs => $4)) AS needs_slide
       FROM admin_sessions s
      WHERE s.token_hash = $1 AND s.admin_id = $2 AND s.revoked_at IS NULL`,
    [hashToken(token), account.id, ADMIN_REAUTH_MIN, ADMIN_SLIDE_EVERY_SEC],
  );
  if (!row || String(row.user_session_id) !== userSessionId || account.status !== "active" || !account.totpEnabled) {
    return { ok: false, reason: "no_session", user, userSessionId, account };
  }
  if (!row.live) return { ok: false, reason: "expired", user, userSessionId, account };
  return { ok: true, ctx: { user, userSessionId, account, session: rowToSession(row) } };
}

/** For server components (layouts/pages): same checks, cookies from `next/headers`. */
export async function currentAdminContextFromCookies(): Promise<ResolveResult> {
  return resolveAdminContext();
}

/**
 * Slides the idle expiry (never past the absolute expiry). Called by the
 * guard only when the last write is older than 60 s, so a busy admin costs at
 * most one UPDATE per minute.
 */
export async function slideAdminSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE admin_sessions
        SET last_seen_at = now(),
            idle_expires_at = LEAST(now() + make_interval(mins => $2), expires_at)
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, ADMIN_IDLE_MIN],
  );
}

/** Revokes one session (of `adminId` when given). Returns whether a live row was revoked. */
export async function revokeAdminSession(
  client: Queryable,
  sessionId: string,
  reason: string,
  adminId?: string,
): Promise<boolean> {
  const res = await client.query(
    `UPDATE admin_sessions SET revoked_at = now(), revoke_reason = $2
      WHERE id = $1 AND revoked_at IS NULL AND ($3::bigint IS NULL OR admin_id = $3::bigint)`,
    [sessionId, reason.slice(0, 200), adminId ?? null],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function revokeAdminSessionByToken(client: Queryable, token: string, adminId: string, reason: string): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `UPDATE admin_sessions SET revoked_at = now(), revoke_reason = $3
      WHERE token_hash = $1 AND admin_id = $2 AND revoked_at IS NULL
      RETURNING id::text AS id`,
    [hashToken(token), adminId, reason.slice(0, 200)],
  );
  return res.rows[0]?.id ?? null;
}

export async function revokeAllAdminSessions(client: Queryable, adminId: string, reason: string): Promise<number> {
  const res = await client.query(
    `UPDATE admin_sessions SET revoked_at = now(), revoke_reason = $2
      WHERE admin_id = $1 AND revoked_at IS NULL`,
    [adminId, reason.slice(0, 200)],
  );
  return res.rowCount ?? 0;
}

/** Records a fresh step-up; returns until when it is valid. */
export async function markReauth(client: Queryable, sessionId: string): Promise<Date> {
  const res = await client.query<{ until: Date }>(
    `UPDATE admin_sessions SET reauth_at = now()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING reauth_at + make_interval(mins => $2) AS until`,
    [sessionId, ADMIN_REAUTH_MIN],
  );
  const until = res.rows[0]?.until;
  if (!until) throw new Error("admin session vanished during reauth");
  return new Date(until);
}

/** Until when the step-up of a session is valid (`null` = needs one). */
export function reauthUntil(s: Pick<AdminSessionInfo, "reauthAt" | "reauthFresh">): string | null {
  if (!s.reauthAt || !s.reauthFresh) return null;
  return new Date(new Date(s.reauthAt).getTime() + ADMIN_REAUTH_MIN * 60_000).toISOString();
}
