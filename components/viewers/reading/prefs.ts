"use client";

import { useCallback, useState } from "react";

/**
 * Document view mode for paged documents (viewer polish V5a, owner decision).
 *
 * - `"reading"` («O‘qish»): text reflowed to the screen width.
 * - `"page"` («Varaq»): the exact A4 sheets. Editing and printing happen only here.
 *
 * Phones open in «O‘qish» by default because an A4 sheet fitted to a 390 px
 * screen is about 46 % (landscape 32 %), which is illegible. Desktop keeps «Varaq».
 * An explicit choice is remembered per browser and wins over the default.
 */
export type DocView = "reading" | "page";

export const DOC_VIEW_KEY = "slaydx:doc-view";

/** Viewport narrower than Tailwind `sm` (640 px). */
export const NARROW_QUERY = "(max-width: 639.98px)";
/** Phone-class screen: shorter side under 640 px. */
export const PHONE_SCREEN_PX = 640;

/**
 * Pure rule (mutation-tested): a phone is a narrow viewport, or a touch device
 * whose shorter screen side is phone-sized (a phone in landscape, or a phone
 * showing the desktop site).
 */
export function isPhone(env: { narrow: boolean; coarse: boolean; screenMin: number }): boolean {
  return env.narrow || (env.coarse && env.screenMin > 0 && env.screenMin < PHONE_SCREEN_PX);
}

/** Pure rule (mutation-tested): the stored choice wins; otherwise phones read, everything else gets sheets. */
export function defaultDocView(stored: DocView | null, phone: boolean): DocView {
  if (stored) return stored;
  return phone ? "reading" : "page";
}

/** localStorage can throw or be empty (private window, blocked storage, thumbnails): every access is guarded. */
export function readDocView(): DocView | null {
  try {
    const v = window.localStorage.getItem(DOC_VIEW_KEY);
    return v === "reading" || v === "page" ? v : null;
  } catch {
    return null;
  }
}

export function writeDocView(v: DocView): void {
  try {
    window.localStorage.setItem(DOC_VIEW_KEY, v);
  } catch {
    // Not persisted: the choice lives only on this page.
  }
}

function media(q: string): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(q).matches;
  } catch {
    return false;
  }
}

/** Phone detection from the live browser. No `matchMedia` (SSR, jsdom) means not a phone. */
export function detectPhone(): boolean {
  if (typeof window === "undefined") return false;
  const s = window.screen;
  const screenMin = s && s.width > 0 && s.height > 0 ? Math.min(s.width, s.height) : 0;
  return isPhone({ narrow: media(NARROW_QUERY), coarse: media("(pointer: coarse)"), screenMin });
}

/** The mode the viewer opens in. On the server it is always «Varaq», so SSR markup and parity tests stay unchanged. */
export function initialDocView(): DocView {
  if (typeof window === "undefined") return "page";
  return defaultDocView(readDocView(), detectPhone());
}

/**
 * View-mode state for one viewer. The initial value is read once at mount;
 * viewers are client-only lazy chunks, so this never hydrates against SSR.
 * `setView` also persists the choice.
 */
export function useDocView(): [DocView, (v: DocView) => void] {
  const [view, setState] = useState<DocView>(initialDocView);
  const setView = useCallback((v: DocView) => {
    setState(v);
    writeDocView(v);
  }, []);
  return [view, setView];
}
