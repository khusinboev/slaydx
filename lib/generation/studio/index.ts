/**
 * Studio «Rasm» engine (docs/studio/P1-SPEC.md, tool `studio-image`).
 *
 * The Studio is a core-native caller: EVERY picture is one `runMedia` call with purpose `studio.image` (router, breaker
 * health, a `media_jobs` row per picture), whatever the `media.core.image` switch says — that switch only moves the old
 * «Rasm» tool. The job itself (prompt expansion, two pictures at a time, refusal message, doc, zip / single image,
 * `delivered` for the partial refund) is «Rasm»'s own `drawImageJob`, so both tools package and refund identically.
 *
 * Input: the chosen catalog model (`modelId`) and that model's ParamSchema values, NORMALIZED here with the same schema
 * the route validated with (the route refused anything unknown before charging). An id that is not a Studio model can
 * only come from a job row written before a catalog change: it fails the job (full refund), never draws on another model.
 */
import { limitedProvider } from "../image-provider";
import { CORE_BASES, drawImageJob } from "../image-studio";
import { imageRatioById } from "../image-studio-options";
import type { ImageModelId } from "../image-models";
import { coreImageProvider } from "../../media/image";
import { IMAGE_MODEL_TO_MEDIA, MEDIA_CATALOG, STUDIO_IMAGE_PURPOSE } from "../../media/catalog";
import { isStudioImageModel, studioModelOf } from "../../media/studio-pricing";
import { normalize } from "../../studio-core";
import { UserFacingError } from "../../server/user-error";
import type { BuiltFile } from "../types";
import type { FormValues, ToolConfig } from "../../types";

/** Catalog id → the existing provider that draws it (the `rasm` providers, wrapped by the core adapter). */
const BASE_OF: Readonly<Record<string, ImageModelId>> = Object.fromEntries(
  (Object.entries(IMAGE_MODEL_TO_MEDIA) as [ImageModelId, string][]).map(([model, id]) => [id, model]),
);

export async function buildStudioImage(
  tool: ToolConfig,
  values: FormValues,
  deadline?: number,
  onStage?: (ev: { progress: number; step: string }) => void,
): Promise<BuiltFile> {
  onStage?.({ progress: 0, step: "So‘rov tayyorlanmoqda" });
  const modelId = studioModelOf(values);
  const entry = isStudioImageModel(modelId) ? MEDIA_CATALOG.byId(modelId) : null;
  const baseId = entry ? BASE_OF[entry.id] : undefined;
  if (!entry || !baseId) throw new UserFacingError("Tanlangan rasm modeli mavjud emas. Kredit qaytariladi.");
  const p = normalize(entry.params, values);
  const prompt = String(p.prompt ?? "").trim();
  if (prompt.length < 3) throw new Error("Rasm uchun tavsif yozing");
  const styleId = String(p.imageStyle);
  const ratio = imageRatioById(String(p.imageRatio));
  const count = Number(p.imageCount);
  const base = CORE_BASES[baseId];
  // Limiter OUTSIDE the core call (the «Rasm» wiring rule, lib/media/image.ts): a queue timeout never starts a row.
  const provider = limitedProvider(
    coreImageProvider(STUDIO_IMAGE_PURPOSE, entry.id, base.provider, { upstream: base.upstream, values: { prompt, imageStyle: styleId, imageRatio: ratio.id } }),
  );
  return drawImageJob({
    tool,
    values: { ...values, prompt, imageStyle: styleId, imageRatio: ratio.id, imageCount: count },
    prompt,
    styleId,
    ratio,
    count,
    provider,
    imageModel: entry.id,
    deadline,
    onStage,
  });
}
