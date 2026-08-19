"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { LoginModal } from "../overlays/LoginModal";
import { SearchDialog } from "../overlays/SearchDialog";
import { SettingsDialog } from "../overlays/SettingsDialog";
import { NotificationsPanel } from "../overlays/NotificationsPanel";
import { PayDialog } from "../overlays/PayDialog";
import { useUi } from "@/lib/ui";

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
        <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--page-bg)]">{children}</main>
      </div>

      <LoginModal />
      <SearchDialog />
      <SettingsDialog />
      <NotificationsPanel />
      <PayDialog />
    </div>
  );
}
