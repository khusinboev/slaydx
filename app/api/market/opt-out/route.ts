import { ApiError, json, readJson, requireUser } from "@/lib/server/api";
import { marketHandler } from "@/lib/server/market/http";
import { getMarketOptOut, setMarketOptOut } from "@/lib/server/market/opt-out";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Mening ishlarim bozorga chiqmasin». Deliberately NOT behind `market.enabled`: candidates are collected while the market
 * is dark (rollout §10.5), and a user's refusal must work before anyone sees the shop.
 */
export const GET = marketHandler("opt-out-read", async (req) => {
  const { user } = await requireUser(req);
  return json({ optOut: await getMarketOptOut(user.id) });
});

export const PUT = marketHandler("opt-out", async (req) => {
  const { user } = await requireUser(req);
  const body = await readJson<{ optOut?: unknown }>(req, 1_000);
  if (typeof body.optOut !== "boolean") throw new ApiError("Qiymat noto'g'ri", 400);
  const { optOut } = await setMarketOptOut(user.id, body.optOut);
  return json({ optOut });
});
