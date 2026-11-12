"use client";

import { create } from "zustand";
import { useUi } from "@/lib/ui";
import type { PayMethodId } from "./pay/methods";

/** The Hamyon tab: where top-up links go and where login / the payment provider bring the user back to. */
export const PAY_RETURN_PATH = "/uz/wallet";

/**
 * Quick-fill amounts of the top-up sheet's «Summa» step (so'm). A chip only fills the input —
 * nothing is preselected (owner 2026-11-12). The sheet also takes a FREE amount
 * (`lib/topup-limits.ts`: 1 000 – 10 000 000).
 */
export const TOPUP_PRESETS = [10_000, 25_000, 50_000, 100_000] as const;

/**
 * State of the top-up sheet (`PayDialog`) that callers set BEFORE it renders (no flash of an old
 * choice): the typed amount (`0` = empty), the chosen method (`null` = the sheet starts at the
 * method chooser) and the payment bonus percent the wallet page loaded from `/api/users/me`
 * (`null` = unknown → no bonus preview). The sheet clears `amount` and `method` when it closes.
 */
export const usePayAmount = create<{
  amount: number;
  method: PayMethodId | null;
  bonusPercent: number | null;
  setAmount: (v: number) => void;
  setMethod: (m: PayMethodId | null) => void;
  setBonusPercent: (p: number | null) => void;
}>((set) => ({
  amount: 0,
  method: null,
  bonusPercent: null,
  setAmount: (amount) => set({ amount }),
  setMethod: (method) => set({ method }),
  setBonusPercent: (bonusPercent) => set({ bonusPercent }),
}));

/**
 * Opens the top-up sheet. `method`: start at its «Summa» step (the wallet's method rows); without
 * it the sheet starts at the method chooser. `amount`: a suggestion pre-filled in the «Summa» step
 * (a context opener such as «balance is short by N»; any positive whole number — the step still
 * validates it against the limits). `lib/ui.ts open()` only carries `returnTo`, so both go through
 * `usePayAmount`.
 */
export function openPay(opts?: { amount?: number; method?: PayMethodId }): void {
  const amount = opts?.amount;
  const s = usePayAmount.getState();
  s.setAmount(typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 ? amount : 0);
  s.setMethod(opts?.method ?? null);
  useUi.getState().open("pay");
}
