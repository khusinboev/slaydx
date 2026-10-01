"use client";

import { adminGet, adminSend } from "./core";

/**
 * Admin accounts API (docs/admin/02-plan.md §6.13) and own-account helpers
 * (§6.2). Thin typed wrappers over `core.ts`, which adds the AbortSignal,
 * the 401 admin_auth / reauth handling and the error mapping.
 *
 * Types are declared here, not imported from `lib/server/**`: admin client
 * code must not reach server modules (tests/admin-boundary.test.mts).
 */

export type AdminRole = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
export type AdminStatus = "pending" | "active" | "disabled";

export type AdminAccountItem = {
  id: string;
  userId: string;
  name: string;
  username: string | null;
  role: AdminRole;
  status: AdminStatus;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  activeSessions: number;
};

export type EnrollmentLink = { enrollUrl: string; expiresAt: string };

export type OwnAdminSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
};

type Opts = { signal?: AbortSignal };

export function listAdmins(opts: Opts = {}): Promise<{ items: AdminAccountItem[] }> {
  return adminGet<{ items: AdminAccountItem[] }>("/api/admin/admins", {}, { signal: opts.signal });
}

export type CreateAdminBody = (
  | { userId: string; telegramId?: never }
  | { telegramId: string; userId?: never }
) & { role: AdminRole; reason: string; sendViaTelegram?: boolean };

/** 201 → the enrollment link is shown once. Errors: 404 user, 409 already_admin, 403 rank. */
export function createAdmin(body: CreateAdminBody, opts: Opts = {}): Promise<{ admin: AdminAccountItem } & EnrollmentLink> {
  return adminSend<{ admin: AdminAccountItem } & EnrollmentLink>("POST", "/api/admin/admins", body, { signal: opts.signal });
}

/** Errors: 409 self / last_owner, 403 rank. Disabling also revokes the admin's sessions. */
export function updateAdmin(
  id: string,
  body: { role?: AdminRole; status?: "active" | "disabled"; reason: string },
  opts: Opts = {},
): Promise<{ admin: AdminAccountItem }> {
  return adminSend<{ admin: AdminAccountItem }>("PATCH", `/api/admin/admins/${encodeURIComponent(id)}`, body, {
    signal: opts.signal,
  });
}

export function resetAdmin2fa(id: string, reason: string, opts: Opts = {}): Promise<EnrollmentLink> {
  return adminSend<EnrollmentLink>("POST", `/api/admin/admins/${encodeURIComponent(id)}/reset-2fa`, { reason }, {
    signal: opts.signal,
  });
}

export function revokeAdminSessions(id: string, reason: string, opts: Opts = {}): Promise<{ revoked: number }> {
  return adminSend<{ revoked: number }>("POST", `/api/admin/admins/${encodeURIComponent(id)}/sessions/revoke`, { reason }, {
    signal: opts.signal,
  });
}

// ───────────────────────────── own account (§6.2)

export function listOwnSessions(opts: Opts = {}): Promise<{ items: OwnAdminSession[] }> {
  return adminGet<{ items: OwnAdminSession[] }>("/api/admin/me/sessions", {}, { signal: opts.signal });
}

export function revokeOwnSession(id: string, reason?: string, opts: Opts = {}): Promise<{ ok: true }> {
  return adminSend<{ ok: true }>("POST", `/api/admin/me/sessions/${encodeURIComponent(id)}/revoke`, reason ? { reason } : {}, {
    signal: opts.signal,
  });
}

/** Needs a fresh 6-digit TOTP; the returned codes are shown once. */
export function regenerateRecoveryCodes(code: string, opts: Opts = {}): Promise<{ recoveryCodes: string[] }> {
  return adminSend<{ recoveryCodes: string[] }>("POST", "/api/admin/me/recovery-codes", { code }, { signal: opts.signal });
}
