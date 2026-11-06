import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * STUDIO P11 package F, the paid path end to end on a real (isolated) Postgres, fal stubbed at `fetch`:
 *   gating   every new video entry is hidden until the admin's switch, and refused (400) before any charge; switched on
 *            it is listed and sold;
 *   effects  route → claim → ONE POST to the effect endpoint → the shared poll loop → MP4 → COMPLETED, priced per clip, one photo;
 *            a safety refusal refunds once;
 *   grok     the input image reaches the cost (`media_jobs.cost_usd`, `cost_json`);
 *   avatars  the speech must be the caller's own, within the model's length; the server sets the length from the file; the audio
 *            goes through fal storage, its URL is on the row before the paid call and the file is deleted when the op ends (a
 *            success, a failure, a deadline); a refused submit refunds; bad audio is a 400 before anything is charged.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `prepareAvatarRequest` keeps HeyGen's 60 s for a photo avatar    -> «avatars: limits»;
 *   2. the minimum-length check removed                                -> «avatars: limits»;
 *   3. `onInputStored` not passed by the Studio submit                 -> «avatars: flow» (no URL on the row, nothing deleted);
 *   4. `pollOp` does not drop the stored input                         -> «avatars: flow», «avatars: a failed op»;
 *   5. video-ops lets a photo avatar through without its speech        -> «avatars: a stored job without its speech»;
 *   6. `studioVideoAdapters` without `fal-avatar`                      -> «avatars: flow».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "AIza-test-gemini-key-0123456789";
process.env.KLING_API_KEY = "klingtestkey";
const FKEY = "fal-flow-key-0000:flowsecretvalue";
process.env.FAL_KEY = FKEY;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiomediaprov") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const QUEUE = "https://queue.fal.run";
const CDN = "https://v3b.fal.media/files/flow/";
const INITIATE = "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";
const DELETE_URL = "https://rest.fal.ai/storage/files/delete";
const UPLOAD = "https://upload.fal.media/presigned/flow";
const FILE = "https://v3b.fal.media/files/flow/input.mp3";
const ASSET = "0123456789abcdef01234567";
const OMNI = "bytedance/omnihuman-2";
const KAVATAR = "kling/ai-avatar-2";
const PIXFX = "pixverse/effects";
const KFX = "kling/effects-v16";
const GROK = "xai/grok-imagine-lite";
const NEW_VIDEO = [GROK, "pixverse/v6", "alibaba/happy-horse", OMNI, KAVATAR, PIXFX, KFX];

