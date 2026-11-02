import "server-only";
import { randomBytes } from "node:crypto";
import { ApiError } from "../api";
import { query, queryOne } from "../db";
import { getSetting } from "../settings";
import { readUploadForm } from "../upload-body";
import { availableModels } from "./availability";
import { assertOwnCloneIds, cloneJobCtx, sniffAudio } from "./voices";
import { AUDIO_INPUT_MAX_BYTES, AUDIO_INPUT_MAX_SECONDS, AUDIO_INPUT_MIN_SECONDS, AUDIO_MODES, takesAudioInput } from "../../media/catalog-audio";
import { cloneIdOf } from "../../media/catalog-speech";
import { billedSeconds, studioAudioEntry, studioAudioPurposeOf } from "../../media/studio-audio";
import type { StudioAudioCtx } from "../../generation/studio/audio";
import type { FormValues } from "../../types";

/**
 * Studio «Audio» server side (docs/studio/P6-SPEC.md): which modes are offered, the uploaded inputs of the voice changer
 * / isolator, the checks that run BEFORE anything is charged, the worker's view of a job, and the inputs' housekeeping.
 *
 * Inputs: WAV / MP3 only (sniffed from the bytes, never the browser's type), 3–300 s measured, ≤ 25 MB; the PRICE is on
 * the server-measured length rounded up to the whole second (`billed_seconds`), written over the request's
 * `inputSeconds` before pricing. Ownership is always in SQL (`user_id = $n`). Uploads are limited per user (route).
 */

/* ───────────────────────── availability ───────────────────────── */

/** The «Audio» models available now (one per mode, chip order); none while `studio.audio.enabled` is off. */
export async function studioAudioModels(): Promise<string[]> {
  if (!(await getSetting("studio.audio.enabled"))) return [];
  const out: string[] = [];
  for (const m of AUDIO_MODES) if ((await availableModels(m.purpose)).includes(m.model)) out.push(m.model);
  return out;
}

/** Why the «Audio» request cannot be sold now (Uzbek, a 400 before charging), `null` when it can. */
export async function audioModelUnavailable(values: FormValues): Promise<string | null> {
  if (!(await getSetting("studio.audio.enabled"))) return "Audio bo‘limi hozircha mavjud emas.";
  const entry = studioAudioEntry(values);
  if (!entry) return "Noma'lum audio rejimi — boshqasini tanlang.";
  return (await studioAudioModels()).includes(entry.id) ? null : "Tanlangan rejim hozir mavjud emas — boshqasini tanlang.";
}

/* ───────────────────────── uploads ───────────────────────── */

export type AudioInputResult = { id: string; seconds: number; mime: string; size: number };

/** Uzbek reason the input cannot be used (415 / 422), `null` when it is fine. */
export function audioInputError(s: { mime: string; seconds: number } | null): { message: string; status: number } | null {
  if (!s) return { message: "Faqat WAV yoki MP3 audio qabul qilinadi.", status: 415 };
  const billed = billedSeconds(s.seconds);
  if (billed < AUDIO_INPUT_MIN_SECONDS) return { message: `Audio kamida ${AUDIO_INPUT_MIN_SECONDS} soniya bo‘lsin (hozir ${Math.floor(s.seconds)} s).`, status: 422 };
  if (billed > AUDIO_INPUT_MAX_SECONDS) return { message: `Audio ${AUDIO_INPUT_MAX_SECONDS / 60} daqiqadan oshmasin.`, status: 422 };
  return null;
}

/**
 * `POST /api/media/audio-inputs` body: `file` (the browser converts a recording / any upload to 16-bit mono WAV, an MP3
 * goes as is). Answer: `{ id, seconds }` — `seconds` is the BILLED length (whole seconds, rounded up), the same number
 * the server will price with.
 */
