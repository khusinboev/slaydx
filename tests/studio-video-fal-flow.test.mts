import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * STUDIO P4 — the paid async flow of the fal video models (and the Kling P4 shapes) end to end on a real (isolated)
 * Postgres, fal and Kling stubbed at `fetch` (docs/studio/P4-SPEC.md):
 *   gating   `video.enabled` ON + fal keyed → the catalog lists the five fal models; fal switched off in «Provayderlar»
 *            or a model off in «Media modellari» → hidden and refused (400) before any charge; another user's photo as
 *            the END frame → 400, nothing charged;
 *   flow     route → claim → submit (ONE POST to queue.fal.run, the `media_jobs` row written BEFORE it, lease released,
 *            op id `fal:<endpoint>:<request_id>`) → park → THE shared poll loop (`pollDueVideoOps`): IN_PROGRESS →
 *            rescheduled, COMPLETED → result → MP4 downloaded without the key → COMPLETED, doc `video.model`,
 *            `cost_json` from the catalog rule, row `succeeded`; a re-claim adopts the parked op and never resubmits;
 *            image + end frame (Seedance Mini) sends both frames; a short clip refunds the missing seconds;
 *   refunds  COMPLETED with `error`, a content-policy refusal and the deadline each fail + refund ONCE (a second poll /
 *            terminal step does nothing); a submit 4xx and a submit network drop refund at once; a `submitting` row
 *            found on a re-claim is failed, never submitted again;
 *   kling    «Quchoqlash» (two photos → `/v1/videos/effects` dual body) and the Kling 3.0 end frame (`image_tail`).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `studioVideoAdapters` without the `fal-video` adapter            -> «gating» (unavailable: not configured) and «flow»;
 *   2. submit resolves only `imageAssetId` (P3 code)                   -> «flow: image + end frame» (no end frame sent);
 *   3. submit-generation checks only the start photo's owner           -> «gating» (foreign end frame charged);
 *   4. `failVideo` without the refund                                  -> «refunds»;
 *   5. fal poll treats COMPLETED + error as running                    -> «refunds» (waits for the deadline instead);
 *   6. (review M1) no cancel at the deadline                           -> «deadline»;
 *   7. a failing cancel rethrown (blocks the refund)                   -> «deadline»;
 *   8. op id not written to `last_error`                               -> «deadline»;
 *   9. (review N2) video photos skip the input checks                  -> «photos».
 * Review M1 / N2: «deadline» (fal cancel once, refund once, op id kept; failing cancel still refunds; Kling unchanged) and
 * «photos» (type / per-photo size / job total refused before charge).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "AIza-test-gemini-key-0123456789";
process.env.KLING_API_KEY = "AKtest:SKtest";
process.env.FAL_KEY = "fal-flow-key-0000:flowsecretvalue";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiovideofal") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const QUEUE = "https://queue.fal.run";
const CDN = "https://v3b.fal.media/files/flow/";
const KBASE = "https://api-singapore.klingai.com/v1/videos";
const ASSET = "0123456789abcdef01234567";
const ASSET2 = "abcdef0123456789abcdef01";
const FAL_IDS = ["alibaba/wan-3", "bytedance/seedance-2.5", "bytedance/seedance-2-mini", "minimax/h3", "minimax/h3-max-turbo"];

