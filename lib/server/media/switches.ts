import { getSetting } from "../settings";
import type { MediaCoreSwitches } from "../../media/context";

/**
 * The `media.core.*` switches for one job (docs/studio/P0-SPEC.md §6). A settings read that fails keeps every kind on
 * the old path: the old path is the safe default, a job must never fail because a switch could not be read.
 */
export async function mediaCoreSwitches(): Promise<MediaCoreSwitches> {
  try {
    const [image, video, speech] = await Promise.all([getSetting("media.core.image"), getSetting("media.core.video"), getSetting("media.core.speech")]);
    return { image, video, speech };
  } catch {
    return { image: false, video: false, speech: false };
  }
}
