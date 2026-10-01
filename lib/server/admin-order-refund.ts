import "server-only";
import { ApiError } from "./api";
import { adminAdjustWalletInTx, type Wallet } from "./credits";
import { PRO_PLAN, SOUM_PER_COIN, type Purpose } from "./payments";
import { parseReason } from "./admin-accounts";
import type { AdminActor } from "./admin-handler";
import { ADMIN_LEDGER_NOTE } from "./admin-wallet";
import { bodyHashOf, idempotentMutation, type IdempotentResult } from "./admin-idempotency";

/**
 * External refunds and chargebacks (docs/admin/02-plan.md §5.2, §6.6, Q7).
 *
 * The provider already paid the money back outside the system; finance
 * records it here and optionally claws the credited wallet back:
 *   - the order must be `paid`; the recorded total never exceeds the order;
 *   - the clawback hits the wallet the settlement credited
 *     (`settleOrder`: topup → `balance` by `amountSoum / SOUM_PER_COIN`,
 *     pro → `quota`, `PRO_PLAN.quota` for `PRO_PLAN.priceSoum`), pro rata for
 *     a partial amount, and never below zero — the rest is `shortfall`;
 *   - the debit is an `admin_debit` ledger row with
 *     `reference = 'refund:' || payment_refunds.id`, so it can never be
 *     written twice for the same record.
 * All of it is one transaction with the audit row.
 */

export const REFUND_KINDS = ["refund", "chargeback"] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];

export type ExternalRefundInput = {
  kind: RefundKind;
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
  clawbackWallet: Wallet | null;
  clawbackAmount: number;
  shortfall: number;
  clawbackTxId: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type ClawbackResult = { wallet: Wallet; requested: number; debited: number; shortfall: number };

export type ExternalRefundResponse = {
  refund: PaymentRefundRecord;
  /** `null` when no clawback was requested. */
  clawback: ClawbackResult | null;
  /** Soum recorded against this order after this call. */
  recordedSoum: number;
  remainingSoum: number;
};

function isKind(v: unknown): v is RefundKind {
  return typeof v === "string" && (REFUND_KINDS as readonly string[]).includes(v);
}

export function parseExternalRefundBody(body: Record<string, unknown>): ExternalRefundInput {
  if (!isKind(body.kind)) throw new ApiError(`Tur noto'g'ri. Kerak: ${REFUND_KINDS.join(" | ")}`, 400);
  const amount = body.amountSoum;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new ApiError("Summa musbat butun son (so'm) bo'lishi kerak", 400);
  }
  if (typeof body.clawback !== "boolean") throw new ApiError("clawback mantiqiy qiymat bo'lishi kerak", 400);
  const reason = parseReason(body.reason)!;
  return { kind: body.kind, amountSoum: amount, reason, clawback: body.clawback };
}

/** The wallet `settleOrder` credited for this purpose. */
export function clawbackWalletOf(purpose: Purpose): Wallet {
  return purpose === "pro" ? "quota" : "balance";
}

/** Wallet units for `amountSoum`, mirroring the crediting formulas of `settleOrder`. */
export function clawbackUnits(purpose: Purpose, amountSoum: number): number {
  if (purpose === "pro") return Math.floor((amountSoum * PRO_PLAN.quota) / PRO_PLAN.priceSoum);
  return Math.floor(amountSoum / SOUM_PER_COIN);
}

type OrderRow = { id: string; user_id: string; purpose: Purpose; amount_soum: string; state: string };

type RefundRow = {
  id: string;
  order_id: string;
  amount_soum: string;
  kind: RefundKind;
  reason: string;
  clawback_wallet: Wallet | null;
  clawback_amount: string;
  shortfall: string;
  clawback_tx_id: string | null;
  created_by: string | null;
  created_at: Date;
};

const REFUND_COLS = `id::text AS id, order_id, amount_soum, kind, reason, clawback_wallet, clawback_amount, shortfall,
  clawback_tx_id::text AS clawback_tx_id, created_by::text AS created_by, created_at`;

