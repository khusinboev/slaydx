"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LoginModal } from "../overlays/LoginModal";
import { SearchDialog } from "../overlays/SearchDialog";
import { NotificationsPanel } from "../overlays/NotificationsPanel";
import { PayDialog } from "../overlays/PayDialog";
import { ScrollToTop } from "./ScrollToTop";
import { TabBar, useTabBarState } from "./TabBar";
import { CreateSheet } from "./CreateSheet";
import { TOP_INSET } from "./safe-area";
import { pageEnterDir } from "@/lib/nav/tabs";
import { useUi } from "@/lib/ui";
import { useAppStore } from "@/lib/store";

// `useLayoutEffect` warns on the server; the page-enter restart only matters in the browser.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Bottom room under the page while the bar is shown: the bar's room + the home indicator. */
const BAR_ROOM = "h-[calc(var(--tabbar-h,0px)+var(--tg-safe-bottom,env(safe-area-inset-bottom,0px)))]";
/** … plus 4.5 rem while «Tepaga chiqish» is on screen (its 44 px + 16 px offset + a gap). */
const BAR_AND_TOP_BUTTON_ROOM =
  "h-[calc(4.5rem+var(--tabbar-h,0px)+var(--tg-safe-bottom,env(safe-area-inset-bottom,0px)))]";

/**
 * App shell of the consumer pages (docs/redesign/PLAN.md, F0): no sidebar, no
 * top bar, no drawer — a bottom tab bar (`TabBar`) and the «+» sheet
 * (`CreateSheet`).
 *
 *   - a top strip of exactly the notch / Telegram header inset (`TOP_INSET`,
 *     0 on a desktop) keeps every page, its sticky header and the tool / result
 *     headers below the device and Telegram chrome (`--shell-topbar-h`);
 *   - `<main id="main">` is the one page scroller (NavProvider restores its
 *     scroll per history entry; ScrollToTop listens on it);
 *   - the page sits in a `.slx-page-enter` wrapper whose animation restarts on
 *     every route change, direction from the tab order (`pageEnterDir`);
 *   - `--tabbar-h` is the bar's room while it is shown, 0 otherwise (set here
 *     for SSR and by a `:root:has(...)` rule for portals); the page ends in a
 *     spacer of that height so nothing hides under the bar;
 *   - Cmd/Ctrl+K opens search, Alt+T notifications.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  // The page scroller: `<main>` is the one element every page scrolls in (the shell itself never scrolls).
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  // «Tepaga chiqish» is on screen: the end of the page gets bottom room (see `<main>` below).
  const [topButton, setTopButton] = useState(false);
  const open = useUi((s) => s.open);
  const pathname = usePathname() ?? "/uz";
  const bar = useTabBarState(pathname);
  const pageRef = useRef<HTMLDivElement>(null);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // IME hodisalarida `e.key` undefined bo'lishi mumkin.
      const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
      if (!key) return;
      if ((e.metaKey || e.ctrlKey) && key === "k") {
        e.preventDefault();
        open("search");
      }
      if (e.altKey && key === "t") {
        e.preventDefault();
        open("notifications");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Page enter: restart the CSS animation on every route change (no remount of the page tree).
  useBrowserLayoutEffect(() => {
    const el = pageRef.current;
    const from = lastPath.current;
    lastPath.current = pathname;
    if (!el || from === null || from === pathname) return;
    el.dataset.dir = pageEnterDir(from, pathname);
    el.classList.remove("slx-page-enter");
    void el.offsetWidth; // reflow: the next add starts the animation from its first frame
    el.classList.add("slx-page-enter");
  }, [pathname]);

  const room = topButton ? BAR_AND_TOP_BUTTON_ROOM : bar.shown ? BAR_ROOM : null;

  return (
    <div
      data-app-shell
      data-tabbar={bar.shown ? "on" : "off"}
      className="flex h-svh w-full flex-col overflow-hidden bg-[var(--page-bg)]"
      style={{ ["--tabbar-h" as string]: bar.shown ? "var(--tabbar-room)" : "0px" }}
    >
      {/* Notch / Telegram header: 0 on a desktop and in a plain mobile browser tab. */}
      <div aria-hidden data-top-inset className="shrink-0 bg-[var(--page-bg)]" style={{ height: TOP_INSET }} />
      <SessionBanner />
      {/*
       * Scroll padding for tool forms (mobile P3): focus and caret reveals stop
       * 16 px above the sticky submit bar (73 px + safe area), or 16 px above
       * the visible bottom while the bar is in the flow (keyboard open).
       * Other pages carry no `[data-submit-bar]` and keep no padding.
       *
       * The page ends in an in-flow SPACER (never padding on `<main>`: a sticky
       * `bottom: 0` submit bar sticks above the scroll container's padding, so
       * padding would lift it off the bottom edge; a last child leaves it docked):
       *   - while the tab bar is shown: `--tabbar-h` + the bottom safe area, so the
       *     end of every list can be scrolled out from under the bar;
       *   - while «Tepaga chiqish» is on screen (`data-scroll-top-room`): 4.5 rem
       *     more (the button's 44 px plus its 16 px offset).
       */}
      <main
        id="main"
        ref={setScroller}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--page-bg)] has-[[data-submit-bar=inline]]:scroll-pb-4 has-[[data-submit-bar=sticky]]:scroll-pb-[calc(6rem+env(safe-area-inset-bottom))]"
      >
        <div ref={pageRef} data-page data-dir="initial" className="slx-page-enter flex shrink-0 grow flex-col">
          {children}
        </div>
        {room ? (
          <div
            aria-hidden
            data-bottom-room
            data-tabbar-room={bar.shown ? "" : undefined}
            data-scroll-top-room={topButton ? "" : undefined}
            className={`no-print ${room} shrink-0`}
          />
        ) : null}
      </main>

      <TabBar shown={bar.shown} createOpen={bar.createOpen} />
      <CreateSheet />
      {/* «Tepaga chiqish»: fixed, listens on <main>; hidden while an overlay is open; sits above the bar (`--tabbar-h`). */}
      <ScrollToTop container={scroller} onShownChange={setTopButton} />
      <LoginModal />
      <SearchDialog />
      <NotificationsPanel />
      <PayDialog />
    </div>
  );
}

/**
 * FE-04: birinchi seans tekshiruvi yiqilganda (server qayta ishga
 * tushmoqda, 502, internet yo'q) — «chiqib ketdingiz» emas, halol xabar.
 * Store o'zi qayta urinadi; tugma darhol so'raydi.
 */
export function SessionBanner() {
  const error = useAppStore((s) => s.sessionError);
  const checked = useAppStore((s) => s.sessionChecked);
  const refresh = useAppStore((s) => s.refreshSession);
  if (!error || checked) return null;
  return (
    <div
      role="status"
      data-session-error
      className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300"
    >
      <span className="min-w-0 flex-1">Server bilan aloqa yo‘q — qayta urinilmoqda… {error}</span>
      <button
        type="button"
        onClick={() => void refresh()}
        className="shrink-0 rounded-full border border-amber-500/40 px-3 py-1 text-xs font-medium hover:bg-amber-500/10"
      >
        Qayta urinish
      </button>
    </div>
  );
}
