"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isTopLayer, pushLayer, releaseLayer } from "@/lib/nav/history";

export type OverlayHistoryOptions = {
  /** `false`: no history entry (the overlay's open state already lives in the URL). Default `true`. */
  enabled?: boolean;
};

/**
 * Gives an overlay its own history entry, so the phone's back button (and
 * the Telegram BackButton) closes it instead of leaving the page.
 *
 *   - open → one same-URL entry is pushed (no URL change);
 *   - back press → only the TOP overlay's `onClose` runs;
 *   - `onClose` from the overlay itself (button, Escape, unmount) → its entry
 *     is popped exactly once; after a back press nothing is popped again;
 *   - nested overlays unwind LIFO; StrictMode's remount reuses the entry;
 *   - if `onClose` declines to close (busy), the entry is pushed again.
 *
 * `onClose` may change identity every render; only `open` drives the entry.
 * To navigate from inside the overlay use `useNav().navigateFromOverlay`.
 */
export function useOverlayHistory(open: boolean, onClose: () => void, opts?: OverlayHistoryOptions) {
  const enabled = opts?.enabled !== false;
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  const tokenRef = useRef<string | null>(null);
  // Bumped after a back press so that an overlay that stayed open re-arms.
  const [rev, setRev] = useState(0);

  useEffect(() => {
    if (!open || !enabled) return;
    const token = pushLayer("overlay", () => {
      if (tokenRef.current === token) tokenRef.current = null;
      setRev((r) => r + 1);
      closeRef.current();
    });
    tokenRef.current = token;
    return () => {
      if (tokenRef.current === token) tokenRef.current = null;
      releaseLayer(token);
    };
  }, [open, enabled, rev]);

  return useMemo(
    () => ({
      /** This overlay is the topmost open one. */
      isTop: () => tokenRef.current != null && isTopLayer(tokenRef.current),
    }),
    [],
  );
}
