import { ApiError, handler, json, readJson, requireUser } from "@/lib/server/api";
import { confirmCardPayment } from "@/lib/server/click-direct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Karta" step 2: confirms the SMS code and submits the payment. Body `{ orderId, smsCode }` ->
 * `{ status: "paid" | "pending" | "cancelled" }`. Money is credited only by the Click Shop API
 * `Complete`; `paid` just means it already arrived. The client polls the order while `pending`.
 */
export const POST = handler("payments/click/card/verify", async (req) => {
  const { user } = await requireUser(req);
  const body = await readJson<{ orderId?: unknown; smsCode?: unknown }>(req, 1_000);
  if (typeof body.orderId !== "string" || typeof body.smsCode !== "string") throw new ApiError("So'rov noto'g'ri", 400);
  const out = await confirmCardPayment({ userId: user.id, orderId: body.orderId, smsCode: body.smsCode.slice(0, 16) });
  return json(out);
});
