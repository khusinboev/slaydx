"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";

/* ───────────────────────────── loading state ───────────────────────────── */

export type LoadState<T> =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; data: T };

type Settled<T> = { load: unknown; reload: number; state: Exclude<LoadState<T>, { status: "loading" }> };

/**
 * Runs `load` whenever its identity changes (memoise it with `useCallback`) or
 * `retry()` is called. The previous request is aborted first, so a stale answer
 * can never overwrite a newer one. 403 becomes `forbidden`; an abort is silent.
 * While a newer request is pending the state is `loading` again (the page keeps
 * showing its skeleton instead of stale data).
 */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>): [LoadState<T>, () => void] {
  const [reload, setReload] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal)
      .then((data) => setSettled({ load, reload, state: { status: "ready", data } }))
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted) return;
        if (e instanceof ApiError && e.status === 403) {
          setSettled({ load, reload, state: { status: "forbidden" } });
          return;
        }
        setSettled({ load, reload, state: { status: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) } });
      });
    return () => ctl.abort();
  }, [load, reload]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  // A result belongs to the request that produced it; anything else is still loading.
  const state: LoadState<T> = settled && settled.load === load && settled.reload === reload ? settled.state : { status: "loading" };
  return [state, retry];
}

/* ───────────────────────────── clock ───────────────────────────── */

/** Re-renders every `intervalMs` so relative times ("3 daqiqa oldin") stay honest on a page left open. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
