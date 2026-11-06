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
 *   - OWNERSHIP in SQL: another user's video upload is a 400 `input_missing` for the speech tools too;
 *   - review fixes: a file forged in the test (`mvhd`, `mdhd`, `stts`) is refused and the worker's cut holds even when one
 *     gets through; fragmented / oversized files; MOV; portrait; the picture check before the paid call; burn and HeyGen on
 *     an own video through `submitGeneration`; dark switches; the dub's size; the quota lock.
 *
 * Mutations (each turned the named test red, then restored):
 *   `uploadAudioInput` sniffs audio whatever `kind` says                         -> «upload» (the 200);
 *   `uploadAudioInput` sniffs video without `kind=video`                         -> «upload» (the 415 of the plain MP4);
 *   `resolveSource` without the video-table fallback                             -> «speech tools» (the source is missing);
 *   `ownAudioInput` reading the video table too                                  -> «P6 modes refuse»;
 *   `ownVideoInput` without `AND user_id = $2`                                   -> «ownership».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.FAL_KEY = "fal0000-flow-key:5ecr3t5ecr3t";
process.env.ELEVENLABS_API_KEY = "sk_flow_key";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiovin") : { isolated: false, drop: async () => {} };
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
// In CI a missing ffmpeg is a failure, not a skip: these are the proofs of what a forged file can buy.
const skip = !(hasDb && iso.isolated) ? "isolated Postgres database is not available" : !HAS_FFMPEG && !process.env.CI ? "ffmpeg not installed — a real MP4 is needed" : false;

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

let dbReady: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  dbReady ??= mod.migrate();
  await dbReady;
  const { env } = await import("../lib/server/env.ts");
  // A queued job stays queued: nothing in this file reaches a worker or a provider.
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
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

async function setSwitches(on: { audio?: boolean; transcribe?: boolean; dub?: boolean }) {
  const { query } = await db();
  for (const [k, v] of [["studio.audio.enabled", on.audio ?? false], ["studio.transcribe.enabled", on.transcribe ?? false], ["studio.dub.enabled", on.dub ?? false]] as const) {
    await query("INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, JSON.stringify(v)]);
  }
  (await import("../lib/server/settings.ts")).invalidateSettingsCache();
}
const allOn = () => setSwitches({ audio: true, transcribe: true, dub: true });

/** ffmpeg makes the fixture: a real file with these inputs and arguments. */
function make(name: string, args: readonly string[]): Uint8Array {
  const dir = mkdtempSync(path.join(tmpdir(), "p11-vin-"));
  try {
    const f = path.join(dir, name);
    const r = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args, f]);
    assert.equal(r.status, 0, String(r.stderr));
    return new Uint8Array(readFileSync(f));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const SIX = ["-f", "lavfi", "-i", "color=c=blue:size=64x48:rate=6", "-f", "lavfi", "-i", "sine", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"] as const;
const six = () => make("v.mp4", SIX);

const offsets = (b: Uint8Array, box: string): number[] => {
  const out: number[] = [];
  const hay = Buffer.from(b);
  for (let i = hay.indexOf(box); i >= 0; i = hay.indexOf(box, i + 1)) out.push(i + 4);
  return out;
};
/** Sets a version-0 `mvhd` / `mdhd` duration to `seconds` of its own timescale. */
function forgeDuration(b: Uint8Array, box: "mvhd" | "mdhd", seconds: number): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (const at of offsets(b, box)) v.setUint32(at + 16, seconds * v.getUint32(at + 12));
}
/** Squeezes every `stts` delta by `by`: the same samples on a shorter timeline. */
function forgeStts(b: Uint8Array, by: number): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (const at of offsets(b, "stts")) {
    const n = v.getUint32(at + 4);
    for (let i = 0; i < n; i++) v.setUint32(at + 8 + i * 8 + 4, Math.floor(v.getUint32(at + 8 + i * 8 + 4) / by));
  }
}

