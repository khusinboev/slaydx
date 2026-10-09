"use client";

import { create } from "zustand";
import { useUi } from "@/lib/ui";

/** The Hamyon tab: where top-up links go and where login / the payment provider bring the user back to. */
export const PAY_RETURN_PATH = "/uz/wallet";

/**
 * Top-up amounts of `PayDialog` (so'm) — the one list the dialog and the
 * Hamyon «Tez to'ldirish» packages both read (redesign W5). The dialog also
 * takes a FREE amount (`lib/topup-limits.ts`: 1 000 – 10 000 000).
 */
export const TOPUP_PRESETS = [10_000, 25_000, 50_000, 100_000] as const;
export type TopupPreset = (typeof TOPUP_PRESETS)[number];

/** Preselected when nothing else was chosen; Hamyon marks it «eng qulay». */
export const DEFAULT_TOPUP: TopupPreset = 25_000;

export function isTopupPreset(v: unknown): v is TopupPreset {
  return typeof v === "number" && (TOPUP_PRESETS as readonly number[]).includes(v);
}

/**
 * The amount selected in `PayDialog` (a preset or a typed free amount; `0` =
 * the field was cleared). It lives outside the component so a caller can
 * preselect it before the dialog renders (no flash of the old choice); it
 * survives closing the dialog, as the component state did.
 */
export const usePayAmount = create<{ amount: number; setAmount: (v: number) => void }>((set) => ({
  amount: DEFAULT_TOPUP,
  setAmount: (amount) => set({ amount }),
}));

/**
 * Opens `PayDialog`, preselecting `amount` when it is one of `TOPUP_PRESETS`
 * (anything else is ignored: the current choice stays). `lib/ui.ts open()`
 * only carries `returnTo`, so the amount goes through `usePayAmount`.
 */
export function openPay(opts?: { amount?: number }): void {
  const amount = opts?.amount;
  if (isTopupPreset(amount)) usePayAmount.getState().setAmount(amount);
  useUi.getState().open("pay");
}
