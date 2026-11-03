import { handler, json, limit, requireUser } from "@/lib/server/api";
import { SAMPLE_UPLOADS_PER_DAY, SAMPLE_UPLOADS_PER_HOUR, uploadVoiceSample } from "@/lib/server/media/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/media/voices/samples` (docs/studio/P5-SPEC.md): the recording a clone is made from — `multipart/form-data`
 * with `file` (WAV or MP3, sniffed; 30–180 s measured; ≤ 10 MB) and `consent` = "1" (the mandatory «Bu ovozdan
 * foydalanishga haqqim bor» checkbox, stored with the sample: user, time, HMAC of the IP, wording version). Answer:
 * `{ sampleId, seconds, mime, size }`. Clone attempts are limited here: 5 per hour and 10 per day per user.
 */
export const POST = handler("media/voices/samples", async (req) => {
  const { user, ip } = await requireUser(req);
  await limit(`media:voice-sample:h:${user.id}`, SAMPLE_UPLOADS_PER_HOUR, 3600);
  await limit(`media:voice-sample:d:${user.id}`, SAMPLE_UPLOADS_PER_DAY, 86_400);
  return json(await uploadVoiceSample(req, String(user.id), ip));
});