async function upload(cookie: string, bytes: Uint8Array, name: string, kind?: "video", tool?: "dub" | "transcribe"): Promise<{ status: number; body: { id?: string; seconds?: number; mime?: string; error?: string; code?: string } }> {
  const route = await import("../app/api/media/audio-inputs/route.ts");
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart], { type: kind === "video" ? "video/mp4" : "audio/mpeg" }), name);
  if (kind) form.append("kind", kind);
  if (tool) form.append("tool", tool);
  const req = new Request("http://localhost/api/media/audio-inputs", { method: "POST", headers: { cookie }, body: form });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as never };
}

test("upload: kind=video + a real MP4 is stored as video/mp4 with its seconds; the plain path and a wrong file are refused", { skip }, async (t) => {
  quiet(t);
  await allOn();
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
  assert.match(wrong.body.error ?? "", /MP4 yoki MOV/);
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
  await allOn();
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
  await allOn();
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

test("a forged MP4 is refused: `mvhd` alone, `mvhd` + `mdhd`, every table; fragmented, oversized, an MOV and a portrait clip", { skip }, async (t) => {
  quiet(t);
  await allOn();
  const cookie = await cookieOf(await mkUser());
  const billedOf = async (b: Uint8Array) => upload(cookie, b, "v.mp4", "video");
  assert.equal((await billedOf(six())).body.seconds, 6, "the untouched file");
  // `mvhd` = 1 s over 6 s of tracks: the stated length is not the file's.
  const a = six();
  forgeDuration(a, "mvhd", 1);
  const ra = await billedOf(a);
  assert.equal(ra.status, 422, "MUTATSIYA: a long video billed by `mvhd` alone");
  assert.match(ra.body.error ?? "", /buzilgan/);
  // `mvhd` and `mdhd` agree on 1 s, the samples' own `stts` says 6.
  const b = six();
  forgeDuration(b, "mvhd", 1);
  forgeDuration(b, "mdhd", 1);
  assert.equal((await billedOf(b)).status, 422, "MUTATSIYA: `stts` is read too");
  // No sound to count: a silent clip's `mvhd` and `mdhd` agree on 1 s, only its `stts` says 6.
  const mute = make("v.mp4", ["-f", "lavfi", "-i", "color=c=blue:size=64x48:rate=6", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
  forgeDuration(mute, "mvhd", 1);
  forgeDuration(mute, "mdhd", 1);
  assert.equal((await billedOf(mute)).status, 422, "MUTATSIYA: `stts` is the samples' own clock");
  // Every table says 1 s; the AAC frames still decode to 6 s of sound.
  const c = six();
  forgeDuration(c, "mvhd", 1);
  forgeDuration(c, "mdhd", 1);
  forgeStts(c, 6);
  assert.equal((await billedOf(c)).status, 422, "MUTATSIYA: the frames are counted against the timeline");
  // No sound to count and every table agrees on 1 s, but a minute's worth of pictures cannot fit it.
  const squeezed = make("v.mp4", ["-f", "lavfi", "-i", "color=c=blue:size=64x48:rate=60", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
  forgeDuration(squeezed, "mvhd", 1);
  forgeDuration(squeezed, "mdhd", 1);
  forgeStts(squeezed, 6);
  assert.equal((await billedOf(squeezed)).status, 422, "MUTATSIYA: more pictures a second than a camera makes");
  // A codec neither a provider nor our ffmpeg is promised: the first `stsd` is the picture's, the second the sound's.
  const forgeCodec = (track: number) => {
    const f = six();
    Buffer.from(f.buffer, f.byteOffset, f.byteLength).write("xxxx", offsets(f, "stsd")[track]! + 12, "latin1");
    return f;
  };
  const badPicture = await billedOf(forgeCodec(0));
  assert.equal(badPicture.status, 422);
  assert.match(badPicture.body.error ?? "", /video kodeki/, "MUTATSIYA: the picture's codec");
  const badSound = await billedOf(forgeCodec(1));
  assert.equal(badSound.status, 422);
  assert.match(badSound.body.error ?? "", /ovoz kodeki/, "MUTATSIYA: the sound's codec");
  const frag = await billedOf(make("v.mp4", [...SIX, "-movflags", "frag_keyframe+empty_moov"]));
  assert.equal(frag.status, 422);
  assert.match(frag.body.error ?? "", /fragmented/, "MUTATSIYA: a fragmented file has no sample tables to trust");
  // No `moov` table can be trusted for a count: `stts` cut to two entries, `stsz` still counts every sample.
  const short = six();
  new DataView(short.buffer, short.byteOffset, short.byteLength).setUint32(offsets(short, "stts")[1]! + 4, 2);
  const { mp4Probe } = await import("../lib/generation/studio/mix-media.ts");
  assert.ok(mp4Probe(short)!.tracks[1]!.samples > 2, "MUTATSIYA: `stsz` is read");
  // An iPhone's MOV goes through the same path.
  const mov = await upload(cookie, make("v.mov", SIX), "IMG_0001.MOV", "video");
  assert.equal(mov.status, 200, JSON.stringify(mov.body));
  assert.equal(mov.body.seconds, 6);
  // …and leaves the worker as a real MP4: what a provider receives is never the phone's container.
  const { capOwnVideo } = await import("../lib/generation/studio/own-video.ts");
  const capped = await capOwnVideo(make("v.mov", SIX), 6);
  assert.notEqual(Buffer.from(capped.slice(8, 12)).toString(), "qt  ", "MUTATSIYA: the cut rewrites the container");
  // The shape as shown: a stored portrait, and a landscape turned by a quarter.
  const { mp4Aspect } = await import("../lib/generation/studio/mix-media.ts");
  assert.equal(mp4Aspect(make("v.mp4", ["-f", "lavfi", "-i", "color=c=red:size=48x64:rate=2", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p"])), "9:16", "MUTATSIYA: a portrait upload is no 16:9");
  const portrait = await upload(cookie, make("v.mp4", ["-f", "lavfi", "-i", "color=c=red:size=48x64:rate=2", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p"]), "p.mp4", "video");
  const owner = String((await (await db()).query<{ user_id: string }>("SELECT user_id::text FROM studio_video_inputs WHERE id = $1", [portrait.body.id]))[0]!.user_id);
  const { speechToolJobCtx } = await import("../lib/server/media/speech-sources.ts");
  assert.equal((await speechToolJobCtx(owner, { source: `upload:${portrait.body.id}` } as never)).source?.aspect, "9:16", "MUTATSIYA: the worker's view of an own portrait");
  const turned = six();
  assert.equal(mp4Aspect(turned), "16:9");
  const v = new DataView(turned.buffer, turned.byteOffset, turned.byteLength);
  const matrix = offsets(turned, "tkhd")[0]! + 40;
  v.setUint32(matrix, 0);
  v.setUint32(matrix + 4, 0x10000);
  assert.equal(mp4Aspect(turned), "9:16", "MUTATSIYA: a phone's turned clip");
});

test("the worker cuts an own video to the billed seconds before any provider sees it: STT and dub", { skip }, async (t) => {
  quiet(t);
  await allOn();
  const me = await mkUser();
  const { query } = await db();
  // A file that got past the tables (an older row, a new trick): stored as billed 2 s, holding 6 s.
  const id = "b".repeat(24);
  const bytes = six();
  await query("INSERT INTO studio_video_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, 'video/mp4', $3, 2, 2, $4) ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id", [id, me, bytes.length, Buffer.from(bytes)]);
  const { speechToolJobCtx } = await import("../lib/server/media/speech-sources.ts");
  const { buildStudioTranscribe } = await import("../lib/generation/studio/transcribe.ts");
  const { buildStudioDub } = await import("../lib/generation/studio/dub.ts");
  const { mp4Probe } = await import("../lib/generation/studio/mix-media.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const values = { source: `upload:${id}`, sourceSeconds: 2, target: "uz" };
  const ctx = await speechToolJobCtx(me, values as never);
  const longest = (b64: string) => Math.max(...mp4Probe(new Uint8Array(Buffer.from(b64, "base64")))!.tracks.map((x) => x.seconds));
  let sent = "";
  const stt = async (i: { assets: { media: { base64: string }[] } }) => {
    sent = i.assets.media[0]!.base64;
    return { outputs: [{ kind: "inline", mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify({ text: "salom", language_code: "uz", words: [] })) }] };
  };
  await buildStudioTranscribe(TOOL_BY_ID["studio-transcribe"], values as never, ctx, {}, { run: stt as never });
  assert.ok(sent && longest(sent) <= 3.5, `MUTATSIYA: STT received ${longest(sent || "")} s for 2 billed`);
  let dubbed = "";
  const adapter = {
    id: "studio-elevenlabs-dub",
    configured: () => true,
    submit: async (r: { assets: { media: { base64: string }[] } }) => {
      dubbed = r.assets.media[0]!.base64;
      throw new Error("stop here");
    },
  };
  const health = { allow: () => true, success: () => undefined, failure: () => undefined };
  await assert.rejects(buildStudioDub(TOOL_BY_ID["studio-dub"], values as never, ctx, {}, { adapters: { "studio-elevenlabs-dub": adapter as never }, store: null, health }));
  assert.ok(dubbed && longest(dubbed) <= 3.5, `MUTATSIYA: dub received ${longest(dubbed || "")} s for 2 billed`);
  // A cut that fails is a refund before anything is paid.
  let called = false;
  const never = async () => ((called = true), { outputs: [] });
  await assert.rejects(buildStudioTranscribe(TOOL_BY_ID["studio-transcribe"], values as never, ctx, {}, { run: never as never, ffmpeg: async () => { throw new Error("no"); } }), /qaytariladi/);
  assert.equal(called, false, "no provider call without the cut");
});

test("a burn checks the picture before the paid speech call; the real picture check and burn cap a small and an odd-sized clip", { skip }, async (t) => {
  quiet(t);
  await allOn();
  const me = await mkUser();
  const { id } = (await upload(await cookieOf(me), videoMp4(), "clip.mp4", "video")).body;
  const { speechToolJobCtx } = await import("../lib/server/media/speech-sources.ts");
  const { buildStudioTranscribe } = await import("../lib/generation/studio/transcribe.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const values = { source: `upload:${id}`, sourceSeconds: 2, burn: true };
  const ctx = await speechToolJobCtx(me, values as never);
  let paid = false;
  const run = async () => ((paid = true), { outputs: [] });
  const { runFfmpeg } = await import("../lib/generation/studio/mix-ffmpeg.ts");
  const failCheck = async (r: { output: string }) => {
    if (r.output === "out-check.mp4") throw new Error("cannot decode");
    return runFfmpeg(r as never);
  };
  await assert.rejects(buildStudioTranscribe(TOOL_BY_ID["studio-transcribe"], values as never, ctx, {}, { run: run as never, ffmpeg: failCheck as never }), /qaytariladi/);
  assert.equal(paid, false, "MUTATSIYA: a picture ffmpeg cannot read must not cost the speech call");
  const { burnCheckArgs, BURN_CHECK_FILES } = await import("../lib/generation/studio/burn-args.ts");
  const out = await runFfmpeg({ inputs: { [BURN_CHECK_FILES.video]: make("o.mp4", ["-f", "lavfi", "-i", "color=c=red:size=65x49:rate=2", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv444p"]) }, args: burnCheckArgs(), output: BURN_CHECK_FILES.out });
  assert.ok(out.length > 0, "an odd-sized picture passes the scale");
});

test("through `submitGeneration`: an own video is charged for a burn and on HeyGen; an audio upload is refused for both, nothing charged", { skip }, async (t) => {
  quiet(t);
  await allOn();
  const { query } = await db();
  const { reloadProviderKeys } = await import("../lib/server/providers/store.ts");
  await reloadProviderKeys();
  const { HEYGEN_TRANSLATE_MODEL } = await import("../lib/media/catalog-transcribe.ts");
  await query("INSERT INTO media_model_overrides (model_id, enabled) VALUES ($1, TRUE) ON CONFLICT (model_id) DO UPDATE SET enabled = TRUE", [HEYGEN_TRANSLATE_MODEL]);
  (await import("../lib/server/media/overrides.ts")).invalidateMediaOverrides();
  const me = await mkUser();
  await query("UPDATE users SET balance = 900000 WHERE id = $1", [me]);
  const cookie = await cookieOf(me);
  const video = (await upload(cookie, videoMp4(), "clip.mp4", "video")).body.id!;
  const audioId = "c".repeat(24);
  const mp3 = mp3Bytes();
  await query("INSERT INTO studio_audio_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, 'audio/mpeg', $3, 5, 5, $4) ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id", [audioId, me, mp3.length, Buffer.from(mp3)]);
  const route = await import("../app/api/generations/route.ts");
  const post = async (slug: string, values: Record<string, unknown>) => {
    await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
    await query("UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED', 'IN_PROGRESS')");
    const req = new Request("http://localhost/api/generations", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ slug, values }) });
    const r = await inRequest(req, () => route.POST(req));
    return { status: r.status, body: (await r.json()) as { error?: string } };
  };
  const burn = await post("studio-transcribe", { source: `upload:${video}`, sourceSeconds: 2, burn: true });
  assert.equal(burn.status, 202, `MUTATSIYA: the offered burn was always refused: ${JSON.stringify(burn.body)}`);
  const heygen = await post("studio-dub", { modelId: HEYGEN_TRANSLATE_MODEL, source: `upload:${video}`, sourceSeconds: 2, target: "uz" });
  assert.equal(heygen.status, 202, `MUTATSIYA: HeyGen was offered an own video and refused it: ${JSON.stringify(heygen.body)}`);
  const audioBurn = await post("studio-transcribe", { source: `upload:${audioId}`, sourceSeconds: 5, burn: true });
  assert.equal(audioBurn.status, 400);
  assert.match(audioBurn.body.error ?? "", /faqat videoga/);
  const audioHeygen = await post("studio-dub", { modelId: HEYGEN_TRANSLATE_MODEL, source: `upload:${audioId}`, sourceSeconds: 5, target: "uz" });
  assert.equal(audioHeygen.status, 400);
  assert.match(audioHeygen.body.error ?? "", /faqat videoni/);
});

test("dark switches, the dub's size at the upload, the quota under a lock", { skip }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const cookie = await cookieOf(me);
  await setSwitches({});
  const off = await upload(cookie, videoMp4(), "clip.mp4", "video");
  assert.equal(off.status, 400, "MUTATSIYA: a dark section takes no upload");
  assert.equal(off.body.code, "tool_off");
  assert.equal((await upload(cookie, mp3Bytes(200), "a.mp3")).body.code, "tool_off");
  await setSwitches({ audio: true });
  assert.equal((await upload(cookie, mp3Bytes(200), "a.mp3")).status, 200, "the audio modes that are on keep their uploads");
  assert.equal((await upload(cookie, videoMp4(), "clip.mp4", "video")).body.code, "tool_off", "the audio modes take no video");
  await setSwitches({ transcribe: true });
  assert.equal((await upload(cookie, videoMp4(), "clip.mp4", "video", "transcribe")).status, 200);
  assert.equal((await upload(cookie, videoMp4(), "clip.mp4", "video", "dub")).body.code, "tool_off", "MUTATSIYA: the named tool decides");
  await allOn();
  const { DUB_VIDEO_MAX_BYTES } = await import("../lib/media/catalog-transcribe.ts");
  const tooBig = new Uint8Array(DUB_VIDEO_MAX_BYTES + 1);
  const big = await upload(cookie, tooBig, "clip.mp4", "video", "dub");
  assert.equal(big.status, 413, "MUTATSIYA: the dub's limit is said at the upload");
  assert.match(big.body.error ?? "", /24 MB/);
  // Room for one more file, two arrive together: exactly one passes.
  const { query } = await db();
  const racer = await mkUser();
  const cookieR = await cookieOf(racer);
  const { AUDIO_INPUT_USER_MAX_BYTES } = await import("../lib/media/catalog-audio.ts");
  const file = videoMp4();
  await query("INSERT INTO studio_video_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, 'video/mp4', $3, 2, 2, '\\x00')", ["d".repeat(24), racer, 26214400]);
  await query("INSERT INTO studio_video_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, 'video/mp4', $3, 2, 2, '\\x00')", ["e".repeat(24), racer, 26214400]);
  await query("INSERT INTO studio_video_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, 'video/mp4', $3, 2, 2, '\\x00')", ["f".repeat(24), racer, 26214400]);
  await query("INSERT INTO studio_audio_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, 'audio/mpeg', $3, 3, 3, '\\x00')", ["9".repeat(24), racer, AUDIO_INPUT_USER_MAX_BYTES - 3 * 26214400 - mp3Bytes(200).length - Math.floor(file.length * 1.5)]);
  let waiting: Promise<unknown> = Promise.resolve();
  // The check and the insert wait for the user's lock: while another upload holds it, this one cannot pass the quota.
  const { transaction } = await db();
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`studio_inputs:${racer}`]);
    let done = false;
    const held = upload(cookieR, mp3Bytes(200), "w.mp3").then((r) => ((done = true), r));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(done, false, "MUTATSIYA: the quota's check and insert run under the per-user lock");
    void held.catch(() => undefined);
    waiting = held;
  });
  await waiting;
  const raced = await Promise.all([upload(cookieR, file, "a.mp4", "video"), upload(cookieR, file, "b.mp4", "video")]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 429], "MUTATSIYA: two uploads at once both passed the quota");
});

/* ── the cut: what ffmpeg really kept (second review) ── */

let LONG: Uint8Array | null = null;
/** 10 s of picture, 300 s of 8 kHz AAC, the sound's `stts` and every length squeezed to 10 s: billed 10 s. */
function squeezed(): Uint8Array {
  LONG ??= make("l.mp4", ["-f", "lavfi", "-t", "10", "-i", "color=c=blue:size=64x48:rate=5", "-f", "lavfi", "-t", "300", "-i", "sine=frequency=300:sample_rate=8000", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "16k", "-movflags", "+faststart"]);
  const b = LONG.slice();
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const unit = v.getUint32(offsets(b, "mvhd")[0]! + 12);
  forgeDuration(b, "mvhd", 10);
  forgeDuration(b, "mdhd", 10);
  const a = offsets(b, "stts")[1]!;
  for (let i = 0; i < v.getUint32(a + 4); i++) v.setUint32(a + 8 + i * 8 + 4, 34);
  for (const at of offsets(b, "elst")) if (v.getUint32(at + 8) > 10 * unit) v.setUint32(at + 8, 10 * unit);
  return b;
}
const FORGED: Record<string, (b: Uint8Array, v: DataView) => void> = {
  "(a) stsd sample rate 0": (b, v) => v.setUint32(offsets(b, "stsd")[1]! + 8 + 32, 0),
  "(b) hdlr says text, stsd says mp4a": (b) => void Buffer.from(b.buffer, b.byteOffset, b.byteLength).write("text", offsets(b, "hdlr")[1]! + 8, "latin1"),
  "(c) stts entry count 2": (b, v) => v.setUint32(offsets(b, "stts")[1]! + 4, 2),
  "(d) trak overruns moov": (b, v) => {
    const at = offsets(b, "trak").at(-1)! - 8;
    v.setUint32(at, v.getUint32(at) + 4096);
  },
};
function forged(name: string): Uint8Array {
  const b = squeezed();
  FORGED[name]!(b, new DataView(b.buffer, b.byteOffset, b.byteLength));
  return b;
}
for (const name of Object.keys(FORGED)) {
  test(`forged ${name}: the cut refuses it, and no provider is reached on any path`, { skip }, async (t) => {
    quiet(t);
    await allOn();
    const bytes = forged(name);
    const { capOwnVideo } = await import("../lib/generation/studio/own-video.ts");
    await assert.rejects(capOwnVideo(bytes, 10), /refused|decodes|measures/, "MUTATSIYA: 300 s of sound left the worker under a 10 s label");
    const { buildStudioTranscribe } = await import("../lib/generation/studio/transcribe.ts");
    const { buildStudioDub } = await import("../lib/generation/studio/dub.ts");
    const { FAL_SCRIBE_MODEL, HEYGEN_TRANSLATE_MODEL } = await import("../lib/media/catalog-transcribe.ts");
    const { TOOL_BY_ID } = await import("../lib/tools.ts");
    const id = "a".repeat(24);
    const ctx = { source: { kind: "upload" as const, id, mime: "video/mp4", bytes, seconds: 10, aspect: "16:9" } };
    let reached = 0;
    const run = async () => (reached++, { outputs: [] });
    for (const modelId of ["", FAL_SCRIBE_MODEL]) {
      const values = { ...(modelId ? { modelId } : {}), source: `upload:${id}`, sourceSeconds: 10 };
      await assert.rejects(buildStudioTranscribe(TOOL_BY_ID["studio-transcribe"], values as never, ctx, {}, { run: run as never }), /qaytariladi/);
    }
    const adapter = { id: "x", configured: () => true, submit: async () => (reached++, { opId: "x" }), poll: async () => ({ state: "failed", message: "no" }) };
    const adapters = new Proxy({}, { get: () => adapter });
    const health = { allow: () => true, success: () => undefined, failure: () => undefined };
    await assert.rejects(buildStudioDub(TOOL_BY_ID["studio-dub"], { modelId: HEYGEN_TRANSLATE_MODEL, source: `upload:${id}`, sourceSeconds: 10, target: "uz" } as never, ctx, {}, { adapters: adapters as never, store: null, health }), /qaytariladi/);
    assert.equal(reached, 0, "MUTATSIYA: a provider received the forged file");
  });
}

test("HeyGen's picture path: 3000 frames squeezed into 10 s are refused on the cut; the decoded length is the last word over the tables", { skip }, async (t) => {
  quiet(t);
  const picture = make("p.mp4", ["-f", "lavfi", "-t", "300", "-i", "color=c=blue:size=64x48:rate=10", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
  forgeDuration(picture, "mvhd", 10);
  forgeDuration(picture, "mdhd", 10);
  forgeStts(picture, 30);
  const { capOwnVideo } = await import("../lib/generation/studio/own-video.ts");
  await assert.rejects(capOwnVideo(picture, 10), /refused/, "MUTATSIYA: the picture's frames are counted on the cut");
  // Tables that pass but a sound that decodes longer (HE-AAC states half its frames): only the decode can tell.
  const { runFfmpeg } = await import("../lib/generation/studio/mix-ffmpeg.ts");
  const long = new Uint8Array(417 * 1000);
  for (let i = 0; i < 1000; i++) long.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  const ff = async (r: { output: string }) => (r.output === "out-measure.mp3" ? long : runFfmpeg(r as never));
  await assert.rejects(capOwnVideo(videoMp4(), 2, ff as never), /decodes to/, "MUTATSIYA: the real seconds are measured");
  assert.ok((await capOwnVideo(videoMp4(), 2)).length > 0, "an honest file passes both");
});

test("the fal path's audio track is held to the billed seconds before the provider is paid", { skip }, async (t) => {
  quiet(t);
  await allOn();
  const { buildStudioTranscribe } = await import("../lib/generation/studio/transcribe.ts");
  const { FAL_SCRIBE_MODEL } = await import("../lib/media/catalog-transcribe.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const id = "e".repeat(32).slice(0, 8) + "-eeee-4eee-8eee-" + "e".repeat(12);
  const ctx = { source: { kind: "result" as const, id, mime: "video/mp4", bytes: videoMp4(), seconds: 2 } };
  let paid = false;
  const long = new Uint8Array(417 * 1000);
  for (let i = 0; i < 1000; i++) long.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  await assert.rejects(
    buildStudioTranscribe(TOOL_BY_ID["studio-transcribe"], { modelId: FAL_SCRIBE_MODEL, source: `result:${id}`, sourceSeconds: 2 } as never, ctx, {}, { run: (async () => ((paid = true), { outputs: [] })) as never, ffmpeg: (async () => long) as never }),
    /qaytariladi/,
  );
  assert.equal(paid, false, "MUTATSIYA: the Scribe MP3 has a length check");
});

test("false refusals: a large picture, QuickTime v2 sound, a second sound track, what a burn refuses and when", { skip }, async (t) => {
  quiet(t);
  await allOn();
  const me = await mkUser();
  const cookie = await cookieOf(me);
  const { capOwnVideo } = await import("../lib/generation/studio/own-video.ts");
  const large = make("v.mp4", ["-f", "lavfi", "-i", "color=c=red:size=2000x100:rate=2", "-f", "lavfi", "-i", "sine", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]);
  const up = await upload(cookie, large, "v.mp4", "video");
  assert.equal(up.status, 200, `MUTATSIYA: only a burn decodes the picture: ${JSON.stringify(up.body)}`);
  assert.ok((await capOwnVideo(large, 2)).length > 0);
  const { prepareSpeechToolRequest } = await import("../lib/server/media/speech-sources.ts");
  await prepareSpeechToolRequest(me, "studio-transcribe", { source: `upload:${up.body.id}`, sourceSeconds: 2 } as never);
  await assert.rejects(prepareSpeechToolRequest(me, "studio-transcribe", { source: `upload:${up.body.id}`, sourceSeconds: 2, burn: true } as never), /1920 px/, "MUTATSIYA: a burn refuses it before the charge");
  // 96 kHz in a MOV: the muxer writes a v2 sound entry, whose old rate field is the constant 1.
  const v2 = make("v.mov", ["-f", "lavfi", "-i", "color=c=red:size=64x48:rate=2", "-f", "lavfi", "-i", "sine=sample_rate=96000", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]);
  const r2 = await upload(cookie, v2, "v.mov", "video");
  assert.equal(r2.status, 200, `MUTATSIYA: a QuickTime v2 entry was refused: ${JSON.stringify(r2.body)}`);
  // A second sound track the cut never maps: another codec does not matter.
  const two = make("v.mov", ["-f", "lavfi", "-i", "color=c=red:size=64x48:rate=2", "-f", "lavfi", "-i", "sine", "-f", "lavfi", "-i", "sine=frequency=500", "-map", "0", "-map", "1", "-map", "2", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a:0", "aac", "-c:a:1", "pcm_s16le"]);
  const r3 = await upload(cookie, two, "v.mov", "video");
  assert.equal(r3.status, 200, `MUTATSIYA: the check follows what the cut maps: ${JSON.stringify(r3.body)}`);
  assert.ok((await capOwnVideo(two, 2)).length > 0);
  // Heavy for the burn's timeout: 240 frames a second for 3 minutes at 1080p; 3 minutes at 30 passes.
  const { burnProblem } = await import("../lib/generation/studio/burn-args.ts");
  assert.match(String(burnProblem({ width: 1920, height: 1080, samples: 240 * 180 })), /og‘ir/, "MUTATSIYA: a burn that would time out after the paid call");
  assert.equal(burnProblem({ width: 1920, height: 1080, samples: 30 * 180 }), null);
  // A missing ffmpeg is the service's fault, not the file's.
  const { buildStudioTranscribe } = await import("../lib/generation/studio/transcribe.ts");
  const { FfmpegMissingError } = await import("../lib/generation/studio/mix-ffmpeg.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const id = "a".repeat(24);
  const ctx = { source: { kind: "upload" as const, id, mime: "video/mp4", bytes: videoMp4(), seconds: 2 } };
  await assert.rejects(buildStudioTranscribe(TOOL_BY_ID["studio-transcribe"], { source: `upload:${id}`, sourceSeconds: 2 } as never, ctx, {}, { ffmpeg: async () => { throw new FfmpegMissingError(); } }), /xizmati hozircha/, "MUTATSIYA: the user's file was blamed");
});

test("the parser is bounded: 3 million empty `trak` boxes cost no memory and throw nothing", async () => {
  const { mp4Probe } = await import("../lib/generation/studio/mix-media.ts");
  const n = 3_000_000;
  const b = new Uint8Array(8 + 8 + 8 * n);
  const v = new DataView(b.buffer);
  b.set(new TextEncoder().encode("ftypisom"), 4);
  v.setUint32(0, 16);
  v.setUint32(16 - 0, 0);
  const moov = 16;
  const out = new Uint8Array(moov + 8 + 8 * n);
  out.set(b.subarray(0, 16));
  const w = new DataView(out.buffer);
  w.setUint32(moov, out.length - moov);
  out.set(new TextEncoder().encode("moov"), moov + 4);
  for (let i = 0; i < n; i++) {
    const at = moov + 8 + i * 8;
    w.setUint32(at, 8);
    out[at + 4] = 0x74; out[at + 5] = 0x72; out[at + 6] = 0x61; out[at + 7] = 0x6b;
  }
  const p = mp4Probe(out);
  assert.ok(p);
  assert.ok(p.tracks.length <= 16, "MUTATSIYA: the track count is capped");
  const { sniffVideo } = await import("../lib/server/media/audio-inputs.ts");
  assert.equal(sniffVideo(out), null, "no picture: no video, and no throw");
});
