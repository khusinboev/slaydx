/**
 * Studio «Montaj» engine (docs/studio/P8-SPEC.md «P8c», tool `studio-mix`): ffmpeg in the worker, no provider.
 *
 *   video-voice   the user's finished video + finished audio → MP4 (`mixArgs`, video stream copied)
 *   voice-music   the user's finished speech + finished music → MP3, length = the speech
 *
 * Input: the request values (mode = `modelId`, the two generation ids, the options), normalized with the mode's schema
 * the route validated with; the BYTES reach the engine only through `ctx.inputs`, which the worker read from the job
 * owner's own finished generations (SQL ownership, `lib/server/media/mix-sources.ts mixJobCtx`). Missing / wrong kind /
 * too long / ffmpeg missing / ffmpeg failed → a `UserFacingError` → the worker marks the job FAILED and refunds in full.
 *
 * Lengths are MEASURED from the bytes here (`mp4Seconds` / `mp3Seconds`), never taken from a stored number: they bound
 * the output (`-t`) and the limits (video ≤ 3 min, audio ≤ 10 min).
 *
 * Cost telemetry (P7c convention): ffmpeg has no provider cost, so nothing is recorded in the job's meter — the same rule
 * as the voice clone's $0 IVC call. `cost_json` / `ai_usage` stay empty for a mix; the admin sees the price only.
 */
import { MIX_AUDIO_MAX_SECONDS, MIX_INPUTS, MIX_OUTPUT_MAX_BYTES, MIX_SECONDS_TOLERANCE, MIX_VIDEO_MAX_SECONDS, mixModeOf, mixParams, studioMixError, type MixMode } from "../../media/catalog-mix";
import { extractMeta } from "../meta";
import { UserFacingError } from "../../server/user-error";
import { MIX_FILES, mixArgs, mixOutputFile, type MixPlan } from "./mix-args";
import { FfmpegMissingError, runFfmpeg, type FfmpegRun } from "./mix-ffmpeg";
import { mediaSeconds, mp4HasAudio, mp4HasVideo } from "./mix-media";
import type { AcademicDoc, BuiltFile, StudioMixDoc } from "../types";
import type { FormValues, ToolConfig } from "../../types";

/** One source generation's stored file (the job owner's own, read by the worker). */
export type MixInput = { bytes: Uint8Array; mime: string; /** The source video's aspect (`doc.video.aspect`), for the viewer. */ aspect?: string };
/** What the worker resolved for this job, in the mode's input order; `null` = gone / not the owner's / wrong kind. */
export type StudioMixCtx = { inputs: readonly [MixInput | null, MixInput | null] };

export type StudioMixDeps = { ffmpeg?: (run: FfmpegRun) => Promise<Uint8Array> };

