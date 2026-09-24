"use client";

import { create } from "zustand";
import { safeReturnTo } from "./safe-return";
import { TOOL_BY_ID } from "./tools";
import type { ToolConfig } from "./types";

export type Overlay =
  | "login"
  | "search"
  | "notifications"
  | "pay"
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

export type FileFilterId = (typeof FILE_FILTERS)[number]["id"];

/**
 * Hujjat turi → «Mening fayllarim» filtri (bitta joyda, `lib/tools.ts`
 * dan olinadi).
 *
 * FE-08: ilgari «Testlar» va «O'yinlar» QAT'IY `false` qaytarardi —
 * sotilayotgan test, krossvord, kartochka va boshqa o'yinlar u yerda
 * hech qachon chiqmas, «Hujjatlar» ichida yashirinib qolardi; pro slayd
 * «Slaydlar»da, infografika «Rasmlar»da yo'q edi. Endi: slayd — PPTX
 * chiqishi, rasm — PNG, test — `test`, o'yin — «O'yinlar» bo'limi
 * vositalari, qolgan hammasi — «Hujjatlar». Har tur aniq BITTA toifaga
 * tushadi (`all` dan tashqari) — hech biri ko'rinmay qolmaydi.
 */
export function fileCategory(type: string): Exclude<FileFilterId, "all"> {
  const tool = (TOOL_BY_ID as Record<string, ToolConfig | undefined>)[type];
  if (!tool) return "docs";
  if (tool.group === "oyinlar") return "games";
  if (tool.id === "test") return "tests";
  if (tool.output === "pptx") return "slide";
  if (tool.output === "png") return "image";
  return "docs";
}

export function fileFilterMatch(filter: FileFilterId, type: string): boolean {
  return filter === "all" || fileCategory(type) === filter;
}

export const FILE_SORTS = [
  { id: "modified", label: "Oxirgi o'zgartirilgan" },
  { id: "created", label: "Avval yaratilgan" },
  { id: "name", label: "Nomi" },
] as const;
