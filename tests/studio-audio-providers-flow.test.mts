import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P11 package E through the real route, Postgres and worker, with ONLY the fal key: no ElevenLabs key exists here,
 * so a model that needed one could not run. Every fal call is a stubbed `fetch`.
 *
 *   gating      `defaultOff`: unlisted and refused (400, nothing charged) until the admin's override turns it on;
 *   transcribe  charged the fal price, the source uploaded, the worker's `media_jobs` row and `cost_json` say fal; a 500 refunds;
 *   dub         HeyGen refuses an audio source before charging; fal dubbing's short clip is charged the whole minute; a parked
 *               fal op resumes without a second upload or submit;
 *   audio       VEED and SFX v3 through the worker, the stored file is an MP3;
 *   speech      Eleven v4 Turbo through the worker; a voice fal does not have is refused;
 *   housekeeping an orphaned fal op is cancelled at fal, by its op id, not at ElevenLabs.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `speechToolUnavailable` ignores the request's model                       -> "transcribe", "dub: HeyGen", "dub: fal";
 *   2. `speechToolModels` lists the tool's default model only                    -> "gating";
 *   3. `transcribeEntry` always the default in the engine                        -> "transcribe";
 *   4. the HeyGen refusal removed from `prepareSpeechToolRequest`                -> "dub: HeyGen";
 *   5. `defaultStore` built from the default entry (provider "elevenlabs")       -> "dub: HeyGen";
 *   6. the housekeeping's `fal:` routing removed                                 -> "housekeeping";
 *   review fixes:
 *   7. `failMediaJob` no longer strips URLs                                      -> "URLs";
 *   8. `failSubmittingMediaJob` no longer strips URLs                            -> "URLs";
 *   9. the upload not noted on the row                                           -> "upload: the row";
 *  10. the row's upload ignored on resume                                        -> "dub: fal";
 *  11. housekeeping leaves the upload / keeps it on the row / takes a live job's -> "upload: housekeeping";
 *  12. the overrun's default report removed                                      -> "dub: HeyGen".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.FAL_KEY = "fal0000-flow-key:5ecr3t5ecr3t";
delete process.env.ELEVENLABS_API_KEY;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studioe") : { isolated: false, drop: async () => {} };
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = !hasDb || !iso.isolated ? "isolated Postgres database is not available" : !HAS_FFMPEG ? "ffmpeg not installed" : false;

const FAL_SCRIBE = "elevenlabs/scribe-v2-fal";
const FAL_DUB = "elevenlabs/dubbing-fal";
const HEYGEN = "heygen/translate-speed";
const FAL_SFX = "elevenlabs/sfx-v3-fal";
const VEED = "veed/clean-audio";
const V4 = "elevenlabs/eleven-v4-turbo-fal";
const ALL = [FAL_SCRIBE, FAL_DUB, HEYGEN, FAL_SFX, VEED, V4, "elevenlabs/eleven-v3-fal"];
const RACHEL = "21m00Tcm4TlvDq8ikWAM";
const ADAM = "pNInz6obpgDQGcFmaJgB";
const REQ = "req-flow-0123456789";
const UPLOAD = "https://v3.fal.media/upload/flow?sig=abc";
const FILE = "https://v3b.fal.media/files/b/0a/input.bin";

