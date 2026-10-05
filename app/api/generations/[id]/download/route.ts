import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { isDownloadFormatId } from "@/lib/downloads/formats";
import { DownloadError, downloadErrorResponse } from "@/lib/server/downloads/errors";
import { PREPARE_POLL_LIMIT, prepareDownload } from "@/lib/server/downloads/produce";
import { downloadUrl, signDownloadToken } from "@/lib/server/downloads/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The route answers within ~7 s (`PREPARE_BUDGET_MS`); conversions continue in the background. */
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST /api/generations/{id}/download {format}` (docs/mobile/PLAN.md §4.2).
 *
 * Cookie session; ownership in SQL inside `prepareDownload`. Answers
 *   200 `{state:"ready", url:"/api/dl/<token>", fileName, size, mime, expiresAt}`
 *   200 `{state:"preparing", retryAfterMs}` — poll again;
 *   400 unknown/unsupported format, 404 not the owner, 409 not ready,
 *   429/503 with `Retry-After`, 410 never (that is the token route).
 * The signed URL is minted only once the bytes exist; it binds
 * {generation, user, format, file_version} for 15 minutes.
 */
export const POST = handler("generations/download", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  const body = await readJson<{ format?: unknown }>(req, 4096);
  try {
    if (!isDownloadFormatId(body.format)) throw new DownloadError("unknown_format");
    await limit(`dlprep:${user.id}`, PREPARE_POLL_LIMIT.count, PREPARE_POLL_LIMIT.windowSec);
    const r = await prepareDownload(id, String(user.id), body.format);
    if (r.state === "preparing") return json({ state: "preparing", retryAfterMs: r.retryAfterMs });
    const { token, expiresAt } = signDownloadToken({ g: id, u: String(user.id), f: body.format, v: r.fileVersion });
    return json({
      state: "ready",
      url: downloadUrl(token),
      fileName: r.fileName,
      size: r.size,
      mime: r.mime,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (e) {
    return downloadErrorResponse(e);
  }
});
