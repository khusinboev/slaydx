"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useDialog } from "@/components/overlays/useDialog";

/** Right-side panel for row details (moderation preview, audit diff). Same dialog behaviour as `Modal`. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  history = true,
}: {
  /**
   * `false` only when the open state already lives in the URL (`?id=` pushed by
   * `useUrlDrawer`): the URL entry is then the drawer's history entry.
   */
  history?: boolean;
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  // `useDialog` needs a stable `close`, otherwise it re-runs its focus logic each render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const close = useCallback(() => closeRef.current(), []);
  const panelRef = useDialog(open, close, { history });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" tabIndex={-1} aria-label="Yopish" className="absolute inset-0 bg-black/40" onClick={close} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card relative z-10 flex h-full w-full max-w-lg flex-col border-l shadow-xl"
      >
        <header className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description ? <div className="text-muted-foreground mt-1 text-[13px]">{description}</div> : null}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Yopish"
            className="hover:bg-muted focus-visible:ring-ring -mt-1 -mr-2 rounded-full p-1.5 outline-none focus-visible:ring-2"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</footer> : null}
      </aside>
    </div>
  );
}
