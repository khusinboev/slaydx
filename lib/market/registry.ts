import { missingRequired, TOOL_BY_ID } from "../tools";
import type { FormValues, ToolId } from "../types";
import type { PurchaseFields } from "./types";

/**
 * Which tools the market resells (docs/market/PLAN.md §1.1). Enabling a v2 tool later = one line here + its sanitiser
 * rule. Everything personal (resume, translation), media and Studio is out by design.
 */

export type MarketFamily = "slides" | "teacher" | "essay" | "work" | "thesis";

export const MARKET_TOOLS: Readonly<Partial<Record<ToolId, { family: MarketFamily }>>> = {
  slide: { family: "slides" },
  "pro-slide": { family: "slides" },
  konspekt: { family: "slides" },
  essay: { family: "essay" },
  thesis: { family: "thesis" },
  referat: { family: "work" },
  "mustaqil-ish": { family: "work" },
  coursework: { family: "work" },
  "lesson-plan": { family: "teacher" },
};

export const MARKET_TOOL_IDS: readonly ToolId[] = Object.keys(MARKET_TOOLS) as ToolId[];

export const isMarketTool = (id: unknown): id is ToolId => typeof id === "string" && Object.prototype.hasOwnProperty.call(MARKET_TOOLS, id);

export function marketFamilyOf(toolId: string): MarketFamily | null {
  return isMarketTool(toolId) ? (MARKET_TOOLS[toolId]?.family ?? null) : null;
}

/** Decks show one more preview page than documents (§6 `market.preview_pages`). */
export const isDeckTool = (toolId: string): boolean => toolId === "slide" || toolId === "pro-slide";

/** The settings key that holds the default `max_copies` of a family. */
export const MAX_COPIES_KEY = {
  slides: "market.max_copies_slides",
  teacher: "market.max_copies_teacher",
  essay: "market.max_copies_essay",
  work: "market.max_copies_work",
  thesis: "market.max_copies_thesis",
} as const satisfies Record<MarketFamily, string>;

export const PURCHASE_FIELD_KEYS = ["author", "university", "faculty", "department", "group", "course", "teacher", "city"] as const satisfies readonly (keyof PurchaseFields)[];

/** Values that fill every non-title requirement of a tool, so a probe sees only the title-page fields. */
const PROBE_BASE: FormValues = { topic: "x", essayContext: "x", articleType: "x" };

/**
 * The title-page fields the buyer must fill: the tool's own required set (`missingRequired` is the one source, so the
 * market cannot drift from the form). Probe: drop one field at a time and see whether the tool starts to complain.
 */
export function requiredPurchaseFields(toolId: ToolId): string[] {
  const tool = TOOL_BY_ID[toolId];
  if (!tool) return [];
  const full: FormValues = { ...PROBE_BASE };
  for (const k of PURCHASE_FIELD_KEYS) full[k] = "x";
  const base = missingRequired(tool, full).length;
  return PURCHASE_FIELD_KEYS.filter((k) => {
    const without = { ...full };
    delete without[k];
    return missingRequired(tool, without).length > base;
  });
}
