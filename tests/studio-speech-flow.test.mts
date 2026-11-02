import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P5 «Ovoz» — money + likeness flow on an isolated Postgres (docs/studio/P5-SPEC.md). Every ElevenLabs call is a
 * stubbed `fetch` (no network, no paid call).
 *
 *   gating     `studio.voice.enabled` off → 400 before charging; on → the catalog lists the speech models;
 *   speech     route → charge = shown price → claimNext → runJob: ONE ElevenLabs TTS call (eleven_v3, the chosen voice),
 *              MP3 stored, `media_jobs` row `studio.speech`, gallery `kind: "audio"`; a provider 500 → FAILED, full refund;
 *   ownership  another user's clone in a speech request → 400 `voice_missing` BEFORE the charge;
 *   samples    consent required (400), sniffed type (415), measured length (422), the consent fields stored;
 *   clone      no free ElevenLabs slot → 409 `no_voice_slot` before charging; slots unreadable → 503; success charges the
 *              fixed price, stores the voice (consent copied, sample bytes cleared) and a preview; a second active clone
 *              → 409 `clone_exists`; speaking with the clone sends ITS provider id and touches `last_used_at`; delete:
 *              another user 404, owner → provider DELETE + slot freed → a new clone is accepted; an IVC failure → FAILED,
 *              full refund, no clone row left;
 *   purge      unused 27 days → one warning (not repeated), 30 days → deleted + provider DELETE; a failed provider delete
 *              is retried by the next pass;
 *   preview    a library voice: one provider call, then served from the cache; another user's clone → 404.
 *
 * Mutations (each turned the named test red, then restored):
 *   `assertOwnClones` call removed from `submitGeneration`                     -> "ownership";
 *   slot check `used >= limit` → `used > limit`                               -> "clone: no slot";
 *   `consent` check removed from `uploadVoiceSample`                          -> "samples";
 *   `cloneJobInFlight` / active-row check removed from `assertCloneAllowed`   -> "clone: second" (then the DB index
 *                                                                               fails the job: refund, still red on the 409);
 *   `providerDeleteVoice` call removed from `deleteUserVoice`                 -> "clone: delete";
 *   purge interval 30 → 300 days                                             -> "purge";
 *   `warned_at IS NULL` dropped from the warning claim                       -> "purge" (warned twice);
 *   `readPreview` cache read skipped                                          -> "preview" (second provider call);
 *   review M1: route length check dropped                                     -> "review M1";
 *   review m3: `abortClone` without the provider delete                       -> "review m3";
 *   review m2: the «job is over» clause dropped / 10 min → 60 min             -> "review m2";
 *   review m1: known / age / marker check dropped                             -> "review m1";
 *   NITs: loose UUID regex, `decodeURIComponent` uncaught                     -> "review NITs".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.ELEVENLABS_API_KEY = "sk_test_FLOW_ELEVEN_0123456789";
delete process.env.TTS_GEMINI_MODEL;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiospeech") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const { encodeWav } = await import("../components/studio/voice/wav.ts");

