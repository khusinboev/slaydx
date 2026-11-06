import "server-only";
import { ApiError } from "../api";
import { query, queryOne } from "../db";
import { getSetting } from "../settings";
import { availableModels } from "./availability";
import { fitsRole, ownMixRow, rowSeconds } from "./mix-sources";
import { DUB_MAX_SECONDS, DUB_MODEL, DUB_VIDEO_MAX_BYTES, STUDIO_DUB_PURPOSE, STUDIO_TRANSCRIBE_PURPOSE, TRANSCRIBE_AUDIO_MAX_SECONDS, TRANSCRIBE_MODEL, TRANSCRIBE_VIDEO_MAX_SECONDS, parseSource, videoOnlySource } from "../../media/catalog-transcribe";
import { billedSeconds } from "../../media/studio-audio";
import { dubEntry } from "../../media/studio-transcribe";
import { stripUrls } from "../../generation/video/types";
import { burnProblem, burnVideoKbps } from "../../generation/studio/burn-args";
import { mappedTracks, mediaSeconds, mp4Aspect, mp4Probe } from "../../generation/studio/mix-media";
import type { SpeechToolCtx } from "../../generation/studio/transcribe";
import { MEDIA_UPLOAD_PARAM, clearMediaUpload } from "./jobs";
import { ownVideoInput, videoInputBytes } from "./audio-inputs";
import { STUDIO_VIDEO_PURPOSE } from "../../media/catalog-video";
import type { FormValues } from "../../types";

/**
 * Studio P10 server side (docs/studio/P10-SPEC.md): availability of «Transkripsiya» / «Dublyaj», the checks that run
 * BEFORE anything is charged, and the worker's view of a job's source.
 *
 * A source is the caller's OWN input, by reference (`catalog-transcribe.ts parseSource`):
 *   `upload:<id>`   a `studio_audio_inputs` row (`WHERE id = $1 AND user_id = $2`) — WAV / MP3 — or (P11 §D) a
 *                   `studio_video_inputs` row, the user's own MP4 uploaded with `kind=video`; its billed seconds;
 *   `result:<id>`   a finished result that fits the «Montaj» `video` or `audio` role (`mix-sources.ts`, the same SQL:
 *                   `g.user_id = $1 AND status = 'COMPLETED' AND files_purged_at IS NULL`).
 * Another user's id is the same answer as a missing one (400 `input_missing`). The BILLED seconds come from the server
 * (the upload row / the stored result) and REPLACE the request's `sourceSeconds` before pricing — the client's number is
 * never priced (a different preview is a 409 `price_changed`).
 */

export type SpeechToolId = "studio-transcribe" | "studio-dub";

const SWITCH = { "studio-transcribe": "studio.transcribe.enabled", "studio-dub": "studio.dub.enabled" } as const;
const PURPOSE = { "studio-transcribe": STUDIO_TRANSCRIBE_PURPOSE, "studio-dub": STUDIO_DUB_PURPOSE } as const;
const MODEL = { "studio-transcribe": TRANSCRIBE_MODEL, "studio-dub": DUB_MODEL } as const;
const NAME = { "studio-transcribe": "Transkripsiya", "studio-dub": "Dublyaj" } as const;

/** The P10 models offered now (chip order, a tool's models in their order): each tool needs its switch ON (default off). */
export async function speechToolModels(): Promise<string[]> {
  const out: string[] = [];
  for (const tool of ["studio-transcribe", "studio-dub"] as const) {
    if (!(await getSetting(SWITCH[tool]))) continue;
    out.push(...(await availableModels(PURPOSE[tool])));
  }
  return out;
}

/** Why the tool cannot be sold now with this model (blank = its default) (Uzbek, a 400 before charging), `null` when it can. */
export async function speechToolUnavailable(tool: SpeechToolId, modelId: string = ""): Promise<string | null> {
  if (!(await getSetting(SWITCH[tool]))) return `${NAME[tool]} hozircha mavjud emas.`;
  return (await availableModels(PURPOSE[tool])).includes(modelId.trim() || MODEL[tool]) ? null : `${NAME[tool]} xizmati hozir mavjud emas — keyinroq urinib ko‘ring.`;
}

type Resolved = { kind: "video" | "audio"; seconds: number; billed: number; size: number };

const MISSING = (what: string) => new ApiError(`${what} topilmadi — qaytadan tanlang yoki yuklang.`, 400, { code: "input_missing" });

