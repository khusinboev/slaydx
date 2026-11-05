import { json, limit, optionalUser } from "@/lib/server/api";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { assertMarketOpen, marketHandler } from "@/lib/server/market/http";
import { suggestMarketItems } from "@/lib/server/market/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Tayyor varianti bor»: up to three cards for the topic being typed in a tool's form. */
export const GET = marketHandler("suggest", async (req) => {
  const { user, ip } = await optionalUser(req);
  await assertMarketOpen(user);
  const { marketSuggestPerIp: perIp } = IP_LIMITS;
  await limit(`market:suggest:ip:${ip}`, perIp.count, perIp.windowSec);
  const p = new URL(req.url).searchParams;
  return json({ items: await suggestMarketItems({ tool: p.get("tool") ?? "", q: p.get("q") ?? "" }) });
});
