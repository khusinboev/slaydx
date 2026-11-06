import type { ClientEntry, ParamSchema } from "@/lib/studio-core";
import { PROMPT_PARAM, requestValues, type RawValues } from "../studio-values";
import { studioPrice } from "../studio-price";
import { isEffect, studioVideoClientPrice } from "../video/video-price";
import { isAvatarModel } from "@/lib/media/catalog-video";
import type { StudioPricing } from "../studio-types";

/**
 * «Solishtirish» form model (docs/studio/P7-SPEC.md P7a) — pure, shared by the panel and its tests.
 *
 * The form is ONE prompt + the rows every ticked model has: a parameter is shared when every ticked model has it under
 * the same name and type, and there is at least one value all of them accept (an enum: the options they all list; an
 * int: the same step over the overlapping range; a number: the overlapping range; a bool: always). Every other
 * parameter of a model takes that model's own default — `requestValues` normalizes each model's request from the same
 * raw bag, so a model never receives a value it does not accept. Image params never appear: compare is prompt-only.
 */

export type CompareKind = "image" | "video";
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;
/** An int row with more common values than this is not shared (no ParamSchema int is that long; a guard, not a rule). */
const INT_VALUES_MAX = 200;

/**
 * The models a tab can compare: Rasm — its drawing catalog as is; Video — the text/image → video models, no effect and
 * no avatar (P9 HeyGen: its prompt is a script, not a scene, and its length is computed from the inputs — a shared
 * «Davomiylik» row would be decorative and the batch price would not match the server's).
 */
export function compareModels(kind: CompareKind, models: readonly ClientEntry[]): ClientEntry[] {
  return kind === "video" ? models.filter((m) => !isEffect(m) && !isAvatarModel(m.id)) : [...models];
}

/** One shared row, or `null` when the models cannot agree on a value. */
function shareOne(params: readonly ParamSchema[]): ParamSchema | null {
  const [first] = params;
  if (!first || params.some((p) => p.type !== first.type)) return null;
  const advanced = params.some((p) => p.advanced);
  switch (first.type) {
    case "enum": {
      const all = params as Extract<ParamSchema, { type: "enum" }>[];
      const options = first.options.filter((o) => all.every((p) => p.options.some((x) => x.value === o.value)));
      if (options.length === 0) return null;
      const def = options.some((o) => o.value === first.default) ? first.default : options[0]!.value;
      return { ...first, options, default: def, advanced };
    }
    case "int": {
      // The values EVERY model accepts (Omni 5 / 8 s ∩ Kling 3–15 s = 5 / 8 s): an int row when they step evenly, else
      // an enum of them (the request still carries the number: `normalize` reads "8" as 8 for an int param).
      const all = params as Extract<ParamSchema, { type: "int" }>[];
      const accepted = (p: Extract<ParamSchema, { type: "int" }>, n: number) => n >= p.min && n <= p.max && (n - p.min) % (p.step && p.step > 0 ? p.step : 1) === 0;
      const values: number[] = [];
      for (let n = first.min; n <= first.max && values.length <= INT_VALUES_MAX; n += first.step && first.step > 0 ? first.step : 1) {
        if (all.every((p) => accepted(p, n))) values.push(n);
      }
      if (values.length === 0 || values.length > INT_VALUES_MAX) return null;
      const def = values.includes(first.default) ? first.default : values[0]!;
      const step = values.length > 1 ? values[1]! - values[0]! : 1;
      const even = values.every((n, i) => i === 0 || n - values[i - 1]! === step);
      if (even) return { ...first, min: values[0]!, max: values.at(-1)!, step, default: def, advanced };
      return { name: first.name, label: first.label, hint: first.hint, affects: first.affects, type: "enum", options: values.map((n) => ({ value: String(n), label: String(n) })), default: String(def), advanced };
    }
    case "number": {
      const all = params as Extract<ParamSchema, { type: "number" }>[];
      const min = Math.max(...all.map((p) => p.min));
      const max = Math.min(...all.map((p) => p.max));
      if (min > max) return null;
      return { ...first, min, max, default: Math.min(max, Math.max(min, first.default)), advanced };
    }
    case "bool":
      return { ...first, advanced };
    case "text": {
      // Only the prompt is shared (one prompt for every model); any other text param keeps each model's default.
      if (first.name !== PROMPT_PARAM) return null;
      const all = params as Extract<ParamSchema, { type: "text" }>[];
      return { ...first, min: Math.max(...all.map((p) => p.min)), max: Math.min(...all.map((p) => p.max)), advanced };
    }
    default:
      return null;
  }
}

