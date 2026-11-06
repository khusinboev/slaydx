import type { ClientEntry, ParamSchema } from "@/lib/studio-core";
import { groupDigits } from "@/lib/format";
import { BADGE_LABEL, FILTER_BADGES } from "./studio-price";

/**
 * ModelSpecs (docs/studio/P11-SPEC.md §D): what a model card says about a model — the longest length, the best quality,
 * the count, sound, the frames it takes, what it does — DERIVED from the catalog entry's ParamSchema and capabilities, the
 * very schema the form is generated from. A card can therefore never promise what the form does not offer: a «15 s gacha»
 * is the `seconds` param's `max`, a «1080p» the top option of `resolution`, an «oxirgi kadr» the `endImageAssetId` param.
 * Pure, no React: the picker, the compare panel and the tests share it.
 */

type Enum = Extract<ParamSchema, { type: "enum" }>;

const param = <T extends ParamSchema["type"]>(entry: Pick<ClientEntry, "params">, name: string, type: T) =>
  entry.params.find((p): p is Extract<ParamSchema, { type: T }> => p.name === name && p.type === type);

/** The leading number of an option value («1080p» → 1080, «768p» → 768), `null` when it has none. */
function leadingNumber(v: string): number | null {
  const m = /^(\d+(?:\.\d+)?)/.exec(v);
  return m ? Number(m[1]) : null;
}

/** The option with the largest leading number, else the last one (options are listed from plain to best). */
function topOption(p: Enum): Enum["options"][number] | null {
  if (p.options.length === 0) return null;
  const numeric = p.options.map((o) => ({ o, n: leadingNumber(o.value) }));
  if (numeric.every((x) => x.n !== null)) return numeric.reduce((a, b) => (b.n! > a.n! ? b : a)).o;
  return p.options[p.options.length - 1]!;
}

/** «15 s» / «3 daq» — a length in seconds, as the music lengths are labelled. */
export function lengthText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return seconds % 60 === 0 ? `${seconds / 60} daq` : `${Math.floor(seconds / 60)},5 daq`;
}

/** The longest output the model makes, from its length param; `null` for a model without one. */
export function longestText(entry: Pick<ClientEntry, "params">): string | null {
  const seconds = param(entry, "seconds", "int") ?? param(entry, "duration", "int");
  if (seconds) return `${lengthText(seconds.max)} gacha`;
  const length = param(entry, "length", "enum");
  if (length) {
    const top = topOption(length);
    if (!top) return null;
    const n = leadingNumber(top.value);
    return n !== null ? `${lengthText(n)} gacha` : top.label;
  }
  return null;
}

/** The best quality the model offers («1080p», «Yuqori»), `null` without a quality param. */
export function qualityText(entry: Pick<ClientEntry, "params">): string | null {
  const resolution = param(entry, "resolution", "enum");
  if (resolution) {
    const top = topOption(resolution);
    if (!top) return null;
    const n = leadingNumber(top.value);
    return n !== null ? `${n}p` : top.label;
  }
  const quality = param(entry, "quality", "enum");
  if (quality) return topOption(quality)?.label ?? null;
  const factor = param(entry, "factor", "enum");
  if (factor) return topOption(factor)?.label ?? null;
  return null;
}

/** Filter flags a chip can narrow by, besides the badges. */
export type SpecFlag = "sound" | "end-frame" | "start-image";
export const SPEC_FLAG_LABEL: Readonly<Record<SpecFlag, string>> = { sound: "Ovozli", "end-frame": "Oxirgi kadr", "start-image": "Suratdan" };
const SPEC_FLAGS: readonly SpecFlag[] = ["sound", "end-frame", "start-image"];

export function hasFlag(entry: Pick<ClientEntry, "params" | "badges">, flag: SpecFlag): boolean {
  switch (flag) {
    case "sound":
      return entry.params.some((p) => p.name === "sound" && p.type === "bool") || entry.badges.includes("ovozli");
    case "end-frame":
      return entry.params.some((p) => p.name === "endImageAssetId" && p.type === "image");
    case "start-image":
      return entry.params.some((p) => p.name === "imageAssetId" && p.type === "image");
  }
}

const CAPABILITY_TEXT: Readonly<Partial<Record<ClientEntry["capabilities"][number], string>>> = {
  dialogue: "suhbat",
  clone: "klon ovoz",
  stt: "matnga",
  dub: "dublyaj",
  lipsync: "avatar",
  edit: "tahrir",
  upscale: "kattalashtirish",
  "bg-remove": "fon olib tashlanadi",
};

/**
 * The spec words of a model, in card order: length, quality, count, sound, frames, what it does, the text limit of a
 * speech model. Each comes from one schema param or capability (see the file header); nothing is written by hand per model.
 */
export function modelSpecs(entry: Pick<ClientEntry, "params" | "capabilities" | "badges" | "kind">): string[] {
  const out: string[] = [];
  const longest = longestText(entry);
  if (longest) out.push(longest);
  const quality = qualityText(entry);
  if (quality) out.push(quality);
  const count = param(entry, "imageCount", "int") ?? param(entry, "variants", "int");
  if (count && count.max > 1) out.push(count.name === "variants" ? `${count.max} variantgacha` : `${count.max} tagacha`);
  if (hasFlag(entry, "sound")) out.push(param(entry, "sound", "bool")?.default === true ? "ovoz bilan" : "ovozli");
  if (hasFlag(entry, "start-image")) out.push("suratdan");
  if (hasFlag(entry, "end-frame")) out.push("oxirgi kadr");
  for (const c of entry.capabilities) {
    const t = CAPABILITY_TEXT[c];
    if (t && !out.includes(t)) out.push(t);
  }
  if (entry.kind === "speech") {
    const text = entry.params.find((p): p is Extract<ParamSchema, { type: "text" }> => p.type === "text" && (p.name === "text" || p.name === "script"));
    if (text) out.push(`${groupDigits(text.max)} belgigacha`);
  }
  return out;
}

/** The filter chips the sheet draws for `models`: a badge or a flag only when some model carries it and not every one does. */
export function specChips(models: readonly Pick<ClientEntry, "params" | "badges">[]): { id: string; label: string; test: (m: Pick<ClientEntry, "params" | "badges">) => boolean }[] {
  const chips: { id: string; label: string; test: (m: Pick<ClientEntry, "params" | "badges">) => boolean }[] = [];
  for (const b of FILTER_BADGES) chips.push({ id: b, label: BADGE_LABEL[b], test: (m) => m.badges.includes(b) });
  for (const f of SPEC_FLAGS) chips.push({ id: f, label: SPEC_FLAG_LABEL[f], test: (m) => hasFlag(m, f) });
  return chips.filter((c) => models.some(c.test) && !models.every(c.test));
}

/** The card's second line: the maker and the specs, in one row. */
export function specLine(entry: Pick<ClientEntry, "params" | "capabilities" | "badges" | "kind" | "maker">): string {
  return [entry.maker, ...modelSpecs(entry)].filter(Boolean).join(" · ");
}
