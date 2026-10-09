import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { type CardType, checkoutUrl, isCardType } from "@/lib/server/checkout-url";
import { paymentsConfigured } from "@/lib/server/env";
import { log } from "@/lib/server/log";
import { PRO_REMOVED_MESSAGE, createOrder, listOrders, type Provider } from "@/lib/server/payments";
import { userMessage } from "@/lib/server/user-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler("payments/orders", async (req) => {
  const { user } = await requireUser(req);
  return json({ orders: await listOrders(user.id), providers: paymentsConfigured() });
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

  const body = await readJson<{ provider?: string; purpose?: string; amount?: number; card?: unknown }>(req, 4_000);
  const provider = body.provider === "payme" ? "payme" : body.provider === "click" ? "click" : null;
  /*
   * Obuna olib tashlangan (2026-10): eski ochiq tab yoki keshlangan klient
   * `pro` yuborsa — aniq rad, jim `topup` ga aylantirilmaydi (summa boshqa).
   */
  if (body.purpose === "pro") throw new ApiError(PRO_REMOVED_MESSAGE, 400, { code: "pro_removed" });
  const purpose = "topup" as const;

  if (!provider) throw new ApiError("To'lov usuli tanlanmagan", 400);

  /*
   * «Karta orqali» (Click): `card` = `uzcard` | `humo` — o'sha Click buyurtmasi,
   * faqat to'lov sahifasi karta formasini darhol ochadi. Boshqa qiymat yoki
   * Click'dan boshqa provayder bilan — aniq rad (jim e'tiborsiz qoldirilmaydi).
   */
  let card: CardType | undefined;
  if (body.card !== undefined && body.card !== null) {
    if (provider !== "click" || !isCardType(body.card)) throw new ApiError("Karta turi noto'g'ri", 400);
    card = body.card;
  }

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
    /*
     * `createOrder` ATAYIN o'zbekcha xato tashlaydi (summa oralig'i) — u 400
     * bilan foydalanuvchiga boradi. Boshqa har qanday xato (pg, ulanish)
     * xom matni javobga chiqmasin (BEA-09): `handler` uni 500 + `requestId`
     * ga aylantiradi va stack bilan jurnalga yozadi.
     */
    const safe = userMessage(e, "");
    if (!safe) throw e;
    log("info", "[payments] buyurtma rad etildi", { provider, purpose, amount: body.amount, reason: safe });
    throw new ApiError(safe, 400);
  }

  return json({ order, checkoutUrl: checkoutUrl(order.provider, order.id, order.amountSoum, { card }) }, { status: 201 });
});
