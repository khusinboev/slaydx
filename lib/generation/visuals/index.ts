import { academicVisual } from "./academic";
import { boldVisual } from "./bold";
import { circleVisual } from "./circle";
import { dashboardVisual } from "./dashboard";
import { editorialVisual } from "./editorial";
import { formalVisual } from "./formal";
import { notebookVisual } from "./notebook";
import { railVisual } from "./rail";
import { splitVisual } from "./split";
import { storyVisual } from "./story";
import { DESIGN_VISUALS, isDesignVisual, type DesignVisual, type VisualSpec } from "./spec";

export { DESIGN_VISUALS, LEGACY_VISUALS, isDesignVisual } from "./spec";
export type { DesignVisual, LegacyVisual, PlanFn, VisualSpec } from "./spec";

/** Dizayn reyestri — `slide-layout.ts` `dispatch`/`photoSlot` shu yerdan o'qiydi. */
export const VISUALS: Record<DesignVisual, VisualSpec> = {
  academic: academicVisual,
  circle: circleVisual,
  notebook: notebookVisual,
  formal: formalVisual,
  story: storyVisual,
  split: splitVisual,
  bold: boldVisual,
  dashboard: dashboardVisual,
  rail: railVisual,
  editorial: editorialVisual,
};

/** Dizayn bo'lsa spec, eski oila bo'lsa `null`. */
export function designOf(visual: string): VisualSpec | null {
  return isDesignVisual(visual) ? VISUALS[visual] : null;
}

// Reyestr to'liqligi — kompilyatsiya vaqtida.
void DESIGN_VISUALS;
