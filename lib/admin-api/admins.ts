"use client";

import { adminGet, adminSend, type AdminCallOptions } from "./core";
import type { AdminRole, AdminStatus } from "./auth";

/**
 * Admin accounts API (docs/admin/02-plan.md §6.13). Thin typed wrappers over
 * `core.ts`, which adds the AbortSignal, the 401 admin_auth / reauth handling
 * (every mutation here is `admins.manage`, a step-up permission) and the
 * error classes. Own-account calls (§6.2) live in `auth.ts`.
 *
 * Types are declared here, not imported from `lib/server/**`: admin client
 * code must not reach server modules (tests/admin-boundary.test.mts).
 */

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
  /** Live admin sessions (unrevoked, unexpired, user session still valid). */
  activeSessions: number;
};

/** One-time link: show it once, it is not retrievable later. */
export type EnrollmentLink = { enrollUrl: string; expiresAt: string };

export type CreateAdminBody = (
  | { userId: string; telegramId?: never }
  | { telegramId: string; userId?: never }
) & { role: AdminRole; reason: string; sendViaTelegram?: boolean };

/** GET /api/admin/admins (`admins.view`). */
export function listAdmins(opts?: AdminCallOptions): Promise<{ items: AdminAccountItem[] }> {
  return adminGet<{ items: AdminAccountItem[] }>("/api/admin/admins", undefined, opts);
}

/** POST /api/admin/admins → 201. Errors: 404 user, 409 `already_admin`, 403 `rank`. */
export function createAdmin(body: CreateAdminBody, opts?: AdminCallOptions): Promise<{ admin: AdminAccountItem } & EnrollmentLink> {
  return adminSend<{ admin: AdminAccountItem } & EnrollmentLink>("POST", "/api/admin/admins", body, opts);
}

/** PATCH /api/admin/admins/:id. Errors: 409 `self` / `last_owner`, 403 `rank`. Disabling revokes the admin's sessions. */
export function updateAdmin(
  id: string,
  body: { role?: AdminRole; status?: "active" | "disabled"; reason: string },
  opts?: AdminCallOptions,
): Promise<{ admin: AdminAccountItem }> {
  return adminSend<{ admin: AdminAccountItem }>("PATCH", `/api/admin/admins/${encodeURIComponent(id)}`, body, opts);
}

/** POST /api/admin/admins/:id/reset-2fa → a new enrollment link. Errors: 409 `self`, 403 `rank`. */
export function resetAdmin2fa(id: string, reason: string, opts?: AdminCallOptions): Promise<EnrollmentLink> {
  return adminSend<EnrollmentLink>("POST", `/api/admin/admins/${encodeURIComponent(id)}/reset-2fa`, { reason }, opts);
}

/** POST /api/admin/admins/:id/sessions/revoke. Error: 403 `rank`. */
export function revokeAdminSessions(id: string, reason: string, opts?: AdminCallOptions): Promise<{ revoked: number }> {
  return adminSend<{ revoked: number }>("POST", `/api/admin/admins/${encodeURIComponent(id)}/sessions/revoke`, { reason }, opts);
}
