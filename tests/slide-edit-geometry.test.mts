import test from "node:test";
import assert from "node:assert/strict";
import {
  FOCUS_MAX_SCALE,
  FOCUS_MIN_SHARE,
  PANEL_GAP,
  focusZoomScale,
  intersect,
  placeFloatingPanel,
  revealDelta,
} from "../components/viewers/slide-edit/geometry.ts";
import { TAP_MAX_MS, TAP_SLOP_PX, createDoubleTapDetector } from "../components/viewers/slide-edit/doubleTap.ts";

/**
 * Slide text editing on phones (docs/mobile/PLAN.md §3 O4, R3 S1/S2) — the
 * pure rules: desktop panel placement from its MEASURED height, the phone
 * focus zoom, the keep-visible scroll delta and the double-tap detector.
 *
 * Mutations (each caught here, see the package D report):
 *   - placement back to `top - 34` (assumed one-row height) → "two-row panel" fails;
 *   - no left clamp → "right-hand box" fails;
 *   - focus zoom without the 60 % threshold / without the height cap → zoom tests fail;
 *   - double-tap window 300 → 3000 ms or distance check removed → detector tests fail.
 */

// ════════════════════════════════════════ placeFloatingPanel

test("panel goes ABOVE the box when its measured height fits", () => {
  const p = placeFloatingPanel({ box: { left: 100, top: 200, width: 300, height: 60 }, panelH: 53, frameW: 1000, frameH: 560 });
  assert.equal(p.side, "above");
  assert.equal(p.top, 200 - PANEL_GAP - 53);
  assert.ok(p.top + 53 <= 200, "panel bottom never inside the box");
});

test("two-row panel (53 px) over a box 40 px from the top flips BELOW — the old `top - 34` rule overlapped", () => {
  const box = { left: 20, top: 40, width: 300, height: 57 };
  const p = placeFloatingPanel({ box, panelH: 53, frameW: 390, frameH: 219 });
  assert.equal(p.side, "below");
  assert.equal(p.top, 40 + 57 + PANEL_GAP);
  // No vertical overlap with the edited box at all.
  assert.ok(p.top >= box.top + box.height || p.top + 53 <= box.top);
});

test("no room above or below → inside the frame, pinned to its bottom edge", () => {
  const p = placeFloatingPanel({ box: { left: 0, top: 30, width: 300, height: 180 }, panelH: 77, frameW: 390, frameH: 219 });
  assert.equal(p.side, "inside");
  assert.equal(p.top, 219 - 77);
});

test("right-hand box: left is clamped so the panel keeps min(640, 95 %) px of room (no tall squeezed column)", () => {
  const frameW = 1000;
  const p = placeFloatingPanel({ box: { left: 700, top: 300, width: 250, height: 40 }, panelH: 28, frameW, frameH: 560 });
  assert.equal(p.left, frameW - 640);
  const narrow = placeFloatingPanel({ box: { left: 300, top: 300, width: 60, height: 40 }, panelH: 28, frameW: 390, frameH: 219 });
  assert.ok(390 - narrow.left >= Math.floor(390 * 0.95), "room ≥ 95 % of a narrow frame");
  const leftBox = placeFloatingPanel({ box: { left: 40, top: 300, width: 60, height: 40 }, panelH: 28, frameW, frameH: 560 });
  assert.equal(leftBox.left, 40, "a box with room keeps its own left edge");
});

// ════════════════════════════════════════ focusZoomScale

test("focus zoom: a small box (footer/title at phone fit) zooms to ~90 % of the stage width", () => {
  const base = 0.282;
  const s = focusZoomScale({ boxW: 600, boxH: 40, viewW: 374, viewH: 600, base });
  assert.ok(s > base);
  assert.ok(600 * s >= FOCUS_MIN_SHARE * 374, "box ≥ 60 % of the stage width");
  assert.ok(Math.abs(600 * s - 0.9 * 374) < 1, "aims at 90 %");
});

test("focus zoom: a box already ≥ 60 % of the stage stays at the user's scale", () => {
  assert.equal(focusZoomScale({ boxW: 1100, boxH: 300, viewW: 374, viewH: 600, base: 0.282 }), 0.282);
});

test("focus zoom: capped so the whole box fits the visible stage height, and at 200 %", () => {
  const tall = focusZoomScale({ boxW: 400, boxH: 500, viewW: 374, viewH: 300, base: 0.2 });
  assert.ok(500 * tall <= 0.9 * 300 + 0.5, "box height ≤ 90 % of the visible height");
  const tiny = focusZoomScale({ boxW: 60, boxH: 20, viewW: 374, viewH: 600, base: 0.282 });
  assert.equal(tiny, FOCUS_MAX_SCALE);
});

test("focus zoom never zooms OUT below the user's scale and tolerates zero sizes", () => {
  assert.equal(focusZoomScale({ boxW: 400, boxH: 700, viewW: 374, viewH: 100, base: 0.3 }), 0.3);
  assert.equal(focusZoomScale({ boxW: 0, boxH: 0, viewW: 374, viewH: 100, base: 0.3 }), 0.3);
  assert.equal(focusZoomScale({ boxW: 300, boxH: 30, viewW: 0, viewH: 0, base: 0.5 }), 0.5);
});

