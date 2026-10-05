"use client";

import type { CSSProperties, ReactNode } from "react";
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
 * Only mount it while the dialog is open (the hook listens to the viewport).
 */
export function OverlayFrame({
  label,
  phone,
  className,
  topGap = "0.75rem",
  bottomGap = "0.75rem",
  sideGap = "1rem",
  children,
}: {
  label: string;
  phone: boolean;
  /** Layout classes (alignment) for both desktop and phone. */
  className?: string;
  /** Phone padding above / below / beside the card, on top of the safe inset. */
  topGap?: string;
  bottomGap?: string;
  sideGap?: string;
  children: ReactNode;
}) {
  const vv = useVisualViewport();
  const style: CSSProperties | undefined = phone
    ? {
        paddingTop: `calc(${TOP_INSET} + ${topGap})`,
        // Keyboard open: the home indicator is under it, no extra inset.
        paddingBottom: vv.keyboardOpen ? bottomGap : `calc(${SAFE_BOTTOM} + ${bottomGap})`,
        paddingLeft: atLeast(sideGap, SAFE_LEFT),
        paddingRight: atLeast(sideGap, SAFE_RIGHT),
        ...(vv.keyboardOpen && vv.height > 0 ? { top: vv.offsetTop, height: vv.height, bottom: "auto" } : null),
      }
    : undefined;
  return (
    <div
      className={cn("fixed inset-0 z-50", className)}
      data-overlay-frame
      data-phone={phone ? "" : undefined}
      data-keyboard={phone && vv.keyboardOpen ? "" : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={style}
    >
      {children}
    </div>
  );
}
