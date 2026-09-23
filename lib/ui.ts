"use client";

import { create } from "zustand";
import { safeReturnTo } from "./safe-return";

export type Overlay =
  | "login"
  | "search"
  | "notifications"
  | "pay"
  | "lang"
  | "sort"
  | null;

type UiState = {
  overlay: Overlay;
  returnTo: string | null;
  payPlan: string | null;
  open: (o: Overlay, extra?: { returnTo?: string; payPlan?: string }) => void;
  close: () => void;
};

export const useUi = create<UiState>((set) => ({
  overlay: null,
  returnTo: null,
  payPlan: null,
  open: (overlay, extra) =>
    set({
      overlay,
      // C02/FE-01/SECA-02: `returnTo` bu yerga so'rov parametridan
      // (masalan `?returnTo=javascript:...`) kelishi mumkin — faqat
      // saytning o'zidagi "/uz" yo'li saqlanadi, aks holda `null`.
      returnTo: safeReturnTo(extra?.returnTo ?? null),
      payPlan: extra?.payPlan ?? null,
    }),
  close: () => set({ overlay: null }),
}));

export const UI_LOCALES = [
  { value: "uz", label: "O'zbekcha", flag: "🇺🇿" },
  { value: "en", label: "English", flag: "🇬🇧" },
  { value: "ru", label: "Русский", flag: "🇷🇺" },
  { value: "kaa", label: "Qaraqalpaqsha", flag: "🇺🇿" },
  { value: "kk", label: "Қазақша", flag: "🇰🇿" },
  { value: "ky", label: "Кыргызча", flag: "🇰🇬" },
] as const;

export const THEME_OPTIONS = [
  { value: "light", label: "Kun" },
  { value: "dark", label: "Tun" },
] as const;

export const FILE_FILTERS = [
  { id: "all", label: "Barchasi" },
  { id: "slide", label: "Slaydlar" },
  { id: "docs", label: "Hujjatlar" },
  { id: "image", label: "Rasmlar" },
  { id: "tests", label: "Testlar" },
  { id: "games", label: "O'yinlar" },
] as const;

export const FILE_SORTS = [
  { id: "modified", label: "Oxirgi o'zgartirilgan" },
  { id: "created", label: "Avval yaratilgan" },
  { id: "name", label: "Nomi" },
] as const;
