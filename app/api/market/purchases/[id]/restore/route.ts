import { json, limit, readJson, requireUser } from "@/lib/server/api";
import { env } from "@/lib/server/env";
import { assertMarketOpen, marketHandler } from "@/lib/server/market/http";
import { cleanPurchaseFields } from "@/lib/server/market/purchase";
import { restorePurchase } from "@/lib/server/market/restore";
import { startInlineWorker } from "@/lib/server/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * «Qayta tiklash»: a new copy for free, for a buyer who paid and lost it (`canRestore`). `fields` is optional; it fills
 * the title page when the lost copy's row is gone. Repeating it while a copy exists returns that copy (`restored: false`).
 */
export const POST = marketHandler("restore", async (req: Request, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await assertMarketOpen(user);
  await limit(`market:restore:${user.id}`, 10, 3600);
  const { id } = await ctx.params;
  const body = await readJson<{ fields?: unknown }>(req, 20_000).catch(() => ({ fields: undefined }));
  const result = await restorePurchase({ userId: user.id, purchaseId: id, fields: cleanPurchaseFields(body.fields) });
  if (result.kind === "admission") {
    const { code, retryAfterSec, error } = result;
    return json({ error, code, retryAfterSec }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
  }
  if (result.restored && env.worker.inline) startInlineWorker();
  return json({ generationId: result.generationId, restored: result.restored });
});
