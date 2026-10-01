"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminAuthRequiredError, AdminForbiddenError, adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; data: T };

/**
 * Loads one dashboard block. A new `key` (the period) aborts the request in
 * flight and starts over from the loading state; `retry` repeats the same key.
 * A 401 `admin_auth` keeps the skeleton: the core has already started the
 * redirect to the login page.
 */
export function useLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>): [LoadState<T>, () => void] {
  const [state, setState] = useState<{ key: string; attempt: number; value: LoadState<T> }>({
    key,
    attempt: 0,
    value: { status: "loading" },
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal)
      .then((data) => setState({ key, attempt, value: { status: "ready", data } }))
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted || e instanceof AdminAuthRequiredError) return;
        const value: LoadState<T> =
          e instanceof AdminForbiddenError
            ? { status: "forbidden" }
            : { status: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) };
        setState({ key, attempt, value });
      });
    return () => ctl.abort();
    // `load` is rebuilt on every render; `key` names what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // A result of an older key or attempt is never shown (loading until the new one lands).
  const current = state.key === key && state.attempt === attempt ? state.value : ({ status: "loading" } as const);
  return [current, retry];
}
