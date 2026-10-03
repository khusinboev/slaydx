/**
 * Parent-route map for in-app back navigation (docs/nav/R4-back-nav.md §6).
 *
 * Pure and DOM-free. `backTo()` uses it when there is no in-app history entry
 * to go back to (fresh tab, deep link, external referrer): the page is then
 * REPLACED by its parent, so back never leaves the site and never ping-pongs.
 *
 * Every `app/**\/page.tsx` must match exactly one rule here;
 * `tests/ui/nav-parents.test.mts` enumerates the pages and fails on any
 * unmapped route, so a new page cannot silently fall through.
 */
import { safeReturnTo } from "../safe-return";

export type RouteRule = {
  /** Route pattern as written in `app/` (route groups dropped), for docs and tests. */
  route: string;
  match: RegExp;
  /** `null` = root: no in-app back (Telegram closes the app, the BackButton is hidden). */
  parent: string | null | ((search: URLSearchParams) => string);
};

/** Admin sections whose detail pages go back to their (filtered) list. */
export const ADMIN_LISTS = ["users", "generations", "payments", "broadcasts"] as const;

const ADMIN_SECTIONS = [
  "users",
  "generations",
  "payments",
  "broadcasts",
  "moderation",
  "audit",
  "errors",
  "finance",
  "pricing",
  "ai",
  "system",
  "settings",
  "admins",
  "account",
] as const;

/** `/uz/<x>` segments that are their own pages, not tool slugs. */
const UZ_RESERVED = ["create", "purchase", "profile", "login", "files", "admin"] as const;

const SEG = "[^/]+";

/** Order matters: the first matching rule wins. */
export const ROUTE_RULES: readonly RouteRule[] = [
  { route: "/", match: /^\/$/, parent: null },
  { route: "/uz", match: /^\/uz$/, parent: null },
  { route: "/o/[token]", match: new RegExp(`^/o/${SEG}$`), parent: null },
  { route: "/admin", match: /^\/admin$/, parent: null },
  { route: "/admin/login", match: /^\/admin\/login$/, parent: null },
  { route: "/admin/enroll", match: /^\/admin\/enroll$/, parent: null },
  { route: "/uz/create", match: /^\/uz\/create$/, parent: "/uz" },
  { route: "/uz/purchase", match: /^\/uz\/purchase$/, parent: "/uz" },
  { route: "/uz/profile", match: /^\/uz\/profile$/, parent: "/uz" },
  { route: "/uz/admin", match: /^\/uz\/admin$/, parent: "/uz" },
  { route: "/uz/files/[id]", match: new RegExp(`^/uz/files/${SEG}$`), parent: "/uz" },
  {
    route: "/uz/login",
    match: /^\/uz\/login$/,
    parent: (search) => safeReturnTo(search.get("returnTo")) ?? "/uz",
  },
  {
    route: "/uz/[slug]",
    match: new RegExp(`^/uz/(?!(?:${UZ_RESERVED.join("|")})$)${SEG}$`),
    parent: "/uz/create",
  },
  {
    route: "/admin/<section>",
    match: new RegExp(`^/admin/(?:${ADMIN_SECTIONS.join("|")})$`),
    parent: "/admin",
  },
  ...ADMIN_LISTS.map(
    (list): RouteRule => ({
      route: `/admin/${list}/[id]`,
      match: new RegExp(`^/admin/${list}/${SEG}$`),
      parent: `/admin/${list}`,
    }),
  ),
];

function normalize(pathname: string): string {
  const p = pathname.split(/[?#]/, 1)[0] || "/";
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p;
}

/** The rule for `pathname`, or `null` for a route this map does not know. */
export function matchRoute(pathname: string): RouteRule | null {
  const p = normalize(pathname);
  return ROUTE_RULES.find((r) => r.match.test(p)) ?? null;
}

/** `true` for routes with no in-app parent (`/uz`, `/o/*`, `/admin`, admin login/enroll). */
export function isRootPath(pathname: string): boolean {
  const rule = matchRoute(pathname);
  return rule != null && rule.parent === null;
}

/**
 * Where «←» goes when there is no in-app entry to go back to.
 *
 * `null` for a root. An unknown route falls back to its site root (`/admin`
 * inside the panel, `/uz` elsewhere) so back still never leaves the site.
 */
export function parentOf(pathname: string, search?: string | URLSearchParams | null): string | null {
  const rule = matchRoute(pathname);
  if (!rule) return normalize(pathname).startsWith("/admin/") ? "/admin" : "/uz";
  if (rule.parent === null || typeof rule.parent === "string") return rule.parent;
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? "");
  return rule.parent(params);
}

/** For an admin detail page (`/admin/users/42`) its list path (`/admin/users`), else `null`. */
export function adminListOf(pathname: string): string | null {
  const m = /^\/admin\/([^/]+)\/[^/]+$/.exec(normalize(pathname));
  if (!m) return null;
  return (ADMIN_LISTS as readonly string[]).includes(m[1]!) ? `/admin/${m[1]}` : null;
}

/** `true` when `pathname` is one of the admin list pages whose URL (filters) is remembered. */
export function isAdminListPath(pathname: string): boolean {
  const p = normalize(pathname);
  return ADMIN_LISTS.some((l) => p === `/admin/${l}`);
}
