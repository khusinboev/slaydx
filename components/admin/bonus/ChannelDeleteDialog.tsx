"use client";

import { ConfirmDialog, toast } from "@/components/admin/ui";
import { ApiError } from "@/lib/admin-api/core";
import { deleteBonusChannel, type BonusChannel } from "@/lib/admin-api/bonus";

export type ChannelDeleteDialogProps = {
  item: BonusChannel | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
  /** The server refused (`has_claims`): the list is stale, reload it. */
  onStale: () => void;
};

/**
 * Permanent delete of a channel nobody has claimed yet. The server refuses with 409
 * `has_claims` otherwise (the message tells the admin to deactivate instead).
 */
export function ChannelDeleteDialog({ item, onClose, onDeleted, onStale }: ChannelDeleteDialogProps) {
  return (
    <ConfirmDialog
      open={item !== null}
      onClose={onClose}
      title="Kanalni o'chirish"
      description="Kanal ro'yxatdan butunlay o'chadi va botda ko'rinmaydi. Bu amalni qaytarib bo'lmaydi."
      target={item ? <span>{item.title}</span> : null}
      reason={{ required: false, label: "Sabab (ixtiyoriy)" }}
      danger
      confirmLabel="O'chirish"
      onConfirm={async ({ reason }) => {
        if (!item) return;
        try {
          await deleteBonusChannel(item.id, reason);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) onStale();
          throw e;
        }
        toast(`«${item.title}» o'chirildi`);
        onDeleted(item.id);
      }}
    />
  );
}
