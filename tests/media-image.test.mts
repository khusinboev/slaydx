import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Image engines through the media core, switch `media.core.image` (docs/studio/P0-SPEC.md §6.3).
 *
 * What is proven here:
 *   adapter     every ImageFailure the real Gemini / OpenAI providers produce maps to the right MediaError flags
 *               (retryable / accepted / safety / status) and comes back through `coreImageProvider` as the SAME
 *               ImageResult the bare provider returns; outputs map to inline / url; `askOf` rebuilds the ask;
 *   recording   inside a job each drawn picture is one `media_jobs` row (steps unique, stable per prompt, upstream =
 *               admin slot model, no image bytes in params, failure text kept); breaker health is fed;
 *   switch      off / no context: the core is never called (no rows, no breaker), the provider is;
 *   parity      `buildImageArtifact`, `attachSlideImages` (pro), `buildPortraitArtifact` and the whole worker rasm flow
 *               give the same file / doc / provider requests / error / charge / refund with the switch on as off;
 *   limiter     the process limiter still wraps the core call from outside (a queue timeout never starts a row).
 *
 * Mutations (25, each turned the named test(s) red, then restored; adapter = lib/media/adapters/image.ts,
 * core = lib/media/image.ts):
 *   adapter flags   rate `retryable` false -> "adapter: failure mapping" (429 cases); timeout always `accepted` ->
 *                   same (budget < 2 s and limiter-queue cases); REFUSAL not `safety` -> same (OpenAI refusal);
 *                   NO_PICTURE not `accepted` -> same (200 without a picture); any 4xx `retryable` -> same (Gemini
 *                   400); `status` not set on the error -> same (every status case); `configured()` = hasKey() ->
 *                   same (no-key cases lose their reason through «no route available»).
 *   adapter I/O     inline mime fixed to image/png -> "adapter: success", "media_jobs rows"; `width` ignored in askOf ->
 *                   "askOf", pro-slide and portrait parity (their slots are not the 1024 preset).
 *   core provider   `ImageMediaError` not mapped back to reason/detail -> "failure mapping", "pass through verbatim",
 *                   portrait parity (readable messages); `originalImage` ignored -> "pass through verbatim" (image
 *                   identity); `deps: { deadline }` dropped -> "pass through verbatim" (the deadline assertion, run on
 *                   its own) and the budget / queue cases of "failure mapping"; input images (`assets`) dropped ->
 *                   "pass through verbatim" and portrait parity (selfie missing from the request); `seed` not passed ->
 *                   "pass through verbatim"; `hasKey` constant true -> "pass through verbatim"; `upstream` ignored ->
 *                   "media_jobs rows" (upstream_model = admin slot); `imageCount: 2` -> "media_jobs rows" (cost per
 *                   picture); recorded `values` dropped -> "media_jobs rows" and every «Rasm» parity row.
 *   step names      `nextMediaStep` counter not advanced -> "nextMediaStep", "media_jobs rows", «Rasm» parity and the
 *                   worker flow (duplicate keys, rows lost); tag constant -> "media_jobs rows" (key per prompt).
 *   wiring          rasm ALWAYS core -> every «Rasm» parity row (the no-context and switch-off runs grow rows /
 *                   breakers) and the worker flow; rasm NEVER core -> the same tests (ON rows missing); pickProvider
 *                   never core -> pro-slide parity rows and "limiter stays outside"; portrait never core -> portrait
 *                   parity rows; limiter moved inside the core provider -> "limiter stays outside" (the queue timeout
 *                   starts a row) and pro-slide parity.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "test-gemini-key";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_IMAGE_MODEL;
delete process.env.OPENAI_IMAGE_MODEL;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("mediaimage") : { isolated: false, drop: async () => {} };
const skipDb = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

// Everything that may read DATABASE_URL (env.ts) loads AFTER the isolated database is in place.
const { imageProviderAdapter, ImageMediaError, askOf, outputOf, originalImage } = await import("../lib/media/adapters/image.ts");
const { coreImageProvider } = await import("../lib/media/image.ts");
const { nextMediaStep, withMediaContext } = await import("../lib/media/context.ts");
const { MediaError, Semaphore, snapshotBreakers, resetBreakers, routeKey } = await import("../lib/studio-core/index.ts");
const { geminiProvider, geminiImageModel } = await import("../lib/generation/image-provider-gemini.ts");
const { openaiProvider, openaiImageModel } = await import("../lib/generation/image-provider-openai.ts");
const { limitedProvider, pickProvider } = await import("../lib/generation/image-provider.ts");
const { limiterFor } = await import("../lib/generation/llm/limiter.ts");
const { buildImageArtifact } = await import("../lib/generation/image-studio.ts");
const { buildPortraitArtifact } = await import("../lib/generation/portrait/engine.ts");
const { attachSlideImages } = await import("../lib/generation/slide-images.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
type ImageProvider = import("../lib/generation/image-provider.ts").ImageProvider;
type ImageResult = import("../lib/generation/image-provider.ts").ImageResult;
type ImageAsk = import("../lib/generation/image-provider.ts").ImageAsk;
type SlideModel = import("../lib/generation/slide-types.ts").SlideModel;

const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(n, 3)]);
const B64 = JPEG(3000).toString("base64");
const SELFIE_B64 = JPEG(400).toString("base64");
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as never;
const geminiOk = () => res(200, { steps: [{ type: "message", content: [{ data: B64, mime_type: "image/jpeg" }] }] });
const openaiOk = () => res(200, { data: [{ b64_json: B64 }], usage: { input_tokens: 30, input_tokens_details: { text_tokens: 30, image_tokens: 0 }, output_tokens: 1600 } });
const sceneOk = () => res(200, { candidates: [{ content: { parts: [{ text: '{"scene":"A wide view of Registon square at dawn, soft mist, long shadows."}' }] } }] });
const isText = (u: string) => u.includes(":generateContent");
const isGemini = (u: string) => u.includes("/interactions");
const isOpenai = (u: string) => u.includes("api.openai.com");

