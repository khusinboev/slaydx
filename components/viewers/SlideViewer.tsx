"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, Presentation, RotateCcw, StickyNote, X } from "lucide-react";
import type { AcademicDoc } from "@/lib/generation/types";
import { slideNotes } from "@/lib/generation/slide-layout";
import { SLIDE_TEMPLATE_BY_ID } from "@/lib/generation/slide-templates";
import { getSlideTheme } from "@/lib/generation/slide-themes";
import { buildSlideDeck } from "@/lib/generation/slides";
import { SLIDE } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";
import { ViewerToolbar } from "./toolbar";
import { SlideCanvas } from "./SlideCanvas";
import { SlideRail } from "./SlideRail";
import { SlideStage, type SlideStageOverlayCtx } from "./SlideStage";
import { useSlideKeys } from "./useSlideKeys";
import { useReveal, type LiveView } from "./useReveal";
import { LiveStrip } from "./LiveStrip";
import { totalChars } from "@/lib/viewers/reveal";
import { planSlide } from "@/lib/generation/slide-layout";

export type { LiveView };

/**
 * `live` propi `unknown` bo'lib keladi (transport paketi uni serverdan
 * xom JSON sifatida oladi). Ko'ruvchi ishonchsiz ma'lumotdan chizmasligi
 * uchun shakl SHU YERDA bir marta tekshiriladi: kerakli maydonlardan
 * biri yetishmasa jonli rejim umuman yoqilmaydi va oddiy ko'ruvchi
 * ishlaydi.
 */
export function asLiveView(live: unknown): LiveView | null {
  if (!live || typeof live !== "object") return null;
  const v = live as Partial<LiveView>;
  if (!Array.isArray(v.slides) || v.slides.length === 0) return null;
  if (!Array.isArray(v.written) || !Array.isArray(v.roles) || !Array.isArray(v.imageWait)) return null;
  if (!v.images || typeof v.images.got !== "number" || typeof v.images.want !== "number") return null;
  if (typeof v.progress !== "number" || typeof v.step !== "string") return null;
  // `liveDocOf` shu uchtasisiz hujjat qura olmaydi.
  if (!v.meta || typeof v.meta !== "object" || typeof v.theme !== "string" || typeof v.template !== "string") return null;
  return v as LiveView;
}

/**
 * F2: yupqa kompozitor.
 *
 * `SlideViewer` avval bitta katta komponent edi — eskiz paneli, sahna va
 * klaviatura ishlovi endi mos ravishda `SlideRail`, `SlideStage`,
 * `useSlideKeys` ga ajratildi. Bu fayl faqat holatni ushlaydi va
 * bo'laklarni bog'laydi; render natijasi bo'linishdan OLDINGISI bilan
 * BIR XIL (`tests/viewer/slide-viewer-seams.test.mts`).
 *
 * `live`, `overlay`, `gen`, `onGen` — keyingi ikki paket (jonli
 * generatsiya va tahrirlash) uchun ochilgan joylar. Hozircha faqat
 * e'lon qilinadi va uzatiladi — hech narsa chizmaydi va hech qanday
 * xatti-harakatni o'zgartirmaydi (no-op).
 */
