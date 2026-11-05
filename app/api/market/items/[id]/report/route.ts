import { ApiError, json, limit, readJson, requireUser } from "@/lib/server/api";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { assertMarketOpen, marketHandler } from "@/lib/server/market/http";
import { reportMarketItem } from "@/lib/server/market/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** «Shikoyat»: one per user per item; a repeat answers `reported: false`, it is no error. */
export const POST = marketHandler("report", async (req: Request, ctx: Ctx) => {
  const { user, ip } = await requireUser(req);
  await assertMarketOpen(user);
  const { marketReportPerIp: perIp } = IP_LIMITS;
  await limit(`market:report:ip:${ip}`, perIp.count, perIp.windowSec);
  await limit(`market:report:user:${user.id}`, 10, 3600);
  const { id } = await ctx.params;
  const body = await readJson<{ reason?: unknown }>(req, 5_000);
  if (body.reason !== undefined && typeof body.reason !== "string") throw new ApiError("Sabab noto'g'ri", 400);
  const { reported } = await reportMarketItem({ userId: user.id, itemId: id, reason: typeof body.reason === "string" ? body.reason : "" });
  return json({ reported });
});
