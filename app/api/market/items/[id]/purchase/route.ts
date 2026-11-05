import { ApiError, json, limit, readJson, requireUser } from "@/lib/server/api";
import { env } from "@/lib/server/env";
import { assertMarketOpen, marketHandler, requireIdempotencyKey } from "@/lib/server/market/http";
import { cleanPurchaseFields, purchaseMarketItem } from "@/lib/server/market/purchase";
import { startInlineWorker } from "@/lib/server/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Buys a copy (docs/market/PLAN.md §2.1). `Idempotency-Key` is required: a fresh UUID per confirmed click. */
export const POST = marketHandler("purchase", async (req: Request, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await assertMarketOpen(user);
  await limit(`market:buy:burst:${user.id}`, 10, 60);
  await limit(`market:buy:hour:${user.id}`, 60, 3600);
  const idempotencyKey = requireIdempotencyKey(req);
  const { id } = await ctx.params;
  const body = await readJson<{ expectedPrice?: unknown; fields?: unknown }>(req, 20_000);
  const expectedPrice = body.expectedPrice;
  if (typeof expectedPrice !== "number" || !Number.isSafeInteger(expectedPrice) || expectedPrice < 0) throw new ApiError("Kutilgan narx noto'g'ri", 400);

  const result = await purchaseMarketItem({ userId: user.id, itemId: id, expectedPrice, fields: cleanPurchaseFields(body.fields), idempotencyKey });
  if (result.kind === "admission") {
    const { code, retryAfterSec, error } = result;
    return json({ error, code, retryAfterSec }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
  }
  if (env.worker.inline) startInlineWorker();
  const { generationId, price, replayed } = result;
  return json({ generationId, price, replayed }, { headers: replayed ? { "Idempotent-Replayed": "true" } : undefined });
});
