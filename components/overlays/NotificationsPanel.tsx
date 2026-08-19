"use client";

import { Bell, X } from "lucide-react";
import { useUi } from "@/lib/ui";
import { useDialog } from "./useDialog";

export function NotificationsPanel() {
  const open = useUi((s) => s.overlay === "notifications");
  const close = useUi((s) => s.close);
  const panelRef = useDialog(open, close);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Bildirishnomalar">
      <button type="button" className="absolute inset-0 bg-black/20" aria-label="Yopish" onClick={close} />
      <aside
        ref={panelRef}
        className="bg-card absolute top-14 right-3 w-[min(100%-1.5rem,22rem)] rounded-2xl border p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Bildirishnomalar</h2>
          <button type="button" onClick={close} className="hover:bg-muted rounded-full p-1.5" aria-label="Yopish">
            <X className="size-4" />
          </button>
        </div>
        <div className="text-muted-foreground flex flex-col items-center py-10 text-center text-sm">
          <Bell className="mb-2 size-6 opacity-50" />
          Hozircha bildirishnoma yo&apos;q
        </div>
      </aside>
    </div>
  );
}
