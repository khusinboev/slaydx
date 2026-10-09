import "server-only";
import { createHash } from "node:crypto";
import { ApiError, limit } from "./api";
import {
  ClickMerchantError,
  clickMerchantConfigured,
  createInvoice,
  payWithCardToken,
  requestCardToken,
  verifyCardToken,
} from "./click-merchant";
import { clickDirectConfigured } from "./env";
import { log } from "./log";
import { query, queryOne } from "./db";
import { normalizeCardNumber, normalizePhone, normalizeSmsCode, parseExpiry } from "../click-input";

/**
 * Direct Click payment methods: our own card form and "invoice to the Click app by phone"
 * (owner decision 2026-10-09). The Click page stays as the fallback (`checkoutUrl`).
 *
 * MONEY RULE: nothing here credits a balance. The Merchant API calls only START a payment;
 * Click then calls our Shop API (Prepare / Complete in `app/api/payments/click/route.ts`) and
 * `settleOrder` credits it once (+ the payment bonus). A route answering "paid" merely re-reads
 * `payment_orders.state`.
 *
 * SENSITIVE DATA (one-time tokens, owner decision (c)):
 *   - card number / expiry / SMS code live only in the arguments of these functions and the
 *     outgoing Click request. They are never logged, stored or put into an Error;
 *   - the one-time card token is stored in `payment_orders.click_card_token` only between
 *     "SMS sent" and "payment submitted", and is cleared (atomically claimed) before the payment
 *     call -- a second concurrent confirm cannot reuse it. Nothing is saved for later.
 *
 * ABUSE LIMITS (the Click calls cost SMS to third parties and can probe cards):
 *   - card request: 6 / hour / user, 3 / 15 min / order;
 *   - SMS confirm: 5 attempts / 15 min / order, 15 / 15 min / user;
 *   - invoice: 5 / hour / user, 3 / 15 min / order, 5 / day / target phone (hashed in the key).
 *
 * Ownership is enforced IN SQL (`WHERE id = $1 AND user_id = $2`): a foreign order answers 404
 * exactly like a missing one.
 */

export type ClickOrderStatus = "paid" | "pending" | "cancelled";

type ClickOrderRow = {
  id: string;
  provider: string;
  amount_soum: string;
  state: "created" | "pending" | "paid" | "cancelled";
  click_card_token: string | null;
};

const UUID = /^[0-9a-f-]{36}$/i;
const NOT_FOUND = "Buyurtma topilmadi";

/** Fails (503) unless the Shop API keys AND the Merchant API credentials are configured. */
export function assertClickDirectAvailable(): void {
  if (!clickDirectConfigured() || !clickMerchantConfigured()) {
    throw new ApiError("Click orqali to'g'ridan-to'g'ri to'lov hozircha mavjud emas. Boshqa usulni tanlang", 503, {
      code: "click_direct_unavailable",
    });
  }
}

/** The caller's own Click order that can still be paid; everything else is a precise 4xx. */
async function loadPayableOrder(userId: string, orderId: string): Promise<ClickOrderRow> {
  if (!UUID.test(orderId)) throw new ApiError(NOT_FOUND, 404);
  const row = await queryOne<ClickOrderRow>(
    `SELECT id, provider, amount_soum, state, click_card_token
       FROM payment_orders
      WHERE id = $1 AND user_id = $2`,
    [orderId, userId],
  );
  if (!row) throw new ApiError(NOT_FOUND, 404);
  if (row.provider !== "click") throw new ApiError("Bu buyurtma Click uchun emas", 400);
  if (row.state === "paid") throw new ApiError("Bu buyurtma allaqachon to'langan", 409, { code: "already_paid" });
  if (row.state === "cancelled") throw new ApiError("Bu buyurtma bekor qilingan. Yangi to'lov boshlang", 409, { code: "cancelled" });
  return row;
}

/** `ClickMerchantError` -> `ApiError` (503 when Click is unreachable / not configured, else 422). */
function toApiError(e: unknown): never {
  if (e instanceof ClickMerchantError) {
    const down = e.failure === "unavailable" || e.failure === "config";
    throw new ApiError(e.userMessage, down ? 503 : 422, { code: down ? "click_unavailable" : "click_declined" });
  }
  throw e;
}

