"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, MoreHorizontal, Plus } from "lucide-react";
import { zoomStep } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";
import { useOverlayHistory } from "../nav/useOverlayHistory";
import type { DocView } from "./reading/prefs";

/** Toolbar balandligi (`h-10`) — sahifa hisoblagichi uning ostidan sanaydi. */
export const VIEWER_TOOLBAR_H = 40;

/**
 * When the right-hand controls fit inline, measured on the TOOLBAR's own
 * width (container query), not the viewport: the result column narrows when
 * the side panel opens. Below the breakpoint they move into «Boshqa amallar».
 * Breakpoints from the measured natural width at 1920 (Chromium, V5a smoke):
 * - `narrow`: undo/redo/«Tahrirlash» (Word viewer). Everything inline ≈ 545 px → from 42rem (672 px).
 * - `wide`: template + palette selects, photo, undo/redo, «Tahrirlash» (resume). ≈ 670 px → from 48rem (768 px).
 * Literal class strings: Tailwind only generates classes it can find in the source.
 */
const RIGHT_INLINE = { narrow: "hidden @2xl:flex", wide: "hidden @3xl:flex" } as const;
const RIGHT_IN_MENU = { narrow: "@2xl:hidden", wide: "@3xl:hidden" } as const;

/**
 * Touch sizes (mobile sprint O5: 44 px on touch; desktop unchanged).
 * - The toolbar row is 44 px high on a coarse pointer.
 * - Row icons (prev/next, «⋯») keep their 28 px look and get a 44×44 hit
 *   area from `.hit-44` (globals.css); their neighbours are text or ≥ 8 px
 *   away, so expanded areas never overlap a neighbouring control.
 * - Controls that also live in the «⋯» panel (zoom) grow for real.
 * `TOUCH_BOX` is exported for the viewers' own `right`/`pinned` buttons.
 */
export const TOUCH_BOX = "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center";

