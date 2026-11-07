import "server-only";
import { randomBytes } from "node:crypto";
import { ApiError } from "../api";
import { query, queryOne, transaction } from "../db";
import { getSetting } from "../settings";
import { readUploadForm } from "../upload-body";
import { inAdminPreview } from "../log";
import { availableModels } from "./availability";
import { assertOwnCloneIds, cloneJobCtx, sniffAudio } from "./voices";
import { AUDIO_INPUT_MAX_BYTES, AUDIO_INPUT_USER_MAX_BYTES, AUDIO_INPUT_MAX_SECONDS, AUDIO_INPUT_MIN_SECONDS, AUDIO_MODES, takesAudioInput } from "../../media/catalog-audio";
import { cloneIdOf } from "../../media/catalog-speech";
import { DUB_MAX_SECONDS, DUB_VIDEO_MAX_BYTES, TRANSCRIBE_VIDEO_MAX_SECONDS } from "../../media/catalog-transcribe";
import { billedSeconds, studioAudioEntry, studioAudioPurposeOf } from "../../media/studio-audio";
import { isMp4 } from "../../generation/video/mp4";
import { mappedTracks, mp4Probe, mp4Problem } from "../../generation/studio/mix-media";
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

/** The «Audio» models available now (chip order, a mode's models in their order); none while `studio.audio.enabled` is off. */
export async function studioAudioModels(): Promise<string[]> {
  if (!(await getSetting("studio.audio.enabled"))) return [];
  const out: string[] = [];
  for (const m of AUDIO_MODES) {
    const available = await availableModels(m.purpose);
    for (const id of m.models) if (available.includes(id)) out.push(id);
  }
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
  // The minimum is on the measured length (2.5 s is not 3 s of audio); the maximum on the billed one (≤ 300 billed seconds).
  const billed = billedSeconds(s.seconds);
  if (s.seconds < AUDIO_INPUT_MIN_SECONDS - 0.01) return { message: `Audio kamida ${AUDIO_INPUT_MIN_SECONDS} soniya bo‘lsin (hozir ${Math.floor(s.seconds)} s).`, status: 422 };
  if (billed > AUDIO_INPUT_MAX_SECONDS) return { message: `Audio ${AUDIO_INPUT_MAX_SECONDS / 60} daqiqadan oshmasin.`, status: 422 };
  return null;
}

/**
 * P11 §D: a video upload for «Dublyaj» / «Transkripsiya» (`kind=video` in the form). The longest a speech tool takes of a
 * video: 3 min (`DUB_MAX_SECONDS` = `TRANSCRIBE_VIDEO_MAX_SECONDS`); the shortest, one second.
 */
export const VIDEO_INPUT_MIN_SECONDS = 1;
export const VIDEO_INPUT_MAX_SECONDS = Math.min(DUB_MAX_SECONDS, TRANSCRIBE_VIDEO_MAX_SECONDS);
export const VIDEO_INPUT_MIME = "video/mp4";

/**
 * An MP4 / MOV with a picture track and a readable length, else `null` — the type is read from the bytes, never from the
 * browser. `mvhd` is one number a forged file can set to anything, so `seconds` counts only when every track's own tables
 * (`mdhd`, `stts`, `stsz`, the frames themselves) agree with it. This reads the forger's own bytes, so the worker's cut
 * checks again on what ffmpeg really kept (`own-video.ts`). `problem`: the file is one but cannot be taken (`videoInputError`).
 */
export function sniffVideo(bytes: Uint8Array): { mime: typeof VIDEO_INPUT_MIME; seconds: number; problem: string | null } | null {
  const probe = isMp4(bytes) ? mp4Probe(bytes) : null;
  if (!probe) return null;
  // A fragmented file says so even when its tracks are empty.
  if (probe.fragmented) return { mime: VIDEO_INPUT_MIME, seconds: Math.max(probe.movieSeconds, 1), problem: mp4Problem(probe) };
  const { picture, sound } = mappedTracks(probe);
  if (!picture) return null;
  // Consistent tables differ by a few audio frames, and `mvhd` is the length players show; a file where they do not agree is refused.
  const seconds = probe.movieSeconds || Math.max(picture.seconds, sound?.seconds ?? 0);
  return seconds > 0 ? { mime: VIDEO_INPUT_MIME, seconds, problem: mp4Problem(probe) } : null;
}

