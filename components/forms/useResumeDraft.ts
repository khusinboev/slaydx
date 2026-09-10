"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearResumeDraft, fetchResumeDraft, saveResumeDraft } from "@/lib/api-client";
import type { FormValues } from "@/lib/types";

/**
 * Rezyume formasi qoralamasi (Rezyume 2, 1-band).
 *
 * Yozilganda darhol emas, 1,2 s tinchlikdan keyin saqlanadi (debounce) —
 * har harf uchun so'rov yuborish tarmoqni ham, chastota chegarasini ham
 * yeb qo'yardi. Sahifa yopilishi yoki tab almashishi kutilmagan hodisa
 * emas: `visibilitychange`/`pagehide` da kutilayotgan saqlash DARHOL
 * yuboriladi, aks holda oxirgi 1,2 soniyalik yozuv yo'qolardi.
 */

const DEBOUNCE_MS = 1_200;

export function useResumeDraft(loggedIn: boolean) {
  const [draft, setDraft] = useState<FormValues | null>(null);
  const [ready, setReady] = useState(false);
  const pending = useRef<FormValues | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    if (!loggedIn) {
      setReady(true);
      return;
    }
    fetchResumeDraft()
      .then((r) => {
        if (!alive) return;
        setDraft(r.draft?.data ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [loggedIn]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const data = pending.current;
    pending.current = null;
    if (data) void saveResumeDraft(data).catch(() => {});
  }, []);

  const save = useCallback(
    (values: FormValues) => {
      if (!loggedIn) return;
      pending.current = values;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [loggedIn, flush],
  );

  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      // Komponent yo'qolganda ham kutilayotgan yozuv saqlanadi.
      flush();
    };
  }, [flush]);

  const clear = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    setDraft(null);
    if (loggedIn) await clearResumeDraft().catch(() => {});
  }, [loggedIn]);

  return { draft, ready, save, clear, flush };
}
