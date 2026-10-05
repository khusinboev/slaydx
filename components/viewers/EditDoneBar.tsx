"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import type { VisualViewportState } from "@/lib/hooks/useVisualViewport";
import { useOverlayHistory } from "../nav/useOverlayHistory";
import { getOpenField, useOpenField, type OpenField } from "./editable";
import { FOCUS_MAX_SCALE, FOCUS_MIN_GLYPH, REVEAL_MARGIN, intersect, revealDelta, type Rect } from "./slide-edit/geometry";
import { keepEditorFocus } from "./slide-edit/StyleBar";
import { DOUBLE_TAP_MS } from "./slide-edit/doubleTap";
import { EDIT_HINT_TEXT } from "./slide-edit/EditHint";
import { VisualViewportWatch, visibleBand } from "./slide-edit/viewport";

/**
 * Phone end-of-edit layer for the document editors — Word/article/teacher
 * (`ArticleEditor`) and resume (`ResumeEditor`) — docs/mobile/PLAN.md lead
 * decision, R3 «Contract» → `EditDoneBar`, work package E.
 *
 * Phones have no Esc and Enter is easy to miss, so while a contentEditable
 * field is open on a coarse pointer / < 768 px window a 44 px «Bekor / Tayyor»
 * bar sits right above the on-screen keyboard (`bottom: var(--kb-h)` from
 * `useVisualViewport`, mounted only while it shows). It ends the edit
 * through the SAME `commit`/`cancel` the editor's Enter/Esc run
 * (`editable.ts` open-field slot), never takes the focus (iOS would close
 * the keyboard and `focusout` would commit before «Bekor»), and keeps the
 * edited field visible between the sticky viewer toolbar and the bar.
 *
 * Phone back (and Telegram's BackButton) while editing commits and stays on
 * the page — the slide editor's rule (docs/nav/PLAN.md decision 1:
 * auto-save, then leave); the entry is popped when the edit ends any other
 * way, so no stale history entry is left behind. Desktop: nothing renders
 * and no history entry is pushed.
 *
 * `revealKey`: anything that moves the field without a viewport event (the
 * viewer's zoom) — the field is revealed again after it changes.
 */
export function EditDoneBar({ revealKey }: { revealKey?: unknown }) {
  const coarse = useCoarsePointer();
  const field = useOpenField();
  const show = coarse && field !== null;
  const commitOpen = useCallback(() => getOpenField()?.commit(), []);
  useOverlayHistory(show, commitOpen);

  const barRef = useRef<HTMLDivElement>(null);
  const vvRef = useRef<Pick<VisualViewportState, "height" | "offsetTop">>({ height: 0, offsetTop: 0 });
  const [keyboard, setKeyboard] = useState(false);
  const rafRef = useRef<number | null>(null);

  const revealSoon = useCallback(() => {
    if (rafRef.current !== null || typeof requestAnimationFrame !== "function") return;
    // After layout: the bar, the zoom and the keyboard land in the next frame.
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const f = getOpenField();
      if (f) revealOpenField(f.el, vvRef.current, barRef.current);
    });
  }, []);
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );
  useEffect(() => {
    if (show) revealSoon();
  }, [show, field, revealKey, revealSoon]);
  const onViewport = useCallback(
    (vv: VisualViewportState) => {
      vvRef.current = vv;
      setKeyboard(vv.keyboardOpen);
      revealSoon();
    },
    [revealSoon],
  );

  if (!show || !field) return null;
  return (
    <>
      <VisualViewportWatch onChange={onViewport} />
      {/* In-flow spacer: the last lines of the document can still scroll above the fixed bar. */}
      <div aria-hidden data-edit-done-spacer className="no-print h-11 shrink-0" />
      <div
        ref={barRef}
        data-edit-done-bar
        role="toolbar"
        aria-label="Tahrirni yakunlash"
        className="no-print fixed inset-x-0 z-30 flex items-center justify-between gap-2 border-t border-white/10 bg-[#2b2b2b] px-2 text-[14px] text-white shadow-[0_-4px_12px_rgba(0,0,0,0.25)] select-none"
        style={{
          bottom: "var(--kb-h, 0px)",
          // Above the keyboard the home-indicator inset is covered anyway.
          paddingBottom: keyboard ? 0 : "var(--tg-safe-bottom, env(safe-area-inset-bottom, 0px))",
        }}
        onPointerDown={keepEditorFocus}
        onMouseDown={keepEditorFocus}
      >
        <button
          type="button"
          data-edit-cancel
          className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-md px-3 text-white/85 hover:bg-white/10"
          onClick={() => field.cancel()}
        >
          <X className="size-4" aria-hidden />
          Bekor
        </button>
        <button
          type="button"
          data-edit-done
          className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-md bg-sky-600 px-4 font-semibold text-white hover:bg-sky-500"
          onClick={() => field.commit()}
        >
          <Check className="size-4" aria-hidden />
          Tayyor
        </button>
      </div>
    </>
  );
}

