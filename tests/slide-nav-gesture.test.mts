import test from "node:test";
import assert from "node:assert/strict";
import {
  CLICK_SWALLOW_MS,
  NAV_ZONE_FRACTION,
  SWIPE_DOMINANCE,
  SWIPE_MAX_MS,
  SWIPE_MIN_PX,
  classifyRelease,
  createNavGesture,
  stepOf,
  zoneOf,
  type NavBox,
} from "../components/viewers/slide-nav/gesture.ts";
import { TAP_MAX_MS, TAP_SLOP_PX } from "../components/viewers/slide-edit/doubleTap.ts";

/**
 * Enlarged-mode slide navigation (T1, todo sprint 2026-10-07): tap zones and
 * swipes as PURE functions. Owner report: on a phone a tap on the right went
 * to the next slide, but the left tap / a swipe back did not go to the previous
 * one (`SlideStage` advanced on ANY click and had no swipe at all).
 */

const BOX: NavBox = { left: 0, width: 390 };
const pt = (x: number, y: number, t: number) => ({ x, y, t });

// ═══════════════════════════════════════ zones
test("zoneOf: left third → prev, right third → next, middle → mid (thirds of the stage, not of the screen)", () => {
  assert.equal(NAV_ZONE_FRACTION, 1 / 3);
  assert.equal(zoneOf(0, BOX), "prev");
  assert.equal(zoneOf(129, BOX), "prev", "just inside the left third (130 = 390/3)");
  assert.equal(zoneOf(131, BOX), "mid");
  assert.equal(zoneOf(195, BOX), "mid");
  assert.equal(zoneOf(259, BOX), "mid", "just before the right third (260 = 2·390/3)");
  assert.equal(zoneOf(261, BOX), "next");
  assert.equal(zoneOf(390, BOX), "next");
  // The stage may be narrower / shifted (presenter panel): zones follow ITS rect.
  const shifted: NavBox = { left: 100, width: 300 };
  assert.equal(zoneOf(150, shifted), "prev");
  assert.equal(zoneOf(250, shifted), "mid");
  assert.equal(zoneOf(350, shifted), "next");
  assert.equal(zoneOf(50, { left: 100, width: 300 }), "prev", "outside the rect to the left is still the left edge");
  assert.equal(zoneOf(10, { left: 0, width: 0 }), "mid", "an unmeasured stage never navigates by zone");
});

// ═══════════════════════════════════════ classification
test("classifyRelease: a quick, still tap reports the zone it started in", () => {
  assert.deepEqual(classifyRelease(pt(40, 400, 0), pt(40, 400, 80), BOX), { kind: "tap", zone: "prev" });
  assert.deepEqual(classifyRelease(pt(195, 400, 0), pt(195, 400, 80), BOX), { kind: "tap", zone: "mid" });
  assert.deepEqual(classifyRelease(pt(350, 400, 0), pt(350, 400, 80), BOX), { kind: "tap", zone: "next" });
  // Finger jitter within the shared tap slop is still a tap.
  assert.deepEqual(classifyRelease(pt(40, 400, 0), pt(40 + TAP_SLOP_PX, 400, 90), BOX), { kind: "tap", zone: "prev" });
});

test("classifyRelease: a long press is neither a tap nor a swipe", () => {
  assert.deepEqual(classifyRelease(pt(40, 400, 0), pt(40, 400, TAP_MAX_MS), BOX), { kind: "tap", zone: "prev" }, "exactly the limit is still a tap");
  assert.equal(classifyRelease(pt(40, 400, 0), pt(40, 400, TAP_MAX_MS + 1), BOX), null);
});

test("classifyRelease: a swipe to the right goes to the previous slide, to the left to the next", () => {
  assert.deepEqual(classifyRelease(pt(100, 400, 0), pt(220, 410, 150), BOX), { kind: "swipe", dir: "prev" });
  assert.deepEqual(classifyRelease(pt(300, 400, 0), pt(180, 390, 150), BOX), { kind: "swipe", dir: "next" });
  // The start zone is irrelevant for a swipe (a left-edge swipe LEFT still goes next).
  assert.deepEqual(classifyRelease(pt(20, 400, 0), pt(-30, 400, 120), BOX), { kind: "swipe", dir: "next" });
});

test("classifyRelease: the swipe threshold is SWIPE_MIN_PX horizontally", () => {
  assert.equal(SWIPE_MIN_PX, 40);
  assert.deepEqual(classifyRelease(pt(100, 400, 0), pt(100 + SWIPE_MIN_PX, 400, 100), BOX), { kind: "swipe", dir: "prev" });
  assert.equal(classifyRelease(pt(100, 400, 0), pt(100 + SWIPE_MIN_PX - 1, 400, 100), BOX), null, "39 px is between a tap and a swipe: ignored");
  assert.equal(classifyRelease(pt(100, 400, 0), pt(100 - (SWIPE_MIN_PX - 1), 400, 100), BOX), null);
});

