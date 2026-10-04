"use client";

import { useSyncExternalStore } from "react";

/**
 * Touch-first layout switch (docs/mobile/PLAN.md §4.6, R3 «Contract»): a
 * coarse primary pointer OR a phone-width viewport. Use it to pick the phone
 * variant of a control (44 px targets, chips instead of `<select>`, in-flow
 * bars instead of floating panels).
 */
export const COARSE_POINTER_QUERY = "(pointer: coarse), (max-width: 767px)";

function mediaList(): MediaQueryList | null {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    return window.matchMedia(COARSE_POINTER_QUERY) ?? null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const m = mediaList();
  if (!m) return () => {};
  try {
    if (typeof m.addEventListener === "function") {
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    }
    // Safari < 14 only has the deprecated listener API.
    m.addListener(onChange);
    return () => m.removeListener(onChange);
  } catch {
    return () => {};
  }
}

/** Current value outside React (event handlers, effects). `false` without `matchMedia`. */
export function isCoarsePointer(): boolean {
  try {
    return mediaList()?.matches === true;
  } catch {
    return false;
  }
}

/**
 * `true` on touch devices and phone-width windows; live-updates on change.
 * `false` on the server and wherever `matchMedia` is missing (jsdom), so the
 * desktop path stays the default in SSR and in existing UI tests.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, isCoarsePointer, () => false);
}
