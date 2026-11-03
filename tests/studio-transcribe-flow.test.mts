import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P10 «Transkripsiya» / «Dublyaj» — money flow on an isolated Postgres (docs/studio/P10-SPEC.md). Sources are
 * finished generations / upload rows written directly; the jobs run through the real worker (`claimNext` → `runJob`)
 * with a stubbed `fetch` (no network, no paid call).
 *
 *   refusals   each switch OFF (default) → 400 before the charge, the listing has no P10 model; ON: another user's
 *              result / upload, a picture, a too-long source (transcribe audio > 10 min, dub > 3 min), a burn on an
 *              audio result, a video dub whose file cannot fit 25 MB → 400 before the charge; the client's
 *              `sourceSeconds` is NOT priced (a 1 s claim on a 60 s source is a 409 with the server's price);
 *   transcribe the worker sends the stored source bytes, the job is COMPLETED with the transcript TXT, its SRT / VTT
 *              downloads come from the stored cues, a `media_jobs` row under `studio.transcribe`, the provider cost in
 *              `cost_json`; a provider 500 → FAILED + full refund;
 *   dub        create → poll → download through the worker: COMPLETED MP3, the `media_jobs` row parked with the op id
 *              then succeeded, the project deleted at ElevenLabs; provider `failed` → FAILED + full refund; a re-run
 *              whose row is already parked RESUMES that op (no second create).
 *
 * Mutations (each turned the named test red, then restored):
 *   `prepareSpeechToolRequest` call removed from `submitGeneration`             -> "refusals" (charged, 202);
 *   `values.sourceSeconds = s.billed` removed (the client's number priced)       -> "refusals" (no 409);
 *   `AND user_id = $2` dropped from the upload lookup in `resolveSource`         -> "refusals" (another user's upload);
 *   `speechToolUnavailable` switch check removed                                 -> "refusals" (switch off sold);
 *   the worker's `studioSpeechTool` ctx not passed to `build`                    -> "transcribe", "dub" (FAILED);
 *   `store.park` skipped in `buildStudioDub`                                     -> "dub" (op id not stored).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.ELEVENLABS_API_KEY = "sk_test_FLOW_P10_0123456789";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiop10") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const REAL_FETCH = globalThis.fetch;
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
function mp3Bytes(frames = 80): Buffer {
  const out = Buffer.alloc(417 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; fields: Record<string, string>; fileSize: number | null };
const calls: Call[] = [];
let mode: { stt: number; dubStatus: string } = { stt: 200, dubStatus: "dubbed" };
function installFetch() {
  globalThis.fetch = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u);
    const fields: Record<string, string> = {};
    let fileSize: number | null = null;
    if (init.body instanceof FormData) for (const [k, v] of init.body.entries()) typeof v === "string" ? (fields[k] = v) : (fileSize = (v as File).size);
    calls.push({ url, method: String(init.method ?? "GET"), fields, fileSize });
    if (url.endsWith("/v1/speech-to-text")) {
      if (mode.stt !== 200) return json(mode.stt, { detail: "boom" });
      return json(200, { language_code: "uz", text: "Assalomu alaykum, oʻrtoqlar.", words: [{ text: "Assalomu", start: 0.1, end: 0.6, type: "word" }, { text: "alaykum,", start: 0.7, end: 1.2, type: "word" }, { text: "oʻrtoqlar.", start: 1.3, end: 2.2, type: "word" }] });
    }
    if (url.endsWith("/v1/dubbing") && init.method === "POST") return json(200, { dubbing_id: "dub_F1", expected_duration_sec: 3 });
    if (/\/v1\/dubbing\/[^/]+$/.test(url) && init.method === "DELETE") return json(200, {});
    if (/\/v1\/dubbing\/[^/]+\/audio\//.test(url)) return new Response(mp3Bytes(90), { status: 200 });
    if (/\/v1\/dubbing\/[^/]+$/.test(url)) return json(200, { status: mode.dubStatus, ...(mode.dubStatus === "failed" ? { error: "internal" } : {}) });
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
  return mod;
}
after(async () => {
  globalThis.fetch = REAL_FETCH;
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
  return String((await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'P10', 0, 0, $2) RETURNING id", [`p10-${process.pid}-${seq++}`, balance]))[0]!.id);
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
  const format = mime === "video/mp4" ? "mp4" : mime === "audio/mpeg" ? "mp3" : "png";
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

async function setSwitches(transcribe: boolean, dub: boolean) {
  const { query } = await db();
  for (const [k, v] of [["studio.transcribe.enabled", transcribe], ["studio.dub.enabled", dub]] as const) {
    await query("INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, JSON.stringify(v)]);
  }
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  invalidateSettingsCache();
  const { reloadProviderKeys } = await import("../lib/server/providers/store.ts");
  await reloadProviderKeys();
  const { invalidateMediaOverrides } = await import("../lib/server/media/overrides.ts");
  invalidateMediaOverrides();
  const { invalidatePricingCache } = await import("../lib/server/pricing.ts");
  invalidatePricingCache();
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
async function priceOf(toolId: "studio-transcribe" | "studio-dub", seconds: number): Promise<number> {
  const { effectivePrice } = await import("../lib/server/pricing.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  return effectivePrice(TOOL_BY_ID[toolId], { source: "x", sourceSeconds: seconds } as never);
}

test("refusals before the charge: switches off, foreign / wrong / too long / too big sources, burn on audio; the server's seconds are priced", { skip }, async (t) => {
  quiet(t);
  installFetch();
  const { query } = await db();
  const me = await mkUser();
  const other = await mkUser();
  const mySpeech = await source(me, "studio-speech", "audio/mpeg", mp3Bytes(), speechDoc(60));
  await idle();

  // Default OFF: nothing sold, nothing listed.
  await setSwitches(false, false);
  for (const slug of ["studio-transcribe", "studio-dub"]) {
    const r = await post(me, slug, { source: `result:${mySpeech}`, sourceSeconds: 60 });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, "model_unavailable");
  }
  const { mediaCatalog } = await import("../lib/server/media/public.ts");
  assert.ok(!(await mediaCatalog("studio.audio")).models.some((m) => m.id === "elevenlabs/scribe-v2" || m.id === "elevenlabs/dubbing"));
  await setSwitches(true, false);
  assert.deepEqual((await mediaCatalog("studio.audio")).models.map((m) => m.id).filter((id) => id.startsWith("elevenlabs/scribe") || id === "elevenlabs/dubbing"), ["elevenlabs/scribe-v2"], "each switch on its own");
  assert.equal((await post(me, "studio-dub", { source: `result:${mySpeech}`, sourceSeconds: 60 })).body.code, "model_unavailable");
  await setSwitches(true, true);

  const theirs = await source(other, "studio-speech", "audio/mpeg", mp3Bytes(), speechDoc(5));
  const theirUpload = await upload(other, 5);
  const picture = await source(me, "studio-image", "image/png", Buffer.from([1, 2, 3]), { meta: {}, images: [] });
  const longAudio = await source(me, "podcast", "audio/mpeg", mp3Bytes(), { meta: {}, audio: { seconds: 700, script: [] } });
  const longVideo = await source(me, "studio-video", "video/mp4", Buffer.from([0, 1]), videoDoc(200));
  const bigVideo = await source(me, "studio-video", "video/mp4", Buffer.from([0, 1]), videoDoc(60));
  await query("UPDATE generation_files SET size_bytes = $2 WHERE generation_id = $1", [bigVideo, 24.5 * 1024 * 1024]);
  const cases: [string, string, Record<string, unknown>, string][] = [
    ["another user's result", "studio-transcribe", { source: `result:${theirs}` }, "input_missing"],
    ["another user's upload", "studio-dub", { source: `upload:${theirUpload}` }, "input_missing"],
    ["a picture", "studio-transcribe", { source: `result:${picture}` }, "input_missing"],
    ["audio over 10 min", "studio-transcribe", { source: `result:${longAudio}` }, "input_too_long"],
    ["a dub over 3 min", "studio-dub", { source: `result:${longVideo}` }, "input_too_long"],
    ["a burn on an audio result", "studio-transcribe", { source: `result:${mySpeech}`, burn: true }, "input_invalid"],
    ["a video dub that cannot fit 25 MB", "studio-dub", { source: `result:${bigVideo}` }, "input_too_large"],
    ["a burn on an upload (preflight)", "studio-transcribe", { source: `upload:${await upload(me, 5)}`, burn: true }, ""],
  ];
  for (const [name, slug, values, code] of cases) {
    const r = await post(me, slug, { sourceSeconds: 1, ...values });
    assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.body)}`);
    if (code) assert.equal(r.body.code, code, name);
  }
  // The client claims 1 s of a 60 s source: refused with the server's price, nothing charged.
  const stale = await post(me, "studio-transcribe", { source: `result:${mySpeech}`, sourceSeconds: 1 }, await priceOf("studio-transcribe", 1));
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.code, "price_changed");
  assert.equal(stale.body.price, await priceOf("studio-transcribe", 60));
  assert.equal(await balanceOf(me), 100_000, "nothing charged by any refusal");
  assert.equal(Number((await query<{ n: string }>("SELECT count(*)::text AS n FROM generations WHERE user_id = $1 AND tool_id IN ('studio-transcribe', 'studio-dub')", [me]))[0]!.n), 0, "nothing queued");
});

test("transcribe: through the worker — the stored source is sent, TXT + SRT / VTT from the cues, media_jobs + cost; a 500 refunds", { skip }, async (t) => {
  quiet(t);
  installFetch();
  mode = { stt: 200, dubStatus: "dubbed" };
  await setSwitches(true, true);
  const { query } = await db();
  const me = await mkUser();
  const src = await source(me, "studio-speech", "audio/mpeg", mp3Bytes(), speechDoc(3));
  await idle();
  const price = await priceOf("studio-transcribe", 3);
  const r = await post(me, "studio-transcribe", { source: `result:${src}`, sourceSeconds: 3, language: "uz" }, price);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(await balanceOf(me), 100_000 - price, "charged exactly the shown price");
  calls.length = 0;
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  const stt = calls.find((c) => c.url.endsWith("/v1/speech-to-text"))!;
  assert.equal(stt.fileSize, mp3Bytes().length, "the job owner's stored file was sent");
  assert.equal(stt.fields.language_code, "uz");
  const f = (await query<{ mime: string; bytes: Buffer; format: string; cost: { parts?: unknown[] } | null }>("SELECT f.mime, f.bytes, g.format, g.cost_json AS cost FROM generation_files f JOIN generations g ON g.id = f.generation_id WHERE f.generation_id = $1", [r.body.id]))[0]!;
  assert.equal(f.format, "txt");
  assert.equal(f.bytes.toString("utf8"), "Assalomu alaykum, oʻrtoqlar.\n");
  assert.ok(f.cost, "the provider cost is in cost_json (P7c)");
  const { produceDownload } = await import("../lib/server/downloads/produce.ts");
  const srt = await produceDownload(r.body.id!, me, "subtitles-srt");
  assert.equal(srt.bytes.toString("utf8"), "1\n00:00:00,100 --> 00:00:02,200\nAssalomu alaykum, oʻrtoqlar.\n");
  const vtt = await produceDownload(r.body.id!, me, "subtitles-vtt");
  assert.ok(vtt.bytes.toString("utf8").startsWith("WEBVTT\n\n00:00:00.100 --> 00:00:02.200\n"));
  const rows = await query<{ purpose: string; status: string; params: { sourceSeconds: number } }>("SELECT purpose, status, params FROM media_jobs WHERE generation_id = $1", [r.body.id]);
  assert.deepEqual(rows.map((x) => [x.purpose, x.status, x.params.sourceSeconds]), [["studio.transcribe", "succeeded", 3]]);

  mode = { stt: 500, dubStatus: "dubbed" };
  const r2 = await post(me, "studio-transcribe", { source: `result:${src}`, sourceSeconds: 3 }, price);
  assert.equal(r2.status, 202, JSON.stringify(r2.body));
  const g2 = await runNext(r2.body.id!);
  assert.equal(g2?.status, "FAILED");
  assert.match(String(g2?.error), /Kredit qaytariladi/);
  assert.equal(await balanceOf(me), 100_000 - price, "the failed job was refunded in full");
  mode = { stt: 200, dubStatus: "dubbed" };
});

test("dub: create → poll → download through the worker; provider failed → refund; a parked op is resumed, never created twice", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await setSwitches(true, true);
  const { DUB_CLOCK } = await import("../lib/generation/studio/dub.ts");
  const sleep0 = DUB_CLOCK.sleep;
  DUB_CLOCK.sleep = async () => {};
  t.after(() => void (DUB_CLOCK.sleep = sleep0));
  const { query } = await db();
  const me = await mkUser();
  const up = await upload(me, 4.2);
  await idle();
  const price = await priceOf("studio-dub", 5);
  mode = { stt: 200, dubStatus: "dubbed" };
  const r = await post(me, "studio-dub", { source: `upload:${up}`, sourceSeconds: 5, target: "ru" }, price);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  calls.length = 0;
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  assert.deepEqual(calls.map((c) => c.method), ["POST", "GET", "GET", "DELETE"]);
  assert.equal(calls[0]!.fields.target_lang, "ru");
  assert.equal(gen?.doc?.dub?.output, "mp3");
  const job = (await query<{ status: string; op_id: string; purpose: string }>("SELECT status, op_id, purpose FROM media_jobs WHERE idempotency_key = $1", [`${r.body.id}:dub:0`]))[0]!;
  assert.deepEqual(job, { status: "succeeded", op_id: "dub_F1:ru", purpose: "studio.dub" });
  assert.equal(await balanceOf(me), 100_000 - price);

  mode = { stt: 200, dubStatus: "failed" };
  const r2 = await post(me, "studio-dub", { source: `upload:${up}`, sourceSeconds: 5 }, price);
  const g2 = await runNext(r2.body.id!);
  assert.equal(g2?.status, "FAILED");
  assert.equal(await balanceOf(me), 100_000 - price, "full refund");
  assert.equal((await query<{ status: string }>("SELECT status FROM media_jobs WHERE idempotency_key = $1", [`${r2.body.id}:dub:0`]))[0]!.status, "failed");

  // A re-run (the worker died after parking): the row exists 'pending' with its op id → resumed, no second create.
  mode = { stt: 200, dubStatus: "dubbed" };
  const r3 = await post(me, "studio-dub", { source: `upload:${up}`, sourceSeconds: 5 }, price);
  const jobs = await import("../lib/server/media/jobs.ts");
  const { row } = await jobs.beginMediaJob({ generationId: r3.body.id!, purpose: "studio.dub", modelId: "elevenlabs/dubbing", provider: "elevenlabs", upstreamModel: "dubbing-automatic", idempotencyKey: `${r3.body.id}:dub:0`, params: {} });
  await jobs.parkMediaJob(row.id, "dub_PARKED:uz", new Date());
  calls.length = 0;
  const g3 = await runNext(r3.body.id!);
  assert.equal(g3?.status, "COMPLETED", String(g3?.error));
  assert.ok(!calls.some((c) => c.method === "POST"), "the parked dub is not created again");
  assert.ok(calls.some((c) => c.url.endsWith("/v1/dubbing/dub_PARKED/audio/uz")));
});
