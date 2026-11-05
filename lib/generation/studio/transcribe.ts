/**
 * Studio P10 «Transkripsiya» engine (docs/studio/P10-SPEC.md, tool `studio-transcribe`).
 *
 *   1. ONE Speech-to-Text call through the core (`runMedia`, purpose `studio.transcribe`, a `media_jobs` row; the source
 *      travels as the `media` asset and is never logged).
 *   2. Cues from the word timestamps (`subtitles.ts buildCues`), the readable text (`transcriptOf`).
 *   3. «Subtitrni videoga yopishtirish» (a video source only): ffmpeg burns the cues into the MP4 (`burn-args.ts`).
 *
 * Result file: the burned MP4, else the transcript as UTF-8 TXT. The SRT / VTT downloads are built from `doc.transcribe.cues`
 * by the download registry (`subtitles-srt`, `subtitles-vtt`) — the same cues the burn and the viewer use.
 *
 * Input bytes reach the engine ONLY through `ctx.source`, which the worker read from the job owner's own upload / result
 * (SQL ownership, `lib/server/media/speech-sources.ts`). Missing, wrong kind, too long, a provider or ffmpeg failure →
 * `UserFacingError` → FAILED + full refund. No speech at all is not a failure: the result says so (and nothing is burned).
 */
import { normalize, type MediaAdapter, type MediaOutput, type Route } from "../../studio-core";
import { STUDIO_TRANSCRIBE_PURPOSE, SPEECH_TOOL_OUTPUT_MAX_BYTES, TRANSCRIBE_AUDIO_MAX_SECONDS, TRANSCRIBE_MODEL, TRANSCRIBE_VIDEO_MAX_SECONDS, parseSource } from "../../media/catalog-transcribe";
import { studioTranscribeError, transcribeEntry } from "../../media/studio-transcribe";
import { sttResultOf, transcribeAdapters } from "../../media/adapters/transcribe-studio";
import { MIX_SECONDS_TOLERANCE } from "../../media/catalog-mix";
import { UserFacingError } from "../../server/user-error";
import { extractMeta } from "../meta";
import { recordAudioCall } from "./cost";
import { BURN_FILES, burnArgs, burnVideoKbps } from "./burn-args";
import { FfmpegMissingError, runFfmpeg, type FfmpegRun } from "./mix-ffmpeg";
import { mp4HasVideo } from "./mix-media";
import { mp4Seconds } from "../video/mp4";
import { buildCues, toSrt, transcriptOf } from "./subtitles";
import type { AcademicDoc, BuiltFile, StudioTranscribeDoc } from "../types";
import type { FormValues, ToolConfig } from "../../types";

/** The job owner's own source, read by the worker (`speechToolJobCtx`); `null` = gone / not theirs / wrong kind. */
export type SpeechToolSource = {
  kind: "upload" | "result";
  id: string;
  mime: string;
  bytes: Uint8Array;
  /** Measured length (s). */
  seconds: number;
  /** A video result's aspect (`doc.video.aspect`), for the burn style and the viewer. */
  aspect?: string;
};
export type SpeechToolCtx = { source: SpeechToolSource | null };

type RunFn = (i: Parameters<typeof import("../../server/media/run").runMedia>[0]) => Promise<{ outputs: MediaOutput[]; route?: Route }>;
export type StudioTranscribeDeps = {
  adapters?: Readonly<Record<string, MediaAdapter>>;
  run?: RunFn;
  ffmpeg?: (run: FfmpegRun) => Promise<Uint8Array>;
};

/** The burn re-encodes the picture: ≤ 3 min of H.264 `veryfast` on 2 threads (the runner's ceiling is 300 s). */
export const BURN_FFMPEG_TIMEOUT_MS = 240_000;
/** The bytes may measure this much longer than the billed (server-read, rounded-up) seconds; more = refused + refund. */
export const MEASURED_SLACK_SECONDS = 1.5;

