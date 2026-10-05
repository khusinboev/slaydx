/**
 * Screen copy of a slide image (ops sprint D5, `docs/ops/PLAN.md`; O4 WP-F).
 *
 * The worker stores a light copy next to each slide image (max 1024 px
 * wide, JPEG q80 — `lib/server/assets.ts` `makeViewCopy`). The viewer asks
 * for it by adding this query flag to the asset URL; the asset route answers
 * with the copy when it exists and with the original otherwise (old decks,
 * user uploads, logos). The URL stored in `doc_json` never changes, so the
 * PPTX rebuild (`assetImageResolver`) and every download keep reading the
 * original bytes.
 *
 * Client-safe on purpose (no `server-only`): `SlideCanvas` and the asset
 * route share this one definition of the flag.
 */
export const VIEW_COPY_PARAM = "view";

/** Exactly an own asset path (`assetUrl`): `/api/generations/<uuid>/assets/<hex>`, nothing after it. */
const ASSET_PATH = /^\/api\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/assets\/[0-9a-f]{8,64}$/i;

/**
 * `<img src>` for the screen: own asset paths get `?view=1`; anything else
 * (`data:` during a live build, `blob:` previews, external URLs, a path that
 * already has a query) is returned unchanged.
 */
export function viewSrc(url: string): string {
  return ASSET_PATH.test(url) ? `${url}?${VIEW_COPY_PARAM}=1` : url;
}

/** The route side: does this request ask for the screen copy? */
export function wantsViewCopy(url: URL): boolean {
  return url.searchParams.get(VIEW_COPY_PARAM) === "1";
}
