import type { ClientEntry } from "@/lib/studio-core";
import { HEYGEN_MAX_SECONDS, OWN_AUDIO_PARAM, avatarMaxSeconds, avatarMinSeconds, isAvatarModel, withAvatarSeconds } from "@/lib/media/catalog-video";
import { MIX_SECONDS_TOLERANCE } from "@/lib/media/catalog-mix";
import { PROMPT_PARAM } from "../studio-values";

/**
 * Studio P9 HeyGen avatar in the Video tab (docs/studio/P9-HEYGEN.md): which own speech results can be the avatar's
 * voice, and the request values — the SAME `withAvatarSeconds` the server overwrites `seconds` with before pricing, so
 * the button's price is the charged one. Pure (no React).
 */

/** One finished speech result of the user (`GET /api/media/mix-sources` → `speech`). */
export type SpeechSource = { id: string; title: string; kind: string; seconds: number | null };

/** The speeches an avatar can speak: a known length (the price needs it) within `HEYGEN_MAX_SECONDS`. */
export function avatarSpeeches(list: readonly SpeechSource[]): SpeechSource[] {
  return list.filter((s) => typeof s.seconds === "number" && s.seconds > 0 && s.seconds <= HEYGEN_MAX_SECONDS + MIX_SECONDS_TOLERANCE);
}

/** The speeches this model takes: within its own length limits (P11: OmniHuman wants 4 s at least, the photo avatars stop at 30 s). */
export function avatarSpeechesFor(list: readonly SpeechSource[], modelId: string): SpeechSource[] {
  const min = avatarMinSeconds(modelId);
  const max = avatarMaxSeconds(modelId);
  return list.filter((s) => typeof s.seconds === "number" && s.seconds >= min && s.seconds <= max + MIX_SECONDS_TOLERANCE);
}

/** Params the generic rows never draw for the avatar: the length (computed), the own speech (its own picker) and — when
 * the avatar speaks an own speech — the script's voice and language (they would change nothing: no decorative rows). */
export function avatarHiddenParams(ownAudio: boolean): ReadonlySet<string> {
  return new Set(["seconds", OWN_AUDIO_PARAM, ...(ownAudio ? ["voice", "language"] : [])]);
}

/**
 * The avatar's request values from the form's: an own speech clears the script (the server takes exactly one of the
 * two) and sets the length from that speech; otherwise the length follows the script. Other models: unchanged.
 */
export function avatarRequest(entry: Pick<ClientEntry, "id">, sent: Record<string, unknown>, speeches: readonly SpeechSource[]): Record<string, unknown> {
  if (!isAvatarModel(entry.id)) return sent;
  const own = String(sent[OWN_AUDIO_PARAM] ?? "").trim();
  if (!own) return withAvatarSeconds({ ...sent, [OWN_AUDIO_PARAM]: "" }, null);
  const src = speeches.find((s) => s.id === own);
  return withAvatarSeconds({ ...sent, [PROMPT_PARAM]: "" }, src?.seconds ?? null);
}
