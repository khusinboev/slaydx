"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TOOL_ICONS } from "@/components/shell/icons";
import { cn } from "@/lib/cn";
import type { HomeSlide } from "./hub-model";
import { HUB_ENTER, HUB_STAGGER_MS } from "./HubSection";

/** One height for every state: the slides, a different slide count and the skeleton never move the grid below. */
const HEIGHT = "h-[9.25rem]";

/** The banner moves to the next slide after this long on one slide (owner 2026-11-12). */
export const BANNER_ROTATE_MS = 5000;

/** A scroll event this recent means the user is still scrolling the banner: the turn waits a whole period more. */
const SCROLL_IDLE_MS = 800;

/** Why the banner holds still right now (each pause reason is tracked on its own, the banner rotates when none is set). */
type Holds = { hover: boolean; focus: boolean; touch: boolean; drag: boolean; hidden: boolean };

/**
 * The promo banner: one rounded `--hero` card, a horizontal snap carousel that scrolls inside itself, with dots when
 * there is more than one slide. It advances by itself every `BANNER_ROTATE_MS`, wrapping to the first slide after the
 * last; a swipe or a dot restarts the period. It holds still while the mouse is over it, a finger or a mouse button
 * is down on it (until released), keyboard focus is inside it, the document is hidden, or within `SCROLL_IDLE_MS` of
 * the user's own scroll; one slide never turns.
 * Dots and turns set `scrollLeft`, so `motion-safe:scroll-smooth` is what makes them glide: under reduced motion they
 * jump. Slides keep the hub's login gate. `pending` = the session (and so the switches) is unknown: a skeleton of the
 * same size, no timer.
 */
export function HubBanner({ slides, pending, onPick, index }: { slides: HomeSlide[]; pending: boolean; onPick: (href: string) => void; index: number }) {
  const scroller = useRef<HTMLUListElement>(null);
  const [scrolled, setScrolled] = useState(0);
  /** Bumped by a manual dot: restarts the period even when the slide index did not change. */
  const [kick, setKick] = useState(0);
  const [holds, setHolds] = useState<Holds>({ hover: false, focus: false, touch: false, drag: false, hidden: false });
  const lastScrollAt = useRef(-Infinity);
  /** A button of the pointer is down on the banner: the focus it gives a dot or a slide is not a keyboard hold. */
  const pointerDown = useRef(false);
  const count = slides.length;
  const active = Math.min(scrolled, count - 1);
  const held = holds.hover || holds.focus || holds.touch || holds.drag || holds.hidden;
  const rotating = !pending && count > 1 && !held;

  const hold = useCallback((key: keyof Holds, on: boolean) => setHolds((h) => (h[key] === on ? h : { ...h, [key]: on })), []);

  const goTo = useCallback((i: number) => {
    const el = scroller.current;
    if (el) el.scrollLeft = i * el.clientWidth;
    setScrolled(i);
  }, []);

  const onScroll = () => {
    lastScrollAt.current = Date.now();
    const el = scroller.current;
    if (el?.clientWidth) setScrolled(Math.round(el.scrollLeft / el.clientWidth));
  };

  // The document being hidden (another tab, the Mini App minimised) holds the banner.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => hold("hidden", document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [hold]);

  // A drag ends wherever the button is released (the pointer may leave the banner mid-drag).
  useEffect(() => {
    if (!holds.drag) return;
    const end = () => {
      pointerDown.current = false;
      hold("drag", false);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [holds.drag, hold]);

  // One timer per (slide, period): a slide change — by the timer, a swipe or a dot — and any hold restart it.
  useEffect(() => {
    if (!rotating) return;
    const id = window.setTimeout(() => {
      // The user is mid-scroll (a trackpad, a fling still settling): never fight it, wait a whole period more.
      if (Date.now() - lastScrollAt.current < SCROLL_IDLE_MS) setKick((k) => k + 1);
      else goTo((active + 1) % count);
    }, BANNER_ROTATE_MS);
    return () => window.clearTimeout(id);
  }, [rotating, active, count, kick, goTo]);

  if (pending) {
    return <div data-hub-banner-skeleton aria-hidden className={cn(HEIGHT, "bg-muted slx-shimmer rounded-[var(--radius-card)]")} />;
  }
  return (
    <section
      aria-roledescription="carousel"
      aria-label="Takliflar"
      data-hub-section="banner"
      data-hub-banner-rotating={rotating ? "" : undefined}
      className={cn("text-hero-foreground relative overflow-hidden rounded-[var(--radius-card)] bg-[image:var(--hero)] shadow-[var(--shadow-card)]", HEIGHT, HUB_ENTER)}
      style={{ animationDelay: `${index * HUB_STAGGER_MS}ms` }}
      onPointerEnter={(e) => e.pointerType === "mouse" && hold("hover", true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && hold("hover", false)}
      onPointerDown={() => {
        pointerDown.current = true;
        hold("drag", true);
      }}
      onTouchStart={() => hold("touch", true)}
      onTouchEnd={(e) => e.touches.length === 0 && hold("touch", false)}
      onTouchCancel={() => hold("touch", false)}
      // Keyboard focus holds the banner; the focus a tap or a click leaves on a dot does not (it would stop it for good).
      onFocus={() => !pointerDown.current && hold("focus", true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold("focus", false);
      }}
    >
      <ul
        ref={scroller}
        data-hub-banner
        onScroll={onScroll}
        // While it turns by itself a screen reader is not interrupted every 5 s; held, the new slide is announced.
        aria-live={rotating ? "off" : "polite"}
        className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, i) => (
          <li
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} / ${count}`}
            data-hub-banner-slide={slide.id}
            className="h-full w-full flex-none snap-start"
          >
            <Slide slide={slide} onPick={onPick} />
          </li>
        ))}
      </ul>
      {count > 1 ? (
        <div data-hub-banner-dots className="absolute right-2 bottom-0 flex">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              data-hub-banner-dot={slide.id}
              aria-label={`${i + 1}-taklif: ${slide.title}`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => {
                goTo(i);
                setKick((k) => k + 1);
              }}
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
