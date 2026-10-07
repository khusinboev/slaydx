"use client";

import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { useVisualViewport } from "@/lib/hooks/useVisualViewport";
import { cn } from "@/lib/cn";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, TOP_INSET, atLeast } from "../shell/safe-area";

/**
 * Full-screen frame of a modal overlay (search, notifications, pay, login).
 *
 * Desktop: the plain `fixed inset-0 z-50` wrapper the dialogs always had.
 *
 * Phone (docs/mobile/PLAN.md O5, package P4): the same wrapper with
 *  - padding that keeps the card out of the notch, Telegram's header and the
 *    home indicator (`--tg-safe-*`, `env(safe-area-inset-*)` fallback, 0 when
 *    absent), and
 *  - the visible area when the on-screen keyboard is open: iOS keeps the
 *    layout viewport and only shrinks the visual one, so the frame follows
 *    `visualViewport` (top + height) — a card with an input then never hides
 *    behind the keyboard; Android resizes the window and needs no help.
 * The card inside must be `max-h-full overflow-y-auto` to scroll internally.
 *
 * `sheet` (redesign W5, variant A): on a phone the card is a bottom sheet —
 * flush with the bottom and side edges, its own bottom padding
 * (`--sheet-pb`) clears the home indicator (only `1rem` while the keyboard
 * covers it). Use `OverlayPanel` for the card: it draws the grabber, the
 * 26 px top corners and the slide-up.
 *
 * Only mount it while the dialog is open (the hook listens to the viewport).
 */
export function OverlayFrame({
  label,
  phone,
  sheet = false,
  className,
  topGap = "0.75rem",
  bottomGap = "0.75rem",
  sideGap = "1rem",
  children,
}: {
  label: string;
  phone: boolean;
  /** Phone: a bottom sheet (no bottom / side gap; the panel pads itself by `--sheet-pb`). */
  sheet?: boolean;
  /** Layout classes (alignment) for both desktop and phone. */
  className?: string;
  /** Phone padding above / below / beside the card, on top of the safe inset. */
  topGap?: string;
  bottomGap?: string;
  sideGap?: string;
  children: ReactNode;
}) {
  const vv = useVisualViewport();
  const keyboard = phone && vv.keyboardOpen;
  const style: CSSProperties | undefined = phone
    ? sheet
      ? {
          paddingTop: `calc(${TOP_INSET} + ${topGap})`,
          paddingBottom: 0,
          paddingLeft: SAFE_LEFT,
          paddingRight: SAFE_RIGHT,
          // Keyboard open: the home indicator is under it, no extra inset.
          ["--sheet-pb" as string]: keyboard ? "1rem" : `calc(${SAFE_BOTTOM} + 1rem)`,
          ...(keyboard && vv.height > 0 ? { top: vv.offsetTop, height: vv.height, bottom: "auto" } : null),
        }
      : {
          paddingTop: `calc(${TOP_INSET} + ${topGap})`,
          // Keyboard open: the home indicator is under it, no extra inset.
          paddingBottom: keyboard ? bottomGap : `calc(${SAFE_BOTTOM} + ${bottomGap})`,
          paddingLeft: atLeast(sideGap, SAFE_LEFT),
          paddingRight: atLeast(sideGap, SAFE_RIGHT),
          ...(keyboard && vv.height > 0 ? { top: vv.offsetTop, height: vv.height, bottom: "auto" } : null),
        }
    : undefined;
  return (
    <div
      className={cn("fixed inset-0 z-50", className)}
      data-overlay-frame
      data-phone={phone ? "" : undefined}
      data-sheet={phone && sheet ? "" : undefined}
      data-keyboard={keyboard ? "" : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * The dimmed backdrop: fades in (`.slx-scrim-enter`), a tap closes the overlay.
 * Not in the Tab order — Escape and the «×» button are the keyboard ways out.
 */
export function OverlayScrim({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-overlay-scrim
      aria-label="Yopish"
      onClick={onClose}
      className={cn("slx-scrim-enter absolute inset-0 bg-black/45 dark:bg-black/60", className)}
    />
  );
}

/**
 * Card of an overlay (redesign W5, variant A).
 *
 *  - phone + `sheet`: bottom sheet — grabber, 26 px top corners, slides up
 *    (`.slx-sheet-enter`, 300 ms; none under reduced motion), scrolls inside,
 *    bottom padding `--sheet-pb` from `OverlayFrame`;
 *  - phone, no sheet: a rounded card that scrolls inside (search);
 *  - desktop: a centred 24 px-radius dialog that fades in.
 */
export const OverlayPanel = forwardRef<
  HTMLDivElement,
  {
    phone: boolean;
    sheet?: boolean;
    className?: string;
    children: ReactNode;
    as?: "div" | "aside";
  }
>(function OverlayPanel({ phone, sheet = false, className, children, as = "div" }, ref) {
  const Tag = as;
  const asSheet = phone && sheet;
  return (
    <Tag
      ref={ref}
      data-overlay-panel={asSheet ? "sheet" : phone ? "card" : "dialog"}
      className={cn(
        "bg-card text-card-foreground relative z-10 w-full border",
        asSheet
          ? "slx-sheet-enter mx-auto max-h-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[26px] border-b-0 px-5 pt-2 pb-[var(--sheet-pb,1rem)] shadow-2xl"
          : phone
            ? "max-h-full overflow-y-auto overscroll-contain rounded-[22px] shadow-2xl motion-safe:animate-[slx-enter-fade_200ms_ease-out_backwards]"
            : "rounded-[24px] p-6 shadow-2xl motion-safe:animate-[slx-enter-fade_180ms_ease-out_backwards]",
        className,
      )}
    >
      {asSheet ? <SheetGrabber /> : null}
      {children}
    </Tag>
  );
});

/** The short bar at the top of a bottom sheet (visual only). */
export function SheetGrabber() {
  return <div aria-hidden data-sheet-grabber className="bg-border mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full" />;
}

/** «×» of an overlay: 44 px on touch, 40 px with a mouse; visible keyboard ring. */
export function OverlayClose({ onClose, phone, className }: { onClose: () => void; phone: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Yopish"
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex shrink-0 items-center justify-center rounded-[14px] outline-none transition-colors focus-visible:ring-2",
        phone ? "size-11" : "size-10",
        className,
      )}
    >
      <X className="size-5" aria-hidden />
    </button>
  );
}

/** Title row of an overlay: 19 px title + the close button (the title gets `id` for `aria-labelledby`). */
export function OverlayHeader({
  title,
  id,
  phone,
  onClose,
  className,
}: {
  title: ReactNode;
  id?: string;
  phone: boolean;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)} data-overlay-header>
      <h2 id={id} className="min-w-0 flex-1 truncate text-[19px] leading-tight font-bold tracking-[-0.01em]">
        {title}
      </h2>
      <OverlayClose onClose={onClose} phone={phone} className="-mr-2" />
    </div>
  );
}
