import type { AdminAccountItem } from "@/lib/admin-api/admins";
import type { AdminRole, AdminStatus } from "@/lib/admin-api/auth";
import type { Tone } from "@/components/admin/ui";

/**
 * Client mirror of the server's role ranks (`lib/server/admin-rbac.ts`, plan §4.1).
 * Admin client code cannot import server modules, so the table is copied here and
 * `tests/admin-audit-query.test.mts` pins it to `ROLE_RANK`. The UI uses it only to
 * decide what to OFFER; the server re-checks every action (403 `rank`).
 */
export const ROLE_RANK: Readonly<Record<AdminRole, number>> = {
  owner: 100,
  admin: 80,
  finance: 60,
  support: 50,
  moderator: 40,
  viewer: 10,
};

/** Highest rank first, the order roles are offered in. */
export const ROLE_ORDER: ReadonlyArray<AdminRole> = ["owner", "admin", "finance", "support", "moderator", "viewer"];

export function isAdminRole(v: string): v is AdminRole {
  return (ROLE_ORDER as ReadonlyArray<string>).includes(v);
}

/** `canManageRole` of the server: strictly lower rank, an owner may also manage owners. */
export function canManageRole(actorRole: string, targetRole: string): boolean {
  if (!isAdminRole(actorRole) || !isAdminRole(targetRole)) return false;
  if (actorRole === "owner") return true;
  return ROLE_RANK[targetRole] < ROLE_RANK[actorRole];
}

/** Roles the actor may create or assign. */
export function assignableRoles(actorRole: string): AdminRole[] {
  return ROLE_ORDER.filter((r) => canManageRole(actorRole, r));
}

export const STATUS_META: Record<AdminStatus, { label: string; tone: Tone }> = {
  active: { label: "Faol", tone: "success" },
  pending: { label: "Kutilmoqda", tone: "warning" },
  disabled: { label: "O'chirilgan", tone: "danger" },
};

/** Server messages (admin-accounts.ts), shown as the reason behind a disabled control. */
export const WHY = {
  self: "O'zingizning hisobingizni bu yerda o'zgartirib bo'lmaydi. Ikki bosqichli himoya sahifasi: «Mening hisobim».",
  rank: "Bu darajadagi hisobni boshqarishga ruxsatingiz yo'q.",
  lastOwner: "Oxirgi faol egani o'zgartirib bo'lmaydi.",
  noRoles: "Berish mumkin bo'lgan boshqa rol yo'q.",
} as const;

export type RowRules = {
  isSelf: boolean;
  /** Why each action is unavailable (`null` = available). */
  role: string | null;
  status: string | null;
  reset2fa: string | null;
  revoke: string | null;
};

/**
 * What the signed-in admin may do with one row, mirroring the invariants of
 * plan §4.3: not yourself, a strictly lower rank (an owner may manage owners),
 * and the last active owner can be neither demoted nor disabled.
 */
export function rowRules(actorRole: string, ownId: string | null, row: AdminAccountItem, items: ReadonlyArray<AdminAccountItem>): RowRules {
  const isSelf = ownId !== null && row.id === ownId;
  const rank = canManageRole(actorRole, row.role) ? null : WHY.rank;
  const activeOwners = items.filter((i) => i.role === "owner" && i.status === "active").length;
  const lastOwner = row.role === "owner" && row.status === "active" && activeOwners <= 1;
  const others = assignableRoles(actorRole).filter((r) => r !== row.role);
  return {
    isSelf,
    role: isSelf ? WHY.self : rank ?? (lastOwner ? WHY.lastOwner : others.length === 0 ? WHY.noRoles : null),
    status: isSelf ? WHY.self : rank ?? (lastOwner ? WHY.lastOwner : null),
    reset2fa: isSelf ? WHY.self : rank,
    // The server allows revoking one's own sessions, but that would end this very session mid-task.
    revoke: isSelf ? WHY.self : rank,
  };
}

/** Telegram and user ids are plain positive integers (BIGINT). */
export const ID_INPUT_RE = /^[1-9]\d{0,18}$/;
