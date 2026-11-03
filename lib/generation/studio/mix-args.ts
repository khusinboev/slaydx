/**
 * Studio «Montaj» — the ffmpeg argument builder (docs/studio/P8-SPEC.md «P8c»). PURE: numbers in, an argv array out.
 *
 * Safety rules (P8-SPEC «Safety / limits»), all enforced HERE so one golden test pins them:
 *   - the argv goes to `spawn` without a shell; every file name is a CONSTANT inside the job's own temp dir (the runner
 *     sets `cwd`), so no path and no user text is ever on the command line;
 *   - every number is validated (finite, clamped to the mode's range) and printed with fixed decimals;
 *   - `-nostdin`, and `-protocol_whitelist file` + an explicit demuxer (`-f mov` / `-f mp3`) before EACH input:
 *     no network protocol, no format guessing from the bytes;
 *   - `-t <seconds>` bounds the output (the base input's measured length), so an endless filter (`apad`, a looped
 *     music track) always ends.
 *
 *   video-voice   the video stream is COPIED (no re-encode); the new audio: volume, delayed by the start offset, padded
 *                 with silence and cut at the video's length; «keep the original» mixes the video's own sound under
 *                 it at `MIX_ORIGINAL_VOLUME` (only when the video has a sound track — otherwise it is a replace);
 *                 AAC 160 kb/s, 48 kHz stereo, `+faststart`.
 *   voice-music   the music is looped (`-stream_loop -1`), set to its volume, faded out over the last `fadeOut` seconds
 *                 of the speech (at most half the speech), optionally «ducked» (sidechain compressor keyed by the
 *                 speech); speech + music mixed at full scale (`normalize=0`), cut at the speech's length; MP3 192 kb/s,
 *                 44.1 kHz stereo.
 */
import { MIX_AUDIO_MAX_SECONDS, MIX_ORIGINAL_VOLUME, MIX_VIDEO_MAX_SECONDS, MIX_SECONDS_TOLERANCE } from "../../media/catalog-mix";

/** The constant file names inside the job's temp dir. */
export const MIX_FILES = { video: "in-video.mp4", audio: "in-audio.mp3", speech: "in-speech.mp3", music: "in-music.mp3", outVideo: "out.mp4", outAudio: "out.mp3" } as const;

/** Threads ffmpeg may use (the worker box is shared). */
export const MIX_THREADS = 2;

export type VideoVoicePlan = {
  mode: "video-voice";
  /** Measured length of the video (s): the output's length. */
  videoSeconds: number;
  /** The video has a sound track of its own. */
  videoHasAudio: boolean;
  keepOriginal: boolean;
  /** 10–200 %. */
  audioVolume: number;
  /** 0 – (video length − 1) s. */
  startOffset: number;
};

export type VoiceMusicPlan = {
  mode: "voice-music";
  /** Measured length of the speech (s): the output's length. */
  speechSeconds: number;
  /** 5–50 %. */
  musicVolume: number;
  ducking: boolean;
  /** 0–10 s (at most half the speech). */
  fadeOut: number;
};

export type MixPlan = VideoVoicePlan | VoiceMusicPlan;

const clamp = (n: number, lo: number, hi: number): number => {
  if (!Number.isFinite(n)) throw new Error("mix-args: not a number");
  return Math.min(hi, Math.max(lo, n));
};
const f3 = (n: number) => n.toFixed(3);
const f2 = (n: number) => n.toFixed(2);

const COMMON = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-threads", String(MIX_THREADS)] as const;
const input = (format: "mov" | "mp3", file: string, loop = false): string[] => ["-protocol_whitelist", "file", ...(loop ? ["-stream_loop", "-1"] : []), "-f", format, "-i", file];

/** The output file name of a plan (inside the temp dir). */
export function mixOutputFile(plan: MixPlan): string {
  return plan.mode === "video-voice" ? MIX_FILES.outVideo : MIX_FILES.outAudio;
}

/** The filter graph (exported for the golden tests' readability). */
export function mixFilter(plan: MixPlan): string {
  if (plan.mode === "video-voice") {
    const volume = clamp(plan.audioVolume, 10, 200) / 100;
    const length = clamp(plan.videoSeconds, 0.1, MIX_VIDEO_MAX_SECONDS + MIX_SECONDS_TOLERANCE);
    const offset = clamp(Math.floor(plan.startOffset), 0, Math.max(0, Math.ceil(length) - 1));
    const fmt = "aformat=sample_rates=48000:channel_layouts=stereo";
    const delay = offset > 0 ? `,adelay=delays=${offset * 1000}:all=1` : "";
    const added = `[1:a]${fmt},volume=${f3(volume)}${delay},apad`;
    if (plan.keepOriginal && plan.videoHasAudio) {
      return `[0:a]${fmt},volume=${f3(MIX_ORIGINAL_VOLUME)},apad[o];${added}[n];[o][n]amix=inputs=2:duration=longest:normalize=0[a]`;
    }
    return `${added}[a]`;
  }
  const length = clamp(plan.speechSeconds, 0.1, MIX_AUDIO_MAX_SECONDS + MIX_SECONDS_TOLERANCE);
  const volume = clamp(plan.musicVolume, 5, 50) / 100;
  const fade = clamp(Math.floor(plan.fadeOut), 0, 10);
  const fadeLen = Math.min(fade, length / 2);
  const fmt = "aformat=sample_rates=44100:channel_layouts=stereo";
  const fadeF = fadeLen > 0 ? `,afade=t=out:st=${f3(length - fadeLen)}:d=${f3(fadeLen)}` : "";
  const music = `[1:a]${fmt},volume=${f3(volume)}${fadeF}`;
  if (plan.ducking) {
    return `[0:a]${fmt},asplit=2[s][k];${music}[m0];[m0][k]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[m];[s][m]amix=inputs=2:duration=first:normalize=0[a]`;
  }
  return `[0:a]${fmt}[s];${music}[m];[s][m]amix=inputs=2:duration=first:normalize=0[a]`;
}

/** The full argv (without the binary) for a plan. */
export function mixArgs(plan: MixPlan): string[] {
  if (plan.mode === "video-voice") {
    const length = clamp(plan.videoSeconds, 0.1, MIX_VIDEO_MAX_SECONDS + MIX_SECONDS_TOLERANCE);
    return [
      ...COMMON,
      ...input("mov", MIX_FILES.video),
      ...input("mp3", MIX_FILES.audio),
      "-filter_complex",
      mixFilter(plan),
      "-map",
      "0:v:0",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "48000",
      "-t",
      f2(length),
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      MIX_FILES.outVideo,
    ];
  }
  const length = clamp(plan.speechSeconds, 0.1, MIX_AUDIO_MAX_SECONDS + MIX_SECONDS_TOLERANCE);
  return [
    ...COMMON,
    ...input("mp3", MIX_FILES.speech),
    ...input("mp3", MIX_FILES.music, true),
    "-filter_complex",
    mixFilter(plan),
    "-map",
    "[a]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-ar",
    "44100",
    "-t",
    f2(length),
    "-f",
    "mp3",
    MIX_FILES.outAudio,
  ];
}
