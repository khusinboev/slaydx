import { ApiError, handler, json, readJson, requireUser } from "@/lib/server/api";
import { startCardPayment } from "@/lib/server/click-direct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Karta" step 1: asks Click for a ONE-TIME card token; Click texts a code to the card owner's
 * phone. Body `{ orderId, cardNumber, expireDate }` -> `{ phoneMasked }`.
 *
 * The body carries a card number: it is never logged (`handler` logs no bodies), never stored, and
 * only the one-time token reaches the database (`lib/server/click-direct.ts`).
 */
export const POST = handler("payments/click/card", async (req) => {
  const { user } = await requireUser(req);
  const body = await readJson<{ orderId?: unknown; cardNumber?: unknown; expireDate?: unknown }>(req, 2_000);
  if (typeof body.orderId !== "string" || typeof body.cardNumber !== "string" || typeof body.expireDate !== "string") {
    throw new ApiError("So'rov noto'g'ri", 400);
  }
  const out = await startCardPayment({
    userId: user.id,
    orderId: body.orderId,
    cardNumber: body.cardNumber.slice(0, 40),
    expireDate: body.expireDate.slice(0, 12),
  });
  return json(out);
});