const RACHEL = "21m00Tcm4TlvDq8ikWAM";
const PROVIDER_VOICE = "ClonedVoice0001abcd";
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
let slots: unknown = { voice_slots_used: 1, voice_limit: 10, can_use_instant_voice_cloning: true };
let ttsStatus = 200;
let cloneAnswer: () => Response = () => json(200, { voice_id: PROVIDER_VOICE, requires_verification: false });
const deleteStatus = 200;
function installFetch() {
  globalThis.fetch = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u);
    const c: Call = { url, method: String(init.method ?? "GET"), body: typeof init.body === "string" ? JSON.parse(init.body) : init.body };
    calls.push(c);
    if (url.endsWith("/v1/user/subscription")) return slots === null ? json(500, {}) : json(200, slots);
    if (url.endsWith("/v1/voices/add")) return cloneAnswer();
    if (c.method === "DELETE" && url.includes("/v1/voices/")) return json(deleteStatus, { status: "ok" });
    if (url.includes("/v1/text-to-speech/") || url.includes("/v1/text-to-dialogue")) {
      return ttsStatus === 200 ? new Response(Buffer.from(mp3Bytes()), { status: 200, headers: { "content-type": "audio/mpeg" } }) : json(ttsStatus, { detail: "boom" });
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
  return String((await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Voice', 0, 0, $2) RETURNING id", [`voice-${process.pid}-${seq++}`, balance]))[0].id);
}
async function balanceOf(userId: string): Promise<number> {
  const { query } = await db();
  return Number((await query<{ b: string }>("SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1", [userId]))[0].b);
}
async function cookie(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
async function setVoiceSwitch(on: boolean) {
  const { query } = await db();
  await query("INSERT INTO app_settings (key, value, updated_at) VALUES ('studio.voice.enabled', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(on)]);
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  invalidateSettingsCache();
}
async function refresh() {
  const { reloadProviderKeys } = await import("../lib/server/providers/store.ts");
  const { invalidateMediaOverrides } = await import("../lib/server/media/overrides.ts");
  const { invalidatePricingCache } = await import("../lib/server/pricing.ts");
  const { resetSlotCache } = await import("../lib/server/media/voices.ts");
  await reloadProviderKeys();
  invalidateMediaOverrides();
  invalidatePricingCache();
  resetSlotCache();
}
async function post(userId: string, slug: string, values: Record<string, unknown>) {
  const route = await import("../app/api/generations/route.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
  const req = new Request("http://localhost/api/generations", { method: "POST", headers: { cookie: await cookie(userId), "content-type": "application/json" }, body: JSON.stringify({ slug, values }) });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; price?: number } };
}
async function upload(userId: string, bytes: Uint8Array, consent: boolean) {
  const route = await import("../app/api/media/voices/samples/route.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'media:voice-sample:%'");
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart]), "sample.bin");
  form.append("consent", consent ? "1" : "0");
  const req = new Request("http://localhost/api/media/voices/samples", { method: "POST", headers: { cookie: await cookie(userId) }, body: form });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { sampleId?: string; seconds?: number; error?: string; code?: string } };
}
async function del(userId: string, id: string) {
  const route = await import("../app/api/media/voices/[id]/route.ts");
  const req = new Request(`http://localhost/api/media/voices/${id}`, { method: "DELETE", headers: { cookie: await cookie(userId) } });
  const r = await inRequest(req, () => route.DELETE(req, { params: Promise.resolve({ id }) }));
  return { status: r.status, body: (await r.json()) as { deleted?: boolean; providerDeleted?: boolean; error?: string } };
}
async function preview(userId: string, key: string) {
  const route = await import("../app/api/media/voices/preview/[key]/route.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'media:voice-preview:%'");
  const req = new Request(`http://localhost/api/media/voices/preview/${encodeURIComponent(key)}`, { headers: { cookie: await cookie(userId) } });
  const r = await inRequest(req, () => route.GET(req, { params: Promise.resolve({ key: encodeURIComponent(key) }) }));
  return { status: r.status, type: r.headers.get("content-type"), bytes: r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : null };
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
const wav = (seconds: number) => encodeWav(new Float32Array(24_000 * seconds).map((_, i) => Math.sin(i / 10) * 0.3));

test("gating + speech: charge → one ElevenLabs call → MP3 + media_jobs row + gallery; a provider 500 refunds", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  installFetch();
  await refresh();
  const me = await mkUser();
  const values = { modelId: "elevenlabs/eleven-v3", text: "Assalomu alaykum, aziz do‘stlar!", voice: RACHEL, speed: "1.1", stability: "0", lang: "uz" };

  await setVoiceSwitch(false);
  const off = await post(me, "studio-speech", values);
  assert.equal(off.status, 400);
  assert.equal(off.body.code, "model_unavailable");
  assert.equal(await balanceOf(me), 100_000, "nothing charged while the tab is off");

  await setVoiceSwitch(true);
  const { mediaCatalog } = await import("../lib/server/media/public.ts");
  const catalog = await mediaCatalog("studio.speech");
  assert.deepEqual(catalog.models.map((m) => m.id), ["elevenlabs/eleven-v3", "elevenlabs/v3-dialogue"], "Gemini needs TTS_GEMINI_MODEL; not offered without it");

  await idle();
  calls.length = 0;
  const r = await post(me, "studio-speech", values);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const { studioSpeechPrice } = await import("../lib/media/studio-speech.ts");
  const { mediaPricing } = await import("../lib/server/media/pricing.ts");
  assert.equal(r.body.price, studioSpeechPrice(values, await mediaPricing()));
  assert.equal(100_000 - (await balanceOf(me)), r.body.price, "charged the shown price");
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  const tts = calls.filter((c) => c.url.includes("/text-to-speech/"));
  assert.equal(tts.length, 1);
  assert.equal(tts[0]!.url, `https://api.elevenlabs.io/v1/text-to-speech/${RACHEL}?output_format=mp3_44100_128`);
  assert.deepEqual(tts[0]!.body, { text: values.text, model_id: "eleven_v3", language_code: "uz", voice_settings: { stability: 0, speed: 1.1 } });
  const file = (await query<{ mime: string }>("SELECT mime FROM generation_files WHERE generation_id = $1", [r.body.id]))[0];
  assert.equal(file?.mime, "audio/mpeg");
  assert.equal(gen?.doc?.speech?.model, "elevenlabs/eleven-v3");
  assert.deepEqual(gen?.doc?.speech?.voices, ["Rachel"]);
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  const rows = await mediaJobsOf(r.body.id!);
  assert.deepEqual(rows.map((x) => [x.purpose, x.model_id, x.status]), [["studio.speech", "elevenlabs/eleven-v3", "succeeded"]]);
  assert.ok(!JSON.stringify(rows[0]!.params).includes("aziz"), "the user's text is not copied into media_jobs");
  const { studioGallery } = await import("../lib/server/media/public.ts");
  const g = await studioGallery(me, null);
  assert.equal(g.items[0]!.kind, "audio");
  assert.deepEqual(g.items[0]!.audio?.voices, ["Rachel"]);
  assert.equal(g.items[0]!.audio?.src, `/api/generations/${r.body.id}/file?inline=1`);

  ttsStatus = 500;
  t.after(() => void (ttsStatus = 200));
  await idle();
  const before = await balanceOf(me);
  const bad = await post(me, "studio-speech", values);
  assert.equal(bad.status, 202);
  const failed = await runNext(bad.body.id!);
  assert.equal(failed?.status, "FAILED");
  assert.match(String(failed?.error), /Kredit qaytariladi/);
  assert.equal(await balanceOf(me), before, "full refund");
  ttsStatus = 200;
});

