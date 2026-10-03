"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { fitZoom } from "@/lib/viewers/metrics";

/** SSR da `useLayoutEffect` ogohlantirmasin — serverda effekt baribir ishlamaydi. */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Varaqli ko'ruvchilarning standart masshtabi — «enga sig'dirish»
 * (viewer redesign V1; Word va rezyume ko'ruvchisi UMUMIY hook).
 *
 * - Kenglik ko'ruvchi RAMKASIDAN (`[data-viewer-frame]`, natija sahifasi
 *   ustuni) o'lchanadi, `ResizeObserver` bilan: panel ochilib-yopilsa
 *   yoki oyna o'lchami o'zgarsa qayta sig'diriladi. Ilgari faqat
 *   `window.resize` tinglanardi va panel ochilishi e'tiborsiz qolardi.
 *   Ramka bo'lmasa (masalan test yoki boshqa sahifa) — `hostRef` ning o'zi.
 * - Bo'sh kenglik = ramka eni − Workspace chekinishi (`px-3`/`sm:px-6`),
 *   hisob `fitZoom` da (floor, 125 % chegara, telefonda haqiqiy sig'dirish).
 * - Qo'lda zoom (`setZoom`) avto-rejimni o'chiradi: keyingi o'lcham
 *   o'zgarishi foydalanuvchi tanlovini bosib ketmasin (masalan 150 % da
 *   sahifa uzaygach paydo bo'lgan scrollbar ramkani 15 px toraytiradi).
 *   `fit()` (toolbar dagi «%» tugmasi) avto-rejimni qaytaradi.
 *
 * `wide` — joriy zoomda varaq bo'sh kenglikdan kengmi (faqat qo'lda
 * kattalashtirilganda): varaq qatori o'shanda gorizontal scroll oladi.
 */
export function useFitZoom(hostRef: RefObject<HTMLElement | null>, sheetW: number) {
  const [zoom, setZoomState] = useState(100);
  const [avail, setAvail] = useState(0);
  const auto = useRef(true);

  const measure = useCallback((): number => {
    const host = hostRef.current;
    if (!host) return 0;
    const frame = host.closest<HTMLElement>("[data-viewer-frame]") ?? host;
    const cs = getComputedStyle(host);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return Math.max(0, frame.clientWidth - pad);
  }, [hostRef]);

  const apply = useCallback(() => {
    const w = measure();
    setAvail(w);
    if (auto.current) setZoomState(fitZoom(w, sheetW));
  }, [measure, sheetW]);

  const fit = useCallback(() => {
    auto.current = true;
    apply();
  }, [apply]);

  const setZoom = useCallback((n: number) => {
    auto.current = false;
    setZoomState(n);
  }, []);

  useIsoLayoutEffect(() => {
    apply();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const frame = host.closest<HTMLElement>("[data-viewer-frame]") ?? host;
    const ro = new ResizeObserver(() => apply());
    ro.observe(frame);
    return () => ro.disconnect();
  }, [apply, hostRef]);

  const wide = avail > 0 && (sheetW * zoom) / 100 > avail + 0.5;
  return { zoom, setZoom, fit, wide };
}
