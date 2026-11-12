/**
 * AI slide (docs/ai-slide/SPEC.md): the image models a user can pick, the deck styles, the order limits and the price.
 *
 * Client-safe on purpose (no server imports): the form, `priceFor` (`lib/tools.ts`) and the engine read this one
 * file, so a model, its API id and its cost exist in exactly one place.
 *
 * `usdPerSlide` is the measured provider cost of one 2K 16:9 slide (live spike 2026-11-12, `SPEC.md` «Findings»)
 * with a small reserve; the price is that cost × `media.markup` × `finance.soum_per_usd` (`imageSlidePrice`).
 */
import type { FormValues } from "../../types";

export const IMAGE_SLIDE_MODELS = [
  {
    id: "nb21",
    api: "gemini-nano-banana-2.1",
    label: "Nano Banana 2.1",
    hint: "Tez va aniq matn — ko‘p taqdimotga yetarli",
    /**
     * Measured per delivered slide (live decks 2026-11-12): $0.073 with no redraw (2 222 output tokens × $30 / 1M plus
     * the style reference input), $0.090–0.093 with the proofreading and its redraws (2 of 8 slides redrawn).
     */
    usdPerSlide: 0.1,
    thinking: "minimal" as const,
  },
  {
    id: "pro",
    api: "gemini-3-pro-image",
    label: "Nano Banana Pro",
    hint: "Eng yuqori sifat: nozik chizma, murakkab sxema va jadval",
    /** (1 528 output + 189 thought) tokens × $120 / 1M ≈ $0.206, plus proofreading and the redraw reserve (as 2.1: +25 %). */
    usdPerSlide: 0.28,
    thinking: null,
  },
] as const;

export type ImageSlideModel = (typeof IMAGE_SLIDE_MODELS)[number];
export type ImageSlideModelId = ImageSlideModel["id"];
export const DEFAULT_IMAGE_SLIDE_MODEL: ImageSlideModelId = "nb21";

export function isImageSlideModelId(v: unknown): v is ImageSlideModelId {
  return typeof v === "string" && IMAGE_SLIDE_MODELS.some((m) => m.id === v);
}

export function imageSlideModelOf(values: { imageModel?: unknown }): ImageSlideModel {
  const raw = typeof values.imageModel === "string" ? values.imageModel.trim() : "";
  return IMAGE_SLIDE_MODELS.find((m) => m.id === raw) ?? IMAGE_SLIDE_MODELS[0];
}

/** The deck's look: one design block in every slide's prompt, so the whole deck reads as one. */
export const IMAGE_SLIDE_STYLES = [
  {
    id: "clean",
    label: "Zamonaviy oq",
    hint: "Oq fon, to‘q ko‘k va oltin urg‘u",
    prompt:
      "Clean modern flat design. Off-white background, deep navy (#14213D) for headings and table headers, warm gold (#C9A227) accents and thin rules, charcoal body text. Crisp vector illustrations with soft shadows. Generous margins, strong grid alignment.",
  },
  {
    id: "academic",
    label: "Ilmiy",
    hint: "Kitobdek jiddiy, sxema va jadvallarga mos",
    prompt:
      "Academic textbook style. White background, dark slate text, muted teal (#1F6F78) and brick red (#9B3D2E) accents. Precise technical line diagrams, labelled schematics and clean tables, like a high-quality university textbook figure. Serif headings, sans-serif body.",
  },
  {
    id: "bright",
    label: "Bolalar uchun yorqin",
    hint: "Quvnoq ranglar, katta harflar, multfilm uslubi",
    prompt:
      "Friendly bright style for school children. Light cream background, cheerful saturated colours (sky blue, sunflower yellow, grass green, coral), rounded shapes, playful cartoon illustrations, large rounded sans-serif lettering, lots of white space.",
  },
  {
    id: "dark",
    label: "Premium qora",
    hint: "To‘q fon, neon urg‘u — konferensiya uslubi",
    prompt:
      "Premium dark keynote style. Deep charcoal-to-navy gradient background, white headings, light grey body text, electric cyan (#22D3EE) and violet (#8B5CF6) accents, subtle glow, sleek 3D-ish icons and illustrations, cinematic lighting.",
  },
  {
    id: "chalk",
    label: "Sinf doskasi",
    hint: "Yashil doska, bo‘r bilan yozilgandek",
    prompt:
      "Classroom chalkboard style. Dark green chalkboard texture background with a thin wooden frame, white and pastel chalk lettering that stays perfectly legible, hand-drawn chalk diagrams and doodles.",
  },
  {
    id: "infographic",
    label: "Infografika",
    hint: "Ikonka, raqam va diagramma ko‘p",
    prompt:
      "Bold infographic style. White background, a vivid palette of indigo (#4338CA), orange (#F97316) and emerald (#10B981), flat icons, numbered badges, arrows, simple charts and diagrams, strong visual hierarchy with big numbers.",
  },
] as const;