const REAL_FETCH = globalThis.fetch;
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
function mp3Bytes(frames = 80): Buffer {
  const out = Buffer.alloc(417 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}
const VIDEOS = new Map<number, Buffer>();
function videoMp4(seconds = 2): Buffer {
  const known = VIDEOS.get(seconds);
  if (known) return known;
  const dir = mkdtempSync(path.join(tmpdir(), "p11-flow-"));
  try {
    const f = path.join(dir, "v.mp4");
    const r = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:size=64x48:rate=6", "-f", "lavfi", "-i", "sine", "-t", String(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f]);
    assert.equal(r.status, 0);
    const bytes = readFileSync(f);
    VIDEOS.set(seconds, bytes);
    return bytes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
let mode: { result: unknown; resultStatus: number; download: Uint8Array; submit?: () => Response } = { result: {}, resultStatus: 200, download: mp3Bytes() };
function installFetch() {
  globalThis.fetch = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u);
    const method = String(init.method ?? "GET");
    let body: unknown = null;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    calls.push({ url, method, body });
    if (url.startsWith("https://rest.fal.ai/storage/upload/initiate")) return json(200, { upload_url: UPLOAD, file_url: FILE });
    if (url === UPLOAD) return new Response(null, { status: 200 });
    if (url === "https://rest.fal.ai/storage/files/delete") return json(200, {});
    if (url.endsWith("/cancel")) return json(200, {});
    if (url.endsWith("/status")) return json(200, { status: "COMPLETED" });
    if (url.includes(`/requests/${REQ}`)) return json(mode.resultStatus, mode.result);
    if (url.startsWith("https://queue.fal.run/")) return mode.submit?.() ?? json(200, { request_id: REQ });
    if (url.startsWith("https://v3.fal.media/out")) return new Response(new Uint8Array(mode.download), { status: 200 });
    return json(404, {});
  }) as unknown as typeof fetch;
}

