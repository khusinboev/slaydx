import "server-only";
import type { MediaAdapter, MediaOutput, Route } from "../../studio-core";
import { MEDIA_CATALOG } from "../../media/catalog";
import { ELEVENLABS_VOICES, GEMINI_VOICES, STUDIO_CLONE_PURPOSE, STUDIO_SPEECH_PURPOSE, VOICE_PREVIEW_TEXT, cloneIdOf } from "../../media/catalog-speech";
import { studioSpeechAdapters } from "../../media/adapters/speech-studio";
import { geminiTtsModel } from "../../generation/tts/gemini";
import { mergeToMp3, mp3Seconds } from "../../generation/tts/mp3";
import { recordSpeechCall } from "../../generation/studio/cost";
import { extractMeta } from "../../generation/meta";
import type { AcademicDoc, BuiltFile } from "../../generation/types";
import type { FormValues, ToolConfig } from "../../types";
import { UserFacingError } from "../user-error";
import { ApiError } from "../api";
import { queryOne } from "../db";
import { CloneRefused, abortClone, beginClone, finishClone, readPreview, storePreview, studioSpeechModels, type ProviderDeleteDeps } from "./voices";
import { runMedia, type RunInput } from "./run";

/**
 * The voice-clone job (tool `studio-voice`, docs/studio/P5-SPEC.md) and the voice previews.
 *
 * Clone = ALL OR NOTHING: the 'creating' row (one active clone per user, DB-enforced) → ElevenLabs Instant Voice Clone
 * (`runMedia`, purpose `studio.clone`) → one short Uzbek preview spoken with the new voice (purpose `studio.speech`,
 * the job's result file) → the row is ready and the sample's bytes are cleared. Any failure removes the clone (the row,
 * and the ElevenLabs voice when it was already made) and fails the job: the worker refunds the fixed price in full.
 */

export const CLONE_MODEL_ID = "elevenlabs/voice-clone";
export const CLONE_PREVIEW_MODEL_ID = "elevenlabs/eleven-v3";

export type CloneDeps = ProviderDeleteDeps & {
  adapters?: Readonly<Record<string, MediaAdapter>>;
  run?: (i: RunInput) => Promise<{ outputs: MediaOutput[]; route?: Route }>;
};

const inline = (o: MediaOutput | undefined): Uint8Array | null => (o && o.kind === "inline" && o.bytes.length ? o.bytes : null);

