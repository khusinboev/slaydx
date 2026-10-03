"use client";

import { useCallback, useSyncExternalStore } from "react";

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
/**
 * Panel standart OCHIQ bo'ladigan eni (`min-width`). 1280…1599 px da panel
 * mavjud, lekin standart YOPIQ (mazmun ustuni 40 % ga siqilmasin, R3);
 * chip/tugma uni ochadi, saqlangan tanlov (`readPanelOpen`) esa har doim ustun.
 */
export const DOCK_DEFAULT_OPEN_QUERY = "(min-width: 1600px)";
/** Telefon (`< md`): sticky sarlavha pastga aylantirilganda ixchamlashadi. */
export const PHONE_QUERY = "(max-width: 767px)";

function mq(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

/** `matchMedia` yo'q muhitda (jsdom, SSR) — `false`. */
function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = mq(query);
      if (!m) return () => {};
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => mq(query)?.matches ?? false,
    () => false,
  );
}

/** `matchMedia` yo'q muhitda (jsdom, SSR) — tor ekran deb olinadi. */
export const useWide = (): boolean => useMedia(WIDE_QUERY);
/** ≥ 1600 px: panel saqlangan tanlovsiz ochiq turadi. */
export const useDockDefaultOpen = (): boolean => useMedia(DOCK_DEFAULT_OPEN_QUERY);
export const usePhone = (): boolean => useMedia(PHONE_QUERY);
