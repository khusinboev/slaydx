"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A Studio form's draft in `localStorage` (docs/studio/P11-SPEC.md «C. Reliability»): a refresh keeps what was typed.
 *
 * Storage is a convenience here: every read and write is guarded, and a private window, blocked site data or a full
 * quota simply means no draft. The key names the user, so a shared browser never shows one account's text to another.
 */
const PREFIX = "slaydx.studio.draft.v1";
/** Typing stays cheap; `pagehide` / a hidden tab / leaving the page write what is pending at once. */
export const DRAFT_DEBOUNCE_MS = 400;

export const draftKey = (userId: string, tab: string): string => `${PREFIX}.${userId}.${tab}`;

/** The stored value, or `null`: nothing stored, storage unavailable, or a value that is not JSON. */
export function readDraft(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No storage, or the quota is full: the form goes on without a draft.
  }
}

export function removeDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // No storage: there is nothing to remove.
  }
}

/**
 * Keeps `value` in the draft `key` (`null` = no draft: signed out). On a new key the stored draft goes through `parse`
 * (stored JSON is untrusted) and, when usable, into `apply`. `clear` forgets the draft: the value on screen is not saved
 * again until it changes.
 */
export function useDraft<T>(key: string | null, value: T, parse: (stored: unknown) => T | null, apply: (draft: T) => void): { clear: () => void } {
  // The value the storage already reflects: the initial one, a restored one, or one just cleared.
  const clean = useRef<T>(value);
  const latest = useRef<T>(value);
  const replaced = useRef<T | null>(null);
  const pending = useRef<{ key: string; value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlers = useRef({ parse, apply });

  useEffect(() => {
    handlers.current = { parse, apply };
    latest.current = value;
  });

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) writeDraft(p.key, p.value);
  }, []);

  useEffect(() => {
    if (key === null) return;
    const stored = readDraft(key);
    const draft = stored === null ? null : handlers.current.parse(stored);
    // The value on screen until `apply` lands is not the user's: it must never overwrite the draft just read, not even
    // through the `flush` of a StrictMode remount.
    replaced.current = latest.current;
    clean.current = draft ?? latest.current;
    if (draft !== null) handlers.current.apply(draft);
  }, [key]);

  useEffect(() => {
    if (key === null) return;
    if (value === clean.current || value === replaced.current) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      return;
    }
    pending.current = { key, value };
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DRAFT_DEBOUNCE_MS);
  }, [key, value, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    clean.current = latest.current;
    if (key !== null) removeDraft(key);
  }, [key]);

  return { clear };
}
