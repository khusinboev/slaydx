import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * STUDIO P9 — Google Lyria as the second «Musiqa» model (docs/studio/P9-SPEC.md): one synchronous call of the Gemini
 * Interactions API on the Gemini key. Stubbed `fetch`: no network, no paid call.
 *
 *   catalog   `google/lyria-3` in `studio.music` (allowed [ElevenLabs, Lyria], ElevenLabs default, user can choose), route
 *             gemini / `studio-gemini-lyria`, per result $0.04 clip | $0.08 song;
 *   golden    the request through the REAL engine (`buildStudioAudio` → `runMedia` → adapter): URL, headers (key only
 *             in `x-goog-api-key`, Api-Revision), body { model by «Turi», input + the instrumental line };
 *   answer    the audio block of `steps[].content[]` is the result (frames checked), lyrics text ignored for the file;
 *             no audio → failure (safety when the text says blocked); 429 / 5xx retryable; 400 policy → safety; our
 *             timeout → accepted; the key never in a message;
 *   probe     every Lyria param changes the request or the price, as its `affects` says;
 *   prices    clip 1 100, song 2 100 at ×2 and 12 700 so'm/$; client == server; tool % on top.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. «Turi» song sends the clip model                                -> «golden», «probe»;
 *   2. the instrumental line dropped                                   -> «golden», «probe»;
 *   3. a non-MP3 audio block accepted                                  -> «answer»;
 *   4. 400 with a policy text not mapped to safety                     -> «answer»;
 *   5. song priced at the clip rate                                    -> «prices», «probe»;
 *   6. the engine runs Lyria without the «Turi» upstream swap          -> «golden»;
 *   7. a 403 «not allowed» mapped to safety                            -> «answer»;
 *   8. the byte cap checked after reading the body                     -> «answer»;
 *   9. the engine ignores the output's `text` (no lyrics on the doc)   -> «lyrics».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const { MEDIA_CATALOG, MEDIA_PURPOSES } = await import("../lib/media/catalog.ts");
const au = await import("../lib/media/catalog-audio.ts");
const rules = await import("../lib/media/studio-audio.ts");
const { studioAudioAdapters } = await import("../lib/media/adapters/audio-studio.ts");
const { LYRIA_ADAPTER_ID, LYRIA_INSTRUMENTAL, LYRIA_URL, LYRICS_MAX_CHARS, lyriaAdapter, lyriaOutput, lyricsOf } = await import("../lib/media/adapters/lyria.ts");
const { buildStudioAudio } = await import("../lib/generation/studio/audio.ts");
const { runMedia } = await import("../lib/server/media/run.ts");
const core = await import("../lib/studio-core/index.ts");
const tools = await import("../lib/tools.ts");
const { applyPriceAdjust } = await import("../lib/price-adjust.ts");
const { audioClientPrice } = await import("../components/studio/audio/audio-api.ts");
const { audioJobLabels, audioModelLabel, offeredModes } = await import("../components/studio/audio/audio-modes.ts");

const LYRIA = "google/lyria-3";
const GKEY = "AIzaTEST_lyria_key_0123456789abcdefgh";
const PRICING = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {}, costUsd: {} };
const TOOL = tools.TOOL_BY_ID["studio-audio"];
const BASE = { modelId: LYRIA, prompt: "cheerful dutar melody, Uzbek folk style", length: "clip", instrumental: false };

function mp3Bytes(frames = 40): Uint8Array {
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}
const answer = (blocks: Record<string, unknown>[], status = 200) =>
  new Response(JSON.stringify({ status: "completed", object: "interaction", steps: blocks.map((b) => ({ type: "model_output", content: [b] })) }), { status, headers: { "content-type": "application/json" } });
const audioBlock = (bytes: Uint8Array = mp3Bytes()) => ({ type: "audio", mime_type: "audio/mpeg", data: Buffer.from(bytes).toString("base64") });
const good = () => answer([{ type: "text", text: "<instrumental>" }, audioBlock()]);
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

