import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P8c «Montaj» — money + ffmpeg flow on an isolated Postgres (docs/studio/P8-SPEC.md «P8c»). The sources are
 * finished generations written as rows (bytes made by the local ffmpeg); the mix itself runs the REAL ffmpeg through
 * the worker (`claimNext` → `runJob`). Without ffmpeg / ffprobe the real-run tests skip with a message.
 *
 *   refusals   another user's source, a source of the wrong role (music as the video, a picture as the audio), a
 *              too-long video, a start offset past the video → 400 BEFORE the charge (balance unchanged); a stale
 *              price → 409 `price_changed`; the price follows `studio.mix_price` and the tool's `tool_pricing` %;
 *   sources    `GET /api/media/mix-sources`: the caller's own results only, per role, + the base price;
 *   video      video + speech → COMPLETED MP4 (ffprobe: video + audio streams, the video's length), charged the shown
 *              price, stored format `mp4`, no provider spend in `cost_json` (P7c convention: ffmpeg costs nothing);
 *   voice      speech + music → COMPLETED MP3, length = the speech;
 *   refunds    ffmpeg missing on the worker (PATH emptied) → FAILED «hozircha ishlamayapti», full refund; a source
 *              deleted between the purchase and the run → FAILED, full refund.
 *
 * Mutations (each turned the named test red, then restored):
 *   `AND g.user_id = $1` dropped from the sources' `ROW_SQL`                         -> "refusals" (another user's video accepted), "sources";
 *   `prepareMixRequest` call removed from `submitGeneration`                          -> "refusals" (charged, 202);
 *   `fitsRole` role check returns true                                                -> "refusals" (music accepted as the video), "sources";
 *   `mixPrice` dropped from the server pricing block (always the default 500)         -> "refusals" (price 700 expected);
 *   the worker's `studioMix` ctx not passed to `build`                                 -> "video", "voice", "refunds" (every run FAILED);
 *   FfmpegMissingError mapped to the generic failure text                              -> "refunds".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiomix") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const ffSkip = skip || (HAS_FFMPEG ? false : "ffmpeg / ffprobe not installed on this machine — real «Montaj» runs skipped");

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

