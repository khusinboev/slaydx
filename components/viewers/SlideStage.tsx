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
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0.6);

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
  }, [present, presenter]);

  const scale = present || fitOn ? Math.max(0.18, fitScale) : zoom / 100;

  return (
    <div
      ref={stageRef}
      className="flex min-h-0 flex-1 items-center justify-center"
      onClick={() => present && onAdvance?.()}
    >
      <div
        style={{ width: SLIDE.w * scale, height: SLIDE.h * scale }}
        className={cn("relative", !present && "shadow-2xl")}
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
