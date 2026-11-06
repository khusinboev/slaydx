import "server-only";
import { ApiError } from "../api";
import { queryOne } from "../db";
import type { AdapterAsset } from "../../studio-core";
import { FAL_AVATAR_AUDIO_MIMES, OWN_AUDIO_PARAM, avatarMaxSeconds, avatarMinSeconds, isAvatarModel, isPhotoAvatarModel, withAvatarSeconds } from "../../media/catalog-video";
import { isGenerationId, MIX_SECONDS_TOLERANCE } from "../../media/catalog-mix";
import { studioVideoModelOf } from "../../media/studio-video-pricing";
import { mediaSeconds } from "../../generation/studio/mix-media";
import { fitsRole } from "./mix-sources";
import type { FormValues } from "../../types";

/**
 * Studio P9 HeyGen avatar (docs/studio/P9-HEYGEN.md), server side: the avatar's own-speech input and the clip length the
 * job is priced at.
 *
 * The own speech is one of the caller's OWN finished speech results — the «Montaj» speech role (`fitsRole(…,
 * "speech")`: «Ovoz», podcast, greeting, the «Audio» voice changer / isolator; stored as MP3) — looked up with
 * `WHERE g.id = $1 AND g.user_id = $2 AND status = 'COMPLETED' AND files_purged_at IS NULL`: another user's id is the
 * same answer as a missing one. Its length is the stored one (`doc_json`), measured from the bytes only when a result
 * has none — the same numbers the source list shows the browser (`GET /api/media/mix-sources`).
 */

type Row = { tool_id: string; mime: string; seconds: string | null; audio_mode: string | null };

const OWN_SQL = `SELECT g.tool_id, f.mime,
        COALESCE(g.doc_json->'speech'->>'seconds', g.doc_json->'studioAudio'->>'seconds', g.doc_json->'audio'->>'seconds') AS seconds,
        g.doc_json->'studioAudio'->>'mode' AS audio_mode
   FROM generations g JOIN generation_files f ON f.generation_id = g.id
  WHERE g.id = $1::uuid AND g.user_id = $2 AND g.status = 'COMPLETED' AND g.files_purged_at IS NULL`;

async function ownSpeech(userId: string, id: string): Promise<Row | null> {
  if (!isGenerationId(id)) return null;
  const row = await queryOne<Row>(OWN_SQL, [id, userId]);
  return row && fitsRole(row, "speech") ? row : null;
}

async function bytesOf(userId: string, id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  return (
    (await queryOne<{ bytes: Buffer; mime: string }>(
      `SELECT f.bytes, f.mime FROM generation_files f JOIN generations g ON g.id = f.generation_id
        WHERE f.generation_id = $1::uuid AND g.user_id = $2 AND g.status = 'COMPLETED' AND g.files_purged_at IS NULL`,
      [id, userId],
    )) ?? null
  );
}

const ownId = (values: Readonly<Record<string, unknown>>) => String(values[OWN_AUDIO_PARAM] ?? "").trim().toLowerCase();

/**
 * Before pricing / charging (400): for the avatar model, the own speech (if any) is the caller's own finished speech
 * within the model's limits (`avatarMinSeconds` … `avatarMaxSeconds`), and `values.seconds` is OVERWRITTEN from the inputs (`withAvatarSeconds`, the function the
 * browser prices with) — the price follows the script / the file, never the request's number (the «Audio» tab's
 * `inputSeconds` rule). Other models: nothing. A replay is a job that already exists (the caller skips this).
 */
export async function prepareAvatarRequest(userId: string, values: FormValues): Promise<void> {
  const v = values as unknown as Record<string, unknown>;
  const modelId = studioVideoModelOf(v);
  if (!isAvatarModel(modelId)) return;
  const id = ownId(v);
  let audioSeconds: number | null = null;
  if (id) {
    const row = await ownSpeech(userId, id);
    if (!row) throw new ApiError("Ovoz topilmadi — ro‘yxatdan qayta tanlang.", 400, { code: "input_missing" });
    let s = row.seconds !== null ? Number(row.seconds) : NaN;
    if (!(Number.isFinite(s) && s > 0)) {
      const f = await bytesOf(userId, id);
      s = f ? mediaSeconds(new Uint8Array(f.bytes), f.mime) : 0;
    }
    if (!(s > 0)) throw new ApiError("Ovoz faylini o‘qib bo‘lmadi — boshqasini tanlang.", 400, { code: "input_invalid" });
    const max = avatarMaxSeconds(modelId);
    if (s > max + MIX_SECONDS_TOLERANCE) throw new ApiError(`Avatar uchun ovoz ${max} soniyadan oshmasin.`, 400, { code: "input_invalid" });
    if (s < avatarMinSeconds(modelId)) throw new ApiError(`Bu avatar uchun ovoz kamida ${avatarMinSeconds(modelId)} soniya bo‘lsin.`, 400, { code: "input_invalid" });
    // The stated formats (OmniHuman: wav or mp3); a speech result is stored as MP3, so this guards an old or foreign row.
    if (isPhotoAvatarModel(modelId) && !FAL_AVATAR_AUDIO_MIMES.includes(row.mime)) throw new ApiError("Bu ovoz formati avatarga mos emas — boshqasini tanlang.", 400, { code: "input_invalid" });
    audioSeconds = s;
  }
  const next = withAvatarSeconds(v, audioSeconds);
  v.seconds = next.seconds;
}

/**
 * The worker's view (submit): the own speech's bytes, read again with the job owner's id (SQL), as the adapter's audio
 * asset; `null` when the job has none. Throws nothing; a vanished file is `undefined` (the caller fails + refunds).
 */
export async function avatarAudioAsset(userId: string, values: Readonly<Record<string, unknown>>): Promise<AdapterAsset | null | undefined> {
  const id = ownId(values);
  if (!id) return null;
  if (!(await ownSpeech(userId, id))) return undefined;
  const f = await bytesOf(userId, id);
  return f ? { mime: f.mime, base64: Buffer.from(f.bytes).toString("base64") } : undefined;
}
