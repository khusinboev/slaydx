"use client";

import { useEffect, useRef, useState } from "react";
import type { GenerationPreviewSlide } from "@/lib/api-client";
import { getSlideTheme } from "@/lib/generation/slide-themes";
import { SLIDE } from "@/lib/viewers/metrics";
import { SlideCanvas } from "../viewers/SlideCanvas";

/**
 * Birinchi slaydning haqiqiy renderi — `SlideCanvas` (1280×720) kartochka
 * kengligiga `scale` bilan kichraytiriladi. `SlideRail.tsx` eskizi bilan
 * AYNAN bir xil naqsh: chin o'lcham `absolute`/`top:0,left:0` bilan
 * chiziladi, atrofdagi qop (`overflow:hidden`) ortiqchasini kesadi.
 *
 * Standart `scale` (0.13) — o'lchov effektidan OLDIN SSR/birinchi
 * render uchun taxminiy qiymat (`tests/viewer/file-preview.test.mts`
 * SSR HTML da `SlideCanvas` chiqishini shu holatda tekshiradi);
 * `ResizeObserver` haqiqiy kengligini o'lchagach aniqlaydi.
 *
 * Separate chunk (ops sprint WP-C): the slide layout engine (`planSlide`,
 * visuals — ~34 kB gz) is needed only for decks with `preview.slide`, so
 * `FilePreview` loads this module lazily instead of shipping it with `/uz`.
 */
export default function SlideThumb({ slide }: { slide: GenerationPreviewSlide }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.13);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setScale(w / SLIDE.w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const theme = getSlideTheme(slide.themeId);
  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-black" data-slide-thumb="ready">
      <div
        className="pointer-events-none absolute top-0 left-0"
        style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        <SlideCanvas
          slide={slide.model}
          theme={theme}
          visual={slide.visual}
          audience={slide.audience}
          templateId={slide.templateId}
          bodyType={slide.bodyType}
          logo={slide.logo}
          index={0}
          total={1}
        />
      </div>
    </div>
  );
}
