import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P11 §D: «Dublyaj» and «Transkripsiya» take the user's OWN video upload through the P6 audio-inputs path
 * (`POST /api/media/audio-inputs` with `kind=video`), stored in the sibling table `studio_video_inputs` (migration 075).
 *
 * Locked here:
 *   - `kind=video` + a real MP4 → 200 `{ id, seconds, mime: video/mp4 }`, a `studio_video_inputs` row (never an audio
 *     row), the billed seconds are the whole seconds of `moov/mvhd`; without `kind=video` the same MP4 is a 415 (the P6
 *     modes never see a video); `kind=video` + an MP3 is a 415;
 *   - the speech tools resolve the upload as a VIDEO source: a burn is allowed on it, the video-only HeyGen model takes it,
 *     the server's billed seconds replace the request's; the worker reads it back with its mime;
 *   - the P6 voice changer / isolator REFUSE a video upload as their input (400 `input_missing`);
 *   - OWNERSHIP in SQL: another user's video upload is a 400 `input_missing` for the speech tools too.
 *
 * Mutations (each turned the named test red, then restored):
 *   `uploadAudioInput` sniffs audio whatever `kind` says                         -> «upload» (the 200);
 *   `uploadAudioInput` sniffs video without `kind=video`                         -> «upload» (the 415 of the plain MP4);
 *   `resolveSource` without the video-table fallback                             -> «speech tools» (the source is missing);
 *   `ownAudioInput` reading the video table too                                  -> «P6 modes refuse»;
 *   `ownVideoInput` without `AND user_id = $2`                                   -> «ownership».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiovin") : { isolated: false, drop: async () => {} };
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = !(hasDb && iso.isolated) ? "isolated Postgres database is not available" : !HAS_FFMPEG ? "ffmpeg not installed — a real MP4 is needed" : false;

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

