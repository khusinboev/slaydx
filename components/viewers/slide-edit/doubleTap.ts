/**
 * Pointer-based double-tap detector (PLAN §3 O4, R3 «Gesture»).
 *
 * Synthetic `dblclick` on touch is not guaranteed (iOS WKWebView, Telegram),
 * so the slide editor also listens to pointer events and opens a text on two
 * TAPS that are close in time and place. Only taps count: a finger that moved
 * or stayed down (swipe, scroll, long press) resets the detector, and a second
 * finger (pinch) cancels it — so it never fights the stage's own scrolling.
 *
 * Pure: the caller feeds coordinates and timestamps (`PointerEvent.clientX/Y`,
 * `timeStamp`), the detector answers whether this `up` completed a double tap.
 */

/** Max gap between the first tap's release and the second tap's touch (ms). */
export const DOUBLE_TAP_MS = 300;
/** Max distance between the two taps (px). */
export const DOUBLE_TAP_PX = 24;
/** A tap moves less than this between down and up (px)… */
export const TAP_SLOP_PX = 10;
/** …and is released within this time (ms). */
export const TAP_MAX_MS = 500;

type Point = { x: number; y: number; t: number };

export type DoubleTapDetector = {
  down(id: number, x: number, y: number, t: number): void;
  /** `true` when this release completes a double tap (the detector then resets). */
  up(id: number, x: number, y: number, t: number): boolean;
  /** `pointercancel` (the browser took the gesture for scrolling/zoom). */
  cancel(id?: number): void;
  reset(): void;
};

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export function createDoubleTapDetector(): DoubleTapDetector {
  let active: (Point & { id: number }) | null = null;
  let pressed = 0;
  let lastTap: Point | null = null;
  let pendingSecond = false;

  return {
    down(id, x, y, t) {
      pressed += 1;
      if (pressed > 1) {
        // Second finger: pinch/zoom, not a tap.
        active = null;
        lastTap = null;
        return;
      }
      if (lastTap && (t - lastTap.t > DOUBLE_TAP_MS || dist(lastTap, { x, y }) > DOUBLE_TAP_PX)) lastTap = null;
      pendingSecond = lastTap !== null;
      active = { id, x, y, t };
    },
    up(id, x, y, t) {
      pressed = Math.max(0, pressed - 1);
      const a = active;
      if (!a || a.id !== id) return false;
      active = null;
      const isTap = dist(a, { x, y }) <= TAP_SLOP_PX && t - a.t <= TAP_MAX_MS;
      if (!isTap) {
        lastTap = null;
        return false;
      }
      if (pendingSecond && lastTap && dist(lastTap, { x, y }) <= DOUBLE_TAP_PX) {
        lastTap = null;
        pendingSecond = false;
        return true;
      }
      lastTap = { x, y, t };
      pendingSecond = false;
      return false;
    },
    cancel(id) {
      if (id === undefined || active?.id === id) active = null;
      pressed = Math.max(0, pressed - 1);
      lastTap = null;
    },
    reset() {
      active = null;
      pressed = 0;
      lastTap = null;
      pendingSecond = false;
    },
  };
}
