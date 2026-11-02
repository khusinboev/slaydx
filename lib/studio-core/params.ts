/**
 * ParamSchema — the ONE description of a model's parameters (docs/studio/P0-SPEC.md §3.2). The form renders it, the
 * server validates and normalizes with it, the cost rule and the adapter read the normalized values. «Every param must
 * work»: each entry says what it changes (`affects`) and the differential probe test holds it to that.
 *
 * Rule kept from the existing engines (`imageModelError`, `videoParamsError`): a present but unknown value is REJECTED
 * by `validate` before anything is charged; `normalize` alone never throws and falls back to the default so pure
 * helpers (price preview, request builders) stay total.
 */

type ParamBase = {
  name: string;
  /** Uzbek label (form row, error messages). */
  label: string;
  hint?: string;
  /** Shown under the collapsed «Qo'shimcha sozlamalar». */
  advanced?: boolean;
  affects: "request" | "price" | "both";
};

export type EnumParam = ParamBase & { type: "enum"; options: readonly { value: string; label: string }[]; default: string };
export type IntParam = ParamBase & { type: "int"; min: number; max: number; step?: number; default: number };
export type NumberParam = ParamBase & { type: "number"; min: number; max: number; default: number };
export type BoolParam = ParamBase & { type: "bool"; default: boolean };
export type TextParam = ParamBase & { type: "text"; min: number; max: number; default?: string };
/** Uploaded asset ids (the host checks ownership); `min` (default 0) to `max` ids. */
export type ImageParam = ParamBase & { type: "image"; min?: number; max: number; mimes: readonly string[]; maxBytes: number };
export type VoiceParam = ParamBase & { type: "voice"; source: "catalog" | "user-clones"; default?: string };

export type ParamSchema = EnumParam | IntParam | NumberParam | BoolParam | TextParam | ImageParam | VoiceParam;

export type ParamValue = string | number | boolean | readonly string[];
export type NormalizedParams = Readonly<Record<string, ParamValue>>;

/** Asset ids are 24 lowercase hex characters (`photo_uploads.asset_id`). */
export const ASSET_ID_RE = /^[0-9a-f]{24}$/;

const isBlank = (v: unknown) => v === undefined || v === null || v === "";

/** Text as it goes out: whitespace runs collapsed, trimmed, clipped to `max` (the form keeps the text as typed). */
export function normalizeText(raw: unknown, max: number): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function intOk(p: IntParam, n: number): boolean {
  if (!Number.isInteger(n) || n < p.min || n > p.max) return false;
  return p.step ? (n - p.min) % p.step === 0 : true;
}

function boolOf(v: unknown): boolean | null {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return null;
}

function idsOf(v: unknown): string[] {
  const list = Array.isArray(v) ? v : isBlank(v) ? [] : String(v).split(",");
  return list.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
}

function normalizeOne(p: ParamSchema, raw: unknown): ParamValue {
  switch (p.type) {
    case "enum": {
      const v = typeof raw === "string" ? raw.trim() : raw;
      return p.options.some((o) => o.value === v) ? (v as string) : p.default;
    }
    case "int": {
      const n = Number(raw);
      return !isBlank(raw) && intOk(p, n) ? n : p.default;
    }
    case "number": {
      const n = Number(raw);
      return !isBlank(raw) && Number.isFinite(n) && n >= p.min && n <= p.max ? n : p.default;
    }
    case "bool":
      return boolOf(raw) ?? p.default;
    case "text": {
      const t = normalizeText(raw, p.max);
      return t || (p.default ?? "");
    }
    case "image":
      return idsOf(raw).filter((id) => ASSET_ID_RE.test(id)).slice(0, p.max);
    case "voice": {
      const v = typeof raw === "string" ? raw.trim() : "";
      return v || (p.default ?? "");
    }
  }
}

export function normalize(schema: readonly ParamSchema[], raw: Readonly<Record<string, unknown>>): NormalizedParams {
  const out: Record<string, ParamValue> = {};
  for (const p of schema) out[p.name] = normalizeOne(p, raw[p.name]);
  return out;
}

/** Uzbek message for the first parameter the server must refuse (a 400 before charging), `null` when all are fine. */
export function validate(schema: readonly ParamSchema[], raw: Readonly<Record<string, unknown>>): string | null {
  for (const p of schema) {
    const v = raw[p.name];
    switch (p.type) {
      case "enum":
        if (!isBlank(v) && !p.options.some((o) => o.value === (typeof v === "string" ? v.trim() : v))) return `${p.label}: noma'lum qiymat`;
        break;
      case "int":
        if (!isBlank(v) && !intOk(p, Number(v))) return `${p.label}: ${p.min}–${p.max} oralig'ida bo'lishi kerak`;
        break;
      case "number": {
        const n = Number(v);
        if (!isBlank(v) && !(Number.isFinite(n) && n >= p.min && n <= p.max)) return `${p.label}: ${p.min}–${p.max} oralig'ida bo'lishi kerak`;
        break;
      }
      case "bool":
        if (!isBlank(v) && boolOf(v) === null) return `${p.label}: noto'g'ri qiymat`;
        break;
      case "text":
        if (normalizeText(v, p.max).length < p.min) return `${p.label}: kamida ${p.min} ta belgi yozing`;
        break;
      case "image": {
        const ids = idsOf(v);
        if (ids.some((id) => !ASSET_ID_RE.test(id))) return `${p.label}: fayl identifikatori noto'g'ri`;
        if (ids.length > p.max) return `${p.label}: eng ko'pi ${p.max} ta`;
        if (ids.length < (p.min ?? 0)) return `${p.label}: rasm yuklang`;
        break;
      }
      case "voice":
        break;
    }
  }
  return null;
}
