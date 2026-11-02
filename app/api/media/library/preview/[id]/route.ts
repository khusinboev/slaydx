import { ApiError, handler } from "@/lib/server/api";
import { bytesBody, noStoreOnError } from "@/lib/server/http-bytes";
import { libraryPreview } from "@/lib/server/media/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A library / template preview picture (public curated art, docs/studio/P2B-SPEC.md). The id is the sha256 prefix of
 * the bytes, so one URL never serves other bytes → `immutable`.
 */
export const GET = noStoreOnError(
  handler("media/library/preview", async (_req, ctx: Ctx) => {
    const { id } = await ctx.params;
    const row = await libraryPreview(id);
    if (!row) throw new ApiError("Topilmadi", 404);
    return new Response(bytesBody(row.bytes), {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(row.bytes.byteLength),
        "Cache-Control": "public, max-age=604800, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }),
);