const REAL_FETCH = globalThis.fetch;
/** Replaces `fetch` for one test (restored to the real one afterwards); the handler gets the URL and the parsed JSON body. */
function stubFetch(t: TestContext, handler: (url: string, body: Record<string, unknown> | null) => unknown) {
  globalThis.fetch = (async (u: string, init?: RequestInit) => handler(String(u), init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null)) as unknown as typeof fetch;
  t.after(() => void (globalThis.fetch = REAL_FETCH));
}

function setEnv(t: TestContext, name: string, value: string | undefined) {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => void (saved === undefined ? delete process.env[name] : (process.env[name] = saved)));
}

const ASK: ImageAsk = { prompt: "A red apple on a table", size: { width: 1024, height: 576 }, styleId: "photo" };
const named = (name: string, e?: Error) => Object.assign(e ?? new Error(name), { name });

/** The adapter's verdict for one provider call: the thrown ImageMediaError (or the outputs). */
async function viaAdapter(provider: ImageProvider, ask: ImageAsk, deadline?: number) {
  const adapter = imageProviderAdapter("test-image", provider);
  try {
    const r = await adapter.submit({ upstreamModel: "m", params: { prompt: ask.prompt, width: ask.size.width, height: ask.size.height, styleId: ask.styleId }, idempotencyKey: "k" }, { deadline });
    return { done: "done" in r ? r.done : [] };
  } catch (e) {
    return { error: e as InstanceType<typeof ImageMediaError> };
  }
}

// ───────────────────────────────────────────── 1. adapter: failure mapping (REAL providers, stubbed HTTP)

type Case = {
  name: string;
  provider: "gemini" | "openai" | "queue";
  /** HTTP answer; a function that throws simulates a network failure. */
  http?: (url: string) => unknown;
  deadline?: () => number;
  noKey?: true;
  reason: "no-key" | "blocked" | "rate" | "timeout" | "failed";
  retryable: boolean;
  accepted: boolean;
  safety?: true;
  status?: number;
  /** the request never leaves the process */
  noRequest?: true;
};

const throwing = (e: Error) => () => {
  throw e;
};
const bodyThrows = (e: Error) => () => ({ ok: true, status: 200, json: async () => Promise.reject(e) }) as never;
const REFUSED = { error: { type: "image_generation_user_error", code: "moderation_blocked", message: "rejected" } };

const CASES: Case[] = [
  { name: "gemini: no key", provider: "gemini", noKey: true, noRequest: true, reason: "no-key", retryable: false, accepted: false },
  { name: "gemini: 401 key", provider: "gemini", http: () => res(401, { error: { message: "API key not valid" } }), reason: "blocked", retryable: false, accepted: false, status: 401 },
  { name: "gemini: 403 billing", provider: "gemini", http: () => res(403, { error: { message: "Billing not enabled" } }), reason: "blocked", retryable: false, accepted: false, status: 403 },
  { name: "gemini: 429 rate", provider: "gemini", http: () => res(429, { error: { message: "Quota exceeded" } }), reason: "rate", retryable: true, accepted: false, status: 429 },
  { name: "gemini: 500", provider: "gemini", http: () => res(500, { error: { message: "internal" } }), reason: "failed", retryable: true, accepted: false, status: 500 },
  { name: "gemini: 400 bad request", provider: "gemini", http: () => res(400, { error: { message: "bad" } }), reason: "failed", retryable: false, accepted: false, status: 400 },
  { name: "gemini: 200 without a picture", provider: "gemini", http: () => res(200, { steps: [{ content: [{ type: "text", text: "sorry" }] }] }), reason: "failed", retryable: false, accepted: true },
  { name: "gemini: body lost", provider: "gemini", http: bodyThrows(new Error("boom")), reason: "failed", retryable: true, accepted: true },
  { name: "gemini: body read aborted", provider: "gemini", http: bodyThrows(named("AbortError")), reason: "timeout", retryable: true, accepted: true },
  { name: "gemini: network error", provider: "gemini", http: throwing(new Error("ECONNRESET")), reason: "failed", retryable: true, accepted: false },
  { name: "gemini: fetch timed out", provider: "gemini", http: throwing(named("TimeoutError")), reason: "timeout", retryable: true, accepted: true },
  { name: "gemini: budget under 2 s (nothing sent)", provider: "gemini", deadline: () => Date.now() + 500, noRequest: true, reason: "timeout", retryable: true, accepted: false },
  { name: "limiter queue timeout (nothing sent)", provider: "queue", deadline: () => Date.now() + 1000, noRequest: true, reason: "timeout", retryable: true, accepted: false },
  { name: "openai: no key", provider: "openai", noKey: true, noRequest: true, reason: "no-key", retryable: false, accepted: false },
  { name: "openai: 403 organisation", provider: "openai", http: () => res(403, { error: { message: "org not verified" } }), reason: "blocked", retryable: false, accepted: false, status: 403 },
  { name: "openai: 429", provider: "openai", http: () => res(429, { error: { message: "slow down" } }), reason: "rate", retryable: true, accepted: false, status: 429 },
  { name: "openai: moderation refusal", provider: "openai", http: () => res(400, REFUSED), reason: "failed", retryable: false, accepted: false, safety: true },
  { name: "openai: 502", provider: "openai", http: () => res(502, { error: { message: "bad gateway" } }), reason: "failed", retryable: true, accepted: false, status: 502 },
];

