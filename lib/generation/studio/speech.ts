/**
 * Studio «Ovoz» engine (docs/studio/P5-SPEC.md, tool `studio-speech`).
 *
 * Core-native like the Rasm / Video tabs: every provider call is one `runMedia` call with purpose `studio.speech` (router,
 * breaker health, a `media_jobs` row per call). Single voice: the text in chunks the provider takes in one call
 * (ElevenLabs: the whole ≤ 4 000-character text; Gemini: ≤ 1 400 per call), joined into one MP3. Dialogue: ONE call
 * (ElevenLabs text-to-dialogue, or Gemini's two-speaker request) — the script grammar is `parseDialogue`.
 *
 * Input: the chosen catalog model (`modelId`) and its ParamSchema values, normalized with the same schema the route
 * validated with. Voices were checked before charging; a `clone:<id>` reaches the provider ONLY through `ctx.voices`,
 * which the worker built from the job owner's own active clones (SQL ownership) — an id missing there fails the job
 * (full refund), never speaks with another voice.
 */
import { normalize, type CatalogEntry, type MediaAdapter, type MediaOutput } from "../../studio-core";
import { chunkText, TTS_LIMITS } from "../tts/types";
import { mergeToMp3, mp3Seconds } from "../tts/mp3";
import { geminiTtsModel } from "../tts/gemini";
import { extractMeta } from "../meta";
import { STUDIO_SPEECH_PURPOSE, cloneIdOf, libraryVoicesOf, voiceParamsOf } from "../../media/catalog-speech";
import { parseDialogue, speechTextParam, studioSpeechEntry } from "../../media/studio-speech";
import { studioSpeechAdapters } from "../../media/adapters/speech-studio";
import { UserFacingError } from "../../server/user-error";
import type { AcademicDoc, BuiltFile, StudioSpeechDoc } from "../types";
import type { FormValues, ToolConfig } from "../../types";

/** What the worker resolved for this job (`lib/server/media/voices.ts studioSpeechJobCtx`). */
export type StudioSpeechCtx = {
  /** `studio_voices.id` → provider voice id, ONLY the job owner's active clones. */
  clones: Readonly<Record<string, { providerVoiceId: string; name: string }>>;
  /** Marks the clones used (the 30-day unused purge reads `last_used_at`). */
  touch?: (cloneIds: readonly string[]) => Promise<void>;
};

export type StudioSpeechDeps = {
  /** Test seam: the adapters by id (default: the real ones). */
  adapters?: Readonly<Record<string, MediaAdapter>>;
  /** Test seam: the media call (default `runMedia`). */
  run?: (i: Parameters<typeof import("../../server/media/run").runMedia>[0]) => Promise<{ outputs: MediaOutput[] }>;
};

const FAILED = "Ovoz yaratilmadi — provayder javob bermadi. Kredit qaytariladi.";

/** Largest text of one provider call for this model. */
export function speechChunkLimit(entry: Pick<CatalogEntry, "id">): number {
  return entry.id.startsWith("google/") ? TTS_LIMITS.geminiChunkChars : 5_000;
}

type Voice = { id: string; label: string };

function voiceOf(entry: CatalogEntry, raw: unknown, ctx: StudioSpeechCtx): Voice {
  const clone = cloneIdOf(raw);
  if (clone) {
    const hit = ctx.clones[clone];
    if (!hit) throw new UserFacingError("Tanlangan ovoz topilmadi (o‘chirilgan bo‘lishi mumkin). Kredit qaytariladi.");
    return { id: hit.providerVoiceId, label: hit.name };
  }
  const v = String(raw ?? "");
  const lib = libraryVoicesOf(entry.id).find((x) => x.id === v);
  if (!lib) throw new UserFacingError("Noma'lum ovoz. Kredit qaytariladi.");
  return { id: lib.id, label: lib.name };
}

async function defaultRun(i: Parameters<typeof import("../../server/media/run").runMedia>[0]) {
  return (await import("../../server/media/run")).runMedia(i);
}

const bytesOf = (o: MediaOutput | undefined): { bytes: Uint8Array; mime: string } | null => (o && o.kind === "inline" && o.bytes.length ? { bytes: o.bytes, mime: o.mime } : null);