/* ── media fixtures (real ffmpeg) ── */
const fx = (() => {
  if (!HAS_FFMPEG) return null;
  const dir = mkdtempSync(path.join(tmpdir(), "mix-flow-"));
  const ff = (args: string[]) => assert.equal(spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { cwd: dir }).status, 0);
  ff(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=12", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "v.mp4"]);
  ff(["-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:a", "libmp3lame", "sp.mp3"]);
  ff(["-f", "lavfi", "-i", "sine=frequency=220:duration=2", "-ac", "2", "-c:a", "libmp3lame", "mu.mp3"]);
  const r = (n: string) => readFileSync(path.join(dir, n));
  const out = { video: r("v.mp4"), speech: r("sp.mp3"), music: r("mu.mp3") };
  rmSync(dir, { recursive: true, force: true });
  return out;
})();
function probe(bytes: Buffer, ext: string): { duration: number; streams: string[] } {
  const dir = mkdtempSync(path.join(tmpdir(), "mix-probe-"));
  try {
    const f = path.join(dir, `x.${ext}`);
    writeFileSync(f, bytes);
    const j = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", f], { encoding: "utf8" }).stdout) as { format: { duration: string }; streams: { codec_type: string }[] };
    return { duration: Number(j.format.duration), streams: j.streams.map((s) => s.codec_type).sort() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Bytes for refusal tests (never decoded: the pre-charge check reads the stored seconds). */
const FAKE = Buffer.from([0, 1, 2, 3]);

let dbReady: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  dbReady ??= mod.migrate();
  await dbReady;
  const { env } = await import("../lib/server/env.ts");
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
  return mod;
}
after(async () => {
  if (!dbReady) return;
  const { stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
  stopProviderKeyRefresh();
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

let seq = 0;
async function mkUser(balance = 100_000): Promise<string> {
  const { query } = await db();
  return String((await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Mix', 0, 0, $2) RETURNING id", [`mix-${process.pid}-${seq++}`, balance]))[0]!.id);
}
async function balanceOf(userId: string): Promise<number> {
  const { query } = await db();
  return Number((await query<{ b: string }>("SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1", [userId]))[0]!.b);
}
async function cookie(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
/** A finished source generation of `userId` (row + file). */
async function source(userId: string, tool: string, mime: string, bytes: Buffer, doc: Record<string, unknown>, topic = "Manba"): Promise<string> {
  const { query } = await db();
  const id = randomUUID();
  const format = mime === "video/mp4" ? "mp4" : mime === "audio/mpeg" ? "mp3" : "png";
  await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, doc_json) VALUES ($1, $2, $3, $4, 'COMPLETED', 500, $5, $6::jsonb)`, [id, userId, tool, topic, format, JSON.stringify(doc)]);
  await query(`INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4, $5)`, [id, `src.${format}`, mime, bytes.length, bytes]);
  return id;
}
const videoDoc = (seconds: number) => ({ meta: {}, video: { provider: "kling", prompt: "p", aspect: "16:9", requestedSeconds: seconds, seconds, fromImage: false, model: "kling/kling-3" } });
const speechDoc = (seconds: number) => ({ meta: {}, speech: { model: "elevenlabs/v3", seconds, chars: 10, voices: ["A"], lines: [], clone: false } });
const musicDoc = (seconds: number) => ({ meta: {}, studioAudio: { mode: "music", model: "elevenlabs/music", seconds, prompt: "lofi", inputSeconds: null, voices: [], clone: false, variants: [] } });

async function setPrice(n: number | null) {
  const { query } = await db();
  if (n === null) await query("DELETE FROM app_settings WHERE key = 'studio.mix_price'");
  else await query("INSERT INTO app_settings (key, value, updated_at) VALUES ('studio.mix_price', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(n)]);
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  invalidateSettingsCache();
}
async function post(userId: string, values: Record<string, unknown>, expectedPrice?: number) {
  const route = await import("../app/api/generations/route.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
  const req = new Request("http://localhost/api/generations", {
    method: "POST",
    headers: { cookie: await cookie(userId), "content-type": "application/json" },
    body: JSON.stringify({ slug: "studio-mix", values, ...(expectedPrice !== undefined ? { expectedPrice } : {}) }),
  });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; price?: number } };
}
async function runNext(expectId: string) {
  const worker = await import("../lib/server/worker.ts");
  const job = await worker.claimNext();
  assert.equal(job?.id, expectId);
  await worker.runJob(job!);
  const { getGeneration } = await import("../lib/server/jobs.ts");
  return getGeneration(expectId, (job as { userId: string }).userId);
}
async function idle() {
  await (await db()).query("UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED', 'IN_PROGRESS')");
}
async function fileOf(id: string) {
  const { query } = await db();
  return (await query<{ mime: string; bytes: Buffer; format: string; cost: unknown }>("SELECT f.mime, f.bytes, g.format, g.cost_json AS cost FROM generation_files f JOIN generations g ON g.id = f.generation_id WHERE f.generation_id = $1", [id]))[0];
}

const VIDEO_MODE = "studio/mix-video";
const VOICE_MODE = "studio/mix-voice";

test("refusals before the charge; price = studio.mix_price + tool %; stale price → 409", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  const me = await mkUser();
  const other = await mkUser();
  const myVideo = await source(me, "studio-video", "video/mp4", FAKE, videoDoc(8));
  const mySpeech = await source(me, "studio-speech", "audio/mpeg", FAKE, speechDoc(3));
  const myMusic = await source(me, "studio-audio", "audio/mpeg", FAKE, musicDoc(30));
  const myPicture = await source(me, "studio-image", "image/png", FAKE, { meta: {}, images: [] });
  const longVideo = await source(me, "studio-video", "video/mp4", FAKE, videoDoc(200));
  const theirVideo = await source(other, "studio-video", "video/mp4", FAKE, videoDoc(8));
  // A stored size near the 25 MB file cap: copied video + the new AAC track cannot fit (review MINOR 1).
  const bigVideo = await source(me, "studio-video", "video/mp4", FAKE, videoDoc(60));
  await query("UPDATE generation_files SET size_bytes = $2 WHERE generation_id = $1", [bigVideo, 24 * 1024 * 1024]);
  await idle();

  const cases: [string, Record<string, unknown>, string][] = [
    ["another user's video", { modelId: VIDEO_MODE, videoId: theirVideo, audioId: mySpeech }, "input_missing"],
    ["music as the video", { modelId: VIDEO_MODE, videoId: myMusic, audioId: mySpeech }, "input_missing"],
    ["a picture as the audio", { modelId: VIDEO_MODE, videoId: myVideo, audioId: myPicture }, "input_missing"],
    ["a speech as the music", { modelId: VOICE_MODE, speechId: mySpeech, musicId: mySpeech }, ""],
    ["a video over 3 min", { modelId: VIDEO_MODE, videoId: longVideo, audioId: mySpeech }, "input_invalid"],
    ["a video whose result cannot fit 25 MB", { modelId: VIDEO_MODE, videoId: bigVideo, audioId: mySpeech }, "input_invalid"],
    ["an offset past the video", { modelId: VIDEO_MODE, videoId: myVideo, audioId: mySpeech, startOffset: 8 }, "input_invalid"],
    ["a speech as the music (distinct ids)", { modelId: VOICE_MODE, speechId: mySpeech, musicId: await source(me, "studio-speech", "audio/mpeg", FAKE, speechDoc(4)) }, "input_missing"],
  ];
  for (const [name, values, code] of cases) {
    const r = await post(me, values);
    assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.body)}`);
    if (code) assert.equal(r.body.code, code, name);
  }
  assert.equal(await balanceOf(me), 100_000, "nothing charged by any refusal");
  assert.equal(Number((await query<{ n: string }>("SELECT count(*)::text AS n FROM generations WHERE user_id = $1 AND tool_id = 'studio-mix'", [me]))[0]!.n), 0, "nothing queued");

  // Price: the setting, then the tool's %; a stale preview is a 409 with the new price.
  const ok = { modelId: VIDEO_MODE, videoId: myVideo, audioId: mySpeech };
  await setPrice(700);
  t.after(() => setPrice(null));
  const stale = await post(me, ok, 500);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "price_changed");
  assert.equal(stale.body.price, 700);
  await query("INSERT INTO tool_pricing (tool_id, percent, round_to) VALUES ('studio-mix', 150, 100) ON CONFLICT (tool_id) DO UPDATE SET percent = 150, round_to = 100");
  const { invalidatePricingCache } = await import("../lib/server/pricing.ts");
  invalidatePricingCache();
  t.after(async () => {
    await query("DELETE FROM tool_pricing WHERE tool_id = 'studio-mix'");
    invalidatePricingCache();
  });
  const charged = await post(me, ok, 1_100);
  assert.equal(charged.status, 202, JSON.stringify(charged.body));
  assert.equal(charged.body.price, 1_100, "700 × 150 % = 1 050 → rounded up to 100");
  assert.equal(await balanceOf(me), 100_000 - 1_100, "charged exactly the shown price");
  // The admin price ladder reads the same formula.
  const { ladderFor } = await import("../lib/server/admin-pricing.ts");
  assert.equal(ladderFor("studio-mix", { soumPerUsd: 1, markup: 2, step: 100, overrides: {}, mixPrice: 700 })[0]!.base, 700);
});

test("sources: the caller's own finished results per role + the base price", { skip }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const other = await mkUser();
  const v = await source(me, "studio-video", "video/mp4", FAKE, videoDoc(8), "Mening videom");
  const s = await source(me, "podcast", "audio/mpeg", FAKE, { meta: {}, audio: { seconds: 60, script: [] } }, "Podkastim");
  const m = await source(me, "studio-audio", "audio/mpeg", FAKE, musicDoc(30), "Kuy");
  await source(other, "studio-video", "video/mp4", FAKE, videoDoc(8), "Begona");
  const route = await import("../app/api/media/mix-sources/route.ts");
  const req = new Request("http://localhost/api/media/mix-sources", { headers: { cookie: await cookie(me) } });
  const r = await inRequest(req, () => route.GET(req));
  assert.equal(r.status, 200);
  const body = (await r.json()) as { price: number; video: { id: string; title: string; kind: string; seconds: number }[]; audio: { id: string }[]; speech: { id: string }[]; music: { id: string }[] };
  assert.equal(body.price, 500);
  assert.deepEqual(body.video.map((x) => [x.id, x.title, x.kind, x.seconds]), [[v, "Mening videom", "Video", 8]]);
  assert.deepEqual(body.audio.map((x) => x.id).sort(), [s, m].sort(), "every own MP3 can go onto a video");
  assert.deepEqual(body.speech.map((x) => x.id), [s], "a podcast is a speech, music is not");
  assert.deepEqual(body.music.map((x) => x.id), [m]);
  assert.ok(!JSON.stringify(body).includes("Begona"), "another user's result is never listed");
});

test("video: video + speech → MP4 through the worker and the real ffmpeg (ffprobe: both streams, the video's length)", { skip: ffSkip }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const v = await source(me, "studio-video", "video/mp4", fx!.video, videoDoc(5));
  const s = await source(me, "studio-speech", "audio/mpeg", fx!.speech, speechDoc(3));
  await idle();
  const r = await post(me, { modelId: VIDEO_MODE, videoId: v, audioId: s, keepOriginal: true, audioVolume: 120, startOffset: 1 }, 500);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(await balanceOf(me), 100_000 - 500);
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  const f = await fileOf(r.body.id!);
  assert.equal(f?.mime, "video/mp4");
  assert.equal(f?.format, "mp4", "the stored format follows the real file");
  const p = probe(f!.bytes, "mp4");
  assert.deepEqual(p.streams, ["audio", "video"]);
  assert.ok(Math.abs(p.duration - 5) < 0.25, `the video's length (${p.duration})`);
  assert.equal(gen?.doc?.mix?.mode, "video-voice");
  assert.deepEqual(gen?.doc?.mix?.sources, [v, s]);
  assert.equal(gen?.doc?.mix?.options.keepOriginal, true);
  assert.equal(gen?.doc?.video?.seconds, gen?.doc?.mix?.seconds);
  assert.equal(f?.cost ?? null, null, "no provider spend recorded (ffmpeg costs nothing — P7c convention)");
  assert.equal(await balanceOf(me), 100_000 - 500, "no refund on success");
  // A mixed MP4 is a video source too (a second pass is possible).
  const { listMixSources } = await import("../lib/server/media/mix-sources.ts");
  assert.ok((await listMixSources(me)).video.some((x) => x.id === r.body.id && x.kind === "Montaj"));
});

