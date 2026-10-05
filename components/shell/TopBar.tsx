"use client";

import Link from "next/link";
import { Bell, Coins, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { creditTotal, useAppStore } from "@/lib/store";
import { THEME_OPTIONS, useUi } from "@/lib/ui";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { cn } from "@/lib/cn";
import { SAFE_LEFT, SAFE_RIGHT, TOPBAR_HEIGHT, TOP_INSET, atLeast } from "./safe-area";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const open = useUi((s) => s.open);
  /**
   * Telefon / sensorli ekran (docs/mobile/PLAN.md O5): har bir boshqaruv
   * 44×44 bosish maydoniga ega, hammasi 360 px ga sig'adi (oraliq kichik,
   * balans chipi qisqaradi). Ish stoli o'zgarmaydi.
   */
  const phone = useCoarsePointer();
  const iconButton = cn("hover:bg-accent flex items-center justify-center rounded-full", phone ? "size-11 shrink-0" : "size-10 scale-95");

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
  const initial = (user?.name || "?").slice(0, 1).toUpperCase();

  return (
    <header
      data-topbar
      data-phone={phone ? "" : undefined}
      className={cn(
        "flex shrink-0 items-center border-b border-border/60 bg-[var(--page-bg)]",
        phone ? "gap-0.5" : "h-14 gap-2 px-3",
      )}
      // Telefonda: bar balandligi + Telegram/notch xavfsiz maydoni (bo'lmasa 0).
      style={
        phone
          ? {
              height: TOPBAR_HEIGHT,
              paddingTop: TOP_INSET,
              paddingLeft: atLeast("0.5rem", SAFE_LEFT),
              paddingRight: atLeast("0.5rem", SAFE_RIGHT),
            }
          : undefined
      }
    >
      <button
        type="button"
        onClick={onMenu}
        className={cn(
          "hover:bg-accent flex shrink-0 items-center justify-center",
          phone ? "size-11 rounded-full" : "size-8 rounded-md",
        )}
        aria-label="Yon panelni ko‘rsatish/yashirish"
      >
        <PanelLeft className="size-4" />
      </button>
      <div className="bg-sidebar-border hidden h-6 w-px md:block" />
      <div className="flex-1" />

      <button
        type="button"
        onClick={() => open("search")}
        className={iconButton}
        aria-label="Qidirish..."
      >
        <Search className="h-[1.2rem] w-[1.2rem]" />
        <span className="sr-only">Qidirish...</span>
      </button>

      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        className={iconButton}
        title={`Mavzu: ${themeLabel}. Bosing — ${nextLabel}`}
        aria-label={`Mavzu: ${themeLabel}. Almashtirish: ${nextLabel}`}
      >
        <ThemeIcon className="h-[1.2rem] w-[1.2rem]" />
      </button>

      <button
        type="button"
        onClick={() => open("notifications")}
        className={iconButton}
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
          className={cn(
            "hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full text-sm font-medium tabular-nums",
            // Telefonda chip siqiladi (matn qisqaradi), 44 px balandlik va kenglik saqlanadi.
            phone ? "h-11 min-w-11 shrink justify-center px-2" : "h-8 shrink-0 px-2.5",
          )}
        >
          <Coins className="size-4 shrink-0" />
          <span className={phone ? "min-w-0 truncate" : undefined}>{creditTotal(user).toLocaleString("uz-UZ")}</span>
        </Link>
      ) : null}

      {loggedIn ? (
        // Profil, balansni to'ldirish, sozlamalar va chiqish — hammasi endi /uz/profile
        // sahifasining o'zida. Bu yerda ikkinchi marta takrorlash o'rniga
        // faqat o'sha sahifaga o'tuvchi bitta avatar qoladi.
        <Link
          href="/uz/profile"
          aria-label="Profil"
          data-avatar
          className={cn(
            "flex shrink-0 items-center justify-center",
            // Telefon: ko'rinadigan doira 32 px, bosish maydoni 44×44.
            phone
              ? "size-11"
              : "bg-primary text-primary-foreground ring-primary ring-offset-page-bg size-8 rounded-full text-sm font-bold ring-2 ring-offset-2",
          )}
        >
          {phone ? (
            <span className="bg-primary text-primary-foreground ring-primary ring-offset-page-bg flex size-8 items-center justify-center rounded-full text-sm font-bold ring-2 ring-offset-2">
              {initial}
            </span>
          ) : (
            initial
          )}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => open("login")}
          className={cn(
            "bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 rounded-full px-3.5 text-[15.5px] font-medium",
            phone ? "h-11 min-w-11" : "h-9",
          )}
        >
          Kirish
        </button>
      )}
    </header>
  );
}
