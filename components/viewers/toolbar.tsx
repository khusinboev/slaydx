"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from "lucide-react";
import { zoomStep } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";

/** Toolbar balandligi (`h-10`) — sahifa hisoblagichi uning ostidan sanaydi. */
export const VIEWER_TOOLBAR_H = 40;

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
   */
  right?: ReactNode;
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

  return (
    <div
      data-viewer-toolbar={sticky ? "sticky" : undefined}
      className={cn(
        "no-print bg-[#3b3b3b] text-[#f3f3f3] flex h-10 shrink-0 items-center gap-1 px-2 text-[13px]",
        sticky && "sticky top-[var(--result-header-h,0px)] z-10",
      )}
    >
      <button type="button" className="hover:bg-white/10 rounded p-1.5 disabled:opacity-30" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Oldingi sahifa">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-16 text-center tabular-nums">
        {page} / {Math.max(1, pages)}
      </span>
      <button type="button" className="hover:bg-white/10 rounded p-1.5 disabled:opacity-30" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Keyingi sahifa">
        <ChevronRight className="size-4" />
      </button>
      <span className="mx-2 h-4 w-px bg-white/20" />
      <button type="button" className="hover:bg-white/10 rounded p-1.5" onClick={dec} aria-label="Kichraytirish">
        <Minus className="size-4" />
      </button>
      <button type="button" className="hover:bg-white/10 min-w-12 rounded px-1 py-1 tabular-nums" onClick={onFit}>
        {zoom}%
      </button>
      <button type="button" className="hover:bg-white/10 rounded p-1.5" onClick={inc} aria-label="Kattalashtirish">
        <Plus className="size-4" />
      </button>
      {onFullscreen ? (
        <button type="button" className="hover:bg-white/10 ml-1 rounded p-1.5" onClick={onFullscreen} aria-label="To‘liq ekran">
          <Maximize2 className="size-4" />
        </button>
      ) : null}
      {/* Mobil ekranda maket chiplari + tugmalar sig'masa gorizontal aylantiriladi (kesilmaydi). */}
      {extra ? <div className="ml-auto flex max-w-full items-center gap-2 overflow-x-auto">{extra}</div> : null}
      {right ? (
        <div className={cn("flex max-w-full items-center gap-1.5 overflow-x-auto", extra ? "ml-2" : "ml-auto")}>{right}</div>
      ) : null}
    </div>
  );
}
