import { normalize, price, roundUpTo, type Badge, type ClientEntry } from "@/lib/studio-core";
import { applyPriceAdjust, getClientPriceAdjust, type PriceAdjust } from "@/lib/price-adjust";
import type { ToolId } from "@/lib/types";
import type { StudioPricing } from "./studio-types";

/**
 * Studio price preview — the client side of `priceFor(studio-image, values)` (docs/studio/P1-SPEC.md «Contract»):
 *
 *   mediaQuote(modelId, values, { soumPerUsd, markup, override })   →   the tool's `tool_pricing` % (`applyPriceAdjust`)
 *
 * The server is the only authority (the request carries this number as `expectedPrice`, a mismatch is a 409 and
 * nothing is charged). The context comes from `GET /api/media/catalog` → `pricing`; the model's own `cost` rule travels
 * in the entry. Only the core's pure functions run here (`price`, `normalize`), never a second copy of the formula.
 *
 * This is the legacy ladder's opposite on purpose: Studio sells provider cost × markup, so the P0 `fixed` overrides of
 * `lib/media/catalog.ts` do NOT apply (the old «Rasm» tool keeps them).
 */

/**
 * The tool id of Studio's image generations. Written as a cast so this module compiles on a tree where the backend has
 * not added `studio-image` to `ToolId` yet; once it has, the cast is a no-op.
 */
export const STUDIO_TOOL_ID = "studio-image" as unknown as ToolId;

type Values = Readonly<Record<string, unknown>>;

/** Price before the admin's per-tool adjustment: provider cost × markup (the model's override wins), rounded up. */
export function studioBasePrice(entry: ClientEntry, values: Values, pricing: StudioPricing): number {
  const override = pricing.overrides[entry.id];
  return price(entry.cost, normalize(entry.params, values), {
    rate: pricing.soumPerUsd,
    markup: pricing.markup,
    round: roundUpTo(pricing.step),
    override: override ? { mode: "markup", markup: override.markup } : null,
  });
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
