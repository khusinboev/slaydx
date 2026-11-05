"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TOOL_ICONS } from "@/components/shell/icons";
import { cn } from "@/lib/cn";
import type { HomeSlide } from "./hub-model";
import { HUB_ENTER, HUB_STAGGER_MS } from "./HubSection";

/** One height for every state: the slides, a different slide count and the skeleton never move the grid below. */
const HEIGHT = "h-[9.25rem]";

/**
 * The promo banner: one rounded `--hero` card, a horizontal snap carousel that scrolls inside itself, with dots when
 * there is more than one slide. It does not advance on its own. Dots set `scrollLeft`, so `motion-safe:scroll-smooth`
 * is what makes them glide: under reduced motion they jump. Slides keep the hub's login gate. `pending` = the session
 * (and so the switches) is unknown: a skeleton of the same size.
 */
export function HubBanner({ slides, pending, onPick, index }: { slides: HomeSlide[]; pending: boolean; onPick: (href: string) => void; index: number }) {
  const scroller = useRef<HTMLUListElement>(null);
  const [scrolled, setScrolled] = useState(0);
  const active = Math.min(scrolled, slides.length - 1);

  const onScroll = () => {
    const el = scroller.current;
    if (el?.clientWidth) setScrolled(Math.round(el.scrollLeft / el.clientWidth));
  };
  const goTo = (i: number) => {
    const el = scroller.current;
    if (el) el.scrollLeft = i * el.clientWidth;
  };

  if (pending) {
    return <div data-hub-banner-skeleton aria-hidden className={cn(HEIGHT, "bg-muted slx-shimmer rounded-[var(--radius-card)]")} />;
  }
  return (
    <section
      aria-roledescription="carousel"
      aria-label="Takliflar"
      data-hub-section="banner"
      className={cn("text-hero-foreground relative overflow-hidden rounded-[var(--radius-card)] bg-[image:var(--hero)] shadow-[var(--shadow-card)]", HEIGHT, HUB_ENTER)}
      style={{ animationDelay: `${index * HUB_STAGGER_MS}ms` }}
    >
      <ul
        ref={scroller}
        data-hub-banner
        onScroll={onScroll}
        className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide) => (
          <li key={slide.id} className="h-full w-full flex-none snap-start">
            <Slide slide={slide} onPick={onPick} />
          </li>
        ))}
      </ul>
      {slides.length > 1 ? (
        <div data-hub-banner-dots className="absolute right-2 bottom-0 flex">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              data-hub-banner-dot={slide.id}
              aria-label={`${i + 1}-taklif: ${slide.title}`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => goTo(i)}
              className="focus-visible:ring-hero-foreground flex h-11 w-7 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
              <span className={cn("block size-2 rounded-full bg-current transition-opacity motion-reduce:transition-none", i === active ? "opacity-90" : "opacity-30")} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Slide({ slide, onPick }: { slide: HomeSlide; onPick: (href: string) => void }) {
  const Icon = TOOL_ICONS[slide.icon];
  return (
    <Link
      href={slide.href}
      data-hub-slide={slide.id}
      onClick={() => onPick(slide.href)}
      className="focus-visible:ring-hero-foreground flex h-full flex-col justify-between gap-2 rounded-[var(--radius-card)] p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      <span className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[18px] leading-snug font-bold lg:text-[20px]">{slide.title}</span>
          <span className="mt-0.5 line-clamp-2 text-[14px] leading-snug opacity-85">{slide.promise}</span>
        </span>
        <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-white/25">
          {Icon ? <Icon className="size-6" /> : null}
        </span>
      </span>
      <span data-hub-slide-cta className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold">
        {slide.cta}
        <ArrowRight className="size-4" aria-hidden />
      </span>
    </Link>
  );
}