/* ───────────────────────────────────────────── keep the field visible ─── */

/** Nearest ancestor that scrolls vertically (the result page's `<main>`), else the document. */
function verticalScroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
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

function rectOf(r: DOMRect): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * The part of the screen where an edited field is actually visible: the
 * visual viewport (above the keyboard), below the sticky viewer toolbar
 * (which already sits under the sticky result header) and above the bar.
 */
export function editViewBand(
  vv: Pick<VisualViewportState, "height" | "offsetTop">,
  chrome: { toolbarBottom: number | null; barTop: number | null },
): Rect {
  const band = visibleBand(vv);
  const top = Math.max(band.top, chrome.toolbarBottom ?? band.top);
  const bottom = Math.min(band.top + band.height, chrome.barTop ?? band.top + band.height);
  return { left: band.left, top, width: band.width, height: Math.max(0, bottom - top) };
}

/**
 * Scrolls the page (vertically) and the zoomed sheet row (horizontally) so
 * the open field — or its caret line when the field is taller than the
 * band — is inside `editViewBand`. Returns the applied delta (tests, smoke).
 */
export function revealOpenField(
  el: HTMLElement,
  vv: Pick<VisualViewportState, "height" | "offsetTop">,
  bar: HTMLElement | null,
): { dx: number; dy: number } {
  if (!el.isConnected) return { dx: 0, dy: 0 };
  const toolbar = document.querySelector<HTMLElement>("[data-viewer-toolbar='sticky']");
  const view = editViewBand(vv, {
    toolbarBottom: toolbar ? toolbar.getBoundingClientRect().bottom : null,
    barTop: bar ? bar.getBoundingClientRect().top : null,
  });
  if (view.height <= 0) return { dx: 0, dy: 0 };
  const box = rectOf(el.getBoundingClientRect());
  let target = box;
  if (box.height > view.height || box.width > view.width) {
    const c = caretRect(el);
    if (c) {
      target = {
        left: box.width > view.width ? c.left : box.left,
        top: box.height > view.height ? c.top : box.top,
        width: box.width > view.width ? c.width : box.width,
        height: box.height > view.height ? c.height : box.height,
      };
    }
  }
  let dx = 0;
  // Horizontal: only a zoomed sheet row scrolls sideways (`PageRow` `wide`).
  const row = el.closest<HTMLElement>("[data-page-row]");
  if (row && row.scrollWidth > row.clientWidth + 1) {
    const rowView = intersect(rectOf(row.getBoundingClientRect()), { ...view, top: -1e6, height: 2e6 });
    if (rowView) {
      dx = revealDelta(target, rowView).dx;
      if (dx) row.scrollLeft += dx;
    }
  }
  const dy = revealDelta(target, view).dy;
  if (dy) {
    const sc = verticalScroller(el);
    if (sc) sc.scrollTop += dy;
  }
  return { dx, dy };
}

/* ───────────────────────────────────────────────── phone focus zoom ─── */

