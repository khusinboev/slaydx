"use client";

import { useId, useState } from "react";
import { ConfirmDialog, toast } from "@/components/admin/ui";
import { fmtNumber, fmtSoum } from "@/lib/admin-format";
import { recordExternalRefund, REFUND_KINDS, type ExternalRefundResult, type RefundKind } from "@/lib/admin-api/money";
import { confirmText, FIELD_CLASS, LABEL_CLASS, moneyError, parseWholeNumber, WALLET_LABEL } from "./shared";

const KIND_LABEL: Record<RefundKind, string> = { refund: "Qaytarish (refund)", chargeback: "Chargeback" };

export type ExternalRefundTarget = {
  id: string;
  amountSoum: number;
  purpose: "topup" | "pro";
  /** Soum already recorded against this order. */
  recordedSoum: number;
  userName?: string | null;
};

export type ExternalRefundDialogProps = {
  open: boolean;
  onClose: () => void;
  order: ExternalRefundTarget;
  onDone?: (result: ExternalRefundResult) => void;
};

/**
 * Records an external refund / chargeback (plan §6.6). Above half of the
 * order the amount is typed back. The clawback debits the wallet the order
 * credited (balance for a top-up, Pro quota for a subscription), never below zero.
 */
export function ExternalRefundDialog(props: ExternalRefundDialogProps) {
  if (!props.open) return null;
  return <Body {...props} />;
}

function Body({ onClose, order, onDone }: ExternalRefundDialogProps) {
  const ids = useId();
  const remaining = Math.max(0, order.amountSoum - order.recordedSoum);
  const [kind, setKind] = useState<RefundKind>("refund");
  const [amountText, setAmountText] = useState(String(remaining));
  const [clawback, setClawback] = useState(true);

  const amount = parseWholeNumber(amountText);
  const amountOk = amount !== null && amount > 0 && amount <= remaining;
  const big = amountOk && amount > order.amountSoum / 2;
  const typed = big ? confirmText(amount) : undefined;
  const wallet = order.purpose === "pro" ? "quota" : "balance";

  const hint =
    remaining === 0
      ? "Bu buyurtma bo'yicha to'liq summa allaqachon qayd etilgan"
      : amountText && !amountOk
        ? `Butun son, eng ko'pi ${fmtNumber(remaining)} (qolgan summa)`
        : big
          ? "Buyurtmaning yarmidan ko'pi — summa yozib tasdiqlanadi"
          : "";

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Tashqi qaytarishni qayd etish"
      description="Pul provayder orqali qaytarilgan; bu yerda u hisobga olinadi va xohlasangiz foydalanuvchi hamyonidan yechiladi."
      target={
        <span>
          Buyurtma <span className="font-mono text-xs">{order.id}</span>
          {order.userName ? <span className="text-muted-foreground"> · {order.userName}</span> : null}
          <span className="text-muted-foreground"> · {fmtSoum(order.amountSoum)}</span>
        </span>
      }
      before={`Qayd etilgan: ${fmtSoum(order.recordedSoum)}`}
      after={fmtSoum(order.recordedSoum + (amountOk ? amount : 0))}
      reason={{ minLength: 5 }}
      typedConfirmation={typed}
      danger={clawback}
      confirmLabel="Qayd etish"
      confirmDisabled={!amountOk}
      onConfirm={async ({ reason, idempotencyKey }) => {
        try {
          const result = await recordExternalRefund(order.id, { kind, amountSoum: amount ?? 0, reason, clawback }, idempotencyKey);
          const cb = result.clawback;
          toast(
            cb
              ? `Qayd etildi: ${fmtSoum(result.refund.amountSoum)}; ${WALLET_LABEL[cb.wallet].toLowerCase()}dan yechildi: ${fmtNumber(cb.debited)}${cb.shortfall ? `, yetishmadi: ${fmtNumber(cb.shortfall)}` : ""}`
              : `Qayd etildi: ${fmtSoum(result.refund.amountSoum)} (hamyonga tegilmadi)`,
          );
          onDone?.(result);
        } catch (e) {
          throw moneyError(e);
        }
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label htmlFor={`${ids}-kind`} className={LABEL_CLASS}>
          Turi
          <select id={`${ids}-kind`} value={kind} onChange={(e) => setKind(e.target.value === "chargeback" ? "chargeback" : "refund")} className={FIELD_CLASS}>
            {REFUND_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${ids}-amount`} className={LABEL_CLASS}>
          {"Summa (so'm)"}
          <input
            id={`${ids}-amount`}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            aria-describedby={`${ids}-hint`}
            aria-invalid={Boolean(amountText) && !amountOk}
            disabled={remaining === 0}
            className={`${FIELD_CLASS} tabular-nums`}
          />
        </label>
      </div>
      <span id={`${ids}-hint`} className="text-muted-foreground text-xs">
        {hint}
      </span>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" checked={clawback} onChange={(e) => setClawback(e.target.checked)} className="mt-0.5" />
        <span>
          <span className="font-semibold">Hamyondan yechish</span>
          <span className="text-muted-foreground block text-xs">
            {WALLET_LABEL[wallet]}dan shu summaga mos miqdor yechiladi; yetmasa — qolgani «yetishmovchilik» sifatida yoziladi, hamyon manfiyga tushmaydi.
          </span>
        </span>
      </label>
    </ConfirmDialog>
  );
}