test("samples: consent required, type sniffed, length measured; consent stored", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  await setVoiceSwitch(true);
  const me = await mkUser();
  const noConsent = await upload(me, wav(35), false);
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.body.code, "consent_required");
  assert.equal((await query("SELECT 1 FROM studio_voice_samples WHERE user_id = $1", [me])).length, 0, "nothing stored without consent");
  assert.equal((await upload(me, new Uint8Array(5000).fill(7), true)).status, 415);
  const short = await upload(me, wav(20), true);
  assert.equal(short.status, 422);
  const ok = await upload(me, wav(35), true);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.seconds, 35);
  const row = (await query<{ consent_ip_hash: string; consent_version: string; mime: string }>("SELECT consent_ip_hash, consent_version, mime FROM studio_voice_samples WHERE id = $1 AND user_id = $2", [ok.body.sampleId, me]))[0]!;
  assert.match(row.consent_ip_hash, /^[0-9a-f]{64}$/, "an HMAC, never the IP itself");
  assert.equal(row.consent_version, "2026-11-02");
  assert.equal(row.mime, "audio/wav");
});

test("clone: slots, success, one active, speak with it, ownership, delete, new clone, failure refund", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  installFetch();
  await setVoiceSwitch(true);
  await refresh();
  await idle();
  const me = await mkUser();
  const other = await mkUser();
  const sample = (await upload(me, wav(40), true)).body.sampleId!;

  // No free voice slot at ElevenLabs → refused BEFORE charging.
  slots = { voice_slots_used: 10, voice_limit: 10 };
  await refresh();
  const full = await post(me, "studio-voice", { name: "Mening ovozim", sampleId: sample });
  assert.equal(full.status, 409, JSON.stringify(full.body));
  assert.equal(full.body.code, "no_voice_slot");
  assert.equal(await balanceOf(me), 100_000);
  slots = null;
  await refresh();
  const unknown = await post(me, "studio-voice", { name: "Mening ovozim", sampleId: sample });
  assert.equal(unknown.status, 503);
  assert.equal(await balanceOf(me), 100_000, "never charge blind");
  // Someone else's sample.
  slots = { voice_slots_used: 9, voice_limit: 10 };
  await refresh();
  const stolen = await post(other, "studio-voice", { name: "X", sampleId: sample });
  assert.equal(stolen.status, 400);
  assert.equal(stolen.body.code, "sample_missing");

  // Success: the fixed price, the voice stored with the consent, sample bytes cleared, a preview stored.
  calls.length = 0;
  const r = await post(me, "studio-voice", { name: "Mening ovozim", sampleId: sample });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.price, 5000);
  assert.equal(await balanceOf(me), 95_000);
  // A second purchase while the first is still queued is refused before charging.
  const queued = await post(me, "studio-voice", { name: "Ikkinchi", sampleId: sample });
  assert.equal(queued.status, 409);
  assert.equal(queued.body.code, "clone_exists");
  const gen = await runNext(r.body.id!);
  assert.equal(gen?.status, "COMPLETED", String(gen?.error));
  const add = calls.find((c) => c.url.endsWith("/v1/voices/add"))!;
  assert.ok(add.body instanceof FormData);
  assert.equal((add.body as FormData).get("name"), "Mening ovozim");
  const previewCall = calls.find((c) => c.url.includes(`/text-to-speech/${PROVIDER_VOICE}`));
  assert.ok(previewCall, "the preview spoke with the NEW voice");
  const voice = (await query<{ id: string; status: string; provider_voice_id: string; consent_version: string; consent_ip_hash: string; user_id: string }>("SELECT id::text AS id, status, provider_voice_id, consent_version, consent_ip_hash, user_id::text AS user_id FROM studio_voices WHERE user_id = $1 AND deleted_at IS NULL", [me]))[0]!;
  assert.equal(voice.status, "ready");
  assert.equal(voice.provider_voice_id, PROVIDER_VOICE);
  assert.equal(voice.consent_version, "2026-11-02");
  assert.match(voice.consent_ip_hash, /^[0-9a-f]{64}$/);
  assert.equal((await query<{ b: unknown }>("SELECT bytes AS b FROM studio_voice_samples WHERE id = $1", [sample]))[0]!.b, null, "sample bytes cleared");
  assert.equal((await query("SELECT 1 FROM studio_voice_previews WHERE voice_key = $1", [`clone:${voice.id}`])).length, 1);

  // One active clone per user.
  const sample2 = (await upload(me, wav(41), true)).body.sampleId!;
  const second = await post(me, "studio-voice", { name: "Ikkinchi", sampleId: sample2 });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "clone_exists");
  assert.equal(await balanceOf(me), 95_000);

  // Speaking with the clone: the provider id goes out; last_used_at is touched.
  await query("UPDATE studio_voices SET last_used_at = now() - interval '5 days' WHERE id = $1", [voice.id]);
  calls.length = 0;
  const say = await post(me, "studio-speech", { modelId: "elevenlabs/eleven-v3", text: "Bu mening ovozim.", voice: `clone:${voice.id}` });
  assert.equal(say.status, 202, JSON.stringify(say.body));
  const said = await runNext(say.body.id!);
  assert.equal(said?.status, "COMPLETED", String(said?.error));
  assert.ok(calls.some((c) => c.url.includes(`/text-to-speech/${PROVIDER_VOICE}?`)));
  assert.deepEqual(said?.doc?.speech?.voices, ["Mening ovozim"]);
  assert.ok(!JSON.stringify(said?.doc).includes(PROVIDER_VOICE), "the provider id never lands in the document");
  const used = (await query<{ fresh: boolean }>("SELECT last_used_at > now() - interval '1 minute' AS fresh FROM studio_voices WHERE id = $1", [voice.id]))[0]!;
  assert.equal(used.fresh, true);

  // Ownership: another user cannot speak with (or delete, or preview) my clone.
  const theft = await post(other, "studio-speech", { modelId: "elevenlabs/eleven-v3", text: "Salom", voice: `clone:${voice.id}` });
  assert.equal(theft.status, 400);
  assert.equal(theft.body.code, "voice_missing");
  assert.equal(await balanceOf(other), 100_000, "refused before the charge");
  assert.equal((await del(other, voice.id)).status, 404);
  assert.equal((await preview(other, `clone:${voice.id}`)).status, 404);
  const mine = await preview(me, `clone:${voice.id}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.type, "audio/mpeg");

  // Delete: the provider voice is deleted, the slot freed; a new clone is accepted (and paid again).
  calls.length = 0;
  const d = await del(me, voice.id);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.providerDeleted, true);
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url === `https://api.elevenlabs.io/v1/voices/${PROVIDER_VOICE}`));
  const gone = (await query<{ reason: string; pdel: boolean }>("SELECT delete_reason AS reason, provider_deleted_at IS NOT NULL AS pdel FROM studio_voices WHERE id = $1", [voice.id]))[0]!;
  assert.deepEqual(gone, { reason: "user", pdel: true });
  await idle();
  const again = await post(me, "studio-voice", { name: "Yangi", sampleId: sample2 });
  assert.equal(again.status, 202, JSON.stringify(again.body));
  assert.equal(await balanceOf(me), 95_000 - (say.body.price ?? 0) - 5000);

  // IVC failure: FAILED, the 5 000 refunded, no clone row left.
  cloneAnswer = () => json(400, { detail: { status: "invalid_audio", message: "bad" } });
  t.after(() => void (cloneAnswer = () => json(200, { voice_id: PROVIDER_VOICE, requires_verification: false })));
  const before = await balanceOf(me);
  const failed = await runNext(again.body.id!);
  assert.equal(failed?.status, "FAILED");
  assert.match(String(failed?.error), /Kredit qaytariladi/);
  assert.equal(await balanceOf(me), before + 5000);
  assert.equal((await query("SELECT 1 FROM studio_voices WHERE user_id = $1 AND deleted_at IS NULL", [me])).length, 0);
});

