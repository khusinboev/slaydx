"use client";

import { useEffect, useState, type RefObject } from "react";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { useVisualViewport } from "@/lib/hooks/useVisualViewport";

/**
 * Tool forms vs the on-screen keyboard (docs/mobile/PLAN.md §5 P3, R5 F4).
 *
 * With the keyboard open a phone shows ~400 px; the 56 px top bar and the
 * 73 px sticky submit bar left ~290 px and a growing textarea ended behind
 * the bar. While a text field inside the form is focused AND the keyboard is
 * open on a touch device, `typing` is true: `ToolChrome` then lets its submit
 * bar fall back into the flow (it stays at the end of the form, nothing moves)
 * and this hook keeps the focused field — for a growing textarea, its last
 * line where the caret is — inside the visible area with `REVEAL_MARGIN_PX`.
 *
 * Desktop (fine pointer) never enters this mode: a docked devtools panel that
 * shrinks the window must not hide the bar.
 */

/** Gap kept between the focused field and the visible area's edges. */
export const REVEAL_MARGIN_PX = 16;

/** Input types that raise the on-screen keyboard (pickers like date/color do not). */
const KEYBOARD_INPUT_TYPES = new Set(["text", "search", "email", "tel", "url", "password", "number"]);

/** A field the user types into: text-like `<input>`, `<textarea>` or contentEditable; not read-only/disabled. */
export function isTextEntry(el: Element | null | undefined): el is HTMLElement {
  if (!el) return false;
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  if (el instanceof view.HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof view.HTMLInputElement) return KEYBOARD_INPUT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
  return el instanceof view.HTMLElement && el.isContentEditable;
}

export type Span = { top: number; bottom: number };

/**
 * Pure: how far to scroll (px, positive = content moves up) so `target` sits
 * inside `view` with `margin` on both sides. A target taller than the room
 * keeps its bottom visible (that is where the caret of a growing textarea is).
 */
export function revealDelta(target: Span, view: Span, margin = REVEAL_MARGIN_PX): number {
  const room = view.bottom - view.top - 2 * margin;
  if (room <= 0) return 0;
  const below = target.bottom + margin - view.bottom;
  if (target.bottom - target.top > room) {
    // Only the bottom can be shown: align it unless it already is in view.
    return below > 0 || target.bottom - margin < view.top ? below : 0;
  }
  if (below > 0) return below;
  const above = target.top - margin - view.top;
  return above < 0 ? above : 0;
}

/** Nearest scrolling ancestor (the app's `#main`), else the document scroller. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  const view = el.ownerDocument.defaultView;
  for (let p = el.parentElement; p && view; p = p.parentElement) {
    const oy = view.getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (el.ownerDocument.scrollingElement as HTMLElement | null) ?? null;
}

/** The part of `scroller` the user actually sees: clipped by the visual viewport (iOS keyboard). */
function visibleSpan(scroller: HTMLElement): Span {
  const doc = scroller.ownerDocument;
  const view = doc.defaultView!;
  const vv = view.visualViewport;
  const vTop = vv ? vv.offsetTop : 0;
  const vBottom = vv ? vv.offsetTop + vv.height : view.innerHeight;
  if (scroller === doc.scrollingElement) return { top: vTop, bottom: vBottom };
  const r = scroller.getBoundingClientRect();
  return { top: Math.max(r.top, vTop), bottom: Math.min(r.bottom, vBottom) };
}

/**
 * Which part of `field` must be visible: the whole field when it fits;
 * for a taller textarea only its last line, and only while the caret is at
 * the end (mid-text editing is left to the browser's own caret reveal).
 */
function targetSpan(field: HTMLElement, view: Span, margin: number): Span | null {
  const r = field.getBoundingClientRect();
  if (r.height <= 0) return null;
  if (r.bottom - r.top <= view.bottom - view.top - 2 * margin) return { top: r.top, bottom: r.bottom };
  const win = field.ownerDocument.defaultView;
  if (!win || !(field instanceof win.HTMLTextAreaElement)) return { top: r.top, bottom: r.bottom };
  if (field.selectionEnd !== field.value.length) return null;
  const line = parseFloat(win.getComputedStyle(field).lineHeight) || 24;
  return { top: r.bottom - line, bottom: r.bottom };
}

/** Scrolls `field` into the visible area (no animation: it runs per keystroke). */
export function revealField(field: HTMLElement, margin = REVEAL_MARGIN_PX): number {
  const scroller = scrollParent(field);
  if (!scroller) return 0;
  const view = visibleSpan(scroller);
  const target = targetSpan(field, view, margin);
  if (!target) return 0;
  const delta = Math.round(revealDelta(target, view, margin));
  if (delta !== 0) scroller.scrollTop += delta;
  return delta;
}

function nextFrame(cb: () => void): () => void {
  if (typeof requestAnimationFrame !== "function") {
    const t = setTimeout(cb, 0);
    return () => clearTimeout(t);
  }
  const id = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(id);
}

/**
 * `typing`: a text field inside `root` has focus while the on-screen keyboard
 * is open on a touch device. While typing, the focused field is revealed when
 * the keyboard opens or resizes, when focus moves, and after every edit (the
 * AutoTextarea grows after React re-renders, hence the next frame).
 */
export function useKeyboardInset(root: RefObject<HTMLElement | null>): { typing: boolean } {
  const coarse = useCoarsePointer();
  const { keyboardOpen, height } = useVisualViewport();
  const [field, setField] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const active = el.ownerDocument.activeElement;
    setField(isTextEntry(active) && el.contains(active) ? active : null);
    const onIn = (e: FocusEvent) => {
      const t = e.target as Element | null;
      setField(isTextEntry(t) ? t : null);
    };
    const onOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Element | null;
      setField(isTextEntry(next) && el.contains(next) ? next : null);
    };
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);
    return () => {
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
    };
  }, [root]);

  const typing = coarse && keyboardOpen && field !== null;

  // `height` re-runs this while the keyboard animates or changes size; the
  // visual viewport's offset is deliberately not a dependency (iOS pans it
  // while the user scrolls — revealing then would fight the finger).
  useEffect(() => {
    if (!typing || !field) return;
    let cancel = nextFrame(() => revealField(field));
    const onInput = () => {
      cancel();
      cancel = nextFrame(() => revealField(field));
    };
    field.addEventListener("input", onInput);
    return () => {
      cancel();
      field.removeEventListener("input", onInput);
    };
  }, [typing, field, height]);

  return { typing };
}
