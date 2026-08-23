"use client";

import Link from "next/link";
import { Bell, Moon, PanelLeft, Search, Sun, SunMoon } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { THEME_OPTIONS, UI_LOCALES, useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const overlay = useUi((s) => s.overlay);
  const open = useUi((s) => s.open);
  const close = useUi((s) => s.close);
  const currentLocale = UI_LOCALES.find((l) => l.value === locale) ?? UI_LOCALES[0];

  /**
   * Mavzu tugmasi menyu ochmaydi — bosilganda navbatdagi rejimga o'tadi:
   * yorug' → qorong'i → tizim → yorug'.
   *
   * Ikonka HOZIRGI REJIMNI ko'rsatadi, hal qilingan rangni emas: ilgari
   * quyosh/oy `dark` klassiga qarab almashardi, ya'ni «tizim» rejimi
   * umuman ko'rinmasdi — foydalanuvchi qaysi rejimda ekanini bilmasdi.
   * «Tizim» uchun yarim quyosh-oy ikonkasi.
   */
  const themeIndex = Math.max(0, THEME_OPTIONS.findIndex((t) => t.value === theme));
  const nextTheme = THEME_OPTIONS[(themeIndex + 1) % THEME_OPTIONS.length].value;
  const themeLabel = THEME_OPTIONS[themeIndex].label;
  const nextLabel = THEME_OPTIONS[(themeIndex + 1) % THEME_OPTIONS.length].label;
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : SunMoon;

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

      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        className="hover:bg-accent flex size-10 scale-95 items-center justify-center rounded-full"
        title={`Mavzu: ${themeLabel}. Bosing — ${nextLabel}`}
        aria-label={`Mavzu: ${themeLabel}. Almashtirish: ${nextLabel}`}
      >
        <ThemeIcon className="h-[1.2rem] w-[1.2rem]" />
      </button>

      <button
        type="button"
        onClick={() => open("notifications")}
        className="hover:bg-accent flex size-10 scale-95 items-center justify-center rounded-full"
        aria-label="Notifications alt+T"
      >
        <Bell className="h-[1.2rem] w-[1.2rem]" />
      </button>

      {loggedIn ? (
        // Profil, tariflar, sozlamalar va chiqish — hammasi endi /uz/profile
        // sahifasining o'zida. Bu yerda ikkinchi marta takrorlash o'rniga
        // faqat o'sha sahifaga o'tuvchi bitta avatar qoladi.
        <Link
          href="/uz/profile"
          aria-label="Profil"
          className="bg-primary text-primary-foreground ring-primary ring-offset-page-bg flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-2 ring-offset-2"
        >
          {(user?.name || "?").slice(0, 1).toUpperCase()}
        </Link>
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
