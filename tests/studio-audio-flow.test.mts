import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P6 «Audio» — money flow on an isolated Postgres (docs/studio/P6-SPEC.md). Every ElevenLabs call is a stubbed
 * `fetch` (no network, no paid call).
 *
 *   gating     `studio.audio.enabled` off → 400 before charging, the listing is empty; on → the four models are listed;
 *   music      route → charge = shown price → claimNext → runJob: ONE /v1/music call, MP3 stored, `media_jobs` row
 *              `studio.music` with the prompt stored only as its length, gallery `kind: "audio"`; a provider 500 →
 *              FAILED, full refund;
 *   sfx        4 variants, the 2nd call fails → COMPLETED with `delivered` {3, 4}, a quarter refunded, three variant
 *              assets served to the owner as audio/mpeg (another user: 404);
 *   uploads    WAV sniffed + measured (billed whole seconds), too short 422, not audio 415, rows are the uploader's;
 *   inputs     another user's input → 400 `input_missing` BEFORE the charge; the request's `inputSeconds` is replaced by
 *              the server-measured length (a lower client number → 409 `price_changed` against its preview; without a
 *              preview the job is charged on the real length); the isolator sends the uploaded bytes;
 *   clone      the voice changer with another user's clone → 400 `voice_missing` before the charge;
 *   purge      inputs older than a day are deleted by housekeeping.
 *
 * Mutations (each turned the named test red, then restored):
 *   `audioModelUnavailable` call removed from `submitGeneration`                -> "gating";
 *   `values.inputSeconds = own.billedSeconds` dropped                            -> "inputs" (charged the client's 3 s);
 *   ownership `AND user_id = $2` dropped from `ownAudioInput`                    -> "inputs";
 *   `assertOwnCloneIds` call dropped from `prepareAudioRequest`                  -> "clone";
 *   `audio/mpeg` removed from the assets route's types                          -> "sfx" (served as octet-stream);
 *   housekeeping interval 1 day → 30 days                                       -> "purge";
 *   (review fix) SFX call priced on `values: p` (all variants) again               -> "sfx" (cost_usd ×4);
 *   (review fix) the per-user stored-bytes check removed from `uploadAudioInput`   -> "uploads + inputs" (200, not 429).
 * P7c -- provider cost telemetry (every delivered call is one entry of the job's meter: `generations.cost_json`, the
 * `ai_usage` row the admin cost reports read (`spendForJobs` / `spendBy` tool + kind), and the same number as the job's
 * succeeded `media_jobs.cost_usd`; a failed call or a failed job leaves no spend). Each turned the named test red, then restored:
 *   `recordAudioCall` removed from the engine loop                              -> "gating + music", "sfx", "uploads + inputs", "clone";
 *   the call recorded with `p` (all four variants) instead of one clip's values -> "sfx" (4 × the clip per call);
 *   a failed call recorded (call in the loop's `catch`)                         -> "gating + music" (the failed job shows spend), "sfx" (4 clips, not 3).
 * Migration 069 (asserted in tests/admin-migrations.test.mts): `billed_seconds` CHECK widened to 3 000, and the
 * ROLLBACK block without its DROP TABLE — both turned that file red, then restored.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.ELEVENLABS_API_KEY = "sk_test_FLOW_AUDIO_0123456789";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studioaudio") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const { encodeWav } = await import("../components/studio/voice/wav.ts");

const RACHEL = "21m00Tcm4TlvDq8ikWAM";
const REAL_FETCH = globalThis.fetch;

function mp3Bytes(frames = 80): Uint8Array {
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
let status = 200;
/** Fails exactly the n-th sound-generation call (1-based) of the current run; 0 = none. */
let failSfxCall = 0;
let sfxCalls = 0;
function installFetch() {
  globalThis.fetch = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u);
    const c: Call = { url, method: String(init.method ?? "GET"), body: typeof init.body === "string" ? JSON.parse(init.body) : init.body };
    calls.push(c);
    if (url.includes("/v1/sound-generation")) {
      sfxCalls++;
      if (sfxCalls === failSfxCall) return json(400, { detail: "boom" });
    }
    if (/\/v1\/(music|sound-generation|speech-to-speech|audio-isolation)/.test(url)) {
      return status === 200 ? new Response(Buffer.from(mp3Bytes()), { status: 200, headers: { "content-type": "audio/mpeg" } }) : json(status, { detail: "boom" });
    }
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
  return String((await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Audio', 0, 0, $2) RETURNING id", [`audio-${process.pid}-${seq++}`, balance]))[0].id);
}
async function balanceOf(userId: string): Promise<number> {
  const { query } = await db();
  return Number((await query<{ b: string }>("SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1", [userId]))[0].b);
}
async function cookie(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
async function setSwitch(on: boolean) {
  const { query } = await db();
  await query("INSERT INTO app_settings (key, value, updated_at) VALUES ('studio.audio.enabled', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(on)]);
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  invalidateSettingsCache();
  const { reloadProviderKeys } = await import("../lib/server/providers/store.ts");
  const { invalidateMediaOverrides } = await import("../lib/server/media/overrides.ts");
  const { invalidatePricingCache } = await import("../lib/server/pricing.ts");
  await reloadProviderKeys();
  invalidateMediaOverrides();
  invalidatePricingCache();
}
async function post(userId: string, values: Record<string, unknown>, expectedPrice?: number) {
  const route = await import("../app/api/generations/route.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
  const req = new Request("http://localhost/api/generations", {
    method: "POST",
    headers: { cookie: await cookie(userId), "content-type": "application/json" },
    body: JSON.stringify({ slug: "studio-audio", values, ...(expectedPrice !== undefined ? { expectedPrice } : {}) }),
  });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; price?: number } };
}
async function upload(userId: string, bytes: Uint8Array) {
  const route = await import("../app/api/media/audio-inputs/route.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'media:audio-input:%'");
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart]), "input.bin");
  const req = new Request("http://localhost/api/media/audio-inputs", { method: "POST", headers: { cookie: await cookie(userId) }, body: form });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { id?: string; seconds?: number; error?: string; code?: string } };
}
async function asset(userId: string, genId: string, assetId: string) {
  const route = await import("../app/api/generations/[id]/assets/[assetId]/route.ts");
  const req = new Request(`http://localhost/api/generations/${genId}/assets/${assetId}`, { headers: { cookie: await cookie(userId) } });
  const r = await inRequest(req, () => route.GET(req, { params: Promise.resolve({ id: genId, assetId }) }));
  return { status: r.status, type: r.headers.get("content-type") };
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
/* P7c: what a finished job left for the admin cost reports. */
const usd6 = (n: number) => Number(n.toFixed(6));
/** `credits` ElevenLabs credits on the owner's Creator plan ($22 / 121 000 credits). */
const creditsUsd = (credits: number) => (credits * 22) / 121_000;
type Part = { kind: string; provider: string; model: string; calls: number; inputTokens: number; outputTokens: number; units: number; usd: number };
/**
 * `generations.cost_json`, the admin report's canonical rows for the job (`ai_usage`, via `spendForJobs`) and the sum of
 * its succeeded `media_jobs.cost_usd` -- three views of one number.
 */
async function costOf(genId: string) {
  const { query, pool } = await db();
  const { flushAiUsage } = await import("../lib/server/ai-usage.ts");
  await flushAiUsage();
  const cj = (await query<{ c: { parts?: Part[]; usd: number; calls: number } | null }>("SELECT cost_json AS c FROM generations WHERE id = $1", [genId]))[0]!.c;
  const { spendForJobs } = await import("../lib/server/admin-cost.ts");
  const spend = (await spendForJobs(pool(), [genId])).get(genId);
  const mediaJobsUsd = Number((await query<{ s: string }>("SELECT COALESCE(sum(cost_usd), 0)::text AS s FROM media_jobs WHERE generation_id = $1 AND status = 'succeeded'", [genId]))[0]!.s);
  return { cj, spend, mediaJobsUsd };
}
/** The admin cost report's total for one tool (`spendBy` "tool") and one part kind, around now. */
async function reportOf(toolId: string, kind: string) {
  const { pool } = await db();
  const { spendBy } = await import("../lib/server/admin-cost.ts");
  const range = { fromTs: new Date(Date.now() - 3_600_000).toISOString(), toTsExclusive: new Date(Date.now() + 3_600_000).toISOString() };
  const tool = (await spendBy(pool(), range, "tool")).find((r) => r.key === toolId);
  const part = (await spendBy(pool(), range, "kind")).find((r) => r.key === kind);
  return { toolUsd: tool?.usd ?? 0, toolCalls: tool?.calls ?? 0, kindUsd: part?.usd ?? 0, kindUnits: part?.units ?? 0 };
}
const wav = (seconds: number) => encodeWav(new Float32Array(Math.round(24_000 * seconds)).map((_, i) => Math.sin(i / 10) * 0.3));
const pricing = async () => (await import("../lib/server/media/pricing.ts")).mediaPricing();
const priceOf = async (values: Record<string, unknown>): Promise<number> => (await import("../lib/media/studio-audio.ts")).studioAudioPrice(values, await pricing())!;

const MUSIC = { modelId: "elevenlabs/music", prompt: "calm lo-fi piano, rainy evening", length: "30", instrumental: true };

test("gating + music: charge → one /v1/music call → MP3 + media_jobs row + gallery; a provider 500 refunds", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  installFetch();
  const me = await mkUser();

  await setSwitch(false);
  const off = await post(me, MUSIC);
  assert.equal(off.status, 400);
  assert.equal(off.body.code, "model_unavailable");
  assert.equal(await balanceOf(me), 100_000, "nothing charged while the tab is off");
  const { mediaCatalog } = await import("../lib/server/media/public.ts");
  assert.deepEqual((await mediaCatalog("studio.audio")).models, [], "no mode listed while off");

  await setSwitch(true);
  const listing = await mediaCatalog("studio.audio");
  assert.deepEqual(listing.models.map((m) => m.id), ["elevenlabs/music", "elevenlabs/sfx", "elevenlabs/voice-changer", "elevenlabs/isolator"]);
  assert.equal(listing.defaultModelId, "elevenlabs/music");

  await idle();
  calls.length = 0;
  const r = await post(me, MUSIC, await priceOf(MUSIC));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.price, 2_100, "30 s of music at ×2 (P6-SPEC)");
  assert.equal(100_000 - (await balanceOf(me)), r.body.price, "charged the shown price");
  const reportBefore = await reportOf("studio-audio", "audio");
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  const music = calls.filter((c) => c.url.includes("/v1/music"));
  assert.equal(music.length, 1);
  assert.deepEqual(music[0]!.body, { prompt: MUSIC.prompt, music_length_ms: 30_000, force_instrumental: true, model_id: "music_v1" });
  const file = (await query<{ mime: string }>("SELECT mime FROM generation_files WHERE generation_id = $1", [r.body.id]))[0];
  assert.equal(file?.mime, "audio/mpeg");
  assert.equal(gen?.doc?.studioAudio?.mode, "music");
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  const rows = await mediaJobsOf(r.body.id!);
  assert.deepEqual(rows.map((x) => [x.purpose, x.model_id, x.status]), [["studio.music", "elevenlabs/music", "succeeded"]]);
  assert.ok(!JSON.stringify(rows[0]!.params).includes("lo-fi"), "the prompt is not copied into media_jobs");
  const { studioGallery } = await import("../lib/server/media/public.ts");
  const g = await studioGallery(me, null);
  assert.equal(g.items[0]!.kind, "audio");
  assert.equal(g.items[0]!.modelId, "elevenlabs/music");
  assert.equal(g.items[0]!.audio?.src, `/api/generations/${r.body.id}/file?inline=1`);

  // P7c: the one delivered music call (30 s × 15 credits / s) is the job's provider cost -- in cost_json, in the admin
  // report's rows (ai_usage), in the tool / kind totals -- and it is the number media_jobs.cost_usd holds.
  const want = usd6(creditsUsd(30 * 15));
  assert.ok(want > 0);
  const c = await costOf(r.body.id!);
  assert.deepEqual(c.cj?.parts, [{ kind: "audio", provider: "elevenlabs", model: "music_v1", calls: 1, inputTokens: 0, outputTokens: 0, units: 30, usd: want }]);
  assert.equal(c.cj?.usd, want);
  assert.equal(c.cj?.calls, 1);
  assert.equal(c.spend?.usd, want, "the admin cost report sees it");
  assert.deepEqual(c.spend?.rows.map((x) => x.outcome), ["completed"]);
  assert.ok(Math.abs(c.mediaJobsUsd - want) < 1e-6, `cost_json == media_jobs.cost_usd (${c.mediaJobsUsd})`);
  const reportAfter = await reportOf("studio-audio", "audio");
  assert.ok(Math.abs(reportAfter.toolUsd - reportBefore.toolUsd - want) < 1e-6, "tool total grew by the job's cost");
  assert.ok(Math.abs(reportAfter.kindUsd - reportBefore.kindUsd - want) < 1e-6, "audio kind total grew by the job's cost");
  assert.equal(reportAfter.kindUnits - reportBefore.kindUnits, 30);

  status = 500;
  t.after(() => void (status = 200));
  await idle();
  const before = await balanceOf(me);
  const bad = await post(me, MUSIC);
  assert.equal(bad.status, 202);
  const failed = await runNext(bad.body.id!);
  assert.equal(failed?.status, "FAILED");
  assert.match(String(failed?.error), /Kredit qaytariladi/);
  assert.equal(await balanceOf(me), before, "full refund");
  status = 200;
  // A failed call is not spend: no cost_json, no admin row (the user was refunded and nothing was delivered).
  const fc = await costOf(bad.body.id!);
  assert.equal(fc.cj, null);
  assert.equal(fc.spend, undefined);
});

