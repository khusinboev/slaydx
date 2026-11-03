import "server-only";
import { ApiError } from "../api";
import { query, queryOne } from "../db";
import { getSetting } from "../settings";
import { MIX_AUDIO_MAX_SECONDS, MIX_INPUTS, MIX_SECONDS_TOLERANCE, MIX_VIDEO_MAX_SECONDS, isGenerationId, mixModeOf, mixParams, mixPriceOf, type MixMode } from "../../media/catalog-mix";
import { mediaSeconds } from "../../generation/studio/mix-media";
import type { MixInput, StudioMixCtx } from "../../generation/studio/mix";
import type { FormValues } from "../../types";

/**
 * Studio «Montaj» server side (docs/studio/P8-SPEC.md «P8c»): which of the user's OWN finished generations can be a mix
 * input, the checks that run BEFORE anything is charged, and the worker's view of a job.
 *
 * Every lookup is `WHERE g.id = $1 AND g.user_id = $2 AND status = 'COMPLETED' AND files_purged_at IS NULL` — another
 * user's id is the same answer as a missing one (400 `input_missing`). A source is accepted by ROLE:
 *
 *   video    `studio-video`, `video`, a `studio-mix` MP4                         (stored as video/mp4)
 *   audio    `studio-speech`, `studio-audio` (any mode), `podcast`, `greeting`,
 *            a `studio-mix` MP3                                                  (stored as audio/mpeg)
 *   speech   `studio-speech`, `podcast`, `greeting`, `studio-audio` voice changer / isolator
 *   music    `studio-audio` music
 *
 * Lengths: the listing and the pre-charge check read the result's stored seconds (`doc_json`), measuring the bytes only
 * when a document has none; the worker always measures the bytes (`mix.ts`).
 */

export type MixRole = "video" | "audio" | "speech" | "music";

/** The roles of each mode's two inputs. */
export const MIX_ROLES: Readonly<Record<MixMode, readonly [MixRole, MixRole]>> = {
  "video-voice": ["video", "audio"],
  "voice-music": ["speech", "music"],
};

const ROLE_TOOLS: Readonly<Record<MixRole, readonly string[]>> = {
  video: ["studio-video", "video", "studio-mix"],
  audio: ["studio-speech", "studio-audio", "podcast", "greeting", "studio-mix"],
  speech: ["studio-speech", "podcast", "greeting", "studio-audio"],
  music: ["studio-audio"],
};
const ALL_TOOLS = [...new Set(Object.values(ROLE_TOOLS).flat())];

type Row = { id: string; tool_id: string; topic: string | null; created_at: Date; mime: string; seconds: string | null; audio_mode: string | null; aspect: string | null };

const ROW_SQL = `SELECT g.id, g.tool_id, g.topic, g.created_at, f.mime,
        COALESCE(g.doc_json->'video'->>'seconds', g.doc_json->'speech'->>'seconds', g.doc_json->'studioAudio'->>'seconds',
                 g.doc_json->'audio'->>'seconds', g.doc_json->'mix'->>'seconds') AS seconds,
        g.doc_json->'studioAudio'->>'mode' AS audio_mode, g.doc_json->'video'->>'aspect' AS aspect
   FROM generations g JOIN generation_files f ON f.generation_id = g.id
  WHERE g.user_id = $1 AND g.status = 'COMPLETED' AND g.files_purged_at IS NULL`;

/** Does a stored result fit a role (tool, stored mime, the «Audio» mode)? */
export function fitsRole(r: { tool_id: string; mime: string; audio_mode: string | null }, role: MixRole): boolean {
  if (!ROLE_TOOLS[role].includes(r.tool_id)) return false;
  if (role === "video") return r.mime === "video/mp4";
  if (r.mime !== "audio/mpeg") return false;
  if (role === "speech" && r.tool_id === "studio-audio") return r.audio_mode === "voice-changer" || r.audio_mode === "isolate";
  if (role === "music") return r.audio_mode === "music";
  return true;
}

const maxOf = (role: MixRole) => (role === "video" ? MIX_VIDEO_MAX_SECONDS : MIX_AUDIO_MAX_SECONDS);
const LABEL: Readonly<Record<string, string>> = {
  "studio-video": "Video",
  video: "Video",
  "studio-speech": "Ovoz",
  podcast: "Podkast",
  greeting: "Tabriknoma",
  "studio-mix": "Montaj",
};
const AUDIO_LABEL: Readonly<Record<string, string>> = { music: "Musiqa", sfx: "Effekt", "voice-changer": "Ovozni almashtirish", isolate: "Shovqindan tozalash" };

export type MixSource = { id: string; title: string; kind: string; seconds: number | null; createdAt: string };

function sourceOf(r: Row): MixSource {
  const seconds = r.seconds !== null && Number.isFinite(Number(r.seconds)) ? Math.round(Number(r.seconds) * 10) / 10 : null;
  const kind = r.tool_id === "studio-audio" ? (AUDIO_LABEL[r.audio_mode ?? ""] ?? "Audio") : (LABEL[r.tool_id] ?? "Audio");
  return { id: r.id, title: (r.topic ?? "").slice(0, 80) || kind, kind, seconds, createdAt: new Date(r.created_at).toISOString() };
}

/** How many sources of each role the picker lists (newest first). */
export const MIX_SOURCES_LIMIT = 30;

