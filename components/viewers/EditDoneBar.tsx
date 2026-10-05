"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import type { VisualViewportState } from "@/lib/hooks/useVisualViewport";
import { useOverlayHistory } from "../nav/useOverlayHistory";
import { getOpenField, useOpenField, type OpenField } from "./editable";
import { focusZoomScale, intersect, revealDelta, type Rect } from "./slide-edit/geometry";
import { keepEditorFocus } from "./slide-edit/StyleBar";
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
          paddingBottom: keyboard ? 0 : "env(safe-area-inset-bottom, 0px)",
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
 * field opens on a phone, the viewer zooms in (the slide editor's
 * `focusZoomScale`: a short single-line field until its glyphs reach 14 px,
 * a wrapping field only until it fills the column width, so nobody pans
 * sideways per line); when the edit ends the previous zoom (fit or the
 * user's own) and the scroll positions come back exactly.
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
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useLayoutEffect(() => {
    if (!active || !field) {
      const s = saved.current;
      if (!s) return;
      saved.current = null;
      fnRef.current.restore(s.zoom);
      const back = () => {
        if (s.scroller) s.scroller.scrollTop = s.top;
        if (s.row) s.row.scrollLeft = s.left;
      };
      back();
      // The restored sheet size lands on the next render.
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(back);
      return;
    }
    const next = focusZoomFor(field, zoomRef.current);
    if (next === null) return;
    if (!saved.current) {
      const row = field.el.closest<HTMLElement>("[data-page-row]");
      const scroller = verticalScroller(field.el);
      saved.current = { zoom: zoomRef.current, scroller, top: scroller?.scrollTop ?? 0, row, left: row?.scrollLeft ?? 0 };
    }
    fnRef.current.apply(next);
  }, [active, field]);
}

/** The zoom (percent) a field needs, or `null` when the current one is enough. */
export function focusZoomFor(field: OpenField, zoom: number): number | null {
  const el = field.el;
  const base = zoom / 100;
  if (!(base > 0)) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const fontPx = parseFloat(cs.fontSize) || 0;
  const lineH = parseFloat(cs.lineHeight) || fontPx * 1.3;
  const boxW = r.width / base;
  const boxH = r.height / base;
  const row = el.closest<HTMLElement>("[data-page-row]");
  const viewW = row?.clientWidth || window.innerWidth;
  const s = focusZoomScale({ boxW, boxH, viewW, viewH: 0, base, fontPx, singleLine: lineH > 0 && boxH <= lineH * 1.5 });
  const next = Math.round(s * 100);
  return next > zoom ? next : null;
}

/* ───────────────────────────────────────────────────── one-time hint ─── */

export const DOC_EDIT_HINT_KEY = "slaydx:doc-edit-hint";
export const DOC_EDIT_HINT_TEXT = "Matnni tahrirlash uchun ustiga ikki marta bosing";

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
