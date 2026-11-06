/**
 * Studio «Rasm» engine (docs/studio/P1-SPEC.md, tool `studio-image`).
 *
 * The Studio is a core-native caller: EVERY picture is one `runMedia` call with purpose `studio.image` (router, breaker
 * health, a `media_jobs` row per picture), whatever the `media.core.image` switch says — that switch only moves the old
 * «Rasm» tool. The job itself (prompt expansion, two pictures at a time, refusal message, doc, zip / single image,
 * `delivered` for the partial refund) is «Rasm»'s own `drawImageJob`, so both tools package and refund identically.
 *
 * Two kinds of Studio model: the «Rasm» two (Nano Banana, GPT Image) wrap their existing providers (`BASE_OF`); the
 * fal models (P2a, docs/studio/P2-SPEC.md) speak through the native fal adapter — no legacy provider exists for them.
 * Both are one `runMedia` call per picture under the same limiter rule.
 *
 * Input: the chosen catalog model (`modelId`) and that model's ParamSchema values, NORMALIZED here with the same schema
 * the route validated with (the route refused anything unknown before charging). An id that is not a Studio model can
 * only come from a job row written before a catalog change: it fails the job (full refund), never draws on another model.
 */
import { limitedProvider } from "../image-provider";
import { CORE_BASES, drawImageJob } from "../image-studio";
import { imageRatioById } from "../image-studio-options";
import type { ImageModelId } from "../image-models";
import { coreAdapterImageProvider, coreImageProvider } from "../../media/image";
import { FAL_ADAPTER_ID, falAdapter } from "../../media/adapters/fal";
import { IMAGE_MODEL_TO_MEDIA, MEDIA_CATALOG, STUDIO_IMAGE_PURPOSE, studioPurposeOf } from "../../media/catalog";
import { buildStudioTool, type StudioInputs } from "./edit";
import { isStudioImageModel, studioModelOf } from "../../media/studio-pricing";
import { normalize } from "../../studio-core";
import { UserFacingError } from "../../server/user-error";
import type { BuiltFile } from "../types";
import type { ImageProvider } from "../image-provider";
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
  /** P2b: the user's input pictures, resolved by the worker (`lib/server/media/inputs.ts studioInputsForJob`). */
  inputs?: StudioInputs,
): Promise<BuiltFile> {
  onStage?.({ progress: 0, step: "So‘rov tayyorlanmoqda" });
  const modelId = studioModelOf(values);
  // P2b: an edit / upscale / background-removal model runs its own job (lib/generation/studio/edit.ts).
  const purpose = studioPurposeOf(modelId);
  const toolEntry = purpose && purpose !== STUDIO_IMAGE_PURPOSE ? MEDIA_CATALOG.byId(modelId) : null;
  if (purpose && toolEntry) return buildStudioTool(tool, values, toolEntry, purpose, inputs, deadline, onStage);
  const entry = isStudioImageModel(modelId) ? MEDIA_CATALOG.byId(modelId) : null;
  const baseId = entry ? BASE_OF[entry.id] : undefined;
  const native = entry?.routes[0]?.adapter === FAL_ADAPTER_ID;
  if (!entry || (!baseId && !native)) throw new UserFacingError("Tanlangan rasm modeli mavjud emas. Pul balansingizga qaytariladi.");
  const p = normalize(entry.params, values);
  const prompt = String(p.prompt ?? "").trim();
  if (prompt.length < 3) throw new Error("Rasm uchun tavsif yozing");
  const styleId = String(p.imageStyle);
  const ratio = imageRatioById(String(p.imageRatio));
  const count = Number(p.imageCount);
  // Limiter OUTSIDE the core call (the «Rasm» wiring rule, lib/media/image.ts): a queue timeout never starts a row.
  let provider: ImageProvider;
  if (baseId) {
    const base = CORE_BASES[baseId];
    provider = limitedProvider(
      coreImageProvider(STUDIO_IMAGE_PURPOSE, entry.id, base.provider, { upstream: base.upstream, values: { prompt, imageStyle: styleId, imageRatio: ratio.id } }),
    );
  } else {
    // Every schema value but the count (one picture per call) is recorded and reaches the adapter (e.g. Ideogram's quality).
    const { imageCount: _count, ...own } = p;
    void _count;
    provider = limitedProvider(coreAdapterImageProvider(STUDIO_IMAGE_PURPOSE, entry.id, falAdapter(), { id: "fal", minMs: 8_000, values: { ...own, prompt, imageStyle: styleId, imageRatio: ratio.id } }));
  }
  return drawImageJob({
    tool,
    values: { ...values, prompt, imageStyle: styleId, imageRatio: ratio.id, imageCount: count },
    prompt,
    styleId,
    ratio,
    count,
    provider,
    imageModel: entry.id,
    // Text in the picture only for the models sold as text-capable (badge «matn»); every other model keeps the ban.
    allowText: entry.badges.includes("matn"),
    deadline,
    onStage,
  });
}
