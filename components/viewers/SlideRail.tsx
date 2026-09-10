"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomTemplate } from "@/lib/generation/pptx-template";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  custom,
  i,
  go,
  roles,
  marks,
  reorderOn = false,
  onReorder,
  variant = "side",
  onMove,
}: {
  slides: SlideModel[];
  theme: SlideTheme;
  visual: SlideVisual;
  audience: SlideAudience;
  templateId: SlideTemplateId;
  /** Deck darajasida (`buildSlideDeck`) — PPTX bilan bir xil qiymat. */
  bodyType?: BodyRules;
  logo?: string;
  custom?: CustomTemplate;
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
   * Eskizlarni sudrab tartiblash. Tayyor dekada DOIM yoqiq (tahrir
   * rejimi endi yo'q — AUDIT-10); `false` bo'lsa (tahrir mumkin
   * bo'lmagan yoki jonli deka) panel HTML i bo'linishdan oldingi bilan
   * bir xil qoladi — `draggable` atributi ham qo'yilmaydi.
   */
  reorderOn?: boolean;
  /** Yangi tartib: `order[yangi] = eski` (`{op:"reorder"}` bilan bir xil). */
  onReorder?: (order: number[]) => void;
  /**
   * `side` — yon ustun (standart, `md:` dan boshlab); `strip` — MOBIL
   * gorizontal tasma (`md:` dan past). Ikkalasi ayni ma'lumotni
   * chizadi, lekin tasmada sudrash YO'Q: teginish ekranida HTML5 DnD
   * umuman ishlamaydi, shuning uchun tartib ◀/▶ tugmalari bilan
   * o'zgaradi.
   */
  variant?: "side" | "strip";
  /** Tasmadagi ◀/▶ — joriy slaydni bir qadam suradi (`SlideViewer.onMove`). */
  onMove?: (dir: -1 | 1) => void;
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
   * Tasmada joriy eskiz KO'RINISHDA qolsin: gorizontal ro'yxatda
   * `snap` faqat qo'l bilan surganda ishlaydi, strelka/avto-ergashish
   * bilan almashgan slayd esa ekrandan chiqib ketardi. `scrollIntoView`
   * jsdom da yo'q — ixtiyoriy chaqiruv (`?.`) bilan.
   */
  useEffect(() => {
    if (variant !== "strip") return;
    const el = railRef.current?.querySelector<HTMLElement>(`[data-strip-index="${i}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [variant, i]);

  /*
   * Sudrash — NATIVE HTML5 DnD (kutubxona qo'shilmaydi). Sudralayotgan
   * indeks `dataTransfer` da EMAS, ref da: jsdom da `dataTransfer`
   * yo'q va ba'zi brauzerlarda `dragover` paytida o'qib bo'lmaydi.
   */
  const dragRef = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  // Sudralayotgan eskiz — o'zi xiralashadi, ya'ni «bu ko'chmoqda».
  const [dragging, setDragging] = useState<number | null>(null);

  const drop = (to: number) => {
    const from = dragRef.current;
    dragRef.current = null;
    setOver(null);
    setDragging(null);
    if (from == null || from === to) return;
    // `order[yangi] = eski` — `applyDocOps` aynan shunday o'qiydi
    // (`slides = order.map(n => slides[n])`).
    const order = slides.map((_, k) => k);
    order.splice(to, 0, ...order.splice(from, 1));
    onReorder?.(order);
  };

  /*
   * ═══ MOBIL TASMA ═══
   *
   * `md:` dan past ekranda yon ustun `hidden` — telefonda foydalanuvchi
   * dekaning qayeridaligini UMUMAN ko'rmasdi (faqat «Slayd 3 / 12»
   * yozuvi). Tasma o'sha ma'lumotni gorizontal, `snap` bilan beradi:
   * bosh barmoq surib boradi, joriy eskiz o'zi markazga tortiladi.
   *
   * Sudrash bu yerda YO'Q — teginish ekranida HTML5 DnD ishlamaydi.
   * O'rniga joriy eskizning tagida ◀/▶ turadi, ya'ni yon paneldagi
   * ▲/▼ ning aynan o'zi. Jonli rejimda skelet eskizlar ham SHU tasmada
   * (yon panel bilan bir xil `pending` qoidasi).
   */
  if (variant === "strip") {
    return (
      <aside
        ref={railRef}
        data-rail="strip"
        className="slx-strip no-print flex shrink-0 gap-2 overflow-x-auto border-t border-white/10 bg-[#171717] p-2 md:hidden"
        style={{ scrollSnapType: "x proximity" }}
      >
        {slides.map((s, idx) => {
          const pending = marks !== undefined && marks[idx] !== "done";
          const active = idx === i;
          return (
            <div key={s.id} className="w-24 shrink-0" style={{ scrollSnapAlign: "center" }}>
              <button
                type="button"
                data-strip-index={idx}
                aria-current={active ? "true" : undefined}
                onClick={() => go(idx)}
                className="block w-full"
              >
                <span
                  data-thumb
                  className="relative block overflow-hidden rounded-[2px] bg-black shadow"
                  style={{
                    aspectRatio: `${SLIDE.w} / ${SLIDE.h}`,
                    outline: active ? `2px solid ${theme.accent}` : "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <span
                    className="absolute top-0 left-0"
                    style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${thumbScale})`, transformOrigin: "top left" }}
                  >
                    {pending ? (
                      <SkeletonSlide theme={theme} role={roles?.[idx]} index={idx} compact />
                    ) : (
                      <SlideCanvas slide={s} theme={theme} visual={visual} audience={audience} templateId={templateId} bodyType={bodyType} logo={logo} custom={custom} index={idx} total={slides.length} />
                    )}
                  </span>
                </span>
              </button>
              <div className="mt-0.5 flex items-center gap-0.5 text-[10px] text-white/60">
                <span className="tabular-nums">{idx + 1}</span>
                {reorderOn && active ? (
                  <>
                    <button
                      type="button"
                      aria-label="Slaydni chapga surish"
                      disabled={idx === 0}
                      className="hover:bg-white/10 ml-auto rounded p-0.5 disabled:opacity-40"
                      onClick={() => onMove?.(-1)}
                    >
                      <ChevronLeft className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Slaydni o‘ngga surish"
                      disabled={idx >= slides.length - 1}
                      className="hover:bg-white/10 rounded p-0.5 disabled:opacity-40"
                      onClick={() => onMove?.(1)}
                    >
                      <ChevronRight className="size-3" />
                    </button>
                  </>
                ) : (
                  <span className="min-w-0 truncate">{pending ? (roles?.[idx] ?? "Kutilmoqda…") : s.title}</span>
                )}
              </div>
            </div>
          );
        })}
      </aside>
    );
  }

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
          data-thumb-index={reorderOn ? idx : undefined}
          draggable={reorderOn || undefined}
          onDragStart={
            reorderOn
              ? (e) => {
                  dragRef.current = idx;
                  setDragging(idx);
                  e.dataTransfer?.setData?.("text/plain", String(idx));
                }
              : undefined
          }
          onDragOver={
            reorderOn
              ? (e) => {
                  // `preventDefault` bo'lmasa brauzer tashlashga ruxsat bermaydi.
                  e.preventDefault();
                  if (over !== idx) setOver(idx);
                }
              : undefined
          }
          onDrop={
            reorderOn
              ? (e) => {
                  e.preventDefault();
                  drop(idx);
                }
              : undefined
          }
          onDragEnd={
            reorderOn
              ? () => {
                  dragRef.current = null;
                  setOver(null);
                  setDragging(null);
                }
              : undefined
          }
          className={cn(
            "mb-2 flex w-full gap-1.5 rounded-sm p-1 text-left",
            idx === i ? "bg-white/10" : "hover:bg-white/5",
            reorderOn && "relative",
            reorderOn && dragging === idx && "opacity-40",
          )}
        >
          {/*
            TASHLASH JOYI — ajratkich chiziq, ramka emas: foydalanuvchi
            eskiz «qayerga tushishini» ko'rishi kerak, «qaysi eskiz
            ustida turganini» emas. Yuqoriga sudralganda chiziq nishon
            eskizning USTIDA, pastga sudralganda OSTIDA chiziladi —
            `order.splice` aynan shu joyga qo'yadi.
          */}
          {reorderOn && over === idx && dragging !== null && dragging !== idx ? (
            <span
              aria-hidden="true"
              className="absolute right-0 left-0 h-0.5 rounded-full bg-sky-400"
              style={dragging > idx ? { top: -2 } : { bottom: 2 }}
            />
          ) : null}
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
                  <SlideCanvas slide={s} theme={theme} visual={visual} audience={audience} templateId={templateId} bodyType={bodyType} logo={logo} custom={custom} index={idx} total={slides.length} />
                )}
              </span>
            </span>
            {/*
              Jonli shox ALOHIDA: `marks` berilmagan holatda tugma
              ostidagi sarlavha oddiy matn — passiv ko'ruvchi HTML i
              jonli belgilar bilan og'irlashmaydi.
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