/**
 * Temporary «focus zoom» for the paged document viewers on phones.
 *
 * A sheet fitted to a 360–390 px screen is ~43–46 %: resume body text is
 * 5–6 px and a lesson-plan line ~8 px — unreadable while typing. When a
 * field opens on a phone, the viewer zooms in (`docFocusZoom`: until the
 * glyphs reach the slide editor's 14 px, but never wider than the column,
 * so nobody pans sideways per line); when the edit
 * ends the previous zoom (fit or the user's own) and the scroll positions
 * come back exactly.
 *
 * Chosen over a resume «O‘qish» reflow mode: it edits the SAME sheet node
 * in place (WYSIWYG, no second renderer to keep in parity with the DOCX),
 * reuses the viewer's own zoom, and needs no new edit mapping.
 */
export function useEditFocusZoom(opts: {
  /** Phone and edit mode on. */
  active: boolean;
  /** Current zoom in percent. */
  zoom: number;
  /** Apply a zoom (percent). */
  apply: (zoom: number) => void;
  /** End of the edit: bring the zoom from before back (`prev` in percent). */
  restore: (prev: number) => void;
}) {
  const { active, zoom } = opts;
  const field = useOpenField();
  const fnRef = useRef(opts);
  useLayoutEffect(() => {
    fnRef.current = opts;
  });
  const saved = useRef<{ zoom: number; scroller: HTMLElement | null; top: number; row: HTMLElement | null; left: number } | null>(null);
  /** The zoom this hook applied last: a different current zoom means the user zoomed by hand while editing. */
  const applied = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pending = useRef<{ timer: ReturnType<typeof setTimeout> | null; detach: () => void } | null>(null);

  const cancelPending = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    if (p.timer !== null) clearTimeout(p.timer);
    p.detach();
  }, []);

  const restoreNow = useCallback(() => {
    cancelPending();
    const s = saved.current;
    saved.current = null;
    const mine = applied.current;
    applied.current = null;
    // Review E2: a «−/+» during the edit is the user's new choice — keep it (and its scroll).
    if (!s || (mine !== null && zoomRef.current !== mine)) return;
    fnRef.current.restore(s.zoom);
    const back = () => {
      if (s.scroller) s.scroller.scrollTop = s.top;
      if (s.row) s.row.scrollLeft = s.left;
    };
    back();
    // The restored sheet size lands on the next render.
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(back);
  }, [cancelPending]);

  /*
   * Review E1: a field closes on the FIRST tap of a double tap on the next
   * field (its compat mousedown blurs and commits the open one). Restoring
   * the zoom right then shrinks the sheet under the finger and the second
   * tap misses. So the restore waits until the finger has been quiet for
   * `DOUBLE_TAP_MS` (every `pointerdown` pauses it, every `pointerup`
   * restarts it); a field that opens meanwhile keeps the zoom.
   */
  const scheduleRestore = useCallback(() => {
    if (pending.current) return;
    const p: { timer: ReturnType<typeof setTimeout> | null; detach: () => void } = { timer: null, detach: () => {} };
    const arm = () => {
      if (p.timer !== null) clearTimeout(p.timer);
      p.timer = setTimeout(() => {
        if (!getOpenField()) restoreNow();
        else cancelPending();
      }, DOUBLE_TAP_MS);
    };
    const onDown = () => {
      if (p.timer !== null) clearTimeout(p.timer);
      p.timer = null;
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", arm, true);
    document.addEventListener("pointercancel", arm, true);
    p.detach = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", arm, true);
      document.removeEventListener("pointercancel", arm, true);
    };
    pending.current = p;
    arm();
  }, [restoreNow, cancelPending]);

  useLayoutEffect(() => {
    if (!active) {
      // Edit mode off: nothing can reopen — restore at once.
      restoreNow();
      return;
    }
    if (!field) {
      if (saved.current) scheduleRestore();
      return;
    }
    cancelPending();
    const next = focusZoomFor(field, zoomRef.current);
    if (next === null) return;
    if (!saved.current) {
      const row = field.el.closest<HTMLElement>("[data-page-row]");
      const scroller = verticalScroller(field.el);
      saved.current = { zoom: zoomRef.current, scroller, top: scroller?.scrollTop ?? 0, row, left: row?.scrollLeft ?? 0 };
    }
    applied.current = next;
    fnRef.current.apply(next);
  }, [active, field, restoreNow, scheduleRestore, cancelPending]);

  // Unmount (viewer gone): drop the listeners; there is no sheet left to restore.
  useEffect(() => cancelPending, [cancelPending]);
}

