import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * VIDEO ON THE MEDIA CORE (docs/studio/P0-SPEC.md §6.4) — `media.core.video` on a real isolated Postgres, the provider
 * stubbed at `fetch` exactly as in `tests/video-flow.test.mts`.
 *
 *   adapter : `VideoProviderError` → `MediaError` (retryable / safety kept, `accepted` false at submit, true after);
 *             `buildRequest` is the wrapped builder; the adapter ids are the catalog routes' (`google-video`, `kling-video`);
 *   parity  : every flow scenario (success, short clip, provider failure, safety refusals, submit refusal / outage,
 *             deadline, transient-error limit, download retry, re-claim adoption, crash in 'submitting', terminal row,
 *             SIGTERM during the submit, concurrent finalisation, admin-failed video, restart) runs with the switch OFF
 *             and ON and must give the SAME generation state, money, Uzbek message, provider request and backoff;
 *   tables  : ON — a `media_jobs` row (video.clip, catalog model, `<id>:video:0`, op id, deadline) and NO `video_ops`
 *             row; OFF — no `media_jobs` row at all;
 *   drain   : a `video_ops` row created before the switch was turned on finishes on the old path while new videos go to
 *             `media_jobs`; one poll batch covers both tables; capacity counts both; a job keeps its table when the
 *             switch flips (no resubmit).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. 'submitting' guard of the media row: (a) branch disabled -> «parity: crash in 'submitting'» (wrong message);
 *      (b) a 'submitting' row skipped AND the `!fresh` guard of beginMediaJob disabled -> the same test (a second paid
 *      submit: «no second paid operation»);
 *   2. `media_jobs` dropped from the poll (`claimDueOps` returns only `video_ops`) -> 17 tests, «parity: success» and
 *      both «drain» tests among them;
 *   3. capacity counts only `video_ops` waiters (jobs.ts claimJob's video count limited to leased rows + video_ops
 *      pending) -> «drain: … capacity counts both»;
 *   4. wrong refund message on the core deadline path (VIDEO_FAILED_MESSAGE instead of VIDEO_DEADLINE_MESSAGE when
 *      `op.mediaJobId`) -> «parity: deadline»;
 *   5. `attempts - 1` dropped in `dueFromMediaJob` -> «parity: success» (backoff differs: 20 s vs 15 s);
 *   6. media row's existence not checked when the switch is OFF (parked lookup skipped) -> «switch flip keeps the table»;
 *   7. adapter maps a submit error with `accepted: true` -> «adapter: error mapping».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "AIza-test-gemini-key-0123456789";
process.env.KLING_API_KEY = "AKtest:SKtest";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("mediavideo") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const GURL = "https://generativelanguage.googleapis.com/v1beta";