test("adapter: failure mapping — flags per ImageFailure and a lossless round trip through the core provider", async (t) => {
  quiet(t);
  for (const c of CASES) {
    await t.test(c.name, async (sub) => {
      quiet(sub);
      let requests = 0;
      stubFetch(sub, (url) => {
        requests++;
        return c.http!(url);
      });
      if (c.noKey) setEnv(sub, c.provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY", undefined);
      else if (c.provider === "openai") setEnv(sub, "OPENAI_API_KEY", "sk-test-openai-key-123456");
      const held = new Semaphore(1);
      if (c.provider === "queue") await held.acquire();
      const base: ImageProvider = c.provider === "openai" ? openaiProvider : c.provider === "queue" ? limitedProvider(geminiProvider, held) : geminiProvider;
      const model = c.provider === "openai" ? "openai/gpt-image" : "google/nano-banana";
      const deadline = c.deadline?.();

      const direct = await base.fetchImage(ASK, deadline);
      assert.equal(direct.ok, false);
      const failure = direct as Extract<ImageResult, { ok: false }>;
      assert.equal(failure.reason, c.reason, "the provider's own verdict is what the case expects");
      const requestsBare = requests;

      const verdict = await viaAdapter(base, ASK, deadline);
      assert.ok(verdict.error instanceof ImageMediaError, "a failure becomes an ImageMediaError");
      const e = verdict.error!;
      assert.equal(e.reason, failure.reason);
      assert.equal(e.detail, failure.detail, "the original detail text is kept");
      assert.equal(e.message, failure.detail);
      assert.equal(e.retryable, c.retryable, "retryable");
      assert.equal(e.accepted, c.accepted, "accepted");
      assert.equal(e.safety, c.safety === true, "safety");
      assert.equal(e.status, c.status, "status");

      const viaCore = await coreImageProvider("rasm.image", model, base, { upstream: () => "m" }).fetchImage(ASK, deadline);
      assert.deepEqual(viaCore, failure, "the engines get the very ImageFail the bare provider returned");
      if (c.noRequest) assert.equal(requests, 0, "no HTTP request was made");
      else assert.equal(requests, requestsBare * 3, "one HTTP request per call, nothing extra");
    });
  }
});

test("adapter: success — the core returns the provider's own image; outputs are inline bytes", async (t) => {
  quiet(t);
  stubFetch(t, (u) => (isOpenai(u) ? openaiOk() : geminiOk()));
  setEnv(t, "OPENAI_API_KEY", "sk-test-openai-key-123456");
  for (const [base, model] of [[geminiProvider, "google/nano-banana"], [openaiProvider, "openai/gpt-image"]] as const) {
    const direct = await base.fetchImage(ASK);
    assert.ok(direct.ok);
    const adapted = await viaAdapter(base, ASK);
    assert.equal(adapted.done?.length, 1);
    const out = adapted.done![0];
    assert.equal(out.kind, "inline");
    if (out.kind === "inline") {
      assert.equal(out.mime, "image/jpeg");
      assert.deepEqual(Buffer.from(out.bytes), JPEG(3000), "the bytes are the decoded picture");
    }
    const viaCore = await coreImageProvider("rasm.image", model, base, { upstream: () => "m" }).fetchImage(ASK);
    assert.deepEqual(viaCore, direct, "same url and alt");
  }
});

// ───────────────────────────────────────────── 2. outputs, ask, fetchOutput

test("outputOf: data URL -> inline (mime lowercased), https and non-base64 data -> url; each remembers its image", () => {
  const inline = outputOf({ url: `data:IMAGE/PNG;base64,${B64}`, alt: "a" });
  assert.equal(inline.kind, "inline");
  assert.equal(inline.kind === "inline" && inline.mime, "image/png");
  assert.equal(inline.kind === "inline" && Buffer.from(inline.bytes).toString("base64"), B64);
  const remote = { url: "https://cdn.example.com/x.png", alt: "b" };
  const url = outputOf(remote);
  assert.deepEqual(url, { kind: "url", url: remote.url });
  assert.equal(originalImage(url), remote, "identity: the engines get the same object back");
  assert.deepEqual(outputOf({ url: "data:image/svg+xml,<svg/>" }), { kind: "url", url: "data:image/svg+xml,<svg/>" });
  assert.deepEqual(outputOf({ url: "data:;base64,AAAA" }), { kind: "url", url: "data:;base64,AAAA" }, "no mime -> not treated as inline");
  assert.equal(originalImage({ kind: "url", url: "x" }), undefined);
});

test("askOf: composed prompt, size, style, seed, premium and reference images; schema-only params fall back to the presets", () => {
  const input = {
    upstreamModel: "m",
    idempotencyKey: "k",
    params: { prompt: "P", width: 896, height: 1120, styleId: "chalk", seed: 7, premium: true },
    assets: { inputImages: [{ mime: "image/png", base64: "QUJD" }] },
  };
  assert.deepEqual(askOf(input), {
    prompt: "P",
    size: { width: 896, height: 1120 },
    styleId: "chalk",
    inputImages: [{ mime: "image/png", base64: "QUJD" }],
    seed: 7,
    premium: true,
  });
  // No extras: exactly the three base keys, so a bare provider sees the same ask the old engines built.
  assert.deepEqual(askOf({ upstreamModel: "m", idempotencyKey: "k", params: { prompt: "P", width: 1024, height: 576, styleId: "photo" } }), { prompt: "P", size: { width: 1024, height: 576 }, styleId: "photo" });
  // Schema values only (a generic caller): size from `imageRatio`, style from `imageStyle`.
  assert.deepEqual(askOf({ upstreamModel: "m", idempotencyKey: "k", params: { prompt: "P", imageRatio: "9:16", imageStyle: "pencil" } }), { prompt: "P", size: { width: 576, height: 1024 }, styleId: "pencil" });
  assert.deepEqual(askOf({ upstreamModel: "m", idempotencyKey: "k", params: { prompt: "P" } }).size, { width: 1024, height: 1024 });
});

test("adapter.fetchOutput: inline bytes as they are, a URL through fetchImageBytes (data: decoded, junk refused)", async () => {
  const adapter = imageProviderAdapter("test-image", geminiProvider);
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(await adapter.fetchOutput({ kind: "inline", bytes, mime: "image/png" }), bytes);
  const jpeg = JPEG(1500);
  const got = await adapter.fetchOutput({ kind: "url", url: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
  assert.deepEqual(Buffer.from(got), jpeg);
  await assert.rejects(adapter.fetchOutput({ kind: "url", url: "data:text/plain;base64,aGVsbG8=" }), (e: unknown) => e instanceof MediaError);
  await assert.rejects(adapter.fetchOutput({ kind: "url", url: "http://insecure.example.com/x.png" }), (e: unknown) => e instanceof MediaError, "https only (SSRF rule of fetchImageBytes)");
});

// ───────────────────────────────────────────── 3. core provider without a job

/** A provider that records what it was asked and answers from a queue. */
function fakeProvider(results: ImageResult[], id: ImageProvider["id"] = "gemini") {
  const calls: { ask: ImageAsk; deadline: number | undefined }[] = [];
  const provider: ImageProvider = {
    id,
    minMs: 12_345,
    hasKey: () => id === "gemini",
    async fetchImage(ask, deadline) {
      calls.push({ ask, deadline });
      return results[Math.min(calls.length - 1, results.length - 1)]!;
    },
  };
  return { provider, calls };
}

test("core provider: results pass through verbatim (same objects), the ask and the deadline reach the provider", async () => {
  const ok: ImageResult = { ok: true, image: { url: `data:image/jpeg;base64,${B64}`, alt: "Alt of the provider" } };
  const remote: ImageResult = { ok: true, image: { url: "https://cdn.example.com/p.jpg", alt: "remote" } };
  const fails: ImageResult[] = (["no-key", "blocked", "rate", "timeout", "failed"] as const).map((reason) => ({ ok: false, reason, detail: `${reason}: detail text` }));
  const ask: ImageAsk = { ...ASK, seed: 11, premium: true, inputImages: [{ mime: "image/jpeg", base64: SELFIE_B64 }] };
  for (const want of [ok, remote, ...fails]) {
    const { provider, calls } = fakeProvider([want]);
    const core = coreImageProvider("portrait.edit", "google/nano-banana", provider, { upstream: () => "m" });
    const got = await core.fetchImage(ask, 987_654_321);
    if (want.ok) {
      assert.ok(got.ok);
      assert.equal(got.ok && got.image, want.image, "the provider's own image object: url and alt untouched");
    } else {
      assert.deepEqual(got, want);
    }
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].ask, ask, "the ask is rebuilt field for field (prompt, size, style, seed, premium, input images)");
    assert.equal(calls[0].deadline, 987_654_321, "the job deadline reaches the provider");
  }
  const { provider } = fakeProvider([ok]);
  const core = coreImageProvider("rasm.image", "google/nano-banana", provider, { upstream: () => "m" });
  assert.deepEqual([core.id, core.minMs, core.hasKey()], ["gemini", 12_345, true], "the wrapper looks like the provider");
  assert.equal(coreImageProvider("rasm.image", "google/nano-banana", fakeProvider([ok], "pexels").provider, { upstream: () => "m" }).hasKey(), false);
});

test("core provider: an unknown model is a plain failure; a bug in the provider is not swallowed", async () => {
  const { provider } = fakeProvider([{ ok: true, image: { url: `data:image/jpeg;base64,${B64}` } }]);
  const bad = await coreImageProvider("rasm.image", "nope/x", provider, { upstream: () => "m" }).fetchImage(ASK);
  assert.deepEqual(bad.ok, false);
  assert.match(!bad.ok ? bad.detail : "", /unknown model/);
  const boom: ImageProvider = { ...provider, fetchImage: async () => Promise.reject(new TypeError("programming error")) };
  await assert.rejects(coreImageProvider("rasm.image", "google/nano-banana", boom, { upstream: () => "m" }).fetchImage(ASK), TypeError);
});

// ───────────────────────────────────────────── 4. step names

test("nextMediaStep: counts per prefix+tag inside a job, stable under any call order, restarts with a new job context", () => {
  const mk = () => ({ generationId: "g", core: { image: true, video: false, speech: false } });
  const order1 = withMediaContext(mk(), () => ["a", "b", "a", "a"].map((tag) => nextMediaStep("image", tag)));
  assert.deepEqual(order1, ["image:a:0", "image:b:0", "image:a:1", "image:a:2"]);
  // Another order (retry with different lane timing): every tag gets the same set of keys.
  const order2 = withMediaContext(mk(), () => ["b", "a", "a", "a"].map((tag) => nextMediaStep("image", tag)));
  assert.deepEqual([...order2].sort(), [...order1].sort());
  // Prefix and tag are both part of the name; no tag = bare counter.
  const ctx = mk();
  withMediaContext(ctx, () => {
    assert.equal(nextMediaStep("image"), "image:0");
    assert.equal(nextMediaStep("image"), "image:1");
    assert.equal(nextMediaStep("speech"), "speech:0");
  });
  // The same context object keeps counting (calls of one job on different async paths share it).
  assert.equal(withMediaContext(ctx, () => nextMediaStep("image")), "image:2");
  // Outside a job: nothing is recorded, the name is fixed.
  assert.equal(nextMediaStep("image", "a"), "image:a:0");
  assert.equal(nextMediaStep("image", "a"), "image:a:0");
});

// ───────────────────────────────────────────── 5. recording (DB)

let dbReady: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  dbReady ??= mod.migrate();
  await dbReady;
  return mod;
}
after(async () => {
  if (!dbReady) return;
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

let seq = 0;
async function newGeneration(): Promise<{ gen: string; userId: string }> {
  const { query } = await db();
  const [user] = await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'T', 0, 0, 0) RETURNING id", [`media-image-${process.pid}-${seq++}`]);
  const gen = randomUUID();
  await query("INSERT INTO generations (id, user_id, tool_id, status) VALUES ($1, $2, 'image', 'IN_PROGRESS')", [gen, user.id]);
  return { gen, userId: String(user.id) };
}
const ctxOf = (gen: string, image: boolean) => ({ generationId: gen, core: { image, video: false, speech: false } });
const mediaBreakers = () => snapshotBreakers().filter((b) => b.name.startsWith("media:"));
const tagOfPrompt = (p: string) => createHash("sha1").update(p).digest("hex").slice(0, 12);

test("media_jobs rows: one per drawn picture, unique stable keys, upstream = admin slot, params without image bytes", { skip: skipDb }, async (t) => {
  quiet(t);
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  const { gen } = await newGeneration();
  resetBreakers();
  setEnv(t, "GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image");
  const okImage: ImageResult = { ok: true, image: { url: `data:image/jpeg;base64,${B64}`, alt: "x" } };
  const rate: ImageResult = { ok: false, reason: "rate", detail: "429 Quota exceeded" };
  const refused: ImageResult = { ok: false, reason: "failed", detail: "moderation_blocked: rejected" };
  const answers: Record<string, ImageResult> = { "prompt one": okImage, "prompt two": rate, "prompt three": refused };
  const base: ImageProvider = { id: "gemini", minMs: 1, hasKey: () => true, fetchImage: async (ask) => answers[ask.prompt] ?? okImage };
  const core = coreImageProvider("rasm.image", "google/nano-banana", base, {
    upstream: geminiImageModel,
    values: { prompt: "the user's own words", imageStyle: "watercolor", imageRatio: "16:9" },
  });
  const selfie = [{ mime: "image/jpeg", base64: SELFIE_B64 }];
  const results = await withMediaContext(ctxOf(gen, true), async () => [
    await core.fetchImage({ ...ASK, prompt: "prompt one" }),
    await core.fetchImage({ ...ASK, prompt: "prompt one" }),
    await core.fetchImage({ ...ASK, prompt: "prompt two", inputImages: selfie }),
    await core.fetchImage({ ...ASK, prompt: "prompt three" }),
  ]);
  assert.deepEqual(results.map((r) => r.ok), [true, true, false, false]);

  const rows = await mediaJobsOf(gen);
  const keyOf = (p: string, n: number) => `${gen}:image:${tagOfPrompt(p)}:${n}`;
  assert.deepEqual(
    rows.map((r) => [r.idempotency_key, r.status]).sort(),
    [
      [keyOf("prompt one", 0), "succeeded"],
      [keyOf("prompt one", 1), "succeeded"],
      [keyOf("prompt two", 0), "failed"],
      [keyOf("prompt three", 0), "failed"],
    ].sort(),
    "four calls -> four rows; a repeated prompt gets the next index, a new prompt starts at 0",
  );
  for (const r of rows) {
    assert.equal(r.purpose, "rasm.image");
    assert.equal(r.model_id, "google/nano-banana");
    assert.equal(r.provider, "gemini");
    assert.equal(r.upstream_model, "gemini-3.1-flash-image", "upstream follows the admin slot / env, not the catalog default");
    assert.equal(Number((r as unknown as { cost_usd: string }).cost_usd), 0.067, "one picture per row, priced at the slot model (flash), not the catalog default (lite)");
    assert.deepEqual(
      { ...r.params },
      { prompt: "the user's own words", imageStyle: "watercolor", imageRatio: "16:9", imageCount: 1 },
      "recorded params: the user's values, no composed prompt, no sizes, no assets",
    );
    assert.ok(!JSON.stringify(r.params).includes(SELFIE_B64), "no image bytes in the row");
  }
  const failedRow = (key: string) => rows.find((r) => r.idempotency_key === key)!;
  assert.match(failedRow(keyOf("prompt two", 0)).last_error ?? "", /429 Quota exceeded/, "the provider's text is kept");
  assert.match(failedRow(keyOf("prompt three", 0)).last_error ?? "", /moderation_blocked/);
  assert.deepEqual(rows.find((r) => r.status === "succeeded")!.outputs, [{ mime: "image/jpeg", size: JPEG(3000).byteLength }]);

  // Health: the route's breaker was fed — calls: ok, ok, rate (retryable: counted), refusal (not retryable: not counted).
  const breaker = mediaBreakers().find((b) => b.name === routeKey({ provider: "gemini", upstreamModel: "gemini-3.1-flash-image", adapter: "google-image" }));
  assert.ok(breaker, "breaker for the live upstream model exists");
  assert.equal(breaker!.state, "closed");
  assert.equal(breaker!.failures, 1, "the rate failure counts, the content refusal does not");
});

// ───────────────────────────────────────────── 6. «Rasm» parity: no context / switch off / switch on

type Mode = "none" | "off" | "on";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
/** A zip carries the clock in its entry headers: compare names + contents instead of the raw bytes. */
async function fingerprint(bytes: Uint8Array, mime: string): Promise<string> {
  if (mime !== "application/zip") return sha(bytes);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const parts: string[] = [];
  for (const name of Object.keys(zip.files).sort()) parts.push(`${name}:${sha(await zip.files[name].async("uint8array"))}`);
  return parts.join(",");
}

type RasmScenario = {
  name: string;
  values: Record<string, unknown>;
  /** The image provider's HTTP answer for the n-th image request (arrival order). */
  respond: (n: number, url: string) => unknown;
  /** Status of every `media_jobs` row in the ON run, sorted. */
  rows: string[];
  /** The route breaker is fed: a success or a retryable failure reaches it, a blocked / no-key / refused call does not. */
  fed: boolean;
  upstream: () => string;
  error?: RegExp;
  delivered?: { got: number; want: number };
  env?: Record<string, string | undefined>;
};

const PROMPT = "Registon maydoni erta tongda";
const baseValues = { prompt: PROMPT, imageStyle: "photo", imageRatio: "1:1", imageCount: 1 };
const boom = (status: number) => () => res(status, { error: { message: "internal" } });

const RASM: RasmScenario[] = [
  { name: "gemini, 1 picture", values: baseValues, respond: () => geminiOk(), rows: ["succeeded"], fed: true, upstream: geminiImageModel },
  { name: "gemini, 2 pictures -> zip", values: { ...baseValues, imageCount: 2 }, respond: () => geminiOk(), rows: ["succeeded", "succeeded"], fed: true, upstream: geminiImageModel },
  {
    name: "gemini, one of two fails -> delivered 1/2",
    values: { ...baseValues, imageCount: 2 },
    respond: (n) => (n === 0 ? geminiOk() : boom(500)()),
    rows: ["failed", "succeeded"],
    fed: true,
    upstream: geminiImageModel,
    delivered: { got: 1, want: 2 },
  },
  { name: "gemini, all 500 -> «Rasm yaratilmadi»", values: baseValues, respond: boom(500), rows: ["failed"], fed: true, upstream: geminiImageModel, error: /Rasm yaratilmadi/ },
  { name: "gemini, 403 -> «Rasm yaratilmadi»", values: baseValues, respond: () => res(403, { error: { message: "Billing" } }), rows: ["failed"], fed: false, upstream: geminiImageModel, error: /Rasm yaratilmadi/ },
  { name: "gemini, no key -> «Rasm yaratilmadi»", values: baseValues, respond: () => geminiOk(), rows: ["failed"], fed: false, upstream: geminiImageModel, error: /Rasm yaratilmadi/, env: { GEMINI_API_KEY: undefined } },
  { name: "gpt-image, 1 picture", values: { ...baseValues, model: "openai" }, respond: () => openaiOk(), rows: ["succeeded"], fed: true, upstream: openaiImageModel, env: { OPENAI_API_KEY: "sk-test-openai-key-123456" } },
  { name: "gpt-image refuses the prompt -> readable refusal", values: { ...baseValues, model: "openai" }, respond: () => res(400, REFUSED), rows: ["failed"], fed: false, upstream: openaiImageModel, error: /kontent qoidalariga/, env: { OPENAI_API_KEY: "sk-test-openai-key-123456" } },
];

async function runRasm(t: TestContext, mode: Mode, sc: RasmScenario) {
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  resetBreakers();
  const requests: string[] = [];
  let n = 0;
  stubFetch(t, (url, body) => {
    if (isText(url)) return sceneOk();
    requests.push(JSON.stringify({ url, body }));
    return sc.respond(n++, url);
  });
  const gen = mode === "none" ? null : (await newGeneration()).gen;
  const exec = () => buildImageArtifact(TOOL_BY_ID.image, sc.values as never, undefined);
  let outcome: Record<string, unknown>;
  try {
    const built = await (gen ? withMediaContext(ctxOf(gen, mode === "on"), exec) : exec());
    outcome = {
      ok: true,
      fileName: built.fileName,
      mime: built.mime,
      sha: await fingerprint(built.bytes, built.mime),
      delivered: built.delivered ?? null,
      images: (built.doc.images ?? []).map(({ url, alt, w, h, mime }) => ({ url, alt, w, h, mime })),
      model: built.doc.imageModel,
      scene: built.doc.imageScene,
    };
  } catch (e) {
    outcome = { ok: false, error: `${(e as Error).constructor.name}: ${(e as Error).message}` };
  }
  return { outcome, requests: requests.sort(), rows: gen ? await mediaJobsOf(gen) : [], breakers: mediaBreakers().map((b) => b.name) };
}

test("«Rasm» parity: no context / switch off / switch on give the same file, doc, requests and errors; only ON records", { skip: skipDb }, async (t) => {
  quiet(t);
  for (const sc of RASM) {
    await t.test(sc.name, async (sub) => {
      quiet(sub);
      for (const [k, v] of Object.entries(sc.env ?? {})) setEnv(sub, k, v);
      const none = await runRasm(sub, "none", sc);
      const off = await runRasm(sub, "off", sc);
      const on = await runRasm(sub, "on", sc);

      assert.deepEqual(off.outcome, none.outcome, "switch off == no context (today's path)");
      assert.deepEqual(on.outcome, off.outcome, "switch on: same file, doc, delivered gap and error text");
      assert.deepEqual(on.requests, off.requests, "switch on: byte-identical provider requests (prompt, size, headers' body)");
      if (sc.error) assert.match(String(on.outcome.error), sc.error);
      else assert.equal(on.outcome.ok, true);
      assert.deepEqual(on.outcome.delivered ?? null, sc.delivered ?? null);

      // The core was NEVER touched with the switch off or without a job: no rows, no route breaker.
      for (const quietRun of [none, off]) {
        assert.equal(quietRun.rows.length, 0, "no media_jobs rows");
        assert.deepEqual(quietRun.breakers, [], "no media breaker created");
      }
      // ON: one row per picture asked for, the right terminal statuses, the live upstream model.
      assert.deepEqual(on.rows.map((r) => r.status).sort(), sc.rows);
      for (const r of on.rows) {
        assert.equal(r.purpose, "rasm.image");
        assert.equal(r.model_id, sc.values.model === "openai" ? "openai/gpt-image" : "google/nano-banana");
        assert.equal(r.upstream_model, sc.upstream());
        assert.equal(r.params.prompt, PROMPT, "the user's prompt is recorded, not the composed one");
        assert.equal(r.params.imageStyle, "photo");
      }
      assert.equal(new Set(on.rows.map((r) => r.idempotency_key)).size, on.rows.length, "keys are unique");
      assert.equal(on.breakers.length, sc.fed ? 1 : 0, sc.fed ? "the route breaker is fed" : "blocked / no-key / refused calls are not provider-health events");
    });
  }
});

// ───────────────────────────────────────────── 7. pro slide illustrations

const proMeta = () => extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Suv aylanishi" } as never);
const bulletDeck = (n: number): SlideModel[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, layout: "bullets", title: `Slayd ${i + 1}` }));

