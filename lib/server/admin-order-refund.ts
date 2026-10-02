import "server-only";
import { ApiError } from "./api";
import type { PoolClient } from "pg";
import { adminAdjustWalletInTx, type Wallet } from "./credits";
import type { Purpose } from "./payments";
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
 *   - the clawback always debits `balance`: subscriptions are removed and
 *     migration 034 merged every legacy Pro quota into `balance`, so that is
 *     where a legacy Pro order's credit lives now (a pro order settled after
 *     the removal credits `balance` directly). The amount is what THAT
 *     order's ledger row actually credited (`topup` / `subscription` row with
 *     reference `<provider>:<provider_txn ?? order id>`, `quota_delta +
 *     balance_delta`, so an old quota credit and a new balance credit both
 *     count), pro rata for a partial amount — today's prices are never
 *     consulted, so an order settled under an older price is clawed back
 *     correctly; no credit row → 409 `no_credit`. Never below zero — the
 *     rest is `shortfall`;
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

/**
 * The wallet a clawback debits: `balance` for every purpose. A legacy Pro
 * order's quota credit was merged into `balance` (migration 034) and quota is
 * never credited again, so debiting `quota` would always come up short.
 * Historical `payment_refunds.clawback_wallet = 'quota'` rows stay as written.
 */
export function clawbackWalletOf(purpose: Purpose): Wallet {
  void purpose;
  return "balance";
}

/** `amountSoum / orderSoum` of what the order credited, floored (never more than the credit). */
export function clawbackUnits(creditedUnits: number, amountSoum: number, orderSoum: number): number {
  if (!(creditedUnits > 0) || !(orderSoum > 0) || !(amountSoum > 0)) return 0;
  return Math.min(creditedUnits, Math.floor((creditedUnits * amountSoum) / orderSoum));
}

type OrderRow = { id: string; user_id: string; provider: string; provider_txn: string | null; purpose: Purpose; amount_soum: string; state: string };

/** The ledger reference `settleOrder` used for this order's credit. */
export function settlementReference(order: Pick<OrderRow, "id" | "provider" | "provider_txn">): string {
  return `${order.provider}:${order.provider_txn ?? order.id}`;
}

/**
 * Units the settlement wrote for this order: `quota_delta + balance_delta` of
 * its own `topup` / `subscription` row (a pre-removal Pro order credited
 * quota, a later one balance). `null` when there is no row.
 */
async function creditedUnits(client: PoolClient, order: OrderRow): Promise<number | null> {
  const kind = order.purpose === "pro" ? "subscription" : "topup";
  const res = await client.query<{ units: string }>(
    `SELECT (quota_delta + balance_delta)::text AS units FROM transactions WHERE kind = $1 AND reference = $2`,
    [kind, settlementReference(order)],
  );
  return res.rows[0] ? Number(res.rows[0].units) : null;
}

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
      `SELECT id, user_id::text AS user_id, provider, provider_txn, purpose, amount_soum, state FROM payment_orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = ord.rows[0];
    if (!order) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    // The wallet rule (§10 T13): no money action on one's own account.
    if (order.user_id === actor.userId) {
      throw new ApiError("O'z buyurtmangiz uchun qaytarishni yozib bo'lmaydi", 409, { code: "self" });
    }
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
    // Resolved before anything is written: a clawback without the credit row is refused whole.
    let requested = 0;
    if (input.clawback) {
      const credited = await creditedUnits(client, order);
      if (credited === null) {
        throw new ApiError("Buyurtmaning kredit yozuvi topilmadi — hamyondan yechib bo'lmaydi", 409, { code: "no_credit" });
      }
      requested = clawbackUnits(credited, input.amountSoum, orderSoum);
    }
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
