/**
 * «Bitiruvchi portreti» (program-17 item 14) -- the catalogue and the input normalizer.
 *
 * Client-safe on purpose (no node, no server imports): the composer, the price formula in
 * `lib/tools.ts`, the prompt builder and the engine all read THIS file, so a gown colour,
 * a background or a variant count exists in exactly one place.
 *
 * Every option here changes the picture (it reaches the model prompt, `portrait/prompt.ts`) or
 * the number of pictures; `lib/generation/portrait-params.ts` declares the same set and
 * `tests/portrait-params.test.mts` proves it with a differential probe ("every param must work").
 */

export const PORTRAIT_GOWNS = [
  { id: "black", label: "Qora", hex: "#16161a", prompt: "black" },
  { id: "navy", label: "To‘q ko‘k", hex: "#1b2a5c", prompt: "deep navy blue" },
  { id: "burgundy", label: "Bordo", hex: "#6d1a2c", prompt: "rich burgundy (dark wine red)" },
  { id: "green", label: "Yashil", hex: "#1f5b3f", prompt: "dark forest green" },
] as const;
export type PortraitGownId = (typeof PORTRAIT_GOWNS)[number]["id"];

export const PORTRAIT_BACKGROUNDS = [
  {
    id: "studio",
    label: "Studiya",
    prompt:
      "a classic photo-studio backdrop: a smooth, softly graded neutral grey-blue painted canvas with gentle vignetting, no objects",
  },
  {
    id: "university",
    label: "Universitet binosi",
    prompt:
      "the stone facade of a grand university building with tall columns and wide steps, softly out of focus (shallow depth of field), warm daylight, blank walls without any writing",
  },
  {
    id: "library",
    label: "Kutubxona",
    prompt:
      "a classic university library: tall wooden shelves full of books, warm lamp light, softly out of focus (shallow depth of field)",
  },
  {
    id: "hall",
    label: "Bitiruv zali",
    prompt:
      "a festive graduation hall: a bright ceremonial auditorium with rows of seats and soft stage lights, softly out of focus (shallow depth of field), no banners and no writing",
  },
] as const;
export type PortraitBackgroundId = (typeof PORTRAIT_BACKGROUNDS)[number]["id"];

/** Optional graduation stola (sash). `none` = no stola. */
export const PORTRAIT_SASHES = [
  { id: "none", label: "Yo‘q", hex: "", prompt: "" },
  { id: "gold", label: "Oltin", hex: "#c9a227", prompt: "gold" },
  { id: "white", label: "Oq", hex: "#f2f2ee", prompt: "white" },
  { id: "blue", label: "Ko‘k", hex: "#2f6fb5", prompt: "royal blue" },
  { id: "red", label: "Qizil", hex: "#b3262e", prompt: "red" },
] as const;
export type PortraitSashId = (typeof PORTRAIT_SASHES)[number]["id"];

export const PORTRAIT_VARIANTS = [1, 2] as const;
export type PortraitVariants = (typeof PORTRAIT_VARIANTS)[number];

/** so'm per variant (the base price; the admin «Narxlar» page adjusts it through `tool_pricing`). */
export const PORTRAIT_PRICE_PER_VARIANT = 2000;

export const PORTRAIT_DEFAULTS = { gown: "black", background: "studio", sash: "none", variants: 1 } as const;

export type PortraitInput = {
  gown: PortraitGownId;
  background: PortraitBackgroundId;
  sash: PortraitSashId;
  variants: PortraitVariants;
  /** `photo_uploads.asset_id` of the selfie ("" = none). */
  photoAssetId: string;
};

const pick = <T extends { id: string }>(list: readonly T[], raw: unknown, fallback: T["id"]): T["id"] => {
  const v = String(raw ?? "").trim();
  return list.some((x) => x.id === v) ? v : fallback;
};

export function normalizeVariants(raw: unknown): PortraitVariants {
  return Number(raw) >= 2 ? 2 : 1;
}

export function portraitGownOf(id: string) {
  return PORTRAIT_GOWNS.find((g) => g.id === id) ?? PORTRAIT_GOWNS[0];
}
export function portraitBackgroundOf(id: string) {
  return PORTRAIT_BACKGROUNDS.find((b) => b.id === id) ?? PORTRAIT_BACKGROUNDS[0];
}
export function portraitSashOf(id: string) {
  return PORTRAIT_SASHES.find((s) => s.id === id) ?? PORTRAIT_SASHES[0];
}

/** The ONE normalizer: form, price, budget, prompt and engine all read the form values through it. */
export function portraitInputFromValues(values: Record<string, unknown>): PortraitInput {
  const photo = String(values.photoAssetId ?? "").trim().toLowerCase();
  return {
    gown: pick(PORTRAIT_GOWNS, values.gown, PORTRAIT_DEFAULTS.gown) as PortraitGownId,
    background: pick(PORTRAIT_BACKGROUNDS, values.background, PORTRAIT_DEFAULTS.background) as PortraitBackgroundId,
    sash: pick(PORTRAIT_SASHES, values.sash, PORTRAIT_DEFAULTS.sash) as PortraitSashId,
    variants: normalizeVariants(values.variants),
    photoAssetId: /^[0-9a-f]{24}$/.test(photo) ? photo : "",
  };
}

export function encodePortraitValues(input: PortraitInput): Record<string, string | number> {
  return {
    gown: input.gown,
    background: input.background,
    sash: input.sash,
    variants: input.variants,
    photoAssetId: input.photoAssetId,
  };
}

/** Price of one job: base per variant × variants. */
export function portraitPrice(values: Record<string, unknown>): number {
  return PORTRAIT_PRICE_PER_VARIANT * portraitInputFromValues(values).variants;
}