async function runSlides(t: TestContext, mode: Mode, n: number, respond: () => unknown) {
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  resetBreakers();
  const requests: string[] = [];
  stubFetch(t, (url, body) => {
    // The prompt writer (a text call) is not under test: it falls back to the composed prompt, as in slide-images.test.mts.
    if (!isGemini(url)) return res(500, {});
    requests.push(JSON.stringify({ url, body }));
    return respond();
  });
  const gen = mode === "none" ? null : (await newGeneration()).gen;
  const slides = bulletDeck(n);
  const exec = () => attachSlideImages(slides, "Suv aylanishi", "classic", 60_000, { meta: proMeta() });
  const report = await (gen ? withMediaContext(ctxOf(gen, mode === "on"), exec) : exec());
  return { report, images: slides.map((s) => s.image?.url ?? null), requests: requests.sort(), rows: gen ? await mediaJobsOf(gen) : [], breakers: mediaBreakers().map((b) => b.name) };
}

test("pro-slide parity: the Gemini member goes through the core only with the switch on; reports and slides are the same", { skip: skipDb }, async (t) => {
  quiet(t);
  await t.test("4 illustrations", async (sub) => {
    quiet(sub);
    const [none, off, on] = [await runSlides(sub, "none", 4, geminiOk), await runSlides(sub, "off", 4, geminiOk), await runSlides(sub, "on", 4, geminiOk)];
    assert.equal(on.report.got, 4);
    assert.deepEqual(off.report, none.report);
    assert.deepEqual(on.report, off.report, "same report (want/got/blocked/skipped/failed)");
    assert.deepEqual(on.images, off.images, "same pictures on the same slides");
    assert.deepEqual(on.requests, off.requests, "same Gemini requests");
    for (const quietRun of [none, off]) assert.deepEqual([quietRun.rows.length, quietRun.breakers], [0, []]);
    assert.equal(on.rows.length, 4, "one row per illustration");
    assert.deepEqual(new Set(on.rows.map((r) => `${r.purpose}|${r.status}|${r.model_id}|${r.upstream_model}`)), new Set([`proslide.illustration|succeeded|google/nano-banana|${geminiImageModel()}`]));
    assert.equal(new Set(on.rows.map((r) => r.idempotency_key)).size, 4);
  });

  await t.test("429 on every call -> failed (not blocked), the reasons survive the core", async (sub) => {
    quiet(sub);
    const rate = () => res(429, { error: { message: "Quota exceeded" } });
    const off = await runSlides(sub, "off", 4, rate);
    const on = await runSlides(sub, "on", 4, rate);
    assert.equal(off.report.failed, 4);
    assert.deepEqual(on.report, off.report);
    assert.deepEqual(on.images, off.images);
    assert.deepEqual(on.rows.map((r) => r.status), ["failed", "failed", "failed", "failed"]);
  });

  await t.test("403: the account block short-circuits the rest exactly as before", async (sub) => {
    quiet(sub);
    const forbidden = () => res(403, { error: { message: "Billing account is disabled" } });
    const off = await runSlides(sub, "off", 12, forbidden);
    const on = await runSlides(sub, "on", 12, forbidden);
    assert.equal(off.report.blocked, 12);
    assert.deepEqual(on.report, off.report, "blocked count and blockReason are the provider's own");
    assert.match(String(on.report.blockReason), /Billing account is disabled/);
    assert.ok(on.requests.length < 12 && off.requests.length < 12, "the short-circuit still stops the queue");
    assert.equal(on.rows.length, on.requests.length, "a row per request actually sent");
    assert.ok(on.rows.every((r) => r.status === "failed" && /403/.test(r.last_error ?? "")));
  });
});