test("studio-video P4: fal models on the shared poll loop, end frame, two-photo effect, refunds", { skip }, async (t) => {
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
  const { getGenerationFile } = await import("../lib/server/storage.ts");
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

  /* ── fal + Kling stub ── */
  type Call = { url: string; method: string; auth: string | null; body: Record<string, unknown> | null };
  const stub = {
    calls: [] as Call[],
    submitStatus: 200,
    submitBody: null as unknown,
    submitThrows: false,
    cancelStatus: 202 as number | "throw",
    status: { status: "IN_PROGRESS" } as Record<string, unknown>,
    result: { video: { url: `${CDN}clip.mp4` } } as unknown,
    clipSeconds: 5,
    counter: 0,
    kPoll: { code: 0, data: { task_status: "processing" } } as unknown,
  };
  const resetStub = () =>
    Object.assign(stub, { calls: [], submitStatus: 200, submitBody: null, submitThrows: false, cancelStatus: 202, status: { status: "IN_PROGRESS" }, result: { video: { url: `${CDN}clip.mp4` } }, clipSeconds: 5, counter: 0, kPoll: { code: 0, data: { task_status: "processing" } } });
  const reqId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    stub.calls.push({ url, method, auth, body });
    if (url.startsWith(`${QUEUE}/`) && method === "POST") {
      if (stub.submitThrows) throw new TypeError("socket hang up");
      return jsonRes(stub.submitBody ?? { request_id: reqId(++stub.counter) }, stub.submitStatus);
    }
    if (url.startsWith(`${QUEUE}/`) && method === "PUT") {
      if (stub.cancelStatus === "throw") throw new TypeError("cancel: connection reset");
      return jsonRes({ status: "CANCELLATION_REQUESTED" }, stub.cancelStatus);
    }
    if (url.startsWith(`${QUEUE}/`) && url.endsWith("/status")) return jsonRes(stub.status, stub.status.status === "COMPLETED" ? 200 : 202);
    if (url.startsWith(`${QUEUE}/`)) return jsonRes(stub.result);
    if (url.startsWith(CDN)) return new Response(Buffer.from(fakeMp4(stub.clipSeconds)), { status: 200, headers: { "content-type": "video/mp4" } });
    if (url.startsWith(KBASE) && method === "POST") return jsonRes({ code: 0, data: { task_id: `K${++stub.counter}` } });
    if (url.startsWith(KBASE)) return jsonRes(stub.kPoll);
    if (url.startsWith("https://cdn.klingai.example/")) return new Response(Buffer.from(fakeMp4(5)), { status: 200, headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as unknown as typeof fetch;
  const submits = () => stub.calls.filter((c) => c.method === "POST");

  /* ── fixtures ── */
  let n = 0;
  const mkUser = async (wallet: { points?: number; balance?: number }) =>
    String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', $2, 0, $3) RETURNING id`, [`svf-${Date.now()}-${n++}`, wallet.points ?? 0, wallet.balance ?? 0]))[0]!.id);
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
  const setSwitch = async (provider: string, enabled: boolean | null) => {
    if (enabled === null) await query(`DELETE FROM provider_settings WHERE provider = $1`, [provider]);
    else await query(`INSERT INTO provider_settings (provider, enabled) VALUES ($1, $2) ON CONFLICT (provider) DO UPDATE SET enabled = $2`, [provider, enabled]);
    await reloadProviderKeys();
  };
  const setOverride = async (modelId: string, enabled: boolean | null) => {
    await query("DELETE FROM media_model_overrides WHERE model_id = $1", [modelId]);
    if (enabled !== null) await query("INSERT INTO media_model_overrides (model_id, enabled) VALUES ($1, $2)", [modelId, enabled]);
    invalidateMediaOverrides();
  };
  const photo = async (userId: string, assetId: string, bytes: string) => {
    await query(`DELETE FROM photo_uploads WHERE asset_id = $1`, [assetId]);
    await query(`INSERT INTO photo_uploads (user_id, asset_id, kind, mime, size_bytes, bytes) VALUES ($1,$2,'crop','image/png',$3,$4)`, [userId, assetId, Buffer.byteLength(bytes), Buffer.from(bytes)]);
  };
  const clearAll = async () => {
    await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
    await query(`UPDATE media_jobs SET status = 'failed' WHERE status IN ('pending','submitting')`);
    await setSetting("video.enabled", true);
    await setSwitch("fal", null);
    for (const id of FAL_IDS) await setOverride(id, null);
    resetStub();
  };
  const gen = async (id: string) =>
    (await query<{ status: string; locked_by: string | null; error: string | null; format: string; cost_json: { usd: number; model: string; provider: string } | null; doc_json: { video?: Record<string, unknown>; sections?: { blocks: { text: string }[] }[] } | null; delivered_json: { got: number; want: number } | null }>(
      `SELECT status, locked_by, error, format, cost_json, doc_json, delivered_json FROM generations WHERE id = $1`,
      [id],
    ))[0]!;
  const row = async (id: string) => (await query<{ status: string; purpose: string; model_id: string; provider: string; upstream_model: string; op_id: string | null; cost_usd: string | null }>(`SELECT status, purpose, model_id, provider, upstream_model, op_id, cost_usd::text FROM media_jobs WHERE idempotency_key = $1`, [`${id}:video:0`]))[0];
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
  const WAN = { modelId: "alibaba/wan-3", prompt: "Tong chog‘ida Registon maydoni", seconds: 5, resolution: "720p", aspect: "16:9" };

  await t.test("gating: fal keyed → the five models listed; fal off / model off → hidden + 400; a foreign end frame → 400; nothing charged", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    const listed = await catalog();
    for (const id of FAL_IDS) assert.ok(listed.includes(id), `${id} listed (MUTATSIYA: fal-video adapter missing)`);
    await setSwitch("fal", false);
    assert.ok(!(await catalog()).some((id) => FAL_IDS.includes(id)), "fal switched off in «Provayderlar»");
    const off = await post(me, WAN);
    assert.equal(off.status, 400);
    assert.equal(off.body.code, "model_unavailable");
    await setSwitch("fal", null);
    await setOverride("minimax/h3", false);
    assert.ok(!(await catalog()).includes("minimax/h3"));
    assert.equal((await post(me, { modelId: "minimax/h3", prompt: "Registon tongda" })).status, 400);
    await setOverride("minimax/h3", null);
    // The end frame must be the user's own upload too (and needs a start).
    await photo(me, ASSET, "start!");
    const foreign = await mkUser({});
    await photo(foreign, ASSET2, "theirs");
    const theirs = await post(me, { ...WAN, imageAssetId: ASSET, endImageAssetId: ASSET2 });
    assert.equal(theirs.status, 400, "MUTATSIYA: only the start photo's owner checked");
    assert.match(String(theirs.body.error), /Surat topilmadi/);
    const noStart = await post(me, { ...WAN, endImageAssetId: ASSET });
    assert.equal(noStart.status, 400);
    assert.equal(await wallet(me), 500_000, "nothing charged");
    assert.equal(submits().length, 0);
  });

  await t.test("flow: Wan 3.0 — one queue submit, parked op, shared poll loop → MP4 + doc + cost; re-claim never resubmits", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    const price = studioVideoPrice(WAN, await mediaPricing())!;
    assert.equal(price, 12_700, "$0.10 × 5 s × 12 700 × 2");
    const id = await startWaiting(me, WAN);
    assert.equal(await wallet(me), 500_000 - price);
    assert.equal(submits().length, 1);
    const sub = submits()[0]!;
    assert.equal(sub.url, `${QUEUE}/alibaba/wan-3.0/text-to-video`);
    assert.equal(sub.auth, `Key ${process.env.FAL_KEY}`);
    assert.deepEqual(sub.body, { prompt: WAN.prompt, resolution: "720p", aspect_ratio: "16:9", duration: 5, audio: true, enable_prompt_expansion: true, enable_safety_checker: true });
    const g = await gen(id);
    assert.equal(g.status, "IN_PROGRESS");
    assert.equal(g.locked_by, null, "waiting holds no worker slot");
    const r = (await row(id))!;
    assert.deepEqual([r.status, r.purpose, r.model_id, r.provider, r.upstream_model, r.op_id], ["pending", "studio.video", "alibaba/wan-3", "fal", "alibaba/wan-3.0", `fal:alibaba/wan-3.0/text-to-video:${reqId(1)}`]);
    assert.equal(Number(r.cost_usd), 0.5);

    await ops.submitStudioVideoJob({ id, userId: me, lease: "other", values: WAN as never });
    assert.equal(submits().length, 1, "a re-claim adopts the parked op");

    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0);
    assert.equal(stub.calls.at(-1)!.url, `${QUEUE}/alibaba/wan-3.0/requests/${reqId(1)}/status`);
    assert.equal((await gen(id)).status, "IN_PROGRESS");

    stub.status = { status: "COMPLETED" };
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const download = stub.calls.find((c) => c.url.startsWith(CDN))!;
    assert.equal(download.auth, null, "the MP4 is downloaded without the key");
    const done = await gen(id);
    assert.equal(done.status, "COMPLETED", String(done.error));
    assert.equal(done.format, "mp4");
    assert.equal(done.doc_json!.video!.model, "alibaba/wan-3");
    assert.equal(done.doc_json!.video!.provider, "fal");
    assert.match(done.doc_json!.sections![0]!.blocks[0]!.text, /Wan 3\.0 · 5 soniya · 720p · 16:9/);
    assert.equal(done.cost_json!.provider, "fal");
    assert.equal(done.cost_json!.model, "Wan 3.0");
    assert.equal(done.cost_json!.usd, 0.5);
    assert.equal((await row(id))!.status, "succeeded");
    assert.equal((await getGenerationFile(id, me))?.mime, "video/mp4");
    assert.equal(await refunds(id), 0);
    const before = stub.calls.length;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0, "a finished op is never polled again");
    assert.equal(stub.calls.length, before);
  });

  await t.test("flow: Seedance Mini image + end frame — both frames sent; a short clip refunds the missing seconds", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    await photo(me, ASSET, "start!");
    await photo(me, ASSET2, "end!!");
    const values = { modelId: "bytedance/seedance-2-mini", prompt: "Gul ochiladi", seconds: 10, resolution: "480p", imageAssetId: ASSET, endImageAssetId: ASSET2 };
    const id = await startWaiting(me, values);
    const sub = submits()[0]!;
    assert.equal(sub.url, `${QUEUE}/bytedance/seedance-2.0/mini/image-to-video`);
    assert.equal(sub.body!.image_url, `data:image/png;base64,${Buffer.from("start!").toString("base64")}`);
    assert.equal(sub.body!.end_image_url, `data:image/png;base64,${Buffer.from("end!!").toString("base64")}`, "MUTATSIYA: submit resolves only the start photo");
    assert.equal(sub.body!.duration, "10");
    assert.equal((await row(id))!.op_id, `fal:bytedance/seedance-2.0/mini/image-to-video:${reqId(1)}`);
    stub.status = { status: "COMPLETED" };
    stub.clipSeconds = 6;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    assert.equal(stub.calls.find((c) => c.url.endsWith("/status"))!.url, `${QUEUE}/bytedance/seedance-2.0/requests/${reqId(1)}/status`, "status under the owner/app");
    const done = await gen(id);
    assert.equal(done.status, "COMPLETED");
    assert.deepEqual([done.delivered_json!.got, done.delivered_json!.want], [6, 10]);
    assert.equal(await refunds(id), 1, "the missing 4 seconds came back");
  });

  await t.test("refunds: COMPLETED + error, content policy, deadline → FAILED + refund once; submit 4xx / network drop refund; submitting row never resubmitted", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    const start = await wallet(me);

    const a = await startWaiting(me, WAN);
    stub.status = { status: "COMPLETED", error: "runner crashed", error_type: "runner_server_error" };
    await makeDue(a);
    assert.equal(await ops.pollDueVideoOps(), 1, "MUTATSIYA: COMPLETED + error treated as running");
    assert.equal((await gen(a)).status, "FAILED");
    assert.equal(await refunds(a), 1);
    assert.equal(await ops.failVideo(a, "x", "again"), false, "a second terminal step does nothing");
    assert.equal(await refunds(a), 1);

    resetStub();
    const b = await startWaiting(me, { ...WAN, modelId: "minimax/h3", resolution: "768p" });
    stub.status = { status: "COMPLETED" };
    stub.result = { detail: [{ type: "content_policy_violation", msg: "flagged" }] };
    // The stub answers every non-status GET with `result`; make it a 422.
    const plain = globalThis.fetch;
    globalThis.fetch = (async (u: unknown, init?: RequestInit) => (String(u).startsWith(`${QUEUE}/minimax/h3/requests/`) && !String(u).endsWith("/status") ? jsonRes(stub.result, 422) : plain(u as never, init))) as typeof fetch;
    await makeDue(b);
    await ops.pollDueVideoOps();
    globalThis.fetch = plain;
    assert.equal((await gen(b)).error, VIDEO_SAFETY_MESSAGE);
    assert.equal(await refunds(b), 1);

    resetStub();
    const c = await startWaiting(me, WAN);
    await query(`UPDATE media_jobs SET deadline_at = now() - interval '1 second' WHERE idempotency_key = $1`, [`${c}:video:0`]);
    await makeDue(c);
    await ops.pollDueVideoOps();
    assert.equal((await gen(c)).status, "FAILED");
    assert.equal(await refunds(c), 1);

    resetStub();
    stub.submitStatus = 422;
    stub.submitBody = { detail: [{ type: "value_error", msg: "bad duration" }] };
    const d = await post(me, WAN);
    await worker.runJob((await worker.claimNext())!);
    assert.equal((await gen(d.body.id!)).status, "FAILED");
    assert.equal(await refunds(d.body.id!), 1);
    assert.equal((await row(d.body.id!))!.status, "failed");

    resetStub();
    stub.submitThrows = true;
    const e = await post(me, WAN);
    await worker.runJob((await worker.claimNext())!);
    assert.equal((await gen(e.body.id!)).status, "FAILED");
    assert.equal(await refunds(e.body.id!), 1);
    assert.equal(submits().length, 1, "accepted (maybe queued at fal): never sent to a second route");

    // A worker died between the provider call and the op-id update: the row is `submitting`; a re-claim fails it.
    resetStub();
    const f = await startWaiting(me, WAN);
    await query(`UPDATE media_jobs SET status = 'submitting', op_id = NULL WHERE idempotency_key = $1`, [`${f}:video:0`]);
    await assert.rejects(ops.submitStudioVideoJob({ id: f, userId: me, lease: "x", values: WAN as never }));
    assert.equal(submits().length, 1, "never submitted twice");
    assert.equal((await row(f))!.status, "failed");
    // The worker that owns the job fails it and refunds it (the same path as any submit throw).
    await query(`UPDATE generations SET status = 'QUEUED', locked_by = NULL, locked_at = NULL WHERE id = $1`, [f]);
    await worker.runJob((await worker.claimNext())!);
    assert.equal((await gen(f)).status, "FAILED");
    assert.equal(await refunds(f), 1);
    assert.equal(submits().length, 1, "the worker's re-run did not submit either");

    assert.equal(await wallet(me), start, "every failed clip came back");
  });

  await t.test("deadline (review M1): fal cancel PUT once, refund once, op id kept for reconciliation; a failing cancel never blocks the refund", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    const lastError = async (id: string) => (await query<{ last_error: string | null; op_id: string | null }>(`SELECT last_error, op_id FROM media_jobs WHERE idempotency_key = $1`, [`${id}:video:0`]))[0]!;
    const expire = (id: string) => query(`UPDATE media_jobs SET deadline_at = now() - interval '1 second', next_poll_at = now() - interval '1 second' WHERE idempotency_key = $1`, [`${id}:video:0`]);

    const a = await startWaiting(me, WAN);
    await expire(a);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const puts = stub.calls.filter((c) => c.method === "PUT");
    assert.equal(puts.length, 1, "MUTATSIYA: no cancel at the deadline");
    assert.equal(puts[0]!.url, `${QUEUE}/alibaba/wan-3.0/requests/${reqId(1)}/cancel`);
    assert.equal(puts[0]!.auth, `Key ${process.env.FAL_KEY}`);
    assert.equal((await gen(a)).status, "FAILED");
    assert.equal(await refunds(a), 1);
    const row1 = await lastError(a);
    assert.equal(row1.op_id, `fal:alibaba/wan-3.0/text-to-video:${reqId(1)}`, "the row keeps its op id");
    assert.match(String(row1.last_error), /provider cancel: cancelled \(op fal:alibaba\/wan-3\.0\/text-to-video:/);
    await makeDue(a);
    assert.equal(await ops.pollDueVideoOps(), 0);
    assert.equal(stub.calls.filter((c) => c.method === "PUT").length, 1, "cancelled once");
    assert.equal(await refunds(a), 1, "refunded once");

    // fal says it had already finished (400): still refunded, the note says «completed» for the billing check.
    resetStub();
    const b = await startWaiting(me, WAN);
    stub.cancelStatus = 400;
    await expire(b);
    await ops.pollDueVideoOps();
    assert.equal(await refunds(b), 1);
    assert.match(String((await lastError(b)).last_error), /provider cancel: completed/);

    // The cancel itself fails (network / 5xx): the refund still happens.
    for (const failing of ["throw", 503] as const) {
      resetStub();
      const c = await startWaiting(me, WAN);
      stub.cancelStatus = failing;
      await expire(c);
      assert.equal(await ops.pollDueVideoOps(), 1);
      assert.equal((await gen(c)).status, "FAILED", "MUTATSIYA: a failing cancel blocks the refund");
      assert.equal(await refunds(c), 1);
      assert.match(String((await lastError(c)).last_error), /provider cancel failed \(op fal:/);
    }

    // Kling has no cancel: its deadline is exactly the P3 behaviour (no PUT, plain «deadline» detail).
    resetStub();
    const k = await startWaiting(me, { modelId: "kling/kling-3", prompt: "Gul ochiladi", seconds: 5 });
    await expire(k);
    await ops.pollDueVideoOps();
    assert.equal(stub.calls.filter((c) => c.method === "PUT").length, 0);
    assert.equal((await lastError(k)).last_error, "deadline");
    assert.equal(await refunds(k), 1);
  });

  await t.test("photos (review N2): type, per-photo size and the job's total are refused (400) before any charge", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    const put = async (assetId: string, mime: string, size: number) => {
      await query(`DELETE FROM photo_uploads WHERE asset_id = $1`, [assetId]);
      await query(`INSERT INTO photo_uploads (user_id, asset_id, kind, mime, size_bytes, bytes) VALUES ($1,$2,'crop',$3,$4,$5)`, [me, assetId, mime, size, Buffer.from("x")]);
    };
    await put(ASSET, "image/gif", 100);
    const gif = await post(me, { ...WAN, imageAssetId: ASSET });
    assert.equal(gif.status, 400, "MUTATSIYA: video photos skip the input checks");
    assert.equal(gif.body.code, "input_invalid");
    await put(ASSET, "image/jpeg", 6 * 1024 * 1024);
    assert.equal((await post(me, { ...WAN, imageAssetId: ASSET })).status, 400, "over the 5 MB photo limit");
    await put(ASSET, "image/jpeg", 4.5 * 1024 * 1024);
    await put(ASSET2, "image/png", 4.5 * 1024 * 1024);
    const both = await post(me, { ...WAN, imageAssetId: ASSET, endImageAssetId: ASSET2 });
    assert.equal(both.status, 400, "start + end over the 8 MB job total");
    assert.match(String(both.body.error), /jami/);
    // The second photo of a two-photo effect is checked as well.
    await put(ASSET, "image/jpeg", 1000);
    await put(ASSET2, "image/gif", 1000);
    assert.equal((await post(me, { modelId: "kling/effects", effect: "hug", imageAssetId: ASSET, secondImageAssetId: ASSET2 })).status, 400);
    assert.equal(await wallet(me), 500_000, "nothing charged");
    assert.equal(submits().length, 0);
    // A good pair passes.
    await put(ASSET2, "image/png", 1000);
    assert.equal((await post(me, { ...WAN, imageAssetId: ASSET, endImageAssetId: ASSET2 })).status, 202);
  });

  await t.test("kling: «Quchoqlash» sends two photos to /effects; Kling 3.0 end frame sends image_tail", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    await photo(me, ASSET, "first!");
    await photo(me, ASSET2, "second");
    assert.equal((await post(me, { modelId: "kling/effects", effect: "hug", imageAssetId: ASSET })).status, 400, "hug needs two photos");
    const hug = await startWaiting(me, { modelId: "kling/effects", effect: "hug", imageAssetId: ASSET, secondImageAssetId: ASSET2 });
    const sub = submits()[0]!;
    assert.equal(sub.url, `${KBASE}/effects`);
    assert.deepEqual(sub.body, { effect_scene: "hug", input: { model_name: "kling-v1-6", mode: "std", images: [Buffer.from("first!").toString("base64"), Buffer.from("second").toString("base64")], duration: "5" } });
    stub.kPoll = { code: 0, data: { task_status: "succeed", task_result: { videos: [{ url: "https://cdn.klingai.example/hug.mp4" }] } } };
    await makeDue(hug);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const done = await gen(hug);
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.doc_json!.video!.effect, "hug");
    assert.equal(done.cost_json!.usd, 0.84);

    resetStub();
    await startWaiting(me, { modelId: "kling/kling-3", prompt: "Gul ochiladi", seconds: 5, imageAssetId: ASSET, endImageAssetId: ASSET2 });
    const k = submits()[0]!;
    assert.equal(k.url, `${KBASE}/image2video`);
    assert.equal(k.body!.image, Buffer.from("first!").toString("base64"));
    assert.equal(k.body!.image_tail, Buffer.from("second").toString("base64"));
  });
});