type Seen = { url: string; headers: Headers; body: Record<string, unknown> };
function stub(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchImpl = (async (u: string | URL, init: RequestInit = {}) => {
    seen.push({ url: String(u), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const ctx = { input: null, clones: {} };

async function build(values: Record<string, unknown>, respond: () => Response | Promise<Response> = good) {
  const s = stub(respond);
  const routes: string[] = [];
  core.resetBreakers();
  const built = await buildStudioAudio(TOOL, values as never, ctx, {}, {
    adapters: studioAudioAdapters({ key: () => "unused-eleven", lyriaKey: () => GKEY }),
    run: async (i) => {
      const out = await runMedia({ ...i, deps: { fetchImpl: s.fetchImpl } });
      routes.push(out.route ? `${out.route.provider}:${out.route.upstreamModel}` : "?");
      return out;
    },
  });
  return { built, seen: s.seen, routes };
}
const submit = (values: Record<string, unknown>, fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) => {
  const e = MEDIA_CATALOG.byId(LYRIA)!;
  return lyriaAdapter({ key: () => GKEY }).submit!({ upstreamModel: "lyria", params: core.normalize(e.params, values), idempotencyKey: "g:audio:0" }, { fetchImpl, ...extra });
};

test("catalog: Lyria is the second «Musiqa» model on the Gemini key, per result", () => {
  const e = MEDIA_CATALOG.byId(LYRIA)!;
  assert.equal(e.kind, "music");
  assert.equal(e.maker, "Google");
  assert.deepEqual(e.routes, [{ provider: "gemini", upstreamModel: "lyria", adapter: LYRIA_ADAPTER_ID }]);
  assert.deepEqual(e.cost, { per: "output", usd: 0.04, by: { param: "length", table: { clip: 0.04, song: 0.08 } } });
  assert.deepEqual(e.params.map((p) => p.name), ["prompt", "length", "instrumental"]);
  const p = MEDIA_PURPOSES.byId(au.STUDIO_MUSIC_PURPOSE)!;
  assert.deepEqual([p.allowed, p.default, p.userCanChoose], [["elevenlabs/music", LYRIA], "elevenlabs/music", true]);
  assert.equal(rules.studioAudioPurposeOf(LYRIA), "studio.music");
  assert.equal(rules.studioAudioModeOf(LYRIA), "music");
  assert.ok(rules.isStudioAudioModel(LYRIA));
  assert.ok(!("routes" in MEDIA_CATALOG.clientView().find((x) => x.id === LYRIA)!));
});

test("tab: «Musiqa» offers both models (ElevenLabs first = default); the picker names them by maker", () => {
  const view = MEDIA_CATALOG.clientView();
  const both = offeredModes(view.filter((e) => au.AUDIO_MODEL_IDS.includes(e.id)));
  const music = both.find((m) => m.mode === "music")!;
  assert.deepEqual(music.entries.map((e) => e.id), ["elevenlabs/music", LYRIA]);
  assert.equal(music.entry.id, "elevenlabs/music");
  assert.deepEqual(music.entries.map((e) => audioModelLabel(e, "Musiqa")), ["ElevenLabs", "Google Lyria 3"]);
  // Only Lyria listed (no ElevenLabs key): the mode stays, with Lyria as its only model.
  const lyriaOnly = offeredModes(view.filter((e) => e.id === LYRIA)).find((m) => m.mode === "music")!;
  assert.deepEqual([lyriaOnly.entry.id, lyriaOnly.entries.length], [LYRIA, 1]);
  // P11: «Effekt» and «Shovqindan tozalash» gained a fal model each; the voice changer has one.
  assert.deepEqual(both.filter((x) => x.mode !== "music").map((m) => [m.mode, m.entries.length]), [["sfx", 2], ["voice-changer", 1], ["isolate", 2]]);
  // Labels: the button short (the price fits a phone), the results in full; a one-model mode keeps its own name.
  assert.deepEqual(audioJobLabels(music.entries[1]!, "Musiqa", 2), { button: "Lyria 3", job: "Musiqa · Lyria 3" });
  assert.deepEqual(audioJobLabels(music.entries[0]!, "Musiqa", 2), { button: "Musiqa", job: "Musiqa" });
  assert.deepEqual(audioJobLabels(lyriaOnly.entry, "Musiqa", 1), { button: "Musiqa", job: "Musiqa" });
  const sfx = both.find((m) => m.mode === "sfx")!;
  assert.deepEqual(audioJobLabels(sfx.entry, "Effekt", 1), { button: "Effekt", job: "Effekt" }, "«Ovoz effekti» stays «Effekt»");
});

test("golden: the real engine sends ONE Interactions call — key in the header only, model by «Turi», instrumental line", async () => {
  const clip = await build(BASE);
  assert.equal(clip.seen.length, 1);
  const [r] = clip.seen;
  assert.equal(r!.url, LYRIA_URL);
  assert.equal(r!.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(r!.headers.get("x-goog-api-key"), GKEY);
  assert.equal(r!.headers.get("api-revision"), "2026-05-20");
  assert.deepEqual(r!.body, { model: "lyria-3-clip-preview", input: BASE.prompt });
  assert.ok(!JSON.stringify(r!.body).includes(GKEY));
  const song = await build({ ...BASE, length: "song", instrumental: true });
  assert.deepEqual(song.seen[0]!.body, { model: "lyria-3.5", input: `${BASE.prompt}\n\n${LYRIA_INSTRUMENTAL}` }, "MUTATSIYA 1/2");
  assert.equal(LYRIA_INSTRUMENTAL, "Instrumental only, no vocals.");
  // The real upstream model goes into media_jobs / cost_json (review M1), not the family name «lyria».
  assert.deepEqual(clip.routes, ["gemini:lyria-3-clip-preview"]);
  assert.deepEqual(song.routes, ["gemini:lyria-3.5"], "MUTATSIYA 6");
  // The result: the MP3 of the audio block, its measured length, the «Musiqa» mode and the Lyria model.
  assert.equal(clip.built.mime, "audio/mpeg");
  assert.deepEqual([...clip.built.bytes.subarray(0, 2)], [0xff, 0xfb]);
  assert.equal(clip.built.doc!.studioAudio!.mode, "music");
  assert.equal(clip.built.doc!.studioAudio!.model, LYRIA);
  assert.ok(clip.built.doc!.studioAudio!.seconds > 0);
  // «<instrumental>» is no lyrics: nothing stored.
  assert.equal(clip.built.doc!.studioAudio!.lyrics, undefined);
});

test("lyrics: a song's text block is kept on the result (instrumental placeholder dropped, capped)", async () => {
  const words = "[Verse 1]\r\nTongda Registon,\r\noltin nurlar\n\n[Chorus]\nSamarqand!";
  const sung = await build({ ...BASE, length: "song" }, () => answer([{ type: "text", text: words }, audioBlock()]));
  assert.equal(sung.built.doc!.studioAudio!.lyrics, "[Verse 1]\nTongda Registon,\noltin nurlar\n\n[Chorus]\nSamarqand!", "MUTATSIYA 9: lyrics reach the doc");
  assert.equal(lyricsOf("<instrumental>"), null);
  assert.equal(lyricsOf("   "), null);
  assert.equal(lyricsOf("x".repeat(LYRICS_MAX_CHARS + 50))!.length, LYRICS_MAX_CHARS);
});

test("answer: audio block → MP3; no audio / not MP3 → failure; HTTP errors mapped; key scrubbed", async (t) => {
  quiet(t);
  assert.ok(lyriaOutput({ steps: [{ type: "model_output", content: [audioBlock()] }] }).mp3);
  assert.equal(lyriaOutput({ steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/mpeg", data: Buffer.from("not an mp3 at all").toString("base64") }] }] }).mp3, null, "MUTATSIYA 3");
  assert.equal(lyriaOutput({ steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/wav", data: Buffer.from(mp3Bytes()).toString("base64") }] }] }).mp3, null);
  assert.equal(lyriaOutput(null).mp3, null);
  const failOf = async (respond: () => Response | Promise<Response>, extra: Record<string, unknown> = {}) => {
    const s = stub(respond);
    try {
      await submit(BASE, s.fetchImpl, extra);
    } catch (e) {
      assert.ok(e instanceof core.MediaError);
      assert.ok(!e.message.includes(GKEY), "the key never in a message");
      return e;
    }
    return assert.fail("expected a failure");
  };
  const ok = await submit(BASE, stub(good).fetchImpl);
  assert.equal("done" in ok && ok.done[0]!.kind, "inline");
  const noAudio = await failOf(() => answer([{ type: "text", text: "Your prompt was blocked by safety filters." }]));
  assert.deepEqual([noAudio.safety, noAudio.retryable], [true, false]);
  const empty = await failOf(() => answer([{ type: "text", text: "<instrumental>" }]));
  assert.deepEqual([empty.safety, empty.retryable], [false, false]);
  const err = (status: number, message: string) => () => new Response(JSON.stringify({ error: { code: status, message } }), { status });
  const policy = await failOf(err(400, "The prompt violates the content policy (copyrighted lyrics)."));
  assert.deepEqual([policy.status, policy.safety, policy.retryable], [400, true, false], "MUTATSIYA 4");
  const bad = await failOf(err(400, `API key ${GKEY} not valid`));
  assert.deepEqual([bad.safety, bad.retryable], [false, false]);
  const denied = await failOf(err(403, "The Interactions API is not allowed for this project."));
  assert.deepEqual([denied.status, denied.safety, denied.retryable], [403, false, false], "MUTATSIYA 7: a dead key is no content block");
  const huge = await failOf(() => new Response("{}", { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } }));
  assert.equal(huge.accepted, true, "MUTATSIYA 8: a stated size past the cap is refused before reading");
  for (const status of [429, 500, 503]) assert.equal((await failOf(err(status, "busy"))).retryable, true, String(status));
  const down = await failOf(() => {
    throw new TypeError("socket hang up");
  });
  assert.deepEqual([down.retryable, down.accepted], [true, false]);
  const cut = await failOf(() => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  });
  assert.deepEqual([cut.retryable, cut.accepted], [false, true], "our timeout: Google may still bill it");
  // No key: nothing is sent.
  const s = stub(good);
  await assert.rejects(lyriaAdapter({ key: () => "" }).submit!({ upstreamModel: "lyria", params: BASE, idempotencyKey: "k" }, { fetchImpl: s.fetchImpl }), core.MediaError);
  assert.equal(s.seen.length, 0);
});

test("probe: every Lyria param changes the request or the price, as its `affects` says", async () => {
  const e = MEDIA_CATALOG.byId(LYRIA)!;
  const alt: Record<string, unknown> = { prompt: "epic orchestral trailer, big drums", length: "song", instrumental: true };
  const reqOf = async (v: Record<string, unknown>) => JSON.stringify((await build(v)).seen.map((s) => s.body));
  for (const p of e.params) {
    const v2 = { ...BASE, [p.name]: alt[p.name] };
    assert.notDeepEqual(core.normalize(e.params, v2)[p.name], core.normalize(e.params, BASE)[p.name], `${p.name}: the probe value is accepted`);
    const reqChanged = (await reqOf(v2)) !== (await reqOf(BASE));
    const priceChanged = rules.studioAudioPrice(v2, PRICING) !== rules.studioAudioPrice(BASE, PRICING);
    if (p.affects === "request" || p.affects === "both") assert.ok(reqChanged, `${p.name} must change the request`);
    if (p.affects === "price" || p.affects === "both") assert.ok(priceChanged, `${p.name} must change the price`);
  }
});

test("prices: clip 1 100 / song 2 100 (×2, 12 700 so'm/$); client == server; tool % on top; bad «Turi» refused", () => {
  assert.equal(rules.studioAudioPrice(BASE, PRICING), 1_100);
  assert.equal(rules.studioAudioPrice({ ...BASE, length: "song" }, PRICING), 2_100, "MUTATSIYA 5");
  assert.equal(rules.studioAudioPrice({ ...BASE, length: "song", instrumental: true }, PRICING), 2_100);
  assert.equal(rules.studioAudioPrice({ ...BASE, length: "song" }, { ...PRICING, overrides: { [LYRIA]: { markup: 3 } } }), 3_100);
  const view = MEDIA_CATALOG.clientView().find((x) => x.id === LYRIA)!;
  for (const length of ["clip", "song"]) {
    for (const pricing of [PRICING, { ...PRICING, markup: 2.5 }]) {
      const values = { ...BASE, length };
      const server = tools.basePriceFor(TOOL, values as never, pricing);
      assert.equal(audioClientPrice(view, values, pricing, undefined), server);
      assert.equal(server, rules.studioAudioPrice(values, pricing));
      const adj = { percent: 150, roundTo: 500 as const };
      assert.equal(audioClientPrice(view, values, pricing, adj), applyPriceAdjust(server, adj));
    }
  }
  assert.ok(rules.studioAudioError({ ...BASE, length: "60" }), "an ElevenLabs length is not a Lyria «Turi»");
  assert.ok(rules.studioAudioError({ ...BASE, prompt: "abc" }));
  assert.equal(rules.studioAudioError(BASE), null);
});