test("video adapter on the core: shapes and error mapping", async (t) => {
  const { videoAdapter, videoMediaAdapters, videoRoute, videoRequestInput } = await import("../lib/media/adapters/video.ts");
  const { MEDIA_CATALOG, VIDEO_PROVIDER_TO_MEDIA } = await import("../lib/media/catalog.ts");
  const { VideoProviderError, VIDEO_ADAPTERS, buildOmniRequest } = await import("../lib/generation/video/index.ts");
  const { MediaError } = await import("../lib/studio-core/index.ts");

  await t.test("adapter ids are the catalog routes'", () => {
    const ads = videoMediaAdapters(VIDEO_ADAPTERS);
    assert.deepEqual(Object.keys(ads).sort(), ["google-video", "kling-video"]);
    for (const [provider, model] of Object.entries(VIDEO_PROVIDER_TO_MEDIA)) {
      const entry = MEDIA_CATALOG.byId(model)!;
      assert.equal(entry.routes.length, 1, "P0: one route per video model");
      assert.equal(entry.routes[0]!.provider, provider);
      assert.ok(ads[entry.routes[0]!.adapter], `adapter ${entry.routes[0]!.adapter}`);
      assert.equal(videoRoute(provider as "veo" | "kling").route, entry.routes[0]);
    }
  });

  await t.test("buildRequest is the wrapped builder (byte for byte)", () => {
    const a = videoAdapter("google-video", VIDEO_ADAPTERS.veo);
    const input = { prompt: "Tong chog‘ida Registon", seconds: 8, aspect: "9:16" as const, image: { mime: "image/png", base64: "aGVsbG8=" } };
    const viaCore = a.buildRequest!({ upstreamModel: "omni-flash", idempotencyKey: "k", params: { prompt: input.prompt, seconds: 8, aspect: "9:16" }, assets: { imageAssetId: [input.image] } });
    assert.deepEqual(viaCore, buildOmniRequest(input));
    assert.deepEqual(videoRequestInput({ params: { prompt: "x", seconds: 5, aspect: "1:1" } }), { prompt: "x", seconds: 5, aspect: "16:9" }, "unknown aspect -> default");
  });

  await t.test("error mapping: submit -> accepted false; poll / download -> accepted true; retryable / safety / status kept", async () => {
    const fail = (e: unknown) => async () => { throw e; };
    const fake = {
      id: "veo" as const,
      configured: () => true,
      buildRequest: VIDEO_ADAPTERS.veo.buildRequest,
      submit: fail(new VideoProviderError("veo", "blocked by safety", { status: 400, safety: true })),
      poll: fail(new VideoProviderError("veo", "busy", { status: 503, retryable: true })),
      download: fail(new VideoProviderError("veo", "gone", { status: 410 })),
    };
    const a = videoAdapter("google-video", fake);
    const input = { upstreamModel: "omni-flash", idempotencyKey: "k", params: { prompt: "abcde", seconds: 5, aspect: "16:9" } };
    await assert.rejects(a.submit(input), (e: unknown) => e instanceof MediaError && e.safety && !e.retryable && !e.accepted && e.status === 400 && e.provider === "veo");
    await assert.rejects(a.poll!("op"), (e: unknown) => e instanceof MediaError && e.retryable && e.accepted && e.status === 503);
    await assert.rejects(a.fetchOutput({ kind: "url", url: "https://x/y" }), (e: unknown) => e instanceof MediaError && !e.retryable && e.accepted && e.status === 410);
    // A non-provider error (a bug) is not disguised as a provider failure.
    const bug = videoAdapter("google-video", { ...fake, submit: fail(new TypeError("boom")) });
    await assert.rejects(bug.submit(input), (e: unknown) => e instanceof TypeError);
    // Poll results: done -> one MP4 output.
    const ok = videoAdapter("google-video", { ...fake, poll: async () => ({ state: "done" as const, media: { kind: "url" as const, url: "https://x/v" } }) });
    assert.deepEqual(await ok.poll!("op"), { state: "done", outputs: [{ kind: "url", url: "https://x/v", mime: "video/mp4" }] });
  });
});

type Mode = "old" | "core";
const MODES: readonly Mode[] = ["old", "core"];

