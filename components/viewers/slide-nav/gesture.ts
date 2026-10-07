/**
 * Slide navigation gestures for the enlarged («To‘liq ekran») mode — pure,
 * DOM-free, unit-tested (`tests/slide-nav-gesture.test.mts`).
 *
 * Owner report (todo sprint 2026-10-07, T1): on a phone a tap on the right
 * went to the next slide, but nothing went back — a tap on the LEFT also went
 * forward and a swipe did nothing. The contract here:
 *
 *  - a TAP in the left third → previous; right third → next; the middle third
 *    keeps the old behaviour (advance), so the whole screen is "next" except
 *    the left edge — the usual story/slideshow convention;
 *  - a horizontal SWIPE (finger moves right → previous, left → next) of at
 *    least `SWIPE_MIN_PX`, mostly horizontal (`SWIPE_DOMINANCE`), not slower
 *    than `SWIPE_MAX_MS`;
 *  - everything else is ignored: a vertical scroll, a drag shorter than a
 *    swipe but longer than a tap, a long press, and any gesture in which a
 *    second finger touched down (pinch / two-finger scroll).
 *
 * The tracker is fed by the caller (`PointerEvent.clientX/Y`, `timeStamp`),
 * exactly like `slide-edit/doubleTap.ts` — whose tap definition (slop and
 * duration) it shares, so a "tap" means the same thing for both gestures.
 */
import { TAP_MAX_MS, TAP_SLOP_PX } from "../slide-edit/doubleTap";

/** Share of the stage width that counts as the left (previous) / right (next) tap zone. */
export const NAV_ZONE_FRACTION = 1 / 3;
/** A swipe moves at least this far horizontally (px). */
export const SWIPE_MIN_PX = 40;
/** …and its horizontal travel is at least this many times its vertical travel (≈ ±34° of horizontal). */
export const SWIPE_DOMINANCE = 1.5;
/** …and takes no longer than this (ms) — a slow drag is not a flick. */
export const SWIPE_MAX_MS = 1000;
/** After a touch release the browser's compat `click` is ignored for this long (ms). */
export const CLICK_SWALLOW_MS = 800;
/** A finger that never reported its release is forgotten after this long (ms). */
const STALE_MS = 2000;

export type NavDir = "prev" | "next";
export type NavZone = NavDir | "mid";
export type NavIntent = { kind: "tap"; zone: NavZone } | { kind: "swipe"; dir: NavDir };

type Point = { x: number; y: number; t: number };
/** The stage rectangle the zones are measured against. */
export type NavBox = { left: number; width: number };

/** Which third of the stage a horizontal coordinate falls in (`mid` when the box has no width). */
export function zoneOf(x: number, box: NavBox): NavZone {
  if (!(box.width > 0)) return "mid";
  const rel = (x - box.left) / box.width;
  if (rel < NAV_ZONE_FRACTION) return "prev";
  if (rel > 1 - NAV_ZONE_FRACTION) return "next";
  return "mid";
}

/**
 * Classifies one finished single-finger gesture. `travel` is the farthest the
 * finger ever got from where it went down (a scribble that ends where it
 * began is not a tap).
 */
export function classifyRelease(start: Point, end: Point, box: NavBox, travel = 0): NavIntent | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dt = end.t - start.t;
  const far = Math.max(travel, Math.hypot(dx, dy));
  if (far <= TAP_SLOP_PX) {
    if (dt > TAP_MAX_MS) return null;
    return { kind: "tap", zone: zoneOf(start.x, box) };
  }
  if (dt > SWIPE_MAX_MS) return null;
  const adx = Math.abs(dx);
  if (adx < SWIPE_MIN_PX || adx < SWIPE_DOMINANCE * Math.abs(dy)) return null;
  return { kind: "swipe", dir: dx > 0 ? "prev" : "next" };
}

/**
 * Slide step for an intent: `-1` previous, `+1` next, `0` nothing. The middle
 * third of a tap advances (today's behaviour of the enlarged mode).
 */
export function stepOf(intent: NavIntent | null): -1 | 0 | 1 {
  if (!intent) return 0;
  if (intent.kind === "swipe") return intent.dir === "prev" ? -1 : 1;
  return intent.zone === "prev" ? -1 : 1;
}

export type NavGesture = {
  down(id: number, x: number, y: number, t: number): void;
  move(id: number, x: number, y: number, t: number): void;
  /** The recognised gesture when this release ends a clean single-finger one, else `null`. */
  up(id: number, x: number, y: number, t: number, box: NavBox): NavIntent | null;
  /** `pointercancel`: the browser took the gesture (scroll, pinch). */
  cancel(id?: number): void;
  reset(): void;
};

export function createNavGesture(): NavGesture {
  let active: (Point & { id: number; travel: number }) | null = null;
  let pressed = 0;
  let lastT = 0;

  const seen = (t: number) => {
    // A release that never arrived must not leave a phantom finger that blocks every later gesture.
    if (pressed > 0 && t - lastT > STALE_MS) {
      pressed = 0;
      active = null;
    }
    lastT = t;
  };

  return {
    down(id, x, y, t) {
      seen(t);
      pressed += 1;
      if (pressed > 1) {
        // A second finger: pinch / two-finger scroll, never a navigation.
        active = null;
        return;
      }
      active = { id, x, y, t, travel: 0 };
    },
    move(id, x, y, t) {
      if (pressed > 0) lastT = Math.max(lastT, t);
      if (active && active.id === id) {
        active.travel = Math.max(active.travel, Math.hypot(x - active.x, y - active.y));
      }
    },
    up(id, x, y, t, box) {
      seen(t);
      pressed = Math.max(0, pressed - 1);
      const a = active;
      if (!a || a.id !== id) return null;
      active = null;
      return classifyRelease(a, { x, y, t }, box, a.travel);
    },
    cancel(id) {
      if (id === undefined || active?.id === id) active = null;
      pressed = Math.max(0, pressed - 1);
    },
    reset() {
      active = null;
      pressed = 0;
      lastT = 0;
    },
  };
}