test("voice: speech + music → MP3 through the worker, length = the speech", { skip: ffSkip }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const s = await source(me, "greeting", "audio/mpeg", fx!.speech, { meta: {}, audio: { seconds: 3, script: [] } });
  const m = await source(me, "studio-audio", "audio/mpeg", fx!.music, musicDoc(2));
  await idle();
  const r = await post(me, { modelId: VOICE_MODE, speechId: s, musicId: m, musicVolume: 25, ducking: true, fadeOut: 1 }, 500);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  const f = await fileOf(r.body.id!);
  assert.equal(f?.mime, "audio/mpeg");
  assert.equal(f?.format, "mp3");
  const p = probe(f!.bytes, "mp3");
  assert.deepEqual(p.streams, ["audio"]);
  assert.ok(Math.abs(p.duration - 3) < 0.2, `length = the speech (${p.duration})`);
  assert.equal(gen?.doc?.mix?.output, "mp3");
});

test("refunds: ffmpeg missing on the worker; a source deleted before the run", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  const me = await mkUser();
  // Real bytes when ffmpeg exists; the missing-binary case fails before decoding anything else either way.
  const v = await source(me, "studio-video", "video/mp4", fx?.video ?? FAKE, videoDoc(5));
  const s = await source(me, "studio-speech", "audio/mpeg", fx?.speech ?? FAKE, speechDoc(3));
  await idle();
  if (fx) {
    const r = await post(me, { modelId: VIDEO_MODE, videoId: v, audioId: s }, 500);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const path0 = process.env.PATH;
    process.env.PATH = "/nonexistent";
    t.after(() => void (process.env.PATH = path0));
    let gen;
    try {
      gen = await runNext(r.body.id!);
    } finally {
      process.env.PATH = path0;
    }
    assert.equal(gen?.status, "FAILED");
    assert.match(String(gen?.error), /hozircha ishlamayapti/);
    assert.equal(await balanceOf(me), 100_000, "full refund (ffmpeg missing)");
  }
  const r2 = await post(me, { modelId: VIDEO_MODE, videoId: v, audioId: s }, 500);
  assert.equal(r2.status, 202, JSON.stringify(r2.body));
  assert.equal(await balanceOf(me), 100_000 - 500);
  await query("UPDATE generations SET files_purged_at = now() WHERE id = $1", [s]);
  const gen2 = await runNext(r2.body.id!);
  assert.equal(gen2?.status, "FAILED");
  assert.match(String(gen2?.error), /topilmadi/);
  assert.equal(await balanceOf(me), 100_000, "full refund (source gone)");
});
