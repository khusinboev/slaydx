"use client";

import { forwardRef, type CSSProperties, type SyntheticEvent } from "react";
import { ChevronDown, ChevronUp, Minus, Plus, RotateCcw, X } from "lucide-react";
import { SLIDE_FONTS, FONT_BY_ID, isSlideFontId, type SlideFontId } from "@/lib/generation/slide-fonts";
import { cn } from "@/lib/cn";

/**
 * Slide text style controls (font size + family), one props contract for
 * both forms (docs/mobile/R3-mobile-editing.md «Contract»):
 *
 *  - `SlideEditFloatingPanel` — desktop (mouse): the existing floating row
 *    over the edited box, unchanged look and aria-labels; placement comes
 *    from `placeFloatingPanel` (measured height) in `SlideEditor`.
 *  - `SlideEditStyleBar` — phone (coarse pointer or < 768 px): a 44 px bar
 *    that REPLACES the slide toolbar while a text is edited (in-flow, never
 *    over the slide), every hit area ≥ 44×44, no native `<select>`; font
 *    list and size presets open in `SlideEditFontSheet`.
 *
 * Neither ever takes focus from the contentEditable (iOS closes the keyboard
 * on blur): `pointerdown`/`mousedown` are cancelled on the container, which
 * suppresses the focus move but still lets `click` through.
 */

/** Sizes offered as presets (pt), inside `FONT_MIN..FONT_MAX`. */
export const FONT_PRESETS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 66] as const;
/** «−»/«+» step (pt). */
export const FONT_STEP = 2;

export type StyleControlsProps = {
  /** Current (rendered) size of the edited layer, pt. */
  size: number;
  min: number;
  max: number;
  /** The model has a size override («Standart» can clear it). */
  hasOverride: boolean;
  /** Chosen family; `""` = template default. */
  font: SlideFontId | "";
  /** The edited layer is a whole list — the choice applies to every item. */
  wholeList: boolean;
  /** `null` = «Standart» (remove the override). */
  onSize: (size: number | null) => void;
  onFont: (font: SlideFontId | null) => void;
};

