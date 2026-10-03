"use client";

import { useSyncExternalStore } from "react";

/**
 * Yon panel holati — har brauzerda eslab qolinadi (egasi qarori 1).
 * `localStorage` maxfiy oynada, bloklangan saytda yoki eskiz chizishda
 * istisno tashlashi yoki bo'sh qaytishi mumkin — har o'qish/yozish
 * `try/catch` ichida, xato bo'lsa standart (ochiq) ishlaydi.
 */
export const PANEL_PREF_KEY = "slaydx:result-panel";

export function readPanelOpen(): boolean | null {
  try {
    const v = window.localStorage.getItem(PANEL_PREF_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

export function writePanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PANEL_PREF_KEY, open ? "1" : "0");
  } catch {
    // Saqlab bo'lmadi — holat faqat shu sahifada qoladi.
  }
}

/** Keng ekran (`xl`, ≥ 1280 px): panel o'ngda; torroqda — pastki varaq. */
export const WIDE_QUERY = "(min-width: 1280px)";

function mql(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(WIDE_QUERY);
}

function subscribe(cb: () => void): () => void {
  const m = mql();
  if (!m) return () => {};
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

/** `matchMedia` yo'q muhitda (jsdom, SSR) — tor ekran deb olinadi. */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mql()?.matches ?? false,
    () => false,
  );
}
