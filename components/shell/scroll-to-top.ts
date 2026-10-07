/**
 * Pure rules behind the «Tepaga chiqish» button (`ScrollToTop.tsx`, todo T2).
 * No DOM and no React here, so the thresholds and the lift are locked by plain
 * unit tests (`tests/scroll-to-top.test.mts`).
 *
 * Visibility
 *   - the button appears once the page is scrolled `SHOW_SCREENS` (1.5) screens
 *     down, but never before `MIN_SHOW_PX` (600 px): `showThreshold`;
 *   - it is hidden near the top, `hideThreshold` (half of the show threshold):
 *     the gap between the two is hysteresis, so it does not flicker at the edge;
 *   - while the user scrolls UP it appears earlier, from `upShowThreshold`
 *     (one screen): somebody heading back up is the one who wants the button;
 *   - scrolling DOWN inside the gap never reveals it.
 */

/** The button never shows before the page is scrolled this far, however small the window. */
export const MIN_SHOW_PX = 600;
/** Scrolled this many viewport heights down → the button shows. */
export const SHOW_SCREENS = 1.5;
/** Movement below this is jitter (touch bounce, sub-pixel), not a change of direction. */
export const DIRECTION_SLOP_PX = 4;
/** Gap between the button and a bottom bar it must clear. */
export const BAR_GAP_PX = 12;
/** The button is 44 px (the touch target of docs/mobile/PLAN.md O5). */
export const BUTTON_SIZE_PX = 44;

export type ScrollDirection = "up" | "down" | null;

function screenHeight(viewportH: number): number {
  return Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 0;
}

/** Scroll depth (px) from which the button always shows. */
export function showThreshold(viewportH: number): number {
  return Math.max(MIN_SHOW_PX, Math.round(screenHeight(viewportH) * SHOW_SCREENS));
}

/** Above this depth (towards the top) the button is always hidden. */
export function hideThreshold(viewportH: number): number {
  return Math.round(showThreshold(viewportH) / 2);
}

/** Depth from which scrolling UP already reveals the button (never above `hideThreshold`). */
export function upShowThreshold(viewportH: number): number {
  return Math.max(hideThreshold(viewportH), Math.round(screenHeight(viewportH)));
}

/** Direction of the last real movement; jitter keeps the previous direction. */
export function directionOf(prevTop: number, top: number, prev: ScrollDirection): ScrollDirection {
  const d = top - prevTop;
  if (d <= -DIRECTION_SLOP_PX) return "up";
  if (d >= DIRECTION_SLOP_PX) return "down";
  return prev;
}

export type VisibilityInput = {
  /** `scrollTop` of the scroll container. */
  top: number;
  /** Visible height of the scroll container (`clientHeight`). */
  height: number;
  dir: ScrollDirection;
  visible: boolean;
};

/** Next visibility of the button. */
export function nextVisible({ top, height, dir, visible }: VisibilityInput): boolean {
  if (!(top > 0)) return false;
  if (top < hideThreshold(height)) return false;
  if (top >= showThreshold(height)) return true;
  // In the hysteresis band: only an upward scroll can reveal it, nothing hides it.
  if (!visible && dir === "up" && top >= upShowThreshold(height)) return true;
  return visible;
}

export type Band = { top: number; bottom: number };

/**
 * How many px the button must move UP to clear the bottom bars.
 *
 * `anchorBottom` is where the button would sit without any bar (its bottom edge,
 * viewport coordinates). A bar matters only when it overlaps the button's slot
 * (the 44 px above `anchorBottom`, plus `BAR_GAP_PX` on both sides): a sticky
 * submit bar docked at the bottom does, the same bar resting at the end of a
 * form (above the 112 px bottom padding) does not, a static bar in the middle
 * of the screen does not. The button then sits `BAR_GAP_PX` above the bar.
 */
export function liftAbove(anchorBottom: number, bars: readonly Band[]): number {
  const slotTop = anchorBottom - BUTTON_SIZE_PX;
  let lift = 0;
  for (const b of bars) {
    if (!(b.bottom > b.top)) continue; // collapsed or not laid out
    const overlaps = b.top < anchorBottom + BAR_GAP_PX && b.bottom > slotTop - BAR_GAP_PX;
    if (!overlaps) continue;
    lift = Math.max(lift, anchorBottom - (b.top - BAR_GAP_PX));
  }
  return Math.max(0, Math.round(lift));
}
