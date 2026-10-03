"use client";

import { useContext, useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  backTo,
  currentIndex,
  installNav,
  navSequence,
  navigateFromOverlay,
  onNavigate,
  setNavRouter,
  systemBack,
  type NavRouter,
} from "@/lib/nav/history";
import { useUi } from "@/lib/ui";

const RESTORE_MS = 1500;

/**
 * Mounted once in `Providers` (consumer and admin pages share it).
 *
 *   - installs the history engine (index stamping on every committed URL
 *     change, overlay layers, leave guards) and hands it the app router;
 *   - on a route change closes the overlay store (`lib/ui.ts`) when the
 *     overlay was opened on the previous page;
 *   - saves `#main` scrollTop per history index and restores it on back/forward.
 *
 * It reads the router context directly (not `useRouter`), so trees rendered
 * without the app router (unit tests) stay inert instead of throwing.
 */
export function NavProvider({ children }: { children?: React.ReactNode }) {
  const router = useContext(AppRouterContext);
  const pathname = usePathname();

  useEffect(() => {
    installNav();
  }, []);

  useEffect(() => {
    setNavRouter(router ?? null);
    return () => setNavRouter(null);
  }, [router]);

  // Overlay store: an overlay opened before a navigation closes with it; one
  // opened by the new page (e.g. login from `?returnTo`) stays.
  useEffect(() => {
    let openedAt = useUi.getState().overlay ? navSequence() : -1;
    const offUi = useUi.subscribe((s, p) => {
      if (s.overlay && s.overlay !== p.overlay) openedAt = navSequence();
    });
    const offNav = onNavigate((e) => {
      if (pathOf(e.from) === e.pathname) return;
      const ui = useUi.getState();
      if (ui.overlay && openedAt < navSequence()) ui.close();
    });
    return () => {
      offUi();
      offNav();
    };
  }, []);

  // Scroll of the `#main` scroller per history index.
  const positions = useRef(new Map<number, number>());
  const pendingRestore = useRef<{ pathname: string; top: number } | null>(null);
  const restoring = useRef(false);
  useEffect(() => {
    const onScroll = (ev: Event) => {
      const el = ev.target;
      if (restoring.current || pendingRestore.current) return;
      if (el instanceof HTMLElement && el.id === "main") positions.current.set(currentIndex(), el.scrollTop);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const off = onNavigate((e) => {
      if (e.kind === "push") {
        for (const k of [...positions.current.keys()]) if (k >= e.index) positions.current.delete(k);
        return;
      }
      if (e.kind !== "traverse" || pathOf(e.from) === e.pathname) return;
      const top = positions.current.get(e.index);
      pendingRestore.current = top == null ? null : { pathname: e.pathname, top };
    });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      off();
    };
  }, []);

  useEffect(() => {
    const want = pendingRestore.current;
    if (!want) return;
    pendingRestore.current = null;
    if (want.pathname !== pathname) return;
    restoring.current = true;
    const until = Date.now() + RESTORE_MS;
    let raf = 0;
    const stop = () => {
      restoring.current = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", stop, true);
      window.removeEventListener("touchstart", stop, true);
      window.removeEventListener("keydown", stop, true);
    };
    // The page may still be filling in (lists, images): retry until it is tall enough.
    const step = () => {
      const el = document.getElementById("main");
      if (el) {
        el.scrollTop = want.top;
        if (Math.abs(el.scrollTop - want.top) < 2) return stop();
      }
      if (Date.now() > until) return stop();
      raf = requestAnimationFrame(step);
    };
    window.addEventListener("wheel", stop, true);
    window.addEventListener("touchstart", stop, true);
    window.addEventListener("keydown", stop, true);
    raf = requestAnimationFrame(step);
    return stop;
  }, [pathname]);

  return children ?? null;
}

function pathOf(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return "";
  }
}

/**
 * Navigation helpers bound to the nearest app router. Safe to call from any
 * client component; outside the app router they fall back to the router
 * `NavProvider` registered (or plain `location`).
 */
export function useNav() {
  const ctx = useContext(AppRouterContext) as NavRouter | null;
  const ref = useRef(ctx);
  useEffect(() => {
    ref.current = ctx;
  }, [ctx]);
  return useMemo(
    () => ({
      /** «←»: back when the previous entry is in-app, else replace with `fallback ?? parentOf(path)`. */
      backTo: (fallback?: string) => backTo(fallback, { router: ref.current }),
      /** Leave an open overlay for `href`; the overlay's entry is replaced (see `lib/nav/history.ts`). */
      navigateFromOverlay: (href: string, opts?: { external?: boolean }) =>
        navigateFromOverlay(href, { ...opts, router: ref.current }),
      /** System back (Telegram BackButton): close the top overlay, else `backTo()`. */
      systemBack: () => systemBack({ router: ref.current }),
    }),
    [],
  );
}