test("video on media_jobs: parity with the video_ops path, tables, drain, capacity", { skip }, async (t) => {
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
  const { VIDEO_SAFETY_MESSAGE, VIDEO_ADAPTERS } = await import("../lib/generation/video/index.ts");
  const { snapshotBreakers, resetBreakers } = await import("../lib/studio-core/index.ts");
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

  /* ── provider stub: Gemini Omni (Interactions API), the one of video-flow.test.mts ── */
  type Stub = { submits: number; polls: number; submitStatus: number; submitBody: unknown; pollBody: unknown; fileBytes: Uint8Array; lastSubmit: unknown; counter: number; onSubmit: (() => Promise<void> | void) | null; down: boolean };
  const fresh = (): Stub => ({ submits: 0, polls: 0, submitStatus: 200, submitBody: null, pollBody: { status: "in_progress" }, fileBytes: fakeMp4(5), lastSubmit: null, counter: 0, onSubmit: null, down: false });
  const stub: Stub = fresh();
  const resetStub = () => Object.assign(stub, fresh());
  const doneBody = { status: "completed", steps: [{ type: "model_output", content: [{ type: "video", uri: `${GURL}/files/vid1` }] }] };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (stub.down) throw new Error("network down");
    if (url === `${GURL}/interactions` && method === "POST") {
      stub.submits++;
      stub.lastSubmit = JSON.parse(String(init?.body));
      await stub.onSubmit?.();
      return jsonRes(stub.submitBody ?? { id: `int_${++stub.counter}`, status: "in_progress" }, stub.submitStatus);
    }
    if (url.startsWith(`${GURL}/interactions/`) && method === "GET") {
      stub.polls++;
      return jsonRes(stub.pollBody);
    }
    if (url.startsWith(`${GURL}/files/`)) return new Response(Buffer.from(stub.fileBytes), { status: 200, headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as unknown as typeof fetch;

  /* ── fixtures ── */
  let n = 0;
  const mkUser = async (balance: number) =>
    String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, $2) RETURNING id`, [`mvideo-${Date.now()}-${n++}`, balance]))[0].id);
  const balance = async (userId: string) => Number((await query<{ b: string }>(`SELECT balance::text AS b FROM users WHERE id = $1`, [userId]))[0]!.b);
  const post = async (userId: string, values: Record<string, unknown>) => {
    const { token } = await createSession(userId);
    const req = new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "video", values }),
    });
    const r = await inRequest(req, () => route.POST(req));
    const body = (await r.json()) as { id?: string; error?: string };
    assert.equal(r.status, 202, JSON.stringify(body));
    return body.id!;
  };
  const setSetting = async (key: string, value: unknown) => {
    await query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
    settings.invalidateSettingsCache();
  };
  const setMode = (mode: Mode) => setSetting("media.core.video", mode === "core");
  const clearAll = async (mode: Mode) => {
    await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
    await query(`DELETE FROM video_ops`);
    await query(`DELETE FROM media_jobs`);
    await query(`DELETE FROM app_settings WHERE key LIKE 'video.%' OR key LIKE 'media.%'`);
    await query(`INSERT INTO app_settings (key, value) VALUES ('video.enabled', 'true'::jsonb)`);
    settings.invalidateSettingsCache();
    await setMode(mode);
    resetStub();
    resetBreakers();
  };
  const VIDEO = { provider: "veo", prompt: "Tong chog‘ida Registon maydoni", seconds: 5, aspect: "16:9" };

  /** The generation as the user and the books see it: what must be identical on both paths. */
  const outcome = async (id: string, userId: string) => {
    const g = (await query<{ status: string; locked_by: string | null; progress: number; step: string; error: string | null; format: string | null; file_name: string | null; delivered_json: unknown; cost_json: { usd: number; provider: string; model: string; parts?: unknown[] } | null; doc_json: { video?: unknown } | null }>(
      `SELECT status, locked_by, progress, step, error, format, file_name, delivered_json, cost_json, doc_json FROM generations WHERE id = $1`,
      [id],
    ))[0]!;
    const tx = await query<{ kind: string; balance_delta: string; note: string | null }>(`SELECT kind, balance_delta::text, note FROM transactions WHERE reference = $1 ORDER BY created_at, kind`, [id]);
    const file = await getGenerationFile(id, userId);
    return {
      status: g.status,
      locked: g.locked_by !== null,
      progress: g.progress,
      step: g.step,
      error: g.error,
      format: g.format,
      fileName: g.file_name,
      delivered: g.delivered_json,
      cost: g.cost_json,
      video: g.doc_json?.video ?? null,
      money: tx.map((r) => [r.kind, r.balance_delta, r.note]),
      balance: await balance(userId),
      file: file ? { mime: file.mime, size: file.bytes.byteLength } : null,
    };
  };

  type Op = { status: string; opId: string | null; polls: number; errors: number; lastError: boolean; pollInSec: number | null };
  /** The op of a generation, from the table `mode` puts it in -- and the OTHER table must have no row for it. */
  const opOf = async (mode: Mode, id: string): Promise<Op | null> => {
    const v = await query<{ status: string; op_id: string | null; attempts: number; errors: number; last_error: string | null; due: number | null }>(
      `SELECT status, op_id, attempts, errors, last_error, EXTRACT(EPOCH FROM next_poll_at - now())::float AS due FROM video_ops WHERE generation_id = $1`,
      [id],
    );
    const m = await query<{ status: string; op_id: string | null; attempts: number; errors: number; last_error: string | null; due: number | null }>(
      `SELECT status, op_id, attempts, errors, last_error, EXTRACT(EPOCH FROM next_poll_at - now())::float AS due FROM media_jobs WHERE generation_id = $1`,
      [id],
    );
    if (mode === "old") assert.equal(m.length, 0, "switch OFF: no media_jobs row");
    else assert.equal(v.length, 0, "switch ON: no video_ops row");
    const r = (mode === "old" ? v : m)[0];
    if (!r) return null;
    const pending = r.status === "pending";
    return {
      status: r.status,
      opId: r.op_id,
      // media_jobs counts the submit as attempt 1 (beginMediaJob), video_ops counts polls only.
      polls: mode === "old" ? r.attempts : r.attempts - 1,
      // A terminal media_jobs row counts the final failure as an error too (failMediaJob); compare pending rows only.
      errors: pending ? r.errors : -1,
      lastError: r.last_error !== null,
      pollInSec: pending && r.due !== null ? Math.round(Number(r.due) / 5) * 5 : null,
    };
  };
  const makeDue = async (id: string) => {
    await query(`UPDATE video_ops SET next_poll_at = now() - interval '1 second' WHERE generation_id = $1`, [id]);
    await query(`UPDATE media_jobs SET next_poll_at = now() - interval '1 second' WHERE generation_id = $1`, [id]);
  };
  const expire = async (id: string) => {
    await query(`UPDATE video_ops SET deadline_at = now() - interval '1 minute', next_poll_at = now() - interval '1 second' WHERE generation_id = $1`, [id]);
    await query(`UPDATE media_jobs SET deadline_at = now() - interval '1 minute', next_poll_at = now() - interval '1 second' WHERE generation_id = $1`, [id]);
  };
  const startWaiting = async (userId: string, values: Record<string, unknown> = VIDEO) => {
    const id = await post(userId, values);
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    await worker.runJob(job!);
    return id;
  };

  /** Runs `scenario` once per switch state and asserts both give the same observable result. */
  const parity = async (name: string, scenario: (mode: Mode) => Promise<unknown>) => {
    await t.test(`parity: ${name}`, async () => {
      const got: Record<string, unknown> = {};
      for (const mode of MODES) {
        await clearAll(mode);
        got[mode] = await scenario(mode);
        if (mode === "old") assert.equal((await query(`SELECT 1 FROM media_jobs`)).length, 0, "switch OFF never writes media_jobs");
      }
      assert.deepEqual(got.core, got.old);
    });
  };

  /* ═════════════ parity scenarios ═════════════ */

  await parity("success (submit -> running poll with backoff -> done), same request, file, cost and money", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me, { ...VIDEO, seconds: 8, aspect: "9:16" });
    const request = stub.lastSubmit;
    const submitted = await opOf(mode, id);
    const waiting = await outcome(id, me);
    assert.equal(await ops.pollDueVideoOps(), 0, "not due yet");
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0);
    const backoff = await opOf(mode, id);
    stub.pollBody = doneBody;
    stub.fileBytes = fakeMp4(8);
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const done = await opOf(mode, id);
    assert.equal(await ops.pollDueVideoOps(), 0, "nothing due any more");
    return { request, submitted, waiting, backoff, done, final: await outcome(id, me), submits: stub.submits, polls: stub.polls };
  });

  await parity("a short clip: COMPLETED and the difference refunded once", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me, { ...VIDEO, seconds: 8 });
    stub.pollBody = doneBody;
    stub.fileBytes = fakeMp4(3);
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    return { g: await outcome(id, me), op: await opOf(mode, id) };
  });

  await parity("the provider fails the operation -> FAILED, full refund, a second failure is a no-op", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me);
    stub.pollBody = { status: "failed", errors: [{ code: "internal", message: "Internal server error" }] };
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const again = await ops.failVideo(id, "again", "again");
    return { g: await outcome(id, me), op: await opOf(mode, id), again };
  });

  await parity("safety refusals at poll (blocked / completed without a video) -> the safety message, refunded", async (mode) => {
    const me = await mkUser(100_000);
    const a = await startWaiting(me);
    stub.pollBody = { status: "failed", errors: [{ message: "Request blocked by safety filters" }] };
    await makeDue(a);
    await ops.pollDueVideoOps();
    resetStub();
    const b = await startWaiting(me);
    stub.pollBody = { status: "completed", steps: [{ content: [{ type: "text", text: "I can't help with that." }] }] };
    await makeDue(b);
    await ops.pollDueVideoOps();
    const ga = await outcome(a, me);
    assert.equal(ga.error, VIDEO_SAFETY_MESSAGE);
    return { a: ga, b: await outcome(b, me), opA: await opOf(mode, a), opB: await opOf(mode, b) };
  });

  await parity("submit refused (safety 400) / outage (503) -> FAILED with the same message, refunded, row closed", async (mode) => {
    const me = await mkUser(100_000);
    stub.submitStatus = 400;
    stub.submitBody = { error: { message: "The prompt was blocked by our safety policy" } };
    const a = await post(me, VIDEO);
    await worker.runJob((await worker.claimNext())!);
    stub.submitStatus = 503;
    stub.submitBody = { error: { message: "backend down" } };
    const b = await post(me, VIDEO);
    await worker.runJob((await worker.claimNext())!);
    const ga = await outcome(a, me);
    assert.equal(ga.error, VIDEO_SAFETY_MESSAGE);
    if (mode === "core") {
      const br = snapshotBreakers().find((s) => s.name === "media:veo:omni-flash");
      assert.ok(br && br.failures >= 1, "the core submit went through the router: the 503 counted on the route's breaker");
    }
    return { a: ga, b: await outcome(b, me), opA: await opOf(mode, a), opB: await opOf(mode, b), submits: stub.submits };
  });

  await parity("deadline: a still-running op past its deadline -> the deadline message, refunded once", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me);
    await expire(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    assert.equal(await ops.pollDueVideoOps(), 0);
    const g = await outcome(id, me);
    assert.equal(g.error, ops.VIDEO_DEADLINE_MESSAGE);
    // Transient errors past the deadline end the same way.
    resetStub();
    const id2 = await startWaiting(me);
    stub.down = true;
    await expire(id2);
    await ops.pollDueVideoOps();
    stub.down = false;
    return { g, op: await opOf(mode, id), g2: await outcome(id2, me), op2: await opOf(mode, id2) };
  });

  await parity("a deadline never discards a finished video", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me);
    stub.pollBody = doneBody;
    await expire(id);
    await ops.pollDueVideoOps();
    return { g: await outcome(id, me), op: await opOf(mode, id) };
  });

  await parity("transient errors: a download not ready is retried, counted apart from polls; the limit fails and refunds", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me);
    await makeDue(id);
    await ops.pollDueVideoOps(); // running
    stub.pollBody = doneBody;
    stub.fileBytes = new TextEncoder().encode("<html>not active yet</html>");
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 0);
    const retried = await opOf(mode, id);
    const midway = await outcome(id, me);
    // Then it succeeds.
    stub.fileBytes = fakeMp4(5);
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const ok = await outcome(id, me);
    // Another one hits the transient-error limit.
    resetStub();
    const id2 = await startWaiting(me);
    stub.pollBody = doneBody;
    stub.fileBytes = new TextEncoder().encode("not an mp4");
    await query(`UPDATE video_ops SET errors = ${ops.MAX_TRANSIENT_ERRORS - 1} WHERE generation_id = $1`, [id2]);
    await query(`UPDATE media_jobs SET errors = ${ops.MAX_TRANSIENT_ERRORS - 1} WHERE generation_id = $1`, [id2]);
    await makeDue(id2);
    await ops.pollDueVideoOps();
    return { retried, midway, ok, limit: await outcome(id2, me), op2: await opOf(mode, id2) };
  });

  await parity("a re-claimed job adopts the stored operation (idempotency key reuse resumes, never resubmits)", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me);
    await query(`UPDATE generations SET status = 'QUEUED', run_after = now() WHERE id = $1`, [id]);
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    await worker.runJob(job!);
    assert.equal(stub.submits, 1, "no second provider operation");
    stub.pollBody = doneBody;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    return { g: await outcome(id, me), op: await opOf(mode, id), submits: stub.submits };
  });

  await parity("a crash in 'submitting' (provider called, id never stored) -> the re-claim fails and refunds, no second submit", async (mode) => {
    const me = await mkUser(100_000);
    const id = await post(me, VIDEO);
    if (mode === "old") {
      await query(`INSERT INTO video_ops (generation_id, provider, deadline_at, seconds) VALUES ($1, 'veo', now() + interval '20 minutes', 5)`, [id]);
    } else {
      const mj = await import("../lib/server/media/jobs.ts");
      await mj.beginMediaJob({ generationId: id, purpose: "video.clip", modelId: "google/omni-video", provider: "veo", upstreamModel: "omni-flash", idempotencyKey: ops.videoMediaKey(id), params: { seconds: 5 } });
    }
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    await worker.runJob(job!);
    assert.equal(stub.submits, 0, "no second paid operation");
    const g = await outcome(id, me);
    assert.equal(g.error, ops.VIDEO_LOST_MESSAGE);
    return { g, op: await opOf(mode, id), submits: stub.submits };
  });

  await parity("an op in a TERMINAL status fails the job instead of parking it", async (mode) => {
    const me = await mkUser(100_000);
    const id = await post(me, VIDEO);
    if (mode === "old") {
      await query(`INSERT INTO video_ops (generation_id, provider, op_id, status, deadline_at, seconds, finished_at) VALUES ($1, 'veo', 'int_old', 'succeeded', now(), 5, now())`, [id]);
    } else {
      const mj = await import("../lib/server/media/jobs.ts");
      const { row } = await mj.beginMediaJob({ generationId: id, purpose: "video.clip", modelId: "google/omni-video", provider: "veo", upstreamModel: "omni-flash", idempotencyKey: ops.videoMediaKey(id), params: { seconds: 5 } });
      await mj.finishMediaJob(row.id, []);
      await query(`UPDATE media_jobs SET op_id = 'int_old' WHERE id = $1`, [row.id]);
    }
    await worker.runJob((await worker.claimNext())!);
    return { g: await outcome(id, me), submits: stub.submits };
  });

  await parity("SIGTERM during the submit -> the op id is kept, the job is QUEUED, the next claim adopts it", async (mode) => {
    const me = await mkUser(100_000);
    const id = await post(me, VIDEO);
    const job = await worker.claimNext();
    stub.onSubmit = async () => {
      assert.deepEqual(await jobs.releaseJobs([job!.lease]), [id]);
    };
    await worker.runJob(job!);
    const kept = await opOf(mode, id);
    const queued = (await outcome(id, me)).status;
    stub.onSubmit = null;
    await worker.runJob((await worker.claimNext())!);
    return { kept, queued, after: await opOf(mode, id), g: await outcome(id, me), submits: stub.submits };
  });

  await parity("concurrent finalisation: three finalizeVideo + two racing pollOp -> one winner each", async (mode) => {
    const me = await mkUser(1_000_000);
    const id = await startWaiting(me);
    const bytes = fakeMp4(5);
    const results = await Promise.all([ops.finalizeVideo(id, bytes), ops.finalizeVideo(id, bytes), ops.finalizeVideo(id, bytes)]);
    const files = (await query(`SELECT 1 FROM generation_files WHERE generation_id = $1`, [id])).length;
    resetStub();
    const id2 = await startWaiting(me);
    stub.pollBody = doneBody;
    await makeDue(id2);
    const claimed = await ops.claimDueOps();
    assert.equal(claimed.length, 1);
    assert.equal(Boolean(claimed[0]!.mediaJobId), mode === "core");
    const outcomes = await Promise.all([ops.pollOp(claimed[0]!), ops.pollOp(claimed[0]!)]);
    return { wins: results.filter(Boolean).length, files, g: await outcome(id, me), succeeded: outcomes.filter((o) => o === "succeeded").length, g2: await outcome(id2, me), op2: await opOf(mode, id2) };
  });

  await parity("finalizeVideo racing failVideo -> exactly one wins, money and state agree", async () => {
    const out: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      resetStub();
      const me = await mkUser(1_000_000);
      const id = await startWaiting(me);
      const [fin, fail] = await Promise.all([ops.finalizeVideo(id, fakeMp4(5)), ops.failVideo(id, "x", "race")]);
      assert.equal([fin, fail].filter(Boolean).length, 1);
      const g = await outcome(id, me);
      assert.equal(g.status, fin ? "COMPLETED" : "FAILED");
      assert.equal(g.money.length, fin ? 1 : 2, "never COMPLETED + refunded");
      out.push(g.status === "COMPLETED" ? g.file !== null : g.file === null);
    }
    return out;
  });

  await parity("a waiting video failed by an admin is closed, not delivered", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me);
    await query(`UPDATE generations SET status = 'FAILED', error = 'admin' WHERE id = $1`, [id]);
    stub.pollBody = doneBody;
    await makeDue(id);
    await ops.pollDueVideoOps();
    return { g: await outcome(id, me), op: await opOf(mode, id) };
  });

  await parity("restart: a crashed poller's claim is a lease; a fresh process (no memory) finishes the job", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me);
    await makeDue(id);
    const claimed = (await ops.claimDueOps()).length;
    const second = (await ops.claimDueOps()).length;
    assert.equal(await ops.pollDueVideoOps(), 0);
    const polledWhileLeased = stub.polls;
    await makeDue(id);
    stub.pollBody = doneBody;
    const freshAdapters = await import("../lib/generation/video/index.ts");
    assert.equal(await ops.pollDueVideoOps({ adapters: { ...freshAdapters.VIDEO_ADAPTERS } }), 1);
    return { claimed, second, polledWhileLeased, g: await outcome(id, me), op: await opOf(mode, id) };
  });

  await parity("recoverJobs / reclaimStaleJobs leave a waiting video alone", async (mode) => {
    const me = await mkUser(100_000);
    const id = await startWaiting(me);
    await query(`UPDATE generations SET started_at = now() - interval '2 hours', created_at = now() - interval '2 hours', budget_ms = 1000, attempts = 5 WHERE id = $1`, [id]);
    const reclaimed = await jobs.reclaimStaleJobs();
    await worker.recoverJobs();
    const g = await outcome(id, me);
    stub.pollBody = doneBody;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    return { reclaimed, g, after: await outcome(id, me), op: await opOf(mode, id) };
  });

  /* ═════════════ core-only: the media_jobs row ═════════════ */

  await t.test("ON: the submit writes a media_jobs row (video.clip, catalog model, key, op id, deadline) and no video_ops row", async () => {
    await clearAll("core");
    const me = await mkUser(100_000);
    let during: unknown[] = [];
    stub.onSubmit = async () => {
      during = await query(`SELECT status, op_id FROM media_jobs`);
    };
    const id = await startWaiting(me, { ...VIDEO, seconds: 8 });
    assert.deepEqual(during, [{ status: "submitting", op_id: null }], "the row exists as 'submitting' BEFORE the provider is called");
    const [row] = await query<{ purpose: string; model_id: string; provider: string; upstream_model: string; idempotency_key: string; op_id: string; status: string; params: Record<string, unknown>; cost_usd: string; to_deadline: number; to_poll: number }>(
      `SELECT purpose, model_id, provider, upstream_model, idempotency_key, op_id, status, params, cost_usd::text,
              EXTRACT(EPOCH FROM deadline_at - now())::float AS to_deadline, EXTRACT(EPOCH FROM next_poll_at - now())::float AS to_poll
         FROM media_jobs WHERE generation_id = $1`,
      [id],
    );
    assert.deepEqual([row!.purpose, row!.model_id, row!.provider, row!.upstream_model, row!.idempotency_key, row!.op_id, row!.status], ["video.clip", "google/omni-video", "veo", "omni-flash", `${id}:video:0`, "int_1", "pending"]);
    assert.deepEqual(row!.params, { prompt: VIDEO.prompt, seconds: 8, aspect: "16:9", imageAssetId: [] });
    assert.equal(Number(row!.cost_usd), 0.8, "8 s x $0.10 (the catalog quote)");
    assert.ok(Math.abs(row!.to_deadline - 20 * 60) < 30, `deadline ~20 min, got ${row!.to_deadline}`);
    assert.ok(row!.to_poll > 5 && row!.to_poll <= 11, `first poll ~10 s, got ${row!.to_poll}`);
    assert.equal((await query(`SELECT 1 FROM video_ops`)).length, 0);
    // Success stores the output metadata.
    stub.pollBody = doneBody;
    stub.fileBytes = fakeMp4(8);
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    const [done] = await query<{ status: string; outputs: { mime: string; size: number; sha256: string }[]; finished: boolean; next_poll_at: Date | null }>(`SELECT status, outputs, finished_at IS NOT NULL AS finished, next_poll_at FROM media_jobs WHERE generation_id = $1`, [id]);
    assert.equal(done!.status, "succeeded");
    assert.equal(done!.finished, true);
    assert.equal(done!.next_poll_at, null);
    assert.deepEqual(done!.outputs.map((o) => [o.mime, o.size, o.sha256.length]), [["video/mp4", fakeMp4(8).byteLength, 64]]);
  });

  await t.test("ON: Kling goes through its own catalog route (kling/video, kling-video adapter)", async () => {
    await clearAll("core");
    const me = await mkUser(100_000);
    const id = await post(me, { ...VIDEO, provider: "kling", seconds: 10 });
    const calls: string[] = [];
    const kling = {
      ...VIDEO_ADAPTERS.kling,
      configured: () => true,
      submit: async (input: { seconds: number }) => (calls.push(`submit:${input.seconds}`), { opId: "t2v:task1" }),
      poll: async (opId: string) => (calls.push(`poll:${opId}`), { state: "done" as const, media: { kind: "inline" as const, bytes: fakeMp4(10) } }),
      download: async (m: { kind: string; bytes?: Uint8Array }) => (calls.push(`download:${m.kind}`), m.bytes!),
    };
    const adapters = { veo: VIDEO_ADAPTERS.veo, kling };
    const job = await jobs.claimJob(jobs.newLease("t"));
    assert.equal(job?.id, id);
    await ops.submitVideoJob({ id, userId: me, lease: job!.lease, values: job!.values }, { adapters });
    const [row] = await query<{ model_id: string; provider: string; upstream_model: string }>(`SELECT model_id, provider, upstream_model FROM media_jobs WHERE generation_id = $1`, [id]);
    assert.deepEqual([row!.model_id, row!.provider, row!.upstream_model], ["kling/video", "kling", "kling-v2-master"]);
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps({ adapters }), 1);
    assert.deepEqual(calls, ["submit:10", "poll:t2v:task1", "download:inline"]);
    const g = await outcome(id, me);
    assert.equal(g.status, "COMPLETED");
    assert.equal((g.cost as { provider: string }).provider, "kling");
  });

  /* ═════════════ drain: both tables at once ═════════════ */

  await t.test("drain: a video_ops op started before the switch finishes on the old path, new ones go to media_jobs; capacity counts both", async () => {
    await clearAll("old");
    const me = await mkUser(1_000_000);
    const before = await startWaiting(me);
    assert.equal((await query(`SELECT 1 FROM video_ops WHERE generation_id = $1 AND status = 'pending'`, [before])).length, 1);
    await setMode("core");
    const after = await startWaiting(me);
    assert.equal((await query(`SELECT 1 FROM media_jobs WHERE generation_id = $1 AND status = 'pending'`, [after])).length, 1);
    assert.equal((await query(`SELECT 1 FROM video_ops WHERE generation_id = $1`, [after])).length, 0);
    assert.equal(await ops.videoInFlight(), 2);
    // Capacity (default video.max_concurrent = 2): one waiter in each table fills it.
    const third = await post(me, VIDEO);
    assert.equal(await worker.claimNext(), null, "one video_ops + one media_jobs waiter = 2 in flight: the third waits");
    // The old op is re-claimed after the switch flipped: it is adopted on its own table, never resubmitted.
    await query(`UPDATE generations SET status = 'QUEUED', run_after = now() WHERE id = $1`, [before]);
    await query(`UPDATE generations SET run_after = now() + interval '1 hour' WHERE id = $1`, [third]);
    await worker.runJob((await worker.claimNext())!);
    assert.equal(stub.submits, 2);
    assert.equal((await query(`SELECT 1 FROM media_jobs WHERE generation_id = $1`, [before])).length, 0, "the old op stays in video_ops");
    await query(`UPDATE generations SET run_after = now() WHERE id = $1`, [third]);
    // One poll run finishes both, each in its own table.
    stub.pollBody = doneBody;
    await makeDue(before);
    await makeDue(after);
    assert.equal(await ops.pollDueVideoOps(), 2);
    for (const id of [before, after]) assert.equal((await outcome(id, me)).status, "COMPLETED");
    assert.equal((await query<{ status: string }>(`SELECT status FROM video_ops WHERE generation_id = $1`, [before]))[0]!.status, "succeeded");
    assert.equal((await query<{ status: string }>(`SELECT status FROM media_jobs WHERE generation_id = $1`, [after]))[0]!.status, "succeeded");
    // A place is free again.
    const j = await worker.claimNext();
    assert.equal(j?.id, third);
  });

  await t.test("drain: one poll batch (3) is shared by both tables", async () => {
    await clearAll("old");
    await setSetting("video.max_concurrent", 6);
    const me = await mkUser(1_000_000);
    const ids = [await startWaiting(me), await startWaiting(me)];
    await setMode("core");
    ids.push(await startWaiting(me), await startWaiting(me));
    for (const id of ids) await makeDue(id);
    stub.pollBody = doneBody;
    assert.equal(await ops.pollDueVideoOps(), 3, "at most the batch per run");
    assert.equal(stub.polls, 3);
    for (const id of ids) await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1);
    for (const id of ids) assert.equal((await outcome(id, me)).status, "COMPLETED");
  });

  await t.test("switch flip keeps the table: a media_jobs op re-claimed with the switch OFF is adopted, not resubmitted on video_ops", async () => {
    await clearAll("core");
    const me = await mkUser(100_000);
    const id = await startWaiting(me);
    await setMode("old");
    await query(`UPDATE generations SET status = 'QUEUED', run_after = now() WHERE id = $1`, [id]);
    await worker.runJob((await worker.claimNext())!);
    assert.equal(stub.submits, 1, "no second paid operation");
    assert.equal((await query(`SELECT 1 FROM video_ops`)).length, 0, "no video_ops row");
    stub.pollBody = doneBody;
    await makeDue(id);
    assert.equal(await ops.pollDueVideoOps(), 1, "the OFF switch still polls media_jobs");
    assert.equal((await outcome(id, me)).status, "COMPLETED");
  });
});
