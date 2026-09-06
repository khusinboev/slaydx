"use client";

import { useEffect, useState, type DependencyList, type RefObject } from "react";

/**
 * Scroll paytida ko'rinib turgan varaqni kuzatadi.
 *
 * Ilgari bu `IntersectionObserver` mantiqi FAQAT `WordViewer` da bor edi;
 * glossariy, keys, dars va xarita ko'ruvchilarida sichqoncha bilan
 * varaqlanganda toolbar dagi "3 / 8" o'zgarmasdi — u faqat strelka
 * bosilganda yangilanardi (AUDIT-6 C4). Endi hammasi shu hookdan.
 *
 * `getEls` — varaq DOM elementlari massivini qaytaruvchi funksiya (odatda
 * `() => refs.current`). `deps` — varaqlar soni yoki zoom o'zgarganda
 * qayta kuzatish uchun (`[total, zoom]`).
 *
 * `setPage` ham qaytariladi: toolbar strelkasi bosilganda ko'rsatkichni
 * darhol yangilash uchun (scroll animatsiyasi tugashini kutmasdan).
 */
export function useVisiblePage(
  scrollRef: RefObject<HTMLElement | null>,
  getEls: () => (HTMLElement | null)[],
  deps: DependencyList,
): [number, (n: number) => void] {
  const [page, setPage] = useState(1);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!vis) return;
        const idx = getEls().indexOf(vis.target as HTMLElement);
        if (idx >= 0) setPage(idx + 1);
      },
      { root, threshold: [0.4, 0.6] },
    );
    for (const el of getEls()) if (el) io.observe(el);
    return () => io.disconnect();
    // getEls / scrollRef — barqaror; qayta kuzatish `deps` bilan boshqariladi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [page, setPage];
}
