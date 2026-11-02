import { ApiError, handler, limit, requireUser } from "@/lib/server/api";
import { bytesBody, noStoreOnError } from "@/lib/server/http-bytes";
import { voicePreview } from "@/lib/server/media/voice-clone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

/**
 * `GET /api/media/voices/preview/<key>` (docs/studio/P5-SPEC.md): the Uzbek preview of a voice — `elevenlabs:<id>` /
 * `gemini:<name>` (library) or `clone:<id>` (the requester's own clone). Served from `studio_voice_previews`; a voice
 * never previewed before costs ONE provider call, ever (cached for everyone). Private cache: a clone is personal.
 */
export const GET = noStoreOnError(
  handler("media/voices/preview", async (req, ctx: Ctx) => {
    const { user } = await requireUser(req);
    await limit(`media:voice-preview:${user.id}`, 60, 600);
    const { key } = await ctx.params;
    // Review NIT: a malformed escape (`%E0%A4%A`) is a 404, never a 500 from `decodeURIComponent`.
    let decoded: string;
    try {
      decoded = decodeURIComponent(key);
    } catch {
      throw new ApiError("Ovoz topilmadi", 404);
    }
    const bytes = await voicePreview(String(user.id), decoded.slice(0, 120));
    return new Response(bytesBody(bytes), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }),
);
