"use client";

import { useSyncExternalStore } from "react";
import { getTelegramWebApp, onEvent } from "../telegram-webapp";

/**
 * Visible-area tracking for the on-screen keyboard (docs/mobile/PLAN.md §4.6,
 * R3 «Contract»).
 *
 * Phones shrink different things when the keyboard opens:
 *  - iOS (Safari and Telegram's WKWebView) keeps the layout viewport and
 *    shrinks/scrolls only `window.visualViewport`;
 *  - Android (Chrome, Telegram's WebView) usually resizes the whole window,
 *    so `innerHeight` drops and `visualViewport` follows it.
 *
 * While at least one component uses the hook, `<html>` carries two CSS
 * variables, so plain CSS can follow the keyboard without re-rendering:
 *  - `--vv-h`: visible height in px (`height` below);
 *  - `--kb-h`: how far a `position: fixed; bottom: 0` element must be lifted
 *    to sit on top of the keyboard (`keyboardHeight`; 0 when the window
 *    itself was resized, because `bottom: 0` is then already above it).
 *    Use it as `bottom: var(--kb-h, 0px)`.
 * Both are removed when the last user unmounts.
 *
 * Sources: `visualViewport` `resize`/`scroll`, window `resize`, and Telegram's
 * `viewportChanged` (when the Mini App script is present). One shared
 * listener set serves every hook instance.
 */
export type VisualViewportState = {
  /** Visible height in CSS px (visual viewport, or `innerHeight` without it). */
  height: number;
  /** Visual viewport offset from the layout viewport top (iOS scrolls it while typing). */
  offsetTop: number;
  /** The on-screen keyboard (or another inset of the same size) is open. */
  keyboardOpen: boolean;
  /** Lift for bottom-fixed elements; mirrors `--kb-h`. */
  keyboardHeight: number;
};

/** One reading of the browser's sizes (what `computeViewport` needs). */
export type ViewportSample = {
  innerHeight: number;
  innerWidth: number;
  /** Layout viewport height (`documentElement.clientHeight`); 0 = unknown, `innerHeight` is used. */
  layoutHeight: number;
  vv: { height: number; offsetTop: number; scale: number } | null;
};

/** The visual viewport is this much shorter than the layout viewport → keyboard (R3). */
export const KEYBOARD_MIN_PX = 120;
/** The window shrank below this share of its tallest height at the same width → keyboard (Android resize). */
export const KEYBOARD_SHRINK_RATIO = 0.8;

/**
 * Pure: derives the state from one sample and the tallest `innerHeight` seen
 * at the current width. Pinch zoom also shrinks `visualViewport.height`, so
 * the keyboard test compares the zoom-corrected height (`height × scale`).
 */
export function computeViewport(s: ViewportSample, maxInnerHeight: number): VisualViewportState {
  const layout = s.layoutHeight > 0 ? s.layoutHeight : s.innerHeight;
  const vv = s.vv;
  const height = Math.round(vv ? vv.height : s.innerHeight);
  const offsetTop = Math.round(vv ? Math.max(0, vv.offsetTop) : 0);
  const scale = vv && vv.scale > 0 ? vv.scale : 1;
  const viewportShrunk = vv !== null && layout - vv.height * scale > KEYBOARD_MIN_PX;
  const windowShrunk = maxInnerHeight > 0 && s.innerHeight < KEYBOARD_SHRINK_RATIO * maxInnerHeight;
  const keyboardOpen = viewportShrunk || windowShrunk;
  const keyboardHeight = keyboardOpen && vv ? Math.max(0, Math.round(layout - (vv.offsetTop + vv.height))) : 0;
  return { height, offsetTop, keyboardOpen, keyboardHeight };
}

/** Before hydration and on the server. */
const SERVER_STATE: VisualViewportState = Object.freeze({ height: 0, offsetTop: 0, keyboardOpen: false, keyboardHeight: 0 });

