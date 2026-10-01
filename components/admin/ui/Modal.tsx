"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDialog } from "@/components/overlays/useDialog";

const WIDTH = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

/**
 * Centered modal built on the shared `useDialog` (Escape, focus trap, scroll lock).
 *
 * `useDialog` re-subscribes whenever its `close` identity changes, which would
 * re-run its focus logic on every parent render. So the callback handed to it
 * is made stable here, and callers may pass an inline `onClose`.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof WIDTH;
  /** `false` blocks Escape, backdrop and the X button (e.g. while a request is in flight). */
  dismissible?: boolean;
}) {
  const titleId = useId();
  const closeRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    closeRef.current = onClose;
    dismissibleRef.current = dismissible;
  });
  const close = useCallback(() => {
    if (dismissibleRef.current) closeRef.current();
  }, []);
  const panelRef = useDialog(open, close);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Yopish"
        className="absolute inset-0 bg-black/45"
        onClick={close}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "bg-card relative z-10 flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-2xl border shadow-xl",
          WIDTH[size],
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-1">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description ? <div className="text-muted-foreground mt-1 text-[13px]">{description}</div> : null}
          </div>
          <button
            type="button"
            onClick={close}
            disabled={!dismissible}
            aria-label="Yopish"
            className="hover:bg-muted focus-visible:ring-ring -mt-1 -mr-2 rounded-full p-1.5 outline-none focus-visible:ring-2 disabled:opacity-40"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {children ? <div className="flex flex-col gap-3 overflow-y-auto px-5 py-3">{children}</div> : null}
        {footer ? <div className="flex flex-wrap justify-end gap-2 px-5 pt-2 pb-4">{footer}</div> : null}
      </div>
    </div>
  );
}
