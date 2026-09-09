"use client";

import { useEffect, useRef, useState } from "react";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "@/lib/generation/slide-templates";
import type { BodyRules } from "@/lib/generation/slide-audience";
import type { SlideModel, SlideTheme } from "@/lib/generation/slide-types";
import { SLIDE } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";
import { SlideCanvas } from "./SlideCanvas";
import { SkeletonSlide } from "./SkeletonSlide";

/**
 * Eskiz paneli — F2 bo'linishida `SlideViewer.tsx` dan AYNAN 1:1
 * ko'chirildi (xatti-harakat o'zgarmagan).
 *
 * L5 da `roles`/`marks` JONLI shoxlarni yoqadi:
 *  - `marks` BERILMASA hech narsa o'zgarmaydi (tayyor hujjat yo'li);
 *  - berilsa, `marks[idx]` yo'q slayd hali yozilmagan → `SkeletonSlide`
 *    va sarlavha o'rniga `roles[idx]`;
 *  - `marks[idx] === "writing"` → «yozilmoqda» nuqtasi.
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
  editOn = false,
  onReorder,
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
  /** Reja bergan slayd vazifalari — skelet eskizining yorlig'i. */
  roles?: string[];
  /**
   * Jonli belgilar. BERILMASA panel butunlay eskicha ishlaydi; berilsa,
   * xaritada YO'Q indeks «hali yozilmagan» degani.
   */
  marks?: Record<number, "writing" | "done">;
  /**
   * E6 tahrir: eskizlarni sudrab tartibini o'zgartirish. `false` bo'lsa
   * (standart) panel HTML i bo'linishdan oldingi bilan bir xil qoladi —
   * `draggable` atributi ham qo'yilmaydi.
   */
  editOn?: boolean;
  /** Yangi tartib: `order[yangi] = eski` (`{op:"reorder"}` bilan bir xil). */
  onReorder?: (order: number[]) => void;
}) {
  // Eskiz konteynerining haqiqiy kengligidan masshtab (ilgari qat'iy
  // 0.117 edi, ya'ni panel kengligi o'zgarsa eskiz ramkadan chiqib
  // ketardi).
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

  /*
   * Sudrash — NATIVE HTML5 DnD (kutubxona qo'shilmaydi). Sudralayotgan
   * indeks `dataTransfer` da EMAS, ref da: jsdom da `dataTransfer`
   * yo'q va ba'zi brauzerlarda `dragover` paytida o'qib bo'lmaydi.
   */
  const dragRef = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const drop = (to: number) => {
    const from = dragRef.current;
    dragRef.current = null;
    setOver(null);
    if (from == null || from === to) return;
    // `order[yangi] = eski` — `applyDocOps` aynan shunday o'qiydi
    // (`slides = order.map(n => slides[n])`).
    const order = slides.map((_, k) => k);
    order.splice(to, 0, ...order.splice(from, 1));
    onReorder?.(order);
  };

  return (
    <aside ref={railRef} className="hidden w-[200px] shrink-0 overflow-y-auto border-r border-white/10 bg-[#171717] p-2 md:block">
      {slides.map((s, idx) => {
        const mark = marks?.[idx];
        /*
         * `marks` yo'q → tayyor hujjat, hamma eskiz haqiqiy. Bor bo'lsa
         * FAQAT `done` haqiqiy matn: `writing` ham, belgisiz ham hali
         * yozilmagan (reja bergan bo'sh `SlideModel`), farqi shundaki
         * `writing` da nuqta yonadi.
         */
        const pending = marks !== undefined && mark !== "done";
        return (
        <button
          key={s.id}
          type="button"
          onClick={() => go(idx)}
          data-thumb-index={editOn ? idx : undefined}
          draggable={editOn || undefined}
          onDragStart={
            editOn
              ? (e) => {
                  dragRef.current = idx;
                  e.dataTransfer?.setData?.("text/plain", String(idx));
                }
              : undefined
          }
          onDragOver={
            editOn
              ? (e) => {
                  // `preventDefault` bo'lmasa brauzer tashlashga ruxsat bermaydi.
                  e.preventDefault();
                  if (over !== idx) setOver(idx);
                }
              : undefined
          }
          onDrop={
            editOn
              ? (e) => {
                  e.preventDefault();
                  drop(idx);
                }
              : undefined
          }
          onDragEnd={
            editOn
              ? () => {
                  dragRef.current = null;
                  setOver(null);
                }
              : undefined
          }
          className={cn(
            "mb-2 flex w-full gap-1.5 rounded-sm p-1 text-left",
            idx === i ? "bg-white/10" : "hover:bg-white/5",
            editOn && over === idx && "outline-2 outline-sky-400",
          )}
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
                {pending ? (
                  <SkeletonSlide theme={theme} role={roles?.[idx]} index={idx} compact />
                ) : (
                  <SlideCanvas slide={s} theme={theme} visual={visual} audience={audience} templateId={templateId} bodyType={bodyType} logo={logo} index={idx} total={slides.length} />
                )}
              </span>
            </span>
            {/*
              Jonli shox ALOHIDA: `marks` berilmagan holatda tugma
              ostidagi sarlavha HTML'i bo'linishdan oldingi bilan
              bayt-baytiga bir xil qolishi kerak
              (`tests/viewer/slide-viewer-seams.test.mts`).
            */}
            {marks === undefined ? (
              <span className="mt-1 block truncate text-[11px] text-white/70">{s.title}</span>
            ) : (
              <span className="mt-1 flex items-center gap-1 text-[11px] text-white/70">
                {mark === "writing" ? (
                  <span className="slx-typing inline-block size-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
                ) : null}
                {/* Hali yozilmagan slaydda sarlavha ham yo'q — reja bergan
                    vazifa («Kirish», «Xulosa») undan foydaliroq. */}
                <span className="truncate">{pending ? (roles?.[idx] ?? "Kutilmoqda…") : s.title}</span>
              </span>
            )}
          </span>
        </button>
        );
      })}
    </aside>
  );
}
