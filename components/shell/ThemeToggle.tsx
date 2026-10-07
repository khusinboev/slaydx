"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";
import { useAppStore, type ResolvedTheme, type ThemeMode } from "@/lib/store";
import { THEME_OPTIONS } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { HeaderIconButton } from "./PageHeader";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeOs(cb: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  if (typeof mq?.addEventListener !== "function") return () => {};
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function osDark(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

const labelOf = (v: ThemeMode) => THEME_OPTIONS.find((o) => o.value === v)?.label ?? "Kun";

/**
 * Theme mode (Kun / Tun / Avto) and what is painted now. Hydration-safe: the
 * server (and the hydration pass) see «Kun» and no OS dark, then the stored
 * mode and the OS preference take over.
 */
export function useThemeMode(): { mode: ThemeMode; resolved: ResolvedTheme; setMode: (m: ThemeMode) => void } {
  const mode = useAppStore((s) => s.theme);
  const setMode = useAppStore((s) => s.setTheme);
  const dark = useSyncExternalStore(subscribeOs, osDark, () => false);
  const resolved: ResolvedTheme = mode === "auto" ? (dark ? "dark" : "light") : mode;
  return { mode, resolved, setMode };
}

/**
 * Quick sun/moon in a page header (Bosh, D4). One tap flips what is painted
 * (Avto becomes an explicit Kun/Tun); the full choice lives in Profil →
 * Ko'rinish (`ThemeChoice`). The icon shows the CURRENT look.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, resolved, setMode } = useThemeMode();
  const next: ThemeMode = resolved === "dark" ? "light" : "dark";
  const Icon = resolved === "dark" ? Moon : Sun;
  const current = mode === "auto" ? `${labelOf("auto")} (${labelOf(resolved)})` : labelOf(mode);
  return (
    <HeaderIconButton
      data-theme-toggle
      label={`Mavzu: ${current}. Almashtirish: ${labelOf(next)}`}
      title={`Mavzu: ${current}`}
      className={className}
      onClick={() => setMode(next)}
    >
      <Icon className="size-[1.2rem]" aria-hidden />
    </HeaderIconButton>
  );
}

const ICONS: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, auto: SunMoon };

/** Kun / Tun / Avto as one radio group (Profil → Ko'rinish). Each option is a 44 px+ target. */
export function ThemeChoice({ className }: { className?: string }) {
  const { mode, setMode } = useThemeMode();
  return (
    <div role="radiogroup" aria-label="Mavzu" data-theme-choice className={cn("grid grid-cols-3 gap-2", className)}>
      {THEME_OPTIONS.map((o) => {
        const Icon = ICONS[o.value];
        const on = mode === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-theme-option={o.value}
            onClick={() => setMode(o.value)}
            className={cn(
              "focus-visible:ring-ring flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border text-[15px] font-medium outline-none transition-colors focus-visible:ring-2",
              on ? "border-primary bg-accent-soft text-foreground" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
