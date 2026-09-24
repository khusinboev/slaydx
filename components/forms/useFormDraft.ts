"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
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
 * yuboriladi (`keepalive` bilan — oddiy so'rovni brauzer sahifa yopilganda
 * bekor qiladi), aks holda oxirgi 1,2 soniyalik yozuv yo'qolardi.
 */

const DEBOUNCE_MS = 1_200;

/**
 * Qoralama hajmi chegarasi — serverdagi `DRAFT_MAX_BYTES` (200 000,
 * `lib/server/form-draft.ts`) dan biroz past (`{"data":…}` o'rami uchun
 * zaxira). Undan kattasi yuborilmaydi: server 413 bilan rad etardi.
 */
export const DRAFT_BUDGET_BYTES = 190_000;
/** Brauzer `keepalive` tanasini ~64 KB bilan cheklaydi — kattasi oddiy so'rov. */
const KEEPALIVE_MAX_BYTES = 60_000;

/**
 * Qoralamaga ketadigan shakl (FE-17).
 *
 * Fayldan olingan matn (`sourceText` + `fileName`) — 200 000 belgigacha,
 * kirillda ~400 KB: ilgari u HAR PUT ga qo'shilib, 413 bilan butun
 * qoralamani to'xtatardi. Uni foydalanuvchi faylidan istalgan payt qayta
 * olish mumkin, shuning uchun qoralamada faqat HAVOLA — fayl nomi qoladi.
 * Qo'lda yozilgan matn (`fileName` bo'sh) — foydalanuvchining o'z mehnati,
 * u saqlanadi.
 */
export function draftPayload(values: FormValues): FormValues {
  if (typeof values.fileName === "string" && values.fileName && values.sourceText) {
    const rest: FormValues = { ...values };
    delete rest.sourceText;
    return rest;
  }
  return values;
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/**
 * Qoralama holati — `ToolChrome` dagi `DraftNotice` o'qiydi (har composerni
 * alohida o'zgartirmaslik uchun umumiy store: bir vaqtda bitta forma ochiq).
 */
export type DraftNoticeState = {
  /** Oxirgi saqlash yiqildi — sahifa yopilsa oxirgi o'zgarishlar yo'qolishi mumkin. */
  failed: boolean;
  /** Tiklangan qoralamada matni saqlanmagan fayl nomi — «qayta biriktiring». */
  detachedFile: string | null;
};
export const useDraftNotice = create<DraftNoticeState>(() => ({ failed: false, detachedFile: null }));

/**
 * Tiklash: fayl nomi bor, matni yo'q (`draftPayload` uni tashlagan) —
 * fayl «biriktirilgan» bo'lib ko'rinmasin (forma matnsiz fayl bilan
 * yuborilardi); nomi esa eslatma uchun qaytadi.
 */
function restorePayload(data: FormValues): { values: FormValues; detached: string | null } {
  if (typeof data.fileName === "string" && data.fileName && !data.sourceText) {
    return { values: { ...data, fileName: "" }, detached: data.fileName };
  }
  return { values: data, detached: null };
}

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
          const { values, detached } = restorePayload(r.draft.data);
          setDraft(values);
          if (detached) useDraftNotice.setState({ detachedFile: detached });
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

  // Forma yopilganda eslatmalar keyingi formaga o'tib ketmasin.
  useEffect(() => () => useDraftNotice.setState({ failed: false, detachedFile: null }), []);

  const send = useCallback(
    (data: FormValues, unloading: boolean) => {
      const payload = draftPayload(data);
      const size = byteLength(JSON.stringify({ data: payload }));
      if (size > DRAFT_BUDGET_BYTES) {
        // Server 413 bilan rad etadi — yubormaymiz, lekin JIM ham qolmaymiz.
        useDraftNotice.setState({ failed: true });
        return;
      }
      putDraft(toolId, payload, { keepalive: unloading && size <= KEEPALIVE_MAX_BYTES })
        .then(() => {
          if (useDraftNotice.getState().failed) useDraftNotice.setState({ failed: false });
        })
        .catch((e: unknown) => {
          console.warn("[draft] qoralama saqlanmadi", e);
          useDraftNotice.setState({ failed: true });
        });
    },
    [toolId],
  );

  const flushWith = useCallback(
    (unloading: boolean) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const data = pending.current;
      pending.current = null;
      if (data) send(data, unloading);
    },
    [send],
  );
  const flush = useCallback(() => flushWith(false), [flushWith]);

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
    const onHide = () => flushWith(true);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      // Komponent yo'qolganda ham kutilayotgan yozuv saqlanadi.
      flushWith(false);
    };
  }, [flushWith]);

  const clear = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    setDraft(null);
    useDraftNotice.setState({ failed: false, detachedFile: null });
    if (enabled) await clearDraft(toolId).catch(() => {});
  }, [enabled, toolId]);

  return { draft, ready, save, clear, flush };
}
