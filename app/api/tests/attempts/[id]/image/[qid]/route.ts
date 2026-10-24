import { ApiError, handler, requireUser } from "@/lib/server/api";
import { attemptImage } from "@/lib/server/paid-tests";
import { bytesBody, noStoreOnError } from "@/lib/server/http-bytes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; qid: string }> };

/**
 * `GET /api/tests/attempts/{id}/image/{questionId}` -- the screenshot of one question of the caller's OWN attempt
 * (running or finished). The image holds the question only (the answer key is a separate server-side column), so it
 * may be cached privately; the content hash is the ETag.
 */
export const GET = noStoreOnError(
  handler("tests/image", async (req, ctx: Ctx) => {
    const { user } = await requireUser(req);
    const { id, qid } = await ctx.params;
    const img = /^\d{1,15}$/.test(qid) ? await attemptImage(user.id, id, Number(qid)) : null;
    if (!img) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    const etag = `"${img.sha256}"`;
    const headers = { ETag: etag, "Cache-Control": "private, max-age=86400", "Content-Type": img.mime, "X-Content-Type-Options": "nosniff" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(bytesBody(img.bytes), { headers });
  }),
);
