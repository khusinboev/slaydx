import "server-only";

/**
 * Admin roles and permissions (docs/admin/02-plan.md §4).
 *
 * The role → permission map is a reviewed code constant, not data: nothing
 * in the DB can widen a role. `tests/admin-rbac.test.mts` pins the whole
 * matrix to the §4.3 table, so any change here is a deliberate, reviewed diff.
 */

export const ROLES = ["owner", "admin", "finance", "support", "moderator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Readonly<Record<Role, number>> = {
  owner: 100,
  admin: 80,
  finance: 60,
  support: 50,
  moderator: 40,
  viewer: 10,
};

export const PERMISSIONS = [
  "dashboard.view",
  "users.view",
  "users.pii",
  "users.export",
  "users.block",
  "users.sessions",
  "users.wallet",
  "users.message",
  "jobs.view",
  "jobs.input",
  "jobs.export",
  "jobs.cancel",
  "jobs.refund",
  "payments.view",
  "payments.export",
  "payments.refund_record",
  "finance.view",
  "finance.export",
  "ai.view",
  "moderation.view",
  "moderation.act",
  "broadcasts.view",
  "broadcasts.send",
  "settings.view",
  "settings.edit",
  "system.view",
  "errors.view",
  "errors.resolve",
  "audit.view",
  "audit.export",
  "pricing.view",
  "pricing.edit",
  "admins.view",
  "admins.manage",
  // §4.2: implicit for every admin — own sessions, own recovery codes, step-up.
  "self",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Role[] = ROLES;
const O: readonly Role[] = ["owner"];
const OA: readonly Role[] = ["owner", "admin"];

/** §4.3, row by row: which roles hold each permission. */
const GRANTS: Readonly<Record<Permission, readonly Role[]>> = {
  "dashboard.view": ALL,
  "users.view": ALL,
  "users.pii": ["owner", "admin", "support"],
  "users.export": ["owner", "admin", "finance"],
  "users.block": ["owner", "admin", "support", "moderator"],
  "users.sessions": ["owner", "admin", "support"],
  "users.wallet": ["owner", "admin", "finance"],
  "users.message": ["owner", "admin", "support"],
  "jobs.view": ALL,
  "jobs.input": ["owner", "admin", "support"],
  "jobs.export": ["owner", "admin", "finance"],
  "jobs.cancel": ["owner", "admin", "support"],
  "jobs.refund": ["owner", "admin", "finance", "support"],
  "payments.view": ["owner", "admin", "finance", "support", "viewer"],
  "payments.export": ["owner", "admin", "finance"],
  "payments.refund_record": ["owner", "admin", "finance"],
  "finance.view": ["owner", "admin", "finance", "viewer"],
  "finance.export": ["owner", "admin", "finance"],
  "ai.view": ["owner", "admin", "finance", "viewer"],
  "moderation.view": ["owner", "admin", "support", "moderator"],
  "moderation.act": ["owner", "admin", "moderator"],
  "broadcasts.view": ["owner", "admin", "support"],
  "broadcasts.send": OA,
  "settings.view": ["owner", "admin", "finance", "viewer"],
  "settings.edit": OA,
  "system.view": ["owner", "admin", "finance", "support", "viewer"],
  "errors.view": ["owner", "admin", "support", "viewer"],
  "errors.resolve": OA,
  "audit.view": OA,
  "audit.export": O,
  "pricing.view": ["owner", "admin", "finance", "viewer"],
  "pricing.edit": OA,
  "admins.view": OA,
  "admins.manage": OA,
  self: ALL,
};

/** The "S" column of §4.3: a fresh TOTP (reauth within 10 minutes) is required. */
export const STEP_UP: ReadonlySet<Permission> = new Set<Permission>([
  "users.export",
  "users.wallet",
  "jobs.export",
  "payments.export",
  "payments.refund_record",
  "finance.export",
  "broadcasts.send",
  "settings.edit",
  "audit.export",
  "pricing.edit",
  "admins.manage",
]);

function buildRolePermissions(): Record<Role, readonly Permission[]> {
  const out = {} as Record<Role, readonly Permission[]>;
  for (const r of ROLES) out[r] = Object.freeze(PERMISSIONS.filter((p) => GRANTS[p].includes(r)));
  return out;
}

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze(buildRolePermissions());

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (PERMISSIONS as readonly string[]).includes(v);
}

/** Unknown roles (a tampered row) get nothing. */
export function can(role: string, perm: Permission): boolean {
  return isRole(role) && GRANTS[perm].includes(role);
}

export function permissionsOf(role: string): Permission[] {
  return isRole(role) ? [...ROLE_PERMISSIONS[role]] : [];
}

export function needsStepUp(perm: Permission): boolean {
  return STEP_UP.has(perm);
}

/**
 * May `actor` create or manage an account with role `target`? Requires
 * `admins.manage` and a strictly lower target rank; an owner may also manage
 * owners (§4.3 invariants). Self-management is refused separately by callers.
 */
export function canManageRole(actorRole: string, targetRole: string): boolean {
  if (!isRole(actorRole) || !isRole(targetRole)) return false;
  if (!can(actorRole, "admins.manage")) return false;
  if (actorRole === "owner") return true;
  return ROLE_RANK[targetRole] < ROLE_RANK[actorRole];
}
