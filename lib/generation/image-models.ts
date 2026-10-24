/**
 * MODEL CHOICE of the `rasm` tool (program-17 item 5): «Nano Banana (Google Gemini)» or «ChatGPT (OpenAI
 * gpt-image)».
 *
 * Client-safe on purpose (no node, no server imports): the form, the price formula in `lib/tools.ts`, the
 * engine, the route and the admin ladder all read THIS file, so a model, its provider and its price exist in
 * exactly one place.
 *
 *   id        the value of the form param `model`;
 *   provider  the registry id (`lib/server/providers/registry.ts`) whose key + switch decide availability;
 *   label     the Uzbek name on the selector (and on the viewer);
 *   prices    so'm per job by image count: 1 image / 2-3 images / 4 images (the BASE price; the admin «Narxlar»
 *             page adjusts it through `tool_pricing`).
 *
 * Gemini is today's behaviour and the default: a request without `model` is a Gemini request at the old price.
 * ChatGPT is twice the Gemini price (owner default, program-17 item 5): GPT Image costs more per picture
 * (about $0.05 vs $0.034 at medium quality, `llm-pricing.ts`).
 */
export const IMAGE_MODELS = [
  { id: "gemini", provider: "gemini", label: "Nano Banana (Google Gemini)", short: "Nano Banana", prices: [2000, 3500, 6000] },
  { id: "openai", provider: "openai-image", label: "ChatGPT (OpenAI gpt-image)", short: "ChatGPT", prices: [4000, 7000, 12000] },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];
export const IMAGE_MODEL_IDS: readonly ImageModelId[] = IMAGE_MODELS.map((m) => m.id);
export const DEFAULT_IMAGE_MODEL: ImageModelId = "gemini";

export function isImageModelId(v: unknown): v is ImageModelId {
  return typeof v === "string" && (IMAGE_MODEL_IDS as readonly string[]).includes(v);
}

export function imageModelById(id: string) {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0];
}

/**
 * The model a request asks for. Absent / blank = Gemini (an older client, a saved draft). An unknown value
 * is NOT silently mapped: `imageModelError` rejects it before anything is charged.
 */
export function imageModelOf(values: { model?: unknown }): ImageModelId {
  const raw = typeof values.model === "string" ? values.model.trim() : "";
  return isImageModelId(raw) ? raw : DEFAULT_IMAGE_MODEL;
}

/** Message for a `model` value that is not in the catalogue, `null` when it is fine (or absent). */
export function imageModelError(values: { model?: unknown }): string | null {
  const raw = values.model;
  if (raw === undefined || raw === null || raw === "") return null;
  return isImageModelId(typeof raw === "string" ? raw.trim() : raw) ? null : "Noma'lum rasm modeli";
}

/** Base price of one job: `count` images drawn by `model`. */
export function imageBasePrice(model: ImageModelId, count: number): number {
  const [one, few, four] = imageModelById(model).prices;
  if (count >= 4) return four;
  if (count >= 2) return few;
  return one;
}

/**
 * The models a form may offer, given the server's list (`features.imageModels`). Absent (session not loaded,
 * an older server) = Gemini only, i.e. today's form. Order follows the catalogue; unknown ids are dropped.
 */
export function offeredImageModels(available: readonly string[] | null | undefined): ImageModelId[] {
  if (!available) return [DEFAULT_IMAGE_MODEL];
  return IMAGE_MODEL_IDS.filter((id) => available.includes(id));
}