let dbReady: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  dbReady ??= mod.migrate();
  await dbReady;
  return mod;
}
after(async () => {
  if (!dbReady) return;
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

let seq = 0;
async function mkUser(): Promise<string> {
  const { query } = await db();
  return String((await query<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'Vin') RETURNING id", [`vin-${process.pid}-${seq++}`]))[0]!.id);
}
async function cookieOf(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}

let VIDEO: Uint8Array | null = null;
/** A real 2 s MP4 (blue picture + a sine), made once with ffmpeg. */
function videoMp4(): Uint8Array {
  if (VIDEO) return VIDEO;
  const dir = mkdtempSync(path.join(tmpdir(), "p11-vin-"));
  try {
    const f = path.join(dir, "v.mp4");
    const r = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:size=64x48:rate=6", "-f", "lavfi", "-i", "sine", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f]);
    assert.equal(r.status, 0, String(r.stderr));
    return (VIDEO = new Uint8Array(readFileSync(f)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function mp3Bytes(frames = 80): Uint8Array {
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}

async function upload(cookie: string, bytes: Uint8Array, name: string, kind?: "video"): Promise<{ status: number; body: { id?: string; seconds?: number; mime?: string; error?: string; code?: string } }> {
  const route = await import("../app/api/media/audio-inputs/route.ts");
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart], { type: kind === "video" ? "video/mp4" : "audio/mpeg" }), name);
  if (kind) form.append("kind", kind);
  const req = new Request("http://localhost/api/media/audio-inputs", { method: "POST", headers: { cookie }, body: form });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as never };
}

test("upload: kind=video + a real MP4 is stored as video/mp4 with its seconds; the plain path and a wrong file are refused", { skip }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const cookie = await cookieOf(me);
  const ok = await upload(cookie, videoMp4(), "clip.mp4", "video");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.id ?? "", /^[0-9a-f]{24}$/);
  assert.equal(ok.body.mime, "video/mp4", "MUTATSIYA: the row is a video");
  assert.equal(ok.body.seconds, 2, "the whole seconds of moov/mvhd");
  const { query } = await db();
  const row = (await query<{ mime: string; billed_seconds: number; user_id: string }>("SELECT mime, billed_seconds, user_id::text FROM studio_video_inputs WHERE id = $1", [ok.body.id]))[0]!;
  assert.equal(row.mime, "video/mp4", "the sibling table of the audio inputs (migration 075)");
  assert.equal(Number(row.billed_seconds), 2);
  assert.equal(row.user_id, me);
  assert.equal((await query("SELECT 1 FROM studio_audio_inputs WHERE id = $1", [ok.body.id])).length, 0, "MUTATSIYA: never an audio row");
  // Without `kind=video` the MP4 is no audio: the P6 modes never receive a video through the plain path.
  const plain = await upload(cookie, videoMp4(), "clip.mp4");
  assert.equal(plain.status, 415, "MUTATSIYA: a video through the audio path");
  assert.equal(plain.body.code, "input_invalid");
  // `kind=video` with an MP3: not a video.
  const wrong = await upload(cookie, mp3Bytes(), "a.mp3", "video");
  assert.equal(wrong.status, 415);
  assert.match(wrong.body.error ?? "", /MP4/);
  // The bounds helper: too long, too short.
  const { videoInputError, sniffVideo } = await import("../lib/server/media/audio-inputs.ts");
  assert.equal(videoInputError(null)?.status, 415);
  assert.equal(videoInputError({ mime: "video/mp4", seconds: 0.5 })?.status, 422);
  assert.equal(videoInputError({ mime: "video/mp4", seconds: 180 }), null);
  assert.equal(videoInputError({ mime: "video/mp4", seconds: 180.4 })?.status, 422, "181 billed seconds is over 3 minutes");
  assert.equal(sniffVideo(mp3Bytes()), null);
  assert.equal(sniffVideo(videoMp4())?.mime, "video/mp4");
});

test("speech tools: the upload is a VIDEO source — burn allowed, HeyGen takes it, the server's seconds priced; the worker reads it back", { skip }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const cookie = await cookieOf(me);
  const { id } = (await upload(cookie, videoMp4(), "clip.mp4", "video")).body;
  const { prepareSpeechToolRequest, speechToolJobCtx } = await import("../lib/server/media/speech-sources.ts");
  const { sourceKindOf } = await import("../lib/generation/studio/transcribe.ts");
  const { HEYGEN_TRANSLATE_MODEL } = await import("../lib/media/catalog-transcribe.ts");
  const burn = { source: `upload:${id}`, sourceSeconds: 1, burn: true } as Record<string, unknown>;
  await prepareSpeechToolRequest(me, "studio-transcribe", burn as never);
  assert.equal(burn.sourceSeconds, 2, "MUTATSIYA: the server's billed seconds replace the client's; a burn on a video is fine");
  const heygen = { modelId: HEYGEN_TRANSLATE_MODEL, source: `upload:${id}`, sourceSeconds: 1, target: "uz" } as Record<string, unknown>;
  await prepareSpeechToolRequest(me, "studio-dub", heygen as never);
  assert.equal(heygen.sourceSeconds, 2, "the video-only model takes an uploaded video");
  const ctx = await speechToolJobCtx(me, { source: `upload:${id}` } as never);
  assert.ok(ctx.source);
  assert.equal(ctx.source!.kind, "upload");
  assert.equal(ctx.source!.mime, "video/mp4");
  assert.equal(sourceKindOf(ctx.source!.mime), "video");
  assert.ok(ctx.source!.bytes.length > 1000, "the stored bytes come back");
  assert.ok(Math.abs(ctx.source!.seconds - 2) < 0.2);
});

test("P6 modes refuse a video upload as their input; ownership: another user's video upload is missing", { skip }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const other = await mkUser();
  const { id } = (await upload(await cookieOf(me), videoMp4(), "clip.mp4", "video")).body;
  const { prepareAudioRequest, ownAudioInput } = await import("../lib/server/media/audio-inputs.ts");
  const { ISOLATOR_MODEL } = await import("../lib/media/catalog-audio.ts");
  assert.equal(await ownAudioInput(me, id!), null, "MUTATSIYA: a video is no audio input");
  const code = (e: unknown) => (e as { status?: number; extra?: { code?: string } }).extra?.code;
  await assert.rejects(prepareAudioRequest(me, { modelId: ISOLATOR_MODEL, inputId: id, inputSeconds: 2 } as never), (e: unknown) => (e as { status?: number }).status === 400 && code(e) === "input_missing");
  const { prepareSpeechToolRequest } = await import("../lib/server/media/speech-sources.ts");
  await assert.rejects(prepareSpeechToolRequest(other, "studio-transcribe", { source: `upload:${id}`, sourceSeconds: 1 } as never), (e: unknown) => (e as { status?: number }).status === 400 && code(e) === "input_missing");
});
