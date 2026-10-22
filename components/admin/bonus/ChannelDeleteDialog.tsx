"use client";

import { ConfirmDialog, toast } from "@/components/admin/ui";
import { ApiError } from "@/lib/admin-api/core";
import { deleteBonusChannel, type BonusChannel } from "@/lib/admin-api/bonus";

export type ChannelDeleteDialogProps = {
  item: BonusChannel | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
  /** The server answered 404 (deleted meanwhile, e.g. from the bot): the list is stale, reload it. */
  onStale: () => void;
};

export const DELETE_NOTE =
  "Kanal ro'yxatdan, botdan va majburiy obuna tekshiruvidan yo'qoladi. Tarix va berilgan bonuslar saqlanadi. Shu kanalni qayta qo'shsangiz, u tiklanadi — avval bonus olganlarga qayta to'lanmaydi.";

/**
 * Delete = a soft delete on the server (migration 051): allowed for every channel, claims and paid bonuses are
 * kept, and adding the same channel again restores it without paying anyone twice.
 */
export function ChannelDeleteDialog({ item, onClose, onDeleted, onStale }: ChannelDeleteDialogProps) {
  return (
    <ConfirmDialog
      open={item !== null}
      onClose={onClose}
      title="Kanalni o'chirish"
      description={DELETE_NOTE}
      target={item ? <span>{item.title}</span> : null}
      reason={{ required: false, label: "Sabab (ixtiyoriy)" }}
      danger
      confirmLabel="O'chirish"
      onConfirm={async ({ reason }) => {
        if (!item) return;
        try {
          await deleteBonusChannel(item.id, reason);
        } catch (e) {
          if (e instanceof ApiError && (e.status === 404 || e.status === 409)) onStale();
          throw e;
        }
        toast(`«${item.title}» o'chirildi`);
        onDeleted(item.id);
      }}
    />
  );
}
