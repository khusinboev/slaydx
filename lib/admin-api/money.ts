"use client";

import { adminSend, type AdminCallOptions } from "./core";

/**
 * Money actions API (docs/admin/02-plan.md §6.4 wallet adjustments, §6.5 job
 * cancel/fail/refund, §6.6 external refunds). Every money call takes the
 * `Idempotency-Key` the dialog generated once per open; `core.ts` reuses it on
 * the step-up retry. Types are declared here, never imported from
 * `lib/server/**` (tests/admin-boundary.test.mts).
 */

export type WalletId = "points" | "quota" | "balance";
export const WALLET_IDS: readonly WalletId[] = ["points", "quota", "balance"];

export const WALLET_REASON_CODES = ["compensation", "promo", "correction", "manual_refund", "test", "other"] as const;
export type WalletReasonCode = (typeof WALLET_REASON_CODES)[number];

/** Server-side cap on |delta| per request. */
export const MAX_WALLET_DELTA = 100_000_000;

export type WalletAdjustBody = {
  wallet: WalletId;
  /** Integer, not 0; positive credits, negative debits. */
  delta: number;
  reasonCode: WalletReasonCode;
  reason: string;
  /** The formatted |delta|, required at or above the confirm threshold. */
  confirm?: string;
};

export type WalletUserSnapshot = {
  id: string;
  name: string;
  username: string | null;
  points: number;
  quota: number;
  balance: number;
};

export type WalletAdjustResult = {
  transactionId: string;
  wallet: WalletId;
  before: number;
  after: number;
  user: WalletUserSnapshot;
};

/** POST /api/admin/users/:id/wallet-adjustments → 201. Errors: 409 `insufficient` {available}, 409 `self`, 400 `confirm`, 422 `idempotency_conflict`. */
export function adjustWallet(
  userId: string,
  body: WalletAdjustBody,
  idempotencyKey: string,
  opts?: AdminCallOptions,
): Promise<WalletAdjustResult> {
  return adminSend<WalletAdjustResult>("POST", `/api/admin/users/${encodeURIComponent(userId)}/wallet-adjustments`, body, {
    ...opts,
    idempotencyKey,
  });
}

export type ChargeSplit = { points: number; quota: number; balance: number };

export type AdminGenerationState = {
  id: string;
  userId: string;
  toolId: string;
  topic: string;
  status: string;
  price: number;
  progress: number;
  step: string;
  error: string | null;
  attempts: number;
  lockedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

/** `refunded` is `null` when nothing was returned (uncharged or already refunded job). */
export type JobActionResult = { generation: AdminGenerationState; refunded: ChargeSplit | null };

/** POST /api/admin/generations/:id/cancel (QUEUED only; 409 `state`). */
export function cancelJob(id: string, reason: string, opts?: AdminCallOptions): Promise<JobActionResult> {
  return adminSend<JobActionResult>("POST", `/api/admin/generations/${encodeURIComponent(id)}/cancel`, { reason }, opts);
}

/** POST /api/admin/generations/:id/fail (IN_PROGRESS only; 409 `state`). */
export function failJob(id: string, reason: string, opts?: AdminCallOptions): Promise<JobActionResult> {
  return adminSend<JobActionResult>("POST", `/api/admin/generations/${encodeURIComponent(id)}/fail`, { reason }, opts);
}

export type JobRefundResult = { refunded: ChargeSplit };

/** POST /api/admin/generations/:id/refund (FAILED, charged, unrefunded; 409 `not_refundable`). */
export function refundJob(id: string, reason: string, idempotencyKey: string, opts?: AdminCallOptions): Promise<JobRefundResult> {
  return adminSend<JobRefundResult>("POST", `/api/admin/generations/${encodeURIComponent(id)}/refund`, { reason }, { ...opts, idempotencyKey });
}

export const REFUND_KINDS = ["refund", "chargeback"] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];

export type ExternalRefundBody = {
  kind: RefundKind;
  /** Positive integer, at most the order amount minus what is already recorded. */
  amountSoum: number;
  reason: string;
  clawback: boolean;
};

export type PaymentRefundRecord = {
  id: string;
  orderId: string;
  amountSoum: number;
  kind: RefundKind;
  reason: string;
  clawbackWallet: WalletId | null;
  clawbackAmount: number;
  shortfall: number;
  clawbackTxId: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type ClawbackResult = { wallet: WalletId; requested: number; debited: number; shortfall: number };

export type ExternalRefundResult = {
  refund: PaymentRefundRecord;
  clawback: ClawbackResult | null;
  recordedSoum: number;
  remainingSoum: number;
};

/** POST /api/admin/orders/:id/external-refund → 201. Errors: 409 `state`, 409 `amount` {remaining}, 422 `idempotency_conflict`. */
export function recordExternalRefund(
  orderId: string,
  body: ExternalRefundBody,
  idempotencyKey: string,
  opts?: AdminCallOptions,
): Promise<ExternalRefundResult> {
  return adminSend<ExternalRefundResult>("POST", `/api/admin/orders/${encodeURIComponent(orderId)}/external-refund`, body, {
    ...opts,
    idempotencyKey,
  });
}
