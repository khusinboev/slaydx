/**
 * Studio prompt library + templates (docs/studio/PLAN.md §5.6, docs/studio/P2B-SPEC.md, docs/studio/P11-SPEC.md package G) —
 * the shared rules the server (public reads, admin writes) and the browser (sheet, template card) both use. Client-safe, pure.
 *
 *   library item  a curated prompt by category; tapping it fills the prompt box.
 *   template      a Studio model + preset values of THAT model's ParamSchema + a prompt skeleton with `{slot}`
 *                 placeholders; each slot is a labelled input. Tapping it picks the model, applies the values and
 *                 builds the prompt from the slots (`fillSkeleton`). A picture template is bound to its model; a clip
 *                 template only suggests one and applies to the model on screen when that one is off.
 *
 * A template is valid only against the live catalog (`templateError`): its model is a Studio model of its kind, its preset
 * values pass the model's own `validate` (an unknown ratio / style / count is refused, never mapped), it presets no
 * prompt, and its skeleton uses exactly the declared slots. The admin cannot save an invalid one; the public read
 * hides one that became invalid (catalog change) or whose model is unavailable right now.
 */
import { validate, type ClientEntry, type ParamSchema } from "../studio-core";

export const LIBRARY_CATEGORIES = [
  { id: "portret", label: "Portret" },
  { id: "mahsulot", label: "Mahsulot" },
  { id: "logo", label: "Logo" },
  { id: "plakat", label: "Plakat" },
  { id: "tabriknoma", label: "Tabriknoma" },
  { id: "talim", label: "Ta'lim" },
  { id: "reklama", label: "Reklama" },
  { id: "tabiat", label: "Tabiat" },
  { id: "arxitektura", label: "Arxitektura" },
  { id: "illyustratsiya", label: "Illyustratsiya" },
] as const;

/**
 * What a library row is for (docs/studio/P11-SPEC.md, package G): the box it opens from. Prompts exist for all four kinds;
 * templates for pictures and clips only (a music or effect job has no preset worth a template).
 */
export const LIBRARY_MEDIA = ["image", "video", "music", "sfx"] as const;
export type LibraryMedia = (typeof LIBRARY_MEDIA)[number];
export const TEMPLATE_MEDIA = ["image", "video"] as const;
export type TemplateMedia = (typeof TEMPLATE_MEDIA)[number];

export const isLibraryMedia = (v: unknown): v is LibraryMedia => (LIBRARY_MEDIA as readonly unknown[]).includes(v);
export const isTemplateMedia = (v: unknown): v is TemplateMedia => (TEMPLATE_MEDIA as readonly unknown[]).includes(v);

export const MEDIA_LABEL: Readonly<Record<LibraryMedia, string>> = { image: "Rasm", video: "Video", music: "Musiqa", sfx: "Effekt" };

/** The chips of each kind's sheet, in display order. An id means the same thing in every kind that uses it. */
const CATEGORIES: Readonly<Record<LibraryMedia, readonly { id: string; label: string }[]>> = {
  image: LIBRARY_CATEGORIES,
  video: [
    { id: "reklama", label: "Reklama" },
    { id: "tabrik", label: "Tabrik" },
    { id: "talim", label: "Ta'lim" },
    { id: "tabiat", label: "Tabiat" },
    { id: "sayohat", label: "Sayohat" },
    { id: "shahar", label: "Shahar va madaniyat" },
  ],
  music: [
    { id: "fon", label: "Fon musiqasi" },
    { id: "reklama", label: "Reklama" },
    { id: "milliy", label: "Milliy" },
  ],
  sfx: [
    { id: "tabiat", label: "Tabiat" },
    { id: "shahar", label: "Shahar va madaniyat" },
    { id: "interfeys", label: "Interfeys" },
  ],
};

export const categoriesOf = (media: LibraryMedia): readonly { id: string; label: string }[] => CATEGORIES[media];

export const isLibraryCategory = (v: unknown, media: LibraryMedia = "image"): boolean => typeof v === "string" && CATEGORIES[media].some((c) => c.id === v);

export function categoryLabel(id: string): string {
  return LIBRARY_MEDIA.flatMap((m) => CATEGORIES[m]).find((c) => c.id === id)?.label ?? id;
}

