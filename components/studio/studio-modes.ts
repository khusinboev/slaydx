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

/** One mode's form: its model and values. */
export type RasmForm = { chosen: string | null; raw: RawValues };
/**
 * The «Rasm» tab's form state, one form per mode: each mode reads its own catalog, so a mode's model and settings mean
 * nothing to another, and neither is lost by visiting one.
 */
export type RasmState = { mode: StudioMode; forms: Partial<Record<StudioMode, RasmForm>> };
export const INITIAL_RASM: RasmState = { mode: "image", forms: {} };
const EMPTY_FORM: RasmForm = { chosen: null, raw: {} };

export const rasmForm = (s: RasmState, mode: StudioMode = s.mode): RasmForm => s.forms[mode] ?? EMPTY_FORM;

/** `s` with the form of the mode on screen changed. Pure. */
export function patchRasmForm(s: RasmState, change: (f: RasmForm) => RasmForm): RasmState {
  return { ...s, forms: { ...s.forms, [s.mode]: change(rasmForm(s)) } };
}

/**
 * The tab after switching to `next`: that mode's own form comes back with the given picture, and the form being left
 * stays as it was. `keepPrompt` («Rasm yuklash» only): the text typed so far is the edit instruction. From a result card
 * the edit's instruction is its own (the old prompt described the picture, it is not an edit). Coming back to drawing
 * with nothing of its own, the text on screen moves along. Pure.
 */
export function enterRasmMode(s: RasmState, next: StudioMode, assetId?: string, keepPrompt = false): RasmState {
  const typed = rasmForm(s).raw[PROMPT_PARAM];
  const form = rasmForm(s, next);
  const raw = { ...form.raw };
  if (next !== "image" && (assetId || !raw[INPUT_PARAM])) raw[INPUT_PARAM] = assetId ? [assetId] : [];
  const carries = next === "image" ? !raw[PROMPT_PARAM] : next === "edit" && keepPrompt;
  if (carries && typeof typed === "string") raw[PROMPT_PARAM] = typed;
  return { mode: next, forms: { ...s.forms, [next]: { ...form, raw } } };
}