test("limiter stays outside the core: a queue timeout starts no row and no breaker; concurrency is still the limiter's", { skip: skipDb }, async (t) => {
  quiet(t);
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  const { gen } = await newGeneration();
  resetBreakers();
  const sem = limiterFor("gemini-image");
  const held: (() => void)[] = [];
  for (let i = 0; i < sem.max; i++) held.push((await sem.acquire())!);
  let released = false;
  const release = () => {
    if (!released) held.forEach((r) => r());
    released = true;
  };
  t.after(release);
  let inFlight = 0;
  let peak = 0;
  let requests = 0;
  stubFetch(t, async () => {
    requests++;
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 40));
    inFlight--;
    return geminiOk();
  });
  const provider = withMediaContext(ctxOf(gen, true), () => pickProvider(proMeta()));
  const queued = await withMediaContext(ctxOf(gen, true), () => provider.fetchImage(ASK, Date.now() + 1000));
  assert.deepEqual(queued, { ok: false, reason: "timeout", detail: "provayder navbatida vaqt tugadi" }, "the limiter's own answer, as today");
  assert.deepEqual([requests, (await mediaJobsOf(gen)).length, mediaBreakers()], [0, 0, []], "the call never reached the core");

  release();
  const total = sem.max + 3;
  const results = await withMediaContext(ctxOf(gen, true), () => Promise.all(Array.from({ length: total }, (_, i) => provider.fetchImage({ ...ASK, prompt: `p${i}` }))));
  assert.ok(results.every((r) => r.ok));
  assert.equal(requests, total);
  assert.ok(peak <= sem.max, `in flight ${peak} never exceeds the limiter's ${sem.max}`);
  assert.ok(peak >= 2, "calls do run concurrently");
  assert.equal((await mediaJobsOf(gen)).length, total, "a row per call that reached the provider");
});

