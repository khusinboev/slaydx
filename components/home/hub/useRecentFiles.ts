"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { recentFiles } from "./hub-model";

export type RecentState =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "error"; retry: () => void }
  | { phase: "ready"; files: api.ServerGeneration[] };

/** Same back-off as the Ishlarim list (`HomeFiles`, FE-12): 3 s, ×1.5, at most 15 s. */
const POLL_START_MS = 3000;
const POLL_MAX_MS = 15_000;

/**
 * «Davom ettirish» data: the store's first page of files (`refreshGenerations`
 * → `GET /api/generations`, the list Ishlarim and the search dialog read) — no
 * request of its own while the store has rows.
 *
 *   - `loading` until the session and the first page are known;
 *   - while a file is queued / being written the store is refreshed with the
 *     Ishlarim back-off (hidden tab: no requests), so «Yozilmoqda N%» moves;
 *   - an EMPTY page is confirmed with one `limit=1` request before the empty
 *     state is shown: the store keeps an empty list when its load failed
 *     (`refreshGenerations` swallows the error), and «Hozircha fayl yo'q» must
 *     not be said to someone whose files did not load. That request failing
 *     is the `error` phase (with «Qayta urinish»); if it finds files the store
 *     is refreshed.
 */
export function useRecentFiles(n = 3): RecentState {
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const generations = useAppStore((s) => s.generations);
  const loaded = useAppStore((s) => s.generationsLoaded);
  const refresh = useAppStore((s) => s.refreshGenerations);
  // Result of the empty-list check: null = not checked yet / running.
  const [emptyCheck, setEmptyCheck] = useState<"empty" | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);

  const files = useMemo(() => recentFiles(generations, n), [generations, n]);
  const empty = loggedIn && loaded && generations.length === 0;

  useEffect(() => {
    if (!empty) {
      setEmptyCheck(null);
      return;
    }
    let alive = true;
    setEmptyCheck(null);
    api
      .listGenerations({ limit: 1 })
      .then(async (page) => {
        if (!alive) return;
        if (!page.generations.length) {
          setEmptyCheck("empty");
          return;
        }
        // Files exist but the store missed them: reload it; still empty → its load keeps failing.
        await refresh();
        if (alive && useAppStore.getState().generations.length === 0) setEmptyCheck("error");
      })
      .catch(() => {
        if (alive) setEmptyCheck("error");
      });
    return () => {
      alive = false;
    };
  }, [empty, attempt, refresh]);

  const running = generations.some((g) => g.status === "QUEUED" || g.status === "IN_PROGRESS");
  useEffect(() => {
    if (!running || !loggedIn) return;
    const ctrl = new AbortController();
    void (async () => {
      let delay = POLL_START_MS;
      for (;;) {
        await api.waitTurn(delay, ctrl.signal);
        await refresh();
        delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.5));
      }
    })().catch(() => {
      // Aborted on unmount, or a failed refresh: the rows stay as they are.
    });
    return () => ctrl.abort();
  }, [running, loggedIn, refresh]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  if (!sessionChecked) return { phase: "loading" };
  if (!loggedIn) return { phase: "signed-out" };
  if (!loaded) return { phase: "loading" };
  if (files.length) return { phase: "ready", files };
  if (emptyCheck === "error") return { phase: "error", retry };
  if (emptyCheck === "empty") return { phase: "ready", files: [] };
  return { phase: "loading" };
}