/** The rows of the compare form for the ticked models, in the first model's order (the prompt included). */
export function sharedParams(entries: readonly ClientEntry[]): ParamSchema[] {
  const [first] = entries;
  if (!first) return [];
  const out: ParamSchema[] = [];
  for (const p of first.params) {
    const same = entries.map((e) => e.params.find((x) => x.name === p.name));
    if (same.some((x) => !x)) continue;
    const shared = shareOne(same as ParamSchema[]);
    if (shared) out.push(shared);
  }
  return out;
}

/**
 * P11 §D: the params of one ticked model the compare form does NOT ask for — it lacks a shared row for them, so that
 * model runs them at its own default (images aside: compare is prompt-only, and the prompt is always shared).
 */
export function droppedParams(entry: ClientEntry, shared: readonly ParamSchema[]): ParamSchema[] {
  const names = new Set(shared.map((p) => p.name));
  return entry.params.filter((p) => p.type !== "image" && p.name !== PROMPT_PARAM && !names.has(p.name));
}

/** «Sifat, Ovoz — o‘z standartida»: the line under a ticked model naming what it runs at its own default; `null` when nothing. */
export function droppedLine(entry: ClientEntry, shared: readonly ParamSchema[]): string | null {
  const dropped = droppedParams(entry, shared);
  return dropped.length ? `${dropped.map((p) => p.label).join(", ")} — o‘z standartida` : null;
}

/**
 * The entry the shared rows are drawn from: the first ticked model with only the shared params (the prompt box and
 * `ParamRows` read it exactly as they read a real model).
 */
export function sharedEntry(entries: readonly ClientEntry[]): ClientEntry | null {
  const [first] = entries;
  return first ? { ...first, params: sharedParams(entries) } : null;
}

/**
 * Each model's request: `{ modelId }` + its OWN ParamSchema normalized from the SHARED values only — a value of a row
 * that is not shared (left in the bag from the tab's form) never reaches a model; it takes its own default there.
 */
export function memberValues(entry: ClientEntry, raw: RawValues, shared: readonly ParamSchema[]): Record<string, unknown> {
  const bag: RawValues = {};
  for (const p of shared) if (p.name in raw) bag[p.name] = raw[p.name];
  return requestValues(entry, bag);
}

/** The price of one model's job: the same functions the tab's own button uses (no compare rule). */
export function memberPrice(kind: CompareKind, entry: ClientEntry, values: Readonly<Record<string, unknown>>, pricing: StudioPricing): number {
  return kind === "video" ? studioVideoClientPrice(entry, values, pricing) : studioPrice(entry, values, pricing);
}

/** The batch as the request sends it: each ticked model with its values and its own shown price, plus the plain sum. */
export function compareBatch(
  kind: CompareKind,
  entries: readonly ClientEntry[],
  raw: RawValues,
  pricing: StudioPricing,
): { members: { entry: ClientEntry; values: Record<string, unknown>; price: number }[]; total: number } {
  const shared = sharedParams(entries);
  const members = entries.map((entry) => {
    const values = memberValues(entry, raw, shared);
    return { entry, values, price: memberPrice(kind, entry, values, pricing) };
  });
  return { members, total: members.reduce((s, m) => s + m.price, 0) };
}

/** «Solishtirish · 3 model · ~12 400 so'm» (just «Solishtirish» while fewer than two models are ticked). */
export function compareLabel(count: number, total: number | null, format: (n: number) => string): string {
  return count < COMPARE_MIN || total === null ? "Solishtirish" : `Solishtirish · ${count} model · ~${format(total)}`;
}

/** The batch cap the session allows (`features.compareMax`: the per-user in-flight cap), never above `COMPARE_MAX`. */
export function compareCap(fromSession: number | undefined): number {
  return typeof fromSession === "number" && Number.isFinite(fromSession) ? Math.max(0, Math.min(COMPARE_MAX, Math.floor(fromSession))) : COMPARE_MAX;
}

/** Ticking a model: on (up to the cap, in tick order) or off. */
export function toggleModel(ticked: readonly string[], id: string, max: number = COMPARE_MAX): string[] {
  if (ticked.includes(id)) return ticked.filter((x) => x !== id);
  return ticked.length >= max ? [...ticked] : [...ticked, id];
}
