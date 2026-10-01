"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AdminAuthRequiredError,
  AdminForbiddenError,
  adminErrorMessage,
  adminRequestId,
  isAbortError,
  type ListResult,
} from "@/lib/admin-api/core";

/**
 * Filter and list state shared by the payments and finance tables.
 *
 * A table runs in one of two modes:
 *   - routed (its own page): filters live in the URL query (shareable, back
 *     button works) and are written with `router.replace`;
 *   - embedded (inside another page, e.g. a user's tabs): filters live in
 *     local state and the URL is never touched.
 * Both expose the same `FilterStore`, so the table body does not care.
 */

export type FilterValues<K extends string> = Record<K, string>;

export type FilterStore<K extends string> = {
  values: FilterValues<K>;
  /** Merges the patch; an empty string removes the filter. */
  set: (patch: Partial<FilterValues<K>>) => void;
  /** Removes every filter in `keys`. */
  clear: () => void;
};

function emptyValues<K extends string>(keys: readonly K[]): FilterValues<K> {
  return Object.fromEntries(keys.map((k) => [k, ""])) as FilterValues<K>;
}

/** Routed mode: the URL query is the state. `keys` must be a stable (module-level) array. */
export function useUrlFilters<K extends string>(keys: readonly K[]): FilterStore<K> {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = params?.toString() ?? "";

  const values = useMemo(() => {
    const sp = new URLSearchParams(query);
    return Object.fromEntries(keys.map((k) => [k, sp.get(k) ?? ""])) as FilterValues<K>;
  }, [query, keys]);

  const set = useCallback(
    (patch: Partial<FilterValues<K>>) => {
      const sp = new URLSearchParams(query);
      for (const [k, v] of Object.entries(patch) as Array<[string, string | undefined]>) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [query, router, pathname],
  );

  const clear = useCallback(() => set(emptyValues(keys)), [set, keys]);
  return { values, set, clear };
}

/** Embedded mode: plain component state, the URL is never written. */
export function useLocalFilters<K extends string>(keys: readonly K[]): FilterStore<K> {
  const [values, setValues] = useState<FilterValues<K>>(() => emptyValues(keys));
  const set = useCallback((patch: Partial<FilterValues<K>>) => {
    setValues((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch) as Array<[K, string | undefined]>) next[k] = v ?? "";
      return next;
    });
  }, []);
  const clear = useCallback(() => setValues(emptyValues(keys)), [keys]);
  return { values, set, clear };
}

export type ListState<T> =
  | { status: "loading"; data: ListResult<T> | null }
  | { status: "ready"; data: ListResult<T> }
  | { status: "error"; data: null; message: string; requestId?: string }
  | { status: "forbidden"; data: null };

/**
 * Loads one page of a keyset list. `fetchKey` identifies the filters: when it
 * changes the cursor resets to the first page and the pending request is
 * aborted (no stale page can overwrite a newer one). While a page loads, the
 * previous rows stay on screen (dimmed by the table).
 */
export function useCursorList<T>(fetchKey: string, load: (cursor: string | null, signal: AbortSignal) => Promise<ListResult<T>>) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [seenKey, setSeenKey] = useState(fetchKey);
  if (seenKey !== fetchKey) {
    // Resetting state on a prop change during render is React's recommended pattern.
    setSeenKey(fetchKey);
    setCursor(null);
  }
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<ListState<T>>({ status: "loading", data: null });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    const ctl = new AbortController();
    setState((s) => ({ status: "loading", data: s.status === "ready" || s.status === "loading" ? s.data : null }));
    loadRef.current(cursor, ctl.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        // The login redirect has started; nothing to render.
        if (e instanceof AdminAuthRequiredError) return;
        if (e instanceof AdminForbiddenError) setState({ status: "forbidden", data: null });
        else setState({ status: "error", data: null, message: adminErrorMessage(e), requestId: adminRequestId(e) });
      });
    return () => ctl.abort();
  }, [fetchKey, cursor, reload]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  return { state, cursor, setCursor, retry };
}

/** Same pattern for a single resource (detail pages, summaries). */
export type ResourceState<T> =
  | { status: "loading"; data: T | null }
  | { status: "ready"; data: T }
  | { status: "error"; data: null; message: string; requestId?: string; notFound: boolean }
  | { status: "forbidden"; data: null };

export function useResource<T>(fetchKey: string, load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<ResourceState<T>>({ status: "loading", data: null });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    setState((s) => ({ status: "loading", data: s.status === "ready" || s.status === "loading" ? s.data : null }));
    loadRef.current(ctl.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        if (e instanceof AdminAuthRequiredError) return;
        if (e instanceof AdminForbiddenError) {
          setState({ status: "forbidden", data: null });
          return;
        }
        const notFound = Boolean(e && typeof e === "object" && (e as { status?: unknown }).status === 404);
        setState({ status: "error", data: null, message: adminErrorMessage(e), requestId: adminRequestId(e), notFound });
      });
    return () => ctl.abort();
  }, [fetchKey, reload, enabled]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  return { state, retry };
}
