"use client";

import { useEffect } from "react";

/**
 * `SlideViewer` klaviatura handleri — F2 bo'linishida `SlideViewer.tsx`
 * dan AYNAN 1:1 ko'chirildi (xatti-harakat o'zgarmagan).
 *
 * Global `keydown` — lekin faqat o'rinli bo'lganda. Ilgari bu handler har
 * doim ishlar va Space / PageUp / PageDown / Home / End / F5 ni ushlab
 * `preventDefault` qilardi: qidiruv yoki to'lov oynasi ochiqligida ham
 * slayd almashar, taqdimotda emas paytda F5 sahifani yangilash o'rniga
 * taqdimotni ochardi.
 *
 * `extra` — keyingi paketlar (masalan tahrirlash) o'zining tugma
 * handlerini ulashi uchun. Filtrlardan (isContentEditable/INPUT/
 * TEXTAREA/SELECT, dialog ochiq) O'TGANDAN keyin, lekin Escape/strelka/`f`
 * dan OLDIN chaqiriladi — `true` qaytarsa asosiy ishlov shu tugma uchun
 * to'xtaydi.
 */
export function useSlideKeys({
  go,
  i,
  total,
  present,
  setPresent,
  setPresenter,
  extra,
}: {
  go: (n: number) => void;
  i: number;
  total: number;
  present: boolean;
  setPresent: (v: boolean | ((v: boolean) => boolean)) => void;
  setPresenter: (v: boolean | ((v: boolean) => boolean)) => void;
  extra?: (e: KeyboardEvent) => boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // `isContentEditable` jsdom da yo'q — atribut bo'yicha ham tekshiriladi (joyida tahrir `contenteditable` div).
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest?.("[contenteditable]:not([contenteditable='false'])"))) return;
      if (!present && document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      if (extra?.(e)) return;

      if (e.key === "Escape") {
        setPresent(false);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(i + 1);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(i - 1);
        return;
      }
      if (e.key === "f") {
        e.preventDefault();
        setPresent((v) => !v);
        return;
      }
      // Qolgan tugmalar FAQAT taqdimot rejimida — u yerda sahifa aylantirish
      // yoki yangilash uchun boshqa ehtiyoj yo'q.
      if (!present) return;
      if (e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(i + 1);
      } else if (e.key === "PageUp") {
        e.preventDefault();
        go(i - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        go(0);
      } else if (e.key === "End") {
        e.preventDefault();
        go(total - 1);
      } else if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPresenter((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, i, total, present, extra, setPresent, setPresenter]);
}
