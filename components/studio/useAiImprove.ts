"use client";

import { useCallback, useSyncExternalStore } from "react";
import { draftKey, readDraft, writeDraft } from "@/lib/studio-draft-store";
import { useAppStore } from "@/lib/store";

/** The choice of a browser that refuses storage. */
const held = new Map<string, boolean>();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function current(key: string): boolean {
  const stored = readDraft(key);
  return typeof stored === "boolean" ? stored : (held.get(key) ?? true);
}

/**
 * «AI yaxshilash» (docs/studio/P11-SPEC.md «G»): one choice per user, shared by every prompt box. On by default. It sits with
 * the user's drafts but outlives them: a submit clears the form's draft, and must not turn the switch back on. A logout
 * forgets it, as it forgets every draft. Storage is a convenience: without it the choice lasts for the page visit.
 */
export function useAiImprove(): { on: boolean; setOn: (v: boolean) => void } {
  const key = draftKey(String(useAppStore((s) => s.user?.id ?? "anon")), "ai-improve");
  const on = useSyncExternalStore(subscribe, () => current(key), () => true);
  const setOn = useCallback(
    (v: boolean) => {
      writeDraft(key, v);
      // Held only while storage refuses: a value kept beside a working storage would outlive a logout.
      if (readDraft(key) === v) held.delete(key);
      else held.set(key, v);
      for (const fn of listeners) fn();
    },
    [key],
  );
  return { on, setOn };
}
