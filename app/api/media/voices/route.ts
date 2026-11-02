import { handler, json, requireUser } from "@/lib/server/api";
import { getSetting } from "@/lib/server/settings";
import { cloneAvailable, listUserVoices } from "@/lib/server/media/voices";
import { ELEVENLABS_VOICES, GEMINI_VOICES } from "@/lib/media/catalog-speech";
import {
  CLONE_CONSENT_TEXT,
  CLONE_CONSENT_VERSION,
  CLONE_SAMPLE_MAX_BYTES,
  CLONE_SAMPLE_MAX_SECONDS,
  CLONE_SAMPLE_MIN_SECONDS,
  CLONE_UNUSED_DAYS,
  clonePriceOf,
} from "@/lib/media/studio-speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/media/voices` (docs/studio/P5-SPEC.md): the voice library per provider (ElevenLabs default voices, Gemini
 * prebuilt voices — name + gender; previews at `/api/media/voices/preview/<key>`), the signed-in user's own clone, and
 * the clone offer: whether cloning is available now, its base price (`studio.clone_price`, before the tool's
 * `tool_pricing` %, which the session's price adjustments add exactly as the server does), the consent wording and the
 * sample limits. No provider ids of clones leave the server.
 */
export const GET = handler("media/voices", async (req) => {
  const { user } = await requireUser(req);
  const [mine, available, price] = await Promise.all([listUserVoices(String(user.id)), cloneAvailable(), getSetting("studio.clone_price")]);
  return json({
    library: { elevenlabs: ELEVENLABS_VOICES, gemini: GEMINI_VOICES },
    mine,
    clone: {
      available,
      price: clonePriceOf(price),
      consentText: CLONE_CONSENT_TEXT,
      consentVersion: CLONE_CONSENT_VERSION,
      minSeconds: CLONE_SAMPLE_MIN_SECONDS,
      maxSeconds: CLONE_SAMPLE_MAX_SECONDS,
      maxBytes: CLONE_SAMPLE_MAX_BYTES,
      unusedDays: CLONE_UNUSED_DAYS,
    },
  });
});
