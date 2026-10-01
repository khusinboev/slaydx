"use client";

import { adminGet, adminSend, type AdminCallOptions } from "./core";

/**
 * Typed client for the admin auth and own-account endpoints
 * (plan §6.1 and §6.2). Paths and shapes mirror the contract exactly.
 */

export type AdminRole = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
export type AdminStatus = "pending" | "active" | "disabled";

export type AdminProfile = {
  id: string;
  userId: string;
  name: string;
  username: string | null;
  role: AdminRole;
  /** Permission keys from plan §4.2 (kept as strings: the server owns the catalogue). */
  permissions: string[];
  status: AdminStatus;
  totpEnabled: boolean;
};

export type AdminSessionInfo = {
  id: string;
  expiresAt: string;
  idleExpiresAt: string;
  /** Until when the last step-up counts; `null` / past means the next sensitive call asks for a code. */
  reauthUntil: string | null;
};

export type AdminSessionResponse = {
  admin: AdminProfile;
  /** `null` when the user is an admin but has not signed in to the admin area yet. */
  session: AdminSessionInfo | null;
};

export type AdminLoginResponse = {
  admin: AdminProfile;
  session: AdminSessionInfo;
};

export type AdminRecoveryLoginResponse = AdminLoginResponse & {
  /** Recovery codes left after this one was consumed. */
  remaining: number;
};

export type AdminEnrollInfo = {
  account: { role: AdminRole };
  /** Base32 TOTP secret for manual entry. */
  secret: string;
  otpauthUri: string;
  /** SVG markup of the QR code. Render it through an <img> data URI, never as injected HTML. */
  qrSvg: string;
};

export type AdminOwnSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
};

/** GET /api/admin/session. 404 (AdminNotFoundError) means the user is not an admin. */
export function getAdminSession(opts?: AdminCallOptions): Promise<AdminSessionResponse> {
  return adminGet<AdminSessionResponse>("/api/admin/session", undefined, opts);
}

/** POST /api/admin/auth/login with a 6-digit TOTP code. */
export function login(code: string, opts?: AdminCallOptions): Promise<AdminLoginResponse> {
  return adminSend<AdminLoginResponse>("POST", "/api/admin/auth/login", { code }, opts);
}

/** POST /api/admin/auth/recovery with a one-time recovery code (`XXXX-XXXX-XX`). */
export function loginWithRecovery(code: string, opts?: AdminCallOptions): Promise<AdminRecoveryLoginResponse> {
  return adminSend<AdminRecoveryLoginResponse>("POST", "/api/admin/auth/recovery", { code }, opts);
}

/** POST /api/admin/auth/reauth: step-up with a fresh TOTP code. */
export function reauth(code: string, opts?: AdminCallOptions): Promise<{ reauthUntil: string }> {
  return adminSend<{ reauthUntil: string }>("POST", "/api/admin/auth/reauth", { code }, opts);
}

/** DELETE /api/admin/session: ends the admin session and clears the cookie. */
export function logout(opts?: AdminCallOptions): Promise<{ ok: true }> {
  return adminSend<{ ok: true }>("DELETE", "/api/admin/session", undefined, opts);
}

/** GET /api/admin/auth/enroll?token=: secret, otpauth URI and QR for enrollment. */
export function getEnrollInfo(token: string, opts?: AdminCallOptions): Promise<AdminEnrollInfo> {
  return adminGet<AdminEnrollInfo>("/api/admin/auth/enroll", { token }, opts);
}

/** POST /api/admin/auth/enroll: verifies the first code and returns the 10 recovery codes (shown once). */
export function confirmEnroll(
  token: string,
  code: string,
  opts?: AdminCallOptions,
): Promise<{ recoveryCodes: string[] }> {
  return adminSend<{ recoveryCodes: string[] }>("POST", "/api/admin/auth/enroll", { token, code }, opts);
}

/** GET /api/admin/me/sessions: the caller's own admin sessions. */
export function listMySessions(opts?: AdminCallOptions): Promise<{ items: AdminOwnSession[] }> {
  return adminGet<{ items: AdminOwnSession[] }>("/api/admin/me/sessions", undefined, opts);
}

/** POST /api/admin/me/sessions/:id/revoke (the reason is optional here). */
export function revokeMySession(id: string, reason?: string, opts?: AdminCallOptions): Promise<{ ok: boolean }> {
  const body = reason && reason.trim() ? { reason: reason.trim() } : {};
  return adminSend<{ ok: boolean }>("POST", `/api/admin/me/sessions/${encodeURIComponent(id)}/revoke`, body, opts);
}

/** POST /api/admin/me/recovery-codes: needs a fresh TOTP code; the old codes stop working. */
export function regenerateRecoveryCodes(code: string, opts?: AdminCallOptions): Promise<{ recoveryCodes: string[] }> {
  return adminSend<{ recoveryCodes: string[] }>("POST", "/api/admin/me/recovery-codes", { code }, opts);
}
