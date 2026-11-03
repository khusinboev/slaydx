/**
 * Studio P8 «legacy fold» (docs/studio/P8-SPEC.md «Dark switch»): while the admin switch `studio.legacy_fold` is on, the
 * old media tools open inside the Studio. Navigation only — the old tools keep their engine, price, result pages and
 * downloads; nothing here touches money.
 *
 * Client-safe pure data + functions (no server imports): the server redirect of the old pages (`app/uz/rasm`,
 * `app/uz/video`), the home / catalogue / «+» sheet / search cards (session `features.legacyFold`), the bot keyboard
 * and the AI chat knowledge all read THIS map, so the target of a tool exists in one place.
 *
 * Each entry is the Studio query the tool opens with (`tab` = `StudioPage` `tabFromSearch`). P8a: «Rasm» (`image`,
 * slug `rasm`) → the «Rasm» tab, «Video yaratish» (`video`) → the «Video» tab. A later package adds its own tools here.
 */
export const STUDIO_PATH = "/uz/studio";

export const LEGACY_FOLD: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  image: { tab: "rasm" },
  video: { tab: "video" },
};

/** The Studio query of a folded tool, `null` for a tool that is not folded. */
export function foldOf(toolId: string): Readonly<Record<string, string>> | null {
  return Object.prototype.hasOwnProperty.call(LEGACY_FOLD, toolId) ? LEGACY_FOLD[toolId]! : null;
}

/** `/uz/studio?tab=…` for a folded tool, without any other query. */
function studioHref(fold: Readonly<Record<string, string>>): string {
  return `${STUDIO_PATH}?${new URLSearchParams(fold as Record<string, string>).toString()}`;
}

/**
 * Where a tool's card / button leads: the Studio tab while the fold is on and the tool is folded, else the tool's own
 * page `/uz/<slug>` (today's link, unchanged).
 */
export function toolHref(tool: { id: string; slug: string }, legacyFold: boolean | null | undefined): string {
  const fold = legacyFold ? foldOf(tool.id) : null;
  return fold ? studioHref(fold) : `/uz/${tool.slug}`;
}

type Search = Record<string, string | string[] | undefined> | null | undefined;

/**
 * The server redirect of an old tool page while the fold is on: the Studio tab, KEEPING the rest of the query (a bot
 * keyboard link carries the personal `?bt=` login token, a Telegram Mini App its `tgWebApp…` params). The fold's own
 * keys (`tab`) win over the same keys in the request. `null` = the fold is off or the tool is not folded: the old page
 * renders exactly as before.
 */
export function legacyFoldTarget(toolId: string, legacyFold: boolean, search: Search): string | null {
  const fold = legacyFold ? foldOf(toolId) : null;
  if (!fold) return null;
  const q = new URLSearchParams(fold as Record<string, string>);
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value === undefined || Object.prototype.hasOwnProperty.call(fold, key)) continue;
    for (const v of Array.isArray(value) ? value : [value]) q.append(key, v);
  }
  return `${STUDIO_PATH}?${q.toString()}`;
}
