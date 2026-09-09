"use client";

import { useEffect, useRef, useState } from "react";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "@/lib/generation/slide-templates";
import type { BodyRules } from "@/lib/generation/slide-audience";
import type { SlideModel, SlideTheme } from "@/lib/generation/slide-types";
import { SLIDE } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";
import { SlideCanvas } from "./SlideCanvas";

/**
 * Eskiz paneli — F2 bo'linishida `SlideViewer.tsx` dan AYNAN 1:1
 * ko'chirildi (xatti-harakat o'zgarmagan).
 *
 * `roles` va `marks` — keyingi paketlar (jonli generatsiya: qaysi slayd
 * yozilmoqda/tayyor, kim nima ustida ishlayapti) uchun. Hozircha faqat
 * TIP — hech narsa chizmaydi.
 */
export function SlideRail({
  slides,
  theme,
  visual,
  audience,
  templateId,
  bodyType,
  logo,
  i,
  go,
  roles,
  marks,
}: {
  slides: SlideModel[];
  theme: SlideTheme;
  visual: SlideVisual;
  audience: SlideAudience;
  templateId: SlideTemplateId;
  /** Deck darajasida (`buildSlideDeck`) — PPTX bilan bir xil qiymat. */
  bodyType?: BodyRules;
  logo?: string;
  i: number;
  go: (n: number) => void;
  /** Ixtiyoriy — hozircha ishlatilmaydi (faqat tip). */
  roles?: string[];
  /** Ixtiyoriy — hozircha ishlatilmaydi (faqat tip). */
  marks?: Record<number, "writing" | "done">;
}) {
  // Eskiz konteynerining haqiqiy kengligidan masshtab (ilgari qat'iy
  // 0.117 edi, ya'ni panel kengligi o'zgarsa eskiz ramkadan chiqib
  // ketardi).
  // Hozircha faqat tip — jonli generatsiya paketi ularni chizishni
  // ulaguncha ishlatilmaydi (no-op).
  void roles;
  void marks;

  const railRef = useRef<HTMLElement>(null);
  const [thumbScale, setThumbScale] = useState(0.117);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.querySelector<HTMLElement>("[data-thumb]")?.getBoundingClientRect().width ?? 0;
      if (w > 0) setThumbScale(w / SLIDE.w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slides.length]);

  return (
    <aside ref={railRef} className="hidden w-[200px] shrink-0 overflow-y-auto border-r border-white/10 bg-[#171717] p-2 md:block">
      {slides.map((s, idx) => (
        <button
          key={s.id}
          type="button"
          onClick={() => go(idx)}
          className={cn("mb-2 flex w-full gap-1.5 rounded-sm p-1 text-left", idx === i ? "bg-white/10" : "hover:bg-white/5")}
        >
          <span className="w-5 shrink-0 pt-6 text-right text-[11px] tabular-nums text-white/50">{idx + 1}</span>
          <span className="min-w-0 flex-1">
            <span
              data-thumb
              className="relative block overflow-hidden rounded-[2px] bg-black shadow"
              style={{
                aspectRatio: `${SLIDE.w} / ${SLIDE.h}`,
                outline: idx === i ? `2px solid ${theme.accent}` : "1px solid rgba(255,255,255,0.12)",
              }}
            >
              <span
                className="absolute top-0 left-0"
                style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${thumbScale})`, transformOrigin: "top left" }}
              >
                <SlideCanvas slide={s} theme={theme} visual={visual} audience={audience} templateId={templateId} bodyType={bodyType} logo={logo} index={idx} total={slides.length} />
              </span>
            </span>
            <span className="mt-1 block truncate text-[11px] text-white/70">{s.title}</span>
          </span>
        </button>
      ))}
    </aside>
  );
}
