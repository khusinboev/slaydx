import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * VIDEO -- the paid, ASYNC flow end to end on a real (isolated) Postgres, the provider stubbed at `fetch`:
 *   money   : bonus so'm never pays for video (D5): a bonus-only wallet is refused with a clear Uzbek message and a
 *             top-up link; the paid balance is charged exactly; other tools still use bonus;
 *   submit  : the job starts the provider operation, stores `video_ops`, RELEASES its lease and does NOT finish;
 *   poll    : success finishes ONCE (two concurrent finalisations -> one), failure / safety refusal / deadline refund
 *             ONCE, a restart mid-poll resumes, a crashed poller's claim expires;
 *   recovery: `recoverJobs` / `reclaimStaleJobs` leave a waiting video alone; the admin «stuck» view too;
 *   dark    : `video.enabled` defaults to FALSE: with a Gemini key present and default settings the tool is not offered
 *             (session) and a submit is a 400 -- nothing is charged;
 *   capacity: `video.max_concurrent` caps the videos in flight; a waiting video does not use the user's running cap.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `paidOnly` not passed to the charge (bonus allowed for video)        -> «money»;
 *   2. `lockPendingOp` without `FOR UPDATE` + the pending guard (finalize twice) -> «concurrent finalisation»;
 *   3. `failVideo` without the refund (deadline / provider failure)         -> «failure refunds once», «deadline refunds»;
 *   4. `reclaimStaleJobs` also takes rows with no lease (kills waiting videos) -> «recoverJobs leaves a waiting video alone».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "AIza-test-gemini-key-0123456789";
process.env.KLING_API_KEY = "AKtest:SKtest";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("videoflow") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const GURL = "https://generativelanguage.googleapis.com/v1beta";

