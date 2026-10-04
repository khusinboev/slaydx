"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useVisualViewport, type VisualViewportState } from "@/lib/hooks/useVisualViewport";
import { intersect, revealDelta, type Rect } from "./geometry";

/**
 * Keyboard-aware helpers for phone slide editing (R3 «Keyboard handling»).
 *
 * `VisualViewportWatch` is a leaf component: it is mounted ONLY while a text
 * is edited on a phone, so the `visualViewport` listeners (and the `--vv-h` /
 * `--kb-h` variables) exist only then, and a keyboard/scroll event re-renders
 * this null leaf instead of the slide viewer.
 */
export function VisualViewportWatch({ onChange }: { onChange: (vv: VisualViewportState) => void }) {
  const vv = useVisualViewport();
  const ref = useRef(onChange);
  useLayoutEffect(() => {
    ref.current = onChange;
  });
  useEffect(() => {
    ref.current(vv);
  }, [vv]);
  return null;
}

/** The visible band of the page in client coordinates (visual viewport). */
export function visibleBand(vv: Pick<VisualViewportState, "height" | "offsetTop">): Rect {
  const w = typeof window === "undefined" ? 0 : window.innerWidth;
  const h = vv.height > 0 ? vv.height : typeof window === "undefined" ? 0 : window.innerHeight;
  return { left: 0, top: vv.offsetTop, width: w, height: h };
}

function toRect(r: DOMRect | { left: number; top: number; width: number; height: number }): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** Caret rectangle inside `field` (collapsed selection), or `null`. */
function caretRect(field: HTMLElement): Rect | null {
  try {
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!field.contains(range.endContainer)) return null;
    const r = range.getBoundingClientRect?.();
    if (!r || (r.width === 0 && r.height === 0 && r.left === 0 && r.top === 0)) return null;
    return { left: r.left - 1, top: r.top, width: Math.max(2, r.width), height: Math.max(r.height, 1) };
  } catch {
    return null;
  }
}

/**
 * Scrolls the slide stage so the edited box is inside the part of the stage
 * that is actually visible (the stage clipped by the visual viewport, i.e.
 * above the on-screen keyboard). When the box is taller than that part, the
 * caret line is revealed instead. Returns the applied delta (tests, smoke).
 *
 * Only the stage scrolls (`overflow-auto` while editing on a phone): the
 * page, the result header and the style bar stay where they are.
 */
export function scrollEditBoxIntoView(
  box: HTMLElement,
  vv: Pick<VisualViewportState, "height" | "offsetTop">,
  field?: HTMLElement | null,
): { dx: number; dy: number } {
  const stage = box.closest<HTMLElement>("[data-slide-stage]");
  if (!stage) return { dx: 0, dy: 0 };
  const view = intersect(toRect(stage.getBoundingClientRect()), visibleBand(vv));
  if (!view) return { dx: 0, dy: 0 };
  const b = toRect(box.getBoundingClientRect());
  let target = b;
  if (b.height > view.height || b.width > view.width) {
    const c = field ? caretRect(field) : null;
    if (c) target = { left: b.width > view.width ? c.left : b.left, top: b.height > view.height ? c.top : b.top, width: b.width > view.width ? c.width : b.width, height: b.height > view.height ? c.height : b.height };
  }
  const d = revealDelta(target, view);
  if (d.dx) stage.scrollLeft += d.dx;
  if (d.dy) stage.scrollTop += d.dy;
  return d;
}
