"use client";

import { ConfirmDialog, toast } from "@/components/admin/ui";
import { ApiError } from "@/lib/admin-api/core";
import { updatePricing, type PriceAdjust, type PricingItem, type PricingItemResult } from "@/lib/admin-api/pricing";
import { LadderCompare } from "./LadderCompare";
import { MarginChip } from "./bits";
import { BIG_CHANGE_PP, PROPAGATION_NOTE, changeText, markupText, pctText, percentLabel, roundToText } from "./shared";
import { shownSimulation, useSimulation } from "./useSimulation";

export type ApplyRecommendationProps = {
  item: PricingItem;
  /** The recommended adjustment percent (an applicable `RecState`). */
  target: number;
  targetMarkup: number;
  includeAdmins: boolean;
  onClose: () => void;
  onApplied: (result: PricingItemResult) => void;
  /** The server state differs from what was shown (409): reload the overview. */
  onStale: () => void;
};

/**
 * One-click recommendation (owner decision 2026-10-10): one tool, the price
 * ladder now vs after and the projected margin from the `simulate` endpoint,
 * a required reason, the typed confirmation above ±50 points like a manual
 * edit. Saved through the SAME `updatePricing` → `PUT` as «O'zgartirish»
 * (audit, history, step-up), with `expected` = the adjustment shown here, so
 * a change made meanwhile by someone else is refused (409 `stale`).
 */
export function ApplyRecommendationDialog({ item, target, targetMarkup, includeAdmins, onClose, onApplied, onStale }: ApplyRecommendationProps) {
  const current = item.adjust;
  const next: PriceAdjust = { percent: target, roundTo: current.roundTo };
  const sim = shownSimulation(useSimulation(item.toolId, next, includeAdmins));
  const big = Math.abs(target - current.percent) > BIG_CHANGE_PP;
  const changePct = (target / current.percent - 1) * 100;

  return (
    <ConfirmDialog
      open
      sheet
      onClose={onClose}
      title={`Tavsiyani qo'llash — ${item.title}`}
      description={`Narx ${changeText(changePct)}: ustama ${markupText(item.markup)} dan maqsadli ${markupText(targetMarkup)} ga. ${PROPAGATION_NOTE}`}
      before={`${percentLabel(current.percent)} · ${roundToText(current.roundTo)}`}
      after={`${percentLabel(next.percent)} · ${roundToText(next.roundTo)}`}
      reason={{ minLength: 5 }}
      typedConfirmation={big ? String(target) : undefined}
      confirmLabel="Qo'llash"
      onConfirm={async ({ reason }) => {
        try {
          const { item: result } = await updatePricing(item.toolId, next, reason, { expected: current });
          toast(`${item.title}: ${percentLabel(current.percent)} → ${percentLabel(next.percent)}. ${PROPAGATION_NOTE}`);
          onApplied(result);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            toast(e.message, { tone: "error" });
            onStale();
          }
          throw e;
        }
      }}
    >
      <LadderCompare current={item.ladder} proposed={sim?.ladder ?? null} caption="Narx pog'onalari: hozir va tavsiya" />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" aria-live="polite">
        <span className="text-muted-foreground">Marja{sim ? ` · ${sim.window.days} kun prognozi` : ""}:</span>
        {sim ? (
          <>
            <span className="tabular-nums">{pctText(sim.current.marginPct)}</span>
            <span aria-hidden="true">→</span>
            <MarginChip marginPct={sim.projected.marginPct} digits={1} />
          </>
        ) : (
          <span className="text-muted-foreground">hisoblanmoqda…</span>
        )}
      </p>
      {big ? <p className="text-badge-warning-text text-xs font-semibold">Katta o&apos;zgarish (&gt; {BIG_CHANGE_PP} punkt): tasdiqlash uchun yangi foizni yozing.</p> : null}
    </ConfirmDialog>
  );
}