/** Uzbek reason a video upload cannot be used (415 / 422), `null` when it is fine. */
export function videoInputError(s: { mime: string; seconds: number; problem?: string | null } | null): { message: string; status: number } | null {
  if (!s) return { message: "Faqat MP4 yoki MOV video qabul qilinadi.", status: 415 };
  if (s.problem) return { message: s.problem, status: 422 };
  if (s.seconds < VIDEO_INPUT_MIN_SECONDS) return { message: `Video kamida ${VIDEO_INPUT_MIN_SECONDS} soniya bo‘lsin.`, status: 422 };
  if (billedSeconds(s.seconds) > VIDEO_INPUT_MAX_SECONDS) return { message: `Video ${VIDEO_INPUT_MAX_SECONDS / 60} daqiqadan oshmasin (hozir ${Math.ceil(s.seconds)} s).`, status: 422 };
  return null;
}

/**
 * `POST /api/media/audio-inputs` body: `file` (the browser converts a recording / any upload to 16-bit mono WAV, an MP3
 * goes as is). Answer: `{ id, seconds }` — `seconds` is the BILLED length (whole seconds, rounded up), the same number
 * the server will price with.
 *
 * P11 §D: with `kind=video` the file is an MP4 for «Dublyaj» / «Transkripsiya», stored in the sibling table
 * `studio_video_inputs` (migration 075; the same shape, the same owner-only reads and housekeeping); without it a video is
 * refused as before, and the P6 audio modes read the audio table only, so they never see one. `tool=dub` / `tool=transcribe`
 * names the form it came from: that tool must be on, and a dub's real size limit is refused here, not at the submit.
 * A dark section takes no uploads: a video needs its tool on (or either, unnamed); an audio needs one of the sections it serves.
 */