test("classifyRelease: a mostly vertical drag (page scroll) never navigates", () => {
  assert.equal(SWIPE_DOMINANCE, 1.5);
  assert.equal(classifyRelease(pt(100, 300, 0), pt(150, 500, 200), BOX), null, "50 px across but 200 px down");
  assert.equal(classifyRelease(pt(100, 300, 0), pt(100, 600, 200), BOX), null, "purely vertical");
  // Exactly 1.5 × is still a swipe; just under it is not.
  assert.deepEqual(classifyRelease(pt(100, 300, 0), pt(190, 360, 200), BOX), { kind: "swipe", dir: "prev" }, "90 across, 60 down = 1.5×");
  assert.equal(classifyRelease(pt(100, 300, 0), pt(190, 361, 200), BOX), null, "90 across, 61 down < 1.5×");
});

test("classifyRelease: a slow drag is not a swipe", () => {
  assert.deepEqual(classifyRelease(pt(100, 400, 0), pt(220, 400, SWIPE_MAX_MS), BOX), { kind: "swipe", dir: "prev" });
  assert.equal(classifyRelease(pt(100, 400, 0), pt(220, 400, SWIPE_MAX_MS + 1), BOX), null);
});

test("classifyRelease: a finger that wandered off and came back is not a tap (travel)", () => {
  assert.equal(classifyRelease(pt(40, 400, 0), pt(42, 400, 100), BOX, 80), null);
  assert.deepEqual(classifyRelease(pt(40, 400, 0), pt(42, 400, 100), BOX, 3), { kind: "tap", zone: "prev" });
});

test("stepOf: tap prev → -1, tap mid/next → +1 (today's advance), swipe by direction, nothing → 0", () => {
  assert.equal(stepOf({ kind: "tap", zone: "prev" }), -1);
  assert.equal(stepOf({ kind: "tap", zone: "mid" }), 1);
  assert.equal(stepOf({ kind: "tap", zone: "next" }), 1);
  assert.equal(stepOf({ kind: "swipe", dir: "prev" }), -1);
  assert.equal(stepOf({ kind: "swipe", dir: "next" }), 1);
  assert.equal(stepOf(null), 0);
  assert.ok(CLICK_SWALLOW_MS > 300 && CLICK_SWALLOW_MS < 2000, "the compat click window covers the click, not the next tap");
});

// ═══════════════════════════════════════ tracker
test("tracker: down → move → up reports a swipe; a lone tap reports a tap", () => {
  const g = createNavGesture();
  g.down(1, 300, 400, 0);
  g.move(1, 250, 402, 40);
  g.move(1, 190, 405, 80);
  assert.deepEqual(g.up(1, 180, 405, 120, BOX), { kind: "swipe", dir: "next" });
  g.down(2, 30, 400, 1000);
  assert.deepEqual(g.up(2, 30, 400, 1060, BOX), { kind: "tap", zone: "prev" });
});

test("tracker: a second finger (pinch / two-finger scroll) cancels the whole gesture, even after one finger lifts", () => {
  const g = createNavGesture();
  g.down(1, 100, 400, 0);
  g.down(2, 300, 400, 10);
  g.move(1, 20, 400, 60);
  g.move(2, 380, 400, 60);
  assert.equal(g.up(2, 380, 400, 100, BOX), null);
  assert.equal(g.up(1, 20, 400, 110, BOX), null, "the remaining finger is not a swipe either");
  // Both are up: the next single finger works again.
  g.down(3, 30, 400, 1000);
  assert.deepEqual(g.up(3, 30, 400, 1050, BOX), { kind: "tap", zone: "prev" });
});

test("tracker: pointercancel (the browser took the gesture) reports nothing and does not poison the next one", () => {
  const g = createNavGesture();
  g.down(1, 100, 400, 0);
  g.move(1, 160, 400, 40);
  g.cancel(1);
  assert.equal(g.up(1, 220, 400, 100, BOX), null);
  g.down(2, 100, 400, 500);
  assert.deepEqual(g.up(2, 220, 400, 600, BOX), { kind: "swipe", dir: "prev" });
});

test("tracker: a release for an unknown pointer id is ignored", () => {
  const g = createNavGesture();
  g.down(1, 100, 400, 0);
  assert.equal(g.up(9, 220, 400, 100, BOX), null);
});

test("tracker: a finger whose release never arrived does not block later gestures", () => {
  const g = createNavGesture();
  g.down(1, 100, 400, 0); // never released (lost event)
  g.down(2, 30, 400, 10_000); // long after
  assert.deepEqual(g.up(2, 30, 400, 10_050, BOX), { kind: "tap", zone: "prev" });
});

test("tracker: reset drops a gesture in progress", () => {
  const g = createNavGesture();
  g.down(1, 100, 400, 0);
  g.reset();
  assert.equal(g.up(1, 220, 400, 100, BOX), null);
  g.down(2, 100, 400, 200);
  assert.deepEqual(g.up(2, 220, 400, 300, BOX), { kind: "swipe", dir: "prev" });
});
