"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminAuthRequiredError, AdminForbiddenError, adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";
import { listProviders, type ProviderItem, type ProvidersResponse } from "@/lib/admin-api/providers";

export type ProvidersState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; data: ProvidersResponse };

/**
 * Loads the provider list. `reload` repeats the request (the previous one is aborted); `replace` swaps in the
 * item a successful write returned, so the page updates without another round trip. A 401 `admin_auth` keeps
 * the skeleton: the core has already started the redirect to the login page.
 */
export function useProviders(): { state: ProvidersState; reload: () => void; replace: (item: ProviderItem) => void } {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; value: ProvidersState }>({ attempt: 0, value: { status: "loading" } });

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
  const replace = useCallback((item: ProviderItem) => {
    setLoaded((cur) =>
      cur.value.status === "ready"
        ? {
            attempt: cur.attempt,
            value: { status: "ready", data: { ...cur.value.data, items: cur.value.data.items.map((i) => (i.id === item.id ? item : i)) } },
          }
        : cur,
    );
  }, []);

  // A result of an older attempt is never shown (loading until the new one lands).
  const state: ProvidersState = loaded.attempt === attempt ? loaded.value : { status: "loading" };
  return { state, reload, replace };
}
