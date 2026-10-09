import "server-only";
import { env } from "./env";
import type { Provider } from "./payments";

/**
 * Provayderning to'lov sahifasi URL i (`POST /api/payments/orders` javobi).
 *
 * Click: `https://my.click.uz/services/pay` ssilkasi (docs.click.uz «Click
 * tugmasi») — `service_id`, `merchant_id`, `amount` (N.NN), `transaction_param`
 * (bizning buyurtma id), `return_url`. «Karta orqali» (docs.click.uz «Pay by
 * card») shu SSILKAning o'zi, faqat `card_type=uzcard|humo` qo'shiladi:
 * Click karta kiritish sahifasini darhol ochadi. Buyurtma ham, Prepare/Complete
 * ham bir xil (`provider: "click"`) — farq faqat to'lov sahifasida.
 */

export const CARD_TYPES = ["uzcard", "humo"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export function isCardType(v: unknown): v is CardType {
  return typeof v === "string" && (CARD_TYPES as readonly string[]).includes(v);
}

/** Summalar: Click — so'm (`N.NN`), Payme — tiyin. */
export function checkoutUrl(
  provider: Provider,
  orderId: string,
  amountSoum: number,
  opts: { card?: CardType } = {},
): string {
  const returnUrl = `${env.appUrl}/uz/purchase?order=${orderId}`;
  if (provider === "click") {
    const u = new URL("https://my.click.uz/services/pay");
    u.searchParams.set("service_id", env.click.serviceId);
    u.searchParams.set("merchant_id", env.click.merchantId);
    u.searchParams.set("amount", amountSoum.toFixed(2));
    u.searchParams.set("transaction_param", orderId);
    u.searchParams.set("return_url", returnUrl);
    if (opts.card) u.searchParams.set("card_type", opts.card);
    return u.toString();
  }
  // Payme checkout parametrlarni base64 qilingan qator sifatida kutadi.
  const payload = [
    `m=${env.payme.merchantId}`,
    `ac.order_id=${orderId}`,
    `a=${amountSoum * 100}`,
    `c=${returnUrl}`,
  ].join(";");
  return `https://checkout.paycom.uz/${Buffer.from(payload).toString("base64")}`;
}