export function ViewerToolbar({
  zoom,
  onZoom,
  page,
  pages,
  onPage,
  onFit,
  onFullscreen,
  extra,
  right,
  rightWidth = "narrow",
  pinned,
  view,
  onView,
  sticky = false,
}: {
  zoom: number;
  onZoom: (n: number) => void;
  page: number;
  pages: number;
  onPage: (n: number) => void;
  onFit?: () => void;
  onFullscreen?: () => void;
  extra?: ReactNode;
  /**
   * O'ng chekkadagi boshqaruvlar (rezyume: shablon, rang, rasm, undo/redo,
   * «Tahrirlash»). `extra` dan ALOHIDA: `extra` maket chiplari uchun
   * o'rtadan boshlanadi, `right` esa har doim eng o'ngda turadi.
   * Berilmasa hech narsa chizilmaydi — mavjud chaqiruvchilar o'zgarmaydi.
   * V5a: toolbar tor bo'lsa (`rightWidth`) ular «Boshqa amallar» menyusiga
   * ko'chadi — panel hech qachon yon tomonga aylanmaydi.
   */
  right?: ReactNode;
  /** How much room `right` needs inline (see `RIGHT_INLINE`). */
  rightWidth?: keyof typeof RIGHT_INLINE;
  /**
   * Controls that stay in the row at EVERY width, never in «⋯» (phones:
   * «Tahrirlash», mobile sprint E). Rendered before `right`, in both view
   * modes. Omitted = nothing changes for existing callers.
   */
  pinned?: ReactNode;
  /**
   * «O‘qish / Varaq» toggle (V5a). Omitted (resume) = no toggle. In
   * «O‘qish» the zoom controls are gone (text reflows) and the counter
   * shows the FILE page of the text in view.
   */
  view?: DocView;
  onView?: (v: DocView) => void;
  /**
   * Sahifa scroll'ida natija sarlavhasi ostiga yopishadi (viewer redesign
   * V1: `flow` ko'ruvchilar — Word, rezyume). `z-10` — sarlavhadan
   * (`z-20`) PASTDA. Standart `false`: slayd `fill` ramkada o'z sahnasini
   * boshqaradi va sahifaga yopishmaydi — mavjud chaqiruvchilar o'zgarmaydi.
   */
  sticky?: boolean;
}) {
  /*
   * Qo'shni zina JORIY qiymatdan: «sig'dirish» endi zinada bo'lmagan
   * qiymat berishi mumkin (telefonda 46 %) — ilgari `indexOf` -1 qaytarib,
   * «−» 50 % ga (ya'ni KATTAROQ) sakrardi.
   */
  const dec = () => onZoom(zoomStep(zoom, -1));
  const inc = () => onZoom(zoomStep(zoom, 1));
  const reading = view === "reading";
  const hasZoom = !reading;
  const btn = "hover:bg-white/10 rounded p-1.5";
  const navBtn = cn(btn, "hit-44");
  const zoomBtn = cn(btn, TOUCH_BOX);

  const zoomControls = (
    <>
      <button type="button" className={zoomBtn} onClick={dec} aria-label="Kichraytirish">
        <Minus className="size-4" />
      </button>
      <button type="button" className={cn("hover:bg-white/10 min-w-12 rounded px-1 py-1 tabular-nums", TOUCH_BOX)} onClick={onFit} title="Ustun eniga sig‘dirish">
        {zoom}%
      </button>
      <button type="button" className={zoomBtn} onClick={inc} aria-label="Kattalashtirish">
        <Plus className="size-4" />
      </button>
      {onFullscreen ? (
        <button type="button" className={cn(zoomBtn, "ml-1")} onClick={onFullscreen} aria-label="To‘liq ekran">
          <Maximize2 className="size-4" />
        </button>
      ) : null}
    </>
  );

  /* The «⋯» trigger shows below the widest breakpoint any collapsed group needs. */
  const moreClass = right ? RIGHT_IN_MENU[rightWidth] : hasZoom ? "@lg:hidden" : null;

  return (
    <div
      data-viewer-toolbar={sticky ? "sticky" : undefined}
      className={cn(
        "no-print @container bg-[#3b3b3b] text-[#f3f3f3] flex h-10 shrink-0 items-center gap-1 px-2 text-[13px] pointer-coarse:h-11",
        sticky && "sticky top-[var(--result-header-h,0px)] z-10",
      )}
    >
      <button type="button" className={cn(navBtn, "disabled:opacity-30")} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Oldingi sahifa">
        <ChevronLeft className="size-4" />
      </button>
      <span
        data-page-counter
        className="min-w-12 shrink-0 text-center tabular-nums @md:min-w-16"
        title={reading ? "Fayldagi sahifa" : undefined}
      >
        {page} / {Math.max(1, pages)}
      </span>
      <button type="button" className={cn(navBtn, "disabled:opacity-30")} onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Keyingi sahifa">
        <ChevronRight className="size-4" />
      </button>
      {view && onView ? (
        <>
          <span className="mx-1 h-4 w-px shrink-0 bg-white/20 @md:mx-2" aria-hidden="true" />
          <ViewToggle view={view} onView={onView} />
        </>
      ) : null}
      {hasZoom ? (
        <div data-zoom-inline className="hidden shrink-0 items-center gap-1 @lg:flex">
          <span className="mx-2 h-4 w-px bg-white/20" aria-hidden="true" />
          {zoomControls}
        </div>
      ) : null}
      {/* Mobil ekranda maket chiplari + tugmalar sig'masa gorizontal aylantiriladi (kesilmaydi). */}
      {extra ? <div className="ml-auto flex max-w-full items-center gap-2 overflow-x-auto">{extra}</div> : null}
      {pinned ? (
        <div data-toolbar-pinned className={cn("flex shrink-0 items-center gap-1.5", extra ? "ml-2" : "ml-auto")}>
          {pinned}
        </div>
      ) : null}
      {right ? (
        <div data-toolbar-right className={cn("min-w-0 items-center gap-1.5", RIGHT_INLINE[rightWidth], extra || pinned ? "ml-2" : "ml-auto")}>
          {right}
        </div>
      ) : null}
      {moreClass ? (
        // After `pinned` the trigger keeps 8 px so its expanded hit area never overlaps it.
        <MoreMenu className={cn(moreClass, pinned ? "ml-2" : !extra && "ml-auto")}>
          {hasZoom ? (
            <div data-more-zoom className="flex items-center gap-1 @lg:hidden">
              <span className="mr-auto px-1 text-xs text-white/60">Masshtab</span>
              {zoomControls}
            </div>
          ) : null}
          {right ? (
            <div data-more-right className={cn("flex flex-wrap items-center gap-1.5", RIGHT_IN_MENU[rightWidth])}>
              {right}
            </div>
          ) : null}
        </MoreMenu>
      ) : null}
    </div>
  );
}

