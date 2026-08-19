"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, StickyNote, X } from "lucide-react";
import type { AcademicDoc } from "@/lib/generation/types";
import { slideNotes } from "@/lib/generation/slide-layout";
import { getSlideTheme } from "@/lib/generation/slide-themes";
import { buildSlideDeck } from "@/lib/generation/slides";
import { SLIDE } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";
import { ViewerToolbar } from "./toolbar";
import { SlideCanvas } from "./SlideCanvas";

export function SlideViewer({ doc }: { doc: AcademicDoc }) {
  const deck = useMemo(() => buildSlideDeck(doc), [doc]);
  const theme = useMemo(() => getSlideTheme(deck.themeId), [deck.themeId]);
  // Rasm havolalari hujjat bilan birga serverdan keladi — brauzerdagi
  // IndexedDB dan qayta tiklash kerak emas.
  const slides = deck.slides;
  const [i, setI] = useState(0);
  const [present, setPresent] = useState(false);
  const [notesOn, setNotesOn] = useState(true);
  const [zoom, setZoom] = useState(75);
  const [fitOn, setFitOn] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0.6);

  const go = useCallback(
    (n: number) => setI(Math.max(0, Math.min(slides.length - 1, n))),
    [slides.length],
  );

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const pad = present ? 24 : 32;
      setFitScale(Math.min((r.width - pad) / SLIDE.w, (r.height - pad) / SLIDE.h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [present, notesOn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(i + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(i - 1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(slides.length - 1);
      else if (e.key === "Escape") setPresent(false);
      else if (e.key.toLowerCase() === "f" || e.key === "F5") {
        e.preventDefault();
        setPresent((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, i, slides.length]);

  const slide = slides[i];
  const scale = present || fitOn ? Math.max(0.18, fitScale) : zoom / 100;
  const notes = slide ? slideNotes(slide) : "";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", present && "fixed inset-0 z-50 bg-black")}>
      {present ? (
        <div className="no-print absolute top-0 right-0 z-20 flex items-center gap-1 p-3 text-white/80">
          <span className="mr-2 text-sm tabular-nums">
            {i + 1} / {slides.length}
          </span>
          <button type="button" className="hover:bg-white/10 rounded p-1.5" onClick={() => setPresent(false)}>
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <ViewerToolbar
          zoom={zoom}
          onZoom={(n) => {
            setFitOn(false);
            setZoom(n);
          }}
          page={i + 1}
          pages={slides.length}
          onPage={(n) => go(n - 1)}
          onFit={() => setFitOn(true)}
          onFullscreen={() => setPresent(true)}
          extra={
            <>
              <button
                type="button"
                className={cn("hover:bg-white/10 inline-flex items-center gap-1 rounded px-2 py-1 text-xs", notesOn && "bg-white/10")}
                onClick={() => setNotesOn((v) => !v)}
              >
                <StickyNote className="size-3.5" />
                Eslatma
              </button>
              <span className="hidden text-xs text-white/50 lg:inline">
                {deck.templateId} · {theme.nameUz}
              </span>
            </>
          }
        />
      )}

      <div className={cn("flex min-h-0 flex-1", present ? "bg-black" : "bg-[#1e1e1e]")}>
        {!present ? (
          <aside className="hidden w-[200px] shrink-0 overflow-y-auto border-r border-white/10 bg-[#171717] p-2 md:block">
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
                    className="relative block overflow-hidden rounded-[2px] bg-black shadow"
                    style={{
                      aspectRatio: `${SLIDE.w} / ${SLIDE.h}`,
                      outline: idx === i ? `2px solid ${theme.accent}` : "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    <span
                      className="absolute top-0 left-0"
                      style={{ width: SLIDE.w, height: SLIDE.h, transform: "scale(0.117)", transformOrigin: "top left" }}
                    >
                      <SlideCanvas slide={s} theme={theme} visual={deck.visual} audience={deck.audience} templateId={deck.templateId} index={idx} total={slides.length} />
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-white/70">{s.title}</span>
                </span>
              </button>
            ))}
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={stageRef}
            className="flex min-h-0 flex-1 items-center justify-center"
            onClick={() => present && go(i + 1)}
          >
            <div
              style={{ width: SLIDE.w * scale, height: SLIDE.h * scale }}
              className={cn("relative", !present && "shadow-2xl")}
            >
              <div
                className="absolute top-0 left-0 overflow-hidden"
                style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${scale})`, transformOrigin: "top left" }}
              >
                {slide ? (
                  <SlideCanvas slide={slide} theme={theme} visual={deck.visual} audience={deck.audience} templateId={deck.templateId} index={i} total={slides.length} />
                ) : null}
              </div>
            </div>
          </div>

          {!present ? (
            <div className="no-print flex h-9 shrink-0 items-center gap-2 border-t border-white/10 bg-[#252525] px-3 text-[12px] text-white/70">
              <button type="button" className="hover:bg-white/10 rounded p-1" onClick={() => go(i - 1)}>
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="tabular-nums">
                Slayd {i + 1} / {slides.length}
              </span>
              <button type="button" className="hover:bg-white/10 rounded p-1" onClick={() => go(i + 1)}>
                <ChevronRight className="size-3.5" />
              </button>
              <span className="ml-auto truncate">{deck.topic}</span>
              <button type="button" className="hover:bg-white/10 ml-2 rounded p-1" onClick={() => setPresent(true)}>
                {present ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </button>
            </div>
          ) : null}

          {!present && notesOn ? (
            <div className="no-print max-h-28 shrink-0 overflow-y-auto border-t border-white/10 bg-[#2b2b2b] px-4 py-2">
              <div className="mb-1 text-[11px] font-medium tracking-wide text-white/45 uppercase">Eslatma</div>
              <p className="whitespace-pre-wrap text-[13px] leading-snug text-white/80">{notes || "Bu slayd uchun eslatma yo‘q."}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
