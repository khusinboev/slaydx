/**
 * Bottom tab bar model (docs/redesign/PLAN.md, D1 + lead decisions «Routes»,
 * «Back», «Motion»). Pure and DOM-free: the TabBar, the AppShell page-enter
 * animation and the tests all read these functions.
 *
 *   Bosh `/uz` · Ishlarim `/uz/files` · [+] · Hamyon `/uz/wallet` · Profil `/uz/profile`
 */

export type TabId = "bosh" | "ishlarim" | "hamyon" | "profil";

export type TabDef = { id: TabId; href: string; label: string };

/** Left to right as drawn; the «+» sits between Ishlarim and Hamyon and is not a tab. */
export const TABS: readonly TabDef[] = [
  { id: "bosh", href: "/uz", label: "Bosh" },
  { id: "ishlarim", href: "/uz/files", label: "Ishlarim" },
  { id: "hamyon", href: "/uz/wallet", label: "Hamyon" },
  { id: "profil", href: "/uz/profile", label: "Profil" },
];

export const HOME_PATH = "/uz";

/** `/uz/profile/<step>` pages (real routes, pushed, so back returns to the profile index). */
export const PROFILE_STEPS = ["shaxsiy", "oqish", "ish", "korinish", "xavfsizlik"] as const;
export type ProfileStep = (typeof PROFILE_STEPS)[number];

export function isProfileStep(step: string): step is ProfileStep {
  return (PROFILE_STEPS as readonly string[]).includes(step);
}

function normalize(pathname: string): string {
  const p = pathname.split(/[?#]/, 1)[0] || "/";
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p;
}

/** The tab a route belongs to (nested routes included), or `null` (`/uz/create`, tool forms, login …). */
export function tabOf(pathname: string): TabId | null {
  const p = normalize(pathname);
  if (p === "/uz") return "bosh";
  if (p === "/uz/files" || p.startsWith("/uz/files/")) return "ishlarim";
  // `/uz/purchase` is the legacy alias of the wallet (server redirect).
  if (p === "/uz/wallet" || p === "/uz/purchase") return "hamyon";
  if (p === "/uz/profile" || p.startsWith("/uz/profile/")) return "profil";
  return null;
}

/** Exactly one of the four tab roots. */
export function isTabRoot(pathname: string): boolean {
  const p = normalize(pathname);
  return TABS.some((t) => t.href === p);
}

export function tabIndex(id: TabId): number {
  return TABS.findIndex((t) => t.id === id);
}

/**
 * Routes that show the bar. An allow-list on purpose: a new page does not get
 * a bar over its own bottom controls by accident. Hidden on tool forms
 * (`/uz/[slug]`, the submit bar owns the bottom), the result/viewer
 * (`/uz/files/[id]`), `/uz/login` and anything unknown.
 */
export function tabBarRoute(pathname: string): boolean {
  const p = normalize(pathname);
  if (p === "/uz" || p === "/uz/files" || p === "/uz/wallet" || p === "/uz/purchase" || p === "/uz/create") return true;
  if (p === "/uz/profile") return true;
  const step = /^\/uz\/profile\/([^/]+)$/.exec(p);
  return step != null && isProfileStep(step[1]!);
}

/**
 * Page-enter direction. Only a switch between two tab ROOTS slides: towards a
 * tab further right the new content travels left (`"left"`, it enters from the
 * right edge), towards a tab further left it travels right. Everything else
 * (first paint, steps, tool pages, same page) fades only (`"none"`).
 */
export function pageEnterDir(from: string | null, to: string): "left" | "right" | "none" {
  if (from == null || !isTabRoot(from) || !isTabRoot(to)) return "none";
  const a = tabOf(from);
  const b = tabOf(to);
  if (!a || !b || a === b) return "none";
  return tabIndex(b) > tabIndex(a) ? "left" : "right";
}

/**
 * `/uz/purchase?…` → `/uz/wallet?…` with the query kept as it is (the payment
 * provider returns to `/uz/purchase?order=<id>`; repeated keys survive).
 */
export function walletRedirectTarget(search: Record<string, string | string[] | undefined> | null | undefined): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) q.append(key, v);
  }
  const qs = q.toString();
  return qs ? `/uz/wallet?${qs}` : "/uz/wallet";
}

export type TabAction =
  /** Tapped the tab whose root is already shown: scroll `#main` to the top. */
  | { kind: "scroll-top" }
  /** The entry right under this page IS the target: a real back (no duplicate entry). */
  | { kind: "back"; href: string }
  /** Swap the current entry (history stays [Bosh, current tab]). */
  | { kind: "replace"; href: string }
  /** From Bosh into a tab: a new entry on top of Bosh. */
  | { kind: "push"; href: string };

/**
 * What a tab tap does to the history (PLAN «Back»):
 *   - the target root is the current page → scroll to top;
 *   - the previous in-app entry is the target (Bosh after Bosh → tab, the
 *     profile index under a profile step) → back;
 *   - target Bosh otherwise → replace (deep link: Bosh becomes the only entry);
 *   - from Bosh into another tab → push, so back from the tab returns home;
 *   - between non-home tabs (and from `/uz/create`) → replace.
 *
 * `previous` is the path of the in-app entry under the current page (`null`
 * when there is none: fresh tab, deep link, external referrer).
 */
export function tabNavAction(input: { from: string; to: string; previous: string | null }): TabAction {
  const here = normalize(input.from);
  const target = normalize(input.to);
  if (here === target) return { kind: "scroll-top" };
  if (input.previous != null && normalize(input.previous) === target) return { kind: "back", href: target };
  if (target === HOME_PATH) return { kind: "replace", href: target };
  if (here === HOME_PATH) return { kind: "push", href: target };
  return { kind: "replace", href: target };
}