/**
 * «O‘qish / Varaq» segmented toggle. Two pressed-state buttons: the current
 * mode is announced, and either mode is one tap away.
 */
function ViewToggle({ view, onView }: { view: DocView; onView: (v: DocView) => void }) {
  const seg = (on: boolean) =>
    cn("hit-44 rounded-[3px] px-2 py-0.5 text-[12px] leading-5", on ? "bg-white text-[#2b2b2b] font-medium" : "text-white/80 hover:bg-white/10");
  return (
    <div role="group" aria-label="Ko‘rinish" data-view-toggle data-view-mode={view} className="flex shrink-0 rounded bg-black/30 p-0.5">
      <button
        type="button"
        aria-pressed={view === "reading"}
        title="Matn ekran eniga moslashadi"
        className={seg(view === "reading")}
        onClick={() => onView("reading")}
      >
        O‘qish
      </button>
      <button
        type="button"
        aria-pressed={view === "page"}
        title="Faylning aniq A4 varag‘i — tahrir va chop etish shu yerda"
        className={seg(view === "page")}
        onClick={() => onView("page")}
      >
        Varaq
      </button>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * «⋯ Boshqa amallar» popover — the SlideToolbar `OverflowMenu` pattern
 * (viewer redesign V2): on open the first control gets focus, ↑/↓ move
 * between controls, Escape closes and returns focus to the trigger, a tap
 * outside closes. The panel is rendered only while open, so the inline
 * controls are never duplicated in the closed DOM. Not `role=menu`: it
 * holds selects and toggle buttons, not menu items.
 */
function MoreMenu({ className, children }: { className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Its own history entry: the phone's back (and Telegram's) closes the menu, not the page.
  const close = useCallback(() => setOpen(false), []);
  useOverlayHistory(open, close);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const controls = useCallback(
    () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        // Skip controls hidden by a container query (wide toolbar).
        (el) => !el.closest("[hidden]") && (typeof el.checkVisibility !== "function" || el.checkVisibility()),
      ),
    [],
  );

  useEffect(() => {
    if (!open) return;
    controls()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    // The trigger got hidden by a breakpoint (rotation, wider window): close, so
    // no invisible menu is left holding a history entry for the next back press.
    const onResize = () => {
      const t = triggerRef.current;
      if (t && t.isConnected && t.getClientRects().length === 0) setOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, controls]);

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        data-viewer-more
        aria-label="Boshqa amallar"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={cn("hit-44 hover:bg-white/10 rounded p-1.5", open && "bg-white/15")}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="group"
          aria-label="Boshqa amallar"
          data-viewer-more-panel
          className="absolute top-full right-0 z-30 mt-1 flex w-max max-w-[min(22rem,calc(100vw-1rem))] flex-col gap-1.5 rounded-md border border-white/10 bg-[#2b2b2b] p-1.5 text-[13px] text-white/90 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
              return;
            }
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            // A focused <select> uses the arrows itself.
            if ((e.target as HTMLElement).tagName === "SELECT") return;
            e.preventDefault();
            const list = controls();
            if (!list.length) return;
            const at = list.indexOf(document.activeElement as HTMLElement);
            const next = e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
            list[next]?.focus();
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
