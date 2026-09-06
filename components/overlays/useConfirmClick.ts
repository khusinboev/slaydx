"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ikki bosqichli tasdiq — qaytarib bo'lmaydigan tugmalar uchun.
 *
 * Ilgari `ResultView` va `HomeFiles` dagi «O'chirish» darhol `DELETE`
 * yuborardi: ro'yxatda yoki hujjat ustida tasodifiy bir bosish hujjatni
 * yo'q qilardi (undo yo'q). Endi birinchi bosish tugmani «qurollantiradi»
 * va `windowMs` ichidagi ikkinchi bosishgina haqiqiy amalni bajaradi;
 * oyna o'tsa holat o'zi tushadi.
 */
export function useConfirmClick(action: () => void, windowMs = 3000) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const trigger = useCallback(() => {
    if (armed) {
      if (timer.current) clearTimeout(timer.current);
      setArmed(false);
      action();
      return;
    }
    setArmed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), windowMs);
  }, [armed, action, windowMs]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
  }, []);

  return { armed, trigger, cancel };
}
