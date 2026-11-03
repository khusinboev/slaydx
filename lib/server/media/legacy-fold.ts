import { getSetting } from "../settings";
import { legacyFoldTarget } from "../../media/legacy-fold";

/**
 * Studio P8 fold (docs/studio/P8-SPEC.md «Dark switch»), the server side: ONE read of `studio.legacy_fold` that the
 * old tool pages, the session (`features.legacyFold`), the bot keyboard and the chat knowledge share. Never throws
 * because of the database (`getSetting` falls back to the default: OFF, the old pages).
 */
export async function legacyFoldOn(): Promise<boolean> {
  return getSetting("studio.legacy_fold");
}

/** Where an old tool page sends the request while the fold is on (`null` = render the old page). */
export async function legacyFoldRedirect(toolId: string, search: Record<string, string | string[] | undefined> | null | undefined): Promise<string | null> {
  return legacyFoldTarget(toolId, await legacyFoldOn(), search);
}
