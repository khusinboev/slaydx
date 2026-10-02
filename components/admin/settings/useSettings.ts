"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminAuthRequiredError, AdminForbiddenError, adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";
import { listSettings, type SettingItem } from "@/lib/admin-api/settings";

export type SettingsState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; items: SettingItem[] };

/**
 * Loads the settings list. `reload` repeats the request (the previous one is
 * aborted); `replace` swaps in the item a successful write returned, so the
 * page updates without another round trip. A 401 `admin_auth` keeps the
 * skeleton: the core has already started the redirect to the login page.
 */
export function useSettings(): { state: SettingsState; reload: () => void; replace: (item: SettingItem) => void } {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; value: SettingsState }>({ attempt: 0, value: { status: "loading" } });

  useEffect(() => {
    const ctl = new AbortController();
    listSettings({ signal: ctl.signal })
      .then((r) => setLoaded({ attempt, value: { status: "ready", items: r.items } }))
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted || e instanceof AdminAuthRequiredError) return;
        const value: SettingsState =
          e instanceof AdminForbiddenError
            ? { status: "forbidden" }
            : { status: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) };
        setLoaded({ attempt, value });
      });
    return () => ctl.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const replace = useCallback((item: SettingItem) => {
    setLoaded((cur) =>
      cur.value.status === "ready"
        ? { attempt: cur.attempt, value: { status: "ready", items: cur.value.items.map((i) => (i.key === item.key ? item : i)) } }
        : cur,
    );
  }, []);

  // A result of an older attempt is never shown (loading until the new one lands).
  const state: SettingsState = loaded.attempt === attempt ? loaded.value : { status: "loading" };
  return { state, reload, replace };
}