function toRecord(r: RefundRow): PaymentRefundRecord {
  return {
    id: r.id,
    orderId: r.order_id,
    amountSoum: Number(r.amount_soum),
    kind: r.kind,
    reason: r.reason,
    clawbackWallet: r.clawback_wallet,
    clawbackAmount: Number(r.clawback_amount),
    shortfall: Number(r.shortfall),
    clawbackTxId: r.clawback_tx_id,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function recordExternalRefund(
  actor: AdminActor,
  orderId: string,
  input: ExternalRefundInput,
  idempotencyKey: string,
): Promise<IdempotentResult<ExternalRefundResponse>> {
  const bodyHash = bodyHashOf({ orderId, kind: input.kind, amountSoum: input.amountSoum, reason: input.reason, clawback: input.clawback });
  return idempotentMutation<ExternalRefundResponse>(actor, { action: "payments.refund_record", key: idempotencyKey, bodyHash }, async (client) => {
    const ord = await client.query<OrderRow>(
      `SELECT id, user_id::text AS user_id, purpose, amount_soum, state FROM payment_orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = ord.rows[0];
    if (!order) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    if (order.state !== "paid") {
      throw new ApiError(`Buyurtma holati ${order.state}; faqat to'langan buyurtma uchun mumkin`, 409, { code: "state", state: order.state });
    }
    const orderSoum = Number(order.amount_soum);
    const sum = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_soum), 0)::text AS total FROM payment_refunds WHERE order_id = $1`,
      [orderId],
    );
    const recorded = Number(sum.rows[0]!.total);
    const remaining = orderSoum - recorded;
    if (input.amountSoum > remaining) {
      throw new ApiError(`Summa qolgan miqdordan oshmasligi kerak. Qolgan: ${remaining.toLocaleString("uz-UZ")} so'm`, 409, {
        code: "amount",
        remaining,
      });
    }

    const wallet = clawbackWalletOf(order.purpose);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO payment_refunds (order_id, amount_soum, kind, reason, clawback_wallet, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text AS id`,
      [orderId, input.amountSoum, input.kind, input.reason, input.clawback ? wallet : null, actor.id],
    );
    const refundId = ins.rows[0]!.id;

    let clawback: ClawbackResult | null = null;
    let walletBefore: number | null = null;
    if (input.clawback) {
      const requested = clawbackUnits(order.purpose, input.amountSoum);
      const u = await client.query<Record<Wallet, string>>(`SELECT points, quota, balance FROM users WHERE id = $1 FOR UPDATE`, [order.user_id]);
      const available = Number(u.rows[0]![wallet]);
      walletBefore = available;
      const debited = Math.min(requested, available);
      let txId: string | null = null;
      if (debited > 0) {
        const r = await adminAdjustWalletInTx(client, {
          userId: order.user_id,
          wallet,
          delta: -debited,
          reference: `refund:${refundId}`,
          note: ADMIN_LEDGER_NOTE,
        });
        // The user row is locked above and `debited <= available`, so this cannot be insufficient.
        if (!r.ok) throw new Error("Clawback: hamyon qulfi ostida mablag' o'zgardi");
        txId = r.transactionId;
      }
      clawback = { wallet, requested, debited, shortfall: requested - debited };
      await client.query(
        `UPDATE payment_refunds SET clawback_amount = $2, shortfall = $3, clawback_tx_id = $4 WHERE id = $1`,
        [refundId, debited, clawback.shortfall, txId],
      );
    }

    const rec = await client.query<RefundRow>(`SELECT ${REFUND_COLS} FROM payment_refunds WHERE id = $1`, [refundId]);
    const refund = toRecord(rec.rows[0]!);
    const recordedSoum = recorded + input.amountSoum;
    return {
      response: { refund, clawback, recordedSoum, remainingSoum: orderSoum - recordedSoum },
      audit: {
        targetType: "order",
        targetId: orderId,
        reason: input.reason,
        before: { recordedSoum: recorded, ...(clawback ? { [wallet]: walletBefore } : {}) },
        after: {
          recordedSoum,
          ...(clawback ? { [wallet]: (walletBefore ?? 0) - clawback.debited, shortfall: clawback.shortfall } : {}),
        },
        meta: { kind: input.kind, amountSoum: input.amountSoum, refundId, clawback: input.clawback, userId: order.user_id },
      },
    };
  });
}
