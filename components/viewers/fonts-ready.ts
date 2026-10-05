"use client";

import { useSyncExternalStore } from "react";

/**
 * Web-font load counter for measured pagination (ops sprint WP-A).
 *
 * The document font (Tinos) is not preloaded any more (`app/layout.tsx`
 * `preload: false`): the browser fetches it the first time the viewer lays
 * out text in `--font-doc`, i.e. while the pages are being MEASURED. That
 * first measurement therefore runs on the size-adjusted fallback face, and
 * the page breaks could differ from the DOCX ("ko'rdim = oldim"). Every
 * finished font load bumps this counter; the measuring hooks
 * (`useMeasuredPages`, `WordViewer`) use it as a dependency and measure again
 * with the real face.
 *
 * The listener is attached when this module is evaluated (it ships in the
 * viewer chunk, before any measure node renders), so a load that starts
 * during the first layout is never missed. A face that was already loaded
 * needs no re-measure: the first measurement used it.
 */

let epoch = 0;
const listeners = new Set<() => void>();

function bump(): void {
  epoch += 1;
  for (const l of listeners) l();
}

/** Attaches to `document.fonts`; no-op on the server and in engines without the Font Loading API. */
export function watchFontLoads(fonts: FontFaceSet | undefined = typeof document === "undefined" ? undefined : document.fonts): void {
  if (!fonts) return;
  if (typeof fonts.addEventListener === "function") {
    fonts.addEventListener("loadingdone", bump);
  } else if (fonts.ready && typeof fonts.ready.then === "function") {
    // Without FontFaceSet events: one re-measure once the loads in flight settle.
    void fonts.ready.then(bump);
  }
}

watchFontLoads();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const read = () => epoch;
const server = () => 0;

/** Number of web-font loads finished so far; changes ⇒ measured layout is stale. */
export function useFontEpoch(): number {
  return useSyncExternalStore(subscribe, read, server);
}
