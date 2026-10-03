"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2, MoreHorizontal, Minus, Plus, ScanLine, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOverlayHistory } from "../nav/useOverlayHistory";

/** Slayd o'chirish tugmasi tavsifi (`null` — tahrir yo'q). */
export type SlideToolbarDelete = { armed: boolean; disabled: boolean; title: string; onClick: () => void };

/**
 * Slayd asboblar paneli (viewer redesign V2).
 *
 * Nega `ViewerToolbar` emas: u masshtabni `ZOOM_STEPS` ro'yxatidan oladi va
 * «moslash» holatini bilmaydi, shuning uchun slaydda yorliq 75 % da qotib
 * qolardi (haqiqiy masshtab esa 26 %). Bu yerda yorliq HAQIQIY foiz
 * (`pct`), «Moslash» esa alohida yoqiq/o'chiq tugma (`aria-pressed`).
 *
 * Sahifa navigatsiyasi shu yerda YAGONA (pastki qatorda takrorlanmaydi).
 *
 * Mobil (`< md`): ikkilamchi amallar (slaydni o'chirish, shablon nomi,
 * eski format ogohlantirishi) «Boshqa amallar» menyusiga yig'iladi —
 * panel hech qachon gorizontal siljimaydi/kesilmaydi.
 */
export function SlideToolbar({
  page,
  pages,
  onPage,
  pct,
  fitOn,
  canDec,
  canInc,
  onDec,
  onInc,
  onFit,
  onPresent,
  del,
  legacy = false,
  info,
}: {
  page: number;
  pages: number;
  onPage: (n: number) => void;
  /** Haqiqiy ko'rsatilayotgan masshtab, foizda (moslashda — o'lchangan). */
  pct: number;
  /** «Moslash» yoqiqmi (yorliq shu holda o'lchangan foiz). */
  fitOn: boolean;
  canDec: boolean;
  canInc: boolean;
  onDec: () => void;
  onInc: () => void;
  onFit: () => void;
  /** Berilmasa (jonli generatsiya) to'liq ekran tugmasi chizilmaydi. */
  onPresent?: () => void;
  /** Slayd o'chirish (ikki bosishda). `null` — tahrir yo'q. */
  del: SlideToolbarDelete | null;
  /** Eski format — tahrirlab bo'lmaydi. */
  legacy?: boolean;
  /** Shablon · mavzu nomi. */
  info?: ReactNode;
}) {
  const btn = "hover:bg-white/10 rounded p-1.5 disabled:opacity-30";

  return (
    <div
      data-slide-toolbar
      className="no-print relative z-10 flex h-10 shrink-0 items-center gap-1 bg-[#3b3b3b] px-2 text-[13px] text-[#f3f3f3]"
    >
      {/* ── Sahifa navigatsiyasi (yagona) ── */}
      <button type="button" className={btn} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Oldingi sahifa">
        <ChevronLeft className="size-4" />
      </button>
      <span data-slide-page className="min-w-12 text-center tabular-nums sm:min-w-16">
        {page} / {Math.max(1, pages)}
      </span>
      <button type="button" className={btn} onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Keyingi sahifa">
        <ChevronRight className="size-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-white/20 sm:mx-2" aria-hidden="true" />

      {/* ── Masshtab: − 43 % + [Moslash] ── */}
      <button type="button" className={btn} onClick={onDec} disabled={!canDec} aria-label="Kichraytirish">
        <Minus className="size-4" />
      </button>
      <span data-zoom-label data-zoom-mode={fitOn ? "fit" : "manual"} className="min-w-10 text-center tabular-nums">
        {pct}%
      </span>
      <button type="button" className={btn} onClick={onInc} disabled={!canInc} aria-label="Kattalashtirish">
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        data-zoom-fit
        aria-pressed={fitOn}
        aria-label="Moslash"
        title={fitOn ? "Moslash yoqiq — slayd oynaga sig‘adi" : "Oynaga moslash"}
        onClick={onFit}
        className={cn(
          "ml-0.5 inline-flex items-center gap-1 rounded p-1.5 sm:px-2 sm:py-1",
          fitOn ? "bg-white/20 text-white" : "hover:bg-white/10",
        )}
      >
        <ScanLine className="size-4" />
        <span className="hidden sm:inline">Moslash</span>
      </button>

      {onPresent ? (
        <button type="button" className={cn(btn, "ml-0.5")} onClick={onPresent} aria-label="To‘liq ekran">
          <Maximize2 className="size-4" />
        </button>
      ) : null}

      {/* ── O'ng chet: kengda inline, mobilda menyu ── */}
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {legacy ? (
          <span className="hidden text-xs text-white/40 md:inline">Bu deka eski formatda — tahrirlab bo‘lmaydi</span>
        ) : null}
        {del ? (
          <button
            type="button"
            title={del.title}
            disabled={del.disabled}
            className={cn(
              "hidden items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-40 md:inline-flex",
              del.armed ? "bg-red-500/80 text-white" : "hover:bg-white/10",
            )}
            onClick={del.onClick}
          >
            <Trash2 className="size-3.5" />
            {del.armed ? "Rostdan?" : "O‘chirish"}
          </button>
        ) : null}
        {info ? <span className="hidden text-xs text-white/50 lg:inline">{info}</span> : null}
        <OverflowMenu del={del} legacy={legacy} info={info} />
      </div>
    </div>
  );
}

/**
 * Mobil «Boshqa amallar» menyusi (`md:hidden`). Klaviatura: ochilganda
 * birinchi band fokusda, ↑/↓ band almashtiradi, Escape yopadi va fokusni
 * tugmaga qaytaradi, tashqariga bosish yopadi. Menyu FAQAT ochiqda
 * chiziladi — yopiqda DOM da takroriy «O'chirish» yo'q.
 */
function OverflowMenu({ del, legacy, info }: { del: SlideToolbarDelete | null; legacy: boolean; info?: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Its own history entry: the phone's back (and Telegram's) closes the menu, not the page.
  const close = useCallback(() => setOpen(false), []);
  useOverlayHistory(open, close);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = useCallback(
    () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    [],
  );

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
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
  }, [open, items]);

  return (
    <div ref={rootRef} className="relative md:hidden">
      <button
        ref={triggerRef}
        type="button"
        data-slide-more
        aria-label="Boshqa amallar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={cn("hover:bg-white/10 rounded p-1.5", open && "bg-white/15")}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <div
          id={id}
          data-slide-more-panel
          className="absolute top-full right-0 z-30 mt-1 w-64 max-w-[calc(100vw-1rem)] rounded-md border border-white/10 bg-[#2b2b2b] p-1 text-[13px] text-white/90 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
              return;
            }
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const list = items();
            if (!list.length) return;
            const at = list.indexOf(document.activeElement as HTMLElement);
            const next = e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
            list[next]?.focus();
          }}
        >
          {legacy ? <p className="px-2 py-1.5 text-xs text-white/50">Bu deka eski formatda — tahrirlab bo‘lmaydi</p> : null}
          {info ? <p className="px-2 py-1.5 text-xs text-white/50">{info}</p> : null}
          {del ? (
            <div role="menu" aria-label="Slayd amallari">
              <button
                type="button"
                role="menuitem"
                title={del.title}
                disabled={del.disabled}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-2 text-left disabled:opacity-40",
                  del.armed ? "bg-red-500/80 text-white" : "hover:bg-white/10",
                )}
                onClick={del.onClick}
              >
                <Trash2 className="size-4" />
                {del.armed ? "Rostdan?" : "Slaydni o‘chirish"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
