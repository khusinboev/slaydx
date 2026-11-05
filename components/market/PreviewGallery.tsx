"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { galleryPages, isWideCover, type GalleryPage } from "./market-model";
import type { MarketItemView } from "@/lib/market/types";

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const ARROW =
  "bg-card/90 text-foreground hover:bg-card focus-visible:ring-ring absolute top-1/2 z-[1] hidden size-11 -translate-y-1/2 place-items-center rounded-full border shadow-md backdrop-blur-sm outline-none focus-visible:ring-2 disabled:opacity-0 sm:grid";

function Slide({ page, title, wide, eager }: { page: GalleryPage; title: string; wide: boolean; eager: boolean }) {
  const [broken, setBroken] = useState(false);
  const stub = page.kind === "stub";
  return (
    <figure
      data-gallery-slide={page.kind}
      className="relative flex h-full w-full flex-none snap-center items-center justify-center p-3 sm:p-5"
    >
      {broken ? (
        <span className="text-muted-foreground flex flex-col items-center gap-2 text-[14px]" data-gallery-broken>
          <ImageOff className="size-7" aria-hidden />
          Namuna tayyorlanmoqda
        </span>
      ) : (
        // Public watermarked rasters, never the document (§3.1, §5.3). A stub is 64 px wide on the server: CSS only scales it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.url}
          alt={stub ? `${title} — ${page.page}-sahifa (yopiq)` : `${title} — ${page.page}-sahifa namunasi`}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
          className={cn(
            "max-h-full max-w-full rounded-[8px] bg-white object-contain shadow-[0_10px_30px_-10px_rgba(43,32,19,0.4)] select-none",
            wide ? "aspect-video w-full" : "aspect-[3/4] h-full",
            stub && "blur-[3px]",
          )}
        />
      )}
      {stub && !broken ? (
        <figcaption className="absolute inset-0 flex items-center justify-center p-4">
          <span className="bg-card/95 text-foreground inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[14px] font-semibold shadow-md">
            <Lock className="size-4" aria-hidden />
            Xariddan keyin to‘liq
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * Preview carousel of the item page (§5.3): the readable watermarked pages, then the blurred stubs with a lock. One
 * scroll-snap track, so a phone swipes natively; arrows (from `sm`), thumbnails and the Left / Right keys move the same
 * track, smoothly unless reduced motion is asked for.
 */
export function PreviewGallery({ view }: { view: Pick<MarketItemView, "cover" | "previewPages" | "totalPages" | "title" | "toolId"> }) {
  const pages = useMemo(() => galleryPages(view), [view]);
  const wide = isWideCover(view.toolId);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const goTo = (i: number) => {
    const el = track.current;
    const next = Math.max(0, Math.min(pages.length - 1, i));
    setIndex(next);
    if (el && typeof el.scrollTo === "function") el.scrollTo({ left: next * el.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  // A swipe moves the track by itself: the dots and thumbnails follow it.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
      });
    };
    el.addEventListener("scroll", read, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", read);
    };
  }, []);

  const many = pages.length > 1;
  return (
    <section
      aria-roledescription="carousel"
      aria-label="Ish namunasi"
      data-market-gallery
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") goTo(index + 1);
        else if (e.key === "ArrowLeft") goTo(index - 1);
      }}
      className="min-w-0"
    >
      <div className={cn("bg-muted/60 relative overflow-hidden rounded-[22px] border", wide ? "aspect-[16/10]" : "aspect-[5/6] sm:aspect-[6/5]")}>
        <div
          ref={track}
          role="group"
          tabIndex={many ? 0 : undefined}
          aria-label={`${index + 1}-sahifa, jami ${pages.length}`}
          data-gallery-track
          className="focus-visible:ring-ring flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-inset [&::-webkit-scrollbar]:hidden"
        >
          {pages.map((p, i) => (
            <Slide key={p.page} page={p} title={view.title} wide={wide} eager={i === 0} />
          ))}
        </div>
        {many ? (
          <>
            <button type="button" aria-label="Oldingi sahifa" disabled={index === 0} onClick={() => goTo(index - 1)} className={cn(ARROW, "left-3")}>
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button type="button" aria-label="Keyingi sahifa" disabled={index === pages.length - 1} onClick={() => goTo(index + 1)} className={cn(ARROW, "right-3")}>
              <ChevronRight className="size-5" aria-hidden />
            </button>
            <span aria-hidden className="bg-foreground/75 text-background absolute right-3 bottom-3 rounded-full px-2.5 py-1 text-[13px] font-semibold tabular-nums">
              {index + 1} / {pages.length}
            </span>
          </>
        ) : null}
      </div>
      {many ? (
        <ol className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Sahifalar">
          {pages.map((p, i) => (
            <li key={p.page} className="flex-none">
              <button
                type="button"
                data-gallery-thumb={p.page}
                aria-label={`${p.page}-sahifa`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => goTo(i)}
                className={cn(
                  "focus-visible:ring-ring relative block h-[72px] overflow-hidden rounded-[10px] border-2 bg-white outline-none focus-visible:ring-2",
                  wide ? "aspect-video" : "aspect-[3/4]",
                  i === index ? "border-primary" : "border-transparent opacity-80 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- public raster */}
                <img src={p.url} alt="" loading="lazy" decoding="async" draggable={false} onError={(e) => (e.currentTarget.style.visibility = "hidden")} className={cn("h-full w-full object-cover object-top", p.kind === "stub" && "blur-[2px]")} />
                {p.kind === "stub" ? (
                  <span aria-hidden className="absolute inset-0 grid place-items-center bg-black/20 text-white">
                    <Lock className="size-4" />
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