test("purge: warn once at 27 days, delete + provider DELETE at 30, retry an owed delete", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  const { studioVoicesHousekeeping } = await import("../lib/server/media/voices.ts");
  const me = await mkUser();
  const id = (await query<{ id: string }>(
    `INSERT INTO studio_voices (user_id, name, status, provider_voice_id, sample_sha256, sample_seconds, consent_at, consent_ip_hash, consent_version, last_used_at)
     VALUES ($1, 'Eski', 'ready', 'PurgeVoice000001', repeat('ab', 32), 40, now(), repeat('c', 64), 'v', now() - interval '28 days') RETURNING id::text AS id`,
    [me],
  ))[0]!.id;
  const warned: string[] = [];
  const deletes: string[] = [];
  let ok = true;
  const fetchImpl = (async (u: string | URL, init: RequestInit = {}) => {
    if (init.method === "DELETE") deletes.push(String(u));
    return json(ok ? 200 : 503, {});
  }) as unknown as typeof fetch;
  const deps = { fetchImpl, key: () => "k", notify: async (w: { userId: string; name: string }) => void warned.push(`${w.userId}:${w.name}`) };
  await studioVoicesHousekeeping(deps);
  await studioVoicesHousekeeping(deps);
  assert.deepEqual(warned, [`${me}:Eski`], "warned exactly once");
  assert.equal((await query("SELECT 1 FROM studio_voices WHERE id = $1 AND deleted_at IS NULL", [id])).length, 1, "not deleted at 28 days");

  await query("UPDATE studio_voices SET last_used_at = now() - interval '31 days' WHERE id = $1", [id]);
  ok = false;
  const first = await studioVoicesHousekeeping(deps);
  assert.equal(first.purged, 1);
  assert.equal(first.providerDeleted, 0, "the provider did not answer");
  const row = (await query<{ reason: string; pdel: boolean }>("SELECT delete_reason AS reason, provider_deleted_at IS NOT NULL AS pdel FROM studio_voices WHERE id = $1", [id]))[0]!;
  assert.deepEqual(row, { reason: "unused", pdel: false });
  ok = true;
  const second = await studioVoicesHousekeeping(deps);
  assert.equal(second.providerDeleted, 1, "the owed delete is retried");
  assert.ok(deletes.every((u) => u === "https://api.elevenlabs.io/v1/voices/PurgeVoice000001"));
  assert.equal((await query("SELECT 1 FROM studio_voices WHERE id = $1 AND provider_deleted_at IS NOT NULL", [id])).length, 1);
});

