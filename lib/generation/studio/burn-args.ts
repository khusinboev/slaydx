/**
 * Studio P10 «Subtitrni videoga yopishtirish» — the ffmpeg arguments that burn the transcript's subtitles into the MP4
 * (docs/studio/P10-SPEC.md). Pure, like `mix-args.ts`: validated numbers and constant file names only (no request text
 * and no transcript text reaches the command line — the subtitles travel as a file, `subs.srt`), so a probe / golden
 * test pins every argument.
 *
 *   input   `-protocol_whitelist file -f mov -i in-video.mp4` (the same demuxer rule as «Montaj»)
 *   video   libass `subtitles` filter (the worker image checks it at build time) with Noto Sans (Uzbek Latin incl. ʻ ’,
 *           Cyrillic), re-encoded H.264 `veryfast` CRF 23, capped by `-maxrate` so the result fits 25 MB
 *   audio   copied as is (`0:a?` — a silent clip stays silent)
 *   output  `+faststart` MP4, `-t` = the measured length
 */

export const BURN_FILES = { video: "in-video.mp4", subs: "subs.srt", out: "out-burn.mp4" } as const;

/** Bytes the result may take (the stored-file cap is 25 MB; ~1 MB kept for the container and the rate control's slack). */
export const BURN_TARGET_BYTES = 24 * 1024 * 1024;
/** The copied audio track is counted at this rate (our clips carry AAC ≤ 192 kb/s). */
export const BURN_AUDIO_KBPS = 192;
/** Below this the picture is not worth delivering: the job is refused before charging instead. */
export const BURN_MIN_VIDEO_KBPS = 800;
export const BURN_MAX_VIDEO_KBPS = 6000;
export const BURN_FONT = "Noto Sans";

/**
 * The H.264 rate cap (kb/s) that keeps a `seconds`-long result within `BURN_TARGET_BYTES`, at most `BURN_MAX_VIDEO_KBPS`;
 * `null` when even `BURN_MIN_VIDEO_KBPS` cannot fit (the request is refused before charging).
 */
export function burnVideoKbps(seconds: number): number | null {
  if (!(Number.isFinite(seconds) && seconds > 0)) return null;
  const total = (BURN_TARGET_BYTES * 8) / 1000 / seconds;
  const video = Math.floor(total - BURN_AUDIO_KBPS);
  if (video < BURN_MIN_VIDEO_KBPS) return null;
  return Math.min(BURN_MAX_VIDEO_KBPS, video);
}

export type BurnPlan = { seconds: number; vertical: boolean; videoKbps: number };

/** The `force_style` of the subtitles: white text, black outline, bottom margin; smaller on a vertical clip. */
export function burnStyle(vertical: boolean): string {
  const size = vertical ? 9 : 16;
  const margin = vertical ? 40 : 18;
  return `FontName=${BURN_FONT},FontSize=${size},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.2,Shadow=0,MarginV=${margin}`;
}

export function burnArgs(plan: BurnPlan): string[] {
  const kbps = Math.max(BURN_MIN_VIDEO_KBPS, Math.min(BURN_MAX_VIDEO_KBPS, Math.floor(plan.videoKbps)));
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-protocol_whitelist",
    "file",
    "-f",
    "mov",
    "-i",
    BURN_FILES.video,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    `subtitles=filename=${BURN_FILES.subs}:charenc=UTF-8:force_style='${burnStyle(plan.vertical)}'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-maxrate",
    `${kbps}k`,
    "-bufsize",
    `${kbps * 2}k`,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    "-threads",
    "2",
    "-t",
    plan.seconds.toFixed(3),
    "-y",
    BURN_FILES.out,
  ];
}

/** The audio track of a video (fal Scribe: its page states an audio file, `audio_url`). The same input rules as above. */
export const AUDIO_TRACK_FILES = { video: "in-video.mp4", out: "out-track.mp3" } as const;

export function audioTrackArgs(seconds: number): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-protocol_whitelist",
    "file",
    "-f",
    "mov",
    "-i",
    AUDIO_TRACK_FILES.video,
    // No `?`: a silent clip has no speech to transcribe, ffmpeg fails and the job refunds before any provider call.
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    "-threads",
    "2",
    "-t",
    seconds.toFixed(3),
    "-y",
    AUDIO_TRACK_FILES.out,
  ];
}
