"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useOverlayHistory } from "@/components/nav/useOverlayHistory";
import { useNav } from "@/components/nav/NavProvider";
import { internalLinkHref } from "@/lib/nav/history";

export type DialogOptions = {
  /**
   * `false`: no history entry for this dialog. Use it only when the open
   * state already lives in the URL (e.g. an `?id=` drawer); otherwise the
   * phone's back button would leave the page instead of closing the dialog.
   */
  history?: boolean;
};

/** Open dialogs in mount order: only the top one handles Escape and Tab. */
const openDialogs: object[] = [];

/**
 * Modal oyna uchun umumiy xatti-harakat.
 *
 * Ilgari har bir overlay faqat fon ustiga bosish bilan yopilardi:
 * klaviatura bilan ishlayotgan foydalanuvchi oynadan umuman chiqa
 * olmasdi, ekran o'quvchi esa uni oddiy `div` deb o'qirdi.
 *
 * Bu hook beradi:
 *   - Escape bilan yopish (ichma-ich oynalarda faqat eng ustidagisi),
 *   - fokusni oyna ichida ushlab turish (Tab tsikli),
 *   - ochilganda orqa fon aylanmasligi,
 *   - tarix yozuvi (docs/nav/PLAN.md): telefonning «orqaga» tugmasi sahifani
 *     emas, oynani yopadi; oynadagi ichki havola oyna yozuvini almashtiradi.
 */
export function useDialog(open: boolean, close: () => void, opts?: DialogOptions) {
  const ref = useRef<HTMLDivElement>(null);
  // Oyna yopilgach fokus qaytariladigan element.
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });
  const withHistory = opts?.history !== false;
  useOverlayHistory(open, close, { enabled: withHistory });
  const nav = useNav();

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const id = {};
    openDialogs.push(id);
    const isTop = () => openDialogs[openDialogs.length - 1] === id;

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
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

    // An internal link inside the dialog replaces the dialog's history entry
    // (back from the new page returns to the page under the dialog). The
    // dialog's own onClick still runs; Next's <Link> skips its push because
    // the default is prevented.
    const panelAtOpen = ref.current;
    const onLinkClick = (e: MouseEvent) => {
      const href = internalLinkHref(e);
      if (!href) return;
      e.preventDefault();
      nav.navigateFromOverlay(href);
    };
    if (withHistory) panelAtOpen?.addEventListener("click", onLinkClick, true);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Birinchi interaktiv elementga fokus.
    const t = setTimeout(() => {
      const panel = ref.current;
      panel?.querySelector<HTMLElement>('input:not([type="hidden"]), button, a[href]')?.focus();
    }, 0);

    return () => {
      window.removeEventListener("keydown", onKey);
      panelAtOpen?.removeEventListener("click", onLinkClick, true);
      const at = openDialogs.indexOf(id);
      if (at >= 0) openDialogs.splice(at, 1);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      opener.current?.focus?.();
    };
  }, [open, withHistory, nav]);

  return ref;
}