test("preview: a library voice costs one provider call, then the cache serves it", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await setVoiceSwitch(true);
  await refresh();
  const me = await mkUser();
  calls.length = 0;
  const a = await preview(me, `elevenlabs:${RACHEL}`);
  assert.equal(a.status, 200);
  const b = await preview(me, `elevenlabs:${RACHEL}`);
  assert.equal(b.status, 200);
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(calls.filter((c) => c.url.includes("/text-to-speech/")).length, 1, "the second play is served from the cache");
  assert.equal((await preview(me, "elevenlabs:NotInTheLibrary1")).status, 404, "only catalog voices");
  assert.equal((await preview(me, "gemini:Kore")).status, 503, "Gemini not offered without TTS_GEMINI_MODEL");
});

/* ───────────────────────── review fixes (M1, m1, m2, m3, NITs) ───────────────────────── */

test("review M1: an over-limit dialogue script is refused BEFORE the charge", { skip }, async (t) => {
  quiet(t);
  installFetch();
  await setVoiceSwitch(true);
  await refresh();
  await idle();
  const me = await mkUser();
  calls.length = 0;
  const script = `Ali: ${"a".repeat(1000)}\nVali: ${"b".repeat(1000)}`;
  const r = await post(me, "studio-speech", { modelId: "elevenlabs/v3-dialogue", script, voice1: RACHEL, voice2: "pNInz6obpgDQGcFmaJgB" });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(String(r.body.error), /Matn juda uzun/);
  assert.equal(await balanceOf(me), 100_000, "nothing charged");
  assert.equal(calls.filter((c) => c.url.includes("text-to-dialogue")).length, 0);
});

