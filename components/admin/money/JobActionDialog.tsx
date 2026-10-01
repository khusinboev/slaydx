"use client";

import { ConfirmDialog, toast } from "@/components/admin/ui";
import { fmtTanga } from "@/lib/admin-format";
import { cancelJob, failJob, refundJob, type ChargeSplit, type JobActionResult } from "@/lib/admin-api/money";
import { moneyError, refundText } from "./shared";

export type JobAction = "cancel" | "fail" | "refund";

export type JobActionTarget = {
  id: string;
  status: string;
  price: number;
  topic?: string | null;
  userName?: string | null;
};

export type JobActionDialogProps = {
  open: boolean;
  onClose: () => void;
  action: JobAction;
  generation: JobActionTarget;
  /** Called after the request succeeded (the list/detail refetches). */
  onDone?: (refunded: ChargeSplit | null, result: JobActionResult | null) => void;
};

const COPY: Record<JobAction, { title: string; description: string; confirm: string; from: string; to: string; danger: boolean }> = {
  cancel: {
    title: "Ishni bekor qilish",
    description: "Navbatdagi ish bekor qilinadi va yechilgan pul to'liq qaytariladi.",
    confirm: "Bekor qilish",
    from: "QUEUED",
    to: "REVOKED",
    danger: true,
  },
  fail: {
    title: "Ishni majburan to'xtatish",
    description: "Bajarilayotgan ish FAILED bo'ladi, worker qulfi olib tashlanadi va pul qaytariladi. Kech kelgan natija tashlanadi.",
    confirm: "To'xtatish",
    from: "IN_PROGRESS",
    to: "FAILED",
    danger: true,
  },
  refund: {
    title: "Pulni qo'lda qaytarish",
    description: "Xato bilan tugagan, puli qaytarilmagan ish uchun yechilgan summa aynan olingan hamyonlarga qaytariladi.",
    confirm: "Qaytarish",
    from: "qaytarilmagan",
    to: "qaytarilgan",
    danger: false,
  },
};

/**
 * Cancel / force-fail / manual refund (plan §6.5): state before → after, the
 * audited reason and, for the refund, the `Idempotency-Key` from `ConfirmDialog`.
 */
export function JobActionDialog({ open, onClose, action, generation, onDone }: JobActionDialogProps) {
  const c = COPY[action];
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={c.title}
      description={c.description}
      target={
        <span>
          {generation.topic ? <span>{generation.topic} · </span> : null}
          <span className="font-mono text-xs">{generation.id}</span>
          {generation.userName ? <span className="text-muted-foreground"> · {generation.userName}</span> : null}
          <span className="text-muted-foreground"> · {fmtTanga(generation.price)}</span>
        </span>
      }
      before={c.from}
      after={c.to}
      reason={{ minLength: 5 }}
      danger={c.danger}
      confirmLabel={c.confirm}
      onConfirm={async ({ reason, idempotencyKey }) => {
        try {
          if (action === "refund") {
            const r = await refundJob(generation.id, reason, idempotencyKey);
            toast(`Pul qaytarildi — ${refundText(r.refunded)}`);
            onDone?.(r.refunded, null);
            return;
          }
          const r = action === "cancel" ? await cancelJob(generation.id, reason) : await failJob(generation.id, reason);
          toast(`${action === "cancel" ? "Ish bekor qilindi" : "Ish to'xtatildi"} — ${refundText(r.refunded)}`);
          onDone?.(r.refunded, r);
        } catch (e) {
          throw moneyError(e);
        }
      }}
    />
  );
}
