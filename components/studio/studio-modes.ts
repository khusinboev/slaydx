import type { ClientEntry } from "@/lib/studio-core";
import { fillSkeleton, type StudioTemplate } from "@/lib/media/library";
import { PROMPT_PARAM, promptLimit, type RawValues } from "./studio-values";

/**
 * The Studio «Rasm» tab's modes (docs/studio/P2B-SPEC.md): drawing from a prompt (P1) and the P2b jobs on a picture the
 * user owns. Each mode is one catalog purpose (`lib/media/catalog.ts`); the server prices and checks the model against
 * the same purpose, so the page never decides what a mode costs.
 */
export type StudioMode = "image" | "edit" | "upscale" | "bgremove";

export const MODE_PURPOSE: Readonly<Record<StudioMode, string>> = {
  image: "studio.image",
  edit: "studio.edit",
  upscale: "studio.upscale",
  bgremove: "studio.bgremove",
};

/** The action label on a result / gallery card and the mode banner title. */
export const MODE_LABEL: Readonly<Record<Exclude<StudioMode, "image">, string>> = {
  edit: "Tahrirlash",
  upscale: "Sifatini oshirish",
  bgremove: "Fonni olib tashlash",
};

export const TOOL_MODES: readonly Exclude<StudioMode, "image">[] = ["edit", "upscale", "bgremove"];

/** The param the P2b models read their pictures from (`INPUT_IMAGES_PARAM` in the catalog). */
export const INPUT_PARAM = "inputImages";

/**
 * The raw values a template puts into the form: its preset values (the server validated them against this model's
 * ParamSchema) and the prompt built from the slot values, cut to the model's limit. Pure.
 */
export function applyTemplate(entry: ClientEntry, t: StudioTemplate, slots: Readonly<Record<string, unknown>>): RawValues {
  return { ...t.params, [PROMPT_PARAM]: fillSkeleton(t.skeleton, t.slots, slots).slice(0, promptLimit(entry)) };
}
