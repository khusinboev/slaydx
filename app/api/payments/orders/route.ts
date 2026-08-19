import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { env, paymentsConfigured } from "@/lib/server/env";
import { PRO_PLAN, createOrder, listOrders, type Provider, type Purpose } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler("payments/orders", async (req) => {
  const { user } = await requireUser(req);
  return json({ orders: await listOrders(user.id), plan: PRO_PLAN, providers: paymentsConfigured() });
});

/**
 * Buyurtma yaratadi va provayder to'lov sahifasiga URL qaytaradi.
 *
 * Kredit shu yerda **qo'shilmaydi** — faqat webhook tasdiqlagandan keyin.
 * Ilgari «To'lov usuli» tugmasi darhol 15 000 kvota berardi: ya'ni
 * bepul pul tugmasi edi.
 */
export const POST = handler("payments/create", async (req) => {
  const { user } = await requireUser(req);
  await limit(`pay:${user.id}`, 10, 300);

  const body = await readJson<{ provider?: string; purpose?: string; amount?: number }>(req, 4_000);
  const provider = body.provider === "payme" ? "payme" : body.provider === "click" ? "click" : null;
  const purpose: Purpose = body.purpose === "pro" ? "pro" : "topup";

  if (!provider) throw new ApiError("To'lov usuli tanlanmagan", 400);

  const available = paymentsConfigured();
  if (!available[provider]) {
    throw new ApiError(
      `${provider === "click" ? "Click" : "Payme"} hali ulanmagan. Administrator kalitlarni sozlashi kerak.`,
      503,
    );
  }

  let order;
  try {
    order = await createOrder({
      userId: user.id,
      provider: provider as Provider,
      purpose,
      amountSoum: Number(body.amount ?? 0),
    });
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : "Buyurtma yaratilmadi", 400);
  }

  return json({ order, checkoutUrl: checkoutUrl(order.provider, order.id, order.amountSoum) }, { status: 201 });
});

/** Provayderning to'lov sahifasi. Summalar: Click — so'm, Payme — tiyin. */
function checkoutUrl(provider: Provider, orderId: string, amountSoum: number): string {
  const returnUrl = `${env.appUrl}/uz/purchase?order=${orderId}`;
  if (provider === "click") {
    const u = new URL("https://my.click.uz/services/pay");
    u.searchParams.set("service_id", env.click.serviceId);
    u.searchParams.set("merchant_id", env.click.merchantId);
    u.searchParams.set("amount", String(amountSoum));
    u.searchParams.set("transaction_param", orderId);
    u.searchParams.set("return_url", returnUrl);
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