test("studio-video P11 F: gating, effects, the input image's cost, photo avatars on the shared poll loop", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  const catalogRoute = await import("../app/api/media/catalog/route.ts");
  const worker = await import("../lib/server/worker.ts");
  const ops = await import("../lib/server/video-ops.ts");
  const settings = await import("../lib/server/settings.ts");
  const { reloadProviderKeys, stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
  const { invalidateMediaOverrides } = await import("../lib/server/media/overrides.ts");
  const { mediaPricing } = await import("../lib/server/media/pricing.ts");
  const { studioVideoPrice } = await import("../lib/media/studio-video-pricing.ts");
  const { setSafeFetchLookup } = await import("../lib/generation/safe-fetch.ts");
  const { VIDEO_SAFETY_MESSAGE } = await import("../lib/generation/video/types.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
  setSafeFetchLookup(async () => ["93.184.216.34"]);
  const realFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = realFetch;
    setSafeFetchLookup(null);
    stopProviderKeyRefresh();
    await pool().end();
    await iso.drop();
  });

  /* ── fal stub ── */
  type Call = { url: string; method: string; auth: string | null; body: Record<string, unknown> | null };
  const stub = { calls: [] as Call[], submitStatus: 200, submitBody: null as unknown, status: { status: "IN_PROGRESS" } as Record<string, unknown>, result: { video: { url: `${CDN}clip.mp4` } } as unknown, clipSeconds: 5, counter: 0 };
  const resetStub = () => Object.assign(stub, { calls: [], submitStatus: 200, submitBody: null, status: { status: "IN_PROGRESS" }, result: { video: { url: `${CDN}clip.mp4` } }, clipSeconds: 5, counter: 0 });
  const reqId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    stub.calls.push({ url, method, auth, body });
    if (url === INITIATE) return jsonRes({ upload_url: UPLOAD, file_url: FILE });
    if (url === UPLOAD) return new Response(null, { status: 200 });
    if (url === DELETE_URL) return jsonRes({});
    if (url.startsWith(CDN)) return new Response(Buffer.from(fakeMp4(stub.clipSeconds)), { status: 200, headers: { "content-type": "video/mp4" } });
    if (url.startsWith(QUEUE) && method === "POST") return jsonRes(stub.submitBody ?? { request_id: reqId(++stub.counter) }, stub.submitStatus);
    if (url.startsWith(QUEUE) && method === "PUT") return jsonRes({ status: "CANCELLATION_REQUESTED" }, 202);
    if (url.startsWith(QUEUE) && url.endsWith("/status")) return jsonRes(stub.status);
    if (url.startsWith(QUEUE)) return jsonRes(stub.result);
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as unknown as typeof fetch;
  const submits = () => stub.calls.filter((c) => c.url.startsWith(QUEUE) && c.method === "POST");
  const deletes = () => stub.calls.filter((c) => c.url === DELETE_URL);

  /* ── fixtures ── */
  let n = 0;
  const mkUser = async (balance: number) => String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, $2) RETURNING id`, [`smp-${Date.now()}-${n++}`, balance]))[0]!.id);
  const wallet = async (userId: string) => Number((await query<{ balance: string }>(`SELECT balance::text FROM users WHERE id = $1`, [userId]))[0]!.balance);
  const cookieOf = async (userId: string) => `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
  const post = async (userId: string, values: Record<string, unknown>) => {
    await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
    const req = new Request("http://localhost/api/generations", { method: "POST", headers: { cookie: await cookieOf(userId), "content-type": "application/json" }, body: JSON.stringify({ slug: "studio-video", values }) });
    const r = await inRequest(req, () => route.POST(req));
    return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; price?: number } };
  };
  const catalog = async () => {
    const req = new Request("http://localhost/api/media/catalog?purpose=studio.video");
    const r = await inRequest(req, () => catalogRoute.GET(req));
    return ((await r.json()) as { models: { id: string }[] }).models.map((m) => m.id);
  };
  const setSetting = async (key: string, value: unknown) => {
    await query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
    settings.invalidateSettingsCache();
  };
  const setOverride = async (modelId: string, enabled: boolean | null) => {
    await query("DELETE FROM media_model_overrides WHERE model_id = $1", [modelId]);
    if (enabled !== null) await query("INSERT INTO media_model_overrides (model_id, enabled) VALUES ($1, $2)", [modelId, enabled]);
    invalidateMediaOverrides();
  };
  const photo = async (userId: string, assetId = ASSET) => {
    await query(`DELETE FROM photo_uploads WHERE asset_id = $1`, [assetId]);
    await query(`INSERT INTO photo_uploads (user_id, asset_id, kind, mime, size_bytes, bytes) VALUES ($1,$2,'crop','image/png',5,$3)`, [userId, assetId, Buffer.from("start")]);
  };
  const speech = async (userId: string, seconds: number) => {
    const id = randomUUID();
    const doc = { meta: {}, speech: { model: "elevenlabs/eleven-v3", seconds, chars: 10, voices: ["A"], lines: [], clone: false } };
    const bytes = Buffer.from("ID3-flow-speech-bytes");
    await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, doc_json) VALUES ($1, $2, 'studio-speech', 'Salom', 'COMPLETED', 500, 'mp3', $3::jsonb)`, [id, userId, JSON.stringify(doc)]);
    await query(`INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes) VALUES ($1, 'ovoz.mp3', 'audio/mpeg', $2, $3)`, [id, bytes.length, bytes]);
    return id;
  };
  const clearAll = async (on: readonly string[] = NEW_VIDEO) => {
    await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
    await query(`UPDATE media_jobs SET status = 'failed' WHERE status IN ('pending','submitting')`);
    await setSetting("video.enabled", true);
    for (const id of NEW_VIDEO) await setOverride(id, on.includes(id) ? true : null);
    await reloadProviderKeys();
    resetStub();
  };
  const gen = async (id: string) =>
    (await query<{ status: string; error: string | null; cost_json: { usd: number; model: string; provider: string } | null; doc_json: { video?: Record<string, unknown> } | null }>(`SELECT status, error, cost_json, doc_json FROM generations WHERE id = $1`, [id]))[0]!;
  const row = async (id: string) =>
    (await query<{ status: string; provider: string; op_id: string | null; params: Record<string, unknown>; cost_usd: string; last_error: string | null }>(`SELECT status, provider, op_id, params, cost_usd::text, last_error FROM media_jobs WHERE idempotency_key = $1`, [`${id}:video:0`]))[0];
  const refunds = async (id: string) => Number((await query<{ n: string }>(`SELECT count(*)::text AS n FROM transactions WHERE kind = 'refund' AND reference = $1`, [id]))[0]!.n);
  const makeDue = (id: string) => query(`UPDATE media_jobs SET next_poll_at = now() - interval '1 second' WHERE idempotency_key = $1`, [`${id}:video:0`]);
  const startWaiting = async (userId: string, values: Record<string, unknown>) => {
    const r = await post(userId, values);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const job = await worker.claimNext();
    assert.equal(job?.id, r.body.id);
    await worker.runJob(job!);
    return r.body.id!;
  };

  await t.test("gating: hidden and refused until the admin's switch, listed and sold after it", async () => {
    await clearAll([]);
    const me = await mkUser(500_000);
    await photo(me);
    const listed = await catalog();
    for (const id of NEW_VIDEO) assert.ok(!listed.includes(id), `${id} ships hidden`);
    const refused = await post(me, { modelId: PIXFX, effect: "Liquid Metal", imageAssetId: ASSET });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "model_unavailable");
    assert.equal(await wallet(me), 500_000, "nothing charged");
    assert.equal(stub.calls.length, 0, "fal never called");
    await setOverride(PIXFX, true);
    assert.ok((await catalog()).includes(PIXFX), "the switch lists it");
    assert.ok(!(await catalog()).includes(KFX), "only that one");
    assert.ok(!(await catalog()).includes("kling/effects"), "the direct Kling effects stay hidden");
  });

  await t.test("effects: one POST to the page's endpoint, the shared poll loop, priced per clip", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    await photo(me);
    const values = { modelId: KFX, effect: "hug_pro", imageAssetId: ASSET };
    const price = studioVideoPrice(values, await mediaPricing())!;
    assert.equal(price, 7_200, "$0.28 × 12 700 × 2 = 7 112 → 7 200");
    const id = await startWaiting(me, values);
    assert.equal(await wallet(me), 500_000 - price);
    assert.equal(submits().length, 1);
    const c = submits()[0]!;
    assert.equal(c.url, `${QUEUE}/fal-ai/kling-video/v1.6/standard/effects`);
    assert.equal(c.auth, `Key ${FKEY}`);
    assert.deepEqual(c.body, { effect_scene: "hug_pro", input_image_urls: [`data:image/png;base64,${Buffer.from("start").toString("base64")}`], duration: "5", enable_safety_checker: true });
    const r = (await row(id))!;
    assert.equal(r.op_id, `fal:fal-ai/kling-video/v1.6/standard/effects:${reqId(1)}`);
    assert.equal(Number(r.cost_usd), 0.28);
    stub.status = { status: "COMPLETED" };
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const done = await gen(id);
    assert.equal(done.status, "COMPLETED", String(done.error));
    assert.equal(done.doc_json!.video!.effect, "hug_pro");
    assert.equal(done.doc_json!.video!.model, KFX);
    assert.equal(done.cost_json!.usd, 0.28, "per clip");
    assert.equal(done.cost_json!.provider, "fal");
    assert.equal((await row(id))!.status, "succeeded");
    assert.equal(deletes().length, 0, "nothing was stored for an effect");
  });

  await t.test("effects: a content refusal refunds once with the safety message", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    await photo(me);
    const id = await startWaiting(me, { modelId: PIXFX, effect: "Liquid Metal", imageAssetId: ASSET });
    assert.equal(submits()[0]!.url, `${QUEUE}/fal-ai/pixverse/v5.5/effects`);
    assert.equal(submits()[0]!.body!.effect, "Liquid Metal");
    stub.status = { status: "COMPLETED", error: "blocked", error_type: "content_policy_violation" };
    await makeDue(id);
    await ops.pollDueVideoOps();
    const g = await gen(id);
    assert.equal(g.status, "FAILED");
    assert.equal(g.error, VIDEO_SAFETY_MESSAGE);
    assert.equal(await wallet(me), 500_000);
    assert.equal(await refunds(id), 1);
  });

  await t.test("grok: the input image is in the charge, the stored cost and the delivered cost", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    await photo(me);
    const values = { modelId: GROK, prompt: "Registon at dawn", seconds: 5, imageAssetId: ASSET };
    const price = studioVideoPrice(values, await mediaPricing())!;
    assert.equal(price, 4_100, "$0.16 × 12 700 × 2 = 4 064 → 4 100");
    const id = await startWaiting(me, values);
    assert.equal(await wallet(me), 500_000 - price);
    assert.equal(submits()[0]!.url, `${QUEUE}/xai/grok-imagine-video/v1.5/lite/image-to-video`);
    assert.equal(Number((await row(id))!.cost_usd), 0.16);
    stub.status = { status: "COMPLETED" };
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    assert.equal((await gen(id)).cost_json!.usd, 0.16);
  });

  await t.test("avatars: flow — server length, audio through fal storage, URL on the row before the call, file deleted when the op ends", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    await photo(me);
    const audioId = await speech(me, 7.04);
    const values = { modelId: OMNI, audioId, imageAssetId: ASSET, seconds: 4 };
    const price = studioVideoPrice({ ...values, seconds: 7 }, await mediaPricing())!;
    assert.equal(price, 18_700, "$0.105 × 7 s × 12 700 × 2 = 18 669 → 18 700");
    const id = await startWaiting(me, values);
    assert.equal(await wallet(me), 500_000 - price, "the forged 4 s is not charged");
    assert.deepEqual(stub.calls.map((c) => c.url), [INITIATE, UPLOAD, `${QUEUE}/bytedance/omnihuman/v2`]);
    assert.deepEqual(submits()[0]!.body, { image_url: `data:image/png;base64,${Buffer.from("start").toString("base64")}`, audio_url: FILE });
    const r = (await row(id))!;
    assert.deepEqual([r.status, r.op_id, r.params.seconds, r.params.falUpload], ["pending", `fal:bytedance/omnihuman/v2:${reqId(1)}`, 7, FILE]);
    assert.ok(Math.abs(Number(r.cost_usd) - 0.735) < 1e-9);

    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0);
    assert.equal(deletes().length, 0, "a running op keeps its input");
    stub.status = { status: "COMPLETED" };
    stub.clipSeconds = 7;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const done = await gen(id);
    assert.equal(done.status, "COMPLETED", String(done.error));
    assert.equal(done.doc_json!.video!.model, OMNI);
    assert.equal(done.cost_json!.provider, "fal");
    assert.equal(deletes().length, 1, "the file is gone with the op");
    assert.equal(deletes()[0]!.body!.file_url, FILE);
    assert.equal((await row(id))!.params.falUpload, undefined, "the row forgets it");
  });

  await t.test("avatars: a failed op deletes the file and refunds once; a refused submit deletes it and refunds at once", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    await photo(me);
    const audioId = await speech(me, 6);
    const id = await startWaiting(me, { modelId: KAVATAR, audioId, imageAssetId: ASSET });
    assert.equal(submits()[0]!.url, `${QUEUE}/fal-ai/kling-video/ai-avatar/v2/standard`);
    stub.status = { status: "COMPLETED", error: "no face found" };
    await makeDue(id);
    await ops.pollDueVideoOps();
    assert.equal((await gen(id)).status, "FAILED");
    assert.equal(await wallet(me), 500_000);
    assert.equal(await refunds(id), 1);
    assert.equal(deletes().length, 1, "the file is gone with the failed op");

    resetStub();
    stub.submitStatus = 422;
    stub.submitBody = { detail: [{ msg: "bad audio", type: "unprocessable" }] };
    const r2 = await startWaiting(me, { modelId: KAVATAR, audioId, imageAssetId: ASSET });
    assert.equal((await gen(r2)).status, "FAILED");
    assert.equal(await wallet(me), 500_000);
    assert.equal(deletes().length, 1, "the adapter deleted its own upload");
  });

  await t.test("avatars: limits — another user's speech, too short for OmniHuman, over 30 s: 400, nothing charged, nothing sent", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    const other = await mkUser(0);
    await photo(me);
    const theirs = await speech(other, 10);
    const short = await speech(me, 3);
    const long = await speech(me, 45);
    const v = (modelId: string, audioId: string) => ({ modelId, audioId, imageAssetId: ASSET });
    assert.equal((await post(me, v(OMNI, theirs))).status, 400, "another user's speech");
    const s = await post(me, v(OMNI, short));
    assert.equal(s.status, 400);
    assert.match(s.body.error!, /kamida 4 soniya/);
    const l = await post(me, v(OMNI, long));
    assert.equal(l.status, 400);
    assert.match(l.body.error!, /30 soniyadan/);
    assert.equal((await post(me, v(KAVATAR, long))).status, 400);
    assert.equal(await wallet(me), 500_000);
    assert.equal(stub.calls.length, 0);
    const ok = await post(me, v(KAVATAR, short));
    assert.equal(ok.status, 202, "Kling's page states no minimum");
    assert.equal(await wallet(me), 500_000 - studioVideoPrice({ ...v(KAVATAR, short), seconds: 3 }, await mediaPricing())!);
  });

  await t.test("avatars: a stored job without its speech is failed and refunded, nothing is sent", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    await photo(me);
    const audioId = await speech(me, 6);
    const r = await post(me, { modelId: OMNI, audioId, imageAssetId: ASSET });
    assert.equal(r.status, 202);
    // The stored job loses its speech between the purchase and the worker.
    await query(`UPDATE generations SET values_json = values_json - 'audioId' WHERE id = $1`, [r.body.id]);
    const job = await worker.claimNext();
    assert.equal(job?.id, r.body.id);
    await worker.runJob(job!);
    assert.equal((await gen(r.body.id!)).status, "FAILED");
    assert.equal(await wallet(me), 500_000);
    assert.equal(stub.calls.length, 0);
  });
});
