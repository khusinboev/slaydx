import { handler, json, limit, requireUser } from "@/lib/server/api";
import { uploadAudioInput } from "@/lib/server/media/audio-inputs";
import { AUDIO_INPUTS_PER_DAY, AUDIO_INPUTS_PER_HOUR } from "@/lib/media/studio-audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/media/audio-inputs` (docs/studio/P6-SPEC.md): the audio a voice-changer / isolator job works on —
 * `multipart/form-data` with `file` (WAV or MP3, sniffed from the bytes; 3–300 s measured; ≤ 25 MB). Answer:
 * `{ id, seconds, mime, size }` where `seconds` is the billed length (whole seconds, rounded up) the server prices with.
 * Owner-only (the job's SQL reads `user_id`); 20 uploads / hour and 60 / day per user. P11 §D: `kind=video` takes the
 * user's own MP4 / MOV for «Transkripsiya» / «Dublyaj» (`tool` names the form); a section that is off takes no upload.
 */
export const POST = handler("media/audio-inputs", async (req) => {
  const { user } = await requireUser(req);
  await limit(`media:audio-input:h:${user.id}`, AUDIO_INPUTS_PER_HOUR, 3600);
  await limit(`media:audio-input:d:${user.id}`, AUDIO_INPUTS_PER_DAY, 86_400);
  return json(await uploadAudioInput(req, String(user.id)));
});