test("review m3: IVC ok, preview fails → the ElevenLabs voice is deleted, delete_reason 'failed', full refund", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  installFetch();
  await setVoiceSwitch(true);
  slots = { voice_slots_used: 1, voice_limit: 10 };
  await refresh();
  await idle();
  const me = await mkUser();
  const sample = (await upload(me, wav(43), true)).body.sampleId!;  // own bytes: the same recording of another user is refused (409)
  const r = await post(me, "studio-voice", { name: "Preview yiqiladi", sampleId: sample });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  ttsStatus = 500;
  t.after(() => void (ttsStatus = 200));
  calls.length = 0;
  const gen = await runNext(r.body.id!);
  ttsStatus = 200;
  assert.equal(gen?.status, "FAILED");
  assert.equal(await balanceOf(me), 100_000, "the 5 000 refunded");
  assert.ok(calls.some((c) => c.url.endsWith("/v1/voices/add")), "the clone was made");
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url === `https://api.elevenlabs.io/v1/voices/${PROVIDER_VOICE}`), "MUTATSIYA: the made voice must be deleted");
  const row = (await query<{ reason: string; pdel: boolean }>("SELECT delete_reason AS reason, provider_deleted_at IS NOT NULL AS pdel FROM studio_voices WHERE user_id = $1", [me]))[0]!;
  assert.deepEqual(row, { reason: "failed", pdel: true });
  assert.equal((await query("SELECT 1 FROM studio_voices WHERE user_id = $1 AND deleted_at IS NULL", [me])).length, 0, "no active clone left");
});

test("review m2: a 'creating' row whose job is over, or older than 10 min, is swept; a live one stays", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  const { studioVoicesHousekeeping } = await import("../lib/server/media/voices.ts");
  const ins = async (user: string, genStatus: string, ageMin: number) => {
    const gen = (await query<{ id: string }>("INSERT INTO generations (id, user_id, tool_id, status) VALUES (gen_random_uuid(), $1, 'studio-voice', $2) RETURNING id::text AS id", [user, genStatus]))[0]!.id;
    return (await query<{ id: string }>(
      `INSERT INTO studio_voices (user_id, generation_id, name, status, sample_sha256, sample_seconds, consent_at, consent_ip_hash, consent_version, created_at)
       VALUES ($1, $2, 'c', 'creating', repeat('ab', 32), 40, now(), repeat('c', 64), 'v', now() - $3::int * interval '1 minute') RETURNING id::text AS id`,
      [user, gen, ageMin],
    ))[0]!.id;
  };
  const failed = await ins(await mkUser(), "FAILED", 2);
  const live = await ins(await mkUser(), "IN_PROGRESS", 2);
  const old = await ins(await mkUser(), "IN_PROGRESS", 11);
  await studioVoicesHousekeeping({ fetchImpl: (async () => json(200, {})) as unknown as typeof fetch, key: () => "k", notify: async () => {}, reconcile: false });
  const left = new Set((await query<{ id: string }>("SELECT id::text AS id FROM studio_voices WHERE id = ANY($1::uuid[])", [[failed, live, old]])).map((r) => r.id));
  assert.ok(!left.has(failed), "the job is over: swept at once");
  assert.ok(left.has(live), "a live job keeps its row");
  assert.ok(!left.has(old), "older than 10 min: swept");
});

