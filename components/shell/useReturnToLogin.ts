"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { replaceSearch, useUi } from "@/lib/ui";

/**
 * `?returnTo=<path>` on a page: once the session is known, a signed-out user
 * gets the login with that target, and the parameter leaves the URL (a reload
 * must not reopen it). The value is sanitised in one place, `useUi.open`
 * (`safeReturnTo`, C02/FE-01/SECA-02). Bosh (`/uz`) uses it; Ishlarim keeps
 * its own copy inside `HomeFiles`.
 *
 * Needs a `<Suspense>` boundary above it (`useSearchParams`).
 */
export function useReturnToLogin(): void {
  const params = useSearchParams();
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const open = useUi((s) => s.open);
  useEffect(() => {
    const ret = params?.get("returnTo");
    if (!ret || !sessionChecked) return;
    if (!loggedIn) open("login", { returnTo: ret });
    const rest = new URLSearchParams(params?.toString() ?? "");
    rest.delete("returnTo");
    replaceSearch(rest);
  }, [params, loggedIn, sessionChecked, open]);
}
