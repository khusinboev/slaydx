"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminAuthRequiredError, AdminForbiddenError, adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";
import { listProviders, type ProvidersResponse } from "@/lib/admin-api/providers";

export type ProvidersState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; data: ProvidersResponse };

/**
 * Loads the page data (providers, purposes, usage, health). `reload` repeats the request and keeps showing the
 * previous data while it runs (`refreshing`), so a change made on the page refreshes every verdict and number
 * without a skeleton flash; the previous request is aborted. A 401 `admin_auth` keeps the skeleton: the core has
 * already started the redirect to the login page.
 */
export function useProviders(): { state: ProvidersState; refreshing: boolean; reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; value: ProvidersState }>({ attempt: -1, value: { status: "loading" } });

  useEffect(() => {
    const ctl = new AbortController();
    listProviders({ signal: ctl.signal })
      .then((data) => setLoaded({ attempt, value: { status: "ready", data } }))
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted || e instanceof AdminAuthRequiredError) return;
        const value: ProvidersState =
          e instanceof AdminForbiddenError
            ? { status: "forbidden" }
            : { status: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) };
        setLoaded({ attempt, value });
      });
    return () => ctl.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // Older data stays on screen while a newer request runs; only the very first load shows the skeleton.
  const refreshing = loaded.attempt !== attempt;
  const state: ProvidersState = loaded.value;
  return { state, refreshing, reload };
}
