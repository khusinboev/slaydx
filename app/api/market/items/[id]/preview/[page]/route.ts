import { ApiError, limit, optionalUser } from "@/lib/server/api";
import { bytesBody } from "@/lib/server/http-bytes";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { assertMarketOpen, marketHandler } from "@/lib/server/market/http";
import { getMarketPreview } from "@/lib/server/market/previews";
import { busyResponse, SofficeBusyError } from "@/lib/server/soffice-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The first request of an item builds its rasters through LibreOffice. */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; page: string }> };

const PUBLIC_CACHE = "public, max-age=86400, immutable";

/**
 * A shop-window raster (docs/market/PLAN.md M8): the only item bytes a non-buyer ever gets, watermarked or blurred.
 * The one cacheable market route, and only for the `?v=` the raster really has: another `?v=` must not pin old bytes
 * under a new URL. `next.config.ts` keeps this path out of the `/api` no-store rule.
 */
export const GET = marketHandler("preview", async (req: Request, ctx: Ctx) => {
  const { user, ip } = await optionalUser(req);
  await assertMarketOpen(user);
  const { marketPreviewPerIp: perIp } = IP_LIMITS;
  await limit(`market:preview:ip:${ip}`, perIp.count, perIp.windowSec);
  const { id, page } = await ctx.params;
  if (!/^[1-9]$/.test(page)) throw new ApiError("Topilmadi", 404);
  let preview;
  try {
    preview = await getMarketPreview(id, Number(page));
  } catch (e) {
    if (e instanceof SofficeBusyError) return busyResponse(e);
    throw e;
  }
  if (!preview) throw new ApiError("Topilmadi", 404);
  const exact = new URL(req.url).searchParams.get("v") === String(preview.version);
  return new Response(bytesBody(preview.bytes), {
    headers: {
      "Content-Type": preview.mime,
      "Content-Length": String(preview.bytes.byteLength),
      "Cache-Control": exact ? PUBLIC_CACHE : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