test("focus zoom (glyphs): a wide single-line footer with 4 px glyphs zooms to readable text, wider than the stage", () => {
  // Footer 1014 slide px wide, 10 pt (13.3 px) text at phone fit 0.282 → 3.8 px glyphs.
  const s = focusZoomScale({ boxW: 1014, boxH: 23, viewW: 374, viewH: 600, base: 0.282, fontPx: 13.3, singleLine: true });
  assert.ok(13.3 * s >= 14 - 0.05, `glyphs ≥ 14 px (got ${(13.3 * s).toFixed(1)})`);
  assert.ok(1014 * s > 374, "a single-line field may run past the stage (the caret is followed)");
});

test("focus zoom (glyphs): a wrapping list grows its text but never past the stage width", () => {
  const s = focusZoomScale({ boxW: 1032, boxH: 418, viewW: 374, viewH: 600, base: 0.282, fontPx: 26.7, singleLine: false });
  assert.ok(s > 0.282, "zoomed for readability");
  assert.ok(1032 * s <= 374 + 0.5, "no sideways panning per line");
  const big = focusZoomScale({ boxW: 1032, boxH: 418, viewW: 374, viewH: 600, base: 0.282, fontPx: 64, singleLine: false });
  assert.equal(big, 0.282, "large text and a wide box: nothing to do");
});

// ════════════════════════════════════════ revealDelta

const view = { left: 0, top: 100, width: 390, height: 200 }; // visible stage band 100..300

test("reveal: a box inside the view needs no scroll", () => {
  assert.deepEqual(revealDelta({ left: 20, top: 150, width: 200, height: 50 }, view), { dx: 0, dy: 0 });
});

test("reveal: a box under the keyboard scrolls up just enough (nearest), with the margin", () => {
  const d = revealDelta({ left: 20, top: 320, width: 200, height: 50 }, view, 8);
  assert.equal(d.dy, 320 + 50 - (300 - 8));
  assert.equal(d.dx, 0);
});

test("reveal: a box above / left of the view scrolls back; a box taller than the view aligns its top", () => {
  assert.equal(revealDelta({ left: 20, top: 60, width: 100, height: 30 }, view, 8).dy, 60 - 108);
  assert.equal(revealDelta({ left: -150, top: 150, width: 100, height: 30 }, view, 8).dx, -150 - 8);
  assert.equal(revealDelta({ left: 0, top: 400, width: 100, height: 500 }, view, 8).dy, 400 - 108);
});

test("intersect: overlap rect or null", () => {
  assert.deepEqual(intersect({ left: 0, top: 0, width: 100, height: 100 }, { left: 50, top: 50, width: 100, height: 100 }), {
    left: 50,
    top: 50,
    width: 50,
    height: 50,
  });
  assert.ok(!intersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 20, width: 5, height: 5 }));
});

// ════════════════════════════════════════ double tap

// The contract (PLAN §5 row D, R3): two taps < 300 ms and < 24 px apart. Literals on
// purpose — a test reading the module constants would follow a broken window.
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;

function tap(d: ReturnType<typeof createDoubleTapDetector>, x: number, y: number, t: number, id = 1, hold = 40, move = 0) {
  d.down(id, x, y, t);
  return d.up(id, x + move, y, t + hold);
}

test("two quick taps on the same spot → double tap (only the second release reports it)", () => {
  const d = createDoubleTapDetector();
  assert.equal(tap(d, 100, 100, 0), false);
  assert.equal(tap(d, 104, 102, 40 + DOUBLE_TAP_MS - 10), true);
  // Reset after a hit: a third tap starts a new pair.
  assert.equal(tap(d, 104, 102, 600), false);
});

test("taps too far apart in TIME are two single taps", () => {
  const d = createDoubleTapDetector();
  tap(d, 100, 100, 0);
  assert.equal(tap(d, 100, 100, 40 + DOUBLE_TAP_MS + 20), false);
});

test("taps too far apart in SPACE are two single taps", () => {
  const d = createDoubleTapDetector();
  tap(d, 100, 100, 0);
  assert.equal(tap(d, 100 + DOUBLE_TAP_PX + 6, 100, 120), false);
});

test("a swipe (moved finger) or a long press is not a tap and breaks the pair", () => {
  const d = createDoubleTapDetector();
  tap(d, 100, 100, 0);
  assert.equal(tap(d, 100, 100, 100, 1, 40, TAP_SLOP_PX + 20), false, "second contact moved: scroll, not a tap");
  assert.equal(tap(d, 100, 100, 200), false, "the pair was broken by the swipe");
  const e = createDoubleTapDetector();
  tap(e, 100, 100, 0);
  assert.equal(tap(e, 100, 100, 100, 1, TAP_MAX_MS + 50), false, "long press");
});

test("pointercancel (browser took the gesture) and a second finger (pinch) reset the detector", () => {
  const d = createDoubleTapDetector();
  tap(d, 100, 100, 0);
  d.down(1, 100, 100, 100);
  d.cancel(1);
  assert.equal(tap(d, 100, 100, 160), false, "cancelled pair");
  const p = createDoubleTapDetector();
  tap(p, 100, 100, 0);
  p.down(1, 100, 100, 100);
  p.down(2, 200, 100, 110);
  assert.equal(p.up(1, 100, 100, 150), false, "pinch is not a tap");
  p.up(2, 200, 100, 150);
});
