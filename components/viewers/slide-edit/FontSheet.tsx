"use client";

import { cn } from "@/lib/cn";
import { SLIDE_FONTS, type SlideFontId } from "@/lib/generation/slide-fonts";
import { FONT_PRESETS, type StyleControlsProps } from "./StyleBar";

/**
 * Phone font sheet (R3 mockup B): two horizontally scrolling rows of 44 px
 * chips — font families (with «Standart») and size presets (with «Standart»).
 * No native `<select>`: its picker blurs the edited text and covers the screen.
 *
 * Placement contract (`SlideEditor`): rendered IN-FLOW directly above the
 * phone style bar, inside the toolbar slot, so it can never cover the slide
 * stage or the edited text; its height is capped at 40 % of the visible
 * viewport (`--vv-h`). It never takes focus (container cancels
 * `pointerdown`/`mousedown`; `click` still fires). Phone back closes it
 * first (its own history entry, see `SlideEditor`).
 */
export function SlideEditFontSheet({
  id,
  size,
  hasOverride,
  font,
  wholeList,
  onSize,
  onFont,
}: Omit<StyleControlsProps, "min" | "max"> & { id: string }) {
  const chip =
    "inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full border px-3 text-[13px] whitespace-nowrap disabled:opacity-35";
  const on = "border-sky-400 bg-sky-500 text-white";
  const off = "border-white/15 bg-white/5 text-white/90 hover:bg-white/15";
  const fonts: { id: SlideFontId | ""; label: string; css?: string }[] = [
    { id: "", label: "Standart" },
    ...SLIDE_FONTS.map((f) => ({ id: f.id, label: f.label, css: f.css })),
  ];
  return (
    <div
      id={id}
      data-slide-edit-sheet
      role="group"
      aria-label={wholeList ? "Barcha bandlar: shrift va o‘lcham" : "Shrift va o‘lcham"}
      className="flex w-full flex-col gap-1 overflow-y-auto overscroll-contain border-b border-white/10 bg-[#2b2b2b] py-1 text-white"
      style={{ maxHeight: "calc(var(--vv-h, 100svh) * 0.4)" }}
    >
      <div className="flex gap-1.5 overflow-x-auto px-2 [scrollbar-width:none]" data-slide-edit-fonts aria-label="Shrift oilasi" role="group">
        {fonts.map((f) => (
          <button
            key={f.id || "default"}
            type="button"
            aria-pressed={font === f.id}
            className={cn(chip, font === f.id ? on : off)}
            style={f.css ? { fontFamily: f.css } : undefined}
            onClick={() => onFont(f.id === "" ? null : f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-2 [scrollbar-width:none]" data-slide-edit-sizes aria-label="Shrift o‘lchami" role="group">
        {FONT_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Shrift ${n} pt`}
            aria-pressed={size === n}
            className={cn(chip, "tabular-nums", size === n ? on : off)}
            onClick={() => onSize(n)}
          >
            {n}
          </button>
        ))}
        <button type="button" className={cn(chip, off)} disabled={!hasOverride} onClick={() => onSize(null)}>
          Standart o‘lcham
        </button>
      </div>
    </div>
  );
}
