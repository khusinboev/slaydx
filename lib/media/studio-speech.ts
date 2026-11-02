/**
 * Studio «Ovoz» tab rules (docs/studio/P5-SPEC.md), shared by the browser and the server — ONE place for the price, the
 * request check and the dialogue script grammar, so the preview, the 400 before charging and the worker agree.
 *
 * Price (owner 2026-11-02): speech = provider cost (characters × the model's per-1 000 rate) × `media.markup` (the
 * model's admin override wins), rounded UP to 100 so'm — `studioEntryPrice`, the Rasm / Video tabs' function — then the
 * tool's `tool_pricing` %. A voice clone is a FIXED price: the `studio.clone_price` setting (default 5 000 so'm), then
 * the clone tool's `tool_pricing` %. Speaking with a clone costs the normal ElevenLabs price.
 *
 * Client-safe: no server imports.
 */
import { normalize, validate, type CatalogEntry } from "../studio-core";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "./catalog";
import {
  CLONE_VOICE_PREFIX,
  ELEVENLABS_VOICES,
  GEMINI_VOICES,
  SPEECH_CHARS_PER_SECOND,
  STUDIO_SPEECH_PURPOSE,
  cloneIdOf,
  voiceParamsOf,
} from "./catalog-speech";
import { studioEntryPrice, type MediaPricing, type PricedEntry } from "./studio-pricing";

/** Owner decision 2026-11-02: one clone costs 5 000 so'm (admin setting `studio.clone_price`). */
export const STUDIO_CLONE_PRICE_DEFAULT = 5_000;
export const STUDIO_CLONE_PRICE_MAX = 1_000_000;

/** The exact consent text the checkbox shows and the clone row stores (a new wording = a new version here). */
export const CLONE_CONSENT_TEXT = "Bu ovozdan foydalanishga haqqim bor: bu mening ovozim yoki egasining yozma roziligi bor.";
export const CLONE_CONSENT_VERSION = "2026-11-02";

/** Sample length the clone accepts (seconds): the canvas «30 s yozuv»; ElevenLabs advises 1–2 minutes of clean speech. */
export const CLONE_SAMPLE_MIN_SECONDS = 30;
export const CLONE_SAMPLE_MAX_SECONDS = 180;
/** Largest sample file: 3 min of 16-bit mono WAV at 24 kHz is 8.6 MB; an MP3 is far smaller. */
export const CLONE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024;
/** Clone unused this many days is deleted by housekeeping; the owner is warned `CLONE_WARN_DAYS` before. */
export const CLONE_UNUSED_DAYS = 30;
export const CLONE_WARN_DAYS = 3;

/** The model a speech form asks for: blank = the purpose default; anything else verbatim. */
export function studioSpeechModelOf(values: { modelId?: unknown }): string {
  const raw = typeof values.modelId === "string" ? values.modelId.trim() : "";
  return raw || MEDIA_PURPOSES.byId(STUDIO_SPEECH_PURPOSE)!.default;
}

export function isStudioSpeechModel(id: string): boolean {
  return MEDIA_PURPOSES.byId(STUDIO_SPEECH_PURPOSE)!.allowed.includes(id);
}

export function studioSpeechEntry(values: { modelId?: unknown }): CatalogEntry | null {
  const id = studioSpeechModelOf(values);
  return isStudioSpeechModel(id) ? MEDIA_CATALOG.byId(id) : null;
}

/** Base price (so'm) of a speech job; `null` for a model the tab does not sell (the route refuses it first). */
export function studioSpeechPrice(values: Readonly<Record<string, unknown>>, pricing: MediaPricing): number | null {
  const entry = studioSpeechEntry(values);
  return entry ? studioEntryPrice(entry, values, pricing) : null;
}

/** The same formula for an entry the browser holds (the catalog endpoint's client view). */
export function speechEntryPrice(entry: PricedEntry, values: Readonly<Record<string, unknown>>, pricing: MediaPricing): number {
  return studioEntryPrice(entry, values, pricing);
}

/** The clone price from the setting (an invalid number falls back to the default; never 0). */
export function clonePriceOf(setting: unknown): number {
  return typeof setting === "number" && Number.isInteger(setting) && setting >= 100 && setting <= STUDIO_CLONE_PRICE_MAX ? setting : STUDIO_CLONE_PRICE_DEFAULT;
}

/** The text param a model speaks (`text` or the dialogue `script`). */
export function speechTextParam(entry: Pick<CatalogEntry, "params">): string {
  return entry.params.some((p) => p.name === "script") ? "script" : "text";
}

/** Longest spoken text of a model (the text param's `max`). */
export function spokenMax(entry: Pick<CatalogEntry, "params">): number {
  const p = entry.params.find((x) => x.name === speechTextParam(entry));
  return p && p.type === "text" ? p.max : 0;
}

/**
 * Review M1: the spoken text (whitespace runs collapsed, as it is priced) is longer than the model takes → the Uzbek
 * reason; `null` when it fits. The server refuses it before charging and the engine re-checks: what is priced is
 * exactly what is spoken.
 */
