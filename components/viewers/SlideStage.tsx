"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
 * Sahna — F2 bo'linishida `SlideViewer.tsx` dan AYNAN 1:1 ko'chirildi
 * (xatti-harakat o'zgarmagan): `fitScale` shu yerda o'lchanadi va
 * `zoom`/`fitOn` bilan birga effektiv masshtabga aylanadi.
 *
 * `overlay` — keyingi paketlar (jonli generatsiya, tahrirlash) sahna
 * ustiga `absolute inset-0` qatlamda o'z elementini chizishi uchun.
 * Berilmasa hech narsa qo'shilmaydi.
 */
export function SlideStage({
  slide,
  theme,
  visual,
  audience,
  templateId,
  bodyType,
  logo,
  index,
  total,
  present,
  zoom,
  fitOn,
  notesOn,
  presenter,
  onAdvance,
  overlay,
  skeleton = false,
  role,
  imageWait = false,
  reveal,
}: {
  slide?: SlideModel;
  theme: SlideTheme;
  visual: SlideVisual;
  audience: SlideAudience;
  templateId: SlideTemplateId;
  /** Deck darajasida (`buildSlideDeck`) — PPTX bilan bir xil qiymat. */
  bodyType?: BodyRules;
  logo?: string;
  index: number;
  total: number;
  present: boolean;
  zoom: number;
  fitOn: boolean;
  /** `fitScale` effektini qayta o'lchash kerakligini bildiruvchi holatlar. */
  notesOn: boolean;
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
  }, [present, notesOn, presenter]);

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
      >
        <div
          className="absolute top-0 left-0 overflow-hidden"
          style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          {slide && skeleton ? <SkeletonSlide theme={theme} role={role} index={index} /> : null}
          {slide && !skeleton ? (
            <SlideCanvas slide={slide} theme={theme} visual={visual} audience={audience} templateId={templateId} bodyType={bodyType} logo={logo} index={index} total={total} reveal={reveal} />
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
        {overlay && slide ? <div className="absolute inset-0">{overlay({ index, scale, slide })}</div> : null}
      </div>
    </div>
  );
}
