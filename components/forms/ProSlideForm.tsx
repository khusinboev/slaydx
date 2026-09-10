"use client";

import type { ToolConfig, UserProfile } from "@/lib/types";
import { slideParamsFor } from "@/lib/generation/slide-params";
import { AUTHOR_FIELD_IDS, SlideComposer } from "./SlideComposer";

/**
 * Pro slayd formasi — `SlideComposer` ning yupqa o'rami (Formalar 2).
 *
 * Uchta ro'yxat kompozitor kartalariga mos: `PRO_MAIN_FIELD_ORDER_1` —
 * «Slaydlar soni», `PRO_MAIN_FIELD_ORDER_2` — «Muallif», `PRO_EXTRA_FIELD_ORDER`
 * — «Sozlamalar». JSX ULARNI TO'G'RIDAN-TO'G'RI chizadi (`fields` propi
 * birlashmasi), shuning uchun ro'yxatlar va haqiqiy render ajralib keta
 * olmaydi — `tests/viewer/slide-form.test.mts` reyestr bilan solishtiradi.
 */
export const PRO_INLINE_FIELD_IDS = ["topic", "language", "slideTemplate", "slideTheme"];
export const PRO_MAIN_FIELD_ORDER_1 = ["slideCount"];
export const PRO_MAIN_FIELD_ORDER_2: string[] = [...AUTHOR_FIELD_IDS];
export const PRO_EXTRA_FIELD_ORDER = slideParamsFor("pro-slide")
  .map((p) => p.id)
  .filter((id) => !PRO_INLINE_FIELD_IDS.includes(id) && !PRO_MAIN_FIELD_ORDER_1.includes(id) && !PRO_MAIN_FIELD_ORDER_2.includes(id));

export function ProSlideForm({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  return (
    <SlideComposer
      tool={tool}
      profile={profile}
      kind="pro-slide"
      fields={[...PRO_MAIN_FIELD_ORDER_1, ...PRO_MAIN_FIELD_ORDER_2, ...PRO_EXTRA_FIELD_ORDER]}
    />
  );
}