export function spokenOverLimit(entry: Pick<CatalogEntry, "params">, values: Readonly<Record<string, unknown>>): string | null {
  const max = spokenMax(entry);
  const len = String(values[speechTextParam(entry)] ?? "").replace(/\s+/g, " ").trim().length;
  return max > 0 && len > max ? `Matn juda uzun: eng ko‘pi ${max.toLocaleString("en-US").replace(/,/g, " ")} belgi (hozir ${len}).` : null;
}

/** «~N s»: the estimated audio length of `chars` characters (at least 1 s for any text). */
export function estimatedSeconds(chars: number): number {
  return chars > 0 ? Math.max(1, Math.round(chars / SPEECH_CHARS_PER_SECOND)) : 0;
}

/* ───────────────────────── dialogue script ───────────────────────── */

export type DialogueTurn = { speaker: 0 | 1; text: string };
export type Dialogue = { speakers: [string, string]; turns: DialogueTurn[] };

const SPEAKER_RE = /^\s*([^:\[\]\n]{1,24}?)\s*:\s*(.*)$/;

/**
 * The dialogue grammar: one turn per line, «Ism: gap». A line without «Ism:» continues the previous speaker's turn.
 * Exactly two speakers (both providers' two-voice shape); their order of first appearance maps them to `voice1` /
 * `voice2`. Returns the Uzbek reason when the script cannot be spoken.
 */
export function parseDialogue(raw: unknown): Dialogue | string {
  const lines = String(raw ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const names: string[] = [];
  const turns: { speaker: number; text: string }[] = [];
  for (const line of lines) {
    const m = SPEAKER_RE.exec(line);
    const name = m && m[1]!.trim().split(/\s+/).length <= 3 ? m[1]!.trim() : null;
    if (name && m) {
      const key = name.toLowerCase();
      let idx = names.findIndex((n) => n.toLowerCase() === key);
      if (idx < 0) {
        names.push(name);
        idx = names.length - 1;
      }
      const text = m[2]!.trim();
      turns.push({ speaker: idx, text });
    } else {
      const last = turns[turns.length - 1];
      if (!last) return "Har qatorni «Ism: gap» shaklida yozing (masalan «Ali: Salom!»).";
      last.text = last.text ? `${last.text} ${line}` : line;
    }
  }
  if (names.length < 2) return "Suhbat uchun ikki kishi kerak: «Ali: …» va «Vali: …» qatorlari.";
  if (names.length > 2) return "Suhbatda faqat ikki kishi bo‘lishi mumkin.";
  const spoken = turns.filter((t) => t.text.length > 0);
  if (spoken.length < 2) return "Har bir kishining gapini yozing.";
  return { speakers: [names[0]!, names[1]!], turns: spoken.map((t) => ({ speaker: t.speaker as 0 | 1, text: t.text })) };
}

/* ───────────────────────── request check ───────────────────────── */

const ELEVEN_IDS = new Set(ELEVENLABS_VOICES.map((v) => v.id));
const GEMINI_IDS = new Set(GEMINI_VOICES.map((v) => v.id));

/** The voice values of a request that name the user's clones (`studio_voices.id`), for the server's ownership check. */
export function cloneIdsOf(entry: Pick<CatalogEntry, "params">, values: Readonly<Record<string, unknown>>): string[] {
  return [...new Set(voiceParamsOf(entry).map((n) => cloneIdOf(values[n])).filter((x): x is string => x !== null))];
}

/**
 * Why the server must refuse a speech request BEFORE charging (Uzbek, a 400), `null` when it is fine: an unknown model,
 * a value its ParamSchema rejects, an unknown library voice, a malformed clone reference, a dialogue that does not
 * parse. Whether a clone exists and is the user's own is the server's SQL check (`cloneIdsOf`); availability now too.
 */
export function studioSpeechError(values: Readonly<Record<string, unknown>>): string | null {
  const entry = studioSpeechEntry(values);
  if (!entry) return "Noma'lum ovoz modeli — boshqa modelni tanlang.";
  const bad = validate(entry.params, values);
  if (bad) return bad;
  // Review M1: the price and what is spoken are the same text — a text longer than the model takes is refused, never cut.
  const over = spokenOverLimit(entry, values);
  if (over) return over;
  const p = normalize(entry.params, values);
  const eleven = entry.id.startsWith("elevenlabs/");
  for (const name of voiceParamsOf(entry)) {
    const v = String(values[name] ?? "").trim() || String(p[name] ?? "");
    if (eleven ? !(ELEVEN_IDS.has(v) || cloneIdOf(v)) : !GEMINI_IDS.has(v)) {
      return v.startsWith(CLONE_VOICE_PREFIX) ? "Tanlangan ovoz topilmadi — qayta tanlang." : "Noma'lum ovoz — ro‘yxatdan tanlang.";
    }
  }
  if (speechTextParam(entry) === "script") {
    const d = parseDialogue(values.script);
    if (typeof d === "string") return d;
    const voices = voiceParamsOf(entry).map((n) => String(values[n] ?? "").trim() || String(p[n] ?? ""));
    if (voices[0] === voices[1]) return "Ikki kishiga ikki xil ovoz tanlang.";
  }
  return null;
}
