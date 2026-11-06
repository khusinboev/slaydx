import { mp3Seconds } from "../tts/mp3";
import { mp4Seconds } from "../video/mp4";
import { CAP_FILES, MEASURE_FILES, capArgs, measureArgs } from "./burn-args";
import { mappedTracks, mp4Probe, mp4Problem } from "./mix-media";
import { runFfmpeg, type FfmpegRun } from "./mix-ffmpeg";

/** Copying a stream of ≤ 3 minutes takes no decode. */
const CAP_TIMEOUT_MS = 60_000;
/** The copy ends on a keyframe / packet boundary: it may run this much past `-t`. */
const CAP_SLACK_SECONDS = 1.5;

/**
 * The user's own video as a provider may receive it (P11 review): a fresh MP4 of one picture and one sound track, cut to
 * the BILLED seconds with no re-encode. The upload's tables were checked (`sniffVideo`), and this is the guarantee behind
 * them: whatever a forged file holds, the provider never gets more than was paid for. Runs before any paid call; a
 * throw is a refund.
 */
/** A second decode of what the cut kept, with no re-encode of the picture. */
const MEASURE_TIMEOUT_MS = 60_000;

/**
 * Everything here reads what ffmpeg WROTE, not what the upload claims: `-c copy -t` obeys timestamps, so a squeezed sound
 * track comes through whole under a short label, and the file's tables may differ from what the demuxer read. The output's
 * own tables count the packets it really carries (`mp4Problem`), and decoding its sound to MP3 counts the real seconds:
 * `ffmpeg -f null` would only repeat the timestamps.
 */
export async function capOwnVideo(bytes: Uint8Array, billedSeconds: number, ffmpeg: (run: FfmpegRun) => Promise<Uint8Array> = runFfmpeg): Promise<Uint8Array> {
  const out = await ffmpeg({ inputs: { [CAP_FILES.video]: bytes }, args: capArgs(billedSeconds), output: CAP_FILES.out, timeoutMs: CAP_TIMEOUT_MS });
  const probe = mp4Probe(out);
  const tracks = probe ? mappedTracks(probe) : null;
  if (!out.length || !probe || !tracks?.picture) throw new Error("the capped copy has no picture");
  const bad = mp4Problem(probe);
  if (bad) throw new Error(`the capped copy is refused: ${bad}`);
  const seconds = mp4Seconds(out);
  if (!(seconds > 0 && seconds <= billedSeconds + CAP_SLACK_SECONDS)) throw new Error(`the capped copy measures ${seconds} s for ${billedSeconds} billed`);
  if (tracks.sound) {
    const heard = mp3Seconds(await ffmpeg({ inputs: { [MEASURE_FILES.video]: out }, args: measureArgs(), output: MEASURE_FILES.out, timeoutMs: MEASURE_TIMEOUT_MS }));
    if (heard > billedSeconds + CAP_SLACK_SECONDS) throw new Error(`the capped copy's sound decodes to ${heard} s for ${billedSeconds} billed`);
  }
  return out;
}