/** Order state as the client polls it (`paid` only once the Shop API Complete settled it). */
async function stateOf(userId: string, orderId: string): Promise<ClickOrderStatus> {
  const row = await queryOne<{ state: ClickOrderRow["state"] }>(
    `SELECT state FROM payment_orders WHERE id = $1 AND user_id = $2`,
    [orderId, userId],
  );
  return row?.state === "paid" ? "paid" : row?.state === "cancelled" ? "cancelled" : "pending";
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

/**
 * Step 1 of "Karta": asks Click for a ONE-TIME card token; Click texts a code to the card
 * owner's phone. Returns the masked phone for the UI.
 */
export async function startCardPayment(input: {
  userId: string;
  orderId: string;
  cardNumber: string;
  expireDate: string;
}): Promise<{ phoneMasked: string }> {
  assertClickDirectAvailable();
  const card = normalizeCardNumber(input.cardNumber);
  if (!card) throw new ApiError("Karta raqami noto'g'ri. Faqat Uzcard va Humo qabul qilinadi", 400, { field: "cardNumber" });
  const exp = parseExpiry(input.expireDate);
  if (!exp.ok) throw new ApiError(exp.error, 400, { field: "expireDate" });

  await limit(`click-card:u:${input.userId}`, 6, 3600);
  const order = await loadPayableOrder(input.userId, input.orderId);
  await limit(`click-card:o:${order.id}`, 3, 900);

  let token: { cardToken: string; phoneMasked: string };
  try {
    token = await requestCardToken({ cardNumber: card, expireDate: exp.mmyy }, { orderId: order.id, method: "card" });
  } catch (e) {
    toApiError(e);
  }
  const saved = await queryOne<{ id: string }>(
    `UPDATE payment_orders
        SET click_method = 'card', click_card_token = $3, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND state IN ('created', 'pending')
      RETURNING id`,
    [order.id, input.userId, token.cardToken],
  );
  if (!saved) throw new ApiError("Buyurtma holati o'zgardi. Qayta urinib ko'ring", 409);
  log("info", "[click-direct] SMS sent", { orderId: order.id, method: "card" });
  return { phoneMasked: token.phoneMasked };
}

/**
 * Step 2 of "Karta": confirms the SMS code and submits the payment. The credit arrives through
 * the Shop API; the returned status is just the order state at this moment.
 */
export async function confirmCardPayment(input: {
  userId: string;
  orderId: string;
  smsCode: string;
}): Promise<{ status: ClickOrderStatus }> {
  assertClickDirectAvailable();
  const code = normalizeSmsCode(input.smsCode);
  if (!code) throw new ApiError("SMS kod 4-8 ta raqamdan iborat", 400, { field: "smsCode" });

  await limit(`click-verify:u:${input.userId}`, 15, 900);
  const order = await loadPayableOrder(input.userId, input.orderId);
  if (!order.click_card_token) {
    throw new ApiError("SMS so'ralmagan yoki muddati o'tgan. Karta ma'lumotlarini qayta kiriting", 409, { code: "no_token" });
  }
  await limit(`click-verify:o:${order.id}`, 5, 900);
  const cardToken = order.click_card_token;
  const ctx = { orderId: order.id, method: "card" } as const;

  try {
    await verifyCardToken({ cardToken, smsCode: code }, ctx);
  } catch (e) {
    toApiError(e);
  }

  // Claim the token: only ONE concurrent confirm gets to submit the payment.
  const claimed = await queryOne<{ id: string }>(
    `UPDATE payment_orders
        SET click_card_token = NULL, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND click_card_token = $3 AND state IN ('created', 'pending')
      RETURNING id`,
    [order.id, input.userId, cardToken],
  );
  if (!claimed) return { status: await stateOf(input.userId, order.id) };

  try {
    const paid = await payWithCardToken({ cardToken, amountSoum: Number(order.amount_soum), orderId: order.id }, ctx);
    await query(`UPDATE payment_orders SET click_payment_id = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, [
      order.id,
      input.userId,
      paid.paymentId,
    ]);
  } catch (e) {
    if (e instanceof ClickMerchantError && e.outcomeUnknown) {
      // The charge may have gone through (timeout / 5xx): do NOT say "failed" -- the Shop API
      // Complete may still arrive; the client keeps polling the order.
      log("warn", "[click-direct] payment outcome unknown", { orderId: order.id, method: "card", errorCode: e.errorCode });
      return { status: await stateOf(input.userId, order.id) };
    }
    toApiError(e);
  }
  return { status: await stateOf(input.userId, order.id) };
}

/** "Telefon raqam": sends an invoice to the Click app registered on `phone`. */
export async function sendClickInvoice(input: {
  userId: string;
  orderId: string;
  phone: string;
}): Promise<{ status: "sent" }> {
  assertClickDirectAvailable();
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiError("Telefon raqami noto'g'ri (+998 90 123 45 67)", 400, { field: "phone" });

  await limit(`click-invoice:u:${input.userId}`, 5, 3600);
  const order = await loadPayableOrder(input.userId, input.orderId);
  await limit(`click-invoice:o:${order.id}`, 3, 900);
  await limit(`click-invoice:p:${hash(phone)}`, 5, 86_400);

  let invoice: { invoiceId: string };
  try {
    invoice = await createInvoice({ phone, amountSoum: Number(order.amount_soum), orderId: order.id }, { orderId: order.id, method: "phone" });
  } catch (e) {
    toApiError(e);
  }
  const saved = await queryOne<{ id: string }>(
    `UPDATE payment_orders
        SET click_method = 'phone', click_invoice_id = $3, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND state IN ('created', 'pending')
      RETURNING id`,
    [order.id, input.userId, invoice.invoiceId],
  );
  // The invoice already exists at Click; a state change in between (e.g. paid by other means) is harmless.
  if (!saved) log("warn", "[click-direct] invoice sent but order no longer payable", { orderId: order.id });
  log("info", "[click-direct] invoice sent", { orderId: order.id, method: "phone" });
  return { status: "sent" };
}