let dbReady: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  dbReady ??= mod.migrate();
  await dbReady;
  const { env } = await import("../lib/server/env.ts");
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
  const { setSafeFetchLookup } = await import("../lib/generation/safe-fetch.ts");
  setSafeFetchLookup(async () => ["93.184.216.34"]);
  return mod;
}
after(async () => {
  globalThis.fetch = REAL_FETCH;
  if (!dbReady) return;
  const { setSafeFetchLookup } = await import("../lib/generation/safe-fetch.ts");
  setSafeFetchLookup(null);
  const { stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
  stopProviderKeyRefresh();
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

let seq = 0;
async function mkUser(balance = 500_000): Promise<string> {
  const { query } = await db();
  return String((await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'P11', 0, 0, $2) RETURNING id", [`p11-${process.pid}-${seq++}`, balance]))[0]!.id);
}
async function balanceOf(userId: string): Promise<number> {
  const { query } = await db();
  return Number((await query<{ b: string }>("SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1", [userId]))[0]!.b);
}
async function cookie(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
async function source(userId: string, tool: string, mime: string, bytes: Buffer, doc: Record<string, unknown>): Promise<string> {
  const { query } = await db();
  const id = randomUUID();
  const format = mime === "video/mp4" ? "mp4" : "mp3";
  await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, doc_json) VALUES ($1, $2, $3, 'Manba', 'COMPLETED', 500, $4, $5::jsonb)`, [id, userId, tool, format, JSON.stringify(doc)]);
  await query(`INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4, $5)`, [id, `src.${format}`, mime, bytes.length, bytes]);
  return id;
}
async function upload(userId: string, seconds: number): Promise<string> {
  const { query } = await db();
  const id = randomUUID().replace(/-/g, "").slice(0, 24);
  const bytes = mp3Bytes(40);
  await query("INSERT INTO studio_audio_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, 'audio/mpeg', $3, $4, $5, $6)", [id, userId, bytes.length, seconds, Math.ceil(seconds), bytes]);
  return id;
}
const speechDoc = (seconds: number) => ({ meta: {}, speech: { model: "elevenlabs/eleven-v3", seconds, chars: 10, voices: ["A"], lines: [], clone: false } });
const videoDoc = (seconds: number) => ({ meta: {}, video: { provider: "kling", prompt: "p", aspect: "16:9", requestedSeconds: seconds, seconds, fromImage: false, model: "kling/kling-3" } });

async function settings(on: boolean) {
  const { query } = await db();
  for (const k of ["studio.transcribe.enabled", "studio.dub.enabled", "studio.audio.enabled", "studio.voice.enabled"]) {
    await query("INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, JSON.stringify(on)]);
  }
  await refresh();
}
async function refresh() {
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  invalidateSettingsCache();
  const { reloadProviderKeys } = await import("../lib/server/providers/store.ts");
  await reloadProviderKeys();
  const { invalidateMediaOverrides } = await import("../lib/server/media/overrides.ts");
  invalidateMediaOverrides();
  const { invalidatePricingCache } = await import("../lib/server/pricing.ts");
  invalidatePricingCache();
}
/** The admin's switch of the new models («Media modellari»): `null` = no row, the shipped default. */
async function adminSwitch(enabled: boolean | null) {
  const { query } = await db();
  for (const id of ALL) {
    await query("DELETE FROM media_model_overrides WHERE model_id = $1", [id]);
    if (enabled !== null) await query("INSERT INTO media_model_overrides (model_id, enabled) VALUES ($1, $2)", [id, enabled]);
  }
  await refresh();
}
async function post(userId: string, slug: string, values: Record<string, unknown>, expectedPrice?: number) {
  const route = await import("../app/api/generations/route.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
  const req = new Request("http://localhost/api/generations", {
    method: "POST",
    headers: { cookie: await cookie(userId), "content-type": "application/json" },
    body: JSON.stringify({ slug, values, ...(expectedPrice !== undefined ? { expectedPrice } : {}) }),
  });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; price?: number } };
}
async function idle() {
  await (await db()).query("UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED', 'IN_PROGRESS')");
}
async function runNext(expectId: string) {
  const worker = await import("../lib/server/worker.ts");
  const job = await worker.claimNext();
  assert.equal(job?.id, expectId);
  await worker.runJob(job!);
  const { getGeneration } = await import("../lib/server/jobs.ts");
  return getGeneration(expectId, (job as { userId: string }).userId);
}
async function priceOf(toolId: "studio-transcribe" | "studio-dub" | "studio-audio" | "studio-speech", values: Record<string, unknown>): Promise<number> {
  const { effectivePrice } = await import("../lib/server/pricing.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  return effectivePrice(TOOL_BY_ID[toolId], values as never);
}
const stt = { text: "Assalomu alaykum", language_code: "uzb", language_probability: 1, words: [{ text: "Assalomu", start: 0.1, end: 0.6, type: "word" }, { text: "alaykum", start: 0.7, end: 1.2, type: "word" }] };

test("gating: with the fal key alone every new model stays hidden and refused until the admin's switch", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await settings(true);
  await adminSwitch(null);
  const { mediaCatalog } = await import("../lib/server/media/public.ts");
  const { speechToolModels } = await import("../lib/server/media/speech-sources.ts");
  const listed = async () => (await mediaCatalog("studio.audio")).models.map((m) => m.id);
  assert.deepEqual(await listed(), [], "nothing: no ElevenLabs key, and the fal models ship off");
  assert.deepEqual((await mediaCatalog("studio.speech")).models.map((m) => m.id), [], "the same in «Ovoz»");
  const me = await mkUser();
  const src = await source(me, "studio-speech", "audio/mpeg", mp3Bytes(), speechDoc(3));
  await idle();
  const refused = await post(me, "studio-transcribe", { modelId: FAL_SCRIBE, source: `result:${src}`, sourceSeconds: 3 });
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal(refused.body.code, "model_unavailable");
  assert.equal(await balanceOf(me), 500_000, "nothing charged");
  assert.equal(calls.length, 0, "no call left the box");

  await adminSwitch(true);
  assert.deepEqual(await listed(), [FAL_SFX, VEED, FAL_SCRIBE, FAL_DUB, HEYGEN], "the admin's switch, with nothing but the fal key");
  assert.deepEqual(await speechToolModels(), [FAL_SCRIBE, FAL_DUB, HEYGEN]);
  assert.deepEqual((await mediaCatalog("studio.speech")).models.map((m) => m.id).sort(), ["elevenlabs/eleven-v3-fal", V4].sort());

  // The default model has no key here: a request naming it is refused, the fal one is not.
  const direct = await post(me, "studio-transcribe", { modelId: "elevenlabs/scribe-v2", source: `result:${src}`, sourceSeconds: 3 });
  assert.equal(direct.body.code, "model_unavailable");
  // An off switch on one fal model does not hide the other tool.
  const { query } = await db();
  await query("UPDATE media_model_overrides SET enabled = false WHERE model_id = $1", [FAL_SCRIBE]);
  await refresh();
  assert.deepEqual(await speechToolModels(), [FAL_DUB, HEYGEN]);
  await adminSwitch(true);
});

test("transcribe: charged the fal price, the upload and the row say fal, cost_json too; a 500 refunds", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await settings(true);
  await adminSwitch(true);
  const { query } = await db();
  const me = await mkUser();
  const src = await source(me, "studio-speech", "audio/mpeg", mp3Bytes(), speechDoc(3));
  await idle();
  const values = { modelId: FAL_SCRIBE, source: `result:${src}`, sourceSeconds: 3, language: "uz" };
  const price = await priceOf("studio-transcribe", values);
  assert.equal(price, 300, "3 s bill a whole minute at $0.008, still below the 800 of the ElevenLabs model");
  const r = await post(me, "studio-transcribe", values, price);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(await balanceOf(me), 500_000 - price);
  calls.length = 0;
  mode = { result: stt, resultStatus: 200, download: mp3Bytes() };
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  assert.equal(gen?.doc?.transcribe?.model, FAL_SCRIBE);
  assert.equal(gen?.doc?.transcribe?.language, "uz", "fal's three-letter code came back as ours");
  assert.ok(!calls.some((c) => c.url.includes("elevenlabs.io")), "no ElevenLabs call");
  const submit = calls.find((c) => c.url === "https://queue.fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2")!;
  assert.deepEqual(submit.body, { audio_url: FILE, tag_audio_events: false, diarize: false, language_code: "uzb" });
  assert.ok(calls.some((c) => c.url === "https://rest.fal.ai/storage/files/delete"));
  const rows = await query<{ provider: string; model_id: string; status: string; cost_usd: string }>("SELECT provider, model_id, status, cost_usd FROM media_jobs WHERE generation_id = $1", [r.body.id]);
  assert.deepEqual(rows.map((x) => [x.provider, x.model_id, x.status]), [["fal", FAL_SCRIBE, "succeeded"]]);
  assert.ok(Math.abs(Number(rows[0]!.cost_usd) - 0.008) < 1e-6, "the quoted cost is the billed minute");
  const cost = (await query<{ c: { provider: string; parts: { provider: string }[] } }>("SELECT cost_json AS c FROM generations WHERE id = $1", [r.body.id]))[0]!.c;
  assert.equal(cost.parts[0]!.provider, "fal");

  mode = { result: { detail: "boom" }, resultStatus: 500, download: mp3Bytes() };
  const r2 = await post(me, "studio-transcribe", values, price);
  const g2 = await runNext(r2.body.id!);
  assert.equal(g2?.status, "FAILED");
  assert.match(String(g2?.error), /Pul balansingizga qaytariladi/);
  assert.equal(await balanceOf(me), 500_000 - price, "the failed job was refunded in full");
});

test("dub: HeyGen refuses audio before charging; a video is translated, its row and file are fal's", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await settings(true);
  await adminSwitch(true);
  const { DUB_CLOCK } = await import("../lib/generation/studio/dub.ts");
  const sleep0 = DUB_CLOCK.sleep;
  DUB_CLOCK.sleep = async () => {};
  t.after(() => void (DUB_CLOCK.sleep = sleep0));
  const { query } = await db();
  const me = await mkUser();
  const audio = await source(me, "studio-speech", "audio/mpeg", mp3Bytes(), speechDoc(3));
  const up = await upload(me, 5);
  const video = await source(me, "studio-video", "video/mp4", videoMp4(), videoDoc(2));
  await idle();

  for (const src of [`result:${audio}`, `upload:${up}`]) {
    const r = await post(me, "studio-dub", { modelId: HEYGEN, source: src, sourceSeconds: 3 });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(String(r.body.error), /faqat videoni/);
  }
  assert.equal(await balanceOf(me), 500_000, "nothing charged");

  const values = { modelId: HEYGEN, source: `result:${video}`, sourceSeconds: 2, target: "uz" };
  const price = await priceOf("studio-dub", values);
  const r = await post(me, "studio-dub", values, price);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  calls.length = 0;
  mode = { result: { video: { url: "https://v3.fal.media/out/h.mp4" } }, resultStatus: 200, download: videoMp4() };
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  assert.equal(gen?.doc?.dub?.model, HEYGEN);
  assert.deepEqual(calls.find((c) => c.url === "https://queue.fal.run/fal-ai/heygen/v2/translate/speed")!.body, { video_url: FILE, output_language: "Uzbek (Latin, Uzbekistan)", translate_audio_only: false, enable_dynamic_duration: false });
  const row = (await query<{ provider: string; upstream_model: string; model_id: string; status: string; op_id: string }>("SELECT provider, upstream_model, model_id, status, op_id FROM media_jobs WHERE idempotency_key = $1", [`${r.body.id}:dub:0`]))[0]!;
  assert.deepEqual(row, { provider: "fal", upstream_model: "fal-ai/heygen/v2/translate/speed", model_id: HEYGEN, status: "succeeded", op_id: `fal:fal-ai/heygen/v2/translate/speed:${REQ}` });
  const failures = async (id: string) => query<{ provider: string; message: string }>("SELECT provider, message FROM provider_failures WHERE job_id = $1", [id]);
  assert.deepEqual(await failures(r.body.id!), [], "2 s delivered for 2 s quoted: nothing to report");

  // Delivered far past the quote: the user gets the file, the owner's alert counts it.
  const r2 = await post(me, "studio-dub", values, price);
  mode = { result: { video: { url: "https://v3.fal.media/out/h.mp4" } }, resultStatus: 200, download: videoMp4(6) };
  const g2 = await runNext(r2.body.id!);
  assert.equal(g2?.status, "COMPLETED", String(g2?.error));
  const rows = await failures(r2.body.id!);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.provider, "fal");
  assert.match(rows[0]!.message, /heygen output 6 s over the quoted 2 s/);
});

test("dub: fal — a 2-second clip is charged the whole minute fal bills; a parked op resumes, nothing is sent twice", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await settings(true);
  await adminSwitch(true);
  const { DUB_CLOCK } = await import("../lib/generation/studio/dub.ts");
  const sleep0 = DUB_CLOCK.sleep;
  DUB_CLOCK.sleep = async () => {};
  t.after(() => void (DUB_CLOCK.sleep = sleep0));
  const me = await mkUser();
  const up = await upload(me, 4.2);
  await idle();
  const values = { modelId: FAL_DUB, source: `upload:${up}`, sourceSeconds: 5, target: "ru" };
  const price = await priceOf("studio-dub", values);
  assert.equal(price, await priceOf("studio-dub", { ...values, sourceSeconds: 60 }), "5 s and 60 s cost the same started minute");
  const r = await post(me, "studio-dub", values, price);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(await balanceOf(me), 500_000 - price);
  calls.length = 0;
  mode = { result: { audio: { url: "https://v3.fal.media/out/d.mp3" }, target_lang: "ru" }, resultStatus: 200, download: mp3Bytes(90) };
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  assert.equal(gen?.doc?.dub?.output, "mp3");

  const r2 = await post(me, "studio-dub", values, price);
  const jobs = await import("../lib/server/media/jobs.ts");
  const { row } = await jobs.beginMediaJob({ generationId: r2.body.id!, purpose: "studio.dub", modelId: FAL_DUB, provider: "fal", upstreamModel: "fal-ai/elevenlabs/dubbing", idempotencyKey: `${r2.body.id}:dub:0`, params: {} });
  await jobs.parkMediaJob(row.id, `fal:fal-ai/elevenlabs/dubbing:${REQ}`, new Date());
  // The worker that uploaded the source died: only the row knows its URL.
  await jobs.noteMediaUpload(row.id, FILE);
  calls.length = 0;
  const g2 = await runNext(r2.body.id!);
  assert.equal(g2?.status, "COMPLETED", String(g2?.error));
  assert.ok(!calls.some((c) => c.url.includes("/upload/initiate") || (c.method === "POST" && c.url.startsWith("https://queue.fal.run/"))), "no upload and no second dub");
  assert.deepEqual(calls.filter((c) => c.url === "https://rest.fal.ai/storage/files/delete").map((c) => c.body), [{ file_url: FILE }], "the resuming worker deleted it");
  const { query } = await db();
  assert.deepEqual((await query<{ params: Record<string, unknown> }>("SELECT params FROM media_jobs WHERE id = $1", [row.id]))[0]!.params.falUpload, undefined, "gone from the row");
});

test("upload: the row holds the URL from before the paid call until the file is deleted", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await settings(true);
  await adminSwitch(true);
  const { DUB_CLOCK } = await import("../lib/generation/studio/dub.ts");
  const sleep0 = DUB_CLOCK.sleep;
  DUB_CLOCK.sleep = async () => {};
  t.after(() => void (DUB_CLOCK.sleep = sleep0));
  const { query } = await db();
  const me = await mkUser();
  const up = await upload(me, 5);
  await idle();
  const values = { modelId: FAL_DUB, source: `upload:${up}`, sourceSeconds: 5, target: "ru" };
  const r = await post(me, "studio-dub", values, await priceOf("studio-dub", values));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const seen: unknown[] = [];
  // The moment fal is asked to dub, the row must already name the upload.
  mode = {
    result: { audio: { url: "https://v3.fal.media/out/d.mp3" } },
    resultStatus: 200,
    download: mp3Bytes(90),
    submit: () => {
      seen.push("submit");
      return json(200, { request_id: REQ });
    },
  };
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    if (String(u) === "https://queue.fal.run/fal-ai/elevenlabs/dubbing" && init?.method === "POST") {
      seen.push((await query<{ url: string }>("SELECT params ->> 'falUpload' AS url FROM media_jobs WHERE idempotency_key = $1", [`${r.body.id}:dub:0`]))[0]?.url);
    }
    return real(u, init);
  }) as typeof fetch;
  t.after(() => void (globalThis.fetch = real));
  const gen = await runNext(r.body.id!);
  mode = { result: {}, resultStatus: 200, download: mp3Bytes() };
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  assert.deepEqual(seen, [FILE, "submit"], "the URL was on the row before the submit");
  const params = (await query<{ params: Record<string, unknown> }>("SELECT params FROM media_jobs WHERE idempotency_key = $1", [`${r.body.id}:dub:0`]))[0]!.params;
  assert.equal(params.falUpload, undefined, "removed once deleted");
});

test("upload: housekeeping deletes what a dead job left, whatever its row's status; a live job's file stays", { skip }, async (t) => {
  quiet(t);
  installFetch();
  const { query } = await db();
  const jobs = await import("../lib/server/media/jobs.ts");
  const { studioDubHousekeeping } = await import("../lib/server/media/speech-sources.ts");
  const me = await mkUser();
  const left = async (genStatus: string, rowStatus: "pending" | "submitting" | "failed", url: string) => {
    const id = randomUUID();
    await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, price, format) VALUES ($1, $2, 'studio-dub', 'Dublyaj', $3, 3500, 'mp4')`, [id, me, genStatus]);
    const { row } = await jobs.beginMediaJob({ generationId: id, purpose: "studio.dub", modelId: FAL_DUB, provider: "fal", upstreamModel: "fal-ai/elevenlabs/dubbing", idempotencyKey: `${id}:dub:0`, params: {} });
    await jobs.noteMediaUpload(row.id, url);
    if (rowStatus === "pending") await jobs.parkMediaJob(row.id, `fal:fal-ai/elevenlabs/dubbing:${REQ}`, new Date());
    if (rowStatus === "failed") await jobs.failMediaJob(row.id, "x");
    await query("UPDATE media_jobs SET created_at = now() - interval '10 minutes' WHERE id = $1", [row.id]);
    return row.id;
  };
  const parked = await left("FAILED", "pending", "https://v3b.fal.media/files/b/0a/parked.mp3");
  const died = await left("FAILED", "submitting", "https://v3b.fal.media/files/b/0a/died.mp3");
  const closed = await left("REVOKED", "failed", "https://v3b.fal.media/files/b/0a/closed.mp3");
  const live = await left("IN_PROGRESS", "pending", "https://v3b.fal.media/files/b/0a/live.mp3");
  calls.length = 0;
  const r = await studioDubHousekeeping();
  assert.equal(r.uploads, 3);
  const deleted = calls.filter((c) => c.url === "https://rest.fal.ai/storage/files/delete").map((c) => (c.body as { file_url: string }).file_url.split("/").pop()).sort();
  assert.deepEqual(deleted, ["closed.mp3", "died.mp3", "parked.mp3"], "by the default fal path, not a stub");
  const param = async (id: string) => (await query<{ url: string | null }>("SELECT params ->> 'falUpload' AS url FROM media_jobs WHERE id = $1", [id]))[0]!.url;
  for (const id of [parked, died, closed]) assert.equal(await param(id), null, "cleared: the next tick does not repeat it");
  assert.equal(await param(live), "https://v3b.fal.media/files/b/0a/live.mp3", "a running job keeps its file");
  calls.length = 0;
  assert.equal((await studioDubHousekeeping()).uploads, 0);
  assert.equal(calls.length, 0);
  await query("UPDATE generations SET status = 'REVOKED' WHERE status = 'IN_PROGRESS' AND user_id = $1", [me]);
  await studioDubHousekeeping();
});

