"use client";

/**
 * Theme choice adapter for Profil → Ko'rinish (Kun / Tun / Avto, decision D4).
 *
 * `lib/store` knows two themes (`light`/`dark`, persisted in `slaydx-ui`).
 * «Avto» is a flag on top of it: while it is on, the store theme follows the
 * OS `prefers-color-scheme` (now and on change). Choosing Kun/Tun clears it.
 *
 * Kept here, tiny, so the shell can adopt it without a store change:
 *   - call `followOsTheme()` once at the app root (returns the unsubscribe)
 *     so «Avto» also holds on screens other than the profile;
 *   - quick toggles elsewhere (Bosh header sun/moon) should call
 *     `setThemeChoice("light" | "dark")` instead of `setTheme`, which also
 *     turns «Avto» off.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useAppStore, type ThemeMode } from "@/lib/store";

export type ThemeChoice = ThemeMode | "auto";

export const THEME_CHOICES: readonly { value: ThemeChoice; label: string; hint: string }[] = [
  { value: "light", label: "Kun", hint: "Yorug' fon, kunduzi qulay" },
  { value: "dark", label: "Tun", hint: "Qorong'i fon, ko'zni charchatmaydi" },
  { value: "auto", label: "Avto", hint: "Qurilmangiz sozlamasiga ergashadi" },
];

export const THEME_AUTO_KEY = "slaydx-theme-auto";
const QUERY = "(prefers-color-scheme: dark)";

const listeners = new Set<() => void>();
/** Fallback when storage is blocked, so the choice still shows as selected. */
let memoryAuto: boolean | null = null;

export function readAutoTheme(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(THEME_AUTO_KEY) === "1";
  } catch {
    return memoryAuto ?? false;
  }
}

function writeAutoTheme(on: boolean) {
  try {
    if (on) window.localStorage.setItem(THEME_AUTO_KEY, "1");
    else window.localStorage.removeItem(THEME_AUTO_KEY);
  } catch {
    // Storage blocked (private mode): «Avto» lasts for this page only.
    memoryAuto = on;
  }
  for (const l of listeners) l();
}

const snapshot = readAutoTheme;

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function osTheme(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

export function themeChoiceLabel(choice: ThemeChoice): string {
  return THEME_CHOICES.find((c) => c.value === choice)?.label ?? "";
}

export function setThemeChoice(choice: ThemeChoice): void {
  const { setTheme } = useAppStore.getState();
  if (choice === "auto") {
    writeAutoTheme(true);
    setTheme(osTheme());
  } else {
    writeAutoTheme(false);
    setTheme(choice);
  }
}

/** While «Avto» is on, keep the store theme equal to the OS one. Returns the unsubscribe. */
export function followOsTheme(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(QUERY);
  const sync = () => {
    if (!snapshot()) return;
    const want: ThemeMode = mq.matches ? "dark" : "light";
    if (useAppStore.getState().theme !== want) useAppStore.getState().setTheme(want);
  };
  sync();
  mq.addEventListener?.("change", sync);
  return () => mq.removeEventListener?.("change", sync);
}

/** The current choice («auto» when the flag is on, else the store theme) and its setter. */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const theme = useAppStore((s) => s.theme);
  const auto = useSyncExternalStore(subscribe, snapshot, () => false);
  useEffect(() => followOsTheme(), []);
  return [auto ? "auto" : theme, setThemeChoice];
}
