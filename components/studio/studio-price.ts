import { normalize, type Badge, type ClientEntry } from "@/lib/studio-core";
import { applyPriceAdjust, getClientPriceAdjust, type PriceAdjust } from "@/lib/price-adjust";
import { studioEntryPrice } from "@/lib/media/studio-pricing";
import type { ToolId } from "@/lib/types";
import type { StudioPricing } from "./studio-types";

/**
 * Studio price preview — the browser side of `priceFor(studio-image, values)` (docs/studio/P1-SPEC.md «Contract»).
 *
 * NOT a second formula: the base is `studioEntryPrice` (`lib/media/studio-pricing.ts`), the very function the server's
 * `basePriceFor` / `effectivePrice` price with, fed the catalog endpoint's entry and `pricing` block (provider cost —
 * live upstream unit cost included — × markup, the model's override wins, rounded up); then the session's `tool_pricing`
 * % exactly as `priceFor` applies it. The request still carries it as `expectedPrice`: a mismatch is a 409, nothing is
 * charged. `tests/ui/studio-model.test.mts` proves preview == server price per model × count × override × %.
 */

export const STUDIO_TOOL_ID: ToolId = "studio-image";

type Values = Readonly<Record<string, unknown>>;

/** Price before the admin's per-tool adjustment (the shared formula). */
export function studioBasePrice(entry: ClientEntry, values: Values, pricing: StudioPricing): number {
  return studioEntryPrice(entry, values, pricing);
}

/** What the button shows and `expectedPrice` carries. `adjust` defaults to the session's adjustment of this tool. */
export function studioPrice(entry: ClientEntry, values: Values, pricing: StudioPricing, adjust: PriceAdjust | undefined = getClientPriceAdjust(STUDIO_TOOL_ID)): number {
  return applyPriceAdjust(studioBasePrice(entry, values, pricing), adjust);
}

/** How many pictures the values ask for (the cost rule's count param; one when the model has none). */
export function outputCount(entry: ClientEntry, values: Values): number {
  const rule = entry.cost;
  if (rule.per !== "output" || !rule.countParam) return 1;
  const n = Number(normalize(entry.params, values)[rule.countParam]);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Price of ONE picture with the rest of the values as they are («~870 so'm / rasm» on a card). */
export function unitPrice(entry: ClientEntry, values: Values, pricing: StudioPricing, adjust?: PriceAdjust): number {
  const rule = entry.cost;
  const one = rule.per === "output" && rule.countParam ? { ...values, [rule.countParam]: 1 } : values;
  return studioPrice(entry, one, pricing, adjust);
}

/** Uzbek name of a model badge (card line and filter chip). */
export const BADGE_LABEL: Readonly<Record<Badge, string>> = {
  tez: "Tez",
  sifatli: "Sifatli",
  arzon: "Arzon",
  matn: "Matnli dizayn",
  ovozli: "Ovozli",
  yangi: "Yangi",
};

/** The filter chips of the model picker, in this order (a chip is drawn only when some model carries its badge). */
export const FILTER_BADGES: readonly Badge[] = ["tez", "sifatli", "arzon", "matn"];

export function badgeText(entry: ClientEntry): string {
  return entry.badges.map((b) => BADGE_LABEL[b] ?? b).join(", ");
}

/** Two letters for the model's avatar tile («Nano Banana» → NB). */
export function initials(label: string): string {
  const words = label
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}