export function clampFont(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Keeps the focus (and the phone keyboard) on the edited text. */
export function keepEditorFocus(e: SyntheticEvent) {
  const t = e.target as HTMLElement | null;
  // A native <select> (desktop panel) must take focus to open.
  if (t?.tagName === "SELECT") return;
  e.preventDefault();
}

/** Font label shown on the phone chip («Arial» when no family is chosen). */
export function fontLabel(font: SlideFontId | ""): string {
  return font ? FONT_BY_ID[font].label : "Arial";
}

/* ─────────────────────────────────────────── desktop ─── */

export const SlideEditFloatingPanel = forwardRef<HTMLDivElement, StyleControlsProps & { style?: CSSProperties }>(
  function SlideEditFloatingPanel({ size, min, max, hasOverride, font, wholeList, onSize, onFont, style }, ref) {
    return (
      <div
        ref={ref}
        data-slide-font-panel
        className="pointer-events-auto absolute z-10 flex max-w-[min(640px,95%)] flex-wrap items-center gap-1 rounded-md bg-[#2b2b2b] px-1.5 py-1 text-[11px] text-white/85 shadow-lg"
        style={style}
        onMouseDown={keepEditorFocus}
      >
        <span className="px-1 text-white/45">{wholeList ? "Barcha bandlar" : "Shrift"}</span>
        <select
          aria-label="Shrift oilasi"
          className="rounded bg-white/10 px-1 py-0.5 text-[11px] text-white outline-none"
          value={font}
          onChange={(e) => {
            const v = e.target.value;
            onFont(isSlideFontId(v) ? v : null);
          }}
        >
          <option value="" className="text-black">
            Standart (Arial)
          </option>
          {SLIDE_FONTS.map((f) => (
            <option key={f.id} value={f.id} className="text-black">
              {f.label}
            </option>
          ))}
        </select>
        <span className="mx-0.5 h-3.5 w-px bg-white/20" />
        <button
          type="button"
          aria-label="Shriftni kichraytirish"
          className="hover:bg-white/15 rounded p-1 disabled:opacity-40"
          disabled={size <= min}
          onClick={() => onSize(clampFont(size - FONT_STEP, min, max))}
        >
          <Minus className="size-3" />
        </button>
        <span className="min-w-6 text-center tabular-nums" aria-label="Joriy shrift o‘lchami">
          {size}
        </span>
        <button
          type="button"
          aria-label="Shriftni kattalashtirish"
          className="hover:bg-white/15 rounded p-1 disabled:opacity-40"
          disabled={size >= max}
          onClick={() => onSize(clampFont(size + FONT_STEP, min, max))}
        >
          <Plus className="size-3" />
        </button>
        <span className="mx-0.5 h-3.5 w-px bg-white/20" />
        {FONT_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Shrift ${n} pt`}
            className={cn("rounded px-1 py-0.5 tabular-nums", size === n ? "bg-sky-500 text-white" : "hover:bg-white/15")}
            onClick={() => onSize(n)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className={cn("rounded px-1.5 py-0.5", hasOverride ? "hover:bg-white/15" : "text-white/35")}
          disabled={!hasOverride}
          onClick={() => onSize(null)}
        >
          Standart
        </button>
      </div>
    );
  },
);

/* ───────────────────────────────────────────── phone ─── */

/** Bar height = every hit area (px). */
export const BAR_H = 44;

const hit = "inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md disabled:opacity-35";

export function SlideEditStyleBar({
  size,
  min,
  max,
  hasOverride,
  font,
  wholeList,
  onSize,
  sheetOpen,
  sheetId,
  onToggleSheet,
  onDone,
  onCancel,
}: StyleControlsProps & {
  sheetOpen: boolean;
  /** `id` of the sheet element (for `aria-controls`). */
  sheetId: string;
  onToggleSheet: () => void;
  /** «Tayyor» — commit the text. */
  onDone: () => void;
  /** «✕» — drop the unsaved text. */
  onCancel: () => void;
}) {
  return (
    <div
      data-slide-edit-bar
      role="toolbar"
      aria-label={wholeList ? "Barcha bandlar uslubi" : "Matn uslubi"}
      className="flex h-11 min-w-0 flex-1 items-center bg-[#2b2b2b] px-0.5 text-[13px] text-white select-none"
    >
      <button type="button" aria-label="Bekor qilish" title="Bekor qilish" className={cn(hit, "text-white/70 hover:bg-white/10")} onClick={onCancel}>
        <X className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Shriftni kichraytirish"
        className={cn(hit, "hover:bg-white/10")}
        disabled={size <= min}
        onClick={() => onSize(clampFont(size - FONT_STEP, min, max))}
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Joriy shrift o‘lchami"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-controls={sheetId}
        className={cn(hit, "w-10 min-w-10 font-medium tabular-nums hover:bg-white/10", sheetOpen && "bg-white/15")}
        onClick={onToggleSheet}
      >
        {size}
      </button>
      <button
        type="button"
        aria-label="Shriftni kattalashtirish"
        className={cn(hit, "hover:bg-white/10")}
        disabled={size >= max}
        onClick={() => onSize(clampFont(size + FONT_STEP, min, max))}
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Shrift oilasi"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-controls={sheetId}
        className={cn(
          "inline-flex h-11 min-w-11 flex-1 items-center justify-between gap-1 rounded-md px-2 hover:bg-white/10",
          sheetOpen && "bg-white/15",
        )}
        onClick={onToggleSheet}
      >
        <span className="min-w-0 truncate" style={font ? { fontFamily: FONT_BY_ID[font].css } : undefined}>
          {fontLabel(font)}
        </span>
        {sheetOpen ? <ChevronUp className="size-4 shrink-0 opacity-70" /> : <ChevronDown className="size-4 shrink-0 opacity-70" />}
      </button>
      <button
        type="button"
        aria-label="Standart o‘lcham"
        title="Standart o‘lcham"
        className={cn(hit, "hover:bg-white/10")}
        disabled={!hasOverride}
        onClick={() => onSize(null)}
      >
        <RotateCcw className="size-4" />
      </button>
      <button
        type="button"
        data-slide-edit-done
        className="ml-0.5 inline-flex h-11 shrink-0 items-center rounded-md bg-sky-600 px-3 font-semibold text-white hover:bg-sky-500"
        onClick={onDone}
      >
        Tayyor
      </button>
    </div>
  );
}
