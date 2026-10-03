"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  continueBack,
  pushLayer,
  refreshNav,
  registerGuard,
  releaseLayer,
  runGuard,
  type LeaveGuard,
} from "@/lib/nav/history";

export type LeaveGuardOptions = {
  /** The save failed: the user stays on the page; show this error. */
  onError?: (error: unknown) => void;
};

/**
 * Owner decision 1 (docs/nav/PLAN.md): unsaved edits are AUTO-SAVED when the
 * user leaves, then the navigation continues. If the save fails the user
 * stays and `onError` gets the error. No prompt.
 *
 * While `pending > 0` the guard
 *   - pushes one same-URL "guard" history entry: a back press pops it, the
 *     guard saves, then `continueBack()` goes on (back, or the parent page);
 *   - is consulted by `backTo()` (BackLink, Telegram BackButton);
 *   - intercepts internal `<a>` clicks in the capture phase (save, then go);
 *   - turns on Telegram's closing confirmation (via the nav snapshot).
 * `beforeunload` for tab close stays with the caller (`useDocEdit`).
 *
 * `save` resolves `false` (or throws) on failure, like `useDocEdit().save`.
 */
export function useLeaveGuard(
  pending: number,
  save: () => Promise<boolean | void>,
  opts?: LeaveGuardOptions,
): { saving: boolean } {
  const pendingRef = useRef(pending);
  const saveRef = useRef(save);
  const errorRef = useRef(opts?.onError);
  useLayoutEffect(() => {
    pendingRef.current = pending;
    saveRef.current = save;
    errorRef.current = opts?.onError;
    refreshNav();
  });
  const [saving, setSaving] = useState(false);

  const guard = useMemo<LeaveGuard>(
    () => ({
      isPending: () => pendingRef.current > 0,
      save: async () => {
        setSaving(true);
        try {
          return await saveRef.current();
        } finally {
          setSaving(false);
        }
      },
      onError: (e) => errorRef.current?.(e),
    }),
    [],
  );

  useEffect(() => registerGuard(guard), [guard]);

  const dirty = pending > 0;
  // Bumped when a back-press save failed: the guard entry is pushed again.
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!dirty) return;
    const token = pushLayer("guard", (info) => {
      if (info.reason === "back" && info.landedOnBase) {
        void runGuard(guard).then((ok) => {
          if (ok) continueBack();
          else setRev((r) => r + 1);
        });
      } else {
        // The page is being left by a jump that bypassed the guard: best effort.
        void runGuard(guard);
      }
    });
    return () => releaseLayer(token);
  }, [dirty, rev, guard]);

  return { saving };
}
