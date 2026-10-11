"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentPropsWithRef } from "react";
import { bearerHeaders, bearerToken, isConsumerApiPath, subscribeBearer } from "./session-transport";

/**
 * Protected media (`<img>` / `<audio>` from our own `/api/…`) in bearer mode
 * (docs/auth/COOKIELESS.md): an element cannot send `Authorization`, so the
 * bytes are fetched with the header and shown from a `blob:` URL (CSP allows
 * `blob:` for img/media). In cookie mode — every normal browser, SSR and the
 * viewer tests — the original URL is returned unchanged, synchronously.
 *
 * While the fetch runs the result is `undefined` (no request, no error event);
 * a failed fetch falls back to the original URL, so the element's own
 * `onError` (401/404 handling) still fires exactly as before.
 */

/** URL → `blob:` URL, bounded; the oldest entries are revoked. */
const MAX_ENTRIES = 300;
const cache = new Map<string, Promise<string>>();

function blobUrl(src: string): Promise<string> {
  const hit = cache.get(src);
  if (hit) return hit;
  const p = fetch(src, { credentials: "same-origin", headers: bearerHeaders(src) }).then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
  });
  cache.set(src, p);
  // A failure is not cached: the next mount asks again.
  p.catch(() => cache.delete(src));
  while (cache.size > MAX_ENTRIES) {
    const [oldest, url] = cache.entries().next().value as [string, Promise<string>];
    cache.delete(oldest);
    void url.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return p;
}

const serverSnapshot = () => null;

/** Is the tab in bearer mode (re-renders when it changes)? */
export function useBearerMode(): boolean {
  return useSyncExternalStore(subscribeBearer, bearerToken, serverSnapshot) !== null;
}

export function useApiSrc(src: string | null | undefined): string | undefined {
  const bearer = useBearerMode();
  const needed = bearer && typeof src === "string" && src !== "" && isConsumerApiPath(src);
  const [resolved, setResolved] = useState<{ src: string; url: string } | null>(null);
  useEffect(() => {
    if (!needed || !src) return;
    let alive = true;
    blobUrl(src).then(
      (url) => alive && setResolved({ src, url }),
      () => alive && setResolved({ src, url: src }),
    );
    return () => {
      alive = false;
    };
  }, [needed, src]);
  if (!needed) return src ?? undefined;
  return resolved && resolved.src === src ? resolved.url : undefined;
}

/** `<img>` whose same-origin `/api/` source also works in bearer mode (see `useApiSrc`). */
export function ApiImg({ src, ...rest }: Omit<ComponentPropsWithRef<"img">, "src"> & { src?: string | null }) {
  const url = useApiSrc(src);
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- private API media; callers pass `alt`.
  return <img src={url} {...rest} />;
}
