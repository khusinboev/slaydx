"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { LoginModal } from "../overlays/LoginModal";
import { SearchDialog } from "../overlays/SearchDialog";
import { NotificationsPanel } from "../overlays/NotificationsPanel";
import { PayDialog } from "../overlays/PayDialog";
import { useUi } from "@/lib/ui";
import { useAppStore } from "@/lib/store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const open = useUi((s) => s.open);

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

  return (
    <div
      className="bg-sidebar flex h-svh w-full overflow-hidden"
      style={{ ["--sidebar-width" as string]: "16rem" }}
    >
      <aside className="hidden h-full w-[var(--sidebar-width)] shrink-0 md:flex">
        <Sidebar />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Yopish"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 h-full w-[16rem] shadow-xl">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--page-bg)]">
        <TopBar onMenu={() => setMobileOpen((v) => !v)} />
        <SessionBanner />
        <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--page-bg)]">{children}</main>
      </div>

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