// ───────────────────────────────────────────── 8. graduation portrait

const PORTRAIT = { photoAssetId: "0123456789abcdef01234567", gown: "black", background: "studio", sash: "none", variants: 2 };

async function runPortrait(t: TestContext, mode: Mode, respond: (n: number) => unknown) {
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  resetBreakers();
  const requests: string[] = [];
  let n = 0;
  stubFetch(t, (url, body) => {
    requests.push(JSON.stringify({ url, body }));
    return respond(n++);
  });
  const gen = mode === "none" ? null : (await newGeneration()).gen;
  const exec = () => buildPortraitArtifact(TOOL_BY_ID.portrait, PORTRAIT as never, { photo: { url: `data:image/jpeg;base64,${SELFIE_B64}` } });
  let outcome: Record<string, unknown>;
  try {
    const built = await (gen ? withMediaContext(ctxOf(gen, mode === "on"), exec) : exec());
    outcome = {
      ok: true,
      fileName: built.fileName,
      mime: built.mime,
      sha: await fingerprint(built.bytes, built.mime),
      delivered: built.delivered ?? null,
      images: (built.doc.images ?? []).map(({ url, alt, w, h, mime }) => ({ url, alt, w, h, mime })),
    };
  } catch (e) {
    outcome = { ok: false, error: `${(e as Error).constructor.name}: ${(e as Error).message}` };
  }
  return { outcome, requests: requests.sort(), rows: gen ? await mediaJobsOf(gen) : [], breakers: mediaBreakers().map((b) => b.name) };
}

