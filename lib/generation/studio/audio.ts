/**
 * Studio «Audio» engine (docs/studio/P6-SPEC.md, tool `studio-audio`): music, sound effects, voice changer, isolator.
 *
 * Core-native like the other Studio tabs: every provider call is one `runMedia` call under the mode's purpose
 * (`studio.music` / `studio.sfx` / `studio.voice-changer` / `studio.isolate`) — router, breaker health, a `media_jobs`
 * row per call; the prompt is stored there only as its length, the uploaded audio never (it travels as an asset).
 *
 *   music / voice changer / isolator   ONE call, its MP3 is the result file.
 *   sound effect                       `variants` calls (1–4), one MP3 each: the first is the result file, every variant
 *                                      is also stored as a generation asset (`putAsset`) for the player list. Fewer
 *                                      than asked → `delivered` (the worker's partial refund); none → failure (refund).
 *
 * P11 package E: a mode may offer a fal model. VEED Clean Audio answers WAV, encoded here into the MP3 every result is.
 *
 * Input: the chosen catalog model (`modelId`) and its ParamSchema values, normalized with the schema the route validated
 * with. The uploaded input reaches the provider ONLY through `ctx.input`, which the worker read from the job owner's own
 * upload row (SQL ownership); a clone voice ONLY through `ctx.clones` (the owner's ready clones). Anything missing there
 * fails the job (full refund), never runs on another file or voice.
 */
import { normalize, type MediaAdapter, type MediaOutput, type Route } from "../../studio-core";
import { mp3Seconds, wavToMp3 } from "../tts/mp3";
import { extractMeta } from "../meta";
import { LYRIA_MODEL, audioModeOf, lyriaUpstreamOf, takesAudioInput } from "../../media/catalog-audio";
import { ELEVENLABS_VOICES, cloneIdOf } from "../../media/catalog-speech";
import { studioAudioEntry, studioAudioError, studioAudioPurposeOf } from "../../media/studio-audio";
import { studioAudioAdapters } from "../../media/adapters/audio-studio";
import { UserFacingError } from "../../server/user-error";
import { recordAudioCall } from "./cost";
import type { AcademicDoc, BuiltFile, StudioAudioDoc } from "../types";
import type { FormValues, ToolConfig } from "../../types";

/** What the worker resolved for this job (`lib/server/media/audio-inputs.ts studioAudioJobCtx`). */
export type StudioAudioCtx = {
  /** The job owner's own uploaded input (voice changer / isolator), `null` when it is gone or not theirs. */
  input: { mime: string; base64: string; seconds: number } | null;
  /** `studio_voices.id` → provider voice id, ONLY the job owner's ready clones. */
  clones: Readonly<Record<string, { providerVoiceId: string; name: string }>>;
  /** Marks the clones used (the 30-day unused purge reads `last_used_at`). */
  touch?: (cloneIds: readonly string[]) => Promise<void>;
};

export type StudioAudioDeps = {
  adapters?: Readonly<Record<string, MediaAdapter>>;
  run?: (i: Parameters<typeof import("../../server/media/run").runMedia>[0]) => Promise<{ outputs: MediaOutput[]; route?: Route }>;
};

const FAILED = "Audio yaratilmadi — provayder javob bermadi. Pul balansingizga qaytariladi.";

async function defaultRun(i: Parameters<typeof import("../../server/media/run").runMedia>[0]) {
  return (await import("../../server/media/run")).runMedia(i);
}