test("video: money (paid only), async submit/poll, exactly-once, refunds, recovery, capacity", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  const worker = await import("../lib/server/worker.ts");
  const jobs = await import("../lib/server/jobs.ts");
  const ops = await import("../lib/server/video-ops.ts");
  const settings = await import("../lib/server/settings.ts");
  const { getGenerationFile } = await import("../lib/server/storage.ts");
  const { setSafeFetchLookup } = await import("../lib/generation/safe-fetch.ts");
  const { VIDEO_SAFETY_MESSAGE } = await import("../lib/generation/video/types.ts");
  const { resetProviderCache } = await import("../lib/server/providers/resolve.ts");
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
    await pool().end();
    await iso.drop();
  });

  /* ── provider stub: Gemini Omni (Interactions API) ── */
  type Stub = { submits: number; polls: number; submitStatus: number; submitBody: unknown; pollBody: unknown; fileBytes: Uint8Array; lastSubmit: Record<string, unknown> | null; counter: number; pollGate: Promise<void> | null; onSubmit: (() => Promise<void> | void) | null };
  const stub: Stub = { submits: 0, polls: 0, submitStatus: 200, submitBody: null, pollBody: { status: "in_progress" }, fileBytes: fakeMp4(5), lastSubmit: null, counter: 0, pollGate: null, onSubmit: null };
  const resetStub = () => {
    Object.assign(stub, { submits: 0, polls: 0, submitStatus: 200, submitBody: null, pollBody: { status: "in_progress" }, fileBytes: fakeMp4(5), lastSubmit: null, counter: 0, pollGate: null, onSubmit: null });
  };
  const doneBody = { status: "completed", steps: [{ type: "model_output", content: [{ type: "video", uri: `${GURL}/files/vid1` }] }] };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === `${GURL}/interactions` && method === "POST") {
      stub.submits++;
      stub.lastSubmit = JSON.parse(String(init?.body));
      await stub.onSubmit?.();
      return jsonRes(stub.submitBody ?? { id: `int_${++stub.counter}`, status: "in_progress" }, stub.submitStatus);
    }
    if (url.startsWith(`${GURL}/interactions/`) && method === "GET") {
      stub.polls++;
      if (stub.pollGate) await stub.pollGate; // a slow provider
      return jsonRes(stub.pollBody);
    }
    if (url.startsWith(`${GURL}/files/`)) return new Response(Buffer.from(stub.fileBytes), { status: 200, headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as unknown as typeof fetch;

  /* ── fixtures ── */
  let n = 0;
  const mkUser = async (wallet: { points?: number; balance?: number }) =>
    String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', $2, 0, $3) RETURNING id`, [`video-${Date.now()}-${n++}`, wallet.points ?? 0, wallet.balance ?? 0]))[0].id);
  const wallet = async (userId: string) => {
    const r = (await query<{ points: string; balance: string }>(`SELECT points::text, balance::text FROM users WHERE id = $1`, [userId]))[0];
    return { points: Number(r.points), balance: Number(r.balance) };
  };
  const post = async (userId: string, slug: string, values: Record<string, unknown>) => {
    const { token } = await createSession(userId);
    const req = new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ slug, values }),
    });
    const r = await inRequest(req, () => route.POST(req));
    return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; topUp?: string; required?: number; available?: number; bonus?: number } };
  };
  const clearAll = async () => {
    await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
    await query(`DELETE FROM video_ops`);
    await query(`DELETE FROM app_settings WHERE key LIKE 'video.%'`);
    // Video ships dark (default OFF); every test except the "dark" ones runs with the owner's switch ON.
    await query(`INSERT INTO app_settings (key, value) VALUES ('video.enabled', 'true'::jsonb)`);
    settings.invalidateSettingsCache();
  };
  const setSetting = async (key: string, value: unknown) => {
    await query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
    settings.invalidateSettingsCache();
  };
  const VIDEO = { provider: "veo", prompt: "Tong chog‘ida Registon maydoni", seconds: 5, aspect: "16:9" };
  const gen = async (id: string) =>
    (await query<{ status: string; locked_by: string | null; progress: number; step: string; error: string | null; format: string; file_name: string; delivered_json: unknown; cost_json: { usd: number; parts?: { kind: string; units: number; priced?: boolean }[] } | null; doc_json: { video?: Record<string, unknown> } | null; user_id: string }>(
      `SELECT status, locked_by, progress, step, error, format, file_name, delivered_json, cost_json, doc_json, user_id::text FROM generations WHERE id = $1`,
      [id],
    ))[0]!;
  const op = async (id: string) => (await query<{ status: string; op_id: string; attempts: number; seconds: number; provider: string; last_error: string | null; next_poll_at: Date }>(`SELECT status, op_id, attempts, seconds, provider, last_error, next_poll_at FROM video_ops WHERE generation_id = $1`, [id]))[0];
  const refunds = async (id: string) => (await query<{ n: string }>(`SELECT count(*)::text AS n FROM transactions WHERE kind = 'refund' AND reference = $1`, [id]))[0]!.n;
  const makeDue = (id: string) => query(`UPDATE video_ops SET next_poll_at = now() - interval '1 second' WHERE generation_id = $1`, [id]);
  /** POST a video, claim it on the worker and run its SUBMIT half: the job is then waiting for the provider. */
  const startWaiting = async (userId: string, values: Record<string, unknown> = VIDEO) => {
    const r = await post(userId, "video", values);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const job = await worker.claimNext();
    assert.equal(job?.id, r.body.id);
    await worker.runJob(job!);
    return r.body.id!;
  };

  /* ═════════════ money: bonus so'm cannot pay for video (D5) ═════════════ */

  await t.test("money: a bonus-only wallet is refused with a clear message and a top-up link; nothing is charged or queued", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ points: 1_000_000, balance: 0 });
    const r = await post(me, "video", VIDEO);
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.equal(r.body.code, "paid_balance_required");
    assert.equal(r.body.topUp, "/uz/wallet");
    assert.match(String(r.body.error), /to'langan balans/);
    assert.match(String(r.body.error), /Bonus so'mingiz/);
    assert.match(String(r.body.error), /\/uz\/wallet/);
    assert.equal(r.body.required, 15000);
    assert.equal(r.body.available, 0, "the paid part is what counted");
    assert.equal(r.body.bonus, 1_000_000);
    assert.deepEqual(await wallet(me), { points: 1_000_000, balance: 0 }, "MUTATSIYA: paidOnly uzatilmasa bonus yechiladi va qizaradi");
    assert.equal((await query(`SELECT 1 FROM generations WHERE user_id = $1`, [me])).length, 0);
    assert.equal(stub.submits, 0);
  });

  await t.test("money: a big bonus does not help when the paid balance is short; enough paid balance is charged exactly, bonus untouched", async () => {
    await clearAll();
    const short = await mkUser({ points: 500_000, balance: 14_999 });
    assert.equal((await post(short, "video", VIDEO)).status, 402);
    assert.deepEqual(await wallet(short), { points: 500_000, balance: 14_999 });

    const ok = await mkUser({ points: 500_000, balance: 20_000 });
    const r = await post(ok, "video", VIDEO);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.deepEqual(await wallet(ok), { points: 500_000, balance: 5_000 }, "15 000 came from the PAID balance only");
    const charge = (await query<{ points_delta: string; balance_delta: string }>(`SELECT points_delta::text, balance_delta::text FROM transactions WHERE kind = 'charge' AND reference = $1`, [r.body.id]))[0]!;
    assert.deepEqual([charge.points_delta, charge.balance_delta], ["0", "-15000"]);
  });

  await t.test("money: other tools are unchanged -- a bonus-only wallet still pays for a slide deck", async () => {
    await clearAll();
    const me = await mkUser({ points: 100_000, balance: 0 });
    const r = await post(me, "slide", { topic: "Fotosintez", slideCount: 10 });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.ok((await wallet(me)).points < 100_000, "bonus was spent on the slides");
  });

  await t.test("money: a refund of a video goes back to the paid balance (the charge never touched bonus)", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ points: 7_000, balance: 30_000 });
    const id = await startWaiting(me);
    assert.deepEqual(await wallet(me), { points: 7_000, balance: 15_000 });
    assert.equal(await ops.failVideo(id, "x", "test"), true);
    assert.deepEqual(await wallet(me), { points: 7_000, balance: 30_000 });
  });

  /* ═════════════ route guards ═════════════ */

  await t.test("route: unknown provider / provider without a key / foreign start image -> 400 and nothing is charged", async () => {
    await clearAll();
    const me = await mkUser({ balance: 100_000 });
    const other = await mkUser({ balance: 0 });
    await query(`INSERT INTO photo_uploads (user_id, asset_id, kind, mime, size_bytes, bytes) VALUES ($1,'0123456789abcdef01234567','crop','image/jpeg',10,$2)`, [other, Buffer.alloc(10, 1)]);
    assert.equal((await post(me, "video", { ...VIDEO, provider: "sora" })).status, 400);
    assert.equal((await post(me, "video", { ...VIDEO, prompt: "hi" })).status, 400);
    const foreign = await post(me, "video", { ...VIDEO, imageAssetId: "0123456789abcdef01234567" });
    assert.equal(foreign.status, 400);
    assert.match(String(foreign.body.error), /surat topilmadi/i);
    // Kling without a usable key is not offered.
    const prevKey = process.env.KLING_API_KEY;
    delete process.env.KLING_API_KEY;
    resetProviderCache();
    const noKey = await post(me, "video", { ...VIDEO, provider: "kling" });
    process.env.KLING_API_KEY = prevKey;
    resetProviderCache();
    assert.equal(noKey.status, 400, JSON.stringify(noKey.body));
    assert.match(String(noKey.body.error), /provayderi hozir mavjud emas/);
    assert.equal((await wallet(me)).balance, 100_000);
  });

  await t.test("DARK: with a Gemini key present and DEFAULT settings the tool is not offered and a submit is a 400; switching it on offers it", async () => {
    await clearAll();
    resetStub();
    await query(`DELETE FROM app_settings WHERE key = 'video.enabled'`); // the shipped default
    settings.invalidateSettingsCache();
    assert.ok(process.env.GEMINI_API_KEY, "precondition: a keyed provider, like prod");
    const me = await mkUser({ balance: 100_000 });
    const sessionRoute = await import("../app/api/auth/session/route.ts");
    const offered = async () => {
      const req = new Request("http://localhost/api/auth/session");
      const res = await inRequest(req, () => sessionRoute.GET(req));
      return ((await res.json()) as { features: { videoProviders?: string[] } }).features.videoProviders;
    };
    assert.deepEqual(await offered(), [], "MUTATSIYA: video.enabled standarti true bo'lsa qizaradi");
    const { toolBlockedReason, TOOL_BY_ID } = await import("../lib/tools.ts");
    assert.ok(toolBlockedReason(TOOL_BY_ID.video, { llm: true, images: true, videoProviders: await offered() }), "the tool is hidden");
    const r = await post(me, "video", VIDEO);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, "video_disabled");
    assert.equal((await wallet(me)).balance, 100_000, "nothing charged");
    assert.equal((await query(`SELECT 1 FROM generations WHERE user_id = $1`, [me])).length, 0);
    assert.equal(stub.submits, 0);

    await setSetting("video.enabled", true);
    assert.deepEqual(await offered(), ["veo", "kling"]);
    assert.equal((await post(me, "video", VIDEO)).status, 202);
    await setSetting("video.enabled", false);
    assert.deepEqual(await offered(), [], "switched off again");
    assert.equal((await post(me, "video", VIDEO)).status, 400);
  });

  /* ═════════════ submit ═════════════ */

  await t.test("submit: starts the provider operation, stores video_ops, releases the lease and does NOT finish the job", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me, { ...VIDEO, seconds: 8, aspect: "9:16" });
    assert.equal(stub.submits, 1);
    const sent = stub.lastSubmit as { background?: boolean; model?: string; response_format?: { aspect_ratio?: string }; input?: string };
    assert.equal(sent.background, true);
    assert.equal(sent.model, "gemini-omni-1.1-flash");
    assert.equal(sent.response_format?.aspect_ratio, "9:16");
    assert.match(String(sent.input), /about 8 seconds/);
    const g = await gen(id);
    assert.equal(g.status, "IN_PROGRESS", "still in progress: the provider is working");
    assert.equal(g.locked_by, null, "no lease: no worker slot held");
    assert.equal(g.progress, 10);
    assert.equal(g.step, "Video tayyorlanmoqda");
    const o = await op(id);
    assert.deepEqual([o?.status, o?.op_id, o?.provider, o?.seconds, o?.attempts], ["pending", "int_1", "veo", 8, 0]);
    assert.equal(await getGenerationFile(id, g.user_id), null, "no file yet");
    assert.equal(await refunds(id), "0");
  });

  await t.test("submit: a re-claimed job adopts the stored operation instead of starting a second paid one", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    assert.equal(stub.submits, 1);
    // The worker died after the handoff committed and the row was requeued: the claim must not call the provider again.
    await query(`UPDATE generations SET status = 'QUEUED', run_after = now() WHERE id = $1`, [id]);
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    await worker.runJob(job!);
    assert.equal(stub.submits, 1, "no second provider operation");
    assert.equal((await gen(id)).locked_by, null);
    assert.equal((await op(id))?.op_id, "int_1");
  });

  await t.test("submit: a provider safety refusal / an outage fails the job with a clear message and refunds it", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    stub.submitStatus = 400;
    stub.submitBody = { error: { message: "The prompt was blocked by our safety policy" } };
    const a = await post(me, "video", VIDEO);
    await worker.runJob((await worker.claimNext())!);
    const ga = await gen(a.body.id!);
    assert.equal(ga.status, "FAILED");
    assert.equal(ga.error, VIDEO_SAFETY_MESSAGE);
    assert.equal(await refunds(a.body.id!), "1");
    assert.deepEqual([(await op(a.body.id!))?.status, (await op(a.body.id!))?.op_id], ["failed", null], "the 'submitting' row is closed, never left behind");

    stub.submitStatus = 503;
    stub.submitBody = { error: { message: "backend down" } };
    const b = await post(me, "video", VIDEO);
    await worker.runJob((await worker.claimNext())!);
    const gb = await gen(b.body.id!);
    assert.equal(gb.status, "FAILED");
    assert.match(String(gb.error), /Pul qaytarildi/);
    assert.equal(await refunds(b.body.id!), "1");
    assert.equal((await wallet(me)).balance, 100_000, "everything came back");
  });

  /* ═════════════ poll: success, exactly once ═════════════ */

  await t.test("poll: while the provider works the job keeps waiting, backs off, and the bar creeps; success finishes it", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    // Not due yet (first poll is 10 s after the submit): the step does nothing.
    assert.equal(await ops.pollDueVideoOps(), 0);
    assert.equal(stub.polls, 0);

    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0, "still running: not terminal");
    assert.equal(stub.polls, 1);
    const waiting = await op(id);
    assert.equal(waiting?.attempts, 1);
    assert.ok(waiting!.next_poll_at.getTime() > Date.now() + 5_000, "backoff: the next poll is in the future");
    assert.equal((await gen(id)).status, "IN_PROGRESS");

    stub.pollBody = doneBody;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const g = await gen(id);
    assert.equal(g.status, "COMPLETED", String(g.error));
    assert.equal(g.progress, 100);
    assert.equal(g.format, "mp4");
    assert.equal(g.file_name, "video.mp4");
    assert.equal(g.locked_by, null);
    assert.equal(g.delivered_json, null, "5 s asked, 5 s delivered");
    assert.equal(g.doc_json?.video?.provider, "veo");
    assert.equal(g.doc_json?.video?.requestedSeconds, 5);
    assert.equal(g.doc_json?.video?.seconds, 5);
    assert.equal(g.doc_json?.video?.fromImage, false);
    const part = g.cost_json?.parts?.[0];
    assert.deepEqual([part?.kind, part?.units], ["video", 5]);
    assert.ok(Math.abs(g.cost_json!.usd - 0.5071) < 0.001, `5 s x $0.1014 = ${g.cost_json!.usd}`);
    const file = await getGenerationFile(id, g.user_id);
    assert.equal(file?.mime, "video/mp4");
    assert.equal(file?.fileName, "video.mp4");
    assert.deepEqual(new Uint8Array(file!.bytes), fakeMp4(5));
    assert.equal((await op(id))?.status, "succeeded");
    assert.equal(await refunds(id), "0");
    assert.equal((await wallet(me)).balance, 85_000, "charged once, nothing refunded");
    // Nothing is due any more.
    assert.equal(await ops.pollDueVideoOps(), 0);
  });

  await t.test("concurrent finalisation: two polls of the same op -> ONE finalisation (one file, one COMPLETED, no double effects)", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    stub.pollBody = doneBody;
    const bytes = fakeMp4(5);
    const results = await Promise.all([ops.finalizeVideo(id, bytes), ops.finalizeVideo(id, bytes), ops.finalizeVideo(id, bytes)]);
    assert.equal(results.filter(Boolean).length, 1, `exactly one winner, got ${JSON.stringify(results)}`);
    assert.equal((await gen(id)).status, "COMPLETED");
    assert.equal((await query(`SELECT 1 FROM generation_files WHERE generation_id = $1`, [id])).length, 1);

    // The same through the poll path: two pollers racing on one op.
    resetStub();
    const id2 = await startWaiting(me);
    stub.pollBody = doneBody;
    await makeDue(id2);
    const row = { generation_id: id2, provider: "veo" as const, op_id: "int_1", attempts: 0, errors: 0, seconds: 5 };
    const outcomes = await Promise.all([ops.pollOp(row), ops.pollOp(row)]);
    assert.deepEqual(outcomes.filter((o) => o === "succeeded").length, 1, `outcomes ${outcomes.join(",")}`);
    assert.equal((await gen(id2)).status, "COMPLETED");
  });

  await t.test("a clip shorter than the seconds paid for: COMPLETED and the difference is refunded once", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me, { ...VIDEO, seconds: 8 }); // 24 000
    assert.equal((await wallet(me)).balance, 76_000);
    stub.pollBody = doneBody;
    stub.fileBytes = fakeMp4(3);
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const g = await gen(id);
    assert.equal(g.status, "COMPLETED");
    assert.deepEqual(g.delivered_json, { got: 3, want: 8, unit: "soniya" });
    assert.equal((await wallet(me)).balance, 76_000 + 15_000, "(1 - 3/8) x 24 000 = 15 000 back");
    assert.equal(await refunds(id), "1");
    // A clip LONGER than paid for is never charged extra.
    resetStub();
    const id2 = await startWaiting(me, VIDEO);
    stub.pollBody = doneBody;
    stub.fileBytes = fakeMp4(8);
    await makeDue(id2);
    await ops.pollDueVideoOps();
    assert.equal((await gen(id2)).delivered_json, null);
  });

  /* ═════════════ failure and deadline refund ═════════════ */

  await t.test("failure refunds once: the provider fails the operation -> FAILED, full refund, a second poll changes nothing", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    stub.pollBody = { status: "failed", errors: [{ code: "internal", message: "Internal server error" }] };
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const g = await gen(id);
    assert.equal(g.status, "FAILED");
    assert.match(String(g.error), /Pul qaytarildi/);
    assert.equal(await refunds(id), "1", "MUTATSIYA: failVideo'dan qaytarish olib tashlansa qizaradi");
    assert.equal((await wallet(me)).balance, 100_000);
    assert.equal((await op(id))?.status, "failed");
    assert.equal(await ops.failVideo(id, "again", "again"), false, "a second failure is a no-op");
    assert.equal(await ops.pollDueVideoOps(), 0);
    assert.equal(await refunds(id), "1");
    assert.equal(await getGenerationFile(id, g.user_id), null);
  });

  await t.test("a safety refusal (blocked prompt / completed without a video) is passed through as a clear message and refunded", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const a = await startWaiting(me);
    stub.pollBody = { status: "failed", errors: [{ message: "Request blocked by safety filters" }] };
    await makeDue(a);
    await ops.pollDueVideoOps();
    assert.equal((await gen(a)).error, VIDEO_SAFETY_MESSAGE);
    assert.equal(await refunds(a), "1");

    resetStub();
    const b = await startWaiting(me);
    stub.pollBody = { status: "completed", steps: [{ content: [{ type: "text", text: "I can't help with that." }] }] };
    await makeDue(b);
    await ops.pollDueVideoOps();
    assert.equal((await gen(b)).status, "FAILED");
    assert.equal((await gen(b)).error, VIDEO_SAFETY_MESSAGE);
    assert.equal(await refunds(b), "1");
    assert.equal((await wallet(me)).balance, 100_000);
  });

  await t.test("deadline refunds: past the per-op deadline a still-running operation is failed and refunded once", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    await query(`UPDATE video_ops SET deadline_at = now() - interval '1 minute', next_poll_at = now() - interval '1 second' WHERE generation_id = $1`, [id]);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const g = await gen(id);
    assert.equal(g.status, "FAILED");
    assert.equal(g.error, ops.VIDEO_DEADLINE_MESSAGE);
    assert.equal(await refunds(id), "1", "MUTATSIYA: muddatda qaytarish yo'q bo'lsa qizaradi");
    assert.equal((await wallet(me)).balance, 100_000);
    assert.equal(await ops.pollDueVideoOps(), 0);

    // Transient errors past the deadline also end in a refund (the provider is unreachable, not just slow).
    resetStub();
    const id2 = await startWaiting(me);
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    await query(`UPDATE video_ops SET deadline_at = now() - interval '1 minute', next_poll_at = now() - interval '1 second' WHERE generation_id = $1`, [id2]);
    await ops.pollDueVideoOps();
    globalThis.fetch = prevFetch;
    assert.equal((await gen(id2)).status, "FAILED");
    assert.equal(await refunds(id2), "1");
  });

  await t.test("a deadline never discards a finished video: done beats the deadline", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    stub.pollBody = doneBody;
    await query(`UPDATE video_ops SET deadline_at = now() - interval '1 minute', next_poll_at = now() - interval '1 second' WHERE generation_id = $1`, [id]);
    await ops.pollDueVideoOps();
    assert.equal((await gen(id)).status, "COMPLETED");
    assert.equal(await refunds(id), "0");
  });

  await t.test("transient errors: a download that is not ready yet is retried on the next poll, then succeeds", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    stub.pollBody = doneBody;
    const badBytes = stub.fileBytes;
    stub.fileBytes = new TextEncoder().encode("<html>not active yet</html>");
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0);
    let o = await op(id);
    assert.deepEqual([o?.status, o?.attempts], ["pending", 1]);
    assert.ok(o?.last_error);
    assert.equal((await gen(id)).status, "IN_PROGRESS");
    stub.fileBytes = badBytes;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    o = await op(id);
    assert.equal(o?.status, "succeeded");
  });

  /* ═════════════ restart ═════════════ */

  await t.test("a restart mid-poll resumes: all state is in the database; a crashed poller's claim expires", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    await makeDue(id);
    // Poller A claims the op and "dies" before doing anything: its claim is a lease, the op is not due for 3 minutes.
    const claimed = await ops.claimDueOps();
    assert.equal(claimed.length, 1);
    assert.equal((await ops.claimDueOps()).length, 0, "a second process does not take an op that is being polled");
    assert.equal(await ops.pollDueVideoOps(), 0);
    assert.equal(stub.polls, 0);
    // The lease expires (time passes) and a FRESH process -- no in-memory state -- finishes the job.
    await makeDue(id);
    stub.pollBody = doneBody;
    const fresh = await import("../lib/generation/video/index.ts");
    assert.equal(await ops.pollDueVideoOps({ adapters: { ...fresh.VIDEO_ADAPTERS } }), 1);
    assert.equal((await gen(id)).status, "COMPLETED");
  });

  /* ═════════════ recovery: waiting videos are not stuck ═════════════ */

  await t.test("recoverJobs leaves a waiting video alone (even when it is old and its budget long gone)", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    await query(`UPDATE generations SET started_at = now() - interval '2 hours', created_at = now() - interval '2 hours', budget_ms = 1000, attempts = 5 WHERE id = $1`, [id]);
    assert.deepEqual(await jobs.reclaimStaleJobs(), [], "MUTATSIYA: lease'siz qatorlar ham o'ldirilsa qizaradi");
    await worker.recoverJobs();
    const g = await gen(id);
    assert.equal(g.status, "IN_PROGRESS");
    assert.equal(await refunds(id), "0");
    assert.equal((await op(id))?.status, "pending");
    // ...and it still finishes afterwards.
    stub.pollBody = doneBody;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    assert.equal((await gen(id)).status, "COMPLETED");
  });

  await t.test("recoverJobs still reclaims an ordinary stale job (the rule for everything else is unchanged)", async () => {
    await clearAll();
    const me = await mkUser({ balance: 100_000 });
    const r = await post(me, "slide", { topic: "Fotosintez", slideCount: 10 });
    const job = await worker.claimNext();
    assert.equal(job?.id, r.body.id);
    await query(`UPDATE generations SET locked_at = now() - interval '1 hour', attempts = 2 WHERE id = $1`, [r.body.id]);
    const dead = await jobs.reclaimStaleJobs();
    assert.deepEqual(dead, [r.body.id]);
  });

  await t.test("the admin «stuck» view does not flag a waiting video (but still flags an ordinary orphan)", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    await query(`UPDATE generations SET started_at = now() - interval '2 hours' WHERE id = $1`, [id]);
    // An ordinary IN_PROGRESS row with no lease IS an orphan (control).
    const orphan = (await post(me, "slide", { topic: "Fotosintez", slideCount: 10 })).body.id!;
    await query(`UPDATE generations SET status = 'IN_PROGRESS', locked_by = NULL, locked_at = NULL, started_at = now() - interval '2 hours' WHERE id = $1`, [orphan]);
    const { listAdminGenerations, parseGenerationsQuery } = await import("../lib/server/admin-generations.ts");
    const res = await listAdminGenerations(parseGenerationsQuery(new URL("http://localhost/api/admin/generations?stuck=1")));
    const ids = res.items.map((i) => i.id);
    assert.ok(ids.includes(orphan), "control: an ordinary lease-less IN_PROGRESS row is stuck");
    assert.ok(!ids.includes(id), "a video waiting for its provider is not stuck");
  });

  /* ═════════════ capacity ═════════════ */

  await t.test("video.max_concurrent caps the videos in flight; a finished one frees a place", async () => {
    await clearAll();
    resetStub();
    const a = await mkUser({ balance: 100_000 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await post(a, "video", VIDEO)).body.id!);
    // Default cap is 2.
    const j1 = await worker.claimNext();
    await worker.runJob(j1!);
    const j2 = await worker.claimNext();
    await worker.runJob(j2!);
    assert.equal(await worker.claimNext(), null, "two videos are in flight (waiting for the provider): the third waits in the queue");
    assert.equal((await gen(ids[2]!)).status, "QUEUED");

    // A finished video frees a place.
    stub.pollBody = doneBody;
    await makeDue(j1!.id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const j3 = await worker.claimNext();
    assert.equal(j3?.id, ids[2]);
    await worker.runJob(j3!);
    assert.equal(await worker.claimNext(), null);

    // The admin raises the cap to 3.
    await clearAll();
    resetStub();
    await setSetting("video.max_concurrent", 3);
    const b = await mkUser({ balance: 100_000 });
    for (let i = 0; i < 3; i++) await post(b, "video", VIDEO);
    for (let i = 0; i < 3; i++) {
      const j = await worker.claimNext();
      assert.ok(j, `claim ${i + 1} of 3`);
      await worker.runJob(j!);
    }
    assert.equal(stub.submits, 3);
  });

  await t.test("a waiting video does not use the user's running cap; ordinary jobs of the same user are still claimed", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    await startWaiting(me);
    const slide = await post(me, "slide", { topic: "Fotosintez", slideCount: 10 });
    const job = await jobs.claimJob(jobs.newLease("test"), { userMaxRunning: 1 });
    assert.equal(job?.id, slide.body.id, "the user's only running cap is 1, and the waiting video does not count against it");
  });

  await t.test("a waiting video that was failed by an admin is closed, not delivered", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    await query(`UPDATE generations SET status = 'FAILED', error = 'admin' WHERE id = $1`, [id]);
    stub.pollBody = doneBody;
    await makeDue(id);
    await ops.pollDueVideoOps();
    assert.equal((await gen(id)).status, "FAILED");
    assert.equal((await op(id))?.status, "failed");
    assert.equal((await getGenerationFile(id, me)), null);
  });

  /* ═════════════ review fixes ═════════════ */

  const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what}: still blocked after ${ms} ms`)), ms))]);
  const releaseGate = () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    return { gate, open };
  };

  await t.test("M1: housekeeping never polls videos and never waits for a slow provider", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    await makeDue(id);
    const { gate, open } = releaseGate();
    stub.pollGate = gate; // the provider hangs
    try {
      await withTimeout(worker.purgeHousekeeping(), 20_000, "purgeHousekeeping");
      assert.equal(stub.polls, 0, "MUTATSIYA: video-poll yana housekeeping qadami bo'lsa qizaradi");
    } finally {
      open();
    }
  });

  await t.test("M1: a slow poll runs in its own loop and does not delay claiming a normal job", async () => {
    await clearAll();
    resetStub();
    const { startVideoPollLoop } = await import("../lib/server/video-poll-loop.ts");
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    await makeDue(id);
    const { gate, open } = releaseGate();
    stub.pollGate = gate;
    const loop = startVideoPollLoop({ noLock: true, idleMs: 50 });
    try {
      const deadline = Date.now() + 10_000;
      while (stub.polls === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      assert.equal(stub.polls, 1, "the loop is inside the (hung) provider call");
      // The job queue is unaffected: a normal job is claimed, and housekeeping completes, while the poll hangs.
      const slide = await post(me, "slide", { topic: "Fotosintez", slideCount: 10 });
      const job = await withTimeout(worker.claimNext(), 5_000, "claimNext");
      assert.equal(job?.id, slide.body.id);
      await withTimeout(worker.housekeepingTick({ run: async () => {} }), 5_000, "housekeepingTick");
    } finally {
      open();
      await withTimeout(loop.stop(), 10_000, "loop.stop");
    }
  });

  await t.test("M1: the loop finishes a due video by itself and a run claims at most 3 ops", async () => {
    await clearAll();
    resetStub();
    await setSetting("video.max_concurrent", 5);
    const { startVideoPollLoop } = await import("../lib/server/video-poll-loop.ts");
    const me = await mkUser({ balance: 1_000_000 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await startWaiting(me));
    for (const id of ids) await makeDue(id);
    stub.pollBody = doneBody;
    // One run: at most the batch (3) is polled.
    assert.equal(await ops.pollDueVideoOps(), 3);
    assert.equal(stub.polls, 3);
    // A zero time budget starts no op at all: the claims just wait out their lease.
    for (const id of ids) await makeDue(id);
    const before = stub.polls;
    assert.equal(await ops.pollDueVideoOps({}, { budgetMs: 0 }), 0);
    assert.equal(stub.polls, before);
    // The loop drains the rest on its own.
    await query(`UPDATE video_ops SET next_poll_at = now() - interval '1 second' WHERE status = 'pending'`);
    const loop = startVideoPollLoop({ noLock: true, idleMs: 50 });
    try {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const left = await query(`SELECT 1 FROM video_ops WHERE status = 'pending'`);
        if (!left.length) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await loop.stop();
    }
    for (const id of ids) assert.equal((await gen(id)).status, "COMPLETED");
  });

  await t.test("m1: the op row exists as 'submitting' (no op id) BEFORE the provider is called", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    let seen: { status: string; op_id: string | null }[] = [];
    stub.onSubmit = async () => {
      seen = await query(`SELECT status, op_id FROM video_ops`);
    };
    const id = await startWaiting(me);
    assert.deepEqual(seen, [{ status: "submitting", op_id: null }], "MUTATSIYA: qator provayder chaqiruvidan KEYIN yozilsa qizaradi");
    assert.deepEqual([(await op(id))?.status, (await op(id))?.op_id], ["pending", "int_1"]);
  });

  await t.test("m1: a crash between the provider call and the update -> the re-claim fails and refunds, it does not pay twice", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const r = await post(me, "video", VIDEO);
    // The first run got as far as the 'submitting' row, called the provider and died: the job was requeued.
    await query(`INSERT INTO video_ops (generation_id, provider, deadline_at, seconds) VALUES ($1, 'veo', now() + interval '20 minutes', 5)`, [r.body.id]);
    const job = await worker.claimNext();
    assert.equal(job?.id, r.body.id);
    await worker.runJob(job!);
    assert.equal(stub.submits, 0, "no second paid operation");
    const g = await gen(r.body.id!);
    assert.equal(g.status, "FAILED");
    assert.match(String(g.error), /Pul qaytarildi/);
    assert.equal(await refunds(r.body.id!), "1");
    assert.equal((await wallet(me)).balance, 100_000);
    assert.equal((await op(r.body.id!))?.status, "failed");
  });

  await t.test("NIT: an existing op in a TERMINAL status fails the job instead of parking it", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const r = await post(me, "video", VIDEO);
    await query(`INSERT INTO video_ops (generation_id, provider, op_id, status, deadline_at, seconds, finished_at) VALUES ($1, 'veo', 'int_old', 'succeeded', now(), 5, now())`, [r.body.id]);
    await worker.runJob((await worker.claimNext())!);
    assert.equal((await gen(r.body.id!)).status, "FAILED");
    assert.equal(await refunds(r.body.id!), "1");
    assert.equal(stub.submits, 0);
  });

  await t.test("m5: the lease is lost DURING the provider call (stale reclaim) -> the op id is kept and the next claim adopts it", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const r = await post(me, "video", VIDEO);
    stub.onSubmit = async () => {
      await query(`UPDATE generations SET status = 'QUEUED', locked_by = NULL, locked_at = NULL WHERE id = $1`, [r.body.id]);
    };
    await worker.runJob((await worker.claimNext())!);
    assert.deepEqual([(await op(r.body.id!))?.status, (await op(r.body.id!))?.op_id], ["pending", "int_1"], "the paid operation's id is not lost");
    assert.equal((await gen(r.body.id!)).status, "QUEUED");
    stub.onSubmit = null;
    const again = await worker.claimNext();
    assert.equal(again?.id, r.body.id);
    await worker.runJob(again!);
    assert.equal(stub.submits, 1, "adopted, not submitted again");
    assert.equal((await gen(r.body.id!)).status, "IN_PROGRESS");
    assert.equal((await gen(r.body.id!)).locked_by, null);
    stub.pollBody = doneBody;
    await makeDue(r.body.id!);
    assert.equal(await ops.pollDueVideoOps(), 1);
    assert.equal((await gen(r.body.id!)).status, "COMPLETED");
  });

  await t.test("m5: SIGTERM (releaseJobs) during the submit -> the op id is kept, the job is QUEUED, the next claim adopts it", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const r = await post(me, "video", VIDEO);
    const job = await worker.claimNext();
    assert.equal(job?.id, r.body.id);
    stub.onSubmit = async () => {
      assert.deepEqual(await jobs.releaseJobs([job!.lease]), [r.body.id]);
    };
    await worker.runJob(job!);
    assert.equal((await op(r.body.id!))?.op_id, "int_1");
    assert.equal((await gen(r.body.id!)).status, "QUEUED");
    stub.onSubmit = null;
    await worker.runJob((await worker.claimNext())!);
    assert.equal(stub.submits, 1);
    assert.equal((await op(r.body.id!))?.status, "pending");
    assert.equal((await gen(r.body.id!)).locked_by, null);
    assert.equal(await refunds(r.body.id!), "0");
  });

  await t.test("m5: finalizeVideo racing failVideo -> exactly one wins and money / state agree (never COMPLETED + refunded)", async () => {
    await clearAll();
    resetStub();
    const outcomes = new Set<string>();
    for (let i = 0; i < 6; i++) {
      resetStub();
      const me = await mkUser({ balance: 1_000_000 }); // a fresh user per round: the per-user create rate limit
      const id = await startWaiting(me);
      const bytes = fakeMp4(5);
      const [fin, fail] = i % 2 ? await Promise.all([ops.finalizeVideo(id, bytes), ops.failVideo(id, "x", "race")]) : (await Promise.all([ops.failVideo(id, "x", "race"), ops.finalizeVideo(id, bytes)])).reverse();
      assert.equal([fin, fail].filter(Boolean).length, 1, `iteration ${i}: one winner, got fin=${fin} fail=${fail}`);
      const g = await gen(id);
      if (fin) {
        outcomes.add("completed");
        assert.equal(g.status, "COMPLETED");
        assert.equal(await refunds(id), "0");
        assert.ok(await getGenerationFile(id, me));
      } else {
        outcomes.add("failed");
        assert.equal(g.status, "FAILED");
        assert.equal(await refunds(id), "1");
        assert.equal(await getGenerationFile(id, me), null, "no file on a failed video");
      }
      assert.notEqual((await op(id))?.status, "pending");
    }
    assert.ok(outcomes.size >= 1);
  });

  await t.test("m2: the short-clip refund is part of the finalisation transaction (a failing refund rolls the finalisation back)", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me, { ...VIDEO, seconds: 8 });
    await query(`CREATE OR REPLACE FUNCTION video_test_block_refund() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refund blocked for the test'; END $$ LANGUAGE plpgsql`);
    await query(`CREATE TRIGGER video_test_block_refund BEFORE INSERT ON transactions FOR EACH ROW WHEN (NEW.kind = 'refund') EXECUTE FUNCTION video_test_block_refund()`);
    try {
      await assert.rejects(ops.finalizeVideo(id, fakeMp4(3)), /refund blocked/);
      const g = await gen(id);
      assert.equal(g.status, "IN_PROGRESS", "MUTATSIYA: qaytarish tranzaksiyadan tashqarida bo'lsa COMPLETED qoladi va qizaradi");
      assert.equal((await op(id))?.status, "pending");
      assert.equal(await getGenerationFile(id, me), null);
    } finally {
      await query(`DROP TRIGGER IF EXISTS video_test_block_refund ON transactions`);
      await query(`DROP FUNCTION IF EXISTS video_test_block_refund()`);
    }
    // Retried: COMPLETED and the refund appear together.
    assert.equal(await ops.finalizeVideo(id, fakeMp4(3)), true);
    assert.equal((await gen(id)).status, "COMPLETED");
    assert.equal(await refunds(id), "1");
    assert.equal((await wallet(me)).balance, 76_000 + 15_000);
  });

  await t.test("NIT: transient errors are counted apart from polls", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    for (let i = 0; i < 2; i++) {
      await makeDue(id);
      await ops.pollDueVideoOps(); // running
    }
    let o = (await query<{ attempts: number; errors: number }>(`SELECT attempts, errors FROM video_ops WHERE generation_id = $1`, [id]))[0]!;
    assert.deepEqual([o.attempts, o.errors], [2, 0], "running polls are not errors");
    stub.pollBody = doneBody;
    stub.fileBytes = new TextEncoder().encode("not an mp4");
    await makeDue(id);
    await ops.pollDueVideoOps();
    o = (await query<{ attempts: number; errors: number }>(`SELECT attempts, errors FROM video_ops WHERE generation_id = $1`, [id]))[0]!;
    assert.deepEqual([o.attempts, o.errors], [3, 1]);
    // MAX_TRANSIENT_ERRORS counts ERRORS: 29 errors on record -> the next one fails and refunds the job.
    await query(`UPDATE video_ops SET errors = ${ops.MAX_TRANSIENT_ERRORS - 1} WHERE generation_id = $1`, [id]);
    await makeDue(id);
    await ops.pollDueVideoOps();
    assert.equal((await gen(id)).status, "FAILED");
    assert.equal(await refunds(id), "1");
  });

  await t.test("NIT: video.max_concurrent is enforced under concurrent claims (advisory lock in claimJob)", async () => {
    await clearAll();
    resetStub();
    await setSetting("video.max_concurrent", 1);
    for (let round = 0; round < 8; round++) {
      const me = await mkUser({ balance: 1_000_000 });
      const other = await mkUser({ balance: 1_000_000 });
      await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
      await post(me, "video", VIDEO);
      await post(other, "video", VIDEO);
      const claimed = await Promise.all([jobs.claimJob(jobs.newLease("a"), { videoMax: 1 }), jobs.claimJob(jobs.newLease("b"), { videoMax: 1 })]);
      assert.equal(claimed.filter(Boolean).length, 1, `round ${round}: the cap of 1 holds under a race`);
    }
  });

  await t.test("NIT: enqueueGeneration derives paidOnly from the tool: a caller that forgets it still cannot spend bonus on video", async () => {
    await clearAll();
    const me = await mkUser({ points: 500_000, balance: 0 });
    const res = await jobs.enqueueGeneration({ userId: me, toolId: "video", topic: "t", price: 15000, format: "mp4", values: VIDEO, budgetMs: 90_000 });
    assert.equal(res.ok, false);
    assert.ok(!res.ok && res.reason === "insufficient" && res.paidOnly === true && res.bonus === 500_000);
    assert.deepEqual(await wallet(me), { points: 500_000, balance: 0 });
  });

  await t.test("m4: Range requests are served from a small bounded cache (3 files / 60 s) that re-checks ownership and version", async () => {
    await clearAll();
    resetStub();
    await setSetting("video.max_concurrent", 6);
    const cache = await import("../lib/server/video-file-cache.ts");
    cache.resetVideoCache();
    const fileRoute = await import("../app/api/generations/[id]/file/route.ts");
    const me = await mkUser({ balance: 1_000_000 });
    const { token } = await createSession(me);
    const finish = async () => {
      resetStub();
      const id = await startWaiting(me);
      stub.pollBody = doneBody;
      stub.fileBytes = fakeMp4(5, 4096);
      await makeDue(id);
      await ops.pollDueVideoOps();
      return id;
    };
    const get = async (id: string, headers: Record<string, string> = {}, tok = token) => {
      const req = new Request(`http://localhost/api/generations/${id}/file?inline=1`, { headers: { cookie: `${SESSION_COOKIE}=${tok}`, ...headers } });
      return inRequest(req, () => fileRoute.GET(req, { params: Promise.resolve({ id }) }));
    };
    const reads = async (id: string) => Number((await query<{ d: string }>(`SELECT downloads::text AS d FROM generation_files WHERE generation_id = $1`, [id]))[0]!.d);
    const id = await finish();
    assert.equal((await get(id)).status, 200); // first read: database, remembered
    await new Promise((r) => setTimeout(r, 100)); // the downloads counter is bumped fire-and-forget
    const base = await reads(id);
    for (let i = 0; i < 4; i++) assert.equal((await get(id, { range: `bytes=${i * 10}-${i * 10 + 9}` })).status, 206);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await reads(id), base, "MUTATSIYA: kesh bo'lmasa har 206 bazadan o'qiydi va qizaradi");
    assert.ok(cache.videoCacheStats().hits >= 4);

    // Another user never gets it from memory (and the route answers 404 as before).
    const other = await mkUser({ balance: 0 });
    const otherToken = (await createSession(other)).token;
    assert.equal((await get(id, { range: "bytes=0-9" }, otherToken)).status, 404);
    // A changed file version is a miss.
    await query(`UPDATE generations SET file_version = file_version + 1 WHERE id = $1`, [id]);
    const hitsBefore = cache.videoCacheStats().hits;
    assert.equal((await get(id, { range: "bytes=0-9" })).status, 206);
    assert.equal(cache.videoCacheStats().hits, hitsBefore, "a new version is read from the database");
    // A deleted file is not served from memory.
    await query(`DELETE FROM generation_files WHERE generation_id = $1`, [id]);
    assert.equal((await get(id, { range: "bytes=0-9" })).status, 404);

    // Bounded: at most 3 files stay.
    cache.resetVideoCache();
    const four: string[] = [];
    for (let i = 0; i < 4; i++) four.push(await finish());
    for (const f of four) assert.equal((await get(f)).status, 200);
    assert.equal(cache.videoCacheStats().entries, cache.VIDEO_CACHE_MAX_ENTRIES);
    // The oldest was evicted (miss), the newest is a hit.
    const h0 = cache.videoCacheStats().hits;
    await get(four[0]!, { range: "bytes=0-9" });
    assert.equal(cache.videoCacheStats().hits, h0, "the oldest entry was evicted");
    await get(four[3]!, { range: "bytes=0-9" });
    assert.equal(cache.videoCacheStats().hits, h0 + 1);
    // TTL: an entry older than 60 s is dropped.
    const gen3 = four[3]!;
    assert.equal(await cache.cachedVideo(gen3, me, Date.now() + cache.VIDEO_CACHE_TTL_MS + 1000), null);
  });

  /* ═════════════ the file route: Range (iOS Safari plays an MP4 only through 206) ═════════════ */

  await t.test("file route: the finished MP4 is served inline with Range support (206, 416, 200)", async () => {
    await clearAll();
    resetStub();
    const me = await mkUser({ balance: 100_000 });
    const id = await startWaiting(me);
    stub.pollBody = doneBody;
    stub.fileBytes = fakeMp4(5, 4096);
    await makeDue(id);
    await ops.pollDueVideoOps();
    const fileRoute = await import("../app/api/generations/[id]/file/route.ts");
    const { token } = await createSession(me);
    const get = async (headers: Record<string, string> = {}, qs = "?inline=1") => {
      const req = new Request(`http://localhost/api/generations/${id}/file${qs}`, { headers: { cookie: `${SESSION_COOKIE}=${token}`, ...headers } });
      return inRequest(req, () => fileRoute.GET(req, { params: Promise.resolve({ id }) }));
    };
    const full = await get();
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "video/mp4");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.match(String(full.headers.get("content-disposition")), /^inline/);
    assert.equal(new Uint8Array(await full.arrayBuffer()).byteLength, 4096);

    const part = await get({ range: "bytes=10-19" });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 10-19/4096");
    assert.equal(part.headers.get("content-length"), "10");
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), fakeMp4(5, 4096).slice(10, 20));

    const tail = await get({ range: "bytes=-16" });
    assert.equal(tail.status, 206);
    assert.equal(tail.headers.get("content-range"), "bytes 4080-4095/4096");

    const bad = await get({ range: "bytes=99999-" });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get("content-range"), "bytes */4096");

    const download = await get({}, "");
    assert.match(String(download.headers.get("content-disposition")), /^attachment/);
    // Another user cannot read the file (ownership is checked in SQL).
    const other = await mkUser({ balance: 0 });
    const otherToken = (await createSession(other)).token;
    const req = new Request(`http://localhost/api/generations/${id}/file?inline=1`, { headers: { cookie: `${SESSION_COOKIE}=${otherToken}` } });
    const denied = await inRequest(req, () => fileRoute.GET(req, { params: Promise.resolve({ id }) }));
    assert.equal(denied.status, 404);
  });
});
