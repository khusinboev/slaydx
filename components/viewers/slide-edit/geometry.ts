/**
 * Pure geometry for slide text editing (docs/mobile/R3-mobile-editing.md,
 * PLAN §3 O4). No DOM access here: every rule is a function of numbers, so the
 * placement, the phone focus zoom and the keep-visible scroll are unit-tested
 * without a browser.
 */

export type Rect = { left: number; top: number; width: number; height: number };

/* ─────────────────────────────── desktop floating panel ─── */

/** Gap between the edited box and the floating panel (px). */
export const PANEL_GAP = 4;
/** The panel never gets wider than this (px, one row of controls at 11 px text). */
export const PANEL_MAX_W = 640;
/** Share of the frame width the panel may use (`max-w-[min(640px,95%)]`). */
export const PANEL_FRAME_SHARE = 0.95;

export type PanelPlacement = { left: number; top: number; side: "above" | "below" | "inside" };

/**
 * Where the desktop floating style panel goes, from its MEASURED height.
 *
 * The old rule (`top - 34`) assumed a single 34 px row; at narrow widths the
 * panel wraps to 2–4 rows and its bottom landed inside the edited text
 * (R3 §2.1). Rule:
 *  - above the box when `box.top - gap - panelH >= 0`;
 *  - else below it when it fits inside the frame;
 *  - else inside the frame, pinned to its bottom edge.
 * `left` is clamped so the panel always has `min(640, 95 % of frame)` px of
 * room to its right — a box near the right edge no longer squeezes the
 * panel into a tall column.
 *
 * All values are in overlay px (already multiplied by the stage scale).
 */
export function placeFloatingPanel(input: { box: Rect; panelH: number; frameW: number; frameH: number }): PanelPlacement {
  const { box, frameW, frameH } = input;
  const panelH = Math.max(0, input.panelH);
  const room = Math.min(PANEL_MAX_W, frameW * PANEL_FRAME_SHARE);
  const left = Math.round(Math.max(0, Math.min(box.left, frameW - room)));
  const above = box.top - PANEL_GAP - panelH;
  if (above >= 0) return { left, top: Math.round(above), side: "above" };
  const below = box.top + box.height + PANEL_GAP;
  if (below + panelH <= frameH) return { left, top: Math.round(below), side: "below" };
  return { left, top: Math.round(Math.max(0, frameH - panelH)), side: "inside" };
}

/* ─────────────────────────────────── phone focus zoom ─── */

/** Below this share of the stage width the edited box is "too small to edit" on a phone. */
export const FOCUS_MIN_SHARE = 0.6;
/** Focus zoom aims the box at this share of the stage width. */
export const FOCUS_TARGET_SHARE = 0.9;
/** Never zoom further than this (the toolbar's own maximum is 200 %). */
export const FOCUS_MAX_SCALE = 2;

/**
 * Phone focus zoom: the stage scale while a text box is edited.
 *
 * `box` is in slide px (unscaled), `viewW`/`viewH` the stage's inner size in
 * screen px, `base` the scale the user had. Returns `base` when the box is
 * already at least 60 % of the stage width (or when zooming would not help);
 * otherwise a scale that makes the box ~90 % of the stage width, capped so
 * the whole box still fits the visible stage height and at 200 %. Never
 * returns less than `base` (no zooming out under the user's finger).
 */
export function focusZoomScale(input: { boxW: number; boxH: number; viewW: number; viewH: number; base: number }): number {
  const { boxW, boxH, viewW, viewH, base } = input;
  if (!(boxW > 0) || !(viewW > 0) || !(base > 0)) return base;
  if (boxW * base >= FOCUS_MIN_SHARE * viewW) return base;
  let s = (FOCUS_TARGET_SHARE * viewW) / boxW;
  if (viewH > 0 && boxH > 0) s = Math.min(s, (0.9 * viewH) / boxH);
  s = Math.min(s, FOCUS_MAX_SCALE);
  if (s <= base) return base;
  return Math.round(s * 1000) / 1000;
}

/* ────────────────────────────────── keep box visible ─── */

/** Breathing room kept between the revealed box and the visible edge (px). */
export const REVEAL_MARGIN = 8;

/**
 * How far a scroll container must scroll (`dx`, `dy`; positive = content moves
 * up/left) so that `target` is inside `view` ("nearest" semantics, like
 * `scrollIntoView({block:"nearest", inline:"nearest"})`, but against an
 * arbitrary visible rectangle — the stage clipped by the visual viewport,
 * which `scrollIntoView` does not know about when the iOS keyboard is open).
 *
 * A target larger than the view is aligned to its start (top/left), so the
 * beginning of the text stays readable. Both rects are in client px.
 */
export function revealDelta(target: Rect, view: Rect, margin = REVEAL_MARGIN): { dx: number; dy: number } {
  return { dx: axis(target.left, target.width, view.left, view.width, margin), dy: axis(target.top, target.height, view.top, view.height, margin) };
}

function axis(start: number, size: number, vStart: number, vSize: number, margin: number): number {
  if (vSize <= 0) return 0;
  const m = Math.min(margin, vSize / 4);
  const end = start + size;
  const vEnd = vStart + vSize;
  if (size > vSize - 2 * m) return Math.round(start - (vStart + m));
  if (start < vStart + m) return Math.round(start - (vStart + m));
  if (end > vEnd - m) return Math.round(end - (vEnd - m));
  return 0;
}

/** Intersection of two rects (`null` when empty). */
export function intersect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}