const REFUND = "Pul balansingizga qaytariladi.";
const FAILED = `Montaj bajarilmadi. ${REFUND}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

function within(seconds: number, max: number): boolean {
  return seconds > 0 && seconds <= max + MIX_SECONDS_TOLERANCE;
}

/** The plan (validated numbers only) of a mode, from the normalized params and the measured inputs. */
export function mixPlanOf(mode: MixMode, p: Readonly<Record<string, unknown>>, a: MixInput, b: MixInput): MixPlan {
  if (mode === "video-voice") {
    if (a.mime !== "video/mp4" || !mp4HasVideo(a.bytes)) throw new UserFacingError(`Tanlangan video o‘qilmadi. ${REFUND}`);
    if (b.mime !== "audio/mpeg") throw new UserFacingError(`Tanlangan audio o‘qilmadi. ${REFUND}`);
    const videoSeconds = mediaSeconds(a.bytes, a.mime);
    const audioSeconds = mediaSeconds(b.bytes, b.mime);
    if (!within(videoSeconds, MIX_VIDEO_MAX_SECONDS)) throw new UserFacingError(`Video ${MIX_VIDEO_MAX_SECONDS / 60} daqiqadan uzun yoki o‘qilmadi. ${REFUND}`);
    if (!within(audioSeconds, MIX_AUDIO_MAX_SECONDS)) throw new UserFacingError(`Audio ${MIX_AUDIO_MAX_SECONDS / 60} daqiqadan uzun yoki o‘qilmadi. ${REFUND}`);
    const startOffset = Number(p.startOffset);
    if (startOffset >= videoSeconds) throw new UserFacingError(`Audio boshlanishi video uzunligidan katta. ${REFUND}`);
    return planOf(mode, p, { seconds: videoSeconds, videoHasAudio: mp4HasAudio(a.bytes) });
  }
  if (a.mime !== "audio/mpeg" || b.mime !== "audio/mpeg") throw new UserFacingError(`Tanlangan audio o‘qilmadi. ${REFUND}`);
  const speechSeconds = mediaSeconds(a.bytes, a.mime);
  const musicSeconds = mediaSeconds(b.bytes, b.mime);
  if (!within(speechSeconds, MIX_AUDIO_MAX_SECONDS)) throw new UserFacingError(`Ovoz ${MIX_AUDIO_MAX_SECONDS / 60} daqiqadan uzun yoki o‘qilmadi. ${REFUND}`);
  if (!within(musicSeconds, MIX_AUDIO_MAX_SECONDS)) throw new UserFacingError(`Musiqa ${MIX_AUDIO_MAX_SECONDS / 60} daqiqadan uzun yoki o‘qilmadi. ${REFUND}`);
  return planOf(mode, p, { seconds: speechSeconds, videoHasAudio: false });
}

/**
 * The plan from the normalized params + what was measured of the base input (its length; for a video, whether it has a
 * sound track). The ONE place a param becomes an ffmpeg input — the probe test drives every param through it.
 */
export function planOf(mode: MixMode, p: Readonly<Record<string, unknown>>, measured: { seconds: number; videoHasAudio: boolean }): MixPlan {
  if (mode === "video-voice") {
    return { mode, videoSeconds: measured.seconds, videoHasAudio: measured.videoHasAudio, keepOriginal: p.keepOriginal === true, audioVolume: Number(p.audioVolume), startOffset: Number(p.startOffset) };
  }
  return { mode, speechSeconds: measured.seconds, musicVolume: Number(p.musicVolume), ducking: p.ducking === true, fadeOut: Number(p.fadeOut) };
}

export async function buildStudioMix(
  tool: ToolConfig,
  values: FormValues,
  ctx: StudioMixCtx,
  o: { onStage?: (ev: { progress: number; step: string }) => void } = {},
  deps: StudioMixDeps = {},
): Promise<BuiltFile> {
  o.onStage?.({ progress: 0, step: "Fayllar tayyorlanmoqda" });
  const m = mixModeOf(values);
  // The route refused these before charging; a job row from before a rule change fails here (refund), never runs.
  const bad = studioMixError(values);
  if (!m || bad) throw new UserFacingError(`${bad ?? "Noma'lum montaj turi."} ${REFUND}`);
  const p = mixParams(values)!;
  const [a, b] = ctx.inputs;
  if (!a || !b) throw new UserFacingError(`Tanlangan natija topilmadi (o‘chirilgan yoki muddati o‘tgan bo‘lishi mumkin). ${REFUND}`);
  const plan = mixPlanOf(m.mode, p, a, b);
  const inputs: Record<string, Uint8Array> = m.mode === "video-voice" ? { [MIX_FILES.video]: a.bytes, [MIX_FILES.audio]: b.bytes } : { [MIX_FILES.speech]: a.bytes, [MIX_FILES.music]: b.bytes };

  o.onStage?.({ progress: 20, step: "Montaj qilinmoqda" });
  let bytes: Uint8Array;
  try {
    bytes = await (deps.ffmpeg ?? runFfmpeg)({ inputs, args: mixArgs(plan), output: mixOutputFile(plan) });
  } catch (e) {
    console.warn("[studio-mix] ffmpeg failed:", e instanceof Error ? e.message : e, (e as { stderr?: string })?.stderr ?? "");
    if (e instanceof FfmpegMissingError) throw new UserFacingError(`Montaj hozircha ishlamayapti. ${REFUND}`);
    throw new UserFacingError(FAILED);
  }

  o.onStage?.({ progress: 90, step: "Natija tekshirilmoqda" });
  const mime = m.mode === "video-voice" ? "video/mp4" : "audio/mpeg";
  const seconds = mediaSeconds(bytes, mime);
  const shapeOk = m.mode === "video-voice" ? mp4HasVideo(bytes) && mp4HasAudio(bytes) : true;
  if (!bytes.length || seconds <= 0 || !shapeOk) throw new UserFacingError(FAILED);
  if (bytes.length > MIX_OUTPUT_MAX_BYTES) throw new UserFacingError(`Natija fayli juda katta (25 MB dan oshdi). ${REFUND}`);

  const [ka, kb] = MIX_INPUTS[m.mode];
  const options: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(p)) if (typeof v === "number" || typeof v === "boolean") options[k] = v;
  const mix: StudioMixDoc = { mode: m.mode, output: m.mode === "video-voice" ? "mp4" : "mp3", seconds: round1(seconds), sources: [String(p[ka]), String(p[kb])], options };
  const meta = extractMeta(tool, { ...values, topic: m.label });
  const doc: AcademicDoc = { meta, titlePage: false, toc: false, sections: [], mix };
  if (mix.output === "mp4") {
    // The result page's `VideoViewer` plays `doc.video` (no prompt: the label names the job).
    doc.video = { provider: "ffmpeg", prompt: m.label, aspect: a.aspect ?? "16:9", requestedSeconds: round1(seconds), seconds: round1(seconds), fromImage: false, model: m.model };
  }
  return {
    html: `<article><h1>${m.label}</h1><p>${Math.round(seconds)} s</p></article>`,
    bytes,
    fileName: `${meta.fileNameHint || "montaj"}.${mix.output}`,
    mime,
    doc,
  };
}
