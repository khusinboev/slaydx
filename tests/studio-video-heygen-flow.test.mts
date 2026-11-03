import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * STUDIO P9 — HeyGen avatar videos end to end on a real (isolated) Postgres, HeyGen stubbed at `fetch`
 * (docs/studio/P9-HEYGEN.md). HeyGen is NEVER called for real.
 *   gating   no `HEYGEN_API_KEY` → `heygen/avatar` not in the catalog and the route refuses it (400 `model_unavailable`)
 *            before any charge or call; with a key → listed; switched off in «Media modellari» → hidden + 400;
 *   flow     script: the server overwrites a forged `seconds` from the script BEFORE pricing → charged that length;
 *            submit = voice list + ONE create (row written first) → `heygen:<id>` parked → THE shared poll loop: processing
 *            → rescheduled, completed → MP4 downloaded without the key → COMPLETED (`doc.video.model`, `cost_json`), a
 *            short clip refunds the missing seconds; a re-claim never resubmits;
 *   own      a speech result of the user → priced by its stored length, uploaded as an asset, `audio_asset_id` sent;
 *            another user's speech → 400, nothing charged;
 *   refunds  `failed` (policy → the safety message) and a create 4xx refund once; the deadline asks HeyGen to DELETE the
 *            clip and refunds once.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. registry without `heygen`                                            -> every subtest (the provider is never usable);
 *   2. `prepareAvatarRequest` not called by submit-generation               -> «flow» (forged seconds charged), «own»;
 *   3. the own-speech SQL without `g.user_id = $2`                          -> «own» (a foreign speech accepted);
 *   4. `studioVideoAdapters` without `heygen-video`                         -> «flow», «own», «refunds» (the worker
 *      refunds «not available»; the catalog still lists it — availability is the provider key + switch).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "AIza-test-gemini-key-0123456789";
delete process.env.HEYGEN_API_KEY;
const HKEY = "hg-flow-key-0123456789abcdef";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studioheygen") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const API = "https://api.heygen.com";
const FILES = "https://files2.heygen.ai/video/";
const MODEL = "heygen/avatar";
const SCRIPT = "Assalomu alaykum! Bugun yangi kurs haqida gapiramiz."; // 52 characters → 5 s

