import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * STUDIO «VIDEO» — the paid async flow of `studio-video` end to end on a real (isolated) Postgres, Kling stubbed at
 * `fetch` (docs/studio/P3-SPEC.md):
 *   gating   `video.enabled` OFF (the shipped default) → no model in the session / catalog, POST 400, nothing charged;
 *            ON → the catalog lists Omni + Kling; Kling switched off in «Provayderlar» or a model switched off in «Media
 *            modellari» → not listed and refused (400) before any charge;
 *   money    the server price = cost × markup (the catalog block), PAID balance only (bonus refused, 402);
 *   flow     route → claim → submit (ONE provider call, the media_jobs row `studio.video` written BEFORE it, lease
 *            released) → park → poll (running → rescheduled) → succeed → MP4 stored, doc `video.model`, cost_json from
 *            the catalog rule, row `succeeded`; the effect flow on `/v1/videos/effects`; a re-claim adopts the parked
 *            op and never submits twice;
 *   refunds  provider failure, safety refusal and the deadline each fail + refund ONCE (a second poll does nothing);
 *            a provider 4xx at submit refunds at once; an effect whose photo vanished refunds without a provider call;
 *   gallery  my pictures and my clips together, newest first; a clip carries `kind: video` and its own file URL.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `claimDueOps` without the `studio.video` claim                 -> «flow: Kling 3.0» (never finishes);
 *   2. `pollerFor` studio branch removed (old `videoRoute` path)      -> «flow: effect» (the old Kling adapter cannot ask /effects);
 *   3. `failVideo` without the refund                                 -> «refunds»;
 *   4. submit-generation without the `video.enabled` check for studio -> «gating»;
 *   5. `isPaidOnlyTool` = only `video`                                -> «money»;
 *   6. `studioVideoModels` ignores `video.enabled`                    -> «gating» (catalog lists models while off);
 *   7. gallery SQL only `studio-image`                                -> «gallery»;
 *   8. `claimDueOps` claims `video.clip` first, then `studio.video`   -> «poll claim» (the oldest-due Studio row waits);
 *   9. gallery `videoOf` without `sound` / `requestedSeconds`         -> «gallery».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "AIza-test-gemini-key-0123456789";
process.env.KLING_API_KEY = "klingtestkey";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiovideo") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const KHOST = "https://api-singapore.klingai.com";
const KBASE = `${KHOST}/v1/videos`;
const ASSET = "0123456789abcdef01234567";

