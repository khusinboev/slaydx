"use client";

import { useEffect, useRef } from "react";

/**
 * Modal oyna uchun umumiy xatti-harakat.
 *
 * Ilgari har bir overlay faqat fon ustiga bosish bilan yopilardi:
 * klaviatura bilan ishlayotgan foydalanuvchi oynadan umuman chiqa
 * olmasdi, ekran o'quvchi esa uni oddiy `div` deb o'qirdi.
 *
 * Bu hook uchta narsani beradi:
 *   - Escape bilan yopish,
 *   - fokusni oyna ichida ushlab turish (Tab tsikli),
 *   - ochilganda orqa fon aylanmasligi.
 */
export function useDialog(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // Oyna yopilgach fokus qaytariladigan element.
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = ref.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Fokus oyna tashqarisiga chiqib ketmasin.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Birinchi interaktiv elementga fokus.
    const t = setTimeout(() => {
      const panel = ref.current;
      panel?.querySelector<HTMLElement>('input:not([type="hidden"]), button, a[href]')?.focus();
    }, 0);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      opener.current?.focus?.();
    };
  }, [open, close]);

  return ref;
}
