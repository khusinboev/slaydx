"use client";

import { Bell } from "lucide-react";
import { useUi } from "@/lib/ui";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { OverlayFrame, OverlayHeader, OverlayPanel, OverlayScrim } from "./OverlayFrame";
import { useDialog } from "./useDialog";

/**
 * Bildirishnomalar (Bosh sarlavhasidagi qo'ng'iroq, Alt+T).
 *
 * Redesign W5: telefonda pastdan chiqadigan varaq (grabber, xavfsiz maydon —
 * `OverlayFrame sheet`); ilgari 3.5rem lik TopBar ostiga yopishgan edi, endi
 * global top bar yo'q. Kompyuterda — markazdagi dialog (qo'ng'iroq sahifa
 * sarlavhasida, sahifa kengligi markazda: o'ng chetdagi popover undan uzoq edi).
 */
export function NotificationsPanel() {
  const open = useUi((s) => s.overlay === "notifications");
  const close = useUi((s) => s.close);
  const panelRef = useDialog(open, close);
  const phone = useCoarsePointer();
  if (!open) return null;

  return (
    <OverlayFrame
      label="Bildirishnomalar"
      phone={phone}
      sheet
      className={phone ? "flex items-end justify-center" : "flex items-center justify-center p-4"}
    >
      <OverlayScrim onClose={close} />
      <OverlayPanel ref={panelRef} as="aside" phone={phone} sheet className={phone ? undefined : "max-w-sm"}>
        <OverlayHeader title="Bildirishnomalar" phone={phone} onClose={close} />
        <div className="text-muted-foreground flex flex-col items-center px-4 py-10 text-center text-[15px]" data-notifications-empty>
          <span className="bg-accent-soft mb-3 flex size-14 items-center justify-center rounded-[18px]">
            <Bell className="text-accent-soft-foreground size-6" aria-hidden />
          </span>
          <span className="text-foreground text-[16px] font-semibold">Hozircha bildirishnoma yo&apos;q</span>
        </div>
      </OverlayPanel>
    </OverlayFrame>
  );
}
