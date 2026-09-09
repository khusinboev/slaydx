"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveStage } from "@/lib/generation/slide-progress";
import type { SlideModel, SlideThemeId } from "@/lib/generation/slide-types";
import type { SlideTemplateId } from "@/lib/generation/slide-templates";
import type { DocMeta } from "@/lib/generation/types";

/**
 * Ko'ruvchi jonli holatdan NIMANI o'qishini bildiruvchi tip.
 *
 * `LiveDeck` (dvigatel reduktorining chiqishi) bu shaklga strukturaviy
 * mos keladi, ya'ni `liveDocOf(live)` ni to'g'ridan-to'g'ri chaqirsa
 * bo'ladi. Tip shu yerda — hook ham, tasma ham, eskiz paneli ham buni
 * ishlatadi va `SlideViewer` ga aylanma import kerak bo'lmaydi.
 */
export type LiveView = {
  stage: LiveStage;
  meta: DocMeta;
  theme: SlideThemeId;
  template: SlideTemplateId;
  logo?: string;
  /** 0..99 — haqiqiy foiz, soxta egri chiziq emas. */
  progress: number;
  step: string;
  roles: string[];
  slides: SlideModel[];
  /** Matni tayyor slaydlar indekslari. */
  written: number[];
  /** `deck` hodisasidan keyin — matn qayta yozilmaydi. */
  final: boolean;
  /** Rasm kutilayotgan slaydlar indekslari. */
  imageWait: number[];
  images: { got: number; want: number };
  research?: { sources: number };
};

export const REVEAL_MIN_MS = 800;
export const REVEAL_MAX_MS = 2500;

/**
 * Matn hajmiga qarab yozish davomiyligi, 0.8–2.5 s.
 *
 * Qat'iy davomiylik yaramaydi: bitta iqtibos slaydi va o'nta bandli
 * slayd bir xil vaqtda yozilsa, birinchisi sudralib, ikkinchisi
 * o'qib bo'lmas tezlikda uchib o'tardi.
 */
export function revealDuration(chars: number): number {
  return Math.max(REVEAL_MIN_MS, Math.min(REVEAL_MAX_MS, Math.round(chars * 9)));
}

function reducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * «Yozilmoqda» animatsiyasi — 0..1 ulush yoki `undefined` (to'liq matn).
 *
 * Qoidalar (rejadan):
 *  - FAQAT shu sessiyada YANGI kelgan slayd yoziladi. Birinchi renderda
 *    `written` da turganlar «ko'rilgan» deb belgilanadi, ya'ni sahifani
 *    yangilagan foydalanuvchi tayyor slaydlarning qaytadan yozilishini
 *    ko'rmaydi (u buni «qotib qoldi» deb o'qirdi).
 *  - `final` (deka to'liq kelgani) — jim almashtirish, typing YO'Q:
 *    dvigatel ko'rsatilgan matnni tuzatishi mumkin, bu tuzatish
 *    animatsiya bo'lib ko'zga tashlanmasligi kerak.
 *  - Faqat SAHNADAGI slayd (`index`) animatsiya qiladi — eskizlar va
 *    fon slaydlari rAF yemaydi.
 *  - `prefers-reduced-motion` → darhol to'liq matn.
 */
export function useReveal({
  index,
  written,
  final,
  chars,
  enabled = true,
}: {
  index: number;
  written: number[];
  final: boolean;
  /** Sahnadagi slaydning matn hajmi — davomiylik shundan. */
  chars: number;
  enabled?: boolean;
}): number | undefined {
  // `null` — hali birinchi renderni ko'rmadik.
  const seen = useRef<Set<number> | null>(null);
  const fresh = useRef<Set<number>>(new Set());
  const [tick, setTick] = useState(0);
  const [p, setP] = useState<number | undefined>(undefined);

  if (seen.current === null) seen.current = new Set(written);

  useEffect(() => {
    const s = seen.current;
    if (!s) return;
    let added = false;
    for (const i of written) {
      if (s.has(i)) continue;
      s.add(i);
      fresh.current.add(i);
      added = true;
    }
    if (added) setTick((v) => v + 1);
  }, [written]);

  useEffect(() => {
    if (!enabled || final || !fresh.current.has(index) || reducedMotion()) {
      setP(undefined);
      return;
    }
    const dur = revealDuration(chars);
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    let raf = 0;
    setP(0);
    const step = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const k = Math.min(1, (now - t0) / dur);
      if (k >= 1) {
        // Tugagandagina «yangi» belgisi olinadi — yarim yozilganda
        // boshqa slaydga o'tib qaytilsa, matn kesilgan holda qotib
        // qolmaydi, qaytadan yoziladi.
        fresh.current.delete(index);
        setP(undefined);
        return;
      }
      setP(k);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [index, final, chars, enabled, tick]);

  return p;
}