/**
 * `GET /api/media/mix-sources`: the base price (`studio.mix_price`, before the tool's %) and the user's finished
 * results per role, newest first, within the length limits (a source without a stored length is listed; the submit
 * measures it).
 */
export async function listMixSources(userId: string): Promise<{ price: number } & Record<MixRole, MixSource[]>> {
  const [rows, price] = await Promise.all([
    query<Row>(`${ROW_SQL} AND g.tool_id = ANY($2::text[]) ORDER BY g.created_at DESC, g.id DESC LIMIT 400`, [userId, ALL_TOOLS]),
    getSetting("studio.mix_price"),
  ]);
  const out = { price: mixPriceOf(price), video: [] as MixSource[], audio: [] as MixSource[], speech: [] as MixSource[], music: [] as MixSource[] };
  for (const r of rows) {
    for (const role of ["video", "audio", "speech", "music"] as const) {
      if (out[role].length >= MIX_SOURCES_LIMIT || !fitsRole(r, role)) continue;
      const s = sourceOf(r);
      if (s.seconds !== null && s.seconds > maxOf(role) + MIX_SECONDS_TOLERANCE) continue;
      out[role].push(s);
    }
  }
  return out;
}

async function ownRow(userId: string, id: string): Promise<Row | null> {
  return queryOne<Row>(`${ROW_SQL} AND g.id = $2::uuid`, [userId, id]).then((r) => r ?? null);
}

async function measuredSeconds(userId: string, id: string, mime: string): Promise<number> {
  const f = await queryOne<{ bytes: Buffer }>(
    `SELECT f.bytes FROM generation_files f JOIN generations g ON g.id = f.generation_id WHERE f.generation_id = $1::uuid AND g.user_id = $2`,
    [id, userId],
  );
  return f ? mediaSeconds(new Uint8Array(f.bytes), mime) : 0;
}

const WHAT: Readonly<Record<MixRole, string>> = { video: "Video", audio: "Audio", speech: "Ovoz", music: "Musiqa" };

/**
 * The «Montaj» checks BEFORE pricing / charging (400): both inputs are the caller's OWN finished results of the right
 * role (SQL), within the length limits, and the start offset falls inside the video. The request values are not
 * changed (the price is fixed). A replay is a job that already exists (the caller skips this).
 */
export async function prepareMixRequest(userId: string, values: FormValues): Promise<void> {
  const m = mixModeOf(values);
  const p = mixParams(values);
  if (!m || !p) throw new ApiError("Noma'lum montaj turi — qaytadan tanlang.", 400, { code: "input_invalid" });
  const names = MIX_INPUTS[m.mode];
  const roles = MIX_ROLES[m.mode];
  const seconds: number[] = [];
  for (let i = 0; i < 2; i++) {
    const id = String(values[names[i]!] ?? "").trim().toLowerCase();
    const role = roles[i]!;
    const row = isGenerationId(id) ? await ownRow(userId, id) : null;
    if (!row || !fitsRole(row, role)) throw new ApiError(`${WHAT[role]} topilmadi — ro‘yxatdan qayta tanlang.`, 400, { code: "input_missing" });
    let s = row.seconds !== null ? Number(row.seconds) : NaN;
    if (!(Number.isFinite(s) && s > 0)) s = await measuredSeconds(userId, id, row.mime);
    if (!(s > 0)) throw new ApiError(`${WHAT[role]} faylini o‘qib bo‘lmadi — boshqasini tanlang.`, 400, { code: "input_invalid" });
    if (s > maxOf(role) + MIX_SECONDS_TOLERANCE) throw new ApiError(`${WHAT[role]} ${maxOf(role) / 60} daqiqadan oshmasin.`, 400, { code: "input_invalid" });
    seconds.push(s);
  }
  if (m.mode === "video-voice" && Number(p.startOffset) >= seconds[0]!) {
    throw new ApiError(`Audio boshlanishi videodan qisqa bo‘lsin (video ${Math.floor(seconds[0]!)} soniya).`, 400, { code: "input_invalid" });
  }
}

/** The worker's view of a «Montaj» job: both inputs' bytes, read again with the job owner's id (SQL), in mode order. */
export async function mixJobCtx(userId: string, values: FormValues): Promise<StudioMixCtx> {
  const m = mixModeOf(values);
  if (!m) return { inputs: [null, null] };
  const names = MIX_INPUTS[m.mode];
  const roles = MIX_ROLES[m.mode];
  const load = async (i: 0 | 1): Promise<MixInput | null> => {
    const id = String(values[names[i]] ?? "").trim().toLowerCase();
    if (!isGenerationId(id)) return null;
    const row = await ownRow(userId, id);
    if (!row || !fitsRole(row, roles[i])) return null;
    const f = await queryOne<{ bytes: Buffer; mime: string }>(
      `SELECT f.bytes, f.mime FROM generation_files f JOIN generations g ON g.id = f.generation_id
        WHERE f.generation_id = $1::uuid AND g.user_id = $2 AND g.status = 'COMPLETED'`,
      [id, userId],
    );
    return f ? { bytes: new Uint8Array(f.bytes), mime: f.mime, ...(row.aspect ? { aspect: row.aspect } : {}) } : null;
  };
  return { inputs: [await load(0), await load(1)] };
}
