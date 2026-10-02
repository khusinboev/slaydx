"use client";

import { ConfirmDialog, toast } from "@/components/admin/ui";
import { ApiError } from "@/lib/admin-api/core";
import { resetSetting, type SettingItem } from "@/lib/admin-api/settings";
import { formatValue, PROPAGATION_NOTE, type ToolOption } from "./format";

export type SettingResetDialogProps = {
  /** The setting being reset; `null` keeps the dialog closed. */
  item: SettingItem | null;
  tools: ReadonlyArray<ToolOption>;
  onClose: () => void;
  onReset: (item: SettingItem) => void;
  /** The server said there is no override any more (someone else reset it): reload the list. */
  onStale: () => void;
};

/** "Standartga qaytarish": removes the admin override; the audited reason is required. */
export function SettingResetDialog({ item, tools, onClose, onReset, onStale }: SettingResetDialogProps) {
  if (!item) return null;
  return (
    <ConfirmDialog
      key={item.key}
      open
      onClose={onClose}
      title="Standartga qaytarish"
      description="Admin qiymati o'chiriladi, sozlama env yoki standart qiymatga qaytadi."
      target={
        <span>
          {item.label} <span className="text-muted-foreground font-mono text-xs">{item.key}</span>
        </span>
      }
      before={formatValue(item, item.value, tools)}
      after={formatValue(item, item.envValue, tools)}
      reason={{ minLength: 5 }}
      confirmLabel="Standartga qaytarish"
      onConfirm={async ({ reason }) => {
        try {
          const { item: saved } = await resetSetting(item.key, reason);
          toast(`Standart qiymat tiklandi. ${PROPAGATION_NOTE}`);
          onReset(saved);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) onStale();
          throw e;
        }
      }}
    />
  );
}
