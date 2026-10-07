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

/**
 * Index of the entry under the current one (the last item of `stack`) whose
 * pathname is `path`, or -1. The nearest such entry wins, then the LOWEST
 * entry of its contiguous run (same-URL entries right above it: overlay
 * entries a page left behind, a page pushed twice), so landing there leaves
 * nothing of that page stacked above it.
 *
 * `stack`: page paths of this tab's in-app run, index 0 … the current page
 * (`lib/nav/history.ts pageStack`), `null` where unknown.
 */
export function nearestEntry(stack: readonly (string | null)[], path: string): number {
  const target = normalize(path);
  const is = (i: number) => stack[i] != null && normalize(stack[i]!) === target;
  let j = stack.length - 2;
  while (j >= 0 && !is(j)) j -= 1;
  if (j < 0) return -1;
  while (j > 0 && is(j - 1)) j -= 1;
  return j;
}

/** `p` is a page nested under `path` (`/uz/profile/ish` under `/uz/profile`). */
function isUnder(p: string | null | undefined, path: string): boolean {
  return p != null && normalize(p).startsWith(`${normalize(path)}/`);
}

export type EntryPlan =
  /** Traverse to entry `index`: it is the target page (Next renders it). */
  | { kind: "back"; index: number }
  /** Traverse to entry `index` unseen and REPLACE it with the target. */
  | { kind: "back-replace"; index: number }
  /** Replace the current entry with the target. */
  | { kind: "replace" };

/**
 * How to return to `path` so that nothing pushed above it stays in the
 * history (profile «Saqlash va yakunlash» / «←» → the profile index):
 *   - `path` is an earlier entry → back to it (`nearestEntry`);
 *   - else the run of pages nested under `path` that ends at the current page
 *     (a deep-linked step and the steps pushed after it) → back to the run's
 *     first entry and replace it with `path`;
 *   - else replace the current entry.
 */
export function returnPlan(stack: readonly (string | null)[], path: string): EntryPlan {
  const j = nearestEntry(stack, path);
  if (j >= 0) return { kind: "back", index: j };
  let k = stack.length - 1;
  while (k > 0 && isUnder(stack[k - 1], path)) k -= 1;
  if (k >= 0 && k < stack.length - 1) return { kind: "back-replace", index: k };
  return { kind: "replace" };
}

export type TabAction =
  /** Tapped the tab whose root is already shown: scroll `#main` to the top. */
  | { kind: "scroll-top" }
  /** Traverse back to entry `index`, which IS the target (Bosh; the tab root under its steps). */
  | { kind: "back"; href: string; index: number }
  /** Traverse back to entry `index` unseen and replace it with the target (history ends [Bosh, tab]). */
  | { kind: "back-replace"; href: string; index: number }
  /** Swap the current entry (it already is the one right above Bosh, or the only one). */
  | { kind: "replace"; href: string }
  /** From Bosh into a tab: a new entry on top of Bosh. */
  | { kind: "push"; href: string };

/**
 * What a tab tap does to the history (PLAN «Back»: history = [Bosh, current
 * tab]; back from any tab → Bosh; back on Bosh leaves). Whatever is stacked
 * above Bosh (profile steps, another tab, `/uz/create`) is collapsed:
 *   - the target root is the current page → scroll to top;
 *   - target Bosh: back to the nearest Bosh entry; with no Bosh in the run
 *     (deep link) back to the first entry and replace it with Bosh (or just
 *     replace the current one when it is the first), Bosh is then the only entry;
 *   - from Bosh into another tab → push;
 *   - Bosh in the run: the entry right above Bosh becomes the tab — replace when
 *     that is the current page, back when it already is the tab root (the
 *     profile index under its steps), else back + replace;
 *   - no Bosh in the run (deep link): the same with the first entry; the tab
 *     then has no in-app predecessor and its back (`backTo`) REPLACES it with
 *     its parent Bosh (`parents.ts`).
 *
 * `stack` = page paths of the in-app run, index 0 … the current page
 * (`pageStack()`); an empty stack counts as `[from]`.
 */
export function tabNavAction(input: { from: string; to: string; stack: readonly (string | null)[] }): TabAction {
  const here = normalize(input.from);
  const target = normalize(input.to);
  if (here === target) return { kind: "scroll-top" };
  const stack = input.stack.length ? input.stack : [here];
  const cur = stack.length - 1;
  const home = nearestEntry(stack, HOME_PATH);
  if (target === HOME_PATH) {
    if (home >= 0) return { kind: "back", href: target, index: home };
    return cur > 0 ? { kind: "back-replace", href: target, index: 0 } : { kind: "replace", href: target };
  }
  if (here === HOME_PATH) return { kind: "push", href: target };
  const slot = home + 1; // 0 when there is no Bosh in the run
  if (slot >= cur) return { kind: "replace", href: target };
  const at = stack[slot];
  if (at != null && normalize(at) === target) return { kind: "back", href: target, index: slot };
  return { kind: "back-replace", href: target, index: slot };
}
