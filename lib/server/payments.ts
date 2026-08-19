import "server-only";
import { randomUUID } from "node:crypto";
import { query, queryOne, transaction } from "./db";
import { activatePro, topUp } from "./credits";

/**
 * To'lov buyurtmalari va ularni kreditga aylantirish.
 *
 * Idempotentlik bu yerda hayotiy: Click ham, Payme ham webhook ni
 * takrorlaydi. Har provayder tranzaksiyasi `transactions.reference`
 * bo'yicha unikal — ikkinchi chaqiruv pul qo'shmaydi.
 */

/** Pro tarifi. Narx o'zgarsa faqat shu yer tahrirlanadi. */
export const PRO_PLAN = {
  priceSoum: 15_000,
  days: 30,
  quota: 15_000,
} as const;

/** Balans to'ldirishda 1 so'm = 1 tanga. */
export const SOUM_PER_COIN = 1;

export const MIN_TOPUP_SOUM = 5_000;
export const MAX_TOPUP_SOUM = 10_000_000;

export type Provider = "click" | "payme";
export type Purpose = "topup" | "pro";
export type OrderState = "created" | "pending" | "paid" | "cancelled";

export type PaymentOrder = {
  id: string;
  userId: string;
  provider: Provider;
  purpose: Purpose;
  amountSoum: number;
  state: OrderState;
  providerTxn: string | null;
  /** Provayder tranzaksiyasi yaratilgan vaqt (ms). */
  createTime: number;
  /** To'lov bajarilgan vaqt (ms). To'lanmagan bo'lsa 0. */
  performTime: number;
  cancelTime: number;
  cancelReason: number | null;
  /** Click `merchant_prepare_id` — u butun son kutadi. */
  prepareId: number | null;
  createdAt: string;
};

type OrderRow = {
  id: string;
  user_id: string;
  provider: Provider;
  purpose: Purpose;
  amount_soum: string;
  state: OrderState;
  provider_txn: string | null;
  create_time: string;
  perform_time: string;
  cancel_time: string;
  cancel_reason: number | null;
  prepare_id: string | null;
  created_at: Date;
};

function toOrder(r: OrderRow): PaymentOrder {
  return {
    id: r.id,
    userId: String(r.user_id),
    provider: r.provider,
    purpose: r.purpose,
    amountSoum: Number(r.amount_soum),
    state: r.state,
    providerTxn: r.provider_txn,
    createTime: Number(r.create_time),
    performTime: Number(r.perform_time),
    cancelTime: Number(r.cancel_time),
    cancelReason: r.cancel_reason,
    prepareId: r.prepare_id === null ? null : Number(r.prepare_id),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const COLS = `id, user_id, provider, purpose, amount_soum, state, provider_txn,
              create_time, perform_time, cancel_time, cancel_reason, prepare_id, created_at`;

export async function createOrder(input: {
  userId: string;
  provider: Provider;
  purpose: Purpose;
  amountSoum: number;
}): Promise<PaymentOrder> {
  const amount = input.purpose === "pro" ? PRO_PLAN.priceSoum : Math.round(input.amountSoum);
  if (amount < MIN_TOPUP_SOUM || amount > MAX_TOPUP_SOUM) {
    throw new Error(
      `Summa ${MIN_TOPUP_SOUM.toLocaleString("uz-UZ")} — ${MAX_TOPUP_SOUM.toLocaleString("uz-UZ")} so'm oralig'ida bo'lishi kerak`,
    );
  }
  const row = await queryOne<OrderRow>(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLS}`,
    [randomUUID(), input.userId, input.provider, input.purpose, amount],
  );
  return toOrder(row!);
}

export async function findOrder(id: string): Promise<PaymentOrder | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await queryOne<OrderRow>(`SELECT ${COLS} FROM payment_orders WHERE id = $1`, [id]);
  return row ? toOrder(row) : null;
}

export async function findOrderByTxn(provider: Provider, txn: string): Promise<PaymentOrder | null> {
  const row = await queryOne<OrderRow>(
    `SELECT ${COLS} FROM payment_orders WHERE provider = $1 AND provider_txn = $2`,
    [provider, txn],
  );
  return row ? toOrder(row) : null;
}

export async function listOrders(userId: string, limit = 20): Promise<PaymentOrder[]> {
  const rows = await query<OrderRow>(
    `SELECT ${COLS} FROM payment_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(limit, 100)],
  );
  return rows.map(toOrder);
}

