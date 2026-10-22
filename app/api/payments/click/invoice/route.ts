import { ApiError, handler, json, readJson, requireUser } from "@/lib/server/api";
import { assertOfferAccepted } from "@/lib/server/oferta";
import { sendClickInvoice } from "@/lib/server/click-direct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Telefon raqam": sends an invoice for the order to the Click app registered on that phone.
 * Body `{ orderId, phone }` -> `{ status: "sent" }`; the user confirms in the app, Click then calls
 * our Shop API and the client polls the order.
 */
export const POST = handler("payments/click/invoice", async (req) => {
  const { user } = await requireUser(req);
  await assertOfferAccepted(user.id); // public offer (D6); gate off = no-op
  const body = await readJson<{ orderId?: unknown; phone?: unknown }>(req, 1_000);
  if (typeof body.orderId !== "string" || typeof body.phone !== "string") throw new ApiError("So'rov noto'g'ri", 400);
  const out = await sendClickInvoice({ userId: user.id, orderId: body.orderId, phone: body.phone.slice(0, 24) });
  return json(out);
});