export async function uploadAudioInput(req: Request, userId: string): Promise<AudioInputResult> {
  const form = await readUploadForm(req, AUDIO_INPUT_MAX_BYTES + 64 * 1024, "Audio 25 MB dan katta");
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Audio yuborilmadi", 400);
  if (file.size === 0) throw new ApiError("Audio bo‘sh", 400);
  if (file.size > AUDIO_INPUT_MAX_BYTES) throw new ApiError("Audio 25 MB dan katta", 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffAudio(new Uint8Array(bytes));
  const bad = audioInputError(sniffed);
  if (bad) throw new ApiError(bad.message, bad.status, { code: "input_invalid" });
  // Ids are made here (never the content hash): the same file of two users is two rows, each the uploader's own.
  const id = randomBytes(12).toString("hex");
  const billed = billedSeconds(sniffed!.seconds);
  await query(
    "INSERT INTO studio_audio_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, userId, sniffed!.mime, bytes.byteLength, Math.round(sniffed!.seconds * 100) / 100, billed, bytes],
  );
  return { id, seconds: billed, mime: sniffed!.mime, size: bytes.byteLength };
}

const ID_RE = /^[0-9a-f]{24}$/;

/** The user's own input: its billed seconds (owner-only, SQL), `null` when it is not theirs / gone. */
export async function ownAudioInput(userId: string, id: string): Promise<{ billedSeconds: number } | null> {
  if (!ID_RE.test(id)) return null;
  const row = await queryOne<{ billed_seconds: number }>("SELECT billed_seconds FROM studio_audio_inputs WHERE id = $1 AND user_id = $2", [id, userId]);
  return row ? { billedSeconds: Number(row.billed_seconds) } : null;
}

/**
 * Before pricing (`submitGeneration`): an audio-input mode's input must be the user's own upload — then its
 * server-measured `billed_seconds` REPLACES whatever `inputSeconds` the request carried (the price follows the file, not
 * the client); the voice changer's clone voice must be the user's own ready clone. 400 otherwise, nothing charged.
 */
export async function prepareAudioRequest(userId: string, values: FormValues): Promise<void> {
  const entry = studioAudioEntry(values);
  if (!entry) return;
  if (takesAudioInput(entry)) {
    const own = await ownAudioInput(userId, String(values.inputId ?? "").trim());
    if (!own) throw new ApiError("Yuklangan audio topilmadi — faylni qayta yuklang.", 400, { code: "input_missing" });
    values.inputSeconds = own.billedSeconds;
  }
  if (entry.params.some((p) => p.name === "voice")) {
    const clone = cloneIdOf(String(values.voice ?? "").trim());
    await assertOwnCloneIds(userId, clone ? [clone] : []);
  }
}

/** The worker's view of an «Audio» job: the owner's own input bytes, the owner's clone (provider ids stay here). */
export async function studioAudioJobCtx(userId: string, values: FormValues): Promise<StudioAudioCtx> {
  const entry = studioAudioEntry(values);
  let input: StudioAudioCtx["input"] = null;
  if (entry && takesAudioInput(entry)) {
    const id = String(values.inputId ?? "").trim();
    const row = ID_RE.test(id)
      ? await queryOne<{ mime: string; bytes: Buffer; billed_seconds: number }>("SELECT mime, bytes, billed_seconds FROM studio_audio_inputs WHERE id = $1 AND user_id = $2", [id, userId])
      : null;
    if (row) input = { mime: row.mime, base64: row.bytes.toString("base64"), seconds: Number(row.billed_seconds) };
  }
  const clone = entry && studioAudioPurposeOf(entry.id) && entry.params.some((p) => p.name === "voice") ? cloneIdOf(String(values.voice ?? "").trim()) : null;
  const clones = await cloneJobCtx(userId, clone ? [clone] : []);
  return { input, clones: clones.clones, touch: clones.touch };
}

/** Housekeeping: inputs older than a day are deleted (a job runs within minutes of its upload). */
export async function studioAudioInputsHousekeeping(): Promise<{ deleted: number }> {
  const rows = await query("DELETE FROM studio_audio_inputs WHERE created_at < now() - interval '1 day' RETURNING id");
  return { deleted: rows.length };
}
