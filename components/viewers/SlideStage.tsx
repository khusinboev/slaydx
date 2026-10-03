"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CustomTemplate } from "@/lib/generation/pptx-template";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "@/lib/generation/slide-templates";
import type { BodyRules } from "@/lib/generation/slide-audience";
import type { SlideModel, SlideTheme } from "@/lib/generation/slide-types";
import { SLIDE } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";
import { SlideCanvas } from "./SlideCanvas";
import { SkeletonSlide } from "./SkeletonSlide";
import { ImageWaitPlaque } from "./ImageWaitPlaque";

export type SlideStageOverlayCtx = { index: number; scale: number; slide: SlideModel };

/**
 * Sahna — `fitScale` shu yerda o'lchanadi va `zoom`/`fitOn` bilan birga
 * effektiv masshtabga aylanadi.
 *
 * `overlay` — tahrirlash qatlami (`SlideEditor`) sahna ustiga `absolute
 * inset-0` qatlamda o'z elementini chizishi uchun. Berilmasa hech narsa
 * qo'shilmaydi.
 */
export function SlideStage({
  slide,
  theme,
  visual,
  audience,
  templateId,
  bodyType,
  logo,
  custom,
  index,
  total,
  present,
  zoom,
  fitOn,
  presenter,
  onAdvance,
  overlay,
  skeleton = false,
  role,
  imageWait = false,
  reveal,
  hideSrc,
  onFitScale,
}: {
  slide?: SlideModel;
  theme: SlideTheme;
  visual: SlideVisual;
  audience: SlideAudience;
  templateId: SlideTemplateId;
  /** Deck darajasida (`buildSlideDeck`) — PPTX bilan bir xil qiymat. */
  bodyType?: BodyRules;
  logo?: string;
  custom?: CustomTemplate;
  index: number;
  total: number;
  present: boolean;
  zoom: number;
  fitOn: boolean;
  /** `fitScale` effektini qayta o'lchash kerakligini bildiruvchi holat. */
  presenter: boolean;
  onAdvance?: () => void;
  overlay?: (ctx: SlideStageOverlayCtx) => ReactNode;
  /** L5 jonli: bu slaydning matni hali yozilmagan → eskiz. */
  skeleton?: boolean;
  /** Skelet yorlig'i (`LiveDeck.roles[i]`). */
  role?: string;
  /** L5 jonli: rasm hali kelmagan → `photoSlot` qutisida plashka. */
  imageWait?: boolean;
  /** L5 jonli: `SlideCanvas` ga uzatiladigan matn ulushi (0..1). */
  reveal?: number;
  /** Tahrirlanayotgan qatlam kaliti — `SlideCanvas` uni yashiradi (ustida tahrir maydoni turadi). */
  hideSrc?: string;
  /**
   * «Moslash» masshtabi (taqdimotda ishlatiladigan o'sha qiymat) — asboblar
   * paneli yorlig'iga HAQIQIY foizni berish uchun. O'lcham o'zgarganda
   * chaqiriladi; qiymat 0.001 ga yaxlitlanadi. Barqaror callback
   * (`setState`) kutiladi.
   */
  onFitScale?: (scale: number) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0.6);
  /*
   * Sensorli tanlov: teginish qurilmasida rasm tugmalari («O‘z rasmim»,
   * «Rasmsiz») slayd ustida DOIM turmaydi — slaydga tegilganda chiqadi.
   * Sichqoncha uchun hech narsa o'zgarmaydi (CSS `hover: none` bilan
   * cheklangan, pastda).
   */
  const [touchSel, setTouchSel] = useState(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (present) {
        // Taqdimot — AVVALGIDEK: butun rect, 24 px zaxira.
        setFitScale(Math.min((r.width - 24) / SLIDE.w, (r.height - 24) / SLIDE.h));
        return;
      }
      /*
       * Oddiy rejim: ichki bo'sh joy (`padding`) haqiqiy hisobdan, shuning
       * uchun mobilda (kichik padding) slayd kengligi to'liq ishlatiladi.
       * `clientWidth` — aylantirgich o'rnini chiqarib tashlaydi.
       */
      const cs = getComputedStyle(el);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const w = (el.clientWidth || r.width) - padX;
      const h = (el.clientHeight || r.height) - padY;
      setFitScale(Math.min(w / SLIDE.w, h / SLIDE.h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [present, presenter]);

  const fitEff = Math.round(Math.max(0.18, fitScale) * 1000) / 1000;
  const scale = present || fitOn ? fitEff : zoom / 100;

  useEffect(() => {
    onFitScale?.(fitEff);
  }, [fitEff, onFitScale]);

  // Boshqa slaydga o'tilganda tanlov tushadi.
  useEffect(() => setTouchSel(false), [index]);

  /*
   * `m-auto` (justify/items-center EMAS): kontent sig'sa markazda, sig'masa
   * (over-zoom) chap/yuqori chetdan boshlanadi va aylantirgich bilan
   * to'liq yetib boriladi — `justify-center` chap yarmini aylantirib
   * bo'lmaydigan joyga chiqarib yuborardi. «Moslash»da aylantirgich yo'q
   * (`overflow-hidden`): slayd har doim sig'adi va markazda turadi.
   * Taqdimot klasslari AVVALGIDEK.
   */
  return (
    <div
      ref={stageRef}
      data-slide-stage={present ? "present" : fitOn ? "fit" : "zoom"}
      className={cn(
        "flex min-h-0 flex-1",
        present
          ? "items-center justify-center"
          : cn(
              // Mobil: slayd kengligi bo'yicha (16:9) — pastda eskizlar uchun joy qoladi.
              fitOn && "max-md:aspect-video max-md:flex-none",
              "p-2 md:p-4",
              fitOn ? "overflow-hidden" : "overflow-auto",
            ),
      )}
      onClick={() => present && onAdvance?.()}
      onPointerDown={(e) => {
        // Slayd tashqarisiga (qora maydonga) tegilsa tanlov tushadi.
        if (!present && e.target === e.currentTarget) setTouchSel(false);
      }}
    >
      <div
        style={{ width: SLIDE.w * scale, height: SLIDE.h * scale }}
        className={cn(
          "relative m-auto shrink-0",
          !present && "shadow-2xl",
          // Sensorli qurilmada rasm tugmalari faqat slayd tanlanganda ko'rinadi.
          !present && "[@media(hover:none)]:[&:not([data-touch-sel])_[data-slide-image-controls]]:hidden",
        )}
        data-touch-sel={touchSel ? "" : undefined}
        onPointerDown={(e) => {
          if (!present && e.pointerType !== "mouse") setTouchSel(true);
        }}
        /*
          Tahrir qatlami hodisalarni SHU ramkada tinglaydi: bu yagona
          tugun bo'lib, ichida ham slayd (`data-src` li matnlar), ham
          overlay bor. Atribut FAQAT overlay bo'lganda yoziladi — passiv
          ko'ruvchi HTML i o'zgarmasin.
        */
        data-slide-frame={overlay ? "" : undefined}
      >
        <div
          className="absolute top-0 left-0 overflow-hidden"
          style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          {slide && skeleton ? <SkeletonSlide theme={theme} role={role} index={index} /> : null}
          {slide && !skeleton ? (
            <SlideCanvas slide={slide} theme={theme} visual={visual} audience={audience} templateId={templateId} bodyType={bodyType} logo={logo} custom={custom} index={index} total={total} reveal={reveal} hideSrc={hideSrc} />
          ) : null}
          {/*
            Jonli qatlam sahna ICHIDA, slayd bilan bir masshtabda —
            `overlay` sloti tahrirlash paketiniki va u masshtabdan
            tashqarida turadi.
          */}
          {slide && !skeleton && imageWait ? (
            <ImageWaitPlaque layout={slide.layout} visual={visual} theme={theme} />
          ) : null}
        </div>
        {/*
          O'ram `pointer-events-none`: aks holda u butun sahnani yopib, ikki
          bosishni O'ZIGA oladi va `data-src` li matnga yetkazmaydi (jsdom
          hit-testing qilmaydi — bu faqat haqiqiy brauzerda ko'rindi).
          Ichidagi tugmalar/maydonlar `pointer-events-auto` bilan ishlaydi.
        */}
        {overlay && slide ? <div className="pointer-events-none absolute inset-0">{overlay({ index, scale, slide })}</div> : null}
      </div>
    </div>
  );
}
