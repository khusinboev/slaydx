"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, Presentation, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { SAFE_RIGHT, TOP_INSET } from "../../shell/safe-area";
import { useAutoHide } from "./useAutoHide";

/**
 * Control pill of the enlarged («To‘liq ekran») mode: ‹ position › presenter close.
 *
 * - 44 px targets. Touch also taps the left/right third and swipes
 *   (`gesture.ts`); the buttons are the visible way back (the mode had none
 *   but the arrow keys).
 * - The ends use `aria-disabled` + a no-op click, NOT `disabled`: a focused
 *   button that turns `disabled` drops keyboard focus to `<body>`.
 * - The position is a polite live region («2 / 9 slayd»), so a screen-reader
 *   user hears where a swipe / tap / key landed.
 * - Safe areas: placed under the notch / Telegram's header and clear of the
 *   right inset (`--tg-safe-*` with the `env()` fallback, `shell/safe-area`).
 * - On FINE pointers (`autoHide`) the pill fades after a short idle so it
 *   does not cover a corner of the slide (the user's logo sits there); touch
 *   keeps it visible (`useAutoHide`).
 * - A dark pill keeps the controls legible over a light slide filling the screen.
 */
export function PresentBar({
  index,
  total,
  presenter,
  autoHide,
  onPrev,
  onNext,
  onPresenter,
  onClose,
}: {
  index: number;
  total: number;
  presenter: boolean;
  /** Fine pointer (mouse): fade out after an idle. Touch: stay visible. */
  autoHide: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPresenter: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idle = useAutoHide(autoHide, ref);
  const atStart = index <= 0;
  const atEnd = index >= total - 1;
  const btn = "hover:bg-white/10 inline-flex size-11 items-center justify-center rounded";
  const ends = "aria-disabled:opacity-30 aria-disabled:hover:bg-transparent";

  return (
    <div
      ref={ref}
      data-slide-present-bar
      data-slide-chrome={idle.hidden ? "hidden" : "visible"}
      style={{ top: `calc(${TOP_INSET} + 0.5rem)`, right: `calc(${SAFE_RIGHT} + 0.5rem)` }}
      onPointerEnter={idle.onPointerEnter}
      onPointerLeave={idle.onPointerLeave}
      /*
        A mouse press must not move focus onto the bar's buttons: the presenter
        keeps paging with Space, and a clicked ‹ that kept focus would be
        re-activated by that Space (it went back instead of forward). Tab still
        focuses them (keyboard); touch taps are unaffected (their compat
        mousedown is cancelled too, the click still fires).
      */
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "no-print absolute z-20 flex items-center gap-1 rounded-lg bg-black/60 p-1 text-white/90 backdrop-blur-sm transition-opacity duration-300 motion-reduce:transition-none",
        idle.hidden && "pointer-events-none opacity-0",
      )}
    >
      <button
        type="button"
        data-slide-prev
        aria-label="Oldingi slayd"
        aria-disabled={atStart ? true : undefined}
        className={cn(btn, ends)}
        onClick={() => {
          if (!atStart) onPrev();
        }}
      >
        <ChevronLeft className="size-5" />
      </button>
      <span data-slide-counter aria-live="polite" aria-atomic="true" className="min-w-12 text-center text-sm tabular-nums">
        {index + 1} / {total}
        <span className="sr-only"> slayd</span>
      </span>
      <button
        type="button"
        data-slide-next
        aria-label="Keyingi slayd"
        aria-disabled={atEnd ? true : undefined}
        className={cn(btn, ends, "mr-1")}
        onClick={() => {
          if (!atEnd) onNext();
        }}
      >
        <ChevronRight className="size-5" />
      </button>
      <button
        type="button"
        data-slide-presenter
        aria-label="Taqdimotchi rejimi"
        aria-pressed={presenter}
        title="Taqdimotchi rejimi (P)"
        className={cn(btn, presenter && "bg-white/15")}
        onClick={onPresenter}
      >
        <Presentation className="size-4" />
      </button>
      <button type="button" data-slide-close aria-label="Yopish" title="Yopish (Esc)" className={btn} onClick={onClose}>
        <X className="size-4" />
      </button>
    </div>
  );
}