test("review m1: orphan ElevenLabs clones (marked, > 1 h, unknown to us) are deleted; everything else is left", { skip }, async (t) => {
  quiet(t);
  const { query } = await db();
  const { reconcileOrphanClones } = await import("../lib/server/media/voices.ts");
  const me = await mkUser();
  await query(
    `INSERT INTO studio_voices (user_id, name, status, provider_voice_id, sample_sha256, sample_seconds, consent_at, consent_ip_hash, consent_version)
     VALUES ($1, 'Bor', 'ready', 'KnownVoice000001', repeat('ab', 32), 40, now(), repeat('c', 64), 'v')`,
    [me],
  );
  const now = Date.UTC(2026, 10, 2, 12);
  const old = Math.floor(now / 1000) - 7200;
  const marked = "SlaydX Studio (user consent recorded)";
  const deletes: string[] = [];
  const listed: string[] = [];
  const fetchImpl = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u);
    if (init.method === "DELETE") {
      deletes.push(url.split("/").pop()!);
      return json(200, { status: "ok" });
    }
    listed.push(url);
    if (!url.includes("next_page_token")) {
      return json(200, {
        voices: [
          { voice_id: "OrphanVoice00001", category: "cloned", description: marked, created_at_unix: old },
          { voice_id: "KnownVoice000001", category: "cloned", description: marked, created_at_unix: old },
          { voice_id: "YoungVoice000001", category: "cloned", description: marked, created_at_unix: Math.floor(now / 1000) - 600 },
        ],
        has_more: true,
        next_page_token: "p2",
      });
    }
    return json(200, {
      voices: [
        { voice_id: "ForeignVoice0001", category: "cloned", description: "the owner's own voice", created_at_unix: old },
        { voice_id: "NoDateVoice00001", category: "cloned", description: marked },
        { voice_id: "PremadeVoice0001", category: "premade", description: marked, created_at_unix: old },
        { voice_id: "OrphanVoice00002", category: "cloned", description: marked, created_at_unix: old },
      ],
      has_more: false,
    });
  }) as unknown as typeof fetch;
  const n = await reconcileOrphanClones({ fetchImpl, key: () => "k", now: () => now });
  assert.equal(n, 2);
  assert.deepEqual(deletes.sort(), ["OrphanVoice00001", "OrphanVoice00002"]);
  assert.equal(listed.length, 2, "both pages read");
  assert.equal(listed[0], "https://api.elevenlabs.io/v2/voices?category=cloned&page_size=100&search=SlaydX%20Studio");
  // A failing listing deletes nothing.
  deletes.length = 0;
  const down = (async () => json(503, {})) as unknown as typeof fetch;
  assert.equal(await reconcileOrphanClones({ fetchImpl: down, key: () => "k", now: () => now }), 0);
  assert.equal(deletes.length, 0);
});

test("review NITs: a malformed voice id is a 404 (not 500); a malformed preview escape is a 404", { skip }, async (t) => {
  quiet(t);
  const me = await mkUser();
  assert.equal((await del(me, "-".repeat(36))).status, 404);
  const route = await import("../app/api/media/voices/preview/[key]/route.ts");
  const req = new Request("http://localhost/api/media/voices/preview/x", { headers: { cookie: await cookie(me) } });
  const r = await inRequest(req, () => route.GET(req, { params: Promise.resolve({ key: "%E0%A4%A" }) }));
  assert.equal(r.status, 404);
});
