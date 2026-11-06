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
const skip = !(hasDb && iso.isolated) ? "isolated Postgres database is not available" : !HAS_FFMPEG ? "ffmpeg not installed — a real MP4 is needed" : false;

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
  // Every table says 1 s; the AAC frames still decode to 6 s of sound.
  const c = six();
  forgeDuration(c, "mvhd", 1);
  forgeDuration(c, "mdhd", 1);
  forgeStts(c, 6);
  assert.equal((await billedOf(c)).status, 422, "MUTATSIYA: the frames are counted against the timeline");
  const frag = await billedOf(make("v.mp4", [...SIX, "-movflags", "frag_keyframe+empty_moov"]));
  assert.equal(frag.status, 422);
  assert.match(frag.body.error ?? "", /fragmented/, "MUTATSIYA: a fragmented file has no sample tables to trust");
  const big = await billedOf(make("v.mp4", ["-f", "lavfi", "-i", "color=c=red:size=2000x100:rate=2", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p"]));
  assert.equal(big.status, 422);
  assert.match(big.body.error ?? "", /1920 px/, "MUTATSIYA: the long side is capped at the upload");
  // An iPhone's MOV goes through the same path.
  const mov = await upload(cookie, make("v.mov", SIX), "IMG_0001.MOV", "video");
  assert.equal(mov.status, 200, JSON.stringify(mov.body));
  assert.equal(mov.body.seconds, 6);
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
  await query("INSERT INTO studio_audio_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, 'audio/mpeg', $3, 3, 3, '\\x00')", ["9".repeat(24), racer, AUDIO_INPUT_USER_MAX_BYTES - 3 * 26214400 - Math.floor(file.length * 1.5)]);
  const raced = await Promise.all([upload(cookieR, file, "a.mp4", "video"), upload(cookieR, file, "b.mp4", "video")]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 429], "MUTATSIYA: two uploads at once both passed the quota");
});