test("URLs: a 422 quoting the v3.fal.media link reaches neither `last_error` nor `provider_failures`", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await settings(true);
  await adminSwitch(true);
  const { query } = await db();
  const jobs = await import("../lib/server/media/jobs.ts");
  const me = await mkUser();
  const src = await source(me, "studio-speech", "audio/mpeg", mp3Bytes(), speechDoc(3));
  await idle();
  const link = "https://v3.fal.media/files/lion/user-voice.mp3";
  mode = { result: {}, resultStatus: 200, download: mp3Bytes(), submit: () => json(422, { detail: `Failed to download ${link}` }) };
  const values = { modelId: FAL_SCRIBE, source: `result:${src}`, sourceSeconds: 3 };
  const r = await post(me, "studio-transcribe", values, await priceOf("studio-transcribe", values));
  const g = await runNext(r.body.id!);
  mode = { result: {}, resultStatus: 200, download: mp3Bytes() };
  assert.equal(g?.status, "FAILED");
  const row = (await query<{ last_error: string }>("SELECT last_error FROM media_jobs WHERE generation_id = $1", [r.body.id]))[0]!;
  assert.match(row.last_error, /422 Failed to download \[url\]/);
  const failure = (await query<{ message: string }>("SELECT message FROM provider_failures WHERE job_id = $1", [r.body.id]))[0]!;
  assert.ok(!failure.message.includes("fal.media"), failure.message);

  // The store's own guard, for an error that did not pass through the fal adapter.
  const direct = async (fail: (id: string) => Promise<unknown>) => {
    const key = randomUUID();
    const { row: x } = await jobs.beginMediaJob({ generationId: null, purpose: "studio.dub", modelId: FAL_DUB, provider: "fal", upstreamModel: "m", idempotencyKey: key, params: {} });
    await fail(x.id);
    return (await query<{ last_error: string }>("SELECT last_error FROM media_jobs WHERE id = $1", [x.id]))[0]!.last_error;
  };
  assert.equal(await direct((id) => jobs.failMediaJob(id, `boom ${link}`)), "boom [url]");
  assert.equal(await direct((id) => jobs.failSubmittingMediaJob(id, `boom ${link}`)), "boom [url]");
});