test("portrait parity: the selfie reaches Gemini the same way through the core; rows hold no image bytes", { skip: skipDb }, async (t) => {
  quiet(t);
  await t.test("two variants, both drawn", async (sub) => {
    quiet(sub);
    const [none, off, on] = [await runPortrait(sub, "none", geminiOk), await runPortrait(sub, "off", geminiOk), await runPortrait(sub, "on", geminiOk)];
    assert.equal(on.outcome.ok, true);
    assert.deepEqual(off.outcome, none.outcome);
    assert.deepEqual(on.outcome, off.outcome, "same file and pictures");
    assert.deepEqual(on.requests, off.requests, "same requests: the selfie part and the variant prompt are identical");
    assert.ok(on.requests.every((r) => r.includes(SELFIE_B64)), "the selfie is in every Gemini request");
    for (const quietRun of [none, off]) assert.deepEqual([quietRun.rows.length, quietRun.breakers], [0, []]);
    assert.equal(on.rows.length, 2);
    assert.deepEqual(new Set(on.rows.map((r) => `${r.purpose}|${r.status}|${r.model_id}|${r.upstream_model}`)), new Set([`portrait.edit|succeeded|google/nano-banana|${geminiImageModel()}`]));
    assert.equal(new Set(on.rows.map((r) => r.idempotency_key)).size, 2, "the two variants have different prompts, hence different keys");
    assert.ok(on.rows.every((r) => !JSON.stringify(r.params).includes(SELFIE_B64)), "the selfie never lands in media_jobs");
  });

  await t.test("one variant fails -> delivered 1/2; all fail -> the same readable messages", async (sub) => {
    quiet(sub);
    const half = (n: number) => (n === 0 ? geminiOk() : boom(500)());
    const off = await runPortrait(sub, "off", half);
    const on = await runPortrait(sub, "on", half);
    assert.deepEqual(on.outcome.delivered, { got: 1, want: 2 });
    assert.deepEqual(on.outcome, off.outcome);

    const noFace = () => res(200, { steps: [{ content: [{ type: "text", text: "no single face" }] }] });
    const offNoFace = await runPortrait(sub, "off", noFace);
    const onNoFace = await runPortrait(sub, "on", noFace);
    assert.match(String(onNoFace.outcome.error), /Suratda bitta aniq yuz topilmadi/, "the «no clear face» detail survives the core");
    assert.deepEqual(onNoFace.outcome, offNoFace.outcome);

    const blocked = () => res(403, { error: { message: "Billing" } });
    const offBlocked = await runPortrait(sub, "off", blocked);
    const onBlocked = await runPortrait(sub, "on", blocked);
    assert.match(String(onBlocked.outcome.error), /Rasm xizmati vaqtincha ishlamayapti/, "blocked/no-key reasons survive the core");
    assert.deepEqual(onBlocked.outcome, offBlocked.outcome);
    assert.ok(onBlocked.rows.every((r) => r.status === "failed"));
  });
});

