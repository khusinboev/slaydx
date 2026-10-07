"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FolderOpen, House, Plus, UserRound, Wallet, type LucideIcon } from "lucide-react";
import { useNav } from "@/components/nav/NavProvider";
import { backToEntry, getNavSnapshot, getServerNavSnapshot, pageStack, replacePage, subscribeNav } from "@/lib/nav/history";
import { TABS, tabBarRoute, tabNavAction, tabOf, type TabId } from "@/lib/nav/tabs";
import { useVisualViewport } from "@/lib/hooks/useVisualViewport";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, atLeast } from "./safe-area";

const ICONS: Record<TabId, LucideIcon> = { bosh: House, ishlarim: FolderOpen, hamyon: Wallet, profil: UserRound };

export const CREATE_SHEET_ID = "create-sheet";

/**
 * Whether the bottom bar is on screen (docs/redesign/PLAN.md «Tab bar hidden on»):
 *   - only on the shell's own pages (`tabBarRoute`: Bosh, Ishlarim, Hamyon,
 *     Profil + steps, `/uz/create`); never on tool forms, the result page, login;
 *   - not while the on-screen keyboard is open (touch devices);
 *   - not under a modal sheet / dialog (any nav overlay layer) — except the «+»
 *     sheet itself, which the bar stays above (its «+» turns into «×»).
 * `AppShell` reads the same hook to size `--tabbar-h` and the page's bottom room.
 */
export function useTabBarState(pathname: string): { route: boolean; shown: boolean; createOpen: boolean } {
  const createOpen = useUi((s) => s.overlay === "create");
  const overlays = useSyncExternalStore(subscribeNav, () => getNavSnapshot().overlays, () => getServerNavSnapshot().overlays);
  const viewport = useVisualViewport();
  const touch = useCoarsePointer();
  const route = tabBarRoute(pathname);
  const keyboard = touch && viewport.keyboardOpen;
  const modal = overlays > (createOpen ? 1 : 0);
  return { route, shown: route && !keyboard && !modal, createOpen };
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Active tab tapped again: the page scroller goes to the top. */
function scrollMainTop() {
  const main = document.getElementById("main");
  if (!main) return;
  if (typeof main.scrollTo === "function") main.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  else main.scrollTop = 0;
}

/**
 * Bottom tab bar, variant A (docs/redesign/PLAN.md D1–D3):
 * Bosh · Ishlarim · [+] · Hamyon · Profil, a floating pill (12 px from the
 * edges on phones, centred ≤ 560 px on wide screens), above the bottom safe
 * area. Active tab: icon on an `--accent-soft` chip + strong label +
 * `aria-current="page"`. Every target is the full 64 px cell.
 *
 * History (PLAN «Back», `tabNavAction`): the stack collapses to [Bosh, tab] —
 * Bosh → tab pushes; any other tap goes back to the entry right above Bosh
 * (steps and older tabs leave the back path) and makes it the tab; → Bosh goes
 * back to the Bosh entry (replaces it in on a deep link); the active tab
 * scrolls `#main` to the top. Tabs are real links (prefetch, middle-click,
 * open in a new tab).
 */
export function TabBar({ shown, createOpen }: { shown: boolean; createOpen: boolean }) {
  const pathname = usePathname() ?? "/uz";
  const router = useRouter();
  const nav = useNav();
  const openUi = useUi((s) => s.open);
  const closeUi = useUi((s) => s.close);
  const active = tabOf(pathname);

  const onTab = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const action = tabNavAction({ from: pathname, to: href, stack: pageStack() });
    switch (action.kind) {
      case "scroll-top":
        if (createOpen) closeUi();
        scrollMainTop();
        return;
      case "back":
        // One history.go(-n) down to Bosh / the tab root: the steps above it leave the back path.
        void backToEntry(action.index, { router });
        return;
      case "back-replace":
        // Down to the entry right above Bosh (unseen by Next), which then becomes the tab.
        void backToEntry(action.index, { router, replaceWith: action.href });
        return;
      case "replace":
        void replacePage(action.href, { router });
        return;
      case "push":
        // With the «+» sheet open its entry is replaced, so the tab still lands right above Bosh.
        nav.navigateFromOverlay(action.href);
        return;
    }
  };

  const toggleCreate = () => {
    if (createOpen) closeUi();
    else openUi("create");
  };

  const tab = (i: number) => {
    const t = TABS[i]!;
    const Icon = ICONS[t.id];
    const on = active === t.id;
    return (
      <Link
        key={t.id}
        href={t.href}
        data-tab={t.id}
        aria-current={on ? "page" : undefined}
        onClick={(e) => onTab(e, t.href)}
        className="group focus-visible:ring-ring flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-[20px] outline-none select-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <span
          data-tab-chip
          className={cn(
            "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200 motion-reduce:transition-none",
            on ? "bg-accent-soft text-accent-soft-foreground" : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          <Icon className="size-[22px]" strokeWidth={on ? 2.25 : 1.9} aria-hidden />
        </span>
        <span
          className={cn(
            "max-w-full truncate px-0.5 text-[12.5px] leading-none",
            on ? "text-foreground font-semibold" : "text-muted-foreground font-medium",
          )}
        >
          {t.label}
        </span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Asosiy bo‘limlar"
      data-tabbar
      data-hidden={shown ? undefined : ""}
      aria-hidden={shown ? undefined : true}
      inert={!shown}
      className="slx-tabbar no-print pointer-events-none fixed inset-x-0 bottom-0 z-[46] flex justify-center"
      style={{
        paddingBottom: `calc(${SAFE_BOTTOM} + 0.5rem)`,
        paddingLeft: atLeast("0.75rem", SAFE_LEFT),
        paddingRight: atLeast("0.75rem", SAFE_RIGHT),
      }}
    >
      <div className="bg-surface-bar pointer-events-auto grid h-16 w-full max-w-[560px] grid-cols-5 items-stretch rounded-[var(--radius-bar)] border border-[var(--surface-bar-border)] px-1 shadow-[var(--shadow-bar)] backdrop-blur-xl backdrop-saturate-150">
        {tab(0)}
        {tab(1)}
        <div className="flex items-start justify-center">
          <button
            type="button"
            data-create-button
            aria-label={createOpen ? "Yopish" : "Yaratish"}
            title={createOpen ? "Yopish" : "Yaratish"}
            aria-haspopup="dialog"
            aria-expanded={createOpen}
            aria-controls={createOpen ? CREATE_SHEET_ID : undefined}
            onClick={toggleCreate}
            className="text-hero-foreground focus-visible:ring-foreground relative -mt-3 flex size-14 items-center justify-center rounded-[20px] bg-[image:var(--hero)] shadow-[var(--shadow-fab)] ring-4 ring-[var(--page-bg)] outline-none transition-transform duration-150 select-none focus-visible:ring-offset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:scale-95 motion-reduce:transition-none"
          >
            <Plus
              aria-hidden
              strokeWidth={2.5}
              className={cn(
                "size-7 transition-transform duration-200 motion-reduce:transition-none",
                createOpen && "rotate-45",
              )}
            />
          </button>
        </div>
        {tab(2)}
        {tab(3)}
      </div>
    </nav>
  );
}
