"use client";

import { useId, useState } from "react";
import { ConfirmDialog, toast } from "@/components/admin/ui";
import { fmtNumber } from "@/lib/admin-format";
import {
  adjustWallet,
  ADJUSTABLE_WALLET_IDS,
  MAX_WALLET_DELTA,
  WALLET_REASON_CODES,
  type AdjustableWalletId,
  type WalletAdjustResult,
  type WalletReasonCode,
  type WalletUserSnapshot,
} from "@/lib/admin-api/money";
import { confirmText, FIELD_CLASS, LABEL_CLASS, moneyError, parseWholeNumber, WALLET_LABEL } from "./shared";

const REASON_CODE_LABEL: Record<WalletReasonCode, string> = {
  compensation: "Kompensatsiya",
  promo: "Aksiya / bonus",
  correction: "Xatoni tuzatish",
  manual_refund: "Qo'lda qaytarish",
  test: "Sinov",
  other: "Boshqa",
};

export type WalletAdjustDialogProps = {
  open: boolean;
  onClose: () => void;
  user: WalletUserSnapshot;
  /** `admin.wallet_confirm_threshold`: at or above it the admin types the amount back. */
  confirmThreshold: number;
  onDone?: (result: WalletAdjustResult) => void;
};

/**
 * Wallet adjustment (plan §6.4, §7.0): wallet (bonus or balance; the legacy
 * Pro quota is read-only since the subscription removal), direction and amount,
 * reason code, audited reason, typed confirmation for large amounts. The
 * `Idempotency-Key` comes from `ConfirmDialog` (one per open, reused on retry).
 */
export function WalletAdjustDialog(props: WalletAdjustDialogProps) {
  if (!props.open) return null;
  return <Body {...props} />;
}

function Body({ onClose, user, confirmThreshold, onDone }: WalletAdjustDialogProps) {
  const ids = useId();
  const [wallet, setWallet] = useState<AdjustableWalletId>("balance");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amountText, setAmountText] = useState("");
  const [reasonCode, setReasonCode] = useState<WalletReasonCode>("compensation");

  const amount = parseWholeNumber(amountText);
  const amountOk = amount !== null && amount > 0 && amount <= MAX_WALLET_DELTA;
  const delta = amountOk ? (direction === "debit" ? -amount : amount) : 0;
  const before = user[wallet];
  const after = before + delta;
  const insufficient = amountOk && after < 0;
  const needsTyped = amountOk && Math.abs(delta) >= confirmThreshold;
  const typed = needsTyped ? confirmText(delta) : undefined;

  const amountHint =
    amountText && !amountOk
      ? `Butun son, eng ko'pi ${fmtNumber(MAX_WALLET_DELTA)}`
      : insufficient
        ? `Mablag' yetarli emas. Mavjud: ${fmtNumber(before)}`
        : needsTyped
          ? `${fmtNumber(confirmThreshold)} va undan katta miqdor yozib tasdiqlanadi`
          : "";

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Hamyonni tuzatish"
      description="Jurnalga «Ma'muriy tuzatish» yoziladi; sabab va kim bajargani faqat audit jurnalida qoladi."
      target={
        <span>
          {user.name}
          {user.username ? <span className="text-muted-foreground"> @{user.username}</span> : null}
          <span className="text-muted-foreground"> · #{user.id}</span>
        </span>
      }
      before={`${WALLET_LABEL[wallet]}: ${fmtNumber(before)}`}
      after={fmtNumber(amountOk ? after : before)}
      reason={{ minLength: 5 }}
      typedConfirmation={typed}
      danger={direction === "debit"}
      confirmLabel={direction === "debit" ? "Yechish" : "Qo'shish"}
      confirmDisabled={!amountOk || insufficient}
      onConfirm={async ({ reason, idempotencyKey }) => {
        try {
          const result = await adjustWallet(
            user.id,
            { wallet, delta, reasonCode, reason, ...(typed ? { confirm: typed } : {}) },
            idempotencyKey,
          );
          toast(`${WALLET_LABEL[wallet]} tuzatildi: ${fmtNumber(result.before)} → ${fmtNumber(result.after)}`);
          onDone?.(result);
        } catch (e) {
          throw moneyError(e);
        }
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label htmlFor={`${ids}-wallet`} className={LABEL_CLASS}>
          Hamyon
          <select id={`${ids}-wallet`} value={wallet} onChange={(e) => setWallet(e.target.value === "points" ? "points" : "balance")} className={FIELD_CLASS}>
            {ADJUSTABLE_WALLET_IDS.map((w) => (
              <option key={w} value={w}>
                {WALLET_LABEL[w]} ({fmtNumber(user[w])})
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${ids}-direction`} className={LABEL_CLASS}>
          Amal
          <select
            id={`${ids}-direction`}
            value={direction}
            onChange={(e) => setDirection(e.target.value === "debit" ? "debit" : "credit")}
            className={FIELD_CLASS}
          >
            <option value="credit">{"Qo'shish (+)"}</option>
            <option value="debit">Yechish (−)</option>
          </select>
        </label>
        <label htmlFor={`${ids}-amount`} className={LABEL_CLASS}>
          Miqdor
          <input
            id={`${ids}-amount`}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            aria-describedby={`${ids}-amount-hint`}
            aria-invalid={Boolean(amountText) && (!amountOk || insufficient)}
            className={`${FIELD_CLASS} tabular-nums`}
          />
        </label>
        <label htmlFor={`${ids}-code`} className={LABEL_CLASS}>
          Sabab turi
          <select id={`${ids}-code`} value={reasonCode} onChange={(e) => setReasonCode(e.target.value as WalletReasonCode)} className={FIELD_CLASS}>
            {WALLET_REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {REASON_CODE_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span id={`${ids}-amount-hint`} className={insufficient ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
        {amountHint}
      </span>
    </ConfirmDialog>
  );
}