const mp3Of = (o: MediaOutput | undefined): Uint8Array | null => (o && o.kind === "inline" && o.bytes.length && o.mime === "audio/mpeg" ? o.bytes : null);
/** The clip as MP3: as it came, or the provider's WAV encoded; `null` when it is neither. */
async function clipOf(o: MediaOutput | undefined): Promise<Uint8Array | null> {
  if (o && o.kind === "inline" && o.mime === "audio/wav" && o.bytes.length) return wavToMp3(o.bytes);
  return mp3Of(o);
}
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function buildStudioAudio(
  tool: ToolConfig,
  values: FormValues,
  ctx: StudioAudioCtx,
  o: { deadline?: number; onStage?: (ev: { progress: number; step: string }) => void; putAsset?: (bytes: Uint8Array, mime: string) => Promise<string> } = {},
  deps: StudioAudioDeps = {},
): Promise<BuiltFile> {
  o.onStage?.({ progress: 0, step: "So‘rov tayyorlanmoqda" });
  const entry = studioAudioEntry(values);
  const mode = entry ? audioModeOf(entry.id) : null;
  const purpose = entry ? studioAudioPurposeOf(entry.id) : null;
  if (!entry || !mode || !purpose) throw new UserFacingError("Tanlangan audio rejimi mavjud emas. Pul balansingizga qaytariladi.");
  // The route refused these before charging; a job row from before a catalog change fails here (refund), never runs.
  const bad = studioAudioError(values);
  if (bad) throw new UserFacingError(`${bad} Pul balansingizga qaytariladi.`);
  const p = normalize(entry.params, values);
  const adapters = deps.adapters ?? studioAudioAdapters();
  const run = deps.run ?? defaultRun;
  // P9 Lyria: one route, two upstream models by «Turi» — the real one goes into media_jobs and cost_json.
  const upstream = entry.id === LYRIA_MODEL ? { upstream: () => lyriaUpstreamOf(p.length) } : {};
  const common = { purpose, modelId: entry.id, adapters, redact: ["prompt"] as const, ...upstream, ...(o.deadline ? { deps: { deadline: o.deadline } } : {}) };

  let assets: { audio: { mime: string; base64: string }[] } | undefined;
  if (takesAudioInput(entry)) {
    if (!ctx.input) throw new UserFacingError("Yuklangan audio topilmadi (muddati o‘tgan bo‘lishi mumkin). Pul balansingizga qaytariladi.");
    assets = { audio: [{ mime: ctx.input.mime, base64: ctx.input.base64 }] };
  }
  let voiceLabel: string | null = null;
  let providerVoice: string | null = null;
  const clone = mode.mode === "voice-changer" ? cloneIdOf(String(values.voice ?? "").trim()) : null;
  if (mode.mode === "voice-changer") {
    const v = String(values.voice ?? "").trim() || String(p.voice ?? "");
    if (clone) {
      const hit = ctx.clones[clone];
      if (!hit) throw new UserFacingError("Tanlangan ovoz topilmadi (o‘chirilgan bo‘lishi mumkin). Pul balansingizga qaytariladi.");
      providerVoice = hit.providerVoiceId;
      voiceLabel = hit.name;
    } else {
      const lib = ELEVENLABS_VOICES.find((x) => x.id === v);
      if (!lib) throw new UserFacingError("Noma'lum ovoz. Pul balansingizga qaytariladi.");
      providerVoice = lib.id;
      voiceLabel = lib.name;
    }
  }

  const want = mode.mode === "sfx" ? Number(p.variants) || 1 : 1;
  const clips: Uint8Array[] = [];
  let lyrics: string | null = null;
  o.onStage?.({ progress: 10, step: "Audio yaratilmoqda" });
  for (let i = 0; i < want; i++) {
    try {
      // Each call makes ONE clip: its media_jobs cost is one clip's, not the whole job's (variants × clip).
      const callValues = { ...p, variants: 1 };
      const out = await run({ ...common, values: callValues, ...(providerVoice ? { extra: { voice: providerVoice } } : {}), ...(assets ? { assets } : {}), step: `audio:${i}` });
      const mp3 = await clipOf(out.outputs[0]);
      if (!mp3) throw new Error("bo'sh audio");
      const first = out.outputs[0];
      if (!lyrics && first?.kind === "inline" && first.text) lyrics = first.text;
      // Delivered: the same one-clip cost goes into the job's cost (a failed variant records nothing).
      recordAudioCall(entry, out.route ?? entry.routes[0]!, callValues, mp3Seconds(mp3));
      clips.push(mp3);
    } catch (e) {
      console.warn("[studio-audio] call failed:", e instanceof Error ? e.message : e);
      // One clip: nothing to deliver. Variants: the others still run; a short delivery is refunded in part.
      if (want === 1) throw new UserFacingError(FAILED);
    }
    o.onStage?.({ progress: 10 + Math.round((80 * (i + 1)) / want), step: "Audio yaratilmoqda" });
  }
  if (!clips.length) throw new UserFacingError(FAILED);

  o.onStage?.({ progress: 90, step: "Audio yig‘ilmoqda" });
  if (clone) await ctx.touch?.([clone]).catch(() => undefined);
  const variants: StudioAudioDoc["variants"] =
    want > 1 && o.putAsset
      ? await Promise.all(clips.map(async (b) => ({ assetId: await o.putAsset!(b, "audio/mpeg"), seconds: round1(mp3Seconds(b)) })))
      : [];
  const prompt = typeof p.prompt === "string" && p.prompt ? p.prompt : null;
  const topic = prompt ? prompt.slice(0, 72) : mode.label;
  const meta = extractMeta(tool, { ...values, topic });
  const studioAudio: StudioAudioDoc = {
    mode: mode.mode,
    model: entry.id,
    seconds: round1(mp3Seconds(clips[0]!)),
    prompt,
    inputSeconds: takesAudioInput(entry) ? Number(p.inputSeconds) : null,
    voices: voiceLabel ? [voiceLabel] : [],
    clone: clone !== null,
    variants,
    ...(lyrics ? { lyrics } : {}),
  };
  const doc: AcademicDoc = { meta, titlePage: false, toc: false, sections: [], studioAudio };
  return {
    html: `<article><h1>${escapeHtml(meta.topic)}</h1><p>${Math.round(studioAudio.seconds)} s · ${escapeHtml(mode.label)}</p></article>`,
    bytes: clips[0]!,
    fileName: `${meta.fileNameHint || "audio"}.mp3`,
    mime: "audio/mpeg",
    doc,
    ...(clips.length < want ? { delivered: { got: clips.length, want } } : {}),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