function providerVoiceOf(o: MediaOutput | undefined): string | null {
  const b = inline(o);
  if (!b) return null;
  try {
    const id = (JSON.parse(new TextDecoder().decode(b)) as { voice_id?: unknown }).voice_id;
    return typeof id === "string" && /^[A-Za-z0-9]{8,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function buildStudioClone(
  tool: ToolConfig,
  job: { userId: string; generationId: string },
  values: FormValues,
  o: { deadline?: number; onStage?: (ev: { progress: number; step: string }) => void } = {},
  deps: CloneDeps = {},
): Promise<BuiltFile> {
  o.onStage?.({ progress: 0, step: "So‘rov tayyorlanmoqda" });
  let begun: Awaited<ReturnType<typeof beginClone>>;
  try {
    begun = await beginClone(job.userId, job.generationId, values);
  } catch (e) {
    if (e instanceof CloneRefused) throw new UserFacingError(`${e.message} Kredit qaytariladi.`);
    throw e;
  }
  const adapters = deps.adapters ?? studioSpeechAdapters();
  const run = deps.run ?? runMedia;
  const sampleId = String(values.sampleId ?? "").trim();
  let providerVoiceId: string | null = null;
  let mp3: Uint8Array | null = null;
  o.onStage?.({ progress: 10, step: "Ovozga o‘girilmoqda" });
  try {
    const made = await run({
      purpose: STUDIO_CLONE_PURPOSE,
      modelId: CLONE_MODEL_ID,
      values: { name: begun.name, sampleId },
      assets: { sample: [begun.sample] },
      step: "clone:0",
      adapters,
      ...(o.deadline ? { deps: { deadline: o.deadline } } : {}),
    });
    providerVoiceId = providerVoiceOf(made.outputs[0]);
    if (!providerVoiceId) throw new Error("clone answered without a voice id");
    o.onStage?.({ progress: 60, step: "Ovozga o‘girilmoqda" });
    const previewValues = { text: VOICE_PREVIEW_TEXT, voice: `clone:${begun.voiceId}` };
    const preview = await run({
      purpose: STUDIO_SPEECH_PURPOSE,
      modelId: CLONE_PREVIEW_MODEL_ID,
      values: previewValues,
      extra: { text: VOICE_PREVIEW_TEXT, voice: providerVoiceId, lang: "uz" },
      step: "clone:preview",
      adapters,
      redact: ["text"],
      ...(o.deadline ? { deps: { deadline: o.deadline } } : {}),
    });
    mp3 = inline(preview.outputs[0]);
    if (!mp3 || mp3Seconds(mp3) <= 0) throw new Error("preview is not audio");
    // The job's only billable provider call is the preview (the IVC call is free: catalog cost $0, nothing to record).
    const previewEntry = MEDIA_CATALOG.byId(CLONE_PREVIEW_MODEL_ID);
    if (previewEntry) recordSpeechCall(previewEntry, preview.route ?? previewEntry.routes[0]!, previewValues, VOICE_PREVIEW_TEXT.length);
    await finishClone(begun.voiceId, providerVoiceId, sampleId);
  } catch (e) {
    console.warn("[studio-clone] failed:", e instanceof Error ? e.message : e);
    await abortClone(begun.voiceId, providerVoiceId, deps).catch((x: unknown) => console.warn("[studio-clone] abort:", x instanceof Error ? x.message : x));
    throw new UserFacingError("Ovoz klonlanmadi — provayder javob bermadi yoki yozuvni qabul qilmadi. Kredit qaytariladi.");
  }
  await storePreview(`clone:${begun.voiceId}`, mp3).catch(() => undefined);
  o.onStage?.({ progress: 90, step: "Audio yig‘ilmoqda" });
  const seconds = mp3Seconds(mp3);
  const meta = extractMeta(tool, { ...values, topic: `Ovoz klonlash: ${begun.name}` });
  const doc: AcademicDoc = {
    meta,
    titlePage: false,
    toc: false,
    sections: [],
    speech: { model: CLONE_MODEL_ID, seconds: Math.round(seconds * 10) / 10, chars: VOICE_PREVIEW_TEXT.length, voices: [begun.name], lines: [{ speaker: begun.name, text: VOICE_PREVIEW_TEXT }], clone: true },
  };
  return { html: `<article><h1>${meta.topic.replace(/[<>&]/g, "")}</h1></article>`, bytes: mp3, fileName: "klon-ovoz.mp3", mime: "audio/mpeg", doc };
}

/* ───────────────────────── previews ───────────────────────── */

const inflight = new Map<string, Promise<Buffer>>();

/**
 * The preview audio of a voice key (`elevenlabs:<id>` / `gemini:<name>` library voices, `clone:<uuid>` the user's own):
 * from the cache when there; else ONE provider call (concurrent requests share it), stored, then served from the cache
 * for everyone. Only catalog voices and the requester's own clone are accepted; the model must be offered now.
 */
export async function voicePreview(userId: string, key: string, deps: CloneDeps = {}): Promise<Buffer> {
  const [provider, ...rest] = key.split(":");
  const id = rest.join(":");
  let modelId: string;
  let voice: string;
  let values: Record<string, unknown>;
  if (provider === "clone") {
    const cloneId = cloneIdOf(key);
    const row = cloneId
      ? await queryOne<{ provider_voice_id: string }>("SELECT provider_voice_id FROM studio_voices WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND status = 'ready'", [cloneId, userId])
      : null;
    if (!row) throw new ApiError("Ovoz topilmadi", 404);
    modelId = CLONE_PREVIEW_MODEL_ID;
    voice = row.provider_voice_id;
    values = { text: VOICE_PREVIEW_TEXT, voice: key };
  } else if (provider === "elevenlabs" && ELEVENLABS_VOICES.some((v) => v.id === id)) {
    modelId = CLONE_PREVIEW_MODEL_ID;
    voice = id;
    values = { text: VOICE_PREVIEW_TEXT, voice: id };
  } else if (provider === "gemini" && GEMINI_VOICES.some((v) => v.id === id)) {
    modelId = "google/gemini-tts";
    voice = id;
    values = { text: VOICE_PREVIEW_TEXT, voice: id };
  } else {
    throw new ApiError("Ovoz topilmadi", 404);
  }
  const cached = await readPreview(key);
  if (cached) return cached;
  const running = inflight.get(key);
  if (running) return running;
  if (!(await studioSpeechModels()).includes(modelId)) throw new ApiError("Namuna hozir mavjud emas.", 503);
  const job = (async () => {
    const run = deps.run ?? runMedia;
    const out = await run({
      purpose: STUDIO_SPEECH_PURPOSE,
      modelId,
      values,
      extra: { text: VOICE_PREVIEW_TEXT, voice, lang: "uz" },
      step: `preview:${key}`,
      adapters: deps.adapters ?? studioSpeechAdapters(),
      redact: ["text"],
      ...(modelId.startsWith("google/") ? { upstream: (r) => geminiTtsModel() || r.upstreamModel } : {}),
    });
    const o = out.outputs[0];
    const bytes = o && o.kind === "inline" ? o.bytes : null;
    const mp3 = bytes ? (o!.kind === "inline" && o!.mime === "audio/wav" ? await mergeToMp3([{ wav: bytes }]) : bytes) : null;
    if (!mp3 || mp3Seconds(mp3) <= 0) throw new ApiError("Namuna yaratilmadi", 502);
    await storePreview(key, mp3);
    return Buffer.from(mp3);
  })();
  inflight.set(key, job);
  try {
    return await job;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.warn("[studio-voices] preview failed:", e instanceof Error ? e.message : e);
    throw new ApiError("Namuna yaratilmadi — birozdan keyin urinib ko‘ring.", 502);
  } finally {
    inflight.delete(key);
  }
}
