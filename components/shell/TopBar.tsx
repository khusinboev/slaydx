"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, Moon, PanelLeft, Search, Settings, Sun } from "lucide-react";
import { creditTotal, useAppStore } from "@/lib/store";
import { THEME_OPTIONS, UI_LOCALES, useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const signOut = useAppStore((s) => s.signOut);
  const overlay = useUi((s) => s.overlay);
  const open = useUi((s) => s.open);
  const close = useUi((s) => s.close);
  const currentLocale = UI_LOCALES.find((l) => l.value === locale) ?? UI_LOCALES[0];

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-[var(--page-bg)] px-3">
      <button
        type="button"
        onClick={onMenu}
        className="hover:bg-accent flex size-8 items-center justify-center rounded-md"
        aria-label="Toggle Sidebar"
      >
        <PanelLeft className="size-4" />
      </button>
      <div className="bg-sidebar-border hidden h-6 w-px md:block" />
      <div className="flex-1" />

      <button
        type="button"
        onClick={() => open("search")}
        className="hover:bg-accent size-10 scale-95 rounded-full"
        aria-label="Qidirish..."
      >
        <Search className="mx-auto h-[1.2rem] w-[1.2rem]" />
        <span className="sr-only">Qidirish...</span>
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => (overlay === "lang" ? close() : open("lang"))}
          className="hover:bg-accent flex h-8 w-8 items-center justify-center rounded-full"
          aria-label="Tilni o'zgartirish"
        >
          <span className="text-lg">{currentLocale.flag}</span>
          <span className="sr-only">Tilni o&apos;zgartirish</span>
        </button>
        {overlay === "lang" ? (
          <Menu onDismiss={close}>
            {UI_LOCALES.map((l) => (
              <button
                key={l.value}
                type="button"
                className={cn(
                  "hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                  locale === l.value && "font-medium",
                )}
                onClick={() => {
                  setLocale(l.value);
                  close();
                }}
              >
                <span>{l.flag}</span>
                {l.label}
              </button>
            ))}
          </Menu>
        ) : null}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => (overlay === "theme" ? close() : open("theme"))}
          className="hover:bg-accent relative flex size-10 scale-95 items-center justify-center rounded-full"
          aria-label="Mavzuni almashtirish"
        >
          <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 dark:scale-100 dark:rotate-0" />
          <span className="sr-only">Mavzuni almashtirish</span>
        </button>
        {overlay === "theme" ? (
          <Menu onDismiss={close}>
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.value}
                type="button"
                className={cn(
                  "hover:bg-muted w-full rounded-lg px-2.5 py-2 text-left text-sm",
                  theme === t.value && "font-medium",
                )}
                onClick={() => {
                  setTheme(t.value);
                  close();
                }}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              className="hover:bg-muted text-muted-foreground flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm"
              onClick={() => open("settings")}
            >
              <Settings className="size-3.5" />
              Sozlamalar
            </button>
          </Menu>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => open("notifications")}
        className="hover:bg-accent flex size-10 scale-95 items-center justify-center rounded-full"
        aria-label="Notifications alt+T"
      >
        <Bell className="h-[1.2rem] w-[1.2rem]" />
      </button>

      {loggedIn ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => (overlay === "user" ? close() : open("user"))}
            className="hover:bg-accent flex h-9 items-center gap-1.5 rounded-full px-2"
          >
            <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg text-xs font-semibold">
              {(user?.name || "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden text-sm font-medium sm:inline">
              {creditTotal(user).toLocaleString("uz-UZ")}
            </span>
            <ChevronDown className="text-muted-foreground size-3.5" />
          </button>
          {overlay === "user" ? (
            <Menu onDismiss={close} align="end">
              <button
                type="button"
                className="hover:bg-muted w-full rounded-lg px-2.5 py-2 text-left text-sm"
                onClick={() => {
                  close();
                  router.push("/uz/profile");
                }}
              >
                Profil
              </button>
              <button
                type="button"
                className="hover:bg-muted w-full rounded-lg px-2.5 py-2 text-left text-sm"
                onClick={() => {
                  close();
                  router.push("/uz/purchase");
                }}
              >
                Tariflar
              </button>
              <button
                type="button"
                className="hover:bg-muted w-full rounded-lg px-2.5 py-2 text-left text-sm"
                onClick={() => open("notifications")}
              >
                Bildirishnomalar
              </button>
              <Link
                href="/uz/purchase"
                onClick={close}
                className="hover:bg-muted block rounded-lg px-2.5 py-2 text-sm"
              >
                Balansni to&apos;ldirish
              </Link>
              <button
                type="button"
                className="hover:bg-muted w-full rounded-lg px-2.5 py-2 text-left text-sm"
                onClick={() => {
                  void signOut();
                  close();
                  router.push("/uz");
                }}
              >
                Chiqish
              </button>
            </Menu>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => open("login")}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-full px-3.5 text-[15.5px] font-medium"
        >
          Kirish
        </button>
      )}
    </header>
  );
}

function Menu({
  children,
  onDismiss,
  align = "end",
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  align?: "end" | "start";
}) {
  return (
    <>
      <button type="button" className="fixed inset-0 z-40" aria-label="Yopish" onClick={onDismiss} />
      <div
        className={cn(
          "bg-popover absolute top-11 z-50 min-w-44 rounded-xl border p-1 shadow-lg",
          align === "end" ? "end-0" : "start-0",
        )}
      >
        {children}
      </div>
    </>
  );
}