test("sfx: 4 variants, one fails → COMPLETED, `delivered` {3, 4}, a quarter back; variant assets are the owner's MP3s", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await setSwitch(true);
  const me = await mkUser();
  const other = await mkUser();
  const values = { modelId: "elevenlabs/sfx", prompt: "door creaks open", duration: 5, influence: "0.8", loop: true, variants: 4 };
  await idle();
  sfxCalls = 0;
  failSfxCall = 2;
  t.after(() => void (failSfxCall = 0));
  const r = await post(me, values, await priceOf(values));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.price, 3_700, "4 × 5 s = 800 credits ≈ $0.1455 × 25 400 → 3 700");
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  assert.equal(sfxCalls, 4);
  const variants = gen?.doc?.studioAudio?.variants ?? [];
  assert.equal(variants.length, 3);
  const back = (await balanceOf(me)) - (100_000 - r.body.price!);
  assert.ok(back >= Math.floor(r.body.price! / 4) - 1 && back <= Math.ceil(r.body.price! / 4) + 1, `a quarter refunded (got ${back})`);
  const mine = await asset(me, r.body.id!, variants[0]!.assetId);
  assert.equal(mine.status, 200);
  assert.equal(mine.type, "audio/mpeg");
  assert.equal((await asset(other, r.body.id!, variants[0]!.assetId)).status, 404, "another user never gets it");
  // Each call's media_jobs cost is ONE clip (5 s × 40 credits), never the whole job's four.
  const costs = (await (await db()).query<{ c: string }>("SELECT cost_usd::text AS c FROM media_jobs WHERE generation_id = $1", [r.body.id]))
    .map((x) => Number(x.c));
  assert.equal(costs.length, 4);
  for (const c of costs) assert.ok(Math.abs(c - (5 * 40 * 22) / 121_000) < 1e-6, `one clip's cost, got ${c}`);
  failSfxCall = 0;

  // P7c: 3 of 4 delivered -> exactly THREE clips (5 s × 40 credits each) are the job's provider cost: one `audio` part,
  // 3 calls, 15 s; the failed variant is billed to nobody and recorded nowhere. The admin report agrees, and so do the
  // job's three succeeded media_jobs rows (the fourth row is the failed call).
  const clip = creditsUsd(5 * 40);
  const c = await costOf(r.body.id!);
  assert.deepEqual(c.cj?.parts, [{ kind: "audio", provider: "elevenlabs", model: "eleven_text_to_sound_v2", calls: 3, inputTokens: 0, outputTokens: 0, units: 15, usd: usd6(3 * clip) }]);
  assert.equal(c.cj?.usd, usd6(3 * clip));
  assert.equal(c.cj?.calls, 3);
  assert.equal(c.spend?.usd, usd6(3 * clip), "the admin cost report sees three clips, not four and not one");
  // (media_jobs.cost_usd keeps 6 decimals per row, so three rows may differ from cost_json by up to 1.5e-6.)
  assert.ok(Math.abs(c.mediaJobsUsd - 3 * clip) < 2e-6, `succeeded media_jobs rows = cost_json (${c.mediaJobsUsd})`);
});

