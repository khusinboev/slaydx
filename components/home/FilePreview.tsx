"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Presentation } from "lucide-react";
import type { GenerationPreviewSlide, ServerGeneration } from "@/lib/api-client";
import { getSlideTheme } from "@/lib/generation/slide-themes";
import { SLIDE } from "@/lib/viewers/metrics";
import { SlideCanvas } from "../viewers/SlideCanvas";
import { thumbUrl } from "@/lib/api-client";

/**
 * Ro'yxatdagi kartochka ko'rinishi.
 *
 * Ilgari bu komponent butun hujjatni (`gen.doc`) va IndexedDB dagi
 * rasmlarni yuklab, slaydni to'liq render qilardi — bosh sahifada 20 ta
 * kartochka uchun bu og'ir edi. Endi server tayyorlagan kichik `preview`
 * ishlatiladi: slayd dekalari uchun BIRINCHI slaydning to'liq maketi
 * (`preview.slide` — `SlideCanvas` bilan ko'ruvchidagidek chiziladi),
 * qolganlar uchun bitta rasm havolasi yoki bir necha qator matn.
 */
export function FilePreview({ gen }: { gen: ServerGeneration }) {
  const running = gen.status === "QUEUED" || gen.status === "IN_PROGRESS";

  if (running) {
    return (
      <div className="bg-muted flex h-full items-center justify-center">
        <div className="bg-primary/30 h-1.5 w-2/3 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full transition-all"
            style={{ width: `${Math.max(8, gen.progress)}%` }}
          />
        </div>
      </div>
    );
  }

  if (gen.status !== "COMPLETED") {
    return (
      <div className="bg-muted flex h-full items-center justify-center">
        <FileText className="text-muted-foreground size-8 opacity-50" />
      </div>
    );
  }

  const slide = gen.preview?.slide;
  if (slide) {
    return <SlideThumb slide={slide} />;
  }

  const url = gen.preview?.url;
  if (url) {
    return (
      // Rasm bizning `/api/.../assets` endpointimizdan keladi — `next/image`
      // optimizatsiyasi shaxsiy, cookie talab qiladigan manba uchun ishlamaydi.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
    );
  }

  const lines = gen.preview?.lines ?? [];
  const linesView = lines.length ? (
    <div className="h-full overflow-hidden bg-[#f7f4ec] px-3 py-2.5 text-left">
      <div className="mb-1.5 line-clamp-2 text-[11px] leading-tight font-bold text-[#1a2744]">{gen.topic}</div>
      {lines.map((t, i) => (
        <p key={i} className="mb-1 line-clamp-2 text-[9px] leading-snug text-[#334155]">
          {t}
        </p>
      ))}
    </div>
  ) : null;

  /*
   * DOCX/PPTX natija (referat, kurs ishi, tarjima…): asl faylning 1-sahifasi
   * — server yasagan kichik JPEG (`/thumb`, ~20 KB). Yuklanguncha va
   * eskiz bo'lmasa (LibreOffice yo'q, xato) matn qatorlari ko'rinadi.
   */
  if (gen.format === "docx" || gen.format === "pptx") {
    return <DocThumb id={gen.id} fallback={linesView} />;
  }

  if (linesView) {
    return linesView;
  }
  const Icon = gen.type === "slide" ? Presentation : gen.type === "image" ? ImageIcon : FileText;
  return (
    <div className="bg-[#eef1f4] flex h-full items-center justify-center">
      <Icon className="text-muted-foreground size-8" />
    </div>
  );
}

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
 */
function SlideThumb({ slide }: { slide: GenerationPreviewSlide }) {
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
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-black">
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

/**
 * Hujjat eskizi: `<img>` yuklanguncha `fallback` (matn qatorlari) turadi,
 * xatoda (404 — eskiz yasalmadi) ham shu qoladi. `loading="lazy"` —
 * ekrandan tashqaridagi kartalar serverga so'rov yubormaydi.
 */
function DocThumb({ id, fallback }: { id: string; fallback: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f7f4ec]" data-doc-thumb={state}>
      {state !== "ok" ? fallback : null}
      {state !== "error" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl(id)}
          alt=""
          loading="lazy"
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className={state === "ok" ? "absolute inset-0 h-full w-full object-cover object-top" : "absolute h-0 w-0 opacity-0"}
        />
      ) : null}
    </div>
  );
}