test("studio-video: gating, money, async submit/poll on media_jobs, refunds, gallery", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  const catalogRoute = await import("../app/api/media/catalog/route.ts");
  const galleryRoute = await import("../app/api/media/gallery/route.ts");
  const sessionRoute = await import("../app/api/auth/session/route.ts");
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

  /* ── Kling stub ── */
  type Stub = { submits: { url: string; body: Record<string, unknown> }[]; polls: string[]; submitStatus: number; submitBody: unknown; pollBody: unknown; counter: number };
  const stub: Stub = { submits: [], polls: [], submitStatus: 200, submitBody: null, pollBody: { code: 0, data: { task_status: "processing" } }, counter: 0 };
  const resetStub = () => Object.assign(stub, { submits: [], polls: [], submitStatus: 200, submitBody: null, pollBody: { code: 0, data: { task_status: "processing" } }, counter: 0 });
  const succeed = (url = "https://cdn.klingai.example/v.mp4") => ({ code: 0, data: { task_status: "succeed", task_result: { videos: [{ url, duration: "5" }] } } });
  /** The `/tasks` row of a scripted effect-style poll answer: same state, the shape the Kling 3.0 query returns. */
  const asTaskRow = (body: unknown) => {
    const d = (body as { data: { task_status: string; task_status_msg?: string; task_result?: { videos: { url: string }[] } } }).data;
    const status = d.task_status === "succeed" ? "succeeded" : d.task_status;
    return { code: 0, data: [{ status, message: d.task_status_msg, outputs: d.task_result?.videos.map((v) => ({ type: "video", url: v.url })) }] };
  };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith(`${KHOST}/tasks`)) {
      stub.polls.push(url);
      return jsonRes(asTaskRow(stub.pollBody));
    }
    if (url.startsWith(`${KHOST}/text-to-video/`) || url.startsWith(`${KHOST}/image-to-video/`) || (url.startsWith(KBASE) && method === "POST")) {
      stub.submits.push({ url, body: JSON.parse(String(init?.body)) });
      return jsonRes(stub.submitBody ?? { code: 0, data: { task_id: `K${++stub.counter}` } }, stub.submitStatus);
    }
    if (url.startsWith(KBASE) && method === "GET") {
      stub.polls.push(url);
      return jsonRes(stub.pollBody);
    }
    if (url.startsWith("https://cdn.klingai.example/")) return new Response(Buffer.from(fakeMp4(5)), { status: 200, headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as unknown as typeof fetch;

  /* ── fixtures ── */
  let n = 0;
  const mkUser = async (wallet: { points?: number; balance?: number }) =>
    String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', $2, 0, $3) RETURNING id`, [`sv-${Date.now()}-${n++}`, wallet.points ?? 0, wallet.balance ?? 0]))[0]!.id);
  const wallet = async (userId: string) => {
    const r = (await query<{ points: string; balance: string }>(`SELECT points::text, balance::text FROM users WHERE id = $1`, [userId]))[0]!;
    return { points: Number(r.points), balance: Number(r.balance) };
  };
  const cookieOf = async (userId: string) => `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
  /** `expectedPrice` is a field of the request BODY (next to `slug` / `values`), as the client sends it. */
  const post = async (userId: string, values: Record<string, unknown>, expectedPrice?: number) => {
    // The route's burst limit (5 / min) is not under test here.
    await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
    const req = new Request("http://localhost/api/generations", { method: "POST", headers: { cookie: await cookieOf(userId), "content-type": "application/json" }, body: JSON.stringify({ slug: "studio-video", values, ...(expectedPrice === undefined ? {} : { expectedPrice }) }) });
    const r = await inRequest(req, () => route.POST(req));
    return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; price?: number } };
  };
  const catalog = async () => {
    const req = new Request("http://localhost/api/media/catalog?purpose=studio.video");
    const r = await inRequest(req, () => catalogRoute.GET(req));
    return (await r.json()) as { models: { id: string }[]; defaultModelId: string | null };
  };
  const features = async (userId: string) => {
    const req = new Request("http://localhost/api/auth/session", { headers: { cookie: await cookieOf(userId) } });
    const r = await inRequest(req, () => sessionRoute.GET(req));
    return ((await r.json()) as { features: { studioVideoModels?: string[] } }).features;
  };
  const setSetting = async (key: string, value: unknown) => {
    if (value === undefined) await query("DELETE FROM app_settings WHERE key = $1", [key]);
    else await query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
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
  /** Kling 3.0 and the effects are `defaultOff`: this suite runs them with the admin's switch on. */
  const switchOnDark = async () => {
    for (const id of ["kling/kling-3", "kling/kling-3-pro", "kling/effects"]) await setOverride(id, true);
  };
  const clearAll = async () => {
    await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
    await query(`UPDATE media_jobs SET status = 'failed' WHERE status IN ('pending','submitting')`);
    await setSetting("video.enabled", true);
    await setSwitch("kling", null);
    await switchOnDark();
    await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'").catch(() => undefined);
    resetStub();
  };
  const gen = async (id: string) =>
    (await query<{ status: string; locked_by: string | null; error: string | null; format: string; file_name: string; cost_json: { usd: number; model: string } | null; doc_json: { video?: Record<string, unknown> } | null; price: string }>(
      `SELECT status, locked_by, error, format, file_name, cost_json, doc_json, price::text FROM generations WHERE id = $1`,
      [id],
    ))[0]!;
  const row = async (id: string) => (await query<{ status: string; purpose: string; model_id: string; provider: string; upstream_model: string; op_id: string | null; cost_usd: string | null; params: Record<string, unknown> }>(`SELECT status, purpose, model_id, provider, upstream_model, op_id, cost_usd::text, params FROM media_jobs WHERE idempotency_key = $1`, [`${id}:video:0`]))[0];
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
  const K3 = { modelId: "kling/kling-3", prompt: "Tong chog‘ida Registon maydoni", seconds: 5, aspect: "16:9", sound: true };

  await t.test("gating: video.enabled OFF = nothing offered, 400; ON = Omni + Kling; Kling off / model off = hidden and refused", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    await setSetting("video.enabled", undefined); // the shipped default (dark)
    assert.deepEqual((await features(me)).studioVideoModels, []);
    assert.deepEqual((await catalog()).models, [], "MUTATSIYA: studioVideoModels video.enabled'ni e'tiborsiz qoldirsa qizaradi");
    const off = await post(me, K3);
    assert.equal(off.status, 400, JSON.stringify(off.body));
    assert.equal(off.body.code, "video_disabled");
    assert.deepEqual(await wallet(me), { points: 0, balance: 500_000 }, "nothing charged");

    await setSetting("video.enabled", true);
    assert.deepEqual((await catalog()).models.map((m) => m.id), ["google/omni-video", "kling/kling-4", "kling/kling-4-flash", "kling/kling-3", "kling/kling-3-pro", "kling/effects"]);
    assert.equal((await catalog()).defaultModelId, "google/omni-video");
    assert.deepEqual((await features(me)).studioVideoModels, ["google/omni-video", "kling/kling-4", "kling/kling-4-flash", "kling/kling-3", "kling/kling-3-pro", "kling/effects"]);

    await setSwitch("kling", false);
    assert.deepEqual((await catalog()).models.map((m) => m.id), ["google/omni-video"], "Kling switched off in «Provayderlar»");
    const noKling = await post(me, K3);
    assert.equal(noKling.status, 400);
    assert.equal(noKling.body.code, "model_unavailable");
    await setSwitch("kling", null);

    await setOverride("kling/effects", false);
    assert.ok(!(await catalog()).models.some((m) => m.id === "kling/effects"), "switched off in «Media modellari»");
    const fx = await post(me, { modelId: "kling/effects", effect: "happy_birthday", imageAssetId: ASSET });
    assert.equal(fx.status, 400);
    await switchOnDark();

    assert.equal((await post(me, { modelId: "openai/gpt-image", prompt: "Registon" })).status, 400, "not a video model");
    assert.equal((await post(me, { modelId: "kling/effects", effect: "happy_birthday" })).status, 400, "effect without its photo");
    const foreign = await mkUser({});
    await query(`INSERT INTO photo_uploads (user_id, asset_id, kind, mime, size_bytes, bytes) VALUES ($1,$2,'crop','image/jpeg',10,$3)`, [foreign, ASSET, Buffer.alloc(10, 1)]);
    const theirs = await post(me, { modelId: "kling/effects", effect: "happy_birthday", imageAssetId: ASSET });
    assert.equal(theirs.status, 400, "another user's photo");
    assert.match(String(theirs.body.error), /Surat topilmadi/);
    assert.deepEqual(await wallet(me), { points: 0, balance: 500_000 }, "no refused request charged anything");
    assert.equal(stub.submits.length, 0);
  });

  await t.test("money: cost × markup from the catalog block, paid balance only (bonus refused, 402)", async () => {
    await clearAll();
    // No `tool_pricing` row in this isolated database: the charged price IS the base formula (cost × markup).
    const price = studioVideoPrice(K3, await mediaPricing())!;
    assert.ok(price > 0);
    const bonusOnly = await mkUser({ points: 1_000_000, balance: 0 });
    const r = await post(bonusOnly, K3);
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.equal(r.body.code, "paid_balance_required", "MUTATSIYA: isPaidOnlyTool faqat video bo'lsa qizaradi");
    assert.deepEqual(await wallet(bonusOnly), { points: 1_000_000, balance: 0 });
    const payer = await mkUser({ points: 9_000, balance: price + 1_000 });
    const ok = await post(payer, K3);
    assert.equal(ok.status, 202);
    assert.equal(ok.body.price, price);
    assert.deepEqual(await wallet(payer), { points: 9_000, balance: 1_000 });
    // The confirmed price is right, the paid balance left (1 000) is not enough: 402, nothing charged.
    const again = await post(payer, K3, price);
    assert.equal(again.status, 402, JSON.stringify(again.body));
    assert.deepEqual(await wallet(payer), { points: 9_000, balance: 1_000 });
    // A stale shown price is refused before anything else is decided (409, nothing charged).
    const rich = await mkUser({ balance: 500_000 });
    const stale = await post(rich, K3, price - 100);
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.code, "price_changed");
    assert.deepEqual(await wallet(rich), { points: 0, balance: 500_000 });
  });

  await t.test("flow: Kling 3.0 — one submit, media_jobs row, lease released, poll running → succeed → MP4 + doc + cost", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    const id = await startWaiting(me, K3);
    assert.equal(stub.submits.length, 1);
    assert.deepEqual(stub.submits[0], { url: `${KHOST}/text-to-video/kling-3.0`, body: { prompt: K3.prompt, settings: { multi_shot: false, audio: "native", resolution: "720p", duration: 5, aspect_ratio: "16:9" } } });
    const g = await gen(id);
    assert.equal(g.status, "IN_PROGRESS");
    assert.equal(g.locked_by, null, "waiting holds no worker slot");
    const r = (await row(id))!;
    assert.deepEqual([r.status, r.purpose, r.model_id, r.provider, r.upstream_model, r.op_id], ["pending", "studio.video", "kling/kling-3", "kling", "kling-3.0", "task:K1"]);
    assert.equal(Number(r.cost_usd), 0.63);
    assert.equal(await ops.videoInFlight(), 1, "counted in the shared video cap");

    // A re-claim of the same job (lost lease) adopts the parked op: no second submit.
    await ops.submitStudioVideoJob({ id, userId: me, lease: "other", values: K3 as never });
    assert.equal(stub.submits.length, 1);

    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0);
    assert.equal(stub.polls.at(-1), `${KHOST}/tasks?task_ids=K1`);
    assert.equal((await gen(id)).status, "IN_PROGRESS");

    stub.pollBody = succeed();
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1, "MUTATSIYA: studio.video claim yoki studio poller olib tashlansa qizaradi");
    const done = await gen(id);
    assert.equal(done.status, "COMPLETED", String(done.error));
    assert.equal(done.format, "mp4");
    assert.equal(done.file_name, "video.mp4");
    assert.equal(done.doc_json!.video!.model, "kling/kling-3");
    assert.equal(done.doc_json!.video!.prompt, K3.prompt);
    assert.equal(done.doc_json!.video!.seconds, 5);
    assert.equal(done.cost_json!.model, "Kling 3.0");
    assert.equal(done.cost_json!.usd, 0.63);
    assert.equal((await row(id))!.status, "succeeded");
    const file = await getGenerationFile(id, me);
    assert.equal(file?.mime, "video/mp4");
    assert.equal(await refunds(id), 0);
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0, "a finished op is never polled again");
  });

  await t.test("flow: effect — /v1/videos/effects with the user's photo; the op polls the effects path", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    await query(`DELETE FROM photo_uploads WHERE asset_id = $1`, [ASSET]);
    await query(`INSERT INTO photo_uploads (user_id, asset_id, kind, mime, size_bytes, bytes) VALUES ($1,$2,'crop','image/png',4,$3)`, [me, ASSET, Buffer.from("png!")]);
    const id = await startWaiting(me, { modelId: "kling/effects", effect: "glamour_photo_shoot", imageAssetId: ASSET });
    assert.deepEqual(stub.submits[0], { url: `${KBASE}/effects`, body: { effect_scene: "glamour_photo_shoot", input: { image: Buffer.from("png!").toString("base64") } } });
    assert.equal((await row(id))!.op_id, "effects:K1");
    stub.pollBody = succeed();
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    assert.equal(stub.polls.at(-1), `${KBASE}/effects/K1`);
    const done = await gen(id);
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.doc_json!.video!.effect, "glamour_photo_shoot");
    assert.equal(done.cost_json!.usd, 0.84);
  });

  await t.test("refunds: provider failure, safety refusal, deadline → FAILED + refund once; submit 4xx refunds at once", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    const before = (await wallet(me)).balance;

    const a = await startWaiting(me, K3);
    stub.pollBody = { code: 0, data: { task_status: "failed", task_status_msg: "internal render error" } };
    await makeDue(a);
    assert.equal(await ops.pollDueVideoOps(), 1);
    assert.equal((await gen(a)).status, "FAILED");
    assert.equal(await refunds(a), 1, "MUTATSIYA: failVideo refund'siz bo'lsa qizaradi");
    assert.equal(await ops.failVideo(a, "x", "again"), false, "a second terminal step does nothing");
    assert.equal(await refunds(a), 1);

    resetStub();
    const b = await startWaiting(me, K3);
    stub.pollBody = { code: 0, data: { task_status: "failed", task_status_msg: "content policy violation" } };
    await makeDue(b);
    await ops.pollDueVideoOps();
    assert.equal((await gen(b)).error, VIDEO_SAFETY_MESSAGE);
    assert.equal(await refunds(b), 1);

    resetStub();
    const c = await startWaiting(me, K3);
    await query(`UPDATE media_jobs SET deadline_at = now() - interval '1 second' WHERE idempotency_key = $1`, [`${c}:video:0`]);
    await makeDue(c);
    await ops.pollDueVideoOps();
    assert.equal((await gen(c)).status, "FAILED");
    assert.equal(await refunds(c), 1);

    resetStub();
    stub.submitStatus = 400;
    stub.submitBody = { code: 1201, message: "invalid params" };
    const r = await post(me, K3);
    const job = await worker.claimNext();
    await worker.runJob(job!);
    assert.equal((await gen(r.body.id!)).status, "FAILED");
    assert.equal(await refunds(r.body.id!), 1);
    assert.equal((await row(r.body.id!))!.status, "failed");
    assert.equal((await wallet(me)).balance, before, "every failed clip came back");
  });

  await t.test("poll claim: one batch across «Video» and Studio rows, oldest-due first — neither purpose starves", async () => {
    await clearAll();
    const me = await mkUser({});
    const mk = async (purpose: string, model: string, dueSecAgo: number) => {
      const g = randomUUID();
      await query(`INSERT INTO generations (id, user_id, tool_id, topic, status) VALUES ($1, $2, $3, 'claim', 'REVOKED')`, [g, me, purpose === "studio.video" ? "studio-video" : "video"]);
      await query(
        `INSERT INTO media_jobs (id, generation_id, purpose, model_id, provider, upstream_model, idempotency_key, op_id, status, attempts, next_poll_at, params)
         VALUES ($1, $2, $3, $4, 'kling', 'x', $5, 'text2video:Z', 'pending', 1, now() - $6::int * interval '1 second', '{}'::jsonb)`,
        [randomUUID(), g, purpose, model, `${g}:video:0`, dueSecAgo],
      );
      return g;
    };
    const studio = await mk("studio.video", "kling/kling-3", 300); // the longest overdue
    const legacy = [await mk("video.clip", "kling/video", 200), await mk("video.clip", "kling/video", 100), await mk("video.clip", "kling/video", 50)];
    const claimed = (await ops.claimDueOps(3)).map((o) => o.generation_id);
    assert.equal(claimed.length, 3);
    assert.ok(claimed.includes(studio), "MUTATSIYA: avval faqat video.clip olinsa Studio qatori kutib qoladi va qizaradi");
    assert.deepEqual(new Set(claimed), new Set([studio, legacy[0], legacy[1]]), "the three oldest-due, whatever the purpose");
    // The lease: claimed rows are not due again; the one left out is claimed by the next run.
    assert.deepEqual((await ops.claimDueOps(3)).map((o) => o.generation_id), [legacy[2]]);
    await query(`UPDATE media_jobs SET status = 'failed' WHERE generation_id = ANY($1::uuid[])`, [[studio, ...legacy]]);
  });

  await t.test("gallery: my pictures and my clips together, newest first; a clip is `kind: video` with its own file", async () => {
    await clearAll();
    const me = await mkUser({ balance: 500_000 });
    const clip = await startWaiting(me, K3);
    stub.pollBody = succeed();
    await makeDue(clip);
    await ops.pollDueVideoOps();
    const pic = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, doc_json, created_at)
       VALUES ($1, $2, 'studio-image', 'T', 'COMPLETED', 900, 'png', $3::jsonb, now() - interval '5 minutes')`,
      [pic, me, JSON.stringify({ imageModel: "google/nano-banana", imagePrompt: "p", images: [{ id: "i", url: `/api/generations/${pic}/assets/abc123`, w: 1, h: 1 }] })],
    );
    const req = new Request("http://localhost/api/media/gallery", { headers: { cookie: await cookieOf(me) } });
    const res = await inRequest(req, () => galleryRoute.GET(req));
    const body = (await res.json()) as { items: { id: string; kind: string; modelId: string; modelLabel: string; prompt: string; images: unknown[]; video: { src: string; seconds: number; aspect: string; effectLabel: string | null } | null }[] };
    assert.deepEqual(body.items.map((i) => [i.id, i.kind]), [[clip, "video"], [pic, "image"]], "MUTATSIYA: galereya SQL faqat studio-image bo'lsa qizaradi");
    const v = body.items[0]!;
    assert.equal(v.modelId, "kling/kling-3");
    assert.equal(v.modelLabel, "Kling 3.0");
    assert.equal(v.prompt, K3.prompt);
    assert.deepEqual(v.images, []);
    // What was bought (length, aspect, sound) travels with the clip: «Qayta yaratish» re-opens the form at the same price.
    assert.deepEqual(v.video, { src: `/api/generations/${clip}/file?inline=1`, seconds: 5, requestedSeconds: 5, aspect: "16:9", sound: true, effect: null, effectLabel: null, derived: false });
    assert.equal(body.items[1]!.video, null);
  });
});
