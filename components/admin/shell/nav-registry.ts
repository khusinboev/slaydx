import type { Permission } from "@/lib/server/admin-rbac";

/**
 * Static registry of every admin module route and the permission it needs
 * (docs/admin/02-plan.md §7.0, §7.1). Pure data, safe to import from server
 * pages, client components and node tests alike.
 *
 * Hiding a nav item is cosmetic only: each route is enforced on the server by
 * `adminHandler`. `tests/admin-nav-registry.test.mts` pins every permission to
 * the server RBAC matrix and keeps hrefs unique.
 */

export type AdminNavGroupId = "main" | "data" | "manage" | "system" | "self";

export type AdminNavIcon =
  | "dashboard"
  | "users"
  | "generations"
  | "payments"
  | "finance"
  | "ai"
  | "pricing"
  | "moderation"
  | "broadcasts"
  | "settings"
  | "system"
  | "errors"
  | "audit"
  | "admins"
  | "account";

export type AdminNavItem = {
  href: string;
  /** Uzbek label shown in the nav. */
  label: string;
  icon: AdminNavIcon;
  permission: Permission;
  group: AdminNavGroupId;
};

/** Group headings in display order; an empty label renders a plain separator. */
export const ADMIN_NAV_GROUPS: ReadonlyArray<{ id: AdminNavGroupId; label: string }> = [
  { id: "main", label: "Asosiy" },
  { id: "data", label: "Ma'lumotlar" },
  { id: "manage", label: "Boshqaruv" },
  { id: "system", label: "Tizim" },
  { id: "self", label: "" },
];

export const ADMIN_NAV: ReadonlyArray<AdminNavItem> = [
  { href: "/admin", label: "Bosh sahifa", icon: "dashboard", permission: "dashboard.view", group: "main" },
  { href: "/admin/users", label: "Foydalanuvchilar", icon: "users", permission: "users.view", group: "data" },
  { href: "/admin/generations", label: "Generatsiyalar", icon: "generations", permission: "jobs.view", group: "data" },
  { href: "/admin/payments", label: "To'lovlar", icon: "payments", permission: "payments.view", group: "data" },
  { href: "/admin/finance", label: "Moliya", icon: "finance", permission: "finance.view", group: "data" },
  { href: "/admin/ai", label: "AI xarajat", icon: "ai", permission: "ai.view", group: "data" },
  { href: "/admin/pricing", label: "Narxlar", icon: "pricing", permission: "pricing.view", group: "data" },
  { href: "/admin/moderation", label: "Moderatsiya", icon: "moderation", permission: "moderation.view", group: "manage" },
  { href: "/admin/broadcasts", label: "E'lonlar", icon: "broadcasts", permission: "broadcasts.view", group: "manage" },
  { href: "/admin/settings", label: "Sozlamalar", icon: "settings", permission: "settings.view", group: "manage" },
  { href: "/admin/system", label: "Tizim holati", icon: "system", permission: "system.view", group: "system" },
  { href: "/admin/errors", label: "Xatolar", icon: "errors", permission: "errors.view", group: "system" },
  { href: "/admin/audit", label: "Audit jurnali", icon: "audit", permission: "audit.view", group: "system" },
  { href: "/admin/admins", label: "Adminlar", icon: "admins", permission: "admins.view", group: "system" },
  { href: "/admin/account", label: "Mening hisobim", icon: "account", permission: "self", group: "self" },
];

/** Uzbek role names (plan §4.1). Unknown roles fall back to the raw key. */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: "Egasi",
  admin: "Admin",
  finance: "Moliya",
  support: "Qo'llab-quvvatlash",
  moderator: "Moderator",
  viewer: "Kuzatuvchi",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Nav items the admin may see, in registry order. */
export function visibleNav(permissions: ReadonlyArray<string>): AdminNavItem[] {
  const held = new Set(permissions);
  return ADMIN_NAV.filter((item) => held.has(item.permission));
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The registry item a path belongs to: the longest matching href, so
 * `/admin/users/42` maps to `/admin/users` and only `/admin` itself (or an
 * unknown sub-path) maps to the dashboard.
 */
export function navItemFor(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null;
  for (const item of ADMIN_NAV) {
    if (matches(pathname, item.href) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

/* ───────────────────────────── `next` redirect target ───────────────────────────── */

/** Where an admin lands when no (valid) `next` is given. */
export const DEFAULT_ADMIN_PATH = "/admin";

// A fixed fake origin: the parsed result must stay on it, so absolute URLs,
// protocol-relative `//host` and backslash tricks are all rejected.
const PROBE_ORIGIN = "http://admin.invalid";

/**
 * Sanitises the `?next=` target of the login page (open-redirect guard).
 * Accepts only same-origin paths inside the admin area (`/admin` or
 * `/admin/...`, after URL normalisation, so `/admin/../uz` and encoded dots are
 * rejected) and never the auth pages themselves (no loops). Anything else
 * yields `DEFAULT_ADMIN_PATH`.
 */
export function sanitizeAdminNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return DEFAULT_ADMIN_PATH;
  // Must be a path; `\` is treated as `/` by browsers, control chars can split URLs.
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_ADMIN_PATH;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return DEFAULT_ADMIN_PATH;
  }
  if (url.origin !== PROBE_ORIGIN) return DEFAULT_ADMIN_PATH;
  const path = url.pathname;
  if (!matches(path, "/admin")) return DEFAULT_ADMIN_PATH;
  if (matches(path, "/admin/login") || matches(path, "/admin/enroll")) return DEFAULT_ADMIN_PATH;
  return `${path}${url.search}${url.hash}`;
}

/** `/admin/login?next=...` for the given current path. */
export function adminLoginHref(currentPath: string): string {
  const next = sanitizeAdminNext(currentPath);
  return next === DEFAULT_ADMIN_PATH ? "/admin/login" : `/admin/login?next=${encodeURIComponent(next)}`;
}
