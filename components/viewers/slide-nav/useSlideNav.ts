"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { CLICK_SWALLOW_MS, createNavGesture, isPageZoomed, stepOf } from "./gesture";

/**
 * Touch navigation of the enlarged («To‘liq ekran») stage — tap zones and
 * swipes. The returned handlers go on the stage element (`SlideStage`).
 *
 * Touch/pen only: a finger is classified from its `pointerdown`…`pointerup`
 * (`gesture.ts`) and moves the slide by `step`. A MOUSE keeps the old
 * behaviour — a click anywhere advances (PowerPoint style; going back there
 * is the arrow keys or the visible ‹ › buttons). A touch release is followed
 * by the browser's compat `click`; it is ignored for `CLICK_SWALLOW_MS`, or
 * every tap would move twice.
 *
 * While the user has pinch-zoomed the page (`zoomed`) to read small text,
 * drags are theirs to PAN with: navigation gestures are off and the stage
 * gives the touch back to the browser (`touch-action: auto`, see `SlideStage`).
 *
 * Disabled (`enabled: false`, i.e. everywhere but the enlarged mode) the
 * handlers do nothing at all — the inline viewer's text-edit gestures
 * (double tap, focus zoom) and its zoom/pan never see this code.
 */
export function useSlideNav({ enabled, step }: { enabled: boolean; step?: (dir: -1 | 1) => void }) {
  const gesture = useMemo(() => createNavGesture(), []);
  const swallowUntil = useRef(0);
  const stepRef = useRef(step);
  stepRef.current = step;
  const [zoomed, setZoomed] = useState(false);

  // Leaving / entering the mode drops any half-seen gesture.
  useEffect(() => {
    gesture.reset();
    swallowUntil.current = 0;
  }, [enabled, gesture]);

  // Pinch zoom of the page: `visualViewport.scale` > 1 (it stays 1 under browser zoom and without a visual viewport).
  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!enabled || !vv) {
      setZoomed(false);
      return;
    }
    const read = () => {
      const z = isPageZoomed(vv.scale);
      setZoomed(z);
      if (z) gesture.reset();
    };
    read();
    vv.addEventListener("resize", read);
    return () => vv.removeEventListener("resize", read);
  }, [enabled, gesture]);

  const touchy = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";
  const live = enabled && !zoomed;

  return {
    zoomed: enabled && zoomed,
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (!live || !touchy(e)) return;
      gesture.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (!live || !touchy(e)) return;
      gesture.move(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      if (!enabled || !touchy(e)) return;
      const r = e.currentTarget.getBoundingClientRect();
      const intent = gesture.up(e.pointerId, e.clientX, e.clientY, e.timeStamp, { left: r.left, width: r.width });
      // Every touch release — navigating or not — owns the click that may follow it.
      swallowUntil.current = e.timeStamp + CLICK_SWALLOW_MS;
      const by = live ? stepOf(intent) : 0;
      if (by !== 0) stepRef.current?.(by);
    },
    onPointerCancel(e: PointerEvent<HTMLElement>) {
      if (!enabled || !touchy(e)) return;
      gesture.cancel(e.pointerId);
    },
    onClick(e: MouseEvent<HTMLElement>) {
      if (!enabled) return;
      if (e.timeStamp < swallowUntil.current) return;
      stepRef.current?.(1);
    },
  };
}