test("uploads + inputs: sniffed, measured, owner-only; the price follows the server-measured length", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  installFetch();
  await setSwitch(true);
  const me = await mkUser();
  const other = await mkUser();
  assert.equal((await upload(me, new Uint8Array(5000).fill(7))).status, 415);
  assert.equal((await upload(me, wav(2))).status, 422);
  const ok = await upload(me, wav(9.4));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.seconds, 10, "billed whole seconds, rounded up");
  const row = (await query<{ user_id: string; billed_seconds: number }>("SELECT user_id::text AS user_id, billed_seconds FROM studio_audio_inputs WHERE id = $1", [ok.body.id]))[0]!;
  assert.deepEqual([row.user_id, Number(row.billed_seconds)], [me, 10]);

  const iso10 = { modelId: "elevenlabs/isolator", inputId: ok.body.id, inputSeconds: 10 };
  await idle();
  // Another user's input: refused before anything is charged.
  const foreign = await post(other, iso10);
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.code, "input_missing");
  assert.equal(await balanceOf(other), 100_000);
  // A lower client number against its own preview: the server prices the real 10 s → 409, nothing charged.
  const cheat = { ...iso10, inputSeconds: 3 };
  const conflict = await post(me, cheat, await priceOf(cheat));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "price_changed");
  assert.equal(conflict.body.price, await priceOf(iso10));
  assert.equal(await balanceOf(me), 100_000);
  // Without a preview the job is charged — and stored — at the measured length.
  calls.length = 0;
  const r = await post(me, cheat);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.price, await priceOf(iso10));
  const stored = (await query<{ v: Record<string, unknown> }>("SELECT values_json AS v FROM generations WHERE id = $1", [r.body.id]))[0]!.v;
  assert.equal(Number(stored.inputSeconds), 10);
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  const sent = calls.find((c) => c.url.includes("/v1/audio-isolation"));
  assert.ok(sent && sent.body instanceof FormData, "multipart");
  const file = (sent!.body as FormData).get("audio") as File;
  assert.equal(file.type, "audio/wav");
  assert.equal(file.size, wav(9.4).byteLength, "the uploaded bytes went to the provider");
  assert.equal(gen?.doc?.studioAudio?.inputSeconds, 10);
  // P7c: the isolator's cost follows the SERVER-measured input (10 billed seconds × 1 000 credits / min), not the client's 3.
  const isoUsd = usd6(creditsUsd((10 * 1000) / 60));
  const ic = await costOf(r.body.id!);
  assert.deepEqual(ic.cj?.parts, [{ kind: "audio", provider: "elevenlabs", model: "audio-isolation", calls: 1, inputTokens: 0, outputTokens: 0, units: 10, usd: isoUsd }]);
  assert.equal(ic.spend?.usd, isoUsd);
  assert.ok(Math.abs(ic.mediaJobsUsd - isoUsd) < 1e-6);

  // Stored bytes per user are capped (100 MB live): a user already holding ~100 MB is refused, another user is not.
  for (let i = 0; i < 4; i++) {
    await query("INSERT INTO studio_audio_inputs (id, user_id, mime, size_bytes, seconds, billed_seconds, bytes) VALUES ($1, $2, 'audio/wav', 26214400, 10, 10, $3)", [
      `${"f".repeat(23)}${i}`,
      other,
      Buffer.from([1]),
    ]);
  }
  const full = await upload(other, wav(5));
  assert.equal(full.status, 429);
  assert.equal(full.body.code, "input_quota");
  assert.equal((await upload(me, wav(5))).status, 200, "the cap is per user");
});