const REFUND = "Kredit qaytariladi.";
const FAILED = `Transkripsiya bajarilmadi — provayder javob bermadi. ${REFUND}`;
const BURN_FAILED = `Subtitrni videoga yopishtirib bo‘lmadi. ${REFUND}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

async function defaultRun(i: Parameters<RunFn>[0]) {
  return (await import("../../server/media/run")).runMedia(i);
}

/** The source's kind by its stored mime (an upload is always audio). */
export function sourceKindOf(mime: string): "video" | "audio" {
  return mime === "video/mp4" ? "video" : "audio";
}

export async function buildStudioTranscribe(
  tool: ToolConfig,
  values: FormValues,
  ctx: SpeechToolCtx,
  o: { deadline?: number; onStage?: (ev: { progress: number; step: string }) => void } = {},
  deps: StudioTranscribeDeps = {},
): Promise<BuiltFile> {
  o.onStage?.({ progress: 0, step: "So‘rov tayyorlanmoqda" });
  // The route refused these before charging; a job row from before a rule change fails here (refund), never runs.
  const bad = studioTranscribeError(values);
  if (bad) throw new UserFacingError(`${bad} ${REFUND}`);
  const entry = transcribeEntry();
  const p = normalize(entry.params, values);
  const ref = parseSource(values.source)!;
  const src = ctx.source;
  if (!src || src.kind !== ref.kind || src.id !== ref.id) throw new UserFacingError(`Tanlangan manba topilmadi (o‘chirilgan yoki muddati o‘tgan bo‘lishi mumkin). ${REFUND}`);
  const kind = sourceKindOf(src.mime);
  const max = kind === "video" ? TRANSCRIBE_VIDEO_MAX_SECONDS : TRANSCRIBE_AUDIO_MAX_SECONDS;
  if (!(src.seconds > 0 && src.seconds <= max + MIX_SECONDS_TOLERANCE)) throw new UserFacingError(`Manba ${max / 60} daqiqadan uzun yoki o‘qilmadi. ${REFUND}`);
  // The price was the billed seconds the server read before the charge; the bytes measured here must not be longer.
  if (src.seconds > Number(p.sourceSeconds) + MEASURED_SLACK_SECONDS) {
    console.warn(`[studio-transcribe] measured ${src.seconds.toFixed(2)} s > billed ${String(p.sourceSeconds)} s — refused`);
    throw new UserFacingError(`Manba uzunligi narx hisoblangandan uzunroq chiqdi — qayta tanlang. ${REFUND}`);
  }
  const burn = p.burn === true;
  if (burn && kind !== "video") throw new UserFacingError(`Subtitrni faqat videoga yopishtirish mumkin. ${REFUND}`);
  const kbps = burn ? burnVideoKbps(src.seconds) : null;
  if (burn && kbps === null) throw new UserFacingError(`Bu video subtitr bilan 25 MB ga sig‘maydi. ${REFUND}`);

  o.onStage?.({ progress: 10, step: "Nutq matnga aylantirilmoqda" });
  const run = deps.run ?? defaultRun;
  let result: ReturnType<typeof sttResultOf>;
  let route: Route = entry.routes[0]!;
  try {
    const out = await run({
      purpose: STUDIO_TRANSCRIBE_PURPOSE,
      modelId: TRANSCRIBE_MODEL,
      values: p,
      assets: { media: [{ mime: src.mime, base64: Buffer.from(src.bytes).toString("base64") }] },
      step: "stt:0",
      adapters: deps.adapters ?? transcribeAdapters(),
      ...(o.deadline ? { deps: { deadline: o.deadline } } : {}),
    });
    route = out.route ?? route;
    const json = out.outputs[0];
    result = json && json.kind === "inline" ? sttResultOf(JSON.parse(new TextDecoder().decode(json.bytes))) : null;
  } catch (e) {
    console.warn("[studio-transcribe] call failed:", e instanceof Error ? e.message : e);
    throw new UserFacingError(FAILED, { cause: e });
  }
  if (!result) throw new UserFacingError(FAILED);
  recordAudioCall(entry, route, p);

  const speakers = p.speakers === true;
  const cues = buildCues(result.words, { speakers });
  const text = transcriptOf(result.words, result.text, { speakers });
  // Nothing spoken: the transcript says so, nothing is burned (the paid call did run; the result is honest, not a failure).
  const burned = burn && cues.length > 0;

  let bytes: Uint8Array;
  let mime: string;
  let seconds = src.seconds;
  if (burned) {
    o.onStage?.({ progress: 60, step: "Subtitr videoga yopishtirilmoqda" });
    const vertical = src.aspect === "9:16";
    try {
      bytes = await (deps.ffmpeg ?? runFfmpeg)({
        inputs: { [BURN_FILES.video]: src.bytes, [BURN_FILES.subs]: new TextEncoder().encode(toSrt(cues, { forBurn: true })) },
        args: burnArgs({ seconds: src.seconds, vertical, videoKbps: kbps! }),
        output: BURN_FILES.out,
        timeoutMs: BURN_FFMPEG_TIMEOUT_MS,
      });
    } catch (e) {
      console.warn("[studio-transcribe] ffmpeg failed:", e instanceof Error ? e.message : e, (e as { stderr?: string })?.stderr ?? "");
      if (e instanceof FfmpegMissingError) throw new UserFacingError(`Subtitr yopishtirish hozircha ishlamayapti. ${REFUND}`);
      throw new UserFacingError(BURN_FAILED);
    }
    if (!bytes.length || !mp4HasVideo(bytes)) throw new UserFacingError(BURN_FAILED);
    if (bytes.length > SPEECH_TOOL_OUTPUT_MAX_BYTES) throw new UserFacingError(`Natija fayli juda katta (25 MB dan oshdi). ${REFUND}`);
    seconds = mp4Seconds(bytes) || src.seconds;
    mime = "video/mp4";
  } else {
    bytes = new TextEncoder().encode(`${text || "(Nutq topilmadi)"}\n`);
    mime = "text/plain; charset=utf-8";
  }

  o.onStage?.({ progress: 95, step: "Natija tayyorlanmoqda" });
  const transcribe: StudioTranscribeDoc = {
    model: entry.id,
    source: ref.kind,
    sourceId: ref.kind === "result" ? ref.id : null,
    sourceKind: kind,
    sourceSeconds: Number(p.sourceSeconds),
    requestedLanguage: String(p.language),
    language: result.languageCode,
    speakers,
    burned,
    output: burned ? "mp4" : "txt",
    text,
    cues,
  };
  const topic = text ? text.replace(/\s+/g, " ").slice(0, 72) : "Transkripsiya";
  const meta = extractMeta(tool, { ...values, topic });
  const doc: AcademicDoc = { meta, titlePage: false, toc: false, sections: [], transcribe };
  if (burned) doc.video = { provider: "ffmpeg", prompt: "Subtitrli video", aspect: src.aspect ?? "16:9", requestedSeconds: round1(seconds), seconds: round1(seconds), fromImage: false, model: entry.id };
  return {
    html: `<article><h1>Transkripsiya</h1><p>${escapeHtml(text.slice(0, 2000))}</p></article>`,
    bytes,
    fileName: `${meta.fileNameHint || "transkripsiya"}.${burned ? "mp4" : "txt"}`,
    mime,
    doc,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