/** Field limits (the migration's CHECKs say the same). */
export const LIBRARY_LIMITS = { title: 80, prompt: 500, slots: 6, slotLabel: 40, slotPlaceholder: 80, slotMaxMin: 10, slotMaxMax: 200 } as const;

export type TemplateSlot = {
  /** `{name}` in the skeleton: lowercase latin, digits, `_`. */
  name: string;
  /** Uzbek label of the input. */
  label: string;
  placeholder?: string;
  /** Longest value (characters). */
  max: number;
  /**
   * The value of a slot left empty, in the language of the skeleton (English). `placeholder` is what the input shows the
   * user (Uzbek); without a `fallback` an empty slot takes the placeholder.
   */
  fallback?: string;
};

/** Public library item (`GET /api/media/library`). */
export type LibraryItem = { id: string; media: LibraryMedia; category: string; title: string; prompt: string; previewUrl: string | null };

/** Public template (`GET /api/media/templates`). */
export type StudioTemplate = {
  id: string;
  media: TemplateMedia;
  category: string;
  title: string;
  /** A picture template's model, always offered; a clip's SUGGESTED model, replaced by the page when it is off. */
  modelId: string;
  /** Preset values of the model's ParamSchema (never `prompt`). */
  params: Record<string, unknown>;
  skeleton: string;
  slots: TemplateSlot[];
  previewUrl: string | null;
};

export const SLOT_NAME_RE = /^[a-z][a-z0-9_]{0,23}$/;
const SLOT_IN_TEXT = /\{([a-z][a-z0-9_]{0,23})\}/g;

