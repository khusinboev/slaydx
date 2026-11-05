import type { FormValues, ToolId } from "../types";

/**
 * `market_items.params_json` (docs/market/PLAN.md §1.4): `values_json` of the source is NEVER copied. Each tool has an
 * allow-list of the form keys the price formula (`basePriceFor`) and the viewer read; anything else is dropped, so a new
 * form field cannot leak into a listing by default. `tests/market-params.test.mts` proves the price survives the list.
 *
 * The real form keys differ from the plan's shorthand: work kinds travel as `workKind`, the profile as `subjectProfile`,
 * essays as `essayKind` / `essayLevel` / `wordTarget`, the thesis type as `articleType`, a lesson type as `lessonType`.
 * The older `kind` / `type` keys stay: the engines still read them as fallbacks.
 */

const SLIDE_KEYS = ["slideCount", "slideTheme", "slideTemplate", "slideAudience", "textVolume", "quizCount", "agendaSlide", "language", "design"] as const;
const WORK_KEYS = ["pages", "workKind", "kind", "language", "subjectProfile"] as const;

const PARAM_KEYS: Readonly<Partial<Record<ToolId, readonly string[]>>> = {
  slide: SLIDE_KEYS,
  "pro-slide": SLIDE_KEYS,
  referat: WORK_KEYS,
  "mustaqil-ish": WORK_KEYS,
  coursework: WORK_KEYS,
  konspekt: WORK_KEYS,
  essay: ["essayContext", "pages", "essayKind", "kind", "essayLevel", "level", "wordTarget", "language", "design"],
  thesis: ["articleType", "thesisType", "pages", "language"],
  "lesson-plan": ["lessonType", "type", "grade", "language"],
};

export type MarketParams = Record<string, string | number | boolean>;

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/** The tool's allow-listed form params of a generation; non-scalar and empty values are dropped too. */
export function pickMarketParams(toolId: ToolId, values: Record<string, unknown>): MarketParams {
  const out: MarketParams = {};
  for (const key of PARAM_KEYS[toolId] ?? []) {
    const v = values[key];
    if (isScalar(v) && v !== "") out[key] = v;
  }
  return out;
}

/** Stored params back as the `FormValues` of the price formula. Re-filtered: `params_json` is read as untrusted. */
export function paramsAsFormValues(toolId: ToolId, params: unknown): FormValues {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  return pickMarketParams(toolId, params as Record<string, unknown>);
}

/** A human size for search and cards: the page-package label of a document, the count of a deck. */
export function sizeBucket(params: MarketParams): string {
  return String(params.pages ?? params.slideCount ?? "");
}