test("clone: the voice changer with another user's clone is refused before charging", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  installFetch();
  await setSwitch(true);
  const owner = await mkUser();
  const me = await mkUser();
  const cloneId = (
    await query<{ id: string }>(
      `INSERT INTO studio_voices (user_id, name, status, provider_voice_id, sample_sha256, sample_seconds, consent_at, consent_ip_hash, consent_version)
       VALUES ($1, 'Uning ovozi', 'ready', 'OwnerVoice0001abcd', repeat('ab', 32), 40, now(), repeat('c', 64), 'v') RETURNING id::text AS id`,
      [owner],
    )
  )[0]!.id;
  const input = await upload(me, wav(4));
  assert.equal(input.status, 200);
  const values = { modelId: "elevenlabs/voice-changer", inputId: input.body.id, inputSeconds: input.body.seconds, voice: `clone:${cloneId}`, removeNoise: true };
  await idle();
  const r = await post(me, values);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "voice_missing");
  assert.equal(await balanceOf(me), 100_000);
  // A library voice works (and sends the noise flag).
  calls.length = 0;
  const lib = await post(me, { ...values, voice: RACHEL });
  assert.equal(lib.status, 202, JSON.stringify(lib.body));
  const gen = await runNext(lib.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  const sts = calls.find((c) => c.url.includes("/v1/speech-to-speech/"));
  assert.equal(sts?.url, `https://api.elevenlabs.io/v1/speech-to-speech/${RACHEL}?output_format=mp3_44100_128`);
  assert.equal((sts!.body as FormData).get("remove_background_noise"), "true");
  // P7c: the voice changer is priced on the measured input (4 s × 1 000 credits / min).
  const stsUsd = usd6(creditsUsd((Number(input.body.seconds) * 1000) / 60));
  const sc = await costOf(lib.body.id!);
  assert.deepEqual(sc.cj?.parts, [{ kind: "audio", provider: "elevenlabs", model: "eleven_multilingual_sts_v2", calls: 1, inputTokens: 0, outputTokens: 0, units: Number(input.body.seconds), usd: stsUsd }]);
  assert.equal(sc.spend?.usd, stsUsd);
  assert.ok(Math.abs(sc.mediaJobsUsd - stsUsd) < 1e-6);
});

test("purge: inputs older than a day are deleted", { skip }, async () => {
  const { query } = await db();
  await setSwitch(true);
  const me = await mkUser();
  const fresh = await upload(me, wav(3.5));
  const old = await upload(me, wav(3.5));
  await query("UPDATE studio_audio_inputs SET created_at = now() - interval '25 hours' WHERE id = $1", [old.body.id]);
  const { studioAudioInputsHousekeeping } = await import("../lib/server/media/audio-inputs.ts");
  const r = await studioAudioInputsHousekeeping();
  assert.ok(r.deleted >= 1);
  const left = (await query<{ id: string }>("SELECT id FROM studio_audio_inputs WHERE user_id = $1", [me])).map((x) => x.id);
  assert.deepEqual(left, [fresh.body.id]);
});
