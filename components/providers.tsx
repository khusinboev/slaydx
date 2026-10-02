"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { applyTheme, useAppStore } from "@/lib/store";

/**
 * The admin panel (`/admin/**`) has its own session (`/api/admin/session`) and never reads the
 * consumer session or generations list; only the theme from this store is shared.
 */
function isAdminPath(pathname: string | null): boolean {
  return pathname === "/admin" || Boolean(pathname?.startsWith("/admin/"));
}

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = useAppStore((s) => s.theme);
  const dir = useAppStore((s) => s.dir);
  const hydrated = useAppStore((s) => s.hydrated);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const refreshSession = useAppStore((s) => s.refreshSession);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);
  const onAdmin = isAdminPath(usePathname());
  const sessionBooted = useRef(false);

  useEffect(() => {
    useAppStore.setState({ hydrated: true });
    const s = useAppStore.getState();
    applyTheme(s.theme);
    document.documentElement.setAttribute("dir", s.dir);
  }, []);

  // Sessiya serverdan tekshiriladi — `localStorage.loggedIn` ga ishonmaymiz.
  // Admin pages skip it (and with it the generations fetch it unlocks); it runs once on the
  // first non-admin page, including after a client-side navigation out of the panel.
  useEffect(() => {
    if (onAdmin || sessionBooted.current) return;
    sessionBooted.current = true;
    void refreshSession();
  }, [onAdmin, refreshSession]);

  useEffect(() => {
    if (loggedIn) void refreshGenerations();
  }, [loggedIn, refreshGenerations]);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(theme);
    document.documentElement.setAttribute("dir", dir);
  }, [theme, dir, hydrated]);

  return children;
}
