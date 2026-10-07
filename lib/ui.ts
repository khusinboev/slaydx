"use client";

import { create } from "zustand";
import { safeReturnTo } from "./safe-return";
// Not `./tools` (the full registry): this module is in every route's client layer (ops WP-B).
import { toolKindOf } from "./tool-kinds";

export type Overlay =
  | "login"
  | "search"
  | "notifications"
  | "pay"
  | "sort"
  /** The «+» tool sheet of the bottom tab bar (`components/shell/CreateSheet.tsx`). */
  | "create"
  | null;

type UiState = {
  overlay: Overlay;
  returnTo: string | null;
  open: (o: Overlay, extra?: { returnTo?: string }) => void;
  close: () => void;
};

export const useUi = create<UiState>((set) => ({
  overlay: null,
  returnTo: null,
  open: (overlay, extra) =>
    set({
      overlay,
      // C02/FE-01/SECA-02: `returnTo` bu yerga so'rov parametridan
      // (masalan `?returnTo=javascript:...`) kelishi mumkin — faqat
      // saytning o'zidagi "/uz" yo'li saqlanadi, aks holda `null`.
      returnTo: safeReturnTo(extra?.returnTo ?? null),
    }),
  close: () => set({ overlay: null }),
}));

/** Kun / Tun / Avto (docs/redesign/PLAN.md D4): `auto` follows the OS (`lib/store.ts applyTheme`). */
export const THEME_OPTIONS = [
  { value: "light", label: "Kun" },
  { value: "dark", label: "Tun" },
  { value: "auto", label: "Avto" },
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
 * Hujjat turi → «Mening fayllarim» filtri (bitta joyda; guruh va chiqish
 * `lib/tool-kinds.ts` dan — `TOOLS` bilan `tests/tool-kinds.test.mts` da qulflangan).
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
  const tool = toolKindOf(type);
  if (!tool) return "docs";
  if (tool.group === "oyinlar") return "games";
  if (type === "test") return "tests";
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

export type FileSortId = (typeof FILE_SORTS)[number]["id"];

/** «Mening fayllarim» ko'rinishi — URLda yashaydi, shuning uchun orqaga qaytganda saqlanadi. */
export type FileView = { filter: FileFilterId; sort: FileSortId; desc: boolean };

export const DEFAULT_FILE_VIEW: FileView = { filter: "all", sort: "modified", desc: true };

/** Noma'lum/buzuq qiymat standartga tushadi (URLni foydalanuvchi qo'lda tahrirlashi mumkin). */
export function readFileView(params: { get(name: string): string | null } | null | undefined): FileView {
  const filter = params?.get("filter");
  const sort = params?.get("sort");
  return {
    filter: FILE_FILTERS.some((f) => f.id === filter) ? (filter as FileFilterId) : DEFAULT_FILE_VIEW.filter,
    sort: FILE_SORTS.some((s) => s.id === sort) ? (sort as FileSortId) : DEFAULT_FILE_VIEW.sort,
    desc: params?.get("desc") === "0" ? false : DEFAULT_FILE_VIEW.desc,
  };
}

/**
 * `view` ni so'rov qatoriga yozadi; standart qiymatlar URLga CHIQMAYDI
 * (`/uz` toza qoladi). Boshqa parametrlar (`returnTo` …) tegilmaydi.
 */
export function writeFileView(base: URLSearchParams, view: FileView): URLSearchParams {
  const next = new URLSearchParams(base);
  next.delete("filter");
  next.delete("sort");
  next.delete("desc");
  if (view.filter !== DEFAULT_FILE_VIEW.filter) next.set("filter", view.filter);
  if (view.sort !== DEFAULT_FILE_VIEW.sort) next.set("sort", view.sort);
  if (view.desc !== DEFAULT_FILE_VIEW.desc) next.set("desc", "0");
  return next;
}

/**
 * Joriy yozuvning so'rov qatorini almashtiradi (yangi tarix yozuvi YO'Q).
 * `router.replace` o'rniga `history.replaceState`: Next uni `useSearchParams` bilan
 * sinxronlaydi, server so'rovi (RSC) yo'q, tarix indeksi (`lib/nav`) saqlanadi.
 */
export function replaceSearch(next: URLSearchParams): void {
  if (typeof window === "undefined") return;
  const qs = next.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
  if (url === window.location.pathname + window.location.search + window.location.hash) return;
  window.history.replaceState(window.history.state, "", url);
}
