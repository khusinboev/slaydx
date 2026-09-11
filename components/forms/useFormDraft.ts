"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearDraft, getDraft, putDraft } from "@/lib/api-client";
import type { FormValues } from "@/lib/types";

/**
 * Umumiy forma qoralamasi (Maqola 2 / AUDIT-17, WP4) — ilgari faqat
 * rezyumeda bor edi (`useResumeDraft`); endi har VOSITA (`toolId`) shu
 * hookdan foydalanadi — `useResumeDraft` endi shunga yupqa o'ram.
 *
 * Yozilganda darhol emas, 1,2 s tinchlikdan keyin saqlanadi (debounce) —
 * har harf uchun so'rov yuborish tarmoqni ham, chastota chegarasini ham
 * yeb qo'yardi. Sahifa yopilishi yoki tab almashishi kutilmagan hodisa
 * emas: `visibilitychange`/`pagehide` da kutilayotgan saqlash DARHOL
 * yuboriladi, aks holda oxirgi 1,2 soniyalik yozuv yo'qolardi.
 */

const DEBOUNCE_MS = 1_200;

export type UseFormDraftOptions = {
  /** `false` bo'lsa (kirmagan foydalanuvchi) qoralama umuman so'ralmaydi/yuborilmaydi. */
  enabled: boolean;
  /**
   * Qoralama TOPILMAGANDA (birinchi kirish) ko'rsatiladigan boshlang'ich
   * qiymatlar — masalan profildan prefill qilingan maydonlar. Faqat
   * MOUNT paytida, bir marta ishlatiladi (server javobi kelgandan keyin).
   */
  prefill?: FormValues | (() => FormValues);
};

export function useFormDraft(toolId: string, opts: UseFormDraftOptions) {
  const { enabled, prefill } = opts;
  const [draft, setDraft] = useState<FormValues | null>(null);
  const [ready, setReady] = useState(false);
  const pending = useRef<FormValues | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    if (!enabled) {
      setReady(true);
      return;
    }
    getDraft(toolId)
      .then((r) => {
        if (!alive) return;
        if (r.draft?.data) {
          setDraft(r.draft.data);
        } else {
          const initial = typeof prefill === "function" ? prefill() : prefill;
          setDraft(initial ?? null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
    // `prefill` MOUNT paytida bir marta o'qiladi — dep ro'yxatida yo'q,
    // aks holda har render'da qayta so'ralardi (`enabled`/`toolId`
    // o'zgarganda yetarli).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, toolId]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const data = pending.current;
    pending.current = null;
    if (data) void putDraft(toolId, data).catch(() => {});
  }, [toolId]);

  const save = useCallback(
    (values: FormValues) => {
      if (!enabled) return;
      pending.current = values;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [enabled, flush],
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
    if (enabled) await clearDraft(toolId).catch(() => {});
  }, [enabled, toolId]);

  return { draft, ready, save, clear, flush };
}