/** The caller's own source, its measured length (s), billed whole seconds and stored size; 400 when it is not theirs. */
async function resolveSource(userId: string, raw: unknown): Promise<Resolved> {
  const ref = parseSource(raw);
  if (!ref) throw new ApiError("Avval manbani tanlang: audio yuklang yoki natijalaringizdan birini tanlang.", 400, { code: "input_invalid" });
  if (ref.kind === "upload") {
    const row = await queryOne<{ seconds: string; billed_seconds: number; size_bytes: string }>(
      "SELECT seconds, billed_seconds, size_bytes FROM studio_audio_inputs WHERE id = $1 AND user_id = $2",
      [ref.id, userId],
    );
    if (row) return { kind: "audio", seconds: Number(row.seconds), billed: Number(row.billed_seconds), size: Number(row.size_bytes) };
    // P11 §D: the user's own video upload (`studio_video_inputs`, the same owner-only SQL).
    const clip = await ownVideoInput(userId, ref.id);
    if (!clip) throw MISSING("Yuklangan fayl");
    return { kind: "video", seconds: clip.seconds, billed: clip.billedSeconds, size: clip.size };
  }
  const row = await ownMixRow(userId, ref.id);
  const kind = row && fitsRole(row, "video") ? "video" : row && fitsRole(row, "audio") ? "audio" : null;
  if (!row || !kind) throw MISSING("Tanlangan natija");
  const seconds = await rowSeconds(userId, row);
  if (!(seconds > 0)) throw new ApiError("Natija faylini o‘qib bo‘lmadi — boshqasini tanlang.", 400, { code: "input_invalid" });
  return { kind, seconds, billed: billedSeconds(seconds), size: Number(row.size_bytes) };
}

/**
 * Before pricing (`submitGeneration`), 400 otherwise and nothing charged: the source is the caller's own, of a kind the
 * tool takes, within its length limit (transcribe: video ≤ 3 min, audio ≤ 10 min; dub: ≤ 3 min); a burn needs a video
 * whose subtitled re-encode fits 25 MB; a video dub whose file cannot leave room under 25 MB is refused. Then the
 * server's billed seconds replace the request's `sourceSeconds`.
 */
export async function prepareSpeechToolRequest(userId: string, tool: SpeechToolId, values: FormValues): Promise<void> {
  const s = await resolveSource(userId, values.source);
  if (tool === "studio-dub" && s.kind !== "video" && videoOnlySource(dubEntry(values).id)) {
    throw new ApiError("Bu model faqat videoni tarjima qiladi — video natijani tanlang.", 400, { code: "input_invalid" });
  }
  const max = tool === "studio-dub" ? DUB_MAX_SECONDS : s.kind === "video" ? TRANSCRIBE_VIDEO_MAX_SECONDS : TRANSCRIBE_AUDIO_MAX_SECONDS;
  // On the BILLED (rounded-up) length: the schema caps `sourceSeconds` at `max`, so a 180.3 s source (181 billed) would
  // otherwise be normalized to the default and sold as 1 s.
  if (s.billed > max) {
    throw new ApiError(`${s.kind === "video" ? "Video" : "Audio"} ${max / 60} daqiqadan oshmasin (hozir ${Math.ceil(s.seconds)} s).`, 400, { code: "input_too_long" });
  }
  const burn = values.burn === true || values.burn === "true";
  if (tool === "studio-transcribe" && burn) {
    if (s.kind !== "video") throw new ApiError("Subtitrni faqat videoga yopishtirish mumkin — video natijani tanlang.", 400, { code: "input_invalid" });
    if (burnVideoKbps(s.seconds) === null) throw new ApiError("Bu video subtitr bilan 25 MB ga sig‘maydi — qisqaroq video tanlang.", 400, { code: "input_too_large" });
    // An own upload's picture is known only from its bytes; the worker checks again before the paid call.
    const ref = parseSource(values.source);
    const clip = ref?.kind === "upload" ? await videoInputBytes(userId, ref.id) : null;
    const probe = clip ? mp4Probe(clip.bytes) : null;
    const picture = probe ? mappedTracks(probe).picture : null;
    const heavy = picture ? burnProblem(picture) : null;
    if (heavy) throw new ApiError(heavy, 400, { code: "input_too_large" });
  }
  // The dubbed file is about the source's size (same picture, a new voice track): no room under the cap → refused now.
  if (tool === "studio-dub" && s.kind === "video" && s.size > DUB_VIDEO_MAX_BYTES) {
    throw new ApiError(`Bu video dublyaj uchun juda katta (${DUB_VIDEO_MAX_BYTES / 1024 / 1024} MB gacha) — qisqaroq video tanlang.`, 400, { code: "input_too_large" });
  }
  values.sourceSeconds = s.billed;
}

