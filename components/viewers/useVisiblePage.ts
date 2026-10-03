"use client";

import { useEffect, useState, type DependencyList, type RefObject } from "react";

/** 0, 0.05 … 1 — uzun varaq ham har 5 % siljishda xabar beradi. */
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

/** CSS uzunligi (`56px`, `3.5rem`) → px; noma'lum/bo'sh bo'lsa 0. */
function cssLengthPx(raw: string): number {
  const v = raw.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  if (v.endsWith("rem")) return n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  return n;
}

/**
 * Viewport tepasida yopishib turgan qismlar balandligi: AppShell TopBar
 * (`--app-topbar-h`) + natija sarlavhasi (`--result-header-h`).
 * O'zgaruvchilar `ResultLayout` ildizida — natija sahifasidan tashqarida
 * (test, boshqa sahifa) ikkalasi ham bo'sh, ya'ni 0.
 */
export function stickyTopPx(el: Element | null): number {
  if (!el) return 0;
  const cs = getComputedStyle(el);
  return cssLengthPx(cs.getPropertyValue("--app-topbar-h")) + cssLengthPx(cs.getPropertyValue("--result-header-h"));
}

/**
 * Ko'rinishdagi qismi eng katta bo'lgan varaq indeksi (0 dan), yo'q bo'lsa -1.
 * Ko'rinish oralig'i `[top, bottom)` — yopishqoq sarlavha ostidan ekran pastigacha.
 * Tenglikda OLDINGI varaq (o'qish tartibi).
 */
export function mostVisible(rects: ({ top: number; bottom: number } | null)[], top: number, bottom: number): number {
  let best = -1;
  let bestPx = 0;
  rects.forEach((r, i) => {
    if (!r) return;
    const px = Math.min(r.bottom, bottom) - Math.max(r.top, top);
    if (px > bestPx + 0.5) {
      best = i;
      bestPx = px;
    }
  });
  return best;
}

/** Elementni aylantiradigan eng yaqin scroll qutisi (natija sahifasida — AppShell `<main>`). */
function scrollParent(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}

/**
 * Scroll OXIRIGA yetilganda (pastga yana surib bo'lmaydi) va oxirgi varaq
 * to'liq ko'rinsa — hisoblagich oxirgi varaqni ko'rsatadi. Aks holda bir
 * nechta kichik varaq (telefonda albom 32 %) birga to'liq ko'ringanda
 * «eng ko'p piksel» tenglikda oldingisini tanlardi va hujjat oxirida
 * «3 / 4» qolardi.
 */
function atEndOn(sc: Element | null, last: { top: number; bottom: number } | null, top: number, bottom: number): boolean {
  if (!sc || !last) return false;
  const end = sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
  return end && last.top >= top - 1 && last.bottom <= bottom + 1;
}

/**
 * Scroll paytida ko'rinib turgan varaqni kuzatadi.
 *
 * Ilgari bu `IntersectionObserver` mantiqi FAQAT `WordViewer` da bor edi;
 * glossariy, keys, dars va xarita ko'ruvchilarida sichqoncha bilan
 * varaqlanganda toolbar dagi "3 / 8" o'zgarmasdi — u faqat strelka
 * bosilganda yangilanardi (AUDIT-6 C4). Endi hammasi shu hookdan.
 *
 * Viewer redesign V1: varaqlar SAHIFA scroll'ida (AppShell `<main>`),
 * shuning uchun kuzatuv ildizi — viewport (`root: null`), tepadan
 * yopishqoq qismlar (`stickyTopPx` + `topInset`, masalan toolbar)
 * `rootMargin` bilan chiqarib tashlanadi. Ilgari ildiz ichki scroll
 * qutisi edi; u `overflow-hidden` ota tomonidan kesilganda hisoblagich
 * «1 / 11» da qotib qolardi (R2). Tanlov endi «ko'rinib turgan
 * piksellar eng ko'pi» (`mostVisible`) va har chaqiruvda JONLI
 * o'lchamlardan hisoblanadi — 0.4/0.6 chegarasi ekrandan baland varaqda
 * hech qachon yetmasdi, sarlavha balandligi esa keyin o'zgarishi mumkin.
 *
 * `anchorRef` — ko'ruvchi ichidagi istalgan element (CSS o'zgaruvchilarini
 * o'qish uchun). `getEls` — varaq DOM elementlari massivini qaytaruvchi
 * funksiya (odatda `() => refs.current`). `deps` — varaqlar soni yoki
 * zoom o'zgarganda qayta kuzatish uchun (`[total, zoom]`).
 *
 * `setPage` ham qaytariladi: toolbar strelkasi bosilganda ko'rsatkichni
 * darhol yangilash uchun (scroll animatsiyasi tugashini kutmasdan).
 */
export function useVisiblePage(
  anchorRef: RefObject<HTMLElement | null>,
  getEls: () => (HTMLElement | null)[],
  deps: DependencyList,
  opts?: { topInset?: number },
): [number, (n: number) => void] {
  const [page, setPage] = useState(1);
  const topInset = opts?.topInset ?? 0;

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") return;
    const top = () => stickyTopPx(anchor) + topInset;
    const pick = () => {
      // Har safar qaytadan: sahifalashdan oldin `<main>` hali scroll bo'lmasligi mumkin.
      const sc = scrollParent(anchor);
      const els = getEls();
      const rects = els.map((el) => (el ? el.getBoundingClientRect() : null));
      const t = top();
      const b = window.innerHeight;
      const idx = atEndOn(sc, rects[rects.length - 1] ?? null, t, b) ? rects.length - 1 : mostVisible(rects, t, b);
      if (idx >= 0) setPage(idx + 1);
    };
    const io = new IntersectionObserver(pick, {
      root: null,
      rootMargin: `-${Math.round(top())}px 0px 0px 0px`,
      threshold: THRESHOLDS,
    });
    for (const el of getEls()) if (el) io.observe(el);
    return () => io.disconnect();
    // getEls / anchorRef — barqaror; qayta kuzatish `deps` bilan boshqariladi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, topInset]);

  return [page, setPage];
}
