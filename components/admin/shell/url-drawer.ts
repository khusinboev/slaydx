"use client";

import { useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Open/close for a detail drawer whose open state lives in the URL (`?id=`).
 *
 * `open(id)` PUSHES `?id=…`, so the URL entry is the drawer's history entry:
 * the phone's back button (or the Telegram BackButton) pops it and the drawer
 * closes. Render the drawer with `history={false}`, otherwise it would add a
 * second entry on top of the URL one.
 *
 * `close()` (X, backdrop, Escape) goes back to the list WITHOUT `id` when
 * this page pushed the entry (so the list is not pushed again: no ping-pong),
 * and REPLACES `?id` away when the drawer came from a deep link or a reload
 * (there is no list entry below it to go back to).
 *
 * A filter shortcut inside the drawer should keep using a plain replace
 * (`?id` dropped together with the new filter): the drawer's entry becomes the
 * narrowed list.
 */
export function useUrlDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pushed = useRef(false);

  const hrefWith = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );

  const open = useCallback(
    (id: string) => {
      pushed.current = true;
      router.push(hrefWith({ id }), { scroll: false });
    },
    [hrefWith, router],
  );

  const close = useCallback(() => {
    const listHref = hrefWith({ id: null });
    // A plain history.back(), not `backTo()`: the engine treats its own pop between two same-path
    // entries (list ↔ list?id=) as a layer carry and hides it from Next, so the drawer would stay open.
    if (pushed.current) window.history.back();
    else router.replace(listHref, { scroll: false });
  }, [hrefWith, router]);

  return { open, close };
}