/** The worker's view of a job: the source's bytes, read again with the job owner's id (SQL), measured here. */
export async function speechToolJobCtx(userId: string, values: FormValues): Promise<SpeechToolCtx> {
  const ref = parseSource(values.source);
  if (!ref) return { source: null };
  if (ref.kind === "upload") {
    const row = await queryOne<{ mime: string; bytes: Buffer; seconds: string }>("SELECT mime, bytes, seconds FROM studio_audio_inputs WHERE id = $1 AND user_id = $2", [ref.id, userId]);
    if (row) return { source: { kind: "upload", id: ref.id, mime: row.mime, bytes: new Uint8Array(row.bytes), seconds: Number(row.seconds) } };
    const clip = await videoInputBytes(userId, ref.id);
    if (!clip) return { source: null };
    const aspect = mp4Aspect(clip.bytes);
    return { source: { kind: "upload", id: ref.id, mime: clip.mime, bytes: clip.bytes, seconds: clip.seconds, ...(aspect ? { aspect } : {}) } };
  }
  const row = await ownMixRow(userId, ref.id);
  if (!row || !(fitsRole(row, "video") || fitsRole(row, "audio"))) return { source: null };
  const f = await queryOne<{ bytes: Buffer; mime: string }>(
    `SELECT f.bytes, f.mime FROM generation_files f JOIN generations g ON g.id = f.generation_id
      WHERE f.generation_id = $1::uuid AND g.user_id = $2 AND g.status = 'COMPLETED'
      LIMIT 1`,
    [ref.id, userId],
  );
  if (!f) return { source: null };
  const bytes = new Uint8Array(f.bytes);
  return { source: { kind: "result", id: ref.id, mime: f.mime, bytes, seconds: mediaSeconds(bytes, f.mime), ...(row.aspect ? { aspect: row.aspect } : {}) } };
}

/** A `studio.dub` row whose generation stopped waiting is closed after this long (a re-claim resumes within seconds). */
export const DUB_ORPHAN_GRACE_MIN = 2;

/**
 * Housekeeping (leader, every tick): a dub row still 'pending' whose generation is no longer QUEUED / IN_PROGRESS (the
 * worker died twice → `reclaimStaleJobs` FAILED and refunded it; an admin revoked it; it is gone) is an orphan — nobody
 * will ever poll it. It is closed as 'failed' and its ElevenLabs project is deleted (best effort), so a late finish is
 * not kept there. A re-queued job is left alone (its re-run resumes the op).
 *
 * P11: then the sources those stopped jobs left on fal's CDN, whatever their row's status (a worker can die between the upload
 * and the park). The window is the files' own expiry and a little more: after that there is nothing to delete. A photo avatar's
 * audio (`studio.video`) is swept here too; a live clip is left alone, its generation stays IN_PROGRESS while the op runs.
 */
export async function studioDubHousekeeping(deps: { cancel?: (opId: string) => Promise<unknown>; dropUpload?: (url: string) => Promise<unknown> } = {}): Promise<{ closed: number; deleted: number; uploads: number }> {
  const rows = await query<{ op_id: string | null }>(
    `UPDATE media_jobs mj
        SET status = 'failed', errors = errors + 1, next_poll_at = NULL, finished_at = now(),
            last_error = 'orphaned: the generation stopped while the dub was pending — closed by housekeeping'
      WHERE mj.purpose = $1 AND mj.status = 'pending' AND mj.created_at < now() - $2::int * interval '1 minute'
        AND NOT EXISTS (SELECT 1 FROM generations g WHERE g.id = mj.generation_id AND g.status IN ('QUEUED', 'IN_PROGRESS'))
      RETURNING mj.op_id`,
    [STUDIO_DUB_PURPOSE, DUB_ORPHAN_GRACE_MIN],
  );
  // The op says whose it is: `fal:…` (P11) or an ElevenLabs dubbing id.
  const cancel =
    deps.cancel ??
    (async (opId: string) => (opId.startsWith("fal:") ? (await import("../../media/adapters/fal-dub")).falDubAdapter() : (await import("../../media/adapters/transcribe-studio")).dubAdapter()).cancel!(opId));
  let deleted = 0;
  for (const r of rows) {
    if (!r.op_id) continue;
    try {
      await cancel(r.op_id);
      deleted++;
    } catch (e) {
      console.warn("[studio-dub] orphan delete failed:", stripUrls(e instanceof Error ? e.message : String(e)));
    }
  }
  const left = await query<{ id: string; url: string }>(
    `SELECT mj.id, mj.params ->> $1 AS url
       FROM media_jobs mj
      WHERE mj.provider = 'fal' AND mj.purpose = ANY($2::text[]) AND mj.params ? $1
        AND mj.created_at < now() - $3::int * interval '1 minute' AND mj.created_at > now() - interval '2 hours'
        AND NOT EXISTS (SELECT 1 FROM generations g WHERE g.id = mj.generation_id AND g.status IN ('QUEUED', 'IN_PROGRESS'))`,
    [MEDIA_UPLOAD_PARAM, [STUDIO_DUB_PURPOSE, STUDIO_VIDEO_PURPOSE], DUB_ORPHAN_GRACE_MIN],
  );
  const drop = deps.dropUpload ?? (async (url: string) => (await import("../../media/adapters/fal-dub")).falDubAdapter().dropInput!(url));
  for (const r of left) {
    await drop(r.url).catch(() => undefined);
    await clearMediaUpload(r.id);
  }
  return { closed: rows.length, deleted, uploads: left.length };
}
