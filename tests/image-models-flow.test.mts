import "./helpers/next-request.mts";
import test from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * `rasm` MODEL CHOICE (Gemini | ChatGPT), program-17 item 5 -- the paid flow on a real (isolated) Postgres, both
 * providers stubbed at fetch:
 *   route:  the chosen model must be available RIGHT NOW (provider enabled in «Provayderlar» AND a key), else 400
 *           before any charge; an unknown model is 400; the price follows the model (ChatGPT = 2x);
 *           a replay of an already-created job is not re-checked;
 *   Gemini only: the request/charge/job are exactly what they were before the choice existed;
 *   worker: the job draws with the chosen provider (URL check), stores the model in the doc, records the cost under
 *           the right provider; a content-policy refusal -> FAILED + full refund + a readable message.
 *
 * Mutations (by hand, each restored): drop the availability check in the route -> "unavailable model" tests go
 * red; make `imageProviderFor` ignore `model` -> the worker "draws with OpenAI" test goes red.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "test-gemini-key";
delete process.env.OPENAI_API_KEY;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("imgmodels") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(n, 3)]);
const B64 = JPEG(3000).toString("base64");
/** The Gemini TEXT call that enriches the prompt (`expandPrompt`): a fixed scene, so only the image call differs per model. */
const sceneOk = () =>
  ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"scene":"A wide view of Registon square at dawn, soft mist, long shadows."}' }] } }] }) }) as never;
const isText = (u: string) => u.includes(":generateContent");
const geminiOk = () => ({ ok: true, status: 200, json: async () => ({ steps: [{ type: "message", content: [{ data: B64, mime_type: "image/jpeg" }] }] }) }) as never;
const openaiOk = () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: B64 }], usage: { input_tokens: 30, input_tokens_details: { text_tokens: 30, image_tokens: 0 }, output_tokens: 1600 } }) }) as never;
const openaiRefused = () =>
  ({ ok: false, status: 400, json: async () => ({ error: { type: "image_generation_user_error", code: "moderation_blocked", message: "rejected" } }) }) as never;

