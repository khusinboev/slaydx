"use client";

import { useEffect } from "react";
import { applyTheme, useAppStore } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = useAppStore((s) => s.theme);
  const dir = useAppStore((s) => s.dir);
  const hydrated = useAppStore((s) => s.hydrated);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const refreshSession = useAppStore((s) => s.refreshSession);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);

  // Sessiya serverdan tekshiriladi — `localStorage.loggedIn` ga ishonmaymiz.
  useEffect(() => {
    useAppStore.setState({ hydrated: true });
    const s = useAppStore.getState();
    applyTheme(s.theme);
    document.documentElement.setAttribute("dir", s.dir);
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (loggedIn) void refreshGenerations();
  }, [loggedIn, refreshGenerations]);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(theme);
    document.documentElement.setAttribute("dir", dir);
  }, [theme, dir, hydrated]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return children;
}
