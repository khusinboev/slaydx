"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Qurollantiruvchi va tasdiqlovchi bosish orasidagi eng kam vaqt (ms).
 *
 * FE-07: ilgari ikkinchi bosish qancha tez kelmasin, amal bajarilardi —
 * tasodifiy QO'SH BOSISH (ikkinchi bosish ~100–250 ms da keladi) to'langan
 * hujjatni butunlay o'chirardi yoki saqlanmagan tahrirni tashlardi. OS
 * qo'sh bosish chegarasi odatda 500 ms — undan biroz ko'p olinadi.
 */
export const CONFIRM_MIN_MS = 600;

/** Bosish hodisasining kerakli qismi (`MouseEvent.detail` — ketma-ket bosishlar soni). */
type ClickLike = { detail?: number } | undefined;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Tasdiqlovchi bosish qabul qilinadimi.
 *
 * `detail > 1` — brauzer bu bosishni QO'SH bosishning davomi deb sanagan
 * (birinchisi qurollantirgan edi). Aks holda — qurollantirishdan beri
 * kamida {@link CONFIRM_MIN_MS} o'tgan bo'lishi kerak. `HomeFiles` dagi
 * ro'yxat o'chirishi ham shu qoidadan foydalanadi (bitta manba).
 */
export function confirmAccepted(armedAt: number, e?: ClickLike, at: number = now()): boolean {
  if (e && typeof e.detail === "number" && e.detail > 1) return false;
  return at - armedAt >= CONFIRM_MIN_MS;
}

/** Qurollantirish vaqti — `confirmAccepted` bilan juft. */
export const confirmClock = now;

/**
 * Ikki bosqichli tasdiq — qaytarib bo'lmaydigan tugmalar uchun.
 *
 * Ilgari `ResultView` va `HomeFiles` dagi «O'chirish» darhol `DELETE`
 * yuborardi: ro'yxatda yoki hujjat ustida tasodifiy bir bosish hujjatni
 * yo'q qilardi (undo yo'q). Endi birinchi bosish tugmani «qurollantiradi»
 * va `windowMs` ichidagi ikkinchi bosishgina haqiqiy amalni bajaradi;
 * oyna o'tsa holat o'zi tushadi. Juda tez (qo'sh bosish) kelgan ikkinchi
 * bosish e'tiborsiz qoladi — tugma qurollangan holda turadi (FE-07).
 */
export function useConfirmClick(action: () => void, windowMs = 3000) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedAt = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const trigger = useCallback(
    (e?: ClickLike) => {
      if (armed) {
        // Qo'sh bosishning ikkinchi yarmi — tasdiq emas.
        if (!confirmAccepted(armedAt.current, e)) return;
        if (timer.current) clearTimeout(timer.current);
        setArmed(false);
        action();
        return;
      }
      armedAt.current = now();
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), windowMs);
    },
    [armed, action, windowMs],
  );

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
  }, []);

  return { armed, trigger, cancel };
}