function sample(): ViewportSample | null {
  try {
    if (typeof window === "undefined") return null;
    const v = window.visualViewport;
    return {
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      layoutHeight: document.documentElement?.clientHeight ?? 0,
      vv: v ? { height: v.height, offsetTop: v.offsetTop, scale: v.scale } : null,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ shared store */

const listeners = new Set<() => void>();
let state: VisualViewportState | null = null;
let maxInner = 0;
let maxWidth = -1;
let detach: (() => void) | null = null;
let detachTelegram: (() => void) | null = null;
let frame: number | null = null;

function read(): VisualViewportState {
  const s = sample();
  if (!s) return SERVER_STATE;
  // Rotation changes the width: start the "tallest window" over.
  if (s.innerWidth !== maxWidth) {
    maxWidth = s.innerWidth;
    maxInner = s.innerHeight;
  } else if (s.innerHeight > maxInner) {
    maxInner = s.innerHeight;
  }
  return computeViewport(s, maxInner);
}

function same(a: VisualViewportState, b: VisualViewportState): boolean {
  return (
    a.height === b.height &&
    a.offsetTop === b.offsetTop &&
    a.keyboardOpen === b.keyboardOpen &&
    a.keyboardHeight === b.keyboardHeight
  );
}

function writeCssVars(s: VisualViewportState | null): void {
  try {
    const style = document.documentElement.style;
    if (s) {
      style.setProperty("--vv-h", `${s.height}px`);
      style.setProperty("--kb-h", `${s.keyboardHeight}px`);
    } else {
      style.removeProperty("--vv-h");
      style.removeProperty("--kb-h");
    }
  } catch {
    // No document (server) or a locked style: nothing to write.
  }
}

function update(): void {
  attachTelegram();
  const next = read();
  if (state && same(state, next)) return;
  state = next;
  writeCssVars(next);
  for (const l of [...listeners]) l();
}

/** Runs `update` now and once more on the next frame (sizes settle after the event). */
function onResize(): void {
  update();
  try {
    if (frame !== null || typeof requestAnimationFrame !== "function") return;
    frame = requestAnimationFrame(() => {
      frame = null;
      update();
    });
  } catch {
    frame = null;
  }
}

/** Telegram's script loads after the first render, so this is retried on every update. */
function attachTelegram(): void {
  if (detachTelegram || listeners.size === 0 || !getTelegramWebApp()) return;
  detachTelegram = onEvent("viewportChanged", onResize);
}

function attach(): () => void {
  const cleanups: (() => void)[] = [];
  try {
    const v = window.visualViewport;
    if (v) {
      v.addEventListener("resize", onResize);
      v.addEventListener("scroll", onResize);
      cleanups.push(() => {
        v.removeEventListener("resize", onResize);
        v.removeEventListener("scroll", onResize);
      });
    }
    window.addEventListener("resize", onResize);
    cleanups.push(() => window.removeEventListener("resize", onResize));
  } catch {
    // Partial environment: keep whatever was attached.
  }
  return () => {
    for (const c of cleanups) {
      try {
        c();
      } catch {
        // Ignore: the window is going away.
      }
    }
  };
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(onChange);
  if (listeners.size === 1) {
    detach = attach();
    state = null; // force the CSS variables to be written for the first user
  }
  update();
  return () => {
    listeners.delete(onChange);
    if (listeners.size > 0) return;
    detach?.();
    detach = null;
    detachTelegram?.();
    detachTelegram = null;
    if (frame !== null) {
      try {
        cancelAnimationFrame(frame);
      } catch {
        // Ignore.
      }
      frame = null;
    }
    writeCssVars(null);
    state = null; // the next first render reads fresh sizes
  };
}

function getSnapshot(): VisualViewportState {
  if (!state) state = read();
  return state;
}

function getServerSnapshot(): VisualViewportState {
  return SERVER_STATE;
}

/**
 * Visible viewport height, its top offset and whether the on-screen keyboard
 * is open; keeps `--vv-h` / `--kb-h` on `<html>` while mounted.
 *
 * Server: zeros and `keyboardOpen: false`. jsdom / browsers without
 * `visualViewport`: `innerHeight`, offset 0, keyboard closed (unless the
 * window itself shrank like an Android keyboard resize).
 */
export function useVisualViewport(): VisualViewportState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