export async function buildStudioSpeech(
  tool: ToolConfig,
  values: FormValues,
  ctx: StudioSpeechCtx,
  o: { deadline?: number; onStage?: (ev: { progress: number; step: string }) => void } = {},
  deps: StudioSpeechDeps = {},
): Promise<BuiltFile> {
  o.onStage?.({ progress: 0, step: "So‘rov tayyorlanmoqda" });
  const entry = studioSpeechEntry(values);
  if (!entry) throw new UserFacingError("Tanlangan ovoz modeli mavjud emas. Kredit qaytariladi.");
  const p = normalize(entry.params, values);
  const adapters = deps.adapters ?? studioSpeechAdapters();
  const run = deps.run ?? defaultRun;
  const upstream = entry.routes[0]!.provider === "gemini" ? () => geminiTtsModel() || entry.routes[0]!.upstreamModel : undefined;
  const common = { purpose: STUDIO_SPEECH_PURPOSE, modelId: entry.id, adapters, redact: ["text", "script", "turns"] as const, ...(upstream ? { upstream } : {}), ...(o.deadline ? { deps: { deadline: o.deadline } } : {}) };
  const usedClones = voiceParamsOf(entry).map((n) => cloneIdOf(values[n])).filter((x): x is string => x !== null);

  const pieces: { mp3?: Uint8Array; wav?: Uint8Array }[] = [];
  let lines: StudioSpeechDoc["lines"];
  let voices: Voice[];
  let chars: number;
  o.onStage?.({ progress: 10, step: "Ovozga o‘girilmoqda" });

  try {
    if (speechTextParam(entry) === "script") {
      const d = parseDialogue(values.script);
      if (typeof d === "string") throw new UserFacingError(`${d} Kredit qaytariladi.`);
      voices = voiceParamsOf(entry).map((n) => voiceOf(entry, values[n] ?? p[n], ctx));
      const spoken = d.turns.map((t) => ({ text: t.text, voiceId: voices[t.speaker]!.id }));
      chars = String(p.script ?? "").length;
      lines = d.turns.map((t) => ({ speaker: d.speakers[t.speaker], text: t.text }));
      const gemini = entry.id.startsWith("google/");
      const extra: Record<string, string> = gemini
        ? { text: spoken.map((t) => t.text).join("\n"), lang: "uz", turns: JSON.stringify(spoken.map((t) => ({ voice: t.voiceId, text: t.text }))) }
        : { turns: JSON.stringify(spoken) };
      const out = await run({ ...common, values: p, extra, step: "speech:0" });
      const got = bytesOf(out.outputs[0]);
      if (!got) throw new Error("bo'sh audio");
      pieces.push(got.mime === "audio/wav" ? { wav: got.bytes } : { mp3: got.bytes });
    } else {
      const text = String(p.text ?? "");
      chars = text.length;
      voices = [voiceOf(entry, values.voice ?? p.voice, ctx)];
      lines = [{ speaker: voices[0]!.label, text }];
      const chunks = chunkText(text, speechChunkLimit(entry));
      for (let i = 0; i < chunks.length; i++) {
        const out = await run({ ...common, values: { ...p, text: chunks[i]! }, extra: { text: chunks[i]!, voice: voices[0]!.id, lang: String(p.lang ?? "uz") }, step: `speech:${i}` });
        const got = bytesOf(out.outputs[0]);
        if (!got) throw new Error("bo'sh audio");
        pieces.push(got.mime === "audio/wav" ? { wav: got.bytes } : { mp3: got.bytes });
        o.onStage?.({ progress: 10 + Math.round((80 * (i + 1)) / chunks.length), step: "Ovozga o‘girilmoqda" });
      }
    }
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    console.warn("[studio-speech] failed:", e instanceof Error ? e.message : e);
    throw new UserFacingError(FAILED);
  }

  o.onStage?.({ progress: 90, step: "Audio yig‘ilmoqda" });
  const mp3 = await mergeToMp3(pieces);
  if (!mp3) throw new UserFacingError("Audio yig‘ilmadi. Kredit qaytariladi.");
  const seconds = mp3Seconds(mp3);
  if (usedClones.length) await ctx.touch?.(usedClones).catch(() => undefined);

  const meta = extractMeta(tool, { ...values, topic: lines.map((l) => l.text).join(" ").slice(0, 72) || "Ovoz" });
  const speech: StudioSpeechDoc = { model: entry.id, seconds: Math.round(seconds * 10) / 10, chars, voices: voices.map((v) => v.label), lines, clone: usedClones.length > 0 };
  const doc: AcademicDoc = { meta, titlePage: false, toc: false, sections: [], speech };
  return {
    html: `<article><h1>${escapeHtml(meta.topic)}</h1><p>${Math.round(seconds)} s · ${escapeHtml(entry.label)}</p></article>`,
    bytes: mp3,
    fileName: `${meta.fileNameHint || "ovoz"}.mp3`,
    mime: "audio/mpeg",
    doc,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
