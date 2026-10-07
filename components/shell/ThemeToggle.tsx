"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useAppStore, type ResolvedTheme, type ThemeMode } from "@/lib/store";
import { THEME_OPTIONS } from "@/lib/ui";
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
 * Ko'rinish (`ProfileStep` «korinish»). The icon shows the CURRENT look.
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
