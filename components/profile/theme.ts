"use client";

/**
 * Theme choice for Profil → Ko'rinish (Kun / Tun / Avto, decision D4) — a thin
 * view over the app store, which owns the mode (`ThemeMode` includes `auto`,
 * repaints on OS changes and persists it; `lib/store.ts`). Kept as the
 * profile's vocabulary (labels + hints) so ProfileHome/ProfileStep stay simple.
 */
import { useAppStore, type ThemeMode } from "@/lib/store";

export type ThemeChoice = ThemeMode;

export const THEME_CHOICES: readonly { value: ThemeChoice; label: string; hint: string }[] = [
  { value: "light", label: "Kun", hint: "Yorug' fon, kunduzi qulay" },
  { value: "dark", label: "Tun", hint: "Qorong'i fon, ko'zni charchatmaydi" },
  { value: "auto", label: "Avto", hint: "Qurilmangiz sozlamasiga ergashadi" },
];

export function themeChoiceLabel(choice: ThemeChoice): string {
  return THEME_CHOICES.find((c) => c.value === choice)?.label ?? "";
}

export function setThemeChoice(choice: ThemeChoice): void {
  useAppStore.getState().setTheme(choice);
}

/** The current choice and its setter. */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const theme = useAppStore((s) => s.theme);
  return [theme, setThemeChoice];
}
