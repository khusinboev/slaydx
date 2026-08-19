"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from "lucide-react";
import { ZOOM_STEPS } from "@/lib/viewers/metrics";

export function ViewerToolbar({
  zoom,
  onZoom,
  page,
  pages,
  onPage,
  onFit,
  onFullscreen,
  extra,
}: {
  zoom: number;
  onZoom: (n: number) => void;
  page: number;
  pages: number;
  onPage: (n: number) => void;
  onFit?: () => void;
  onFullscreen?: () => void;
  extra?: ReactNode;
}) {
  const idx = ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number]);
  const dec = () => onZoom(idx > 0 ? ZOOM_STEPS[idx - 1] : ZOOM_STEPS[0]);
  const inc = () => onZoom(idx >= 0 && idx < ZOOM_STEPS.length - 1 ? ZOOM_STEPS[idx + 1] : ZOOM_STEPS[ZOOM_STEPS.length - 1]);

  return (
    <div className="no-print bg-[#3b3b3b] text-[#f3f3f3] flex h-10 shrink-0 items-center gap-1 px-2 text-[13px]">
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
      {extra ? <div className="ml-auto flex items-center gap-2">{extra}</div> : null}
    </div>
  );
}
