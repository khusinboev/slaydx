import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * Studio package G «AI yaxshilash» (docs/studio/P11-SPEC.md «G»): the job's prompt is translated and improved in the worker,
 * on a real (isolated) Postgres with the providers stubbed at `fetch`.
 *
 *   pure        `fitPrompt` (word end, characters, UTF-8 bytes, quoted text, too little left), `looksLikeLyrics`, `aiImproveOf`;
 *   switch      the differential: on, off and absent each change what the provider receives (clip, picture, music, effect);
 *   record      the user's text stays in the doc and the gallery; the English prompt is `sentPrompt`; the LLM cost is in
 *               `cost_json`, the price does not move;
 *   once        a re-claim never rewrites or pays again; a pending row left by a dead worker is never called again;
 *   failure     an LLM error, an unusable answer: the user's own prompt goes, no failure, no refund;
 *   limits      `maxBytes` (Pixverse) and the quoted text survive;
 *   never       an effect, an avatar script, an edit instruction, pasted lyrics are not rewritten;
 *   compare     a batch makes ONE rewrite and every model gets it; a batch cannot mix the switch.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `improvedParams` ignores the switch (always the user's prompt)      -> «switch: clip»;
 *   2. `buildStudioImage` keeps `expandPrompt` with the switch off         -> «switch: picture»;
 *   3. `rewriteOnce` skips the claim                                       -> «once: a re-claim»;
 *   4. a stale pending row is called again                                 -> «once: a dead worker»;
 *   5. `close` never stores a failure, `make` rejection rethrown           -> «failure»;
 *   6. `withPriorCost` drops the prompt's cost                             -> «record»;
 *   7. `studioResult` reads the prompt from the media row                  -> «record» (the gallery shows English);
 *   8. `fitPrompt` ignores `maxBytes`                                      -> «limits» and «pure»;
 *   9. the avatar guard removed from `improvedParams`                      -> «never: avatar»;
 *  10. the compare group left out of the claim                             -> «compare»;
 *  11. `looksLikeLyrics` guard removed from `autoPrompt`                   -> «never: lyrics».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "AIza-test-gemini-key-0123456789";
process.env.KLING_API_KEY = "klingtestkey";
process.env.FAL_KEY = "fal-flow-key-0000:flowsecretvalue";
process.env.HEYGEN_API_KEY = "hg-test-key-0123456789";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("autoprompt") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const enh = await import("../lib/media/enhance.ts");

test("pure: fitPrompt keeps a rewrite inside the model's limits, or gives the user's own prompt back", () => {
  const limit = { min: 5, max: 20 };
  assert.equal(enh.fitPrompt("short rewrite", "own", limit), "short rewrite");
  assert.equal(enh.fitPrompt("one two three four five six seven", "own", limit), "one two three four", "cut at a word end");
  assert.equal(enh.fitPrompt("abcdefgh ijkl", "own", { min: 3, max: 100, maxBytes: 8 }), "abcdefgh", "bytes count, not characters");
  assert.equal(enh.fitPrompt("ўзбекча матн", "own", { min: 3, max: 100, maxBytes: 10 }), "own", "the only word is over the bytes: nothing to cut");
  assert.equal(enh.fitPrompt("ўзбек матн бор", "own", { min: 3, max: 100, maxBytes: 19 }), "ўзбек матн", "Cyrillic letters are two bytes each");
  assert.equal(enh.fitPrompt("ab", "own", { min: 5, max: 100 }), "own", "too short for the model");
  const quoted = 'Yozuv: "Salom dunyo"';
  assert.equal(enh.fitPrompt('a long scene description comes first "Salom dunyo"', quoted, { min: 3, max: 30 }), quoted, "the cut lost the quoted text");
  assert.equal(enh.fitPrompt('Sign "Salom dunyo" on a wall', quoted, { min: 3, max: 100 }), 'Sign "Salom dunyo" on a wall');
});

test("pure: lyrics are recognized, a description is not; the switch is read strictly", () => {
  for (const s of ["[Verse 1] Tun o'tdi", "[chorus] yur, yur", "Qo'shiq matni: bahor keldi", "qo‘shiq so‘zlari: bahor", "Lyrics: we walk alone", "[Куплет] ночь"]) assert.ok(enh.looksLikeLyrics(s), s);
  for (const s of ["calm lo-fi hip hop, soft piano", "bahor haqida qo'shiq", "so'zsiz kuy"]) assert.ok(!enh.looksLikeLyrics(s), s);
  assert.equal(enh.aiImproveOf({ aiImprove: true }), true);
  assert.equal(enh.aiImproveOf({ aiImprove: false }), false);
  assert.equal(enh.aiImproveOf({}), null);
  assert.equal(enh.aiImproveOf({ aiImprove: "true" }), null, "only the form's boolean");
});

test("studio auto prompt", { skip }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  const compareRoute = await import("../app/api/studio/compare/route.ts");
  const worker = await import("../lib/server/worker.ts");
  const ops = await import("../lib/server/video-ops.ts");
  const settings = await import("../lib/server/settings.ts");
  const { reloadProviderKeys, stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
  const { invalidateMediaOverrides } = await import("../lib/server/media/overrides.ts");
  const { mediaPricing } = await import("../lib/server/media/pricing.ts");
  const { studioVideoPrice } = await import("../lib/media/studio-video-pricing.ts");
  const { setSafeFetchLookup } = await import("../lib/generation/safe-fetch.ts");
  const { buildStudioImage } = await import("../lib/generation/studio/index.ts");
  const { buildStudioAudio } = await import("../lib/generation/studio/audio.ts");
  const { buildStudioTool } = await import("../lib/generation/studio/edit.ts");
  const { autoPrompt } = await import("../lib/generation/studio/auto-prompt.ts");
  const { rewriteOnce } = await import("../lib/server/media/prompt-rewrites.ts");
  const { withJobCost } = await import("../lib/generation/job-cost.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const { MEDIA_CATALOG } = await import("../lib/media/catalog.ts");
  const { sentOf } = await import("../lib/server/media/active-jobs.ts");
  const { studioGallery } = await import("../lib/server/media/public.ts");
  await migrate();
  await reloadProviderKeys();
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
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

  const QUEUE = "https://queue.fal.run";
  const CDN = "https://v3b.fal.media/files/flow/";
  const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const REWRITE = "A wide cinematic shot of Registan square at dawn, slow push-in, soft golden light.";
  const stub = {
    llm: 0,
    llmSeen: [] as string[],
    llmAnswer: (): Response => jsonRes({ candidates: [{ content: { parts: [{ text: JSON.stringify({ prompt: REWRITE }) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 } }),
    submits: [] as Record<string, unknown>[],
    falImage: [] as Record<string, unknown>[],
    counter: 0,
    status: { status: "IN_PROGRESS" } as Record<string, unknown>,
  };
  const reset = async () => {
    await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED', 'IN_PROGRESS')`);
    await query(`UPDATE media_jobs SET status = 'failed' WHERE status IN ('pending', 'submitting')`);
    stub.llm = 0;
    stub.llmSeen = [];
    stub.submits = [];
    stub.falImage = [];
    stub.status = { status: "IN_PROGRESS" };
    stub.llmAnswer = () => jsonRes({ candidates: [{ content: { parts: [{ text: JSON.stringify({ prompt: REWRITE }) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 } });
  };
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(3000, 3)]);
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    if (url.includes(":generateContent")) {
      stub.llm++;
      stub.llmSeen.push(JSON.stringify(body));
      return stub.llmAnswer();
    }
    const picture = /\/(blackforestlabs|bytedance\/seedream)\//.test(url);
    if (url.startsWith(`${QUEUE}/`) && method === "POST") {
      (picture ? stub.falImage : stub.submits).push(body!);
      return jsonRes({ request_id: `00000000-0000-4000-8000-${String(++stub.counter).padStart(12, "0")}` });
    }
    if (picture && url.endsWith("/status")) return jsonRes({ status: "COMPLETED" });
    if (picture) return jsonRes({ images: [{ url: `data:image/jpeg;base64,${JPEG.toString("base64")}` }] });
    if (url.startsWith(`${QUEUE}/`) && url.endsWith("/status")) return jsonRes(stub.status, stub.status.status === "COMPLETED" ? 200 : 202);
    if (url.startsWith(`${QUEUE}/`)) return jsonRes({ video: { url: `${CDN}clip.mp4` } });
    if (url.startsWith(CDN)) return new Response(Buffer.from(fakeMp4(5)), { status: 200, headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as unknown as typeof fetch;

  let n = 0;
  const mkUser = async () => String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 500000) RETURNING id`, [`sap-${process.pid}-${n++}`]))[0]!.id);
  const wallet = async (id: string) => Number((await query<{ balance: string }>(`SELECT balance::text FROM users WHERE id = $1`, [id]))[0]!.balance);
  const cookieOf = async (userId: string) => `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
  const post = async (userId: string, values: Record<string, unknown>) => {
    await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
    const req = new Request("http://localhost/api/generations", { method: "POST", headers: { cookie: await cookieOf(userId), "content-type": "application/json" }, body: JSON.stringify({ slug: "studio-video", values }) });
    const r = await inRequest(req, () => route.POST(req));
    return { status: r.status, body: (await r.json()) as { id?: string; error?: string; price?: number } };
  };
  const startWaiting = async (userId: string, values: Record<string, unknown>) => {
    const r = await post(userId, values);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const job = await worker.claimNext();
    assert.equal(job?.id, r.body.id);
    await worker.runJob(job!);
    return r.body.id!;
  };
  const gen = async (id: string) =>
    (await query<{ status: string; error: string | null; cost_json: { usd: number; provider: string; calls: number; parts: { kind: string; usd: number }[] } | null; doc_json: { sentPrompt?: string; video?: { prompt: string } } | null; values_json: { prompt: string } }>(
      `SELECT status, error, cost_json, doc_json, values_json FROM generations WHERE id = $1`,
      [id],
    ))[0]!;
  const refunds = async (id: string) => Number((await query<{ n: string }>(`SELECT count(*)::text AS n FROM transactions WHERE kind = 'refund' AND reference = $1`, [id]))[0]!.n);
  const rewriteRow = (id: string) => queryOne<{ status: string; prompt: string | null }>("SELECT status, prompt FROM studio_prompt_rewrites WHERE generation_id = $1", [id]);
  const finish = async (id: string) => {
    stub.status = { status: "COMPLETED" };
    await query(`UPDATE media_jobs SET next_poll_at = now() - interval '1 second' WHERE idempotency_key = $1`, [`${id}:video:0`]);
    assert.equal(await ops.pollDueVideoOps(), 1);
  };
  await query("INSERT INTO app_settings (key, value) VALUES ('video.enabled', 'true'::jsonb), ('video.max_concurrent', '5'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
  settings.invalidateSettingsCache();
  invalidateMediaOverrides();

  const OWN = "Tong chog‘ida Registon maydoni, kamera yaqinlashadi";
  const WAN = { modelId: "alibaba/wan-3", prompt: OWN, seconds: 5, resolution: "720p", aspect: "16:9" };

  await t.test("switch: clip — on sends the rewrite, off and absent send the user's words; the price is the same", async () => {
    await reset();
    const me = await mkUser();
    const on = await startWaiting(me, { ...WAN, aiImprove: true });
    assert.equal(stub.submits.at(-1)!.prompt, REWRITE, "MUTATSIYA: the switch ignored");
    assert.equal(stub.llm, 1);
    assert.ok(stub.llmSeen[0]!.includes(OWN), "the user's prompt reached the LLM");
    assert.ok(stub.llmSeen[0]!.includes("text-to-video"), "the kind's own system prompt");
    const off = await startWaiting(me, { ...WAN, aiImprove: false });
    assert.equal(stub.submits.at(-1)!.prompt, OWN);
    const absent = await startWaiting(me, WAN);
    assert.equal(stub.submits.at(-1)!.prompt, OWN, "a job without the switch keeps its path");
    assert.equal(stub.llm, 1, "off and absent make no call");
    const price = studioVideoPrice(WAN, await mediaPricing())!;
    assert.equal(await wallet(me), 500_000 - 3 * price, "the switch changes no price");
    assert.equal(await rewriteRow(off), null);
    assert.equal(await rewriteRow(absent), null);
    assert.deepEqual(await rewriteRow(on), { status: "done", prompt: REWRITE });
  });

  await t.test("record: the user's text stays, `sentPrompt` shows the English, the LLM cost lands in cost_json", async () => {
    await reset();
    const me = await mkUser();
    const id = await startWaiting(me, { ...WAN, aiImprove: true });
    await finish(id);
    const g = await gen(id);
    assert.equal(g.status, "COMPLETED", String(g.error));
    assert.equal(g.values_json.prompt, OWN, "the request stays as typed");
    assert.equal(g.doc_json!.video!.prompt, OWN, "MUTATSIYA: the result must keep the user's text");
    assert.equal(g.doc_json!.sentPrompt, REWRITE);
    const { items } = await studioGallery(me, null);
    assert.equal(items[0]!.prompt, OWN, "the gallery keeps the user's text");
    const kinds = g.cost_json!.parts.map((p) => p.kind).sort();
    assert.deepEqual(kinds, ["llm", "video"], "MUTATSIYA: the prompt's cost lost at the finish");
    assert.equal(g.cost_json!.provider, "fal", "the report still names the clip");
    const llm = g.cost_json!.parts.find((p) => p.kind === "llm")!;
    assert.ok(llm.usd > 0);
    assert.equal(g.cost_json!.usd, Number((0.5 + llm.usd).toFixed(6)));
    assert.equal(g.cost_json!.calls, 2);
    // Off: nothing to show.
    const plain = await startWaiting(me, { ...WAN, aiImprove: false });
    await finish(plain);
    assert.equal((await gen(plain)).doc_json!.sentPrompt, undefined);
    assert.deepEqual((await gen(plain)).cost_json!.parts.map((p) => p.kind), ["video"]);
  });

  await t.test("once: a re-claim adopts the stored rewrite, no second call, no second cost", async () => {
    await reset();
    const me = await mkUser();
    const id = await startWaiting(me, { ...WAN, aiImprove: true });
    const before = (await gen(id)).cost_json;
    await ops.submitStudioVideoJob({ id, userId: me, lease: "other", values: { ...WAN, aiImprove: true } as never });
    assert.equal(stub.llm, 1, "MUTATSIYA: no claim, the rewrite is paid twice");
    assert.equal(stub.submits.length, 1);
    assert.deepEqual((await gen(id)).cost_json, before);
    // A re-claim that dies BEFORE the provider call: the same rewrite goes, from the row.
    const again = await autoPrompt({ kind: "video", prompt: OWN, limit: { min: 5, max: 1000 }, generationId: id });
    assert.equal(again, REWRITE);
    assert.equal(stub.llm, 1);
  });

  await t.test("once: a pending row of a dead worker is not called again, the job goes on with the user's prompt", async () => {
    await reset();
    const me = await mkUser();
    const id = (await post(me, { ...WAN, aiImprove: true })).body.id!;
    await query("INSERT INTO studio_prompt_rewrites (generation_id, kind, created_at) VALUES ($1, 'video', now() - interval '10 minutes')", [id]);
    const job = await worker.claimNext();
    await worker.runJob(job!);
    assert.equal(stub.llm, 0, "MUTATSIYA: the dead worker's paid call repeated");
    assert.equal(stub.submits.at(-1)!.prompt, OWN);
    assert.deepEqual(await rewriteRow(id), { status: "failed", prompt: null });
    assert.equal((await gen(id)).status, "IN_PROGRESS", "the job did not fail");
    // A fresh pending row is a live owner: the second caller waits for its answer and pays nothing.
    const id2 = (await post(me, { ...WAN, aiImprove: true })).body.id!;
    await query("INSERT INTO studio_prompt_rewrites (generation_id, kind) VALUES ($1, 'video')", [id2]);
    const made = rewriteOnce(id2, "video", async () => assert.fail("not the owner"), { pollMs: 5 });
    await query("UPDATE studio_prompt_rewrites SET status = 'done', prompt = 'late answer' WHERE generation_id = $1", [id2]);
    assert.equal(await made, "late answer");
    await query("UPDATE generations SET status = 'REVOKED' WHERE id = $1", [id2]);
  });

  await t.test("failure: an LLM error or an unusable answer sends the user's prompt; no failure, no refund", async () => {
    await reset();
    const me = await mkUser();
    stub.llmAnswer = () => jsonRes({ error: { message: "bad request" } }, 400);
    const a = await startWaiting(me, { ...WAN, aiImprove: true });
    assert.ok(stub.llm >= 1);
    assert.equal(stub.submits.at(-1)!.prompt, OWN);
    assert.deepEqual(await rewriteRow(a), { status: "failed", prompt: null }, "MUTATSIYA: a failure must be stored, or a re-claim pays again");
    const calls = stub.llm;
    await ops.submitStudioVideoJob({ id: a, userId: me, lease: "other", values: { ...WAN, aiImprove: true } as never });
    assert.equal(stub.llm, calls, "a failed rewrite is not retried either");
    await finish(a);
    const g = await gen(a);
    assert.equal(g.status, "COMPLETED");
    assert.equal(g.doc_json!.sentPrompt, undefined);
    assert.equal(await refunds(a), 0);
    // Answered, but nothing usable.
    stub.llmAnswer = () => jsonRes({ candidates: [{ content: { parts: [{ text: "sorry" }] }, finishReason: "STOP" }] });
    const b = await startWaiting(me, { ...WAN, aiImprove: true });
    assert.equal(stub.submits.at(-1)!.prompt, OWN);
    assert.equal((await gen(b)).status, "IN_PROGRESS");
    assert.equal(await refunds(b), 0);
    // A store that cannot answer is the same: the job never depends on the rewrite.
    const noRow = await autoPrompt({ kind: "video", prompt: OWN, limit: { min: 5, max: 1000 }, generationId: "not-a-uuid" });
    assert.equal(noRow, OWN);
  });

  await t.test("limits: a Pixverse byte limit and the quoted text are respected", async () => {
    await reset();
    const quoted = "Doskada «Xush kelibsiz» yozuvi bor maktab sinfi";
    stub.llmAnswer = () => jsonRes({ candidates: [{ content: { parts: [{ text: JSON.stringify({ prompt: `A classroom. ${"word ".repeat(100)}` }) }] }, finishReason: "STOP" }] });
    const out = await autoPrompt({ kind: "video", prompt: quoted, limit: { min: 5, max: 1000, maxBytes: 200 } });
    assert.ok(new TextEncoder().encode(out).length <= 200, "MUTATSIYA: maxBytes ignored");
    assert.ok(out.includes("Xush kelibsiz"), "the quote was put back or the user's prompt kept");
    stub.llmAnswer = () => jsonRes({ candidates: [{ content: { parts: [{ text: JSON.stringify({ prompt: `A classroom with a blackboard reading "Welcome"` }) }] }, finishReason: "STOP" }] });
    const restored = await autoPrompt({ kind: "video", prompt: quoted, limit: { min: 5, max: 1000 } });
    assert.ok(restored.includes('"Xush kelibsiz"'), "a translated quote comes back verbatim");
  });

  await t.test("switch: picture — on: one rewrite is the scene; off: no LLM, the user's words; absent: the old expansion", async () => {
    await reset();
    const tool = TOOL_BY_ID["studio-image"]!;
    const USER = "Tog‘ ko‘li tongda";
    const base = { modelId: "bfl/flux", prompt: USER, imageRatio: "1:1", imageCount: 1, imageStyle: "photo" };
    const on = await withJobCost(() => buildStudioImage(tool, { ...base, aiImprove: true } as never));
    const onPrompt = String(stub.falImage.at(-1)!.prompt);
    assert.ok(onPrompt.includes(REWRITE), onPrompt);
    assert.ok(!onPrompt.includes(USER), "the rewrite replaced the user's words");
    assert.equal(stub.llm, 1, "one LLM pass, no second expansion");
    assert.equal(on.value.doc!.sentPrompt, REWRITE);
    assert.equal(on.value.doc!.imagePrompt, USER, "the viewer and gallery keep the user's text");
    assert.equal(on.cost.toJson().parts!.filter((p) => p.kind === "llm").length, 1, "the rewrite is in the job's meter");
    const off = await buildStudioImage(tool, { ...base, aiImprove: false } as never);
    const offPrompt = String(stub.falImage.at(-1)!.prompt);
    assert.ok(offPrompt.includes(USER), offPrompt);
    assert.ok(!offPrompt.includes(REWRITE));
    assert.equal(stub.llm, 1, "MUTATSIYA: the switch off still expanded the prompt");
    assert.equal(off.doc!.sentPrompt, undefined);
    await buildStudioImage(tool, base as never);
    assert.equal(stub.llm, 2, "absent: the job keeps its old expansion");
    // The LLM down: the picture still goes.
    stub.llmAnswer = () => jsonRes({ error: { message: "bad" } }, 400);
    const down = await buildStudioImage(tool, { ...base, aiImprove: true } as never);
    assert.ok(String(stub.falImage.at(-1)!.prompt).includes(USER));
    assert.equal(down.doc!.sentPrompt, undefined);
  });

  await t.test("switch: music and effect; pasted lyrics and the words of a voice job are never rewritten", async () => {
    await reset();
    const tool = TOOL_BY_ID["studio-audio"]!;
    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, ...new Array(600).fill(0)]);
    const calls: Record<string, unknown>[] = [];
    const deps = { adapters: {}, run: async (i: { values: Readonly<Record<string, unknown>> }) => (calls.push({ ...i.values }), { outputs: [{ kind: "inline" as const, bytes: mp3, mime: "audio/mpeg" }] }) };
    const ctx = { input: null, clones: {} };
    const MUSIC = { modelId: "elevenlabs/music", prompt: "bahor haqida quvnoq kuy", length: "30", instrumental: true };
    const SFX = { modelId: "elevenlabs/sfx", prompt: "eshik g‘ichirlab ochiladi", duration: 5, influence: "0.5", loop: false, variants: 2 };
    assert.ok(MEDIA_CATALOG.byId(MUSIC.modelId) && MEDIA_CATALOG.byId(SFX.modelId), "the catalog ids");
    const on = await buildStudioAudio(tool, { ...MUSIC, aiImprove: true } as never, ctx, {}, deps as never);
    assert.equal(calls.at(-1)!.prompt, REWRITE);
    assert.equal(on.doc!.sentPrompt, REWRITE);
    assert.equal(on.doc!.studioAudio!.prompt, MUSIC.prompt, "the result keeps the user's text");
    assert.ok(stub.llmSeen[0]!.includes("music generation"), "the kind's own system prompt");
    await buildStudioAudio(tool, { ...MUSIC, aiImprove: false } as never, ctx, {}, deps as never);
    assert.equal(calls.at(-1)!.prompt, MUSIC.prompt);
    assert.equal(stub.llm, 1);
    const sfx = await buildStudioAudio(tool, { ...SFX, aiImprove: true } as never, ctx, { putAsset: async () => "a".repeat(32) }, deps as never);
    assert.deepEqual(calls.slice(-2).map((c) => c.prompt), [REWRITE, REWRITE], "every variant gets the one rewrite");
    assert.equal(stub.llm, 2, "one call for all variants");
    assert.ok(stub.llmSeen[1]!.includes("sound effect"));
    assert.equal(sfx.doc!.sentPrompt, REWRITE);
    const lyrics = { ...MUSIC, prompt: "Qo'shiq matni: bahor keldi, gullar ochildi" };
    await buildStudioAudio(tool, { ...lyrics, aiImprove: true } as never, ctx, {}, deps as never);
    assert.equal(calls.at(-1)!.prompt, lyrics.prompt, "MUTATSIYA: lyrics are the product");
    assert.equal(stub.llm, 2);
  });

  await t.test("never: an avatar's script, an effect and an edit instruction", async () => {
    await reset();
    const me = await mkUser();
    // Any adapter will do: the check is what reaches it and whether the LLM was called.
    const seen: Record<string, unknown>[] = [];
    const adapter = { id: "x", configured: () => true, submit: async (i: { params: Record<string, unknown> }) => (seen.push(i.params), { opId: "op-1" }), poll: async () => ({ status: "pending" }) };
    const script = "Assalomu alaykum, bugun yangi kursimiz haqida gapirib beraman.";
    const id = "11111111-1111-4111-8111-111111111111";
    await query(`INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, status, locked_by, locked_at) VALUES ($1, $2, 'studio-video', 'x', 1000, 'mp4', '{}', 'IN_PROGRESS', 'lease-1', now())`, [id, me]);
    const avatar = MEDIA_CATALOG.byId("heygen/avatar")!;
    await ops.submitStudioVideoJob(
      { id, userId: me, lease: "lease-1", values: { modelId: avatar.id, prompt: script, aiImprove: true, seconds: 10 } as never },
      { studioAdapters: Object.fromEntries(avatar.routes.map((r) => [r.adapter, adapter])) as never },
    );
    assert.equal(stub.llm, 0, "MUTATSIYA: the avatar's words were rewritten");
    assert.equal(seen[0]!.prompt, script);
    // The edit path has no rewrite of its own: the translation stays what it was, nothing reads the switch.
    const edit = MEDIA_CATALOG.byId("bytedance/seedream-edit")!;
    stub.llmAnswer = () => jsonRes({ candidates: [{ content: { parts: [{ text: '{"instruction":"remove the car"}' }] }, finishReason: "STOP" }] });
    await buildStudioTool(TOOL_BY_ID["studio-image"]!, { modelId: edit.id, prompt: "mashinani olib tashla", inputImages: "0123456789abcdef01234567", imageCount: 1, aiImprove: true } as never, edit, "studio.edit", { inputImages: [{ mime: "image/jpeg", base64: JPEG.toString("base64") }] });
    assert.equal(stub.llm, 1, "only its own translation");
    const prompt = String(stub.falImage.at(-1)!.prompt);
    assert.match(prompt, /remove the car/);
    assert.match(prompt, /Change only what the instruction asks for/);
  });

  await t.test("compare: one rewrite for the batch, the same prompt to every model, its cost once; the switch cannot be mixed", async () => {
    await reset();
    const me = await mkUser();
    const A = { modelId: "alibaba/wan-3", prompt: OWN, seconds: 5, resolution: "720p", aspect: "16:9", aiImprove: true };
    const B = { modelId: "minimax/h3", prompt: OWN, aiImprove: true };
    const send = async (members: { values: Record<string, unknown> }[]) => {
      await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%' OR bucket LIKE 'compare:%'");
      const req = new Request("http://localhost/api/studio/compare", { method: "POST", headers: { cookie: await cookieOf(me), "content-type": "application/json" }, body: JSON.stringify({ kind: "video", members }) });
      const r = await inRequest(req, () => compareRoute.POST(req));
      return { status: r.status, body: (await r.json()) as { items?: { id: string }[]; error?: string } };
    };
    const mixed = await send([{ values: A }, { values: { ...B, aiImprove: false } }]);
    assert.equal(mixed.status, 400);
    assert.match(String(mixed.body.error), /bitta so/);
    const r = await send([{ values: A }, { values: B }]);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const [a, b] = await Promise.all([worker.claimNext(), worker.claimNext()]);
    await Promise.all([worker.runJob(a!), worker.runJob(b!)]);
    assert.equal(stub.llm, 1, "MUTATSIYA: each model rewrote on its own");
    assert.deepEqual(stub.submits.map((s) => s.prompt), [REWRITE, REWRITE], "the models compare on one prompt");
    const costs = await Promise.all(r.body.items!.map(async (i) => (await gen(i.id)).cost_json));
    assert.equal(costs.filter((c) => c?.parts.some((p) => p.kind === "llm")).length, 1, "the cost lands once");
  });

  await t.test("restore: a job brought back after a refresh still asks for what it asked for", () => {
    const values = { modelId: "alibaba/wan-3", prompt: OWN, aiImprove: false };
    assert.equal(sentOf(values, values.modelId).aiImprove, false);
    assert.equal(sentOf({ modelId: values.modelId, prompt: OWN }, values.modelId).aiImprove, undefined);
  });
});