test("studio-video P9: HeyGen avatar — gating by key, script + own speech flows on the shared poll loop, refunds", { skip }, async (t) => {
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
    delete process.env.HEYGEN_API_KEY;
    setSafeFetchLookup(null);
    stopProviderKeyRefresh();
    await pool().end();
    await iso.drop();
  });

  /* ── HeyGen stub ── */
  type Call = { url: string; method: string; key: string | null; body: unknown };
  const stub = {
    calls: [] as Call[],
    createStatus: 200,
    createBody: null as unknown,
    status: { status: "processing" } as Record<string, unknown>,
    clipSeconds: 5,
    counter: 0,
  };
  const resetStub = () => Object.assign(stub, { calls: [], createStatus: 200, createBody: null, status: { status: "processing" }, clipSeconds: 5, counter: 0 });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = new Headers(init?.headers).get("x-api-key");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body instanceof FormData ? init.body : null;
    stub.calls.push({ url, method, key, body });
    if (url.startsWith(`${API}/v3/voices`)) return jsonRes({ data: [{ voice_id: "uz_female_1", language: "Uzbek", gender: "female" }] });
    if (url === `${API}/v3/assets`) return jsonRes({ data: { asset_id: "asset_flow_1" } });
    if (url === `${API}/v3/videos` && method === "POST") return jsonRes(stub.createBody ?? { data: { video_id: `v_flow_${++stub.counter}` } }, stub.createStatus);
    if (url.startsWith(`${API}/v3/videos/`) && method === "DELETE") return jsonRes({ data: { deleted: true } });
    if (url.startsWith(`${API}/v3/videos/`)) {
      const id = url.slice(`${API}/v3/videos/`.length);
      return jsonRes({ data: { id, ...stub.status, ...(stub.status.status === "completed" ? { video_url: `${FILES}${id}.mp4?Expires=1` } : {}) } });
    }
    if (url.startsWith(FILES)) return new Response(Buffer.from(fakeMp4(stub.clipSeconds)), { status: 200, headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as unknown as typeof fetch;
  const creates = () => stub.calls.filter((c) => c.url === `${API}/v3/videos` && c.method === "POST");

  /* ── fixtures ── */
  let n = 0;
  const mkUser = async (balance: number) =>
    String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, $2) RETURNING id`, [`shg-${Date.now()}-${n++}`, balance]))[0]!.id);
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
  const speech = async (userId: string, seconds: number) => {
    const id = randomUUID();
    const doc = { meta: {}, speech: { model: "elevenlabs/eleven-v3", seconds, chars: 10, voices: ["A"], lines: [], clone: false } };
    const bytes = Buffer.from("ID3-flow-speech-bytes");
    await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, doc_json) VALUES ($1, $2, 'studio-speech', 'Salom', 'COMPLETED', 500, 'mp3', $3::jsonb)`, [id, userId, JSON.stringify(doc)]);
    await query(`INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes) VALUES ($1, 'ovoz.mp3', 'audio/mpeg', $2, $3)`, [id, bytes.length, bytes]);
    return id;
  };
  const clearAll = async () => {
    await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
    await query(`UPDATE media_jobs SET status = 'failed' WHERE status IN ('pending','submitting')`);
    await setSetting("video.enabled", true);
    await setOverride(MODEL, null);
    process.env.HEYGEN_API_KEY = HKEY;
    await reloadProviderKeys();
    resetStub();
  };
  const gen = async (id: string) =>
    (await query<{ status: string; error: string | null; cost_json: { usd: number; model: string; provider: string } | null; doc_json: { video?: Record<string, unknown> } | null; delivered_json: { got: number; want: number } | null }>(
      `SELECT status, error, cost_json, doc_json, delivered_json FROM generations WHERE id = $1`,
      [id],
    ))[0]!;
  const row = async (id: string) => (await query<{ status: string; provider: string; op_id: string | null; params: Record<string, unknown>; cost_usd: string; last_error: string | null }>(`SELECT status, provider, op_id, params, cost_usd::text, last_error FROM media_jobs WHERE idempotency_key = $1`, [`${id}:video:0`]))[0];
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
  const SCRIPTED = { modelId: MODEL, prompt: SCRIPT, seconds: 1 };

  await t.test("gating: no key → not listed + 400 before charging; a key → listed; switched off → hidden + 400", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    delete process.env.HEYGEN_API_KEY;
    await reloadProviderKeys();
    assert.ok(!(await catalog()).includes(MODEL), "no key: not listed");
    const refused = await post(me, SCRIPTED);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "model_unavailable");
    assert.equal(await wallet(me), 500_000, "nothing charged");
    assert.equal(stub.calls.length, 0, "HeyGen never called");
    process.env.HEYGEN_API_KEY = HKEY;
    await reloadProviderKeys();
    assert.ok((await catalog()).includes(MODEL), "MUTATSIYA: keyed but not listed");
    await setOverride(MODEL, false);
    assert.ok(!(await catalog()).includes(MODEL));
    assert.equal((await post(me, SCRIPTED)).status, 400);
    await setOverride(MODEL, null);
    assert.equal(await wallet(me), 500_000);
  });

  await t.test("flow: script — server length (forged seconds ignored), voice + ONE create, shared poll → MP4, short clip refunded, no resubmit", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    const price = studioVideoPrice({ ...SCRIPTED, seconds: 5 }, await mediaPricing())!;
    assert.equal(price, 10_300, "$0.0805 × 5 s × 12 700 × 2 = 10 223.5 → 10 300");
    const id = await startWaiting(me, SCRIPTED);
    assert.equal(await wallet(me), 500_000 - price, "MUTATSIYA: the forged 1 s charged");
    assert.equal(creates().length, 1);
    const c = creates()[0]!;
    assert.equal(c.key, HKEY);
    assert.deepEqual(c.body, { type: "avatar", avatar_id: "Angela-inblackskirt-20220820", script: SCRIPT, voice_id: "uz_female_1", resolution: "720p", aspect_ratio: "16:9", engine: { type: "avatar_iv" } });
    const r = (await row(id))!;
    assert.deepEqual([r.status, r.provider, r.op_id, r.params.seconds], ["pending", "heygen", "heygen:v_flow_1", 5]);
    assert.equal(Number(r.cost_usd), 0.4025);

    await ops.submitStudioVideoJob({ id, userId: me, lease: "other", values: { ...SCRIPTED, seconds: 5 } as never });
    assert.equal(creates().length, 1, "a re-claim adopts the parked op");

    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0);
    assert.equal(stub.calls.at(-1)!.url, `${API}/v3/videos/v_flow_1`);
    assert.equal((await gen(id)).status, "IN_PROGRESS");

    stub.status = { status: "completed" };
    stub.clipSeconds = 3;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const download = stub.calls.find((x) => x.url.startsWith(FILES))!;
    assert.equal(download.key, null, "downloaded without the key");
    const done = await gen(id);
    assert.equal(done.status, "COMPLETED", String(done.error));
    assert.equal(done.doc_json!.video!.model, MODEL);
    assert.equal(done.doc_json!.video!.provider, "heygen");
    assert.equal(done.cost_json!.provider, "heygen");
    assert.equal(done.cost_json!.usd, Number((0.0805 * 3).toFixed(4)), "cost at the delivered length");
    assert.deepEqual([done.delivered_json!.got, done.delivered_json!.want], [3, 5]);
    assert.equal(await refunds(id), 1, "the missing 2 seconds came back");
    assert.equal((await row(id))!.status, "succeeded");
  });

  await t.test("own speech: priced by its stored length, uploaded as an asset, audio_asset_id sent; a foreign speech → 400, nothing charged", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    const other = await mkUser(0);
    const theirs = await speech(other, 12.3);
    const refused = await post(me, { modelId: MODEL, audioId: theirs });
    assert.equal(refused.status, 400, "MUTATSIYA: another user's speech accepted");
    assert.match(String(refused.body.error), /Ovoz topilmadi/);
    assert.equal(await wallet(me), 500_000);
    const long = await speech(me, 75);
    assert.equal((await post(me, { modelId: MODEL, audioId: long })).status, 400, "over a minute");
    const mine = await speech(me, 12.3);
    const price = studioVideoPrice({ modelId: MODEL, audioId: mine, seconds: 13 }, await mediaPricing())!;
    const id = await startWaiting(me, { modelId: MODEL, audioId: mine, seconds: 60 });
    assert.equal(await wallet(me), 500_000 - price, "12.3 s → 13 s, not the request's 60");
    const upload = stub.calls.find((x) => x.url === `${API}/v3/assets`)!;
    assert.ok(upload.body instanceof FormData);
    const file = (upload.body as FormData).get("file") as File;
    assert.equal(Buffer.from(await file.arrayBuffer()).toString(), "ID3-flow-speech-bytes");
    assert.equal(upload.key, HKEY);
    assert.deepEqual(creates()[0]!.body, { type: "avatar", avatar_id: "Angela-inblackskirt-20220820", audio_asset_id: "asset_flow_1", resolution: "720p", aspect_ratio: "16:9", engine: { type: "avatar_iv" } });
    assert.ok(!stub.calls.some((x) => x.url.includes("/v3/voices")), "no voice lookup for an own speech");
    assert.equal((await row(id))!.params.seconds, 13);
  });

  await t.test("refunds: failed (policy → safety message), a create 4xx, the deadline (DELETE asked) — each refunded once", async () => {
    await clearAll();
    const me = await mkUser(500_000);
    const start = await wallet(me);
    const a = await startWaiting(me, SCRIPTED);
    stub.status = { status: "failed", failure_code: "content_policy_violation", failure_message: "Script rejected" };
    await makeDue(a);
    assert.equal(await ops.pollDueVideoOps(), 1);
    assert.deepEqual([(await gen(a)).status, (await gen(a)).error], ["FAILED", VIDEO_SAFETY_MESSAGE]);
    assert.equal(await refunds(a), 1);
    assert.equal(await ops.failVideo(a, "x", "again"), false);
    assert.equal(await refunds(a), 1);

    resetStub();
    stub.createStatus = 402;
    stub.createBody = { error: { code: "insufficient_credit", message: "Not enough credits" } };
    const b = (await post(me, SCRIPTED)).body.id!;
    const job = await worker.claimNext();
    await worker.runJob(job!);
    assert.equal((await gen(b)).status, "FAILED");
    assert.equal(await refunds(b), 1);

    resetStub();
    const c = await startWaiting(me, SCRIPTED);
    await query(`UPDATE media_jobs SET deadline_at = now() - interval '1 second' WHERE idempotency_key = $1`, [`${c}:video:0`]);
    await makeDue(c);
    await ops.pollDueVideoOps();
    assert.equal((await gen(c)).status, "FAILED");
    assert.equal(await refunds(c), 1);
    assert.ok(stub.calls.some((x) => x.method === "DELETE" && x.url === `${API}/v3/videos/v_flow_1`), "the clip is deleted at HeyGen");
    assert.match(String((await row(c))!.last_error), /provider cancel: cancelled \(op heygen:v_flow_1\)/);
    assert.equal(await wallet(me), start, "every failure refunded in full");
  });
});