export async function uploadAudioInput(req: Request, userId: string): Promise<AudioInputResult> {
  const form = await readUploadForm(req, AUDIO_INPUT_MAX_BYTES + 64 * 1024, "Fayl 25 MB dan katta");
  const file = form?.get("file");
  const video = form?.get("kind") === "video";
  const what = video ? "Video" : "Audio";
  const tool = form?.get("tool");
  const on = {
    audio: await getSetting("studio.audio.enabled"),
    transcribe: inAdminPreview() || (await getSetting("studio.transcribe.enabled")),
    dub: inAdminPreview() || (await getSetting("studio.dub.enabled")),
  };
  const open = !video ? on.audio || on.transcribe || on.dub : tool === "dub" ? on.dub : tool === "transcribe" ? on.transcribe : on.dub || on.transcribe;
  if (!open) throw new ApiError(`${what} yuklash hozircha mavjud emas.`, 400, { code: "tool_off" });
  if (!(file instanceof File)) throw new ApiError(`${what} yuborilmadi`, 400);
  if (file.size === 0) throw new ApiError(`${what} bo‘sh`, 400);
  if (file.size > AUDIO_INPUT_MAX_BYTES) throw new ApiError(`${what} 25 MB dan katta`, 413);
  if (video && tool === "dub" && file.size > DUB_VIDEO_MAX_BYTES) throw new ApiError(`Dublyaj uchun video ${DUB_VIDEO_MAX_BYTES / 1024 / 1024} MB dan oshmasin.`, 413, { code: "input_too_large" });
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = video ? sniffVideo(new Uint8Array(bytes)) : sniffAudio(new Uint8Array(bytes));
  const bad = video ? videoInputError(sniffed) : audioInputError(sniffed);
  if (bad) throw new ApiError(bad.message, bad.status, { code: "input_invalid" });
  // Ids are made here (never the content hash): the same file of two users is two rows, each the uploader's own.
  const id = randomBytes(12).toString("hex");
  const billed = billedSeconds(sniffed!.seconds);
  // One quota over both tables, the check and the insert under one per-user lock: two uploads at once cannot both pass it.
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`studio_inputs:${userId}`]);
    const held = await client.query<{ n: string }>(
      "SELECT (COALESCE((SELECT SUM(size_bytes) FROM studio_audio_inputs WHERE user_id = $1), 0) + COALESCE((SELECT SUM(size_bytes) FROM studio_video_inputs WHERE user_id = $1), 0))::text AS n",
      [userId],
    );
    if (Number(held.rows[0]?.n ?? 0) + bytes.byteLength > AUDIO_INPUT_USER_MAX_BYTES) {
      throw new ApiError("Yuklangan fayllar hajmi chegarada. Ular 1 kundan keyin o‘chadi — keyinroq urinib ko‘ring.", 429, { code: "input_quota" });
    }
    await client.query(
      `INSERT INTO ${video ? "studio_video_inputs" : "studio_audio_inputs"} (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId, sniffed!.mime, bytes.byteLength, Math.round(sniffed!.seconds * 100) / 100, billed, bytes],
    );
  });
  return { id, seconds: billed, mime: sniffed!.mime, size: bytes.byteLength };
}

const ID_RE = /^[0-9a-f]{24}$/;

/**
 * The user's own AUDIO input: its billed seconds (owner-only, SQL), `null` when it is not theirs / gone. A video upload
 * (P11, `studio_video_inputs`) is never one: the voice changer and the isolator take audio only.
 */
export async function ownAudioInput(userId: string, id: string): Promise<{ billedSeconds: number } | null> {
  if (!ID_RE.test(id)) return null;
  const row = await queryOne<{ billed_seconds: number }>("SELECT billed_seconds FROM studio_audio_inputs WHERE id = $1 AND user_id = $2", [id, userId]);
  return row ? { billedSeconds: Number(row.billed_seconds) } : null;
}

/** P11 §D: the user's own video upload (owner-only, SQL), `null` when it is not theirs / gone. */
export async function ownVideoInput(userId: string, id: string): Promise<{ seconds: number; billedSeconds: number; size: number } | null> {
  if (!ID_RE.test(id)) return null;
  const row = await queryOne<{ seconds: string; billed_seconds: number; size_bytes: string }>("SELECT seconds, billed_seconds, size_bytes FROM studio_video_inputs WHERE id = $1 AND user_id = $2", [id, userId]);
  return row ? { seconds: Number(row.seconds), billedSeconds: Number(row.billed_seconds), size: Number(row.size_bytes) } : null;
}

/** The worker's read of a video upload: the owner's own bytes (SQL), `null` when gone / not theirs. */
export async function videoInputBytes(userId: string, id: string): Promise<{ mime: string; bytes: Uint8Array; seconds: number } | null> {
  if (!ID_RE.test(id)) return null;
  const row = await queryOne<{ mime: string; bytes: Buffer; seconds: string }>("SELECT mime, bytes, seconds FROM studio_video_inputs WHERE id = $1 AND user_id = $2", [id, userId]);
  return row ? { mime: row.mime, bytes: new Uint8Array(row.bytes), seconds: Number(row.seconds) } : null;
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

/** Housekeeping: inputs older than a day are deleted (a job runs within minutes of its upload) — the video uploads too. */
export async function studioAudioInputsHousekeeping(): Promise<{ deleted: number }> {
  const rows = await query("DELETE FROM studio_audio_inputs WHERE created_at < now() - interval '1 day' RETURNING id");
  const videos = await query("DELETE FROM studio_video_inputs WHERE created_at < now() - interval '1 day' RETURNING id");
  return { deleted: rows.length + videos.length };
}