test("audio: VEED and SFX v3 through the worker, stored as MP3", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await settings(true);
  await adminSwitch(true);
  const { pcmToWav } = await import("../lib/generation/tts/mp3.ts");
  const { query } = await db();
  const me = await mkUser();
  const up = await upload(me, 5);
  await idle();
  const clean = { modelId: VEED, inputId: up, inputSeconds: 5, strength: "1" };
  const cleanPrice = await priceOf("studio-audio", clean);
  assert.equal(cleanPrice, 400, "the one-minute minimum");
  const r = await post(me, "studio-audio", clean, cleanPrice);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  mode = { result: { audio: { url: "https://v3.fal.media/out/c.wav" }, audio_duration: 5 }, resultStatus: 200, download: pcmToWav(new Uint8Array(96_000), { sampleRate: 48_000 }) };
  const g = await runNext(r.body.id!);
  assert.equal(g?.status, "COMPLETED", String(g?.error));
  const file = (await query<{ mime: string; format: string }>("SELECT f.mime, g.format FROM generation_files f JOIN generations g ON g.id = f.generation_id WHERE f.generation_id = $1", [r.body.id]))[0]!;
  assert.deepEqual(file, { mime: "audio/mpeg", format: "mp3" });

  const sfx = { modelId: FAL_SFX, prompt: "eshik ochiladi", duration: 5, variants: 1 };
  const r2 = await post(me, "studio-audio", sfx, await priceOf("studio-audio", sfx));
  assert.equal(r2.status, 202, JSON.stringify(r2.body));
  mode = { result: { audio: { url: "https://v3.fal.media/out/s.mp3" } }, resultStatus: 200, download: mp3Bytes() };
  const g2 = await runNext(r2.body.id!);
  assert.equal(g2?.status, "COMPLETED", String(g2?.error));
  assert.equal(g2?.doc?.studioAudio?.model, FAL_SFX);
});