/**
 * Buyurtmani provayder tranzaksiyasiga bog'laydi
 * (Payme `CreateTransaction`, Click `Prepare`).
 *
 * `create_time` **alohida** ustunga yoziladi: ilgari u `perform_time` ga
 * tushardi va to'lov bajarilgach «yaratilgan vaqt» ham o'zgarib ketardi.
 */
export async function attachTransaction(
  orderId: string,
  txn: string,
  createTime: number,
): Promise<boolean> {
  return transaction(async (client) => {
    const cur = await client.query<OrderRow>(
      `SELECT ${COLS} FROM payment_orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = cur.rows[0];
    if (!order) return false;
    // Boshqa tranzaksiya allaqachon biriktirilgan — bu buyurtma band.
    if (order.provider_txn && order.provider_txn !== txn) return false;
    if (order.state === "paid" || order.state === "cancelled") return order.provider_txn === txn;

    await client.query(
      `UPDATE payment_orders
          SET provider_txn = $2,
              state = 'pending',
              create_time = $3,
              prepare_id = COALESCE(prepare_id, nextval('payment_prepare_seq')),
              updated_at = now()
        WHERE id = $1`,
      [orderId, txn, createTime],
    );
    return true;
  });
}

/** Click `merchant_prepare_id` bo'yicha buyurtma. */
export async function findOrderByPrepareId(prepareId: number): Promise<PaymentOrder | null> {
  if (!Number.isSafeInteger(prepareId)) return null;
  const row = await queryOne<OrderRow>(`SELECT ${COLS} FROM payment_orders WHERE prepare_id = $1`, [
    prepareId,
  ]);
  return row ? toOrder(row) : null;
}

/**
 * To'lovni yakunlaydi: buyurtmani `paid` qiladi va kreditni qo'shadi.
 *
 * `reference` provayder tranzaksiya id sidan quriladi, shuning uchun
 * takroriy webhook ikkinchi marta pul qo'shmaydi.
 */
export async function settleOrder(
  orderId: string,
  performTime: number,
): Promise<{ ok: boolean; order: PaymentOrder | null }> {
  const order = await findOrder(orderId);
  if (!order) return { ok: false, order: null };
  if (order.state === "cancelled") return { ok: false, order };

  const reference = `${order.provider}:${order.providerTxn ?? order.id}`;

  if (order.purpose === "pro") {
    await activatePro(order.userId, PRO_PLAN.quota, PRO_PLAN.days, reference);
  } else {
    await topUp(
      order.userId,
      { balance: Math.floor(order.amountSoum / SOUM_PER_COIN) },
      reference,
      "topup",
      `${order.provider} orqali to'ldirish`,
    );
  }

  await query(
    `UPDATE payment_orders
        SET state = 'paid',
            perform_time = $2,
            -- Yaratilish vaqti noma'lum bo'lsa (Click Prepare siz
            -- to'g'ridan-to'g'ri Complete yuborgan holat), to'lov
            -- vaqtini qo'yamiz — nol qolishidan yaxshiroq.
            create_time = CASE WHEN create_time = 0 THEN $2 ELSE create_time END,
            updated_at = now()
      WHERE id = $1 AND state <> 'cancelled'`,
    [orderId, performTime],
  );
  return { ok: true, order: await findOrder(orderId) };
}

export async function cancelOrder(
  orderId: string,
  cancelTime: number,
  reason: number | null,
): Promise<PaymentOrder | null> {
  await query(
    `UPDATE payment_orders
        SET state = 'cancelled', cancel_time = $2, cancel_reason = $3, updated_at = now()
      WHERE id = $1`,
    [orderId, cancelTime, reason],
  );
  return findOrder(orderId);
}
