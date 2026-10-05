"use client";

import { Bell, X } from "lucide-react";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { OverlayFrame } from "./OverlayFrame";
import { useDialog } from "./useDialog";

export function NotificationsPanel() {
  const open = useUi((s) => s.overlay === "notifications");
  const close = useUi((s) => s.close);
  const panelRef = useDialog(open, close);
  /** Telefon (docs/mobile/PLAN.md O5): panel bar ostidan ochiladi, 44 px yopish, ichki aylantirish. */
  const phone = useCoarsePointer();
  if (!open) return null;

  return (
    <OverlayFrame
      label="Bildirishnomalar"
      phone={phone}
      // Telefonda bar balandligi (3.5rem) + xavfsiz maydon ostidan boshlanadi (TopBar bilan bir xil).
      topGap="3.5rem"
      sideGap="0.75rem"
      className={phone ? "flex items-start justify-end" : undefined}
    >
      <button type="button" className="absolute inset-0 bg-black/20" aria-label="Yopish" onClick={close} />
      <aside
        ref={panelRef}
        className={cn(
          "bg-card rounded-2xl border p-4 shadow-xl",
          phone
            ? "relative z-10 max-h-full w-full max-w-[22rem] overflow-y-auto overscroll-contain"
            : "absolute top-14 right-3 w-[min(100%-1.5rem,22rem)]",
        )}
      >
        <div className={cn("flex items-center justify-between", phone ? "mb-1" : "mb-3")}>
          <h2 className="font-semibold">Bildirishnomalar</h2>
          <button
            type="button"
            onClick={close}
            className={cn(
              "hover:bg-muted flex items-center justify-center rounded-full",
              phone ? "-mr-2 size-11" : "p-1.5",
            )}
            aria-label="Yopish"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="text-muted-foreground flex flex-col items-center py-10 text-center text-sm">
          <Bell className="mb-2 size-6 opacity-50" />
          Hozircha bildirishnoma yo&apos;q
        </div>
      </aside>
    </OverlayFrame>
  );
}