export type ImageSlideStyle = (typeof IMAGE_SLIDE_STYLES)[number];
export type ImageSlideStyleId = ImageSlideStyle["id"];
export const DEFAULT_IMAGE_SLIDE_STYLE: ImageSlideStyleId = "clean";

export function imageSlideStyleOf(values: { slideStyle?: unknown }): ImageSlideStyle {
  const raw = typeof values.slideStyle === "string" ? values.slideStyle.trim() : "";
  return IMAGE_SLIDE_STYLES.find((s) => s.id === raw) ?? IMAGE_SLIDE_STYLES[0];
}

export const IMAGE_SLIDE_MIN = 4;
export const IMAGE_SLIDE_MAX = 30;
export const IMAGE_SLIDE_DEFAULT = 10;

/** The slide count of an order: the same clamp for the price and the engine, so they cannot disagree. */
export function imageSlideCount(values: { slideCount?: unknown }): number {
  const n = Math.round(Number(values.slideCount));
  if (!Number.isFinite(n) || n <= 0) return IMAGE_SLIDE_DEFAULT;
  return Math.min(IMAGE_SLIDE_MAX, Math.max(IMAGE_SLIDE_MIN, n));
}

/** The writer call that plans and words the whole deck (`write.ts`), with reserve. */
export const IMAGE_SLIDE_TEXT_USD = 0.03;

/** The provider cost of one order in USD, before the markup: what the price is twice of. */
export function imageSlideCostUsd(values: FormValues): number {
  return IMAGE_SLIDE_TEXT_USD + imageSlideCount(values) * imageSlideModelOf(values).usdPerSlide;
}

export type ImageSlidePricing = { soumPerUsd: number; markup: number; step: number };

/**
 * Price of one order in so'm, BEFORE the admin's «Narxlar» %: cost × markup × rate, rounded up to the step (100).
 * The server passes its live pricing block; the form passes the same block from `GET /api/media/catalog`.
 */
export function imageSlidePrice(values: FormValues, pricing: ImageSlidePricing): number {
  const step = Math.max(1, pricing.step);
  const raw = imageSlideCostUsd(values) * pricing.markup * pricing.soumPerUsd;
  return Math.ceil(raw / step) * step;
}

/** Message for a value the form cannot have sent, `null` when fine. Checked before anything is charged. */
export function imageSlideError(values: FormValues): string | null {
  const model = values.imageModel;
  if (model !== undefined && model !== null && model !== "" && !isImageSlideModelId(String(model).trim())) return "Noma’lum rasm modeli";
  const style = values.slideStyle;
  if (style !== undefined && style !== null && style !== "" && !IMAGE_SLIDE_STYLES.some((s) => s.id === String(style).trim())) {
    return "Noma’lum slayd uslubi";
  }
  const audience = values.audience;
  if (audience !== undefined && audience !== null && audience !== "" && !IMAGE_SLIDE_AUDIENCES.some((x) => x.id === String(audience).trim())) {
    return "Noma’lum auditoriya";
  }
  return null;
}

/** Who the deck is for: sets the wording, the depth and the pictures. */
export const IMAGE_SLIDE_AUDIENCES = [
  { id: "school_low", label: "1–4-sinf", prompt: "primary-school children aged 7–10: very simple words, one idea per point, friendly pictures" },
  { id: "school", label: "5–11-sinf", prompt: "school pupils aged 11–17: clear explanations, school-level terms, textbook-style figures" },
  { id: "student", label: "Talabalar", prompt: "university students: precise terms, definitions, formulas and structured analysis" },
  { id: "teacher", label: "O‘qituvchilar / ilmiy", prompt: "teachers and researchers: professional terminology, methods, evidence and conclusions" },
  { id: "business", label: "Biznes / umumiy", prompt: "a general or business audience: plain language, facts, numbers and practical takeaways" },
] as const;

export type ImageSlideAudienceId = (typeof IMAGE_SLIDE_AUDIENCES)[number]["id"];
export const DEFAULT_IMAGE_SLIDE_AUDIENCE: ImageSlideAudienceId = "school";

export function imageSlideAudienceOf(values: { audience?: unknown }) {
  const raw = typeof values.audience === "string" ? values.audience.trim() : "";
  return IMAGE_SLIDE_AUDIENCES.find((a) => a.id === raw) ?? IMAGE_SLIDE_AUDIENCES.find((a) => a.id === DEFAULT_IMAGE_SLIDE_AUDIENCE)!;
}
