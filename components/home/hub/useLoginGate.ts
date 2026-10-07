"use client";

import { useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";

/**
 * Login gate for the hub's tool links — the «+» sheet's rule (`CreateSheet`
 * `onPick`): the link still navigates, and once the session is KNOWN to be
 * signed out the login opens over the target with `returnTo` (one gesture;
 * NavProvider keeps it open). FE-09: an unchecked session is not «signed out».
 */
export function useLoginGate(): (href: string) => void {
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const open = useUi((s) => s.open);
  return useCallback(
    (href: string) => {
      if (sessionChecked && !loggedIn) open("login", { returnTo: href });
    },
    [sessionChecked, loggedIn, open],
  );
}
