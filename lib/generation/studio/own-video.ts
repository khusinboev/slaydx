import { mp4Seconds } from "../video/mp4";
import { CAP_FILES, capArgs } from "./burn-args";
import { mp4HasVideo } from "./mix-media";
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
export async function capOwnVideo(bytes: Uint8Array, billedSeconds: number, ffmpeg: (run: FfmpegRun) => Promise<Uint8Array> = runFfmpeg): Promise<Uint8Array> {
  const out = await ffmpeg({ inputs: { [CAP_FILES.video]: bytes }, args: capArgs(billedSeconds), output: CAP_FILES.out, timeoutMs: CAP_TIMEOUT_MS });
  if (!out.length || !mp4HasVideo(out)) throw new Error("the capped copy has no picture");
  const seconds = mp4Seconds(out);
  if (!(seconds > 0 && seconds <= billedSeconds + CAP_SLACK_SECONDS)) throw new Error(`the capped copy measures ${seconds} s for ${billedSeconds} billed`);
  return out;
}
