import test from "node:test";
import assert from "node:assert/strict";
import {
  BAR_GAP_PX,
  BUTTON_SIZE_PX,
  DIRECTION_SLOP_PX,
  MIN_SHOW_PX,
  directionOf,
  hideThreshold,
  liftAbove,
  nextVisible,
  showThreshold,
  upShowThreshold,
  type ScrollDirection,
} from "../components/shell/scroll-to-top.ts";

/**
 * «Tepaga chiqish» rules (todo T2, `components/shell/scroll-to-top.ts`): when the
 * button shows, when it hides, and how far it lifts above a bottom bar.
 *
 * Mutations (each turned this file red, see the sprint report):
 *   - `MIN_SHOW_PX` 600 → 300, `SHOW_SCREENS` 1.5 → 1;
 *   - `nextVisible` without the near-top hide (`top < hideThreshold`);
 *   - `nextVisible` without the upward reveal (`dir === "up"` branch);
 *   - `nextVisible` revealing on a downward scroll inside the band;
 *   - `directionOf` without the jitter slop;
 *   - `liftAbove` ignoring the overlap test / the gap / collapsed bars.
 */

test("thresholds: 1.5 screens, never below 600 px; hide at half; up-reveal from one screen", () => {
  assert.equal(MIN_SHOW_PX, 600);
  assert.equal(showThreshold(740), 1110);
  assert.equal(showThreshold(844), 1266);
  assert.equal(showThreshold(768), 1152);
  assert.equal(showThreshold(300), 600, "short window (landscape phone): the 600 px floor");
  assert.equal(showThreshold(400), 600);
  assert.equal(showThreshold(0), 600, "unknown height: the floor");
  assert.equal(showThreshold(Number.NaN), 600);
  assert.equal(hideThreshold(740), 555);
  assert.equal(upShowThreshold(740), 740);
  assert.equal(upShowThreshold(300), 300, "one screen when that is above the hide line");
  assert.ok(upShowThreshold(100) >= hideThreshold(100), "the up-reveal line never sits above the hide line");
  assert.equal(upShowThreshold(0), hideThreshold(0));
});

test("nextVisible: hidden at the top and until 1.5 screens, shown beyond", () => {
  const h = 740;
  const at = (top: number, visible = false, dir: ScrollDirection = "down") => nextVisible({ top, height: h, dir, visible });
  assert.equal(at(0), false);
  assert.equal(at(-50), false, "overscroll bounce");
  assert.equal(at(Number.NaN), false);
  assert.equal(at(599), false);
  assert.equal(at(1109), false, "just below 1.5 screens");
  assert.equal(at(1110), true, "exactly 1.5 screens");
  assert.equal(at(5000), true);
  assert.equal(nextVisible({ top: 700, height: 300, dir: "down", visible: false }), true, "short window: 600 px floor, 700 shows");
  assert.equal(nextVisible({ top: 590, height: 300, dir: "down", visible: false }), false, "590 < 600 floor");
});

test("nextVisible: near the top it hides even when it was shown; the band is hysteresis", () => {
  const h = 740; // show ≥ 1110, hide < 555, up-reveal ≥ 740
  const at = (top: number, visible: boolean, dir: ScrollDirection) => nextVisible({ top, height: h, dir, visible });
  assert.equal(at(554, true, "up"), false, "scrolled back near the top: gone");
  assert.equal(at(100, true, "up"), false);
  assert.equal(at(0, true, "up"), false, "at the top");
  assert.equal(at(555, true, "up"), true, "inside the band: stays shown (no flicker)");
  assert.equal(at(900, true, "down"), true);
  assert.equal(at(900, true, null), true);
  assert.equal(at(900, false, "down"), false, "scrolling DOWN inside the band never reveals it");
  assert.equal(at(900, false, null), false);
});

test("nextVisible: scrolling UP reveals it earlier (from one screen), but not above the up line", () => {
  const h = 740;
  const at = (top: number) => nextVisible({ top, height: h, dir: "up", visible: false });
  assert.equal(at(1000), true, "band, upward: shown");
  assert.equal(at(740), true, "exactly one screen");
  assert.equal(at(739), false, "less than a screen: still hidden");
  assert.equal(at(300), false);
});

test("directionOf: real movement sets the direction, jitter keeps the previous one", () => {
  assert.equal(DIRECTION_SLOP_PX, 4);
  assert.equal(directionOf(1000, 1100, null), "down");
  assert.equal(directionOf(1000, 900, null), "up");
  assert.equal(directionOf(1000, 1003, "up"), "up", "3 px is jitter");
  assert.equal(directionOf(1000, 997, "down"), "down");
  assert.equal(directionOf(1000, 1000, null), null);
  assert.equal(directionOf(1000, 996, "down"), "up", "4 px is a real move");
  assert.equal(directionOf(1000, 1004, "up"), "down");
});

/* ------------------------------------------------------------------ lift */

test("liftAbove: no bars → no lift", () => {
  assert.equal(liftAbove(700, []), 0);
});

test("liftAbove: a sticky submit bar docked at the bottom lifts the button 12 px above its top", () => {
  // Viewport 740, safe area 0 → anchor bottom 724 (16 px up); bar 73 px tall docked at 667..740.
  assert.equal(BAR_GAP_PX, 12);
  assert.equal(liftAbove(724, [{ top: 667, bottom: 740 }]), 724 - (667 - 12));
  assert.equal(724 - liftAbove(724, [{ top: 667, bottom: 740 }]), 667 - 12, "the button's bottom edge ends 12 px above the bar");
});

test("liftAbove: the bar resting at the end of the form (above the 112 px padding) does not lift", () => {
  // Bar 73 px tall whose bottom is 112 px above the bottom edge: 555..628. Button slot: 680..724.
  assert.equal(liftAbove(724, [{ top: 555, bottom: 628 }]), 0);
});

test("liftAbove: a bar in the middle of the screen or below the viewport does not lift", () => {
  assert.equal(liftAbove(724, [{ top: 300, bottom: 373 }]), 0);
  assert.equal(liftAbove(724, [{ top: 900, bottom: 973 }]), 0, "scrolled out below");
});

test("liftAbove: collapsed (not laid out) bars are ignored; the largest lift wins", () => {
  assert.equal(liftAbove(724, [{ top: 0, bottom: 0 }]), 0);
  assert.equal(liftAbove(724, [{ top: 700, bottom: 700 }]), 0);
  const both = liftAbove(724, [
    { top: 680, bottom: 740 },
    { top: 640, bottom: 740 },
  ]);
  assert.equal(both, 724 - (640 - 12));
});

test("liftAbove: a bar that only grazes the slot edge (within the gap) still counts", () => {
  assert.equal(BUTTON_SIZE_PX, 44);
  // Slot is 680..724; a bar ending 8 px above the slot is inside the 12 px gap → lift.
  assert.ok(liftAbove(724, [{ top: 600, bottom: 672 }]) > 0);
  // A bar ending 13 px above the slot is clear.
  assert.equal(liftAbove(724, [{ top: 600, bottom: 667 }]), 0);
});