/**
 * Pure: the sheet scale while a field is edited. `fontPx`, `boxW` in sheet
 * px (unscaled), `viewW` the column width on screen, `base` the current
 * scale. Glyphs grow to `FOCUS_MIN_GLYPH` px, but the field box never
 * grows wider than the column: a block field (paragraph, caption, heading)
 * is as wide as the sheet's text column even while it holds one line, and
 * text typed into it wraps at that width — wider than the screen would
 * mean panning sideways per line (smoke: a caption at 75 % ran 100 px off
 * a 390 px screen). An inline field (resume name, chip) is only as wide as
 * its text, so it still reaches 14 px glyphs. At most `FOCUS_MAX_SCALE`;
 * never below `base`.
 * Unlike slides there is no "small box" rule: a short resume chip must not
 * blow the sheet up to 200 % just because it is narrow.
 */
export function docFocusZoom(input: { fontPx: number; boxW: number; viewW: number; base: number }): number {
  const { fontPx, boxW, viewW, base } = input;
  if (!(fontPx > 0) || !(base > 0) || fontPx * base >= FOCUS_MIN_GLYPH) return base;
  let s = FOCUS_MIN_GLYPH / fontPx;
  if (boxW > 0 && viewW > 0) s = Math.min(s, viewW / boxW);
  s = Math.min(s, FOCUS_MAX_SCALE);
  return s > base ? Math.round(s * 1000) / 1000 : base;
}

/** The zoom (percent) a field needs, or `null` when the current one is enough. */
export function focusZoomFor(field: OpenField, zoom: number): number | null {
  const el = field.el;
  const base = zoom / 100;
  if (!(base > 0)) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  // Computed font size is the sheet's own (the zoom is a transform), box width is on screen.
  const fontPx = parseFloat(cs.fontSize) || 0;
  const boxW = r.width / base;
  const row = el.closest<HTMLElement>("[data-page-row]");
  // Minus the keep-visible margins on both sides, so the revealed field is not clipped by the row edge.
  const viewW = Math.max(0, (row?.clientWidth || window.innerWidth) - 2 * REVEAL_MARGIN);
  const s = docFocusZoom({ fontPx, boxW, viewW, base });
  const next = Math.round(s * 100);
  return next > zoom ? next : null;
}

/* ───────────────────────────────────────────────────── one-time hint ─── */

export const DOC_EDIT_HINT_KEY = "slaydx:doc-edit-hint";
/** Same words as the slide editor's hint (one gesture, one sentence). */
export const DOC_EDIT_HINT_TEXT = EDIT_HINT_TEXT;

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(DOC_EDIT_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    window.localStorage.setItem(DOC_EDIT_HINT_KEY, "1");
  } catch {
    // Storage unavailable: hidden for this page only.
  }
}

/**
 * One-time touch hint (the slide editor's rule, PLAN §3 O4): shown while
 * edit mode is on and nothing was opened yet, until dismissed or until the
 * first field opens. Text, not a `title=` tooltip (invisible on touch).
 */
export function useDocEditHint(enabled: boolean): { show: boolean; dismiss: () => void } {
  const [seen, setSeen] = useState(readSeen);
  const field = useOpenField();
  const dismiss = useCallback(() => {
    writeSeen();
    setSeen(true);
  }, []);
  useEffect(() => {
    if (enabled && field && !seen) dismiss();
  }, [enabled, field, seen, dismiss]);
  return { show: enabled && !seen && !field, dismiss };
}

export function DocEditHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      data-doc-edit-hint
      role="note"
      className="no-print flex min-h-11 shrink-0 items-center gap-2 bg-[#252525] pl-3 text-[13px] text-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
    >
      <Pencil className="size-4 shrink-0 text-sky-300" aria-hidden />
      <span className="min-w-0 flex-1">{DOC_EDIT_HINT_TEXT}</span>
      <button
        type="button"
        aria-label="Maslahatni yopish"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-white/60 hover:bg-white/10"
        onClick={onDismiss}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