/** The slot names a skeleton uses, in first-use order, each once. */
export function skeletonSlots(skeleton: string): string[] {
  const out: string[] = [];
  for (const m of String(skeleton ?? "").matchAll(SLOT_IN_TEXT)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** A slot value as it goes into the prompt: whitespace collapsed, braces removed (no slot injection), clipped. */
export function slotValue(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * The prompt of a template: every `{slot}` replaced by its value (`slotValue`); an empty slot falls back to its
 * `fallback`, then its placeholder, else to nothing (then the doubled spaces / dangling commas are tidied). Pure.
 */
export function fillSkeleton(skeleton: string, slots: readonly TemplateSlot[], values: Readonly<Record<string, unknown>>): string {
  const byName = new Map(slots.map((s) => [s.name, s]));
  const filled = String(skeleton ?? "").replace(SLOT_IN_TEXT, (whole, name: string) => {
    const slot = byName.get(name);
    if (!slot) return whole;
    return slotValue(values[name], slot.max) || slotValue(slot.fallback, slot.max) || slotValue(slot.placeholder, slot.max);
  });
  return filled
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    // An empty slot at an end leaves a dangling separator («qahva reklamasi,»).
    .replace(/^[,;:\s]+|[,;:\s]+$/g, "");
}

/** Uzbek reason the slot list is not acceptable, `null` when it is. */
export function slotsError(raw: unknown): string | null {
  if (!Array.isArray(raw)) return "Slotlar ro'yxat bo'lishi kerak";
  if (raw.length > LIBRARY_LIMITS.slots) return `Slotlar ${LIBRARY_LIMITS.slots} tadan ko'p bo'lmasin`;
  const seen = new Set<string>();
  for (const s of raw) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return "Slot {name, label, max} bo'lishi kerak";
    const o = s as Record<string, unknown>;
    if (typeof o.name !== "string" || !SLOT_NAME_RE.test(o.name)) return `Slot nomi noto'g'ri: ${String(o.name)} (kichik lotin harflari, raqam, _)`;
    if (seen.has(o.name)) return `Slot takrorlangan: ${o.name}`;
    seen.add(o.name);
    if (typeof o.label !== "string" || !o.label.trim() || o.label.length > LIBRARY_LIMITS.slotLabel) return `«${o.name}» slotining yorlig'i 1–${LIBRARY_LIMITS.slotLabel} belgi bo'lsin`;
    if (o.placeholder !== undefined && o.placeholder !== null && (typeof o.placeholder !== "string" || o.placeholder.length > LIBRARY_LIMITS.slotPlaceholder)) return `«${o.name}» namunasi ${LIBRARY_LIMITS.slotPlaceholder} belgidan oshmasin`;
    if (o.fallback !== undefined && o.fallback !== null && (typeof o.fallback !== "string" || o.fallback.length > LIBRARY_LIMITS.slotPlaceholder)) return `«${o.name}» zaxira qiymati ${LIBRARY_LIMITS.slotPlaceholder} belgidan oshmasin`;
    if (!Number.isInteger(o.max) || (o.max as number) < LIBRARY_LIMITS.slotMaxMin || (o.max as number) > LIBRARY_LIMITS.slotMaxMax) return `«${o.name}» uzunligi ${LIBRARY_LIMITS.slotMaxMin}–${LIBRARY_LIMITS.slotMaxMax} bo'lsin`;
  }
  return null;
}

/** The slot list in its stored shape (call after `slotsError` is `null`). */
export function cleanSlots(raw: readonly Record<string, unknown>[]): TemplateSlot[] {
  return raw.map((o) => ({
    name: String(o.name),
    label: String(o.label).trim(),
    ...(typeof o.placeholder === "string" && o.placeholder.trim() ? { placeholder: o.placeholder.trim() } : {}),
    max: Number(o.max),
    ...(typeof o.fallback === "string" && o.fallback.trim() ? { fallback: o.fallback.trim() } : {}),
  }));
}

/** The part of a catalog entry a template is checked against (the browser has it as the catalog's client view). */
export type TemplateModel = Pick<ClientEntry, "id" | "params">;

/**
 * Uzbek reason a template must be refused against the catalog model `model` (`null` = valid): unknown model, a preset
 * key the model does not have (or `prompt`), a value its ParamSchema refuses, a skeleton slot without a declaration
 * or a declared slot the skeleton never uses, a prompt (skeleton at its placeholders) under the model's minimum or
 * over its maximum length.
 */
export function templateError(
  t: { modelId: string; params: unknown; skeleton: string; slots: unknown },
  model: TemplateModel | null,
): string | null {
  if (!model) return "Shablon modeli Studio'da yo'q";
  if (!t.params || typeof t.params !== "object" || Array.isArray(t.params)) return "Parametrlar obyekt bo'lishi kerak";
  const params = t.params as Record<string, unknown>;
  const names = new Set(model.params.map((p: ParamSchema) => p.name));
  for (const k of Object.keys(params)) {
    if (k === "prompt") return "Prompt parametrlarda emas, skeletda yoziladi";
    if (!names.has(k)) return `«${k}» parametri bu modelda yo'q`;
    // A preset picture would be somebody else's upload.
    if (model.params.find((p) => p.name === k)?.type === "image") return "Surat shablonda oldindan belgilanmaydi";
  }
  const onlyGiven = model.params.filter((p) => p.name in params);
  const bad = validate(onlyGiven, params);
  if (bad) return bad;
  const err = slotsError(t.slots);
  if (err) return err;
  const slots = cleanSlots(t.slots as Record<string, unknown>[]);
  // A brace that is not a well-formed `{slot}` (`{Ism}`, `{ism`, `{}`) would reach the model as literal text (review NIT-6).
  if (/[{}]/.test(String(t.skeleton).replace(/\{[a-z][a-z0-9_]{0,23}\}/g, ""))) return "Skeletda noto'g'ri {…} belgisi — slot nomi kichik lotin harflari, raqam va _ bo'lsin";
  const used = skeletonSlots(t.skeleton);
  for (const u of used) if (!slots.some((s) => s.name === u)) return `Skeletdagi {${u}} slot sifatida e'lon qilinmagan`;
  for (const s of slots) if (!used.includes(s.name)) return `«${s.name}» sloti skeletda ishlatilmagan`;
  const prompt = model.params.find((p) => p.name === "prompt");
  if (prompt?.type === "text") {
    const sample = fillSkeleton(t.skeleton, slots, {});
    if (sample.length < prompt.min) return `Skelet juda qisqa (kamida ${prompt.min} belgi)`;
    const longest = fillSkeleton(t.skeleton, slots, Object.fromEntries(slots.map((s) => [s.name, "x".repeat(s.max)])));
    if (longest.length > prompt.max) return `Skelet slotlar bilan ${prompt.max} belgidan oshib ketadi`;
  }
  return null;
}