// ───────────────────────────────────────────── 9. the whole paid flow through the worker

test("worker rasm flow: charge, file, doc and refunds are the same with media.core.image on and off", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  const worker = await import("../lib/server/worker.ts");
  const { getGeneration } = await import("../lib/server/jobs.ts");
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  const { reloadProviderKeys, stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
  t.after(async () => {
    stopProviderKeyRefresh();
    await query("DELETE FROM app_settings WHERE key = 'media.core.image'");
    invalidateSettingsCache();
  });

  let n = 0;
  const mkUser = async () =>
    String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`, [`media-image-flow-${process.pid}-${n++}`]))[0].id);
  const balanceOf = async (userId: string) => Number((await query<{ b: string }>(`SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1`, [userId]))[0].b);
  const post = async (userId: string, values: Record<string, unknown>) => {
    const { token } = await createSession(userId);
    const req = new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "rasm", values }),
    });
    const r = await inRequest(req, () => route.POST(req));
    return { status: r.status, body: (await r.json()) as { id?: string; error?: string } };
  };
  const setSwitch = async (on: boolean) => {
    await query("DELETE FROM app_settings WHERE key = 'media.core.image'");
    if (on) await query("INSERT INTO app_settings (key, value, updated_at) VALUES ('media.core.image', 'true'::jsonb, now())");
    invalidateSettingsCache();
  };

  async function runFlow(sub: TestContext, on: boolean, sc: RasmScenario) {
    await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
    await setSwitch(on);
    await reloadProviderKeys();
    resetBreakers();
    let k = 0;
    const requests: string[] = [];
    stubFetch(sub, (url, body) => {
      if (isText(url)) return sceneOk();
      requests.push(JSON.stringify({ url, body }));
      return sc.respond(k++, url);
    });
    const me = await mkUser();
    const before = await balanceOf(me);
    const r = await post(me, sc.values);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const charged = before - (await balanceOf(me));
    const job = await worker.claimNext();
    assert.equal(job?.id, r.body.id);
    await worker.runJob(job!);
    const gen = await getGeneration(r.body.id!, me);
    const stored = (await query<{ file_name: string; mime: string; bytes: Buffer }>(`SELECT file_name, mime, bytes FROM generation_files WHERE generation_id = $1`, [r.body.id]))[0];
    const file = stored ? { file_name: stored.file_name, mime: stored.mime, content: await fingerprint(stored.bytes, stored.mime) } : null;
    const tx = await query(`SELECT kind, points_delta::text, quota_delta::text, balance_delta::text FROM transactions WHERE user_id = $1 ORDER BY id`, [me]);
    const delivered = (await query<{ d: unknown }>(`SELECT delivered_json AS d FROM generations WHERE id = $1`, [r.body.id]))[0].d;
    return {
      outcome: {
        status: gen?.status,
        error: gen?.error ?? null,
        charged,
        net: before - (await balanceOf(me)),
        delivered,
        file,
        tx,
        // Stored pictures are served from `/api/generations/<id>/assets/…`: the id differs per run, the rest must not.
        images: (gen?.doc?.images ?? []).map(({ url, alt, w, h, mime }) => ({ url: url.replace(r.body.id!, "<generation>"), alt, w, h, mime })),
        model: gen?.doc?.imageModel ?? null,
      },
      requests: requests.sort(),
      rows: await mediaJobsOf(r.body.id!),
    };
  }

  const FLOW: { sc: RasmScenario; status: string; net: number }[] = [
    { sc: RASM[1], status: "COMPLETED", net: 3500 },
    // `refundPartial`: 1 of 2 pictures delivered -> half of the 3 500 paid comes back.
    { sc: RASM[2], status: "COMPLETED", net: 1750 },
    { sc: RASM[4], status: "FAILED", net: 0 },
    { sc: RASM[7], status: "FAILED", net: 0 },
  ];
  for (const { sc, status, net } of FLOW) {
    await t.test(sc.name, async (sub) => {
      quiet(sub);
      for (const [key, v] of Object.entries(sc.env ?? {})) setEnv(sub, key, v);
      const off = await runFlow(sub, false, sc);
      const on = await runFlow(sub, true, sc);
      assert.equal(off.outcome.status, status, String(off.outcome.error));
      assert.equal(off.outcome.net, net, "net cost of the job (the refund is what brings it down)");
      assert.deepEqual(on.outcome, off.outcome, "same status, error text, charge, refund transactions, delivered gap, file and doc");
      assert.deepEqual(on.requests, off.requests);
      assert.equal(off.rows.length, 0, "switch off: nothing recorded");
      assert.deepEqual(on.rows.map((r) => r.status).sort(), sc.rows, "switch on: the worker opened the context, one row per picture");
    });
  }
});