test("speech: Eleven v4 Turbo through the worker, the voice by name; a voice fal lacks is refused before charging", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await settings(true);
  await adminSwitch(true);
  const me = await mkUser();
  await idle();
  const refused = await post(me, "studio-speech", { modelId: V4, text: "Salom", voice: ADAM });
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal(await balanceOf(me), 500_000);
  const values = { modelId: V4, text: "x".repeat(1000), voice: RACHEL, stability: "0.5", lang: "uz" };
  const price = await priceOf("studio-speech", values);
  assert.equal(price, 1_100, "$0.04 / 1 000 characters × 12 700 × 2 = 1 016");
  const r = await post(me, "studio-speech", values, price);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  calls.length = 0;
  mode = { result: { audio: { url: "https://v3.fal.media/out/t.mp3" } }, resultStatus: 200, download: mp3Bytes(120) };
  const g = await runNext(r.body.id!);
  assert.equal(g?.status, "COMPLETED", String(g?.error));
  assert.equal((calls.find((c) => c.url === "https://queue.fal.run/elevenlabs/tts/eleven-v4-turbo")!.body as { voice: string }).voice, "Rachel");
});

test("housekeeping: an orphaned fal dub is cancelled at fal by its op id", { skip }, async (t) => {
  quiet(t);
  installFetch();
  const { query } = await db();
  const jobs = await import("../lib/server/media/jobs.ts");
  const { studioDubHousekeeping } = await import("../lib/server/media/speech-sources.ts");
  const me = await mkUser();
  const id = randomUUID();
  await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, price, format) VALUES ($1, $2, 'studio-dub', 'Dublyaj', 'FAILED', 3500, 'mp4')`, [id, me]);
  const { row } = await jobs.beginMediaJob({ generationId: id, purpose: "studio.dub", modelId: FAL_DUB, provider: "fal", upstreamModel: "fal-ai/elevenlabs/dubbing", idempotencyKey: `${id}:dub:0`, params: {} });
  await jobs.parkMediaJob(row.id, `fal:fal-ai/elevenlabs/dubbing:${REQ}`, new Date());
  await query("UPDATE media_jobs SET created_at = now() - interval '10 minutes' WHERE id = $1", [row.id]);
  calls.length = 0;
  const r = await studioDubHousekeeping();
  assert.equal(r.closed, 1);
  assert.equal(r.deleted, 1);
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [["PUT", `https://queue.fal.run/fal-ai/elevenlabs/requests/${REQ}/cancel`]]);
});
