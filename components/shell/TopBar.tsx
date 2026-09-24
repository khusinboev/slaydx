"use client";

import Link from "next/link";
import { Bell, Coins, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { creditTotal, useAppStore } from "@/lib/store";
import { THEME_OPTIONS, useUi } from "@/lib/ui";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const open = useUi((s) => s.open);

  /**
   * Mavzu tugmasi menyu ochmaydi — bosilganda ikkinchi rejimga o'tadi:
   * Kun → Tun → Kun. «Tizim» rejimi olib tashlandi (WP5) — endi faqat
   * ikkita mavzu bor, OS afzalligi FAQAT birinchi tashrifda bir marta
   * o'qiladi (`resolveOsTheme`, `lib/store.ts`).
   *
   * Ikonka HOZIRGI REJIMNI ko'rsatadi: Sun — Kun, Moon — Tun.
   */
  const themeIndex = Math.max(0, THEME_OPTIONS.findIndex((t) => t.value === theme));
  const nextTheme = THEME_OPTIONS[(themeIndex + 1) % THEME_OPTIONS.length].value;
  const themeLabel = THEME_OPTIONS[themeIndex].label;
  const nextLabel = THEME_OPTIONS[(themeIndex + 1) % THEME_OPTIONS.length].label;
  const ThemeIcon = theme === "dark" ? Moon : Sun;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-[var(--page-bg)] px-3">
      <button
        type="button"
        onClick={onMenu}
        className="hover:bg-accent flex size-8 items-center justify-center rounded-md"
        aria-label="Yon panelni ko‘rsatish/yashirish"
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
        aria-label="Bildirishnomalar"
        title="Bildirishnomalar (Alt+T)"
      >
        <Bell className="h-[1.2rem] w-[1.2rem]" />
      </button>

      {loggedIn && user ? (
        /*
         * UX-03: balans har sahifada ko'rinadi (ilgari faqat profilda) va
         * to'ldirish sahifasiga olib boradi — «Balans yetarli emas» ni
         * ko'rgan foydalanuvchi uni qidirib yurmaydi.
         */
        <Link
          href="/uz/purchase"
          data-balance
          title="Balans — to'ldirish"
          aria-label={`Balans: ${creditTotal(user).toLocaleString("uz-UZ")} tanga. To'ldirish`}
          className="hover:bg-accent text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-medium tabular-nums"
        >
          <Coins className="size-4" />
          {creditTotal(user).toLocaleString("uz-UZ")}
        </Link>
      ) : null}

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

