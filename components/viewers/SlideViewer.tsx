"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, Presentation, RotateCcw, StickyNote, X } from "lucide-react";
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
  /**
   * Eski dekalar uchun `id` qayta raqamlanadi.
   *
   * Bo'lakli generatsiya dastlab har bo'lakni `s0` dan boshlar edi, ya'ni
   * 16 slaydli dekada `s0…s7` ikki marta uchrardi. Dvigatelda bu
   * tuzatildi (`renumberSlides`), lekin BAZADAGI eski hujjatlar shundoq
   * qolgan — ularni ochganda React «two children with the same key»
   * xatosini beradi va bir xil kalitli slaydlarni dublikat qilib yoki
   * tushirib qoldirishi mumkin. Ko'ruvchi saqlangan ma'lumotga
   * tayanmasligi kerak.
   */
  const slides = useMemo(
    () => (deck.slides ?? []).map((s, i) => (s.id === `s${i}` ? s : { ...s, id: `s${i}` })),
    [deck.slides],
  );
  const [i, setI] = useState(0);
  const [present, setPresent] = useState(false);
  const [notesOn, setNotesOn] = useState(true);
  const [presenter, setPresenter] = useState(false);
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
  }, [present, notesOn, presenter]);

  /*
   * HAQIQIY to'liq ekran.
   *
   * Ilgari «taqdimot» faqat `fixed inset-0` edi: brauzer manzil satri va
   * yorliqlari ekranda qolardi, proyektorda esa aynan shular ko'rinmasligi
   * kerak. Fullscreen API rad etilishi mumkin (masalan foydalanuvchi
   * harakatisiz chaqirilsa), shuning uchun xato yutiladi — bunday holda
   * eski qoplama rejimi baribir ishlaydi.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (present && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (!present && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, [present]);

  // Brauzer to'liq ekrandan chiqsa (Esc, F11) — holat mos kelib qolsin.
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) setPresent(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

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
      else if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPresenter((v) => !v);
      } else if (e.key.toLowerCase() === "f" || e.key === "F5") {
        e.preventDefault();
        setPresent((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, i, slides.length]);

  /*
   * Chiqish taymeri. Taqdimotchi uchun asosiy raqam — «qancha gapirdim»,
   * shuning uchun u soat emas, o'tgan vaqt. Taqdimot boshlanganda o'zi
   * yurib ketadi; to'xtatish va nolga qaytarish qo'lda.
   */
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  useEffect(() => {
    if (!present) return;
    setElapsed(0);
    setRunning(true);
  }, [present]);
  useEffect(() => {
    if (!present || !running) return;
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [present, running]);
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  /*
   * Keyingi slayd eskizining masshtabi O'LCHANADI.
   *
   * Yon paneldagi kenglik `min(34vw, 460px)` — ya'ni ekranga qarab
   * o'zgaradi. Qat'iy masshtab (yon ustundagi 0.117 kabi) bu yerda
   * noto'g'ri bo'lardi: keng monitorda eskiz ramkadan chiqib ketardi.
   */
  const nextRef = useRef<HTMLSpanElement>(null);
  const [nextScale, setNextScale] = useState(0.2);
  useEffect(() => {
    const el = nextRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNextScale(el.getBoundingClientRect().width / SLIDE.w));
    ro.observe(el);
    return () => ro.disconnect();
  }, [present, presenter, i]);

  const slide = slides[i];
  const next = slides[i + 1];
  const scale = present || fitOn ? Math.max(0.18, fitScale) : zoom / 100;
  const notes = slide ? slideNotes(slide) : "";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", present && "fixed inset-0 z-50 bg-black")}>
      {present ? (
        <div className="no-print absolute top-0 right-0 z-20 flex items-center gap-1 p-3 text-white/80">
          <span className="mr-2 text-sm tabular-nums">
            {i + 1} / {slides.length}
          </span>
          <button
            type="button"
            title="Taqdimotchi rejimi (P)"
            className={cn("hover:bg-white/10 rounded p-1.5", presenter && "bg-white/15")}
            onClick={() => setPresenter((v) => !v)}
          >
            <Presentation className="size-4" />
          </button>
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

        {/*
          Taqdimotchi paneli — FAQAT to'liq ekranda.
          Bu ekran tinglovchiga emas, so'zlovchiga qaraydi: nima
          gapirilishi (eslatma), nima kelayotgani (keyingi slayd) va
          qancha vaqt ketgani. Shuning uchun u slayd MAYDONIDAN tashqarida
          turadi — proyektorga ikkinchi ekran uzatilganda faqat chap
          tomondagi slayd ko'chiriladi.
        */}
        {present && presenter ? (
          <aside className="no-print flex w-[min(34vw,460px)] shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/10 bg-[#141414] p-4 text-white">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-semibold tabular-nums">{clock}</span>
              <button
                type="button"
                title={running ? "To‘xtatish" : "Davom ettirish"}
                className="hover:bg-white/10 rounded p-1.5 text-white/70"
                onClick={() => setRunning((v) => !v)}
              >
                {running ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <button
                type="button"
                title="Noldan"
                className="hover:bg-white/10 rounded p-1.5 text-white/70"
                onClick={() => setElapsed(0)}
              >
                <RotateCcw className="size-4" />
              </button>
              <span className="ml-auto text-sm text-white/50 tabular-nums">
                {i + 1} / {slides.length}
              </span>
            </div>

            <div>
              <div className="mb-1 text-[11px] font-medium tracking-wide text-white/45 uppercase">Keyingi slayd</div>
              {next ? (
                <span
                  ref={nextRef}
                  className="relative block overflow-hidden rounded bg-black"
                  style={{ aspectRatio: `${SLIDE.w} / ${SLIDE.h}` }}
                >
                  <span
                    className="absolute top-0 left-0 origin-top-left"
                    style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${nextScale})` }}
                  >
                    <SlideCanvas
                      slide={next}
                      theme={theme}
                      visual={deck.visual}
                      audience={deck.audience}
                      templateId={deck.templateId}
                      index={i + 1}
                      total={slides.length}
                    />
                  </span>
                </span>
              ) : (
                <p className="text-sm text-white/50">Bu oxirgi slayd.</p>
              )}
            </div>

            <div className="min-h-0 flex-1">
              <div className="mb-1 text-[11px] font-medium tracking-wide text-white/45 uppercase">Eslatma</div>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/85">
                {notes || "Bu slayd uchun eslatma yo‘q."}
              </p>
            </div>

            <p className="text-[11px] text-white/35">
              Strelka — slayd almashtirish · P — bu panel · Esc — chiqish
            </p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
