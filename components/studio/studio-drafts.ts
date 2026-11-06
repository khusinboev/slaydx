import { AUDIO_MODES, type AudioMode } from "@/lib/media/catalog-audio";
import { MIX_MODES, type MixMode } from "@/lib/media/catalog-mix";
import { SPEECH_TOOL_MODES, type SpeechToolMode } from "@/lib/media/catalog-transcribe";
import { INITIAL_MIX_STATE, type MixTabState } from "./audio/mix-api";
import type { AudioTabState } from "./audio/AudioTab";
import type { SpeechToolState, SpeechToolsState } from "./audio/speech-tool-api";
import { INITIAL_RASM, type RasmForm, type RasmState, type StudioMode } from "./studio-modes";
import type { RawValues } from "./studio-values";
import type { VideoTabState } from "./video/VideoTab";
import type { VoiceFilter } from "./voice/VoiceList";
import type { VoiceTabState } from "./voice/VoiceTab";

/**
 * Stored drafts back into the tabs' form states. What comes out of `localStorage` is untrusted (an older build, a hand
 * edit): a value of the wrong shape falls back to the empty state of that field, never reaches a tab. The raw values
 * themselves need no check: the forms read them through `normalize` / `carryOver` of the model on screen.
 */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const raw = (v: unknown): RawValues => (isObj(v) ? v : {});
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null);
const FILTERS: readonly VoiceFilter[] = ["all", "male", "female", "mine"];
const STUDIO_MODES: readonly StudioMode[] = ["image", "edit", "upscale", "bgremove"];

/** The keys of `list` that hold an object, each read by `read`. */
function pick<K extends string, V>(v: unknown, list: readonly K[], read: (x: Record<string, unknown>) => V): Partial<Record<K, V>> {
  const out: Partial<Record<K, V>> = {};
  if (!isObj(v)) return out;
  for (const k of list) {
    const x = v[k];
    if (isObj(x)) out[k] = read(x);
  }
  return out;
}

export function parseRasmDraft(v: unknown): RasmState | null {
  if (!isObj(v)) return null;
  const forms = pick<StudioMode, RasmForm>(v.forms, STUDIO_MODES, (f) => ({ chosen: str(f.chosen), raw: raw(f.raw) }));
  return { ...INITIAL_RASM, mode: oneOf(v.mode, STUDIO_MODES) ?? "image", forms };
}

export function parseVideoDraft(v: unknown): VideoTabState | null {
  if (!isObj(v)) return null;
  return {
    mode: oneOf(v.mode, ["effects", "text"] as const),
    chosen: str(v.chosen),
    raw: raw(v.raw),
    effect: str(v.effect),
    effectImage: str(v.effectImage) ?? "",
    effectImage2: str(v.effectImage2) ?? "",
    fromPicture: v.fromPicture === true,
  };
}

export function parseVoiceDraft(v: unknown): VoiceTabState | null {
  if (!isObj(v)) return null;
  const speaker = typeof v.speaker === "number" && Number.isInteger(v.speaker) && v.speaker >= 0 ? v.speaker : 0;
  return { mode: oneOf(v.mode, ["text", "dialogue"] as const), chosen: str(v.chosen), raw: raw(v.raw), filter: oneOf(v.filter, FILTERS) ?? "all", speaker };
}

const AUDIO: readonly AudioMode[] = AUDIO_MODES.map((m) => m.mode);
const TOOLS: readonly SpeechToolMode[] = SPEECH_TOOL_MODES.map((m) => m.mode);
const MIXES: readonly MixMode[] = MIX_MODES.map((m) => m.mode);

function parseMix(v: unknown): MixTabState | undefined {
  if (!isObj(v)) return undefined;
  return { mode: oneOf(v.mode, MIXES) ?? INITIAL_MIX_STATE.mode, raw: pick<MixMode, RawValues>(v.raw, MIXES, raw) };
}

function parseTool(t: Record<string, unknown>): SpeechToolState {
  return { raw: raw(t.raw), tab: oneOf(t.tab, ["upload", "video"] as const) ?? "result", kind: oneOf(t.kind, ["video", "audio"] as const), ...(str(t.model) ? { model: str(t.model)! } : {}) };
}

export function parseAudioDraft(v: unknown): AudioTabState | null {
  if (!isObj(v)) return null;
  const models: Partial<Record<AudioMode, string>> = {};
  if (isObj(v.models)) {
    for (const m of AUDIO) {
      const id = str(v.models[m]);
      if (id) models[m] = id;
    }
  }
  const tools: SpeechToolsState = pick<SpeechToolMode, SpeechToolState>(v.tools, TOOLS, parseTool);
  return {
    mode: oneOf(v.mode, [...AUDIO, ...TOOLS, "mix"] as const),
    raw: pick<AudioMode, RawValues>(v.raw, AUDIO, raw),
    filter: oneOf(v.filter, FILTERS) ?? "all",
    models,
    mix: parseMix(v.mix),
    tools,
  };
}