export function SlideViewer({
  doc,
  live,
  overlay,
  gen,
  onGen,
}: {
  doc: AcademicDoc;
  /**
   * Jonli generatsiya holati (`LiveDeck` — `lib/generation/slide-progress.ts`).
   * Xom `unknown` keladi va `asLiveView` bilan tekshiriladi; `null`
   * bo'lsa ko'ruvchi tayyor hujjatdagidek ishlaydi.
   */
  live?: unknown;
  /** `SlideStage` ustiga qatlam chizish sloti — berilmasa hech narsa chiqmaydi. */
  overlay?: (ctx: SlideStageOverlayCtx) => ReactNode;
  /** Keyingi paket uchun — hozircha ishlatilmaydi. */
  gen?: unknown;
  /** Keyingi paket uchun — hozircha ishlatilmaydi (no-op). */
  onGen?: (g: unknown) => void;
}) {
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
  // Standart holat hujjatdan: `speakerNotes=false` bo'lsa panel yopiq ochiladi.
  const [notesOn, setNotesOn] = useState(deck.speakerNotes);
  const [presenter, setPresenter] = useState(false);
  const [zoom, setZoom] = useState(75);
  const [fitOn, setFitOn] = useState(true);

  // `gen`/`onGen` — tahrirlash paketiniki, bu yerda tegilmaydi (no-op).
  void gen;
  void onGen;

  const lv = useMemo(() => asLiveView(live), [live]);

  const go = useCallback(
    (n: number) => setI(Math.max(0, Math.min(slides.length - 1, n))),
    [slides.length],
  );

  /*
   * JONLI shoxlar.
   *
   * `marks` — eskiz paneliga: xaritada YO'Q indeks «hali yozilmagan».
   * `writing` esa navbatdagi (yozilayotgan) BITTA slayd: `written` da
   * yo'q eng kichik indeks. Shu sabab «yozilmoqda» nuqtasi doim bitta
   * joyda turadi va foydalanuvchi qayerda ish ketayotganini ko'radi.
   */
  const marks = useMemo(() => {
    if (!lv) return undefined;
    const done = new Set(lv.written);
    const m: Record<number, "writing" | "done"> = {};
    for (const idx of done) m[idx] = "done";
    if (!lv.final) {
      for (let k = 0; k < slides.length; k++) {
        if (!done.has(k)) {
          m[k] = "writing";
          break;
        }
      }
    }
    return m;
  }, [lv, slides.length]);

  const written = useMemo(() => lv?.written ?? [], [lv]);
  // Sahnada ham FAQAT `done` haqiqiy matn — qolganida skelet.
  const skeleton = Boolean(lv && marks && marks[i] !== "done");
  /*
   * Yozish animatsiyasi uchun matn hajmi — sahnadagi slaydning O'ZI
   * (`planSlide` qatlamlari). Slayd hali yo'q yoki skelet bo'lsa
   * hisoblanmaydi.
   */
  const chars = useMemo(() => {
    const s = slides[i];
    if (!lv || !s || skeleton) return 0;
    return totalChars(planSlide(s, theme, deck.visual, i, slides.length, deck.audience, deck.templateId, { bodyType: deck.bodyType, logo: deck.logo }).layers);
  }, [lv, slides, i, skeleton, theme, deck.visual, deck.audience, deck.templateId, deck.bodyType, deck.logo]);

  const reveal = useReveal({ index: i, written, final: lv?.final ?? true, chars, enabled: Boolean(lv) });

  /*
   * Avtomatik ergashish: yangi slayd yozilganda sahna unga sakraydi.
   * Foydalanuvchi eskizni bosishi bilan to'xtaydi — o'qiyotgan slayd
   * oyoq ostidan tortib olinmasin.
   */
  const [follow, setFollow] = useState(true);
  const lastWritten = written.length ? Math.max(...written) : -1;
  useEffect(() => {
    if (!lv || !follow || lastWritten < 0) return;
    setI((cur) => (lastWritten > cur ? Math.min(lastWritten, slides.length - 1) : cur));
  }, [lv, follow, lastWritten, slides.length]);

  const railGo = useCallback(
    (n: number) => {
      setFollow(false);
      go(n);
    },
    [go],
  );

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
    return () => {
      // Komponent taqdimot rejimida yopilsa (brauzer «orqaga», boshqa
      // hujjatga o'tish) fullscreen'da qolib ketmasin.
      if (present && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [present]);

  // Brauzer to'liq ekrandan chiqsa (Esc, F11) — holat mos kelib qolsin.
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) setPresent(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Jonli rejimda F/P klavishlari ham taqdimotni ochmasin — tugmalari
  // yashirin bo'lgani holda klaviatura yo'li ochiq qolsa, yarim deka
  // to'liq ekranga chiqib ketardi.
  const noop = useCallback(() => {}, []);
  useSlideKeys({ go, i, total: slides.length, present, setPresent: lv ? noop : setPresent, setPresenter: lv ? noop : setPresenter });

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
  const notes = slide ? slideNotes(slide, deck.speakerNotes) : "";

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
          /*
           * Jonli generatsiya paytida taqdimot/to'liq ekran va eslatma
           * YO'Q: deka hali yarim, uni proyektorga chiqarish ma'nosiz,
           * eslatmalar esa `deck` hodisasidan keyin qayta yoziladi —
           * yarim eslatma ko'rsatish yolg'on bo'lardi.
           */
          onFullscreen={lv ? undefined : () => setPresent(true)}
          extra={
            <>
              {lv ? null : (
              <button
                type="button"
                className={cn("hover:bg-white/10 inline-flex items-center gap-1 rounded px-2 py-1 text-xs", notesOn && "bg-white/10")}
                onClick={() => setNotesOn((v) => !v)}
              >
                <StickyNote className="size-3.5" />
                Eslatma
              </button>
              )}
              {/* Interfeys o'zbekcha: xom `id` («magazine», «problem») emas,
                  shablonning formada ko'ringan nomi. */}
              <span className="hidden text-xs text-white/50 lg:inline">
                {SLIDE_TEMPLATE_BY_ID[deck.templateId]?.nameUz ?? deck.templateId} · {theme.nameUz}
              </span>
            </>
          }
        />
      )}

      <div className={cn("flex min-h-0 flex-1", present ? "bg-black" : "bg-[#1e1e1e]")}>
        {!present ? (
          <SlideRail
            slides={slides}
            theme={theme}
            visual={deck.visual}
            audience={deck.audience}
            templateId={deck.templateId}
            bodyType={deck.bodyType}
            logo={deck.logo}
            i={i}
            go={lv ? railGo : go}
            roles={lv?.roles}
            marks={marks}
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <SlideStage
            slide={slide}
            theme={theme}
            visual={deck.visual}
            audience={deck.audience}
            templateId={deck.templateId}
            bodyType={deck.bodyType}
            logo={deck.logo}
            index={i}
            total={slides.length}
            present={present}
            zoom={zoom}
            fitOn={fitOn}
            notesOn={notesOn}
            presenter={presenter}
            onAdvance={() => go(i + 1)}
            overlay={overlay}
            skeleton={skeleton}
            role={lv?.roles?.[i]}
            imageWait={Boolean(lv?.imageWait.includes(i))}
            reveal={reveal}
          />

          {lv ? <LiveStrip live={lv} /> : null}

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
              {lv ? null : (
                <button type="button" className="hover:bg-white/10 ml-2 rounded p-1" onClick={() => setPresent(true)}>
                  {present ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </button>
              )}
            </div>
          ) : null}

          {/* Jonli rejimda eslatma paneli ham yopiq — matn `deck`
              hodisasidan keyin qayta yoziladi, yarimi yolg'on bo'lardi. */}
          {!present && notesOn && !lv ? (
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
                      templateId={deck.templateId} bodyType={deck.bodyType} logo={deck.logo}
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