test("rasm model choice: availability, price, Gemini-only parity, worker provider, refusal refund", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  const sessionRoute = await import("../app/api/auth/session/route.ts");
  const worker = await import("../lib/server/worker.ts");
  const { getGeneration } = await import("../lib/server/jobs.ts");
  const { reloadProviderKeys, stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
  const realFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = realFetch;
    stopProviderKeyRefresh();
    await pool().end();
    await iso.drop();
  });

  let n = 0;
  const mkUser = async () =>
    String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`, [`imgmodel-${Date.now()}-${n++}`]))[0].id);
  const balanceOf = async (userId: string) => Number((await query<{ b: string }>(`SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1`, [userId]))[0].b);
  const post = async (userId: string, values: Record<string, unknown>, extraHeaders: Record<string, string> = {}) => {
    const { token } = await createSession(userId);
    const req = new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify({ slug: "rasm", values }),
    });
    const r = await inRequest(req, () => route.POST(req));
    return { status: r.status, body: (await r.json()) as { id?: string; error?: string } };
  };
  const features = async (userId: string) => {
    const { token } = await createSession(userId);
    const req = new Request("http://localhost/api/auth/session", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    const r = await inRequest(req, () => sessionRoute.GET(req));
    return ((await r.json()) as { features: { images: boolean; imageModels?: string[] } }).features;
  };
  const clearQueue = () => query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
  const setSwitch = async (provider: string, enabled: boolean | null) => {
    if (enabled === null) await query(`DELETE FROM provider_settings WHERE provider = $1`, [provider]);
    else await query(`INSERT INTO provider_settings (provider, enabled) VALUES ($1, $2) ON CONFLICT (provider) DO UPDATE SET enabled = $2`, [provider, enabled]);
    await reloadProviderKeys();
  };
  const runOne = async (id: string) => {
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    await worker.runJob(job!);
  };
  const PROMPT = "Registon maydoni erta tongda";

  await t.test("Gemini only: features list one model; a request without `model` is charged 2 000 and stored unchanged", async () => {
    await clearQueue();
    await reloadProviderKeys();
    const me = await mkUser();
    assert.deepEqual((await features(me)).imageModels, ["gemini"]);
    const b0 = await balanceOf(me);
    const r = await post(me, { prompt: PROMPT, imageStyle: "photo", imageRatio: "1:1", imageCount: 1 });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(b0 - (await balanceOf(me)), 2000);
    const row = (await query<{ values_json: Record<string, unknown> }>(`SELECT values_json FROM generations WHERE id = $1`, [r.body.id]))[0];
    assert.ok(!("model" in row.values_json), "no `model` key: byte-identical to the pre-choice request");
    const g = await post(me, { prompt: PROMPT, model: "gemini", imageCount: 4 });
    assert.equal(g.status, 202);
    assert.equal(b0 - 2000 - (await balanceOf(me)), 6000, "4 Gemini images = 6 000");
  });

  await t.test("unavailable model (no OpenAI key) -> 400 before any charge; an unknown model -> 400", async () => {
    await clearQueue();
    const me = await mkUser();
    const b0 = await balanceOf(me);
    const noKey = await post(me, { prompt: PROMPT, model: "openai" });
    assert.equal(noKey.status, 400);
    assert.match(String(noKey.body.error), /model/i);
    const unknown = await post(me, { prompt: PROMPT, model: "dall-e" });
    assert.equal(unknown.status, 400);
    assert.match(String(unknown.body.error), /Noma'lum/);
    const nonString = await post(me, { prompt: PROMPT, model: 7 });
    assert.equal(nonString.status, 400);
    assert.equal(await balanceOf(me), b0, "nothing charged");
    assert.equal(Number((await query<{ c: string }>(`SELECT count(*)::text AS c FROM generations WHERE user_id = $1`, [me]))[0].c), 0, "nothing queued");
  });

  await t.test("OpenAI key present: both models listed; ChatGPT is charged 2x (4 000 / 12 000) and the choice is stored", async () => {
    await clearQueue();
    process.env.OPENAI_API_KEY = "sk-test-openai-key-123456";
    t.after(() => void delete process.env.OPENAI_API_KEY);
    await reloadProviderKeys();
    const me = await mkUser();
    assert.deepEqual((await features(me)).imageModels, ["gemini", "openai"]);
    const b0 = await balanceOf(me);
    const one = await post(me, { prompt: PROMPT, model: "openai", imageCount: 1 });
    assert.equal(one.status, 202, JSON.stringify(one.body));
    assert.equal(b0 - (await balanceOf(me)), 4000);
    const four = await post(me, { prompt: PROMPT, model: "openai", imageCount: 4 });
    assert.equal(four.status, 202);
    assert.equal(b0 - 4000 - (await balanceOf(me)), 12000);
    const row = (await query<{ values_json: Record<string, unknown> }>(`SELECT values_json FROM generations WHERE id = $1`, [one.body.id]))[0];
    assert.equal(row.values_json.model, "openai");
    // Gemini is still 2 000 next to it.
    const b1 = await balanceOf(me);
    assert.equal((await post(me, { prompt: PROMPT, model: "gemini" })).status, 202);
    assert.equal(b1 - (await balanceOf(me)), 2000);
  });

  await t.test("the admin switch: OpenAI disabled -> hidden from features and rejected (key still in env); re-enabled -> back", async () => {
    await clearQueue();
    process.env.OPENAI_API_KEY = "sk-test-openai-key-123456";
    t.after(() => void delete process.env.OPENAI_API_KEY);
    const me = await mkUser();
    await setSwitch("openai-image", false);
    assert.deepEqual((await features(me)).imageModels, ["gemini"]);
    const b0 = await balanceOf(me);
    const off = await post(me, { prompt: PROMPT, model: "openai" });
    assert.equal(off.status, 400);
    assert.equal(await balanceOf(me), b0);
    await setSwitch("openai-image", null);
    assert.deepEqual((await features(me)).imageModels, ["gemini", "openai"]);
    assert.equal((await post(me, { prompt: PROMPT, model: "openai" })).status, 202);
  });

  await t.test("Gemini switched off, OpenAI keyed: the default request (no model) is rejected, ChatGPT works, `images` flag stays Gemini's", async () => {
    await clearQueue();
    process.env.OPENAI_API_KEY = "sk-test-openai-key-123456";
    t.after(() => void delete process.env.OPENAI_API_KEY);
    const me = await mkUser();
    await setSwitch("gemini", false);
    try {
      const f = await features(me);
      assert.deepEqual(f.imageModels, ["openai"]);
      assert.equal(f.images, false, "the pro-slide/portrait flag is unchanged");
      assert.equal((await post(me, { prompt: PROMPT })).status, 400, "an old client (no model) cannot reach a switched-off Gemini");
      assert.equal((await post(me, { prompt: PROMPT, model: "openai" })).status, 202);
    } finally {
      await setSwitch("gemini", null);
    }
  });

  await t.test("a replay of an existing job is answered even if the model became unavailable", async () => {
    await clearQueue();
    process.env.OPENAI_API_KEY = "sk-test-openai-key-123456";
    await reloadProviderKeys();
    const me = await mkUser();
    const key = randomUUID();
    const first = await post(me, { prompt: PROMPT, model: "openai" }, { "Idempotency-Key": key });
    assert.equal(first.status, 202);
    delete process.env.OPENAI_API_KEY;
    await reloadProviderKeys();
    const again = await post(me, { prompt: PROMPT, model: "openai" }, { "Idempotency-Key": key });
    assert.equal(again.status, 202, "the paid job is returned, not hidden behind a 400");
    assert.equal(again.body.id, first.body.id);
  });

  await t.test("worker: a ChatGPT job draws with OpenAI (and only OpenAI), stores the model, records the cost under openai", async () => {
    await clearQueue();
    process.env.OPENAI_API_KEY = "sk-test-openai-key-123456";
    await reloadProviderKeys();
    const me = await mkUser();
    const urls: string[] = [];
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (u: string, init: RequestInit) => {
      if (isText(String(u))) return sceneOk();
      urls.push(String(u));
      body = JSON.parse(String(init.body));
      return openaiOk();
    }) as unknown as typeof fetch;
    const r = await post(me, { prompt: PROMPT, model: "openai", imageRatio: "16:9", imageCount: 1 });
    assert.equal(r.status, 202);
    await runOne(r.body.id!);
    const gen = await getGeneration(r.body.id!, me);
    assert.equal(gen?.status, "COMPLETED", String(gen?.error));
    assert.deepEqual(urls, ["https://api.openai.com/v1/images/generations"]);
    assert.ok(String(body.prompt).includes("Registon"));
    assert.match(String(body.size), /^1\d{3}x[5-9]\d{2}$/, "16:9 asks for a landscape size");
    assert.equal(gen?.doc?.imageModel, "openai");
    assert.equal(gen?.doc?.images?.length, 1);
    const cost = (await query<{ cost_json: { parts?: { provider: string; kind: string; usd: number }[] } }>(`SELECT cost_json FROM generations WHERE id = $1`, [r.body.id]))[0].cost_json;
    const img = cost.parts?.find((p) => p.kind === "image");
    assert.equal(img?.provider, "openai");
    assert.ok(img!.usd > 0.04 && img!.usd < 0.06, `cost from usage: ${img?.usd}`);
  });

  await t.test("worker: a Gemini job (no model) still draws with Gemini only", async () => {
    await clearQueue();
    process.env.OPENAI_API_KEY = "sk-test-openai-key-123456";
    await reloadProviderKeys();
    const me = await mkUser();
    const urls: string[] = [];
    globalThis.fetch = (async (u: string) => (isText(String(u)) ? sceneOk() : (urls.push(String(u)), geminiOk()))) as unknown as typeof fetch;
    const r = await post(me, { prompt: PROMPT });
    assert.equal(r.status, 202);
    await runOne(r.body.id!);
    const gen = await getGeneration(r.body.id!, me);
    assert.equal(gen?.status, "COMPLETED", String(gen?.error));
    assert.equal(urls.length, 1);
    assert.ok(urls[0].startsWith("https://generativelanguage.googleapis.com/"), urls[0]);
    assert.equal(gen?.doc?.imageModel, "gemini");
  });

  await t.test("worker: OpenAI refuses the prompt -> FAILED, the whole price refunded, a readable (not technical) message", async () => {
    await clearQueue();
    process.env.OPENAI_API_KEY = "sk-test-openai-key-123456";
    await reloadProviderKeys();
    const me = await mkUser();
    globalThis.fetch = (async (u: string) => (isText(String(u)) ? sceneOk() : openaiRefused())) as unknown as typeof fetch;
    const before = await balanceOf(me);
    const r = await post(me, { prompt: PROMPT, model: "openai" });
    assert.equal(r.status, 202);
    assert.equal(before - (await balanceOf(me)), 4000);
    await runOne(r.body.id!);
    const gen = await getGeneration(r.body.id!, me);
    assert.equal(gen?.status, "FAILED");
    assert.match(String(gen?.error), /kontent qoidalariga/);
    assert.ok(!/moderation|openai|api/i.test(String(gen?.error)), "no provider text reaches the user");
    assert.equal(await balanceOf(me), before, "full refund");
  });
});
