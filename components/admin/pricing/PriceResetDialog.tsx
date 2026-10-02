"use client";

import { ConfirmDialog, toast } from "@/components/admin/ui";
import { ApiError } from "@/lib/admin-api/core";
import { resetPricing, type LadderRow, type PriceAdjust, type PricingItemResult } from "@/lib/admin-api/pricing";
import { LadderCompare } from "./LadderCompare";
import { percentLabel, PROPAGATION_NOTE, roundToText } from "./shared";

export type PriceResetDialogProps = {
  open: boolean;
  toolId: string;
  title: string;
  adjust: PriceAdjust;
  ladder: ReadonlyArray<LadderRow>;
  onClose: () => void;
  onReset: (item: PricingItemResult) => void;
  /** The server says the tool is already at 100 % (someone else reset it): reload. */
  onStale: () => void;
};

/** "100 % ga qaytarish": removes the adjustment; the audited reason is required. */
export function PriceResetDialog({ open, toolId, title, adjust, ladder, onClose, onReset, onStale }: PriceResetDialogProps) {
  if (!open) return null;
  // The base ladder is the 100 % ladder: effective = base for every step.
  const base = ladder.map((s) => ({ ...s, effective: s.base }));
  return (
    <ConfirmDialog
      key={toolId}
      open
      onClose={onClose}
      title={`100% ga qaytarish — ${title}`}
      description={`Tuzatish ${percentLabel(adjust.percent)} dan 100% ga (kod formulasi) qaytariladi, yaxlitlash 500 ga. ${PROPAGATION_NOTE}`}
      before={`${percentLabel(adjust.percent)} · ${roundToText(adjust.roundTo)}`}
      after="100% · 500"
      reason={{ minLength: 5 }}
      confirmLabel="Qaytarish"
      danger
      onConfirm={async ({ reason }) => {
        try {
          const { item } = await resetPricing(toolId, reason);
          toast(`${title}: 100% ga qaytarildi. ${PROPAGATION_NOTE}`);
          onReset(item);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) onStale();
          throw e;
        }
      }}
    >
      <LadderCompare current={ladder} proposed={base} caption="Narx pog'onalari: hozir va 100%" />
    </ConfirmDialog>
  );
}
