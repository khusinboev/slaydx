"use client";

import type { ToolConfig, UserProfile } from "@/lib/types";
import { slideParamsFor } from "@/lib/generation/slide-params";
import { SlideComposer } from "./SlideComposer";

export { TemplatePicker, ColorPicker } from "./slide-pickers";

/**
 * Oddiy slayd formasi — `SlideComposer` ning yupqa o'rami (Formalar 2).
 *
 * Maydonlar FAQAT `slideParamsFor("slide")` reyestridan: `SLIDE_INLINE_FIELD_IDS`
 * kompozitor kartalarida o'z komponentlari bilan (mavzu, til, shablon,
 * rang), qolgani `SLIDE_FIELD_ORDER` — `renderSlideParam` orqali.
 * `tests/viewer/slide-form.test.mts` ikkala ro'yxat birlashmasini reyestr
 * bilan AYNAN solishtiradi.
 */
export const SLIDE_INLINE_FIELD_IDS = ["topic", "language", "slideTemplate", "slideTheme"];

export const SLIDE_FIELD_ORDER = slideParamsFor("slide")
  .map((p) => p.id)
  .filter((id) => !SLIDE_INLINE_FIELD_IDS.includes(id));

export function SlideForm({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  return <SlideComposer tool={tool} profile={profile} kind="slide" fields={SLIDE_FIELD_ORDER} />;
}
