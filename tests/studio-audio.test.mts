import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * Studio P6 «Audio» — pure parts (docs/studio/P6-SPEC.md). No DB, no network (every provider call is a stubbed fetch).
 *
 *   catalog     four entries (music / sfx / voice changer / isolator), four purposes with one model each, the Creator-plan
 *               credit rates ($22 / 121 000 credits): 15 / s, 40 / s, 1 000 / min, 1 000 / min;
 *   request     golden requests through the REAL adapters: /v1/music JSON, /v1/sound-generation JSON, speech-to-speech
 *               multipart (voice in the URL, model, noise flag, the input file), audio-isolation multipart;
 *   probe       «every param must work»: each param of each «Audio» model changes the provider request or the price, as
 *               its `affects` says (through the REAL engine → runMedia → adapter, fetch stubbed);
 *   price       the P6-SPEC so'm table at ×2 / 12 700 so'm per $ (rounded UP to 100), variants × price, billed seconds
 *               rounded up, client preview == server price (× override × `tool_pricing` %);
 *   refusals    `studioAudioError` before charging: prompt too short / too long, duration / length / influence / variants
 *               out of range, no or malformed input id, unknown voice, malformed clone, unknown model; upload bounds;
 *   engine      a missing input / clone fails WITHOUT a provider call; a clone speaks with ITS provider id and is touched;
 *               SFX 3 of 4 variants → `delivered` {3, 4} + 3 stored assets; none → failure; the prompt is redacted in
 *               `media_jobs`, the input never part of the stored params; `toolBlockedReason` follows the model list.
 *
 * Mutations (each turned the named test red, then restored):
 *   `force_instrumental` always false in `audioRequest("music")`               -> "golden: music", "probe";
 *   `loop` dropped from the SFX body                                            -> "golden: sfx", "probe";
 *   STS `remove_background_noise` always "false"                                -> "golden: voice changer", "probe";
 *   SFX cost without `countParam: "variants"`                                   -> "price goldens", "probe";
 *   `MUSIC_CREDITS_PER_SECOND` 900 / 60 → 1 000 / 60                             -> "price goldens";
 *   `billedSeconds` → `Math.round`                                              -> "billed seconds";
 *   prompt max check dropped from `studioAudioError`                            -> "refusals";
 *   input id check dropped from `studioAudioError`                              -> "refusals";
 *   engine ignores `ctx.input === null` (sends no file)                          -> "engine: missing input";
 *   engine stops at the first failed variant                                    -> "engine: SFX variants";
 *   `redact: ["prompt"]` dropped                                                -> "engine: telemetry";
 *   `studio-audio` branch removed from `toolBlockedReason`                       -> "toolBlockedReason".
 *
 * P7c (provider cost into the job meter -> cost_json / ai_usage; tests "cost: …"), each turned red, then restored:
 *   `recordAudioCall` removed from the engine loop                               -> "cost: each delivered call", "cost: SFX 3 of 4";
 *   the call recorded with `p` (all variants) instead of the one-clip values     -> "cost: SFX 3 of 4" (0.436364 not 0.109091);
 *   a failed call recorded (call in the `catch`)                                 -> "cost: SFX 3 of 4";
 *   only the first clip recorded (`if (i === 0)`)                                -> "cost: each delivered call", "cost: SFX 3 of 4".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const cat = await import("../lib/media/catalog.ts");
const au = await import("../lib/media/catalog-audio.ts");
const rules = await import("../lib/media/studio-audio.ts");
const { studioAudioAdapters, audioRequest } = await import("../lib/media/adapters/audio-studio.ts");
const { buildStudioAudio } = await import("../lib/generation/studio/audio.ts");
const { runMedia } = await import("../lib/server/media/run.ts");
const core = await import("../lib/studio-core/index.ts");
const { ELEVENLABS_CREATOR_USD_PER_CREDIT } = await import("../lib/generation/llm-pricing.ts");
const tools = await import("../lib/tools.ts");
const { applyPriceAdjust } = await import("../lib/price-adjust.ts");
const { audioClientPrice } = await import("../components/studio/audio/audio-api.ts");
const { audioInputError } = await import("../lib/server/media/audio-inputs.ts");
const { CHAT_EXCLUDED_TOOLS } = await import("../lib/server/chat/toolspec.ts");
const { UserFacingError } = await import("../lib/server/user-error.ts");

const { MEDIA_CATALOG, MEDIA_PURPOSES } = cat;
const KEY = "sk_test_STUDIO_AUDIO_0123456789";
const MUSIC = "elevenlabs/music";
const SFX = "elevenlabs/sfx";
const STS = "elevenlabs/voice-changer";
const ISO = "elevenlabs/isolator";
const RACHEL = "21m00Tcm4TlvDq8ikWAM";
const ADAM = "pNInz6obpgDQGcFmaJgB";
const INPUT_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const INPUT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const CLONE_ID = "0e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a";
const PRICING = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {}, costUsd: {} };
const TOOL = tools.TOOL_BY_ID["studio-audio"];

function mp3Bytes(frames = 40): Uint8Array {
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}
const audio = () => new Response(Buffer.from(mp3Bytes()), { status: 200, headers: { "content-type": "audio/mpeg" } });
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

type Seen = { url: string; method: string; body: unknown };
/** A FormData as comparable data: fields as strings, files as `{ file: name, type, size, head }`. */
async function formOf(f: FormData): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of f.entries()) {
    if (typeof v === "string") out[k] = v;
    else out[k] = { file: (v as File).name, type: v.type, size: v.size, head: [...new Uint8Array(await v.arrayBuffer()).subarray(0, 4)] };
  }
  return out;
}
function stub(respond: (s: Seen, n: number) => Response) {
  const seen: Promise<Seen>[] = [];
  const fetchImpl = (async (u: string | URL, init: RequestInit = {}) => {
    const p = (async (): Promise<Seen> => ({
      url: String(u),
      method: String(init.method ?? "GET"),
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body instanceof FormData ? await formOf(init.body) : null,
    }))();
    seen.push(p);
    return respond(await p, seen.length);
  }) as unknown as typeof fetch;
  return { fetchImpl, seen: () => Promise.all(seen) };
}

/** The worker's view as `studioAudioJobCtx` builds it: the input row the id names (bytes differ per id), the owner's clone. */
function ctxOf(values: Record<string, unknown>, touched: string[] = []) {
  const id = String(values.inputId ?? "");
  const bytes = id === INPUT_A ? new Uint8Array([1, 2, 3, 4, 5, 6]) : id === INPUT_B ? new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]) : null;
  return {
    input: bytes ? { mime: "audio/wav", base64: Buffer.from(bytes).toString("base64"), seconds: Number(values.inputSeconds) || 3 } : null,
    clones: { [CLONE_ID]: { providerVoiceId: "ClonedVoice0001abcd", name: "Mening ovozim" } },
    touch: async (ids: readonly string[]) => void touched.push(...ids),
  };
}

/** The real engine with stubbed providers: every fetch it makes, for these values. */
async function requestsOf(values: Record<string, unknown>): Promise<Seen[]> {
  const { fetchImpl, seen } = stub(() => audio());
  core.resetBreakers();
  await buildStudioAudio(TOOL, values as never, ctxOf(values), { putAsset: async () => "f".repeat(24) }, {
    adapters: studioAudioAdapters({ key: () => KEY }),
    run: (i) => runMedia({ ...i, deps: { fetchImpl } }),
  });
  return seen();
}

const BASE: Record<string, Record<string, unknown>> = {
  [MUSIC]: { modelId: MUSIC, prompt: "calm lo-fi piano, rainy evening", length: "30", instrumental: false },
  [SFX]: { modelId: SFX, prompt: "door creaks open", duration: 5, influence: "0.5", loop: false, variants: 1 },
  [STS]: { modelId: STS, inputId: INPUT_A, inputSeconds: 10, voice: RACHEL, removeNoise: false },
  [ISO]: { modelId: ISO, inputId: INPUT_A, inputSeconds: 10 },
};
const OTHER: Record<string, unknown> = {
  modelId: undefined,
  prompt: "epic orchestral trailer, big drums",
  length: "60",
  instrumental: true,
  duration: 7,
  influence: "0.8",
  loop: true,
  variants: 2,
  inputId: INPUT_B,
  inputSeconds: 61,
  voice: ADAM,
  removeNoise: true,
};

/* ───────────────────────── catalog ───────────────────────── */

test("catalog: four entries, one model per purpose, Creator-plan credit rates", () => {
  assert.deepEqual(au.AUDIO_MODES.map((m) => [m.mode, m.label, m.model, m.purpose]), [
    ["music", "Musiqa", MUSIC, "studio.music"],
    ["sfx", "Effekt", SFX, "studio.sfx"],
    ["voice-changer", "Ovozni almashtirish", STS, "studio.voice-changer"],
    ["isolate", "Shovqindan tozalash", ISO, "studio.isolate"],
  ]);
  for (const m of au.AUDIO_MODES) {
    const p = MEDIA_PURPOSES.byId(m.purpose)!;
    assert.deepEqual([p.allowed, p.default, p.userCanChoose], [[m.model], m.model, false]);
    const e = MEDIA_CATALOG.byId(m.model)!;
    assert.equal(e.routes[0]!.provider, "elevenlabs");
    assert.equal(e.cost.per, "second");
  }
  assert.equal(ELEVENLABS_CREATOR_USD_PER_CREDIT, 22 / 121_000);
  const usd = (id: string) => (MEDIA_CATALOG.byId(id)!.cost as { usd: number }).usd;
  assert.equal(usd(MUSIC), 15 * ELEVENLABS_CREATOR_USD_PER_CREDIT);
  assert.equal(usd(SFX), 40 * ELEVENLABS_CREATOR_USD_PER_CREDIT);
  assert.equal(usd(STS), (1000 / 60) * ELEVENLABS_CREATOR_USD_PER_CREDIT);
  assert.equal(usd(ISO), (1000 / 60) * ELEVENLABS_CREATOR_USD_PER_CREDIT);
  assert.deepEqual(MEDIA_CATALOG.byId(MUSIC)!.params.map((p) => p.name), ["prompt", "length", "instrumental"]);
  assert.deepEqual(MEDIA_CATALOG.byId(SFX)!.params.map((p) => p.name), ["prompt", "duration", "influence", "loop", "variants"]);
  assert.deepEqual(MEDIA_CATALOG.byId(STS)!.params.map((p) => p.name), ["inputId", "inputSeconds", "voice", "removeNoise"]);
  assert.deepEqual(MEDIA_CATALOG.byId(ISO)!.params.map((p) => p.name), ["inputId", "inputSeconds"]);
  // The tool: unlisted (sold inside the Studio), mp3, out of the AI chat.
  assert.ok(tools.UNLISTED_TOOL_IDS.has("studio-audio"));
  assert.equal(TOOL.output, "mp3");
  assert.ok(CHAT_EXCLUDED_TOOLS.includes("studio-audio"));
});

/* ───────────────────────── golden requests ───────────────────────── */

test("golden: music", async () => {
  const [r] = await requestsOf({ ...BASE[MUSIC], instrumental: true, length: "90" });
  assert.equal(r!.url, "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128");
  assert.deepEqual(r!.body, { prompt: "calm lo-fi piano, rainy evening", music_length_ms: 90_000, force_instrumental: true, model_id: "music_v1" });
});

test("golden: sfx (one call per variant)", async () => {
  const seen = await requestsOf({ ...BASE[SFX], loop: true, influence: "0.3", duration: 12, variants: 2 });
  assert.equal(seen.length, 2);
  for (const r of seen) {
    assert.equal(r.url, "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128");
    assert.deepEqual(r.body, { text: "door creaks open", duration_seconds: 12, prompt_influence: 0.3, loop: true, model_id: "eleven_text_to_sound_v2" });
  }
});

test("golden: voice changer and isolator (multipart, the input file, voice in the URL)", async () => {
  const [v] = await requestsOf({ ...BASE[STS], removeNoise: true });
  assert.equal(v!.url, `https://api.elevenlabs.io/v1/speech-to-speech/${RACHEL}?output_format=mp3_44100_128`);
  assert.deepEqual(v!.body, { audio: { file: "input.wav", type: "audio/wav", size: 6, head: [1, 2, 3, 4] }, model_id: "eleven_multilingual_sts_v2", remove_background_noise: "true" });
  const [i] = await requestsOf(BASE[ISO]!);
  assert.equal(i!.url, "https://api.elevenlabs.io/v1/audio-isolation?output_format=mp3_44100_128");
  assert.deepEqual(i!.body, { audio: { file: "input.wav", type: "audio/wav", size: 6, head: [1, 2, 3, 4] } });
  // The pure request never carries the bytes (only the type and size).
  const pure = audioRequest("isolate", { params: {}, assets: { audio: [{ mime: "audio/wav", base64: "AQIDBAUG" }] } });
  assert.deepEqual(pure.form, { fields: {}, file: { mime: "audio/wav", bytes: 6 } });
});

/* ───────────────────────── probe ───────────────────────── */

test("probe: every param of every «Audio» model changes the request or the price (as `affects` says)", async (t) => {
  quiet(t);
  for (const [id, base] of Object.entries(BASE)) {
    const entry = MEDIA_CATALOG.byId(id)!;
    const baseReq = JSON.stringify(await requestsOf(base));
    const basePrice = rules.studioAudioPrice(base, PRICING);
    for (const p of entry.params) {
      const v = OTHER[p.name];
      assert.ok(v !== undefined, `${id}.${p.name}: no probe value`);
      const changed = { ...base, [p.name]: v };
      assert.equal(rules.studioAudioError(changed), null, `${id}.${p.name}: probe value must be valid`);
      const req = JSON.stringify(await requestsOf(changed));
      const price = rules.studioAudioPrice(changed, PRICING);
      if (p.affects !== "price") assert.notEqual(req, baseReq, `${id}.${p.name} must change the request`);
      if (p.affects !== "request") assert.notEqual(price, basePrice, `${id}.${p.name} must change the price`);
    }
  }
});

/* ───────────────────────── price ───────────────────────── */

test("price goldens: the P6-SPEC table (×2, 12 700 so'm/$, up to 100)", () => {
  const p = (v: Record<string, unknown>) => rules.studioAudioPrice(v, PRICING);
  assert.equal(p({ modelId: MUSIC, length: "30" }), 2_100);
  assert.equal(p({ modelId: MUSIC, length: "60" }), 4_200);
  assert.equal(p({ modelId: MUSIC, length: "180" }), 12_500);
  assert.equal(p({ modelId: SFX, duration: 5 }), 1_000);
  assert.equal(p({ modelId: SFX, duration: 30 }), 5_600);
  // Variants: that many clips — 3 × 5 s = 600 credits ≈ $0.1091 → 2 770.9 → 2 800.
  assert.equal(p({ modelId: SFX, duration: 5, variants: 3 }), 2_800);
  assert.equal(p({ modelId: STS, inputSeconds: 60 }), 4_700);
  assert.equal(p({ modelId: ISO, inputSeconds: 60 }), 4_700);
  // Blank model = «Musiqa» at its default 30 s (the tool's «… dan» base price).
  assert.equal(p({}), 2_100);
  assert.equal(TOOL.basePrice, 2_100);
  // Model override and the tool's % on top.
  assert.equal(rules.studioAudioPrice({ modelId: MUSIC, length: "60" }, { ...PRICING, overrides: { [MUSIC]: { markup: 3 } } }), 6_300);
  assert.equal(applyPriceAdjust(p({ modelId: MUSIC, length: "60" })!, { percent: 150, roundTo: 100 }), 6_300);
  assert.equal(rules.studioAudioPrice({ modelId: "elevenlabs/eleven-v3", text: "x" }, PRICING), null, "a non-«Audio» model is not priced here");
});

test("billed seconds: the measured input rounded UP to the whole second", () => {
  assert.equal(rules.billedSeconds(59.2), 60);
  assert.equal(rules.billedSeconds(60.005), 60, "10 ms of frame quantization is not a second");
  assert.equal(rules.billedSeconds(60.02), 61);
  assert.equal(rules.billedSeconds(3), 3);
  assert.equal(rules.billedSeconds(0), 0);
});

test("client preview == server price (per mode × values × override × %)", () => {
  const client = new Map(MEDIA_CATALOG.clientView().map((e) => [e.id, e]));
  const cases: Record<string, unknown>[] = [
    BASE[MUSIC]!,
    { ...BASE[MUSIC], length: "180" },
    BASE[SFX]!,
    { ...BASE[SFX], duration: 30, variants: 4 },
    BASE[STS]!,
    { ...BASE[STS], inputSeconds: 299 },
    BASE[ISO]!,
    { ...BASE[ISO], inputSeconds: 4 },
  ];
  for (const values of cases) {
    const id = String(values.modelId);
    for (const pricing of [PRICING, { ...PRICING, markup: 2.5, overrides: { [id]: { markup: 4 } } }]) {
      for (const adj of [undefined, { percent: 80, roundTo: 500 as const }]) {
        const server = applyPriceAdjust(tools.basePriceFor(TOOL, values as never, pricing), adj);
        assert.equal(audioClientPrice(client.get(id)!, values, pricing, adj), server, `${id} ${JSON.stringify(values)}`);
      }
    }
  }
});

/* ───────────────────────── refusals ───────────────────────── */

test("refusals: studioAudioError says why BEFORE charging", () => {
  const e = rules.studioAudioError;
  for (const v of Object.values(BASE)) assert.equal(e(v), null, JSON.stringify(v));
  assert.match(String(e({ modelId: "x/unknown" })), /Noma'lum audio/);
  assert.match(String(e({ ...BASE[MUSIC], prompt: "lofi" })), /kamida 5/);
  assert.match(String(e({ ...BASE[MUSIC], prompt: "a".repeat(2001) })), /juda uzun/);
  assert.match(String(e({ ...BASE[SFX], prompt: "ab" })), /kamida 3/);
  assert.match(String(e({ ...BASE[SFX], prompt: "a".repeat(451) })), /juda uzun/);
  assert.match(String(e({ ...BASE[MUSIC], length: "45" })), /noma'lum/);
  assert.match(String(e({ ...BASE[SFX], duration: 0 })), /1–30/);
  assert.match(String(e({ ...BASE[SFX], duration: 31 })), /1–30/);
  assert.match(String(e({ ...BASE[SFX], influence: "0.4" })), /noma'lum/);
  assert.match(String(e({ ...BASE[SFX], variants: 5 })), /1–4/);
  assert.match(String(e({ ...BASE[STS], inputId: "" })), /audio faylni yuklang/);
  assert.match(String(e({ ...BASE[ISO], inputId: "ZZZZZZZZZZZZZZZZZZZZZZZZ" })), /audio faylni yuklang/);
  assert.match(String(e({ ...BASE[STS], inputSeconds: 2 })), /3–300/);
  assert.match(String(e({ ...BASE[STS], inputSeconds: 301 })), /3–300/);
  assert.match(String(e({ ...BASE[STS], voice: "Kore" })), /Noma'lum ovoz/);
  assert.match(String(e({ ...BASE[STS], voice: "clone:not-a-uuid" })), /topilmadi/);
  assert.equal(e({ ...BASE[STS], voice: `clone:${CLONE_ID}` }), null, "a well-formed clone reference (ownership is the server's SQL check)");
  // The route's preflight is this function.
  assert.equal(tools.preflightError(TOOL, { ...BASE[SFX], duration: 31 } as never), e({ ...BASE[SFX], duration: 31 }));
});

test("upload bounds: WAV / MP3, 3–300 billed seconds", () => {
  assert.equal(audioInputError(null)?.status, 415);
  assert.equal(audioInputError({ mime: "audio/wav", seconds: 2.5 })?.status, 422);
  assert.equal(audioInputError({ mime: "audio/wav", seconds: 2.995 }), null, "rounds up to 3 s");
  assert.equal(audioInputError({ mime: "audio/mpeg", seconds: 300 }), null);
  assert.equal(audioInputError({ mime: "audio/mpeg", seconds: 300.5 })?.status, 422);
});

/* ───────────────────────── engine ───────────────────────── */

test("engine: a missing input or clone fails before any provider call (refund)", async (t) => {
  quiet(t);
  const { fetchImpl, seen } = stub(() => audio());
  const deps = { adapters: studioAudioAdapters({ key: () => KEY }), run: (i: Parameters<typeof runMedia>[0]) => runMedia({ ...i, deps: { fetchImpl } }) };
  await assert.rejects(buildStudioAudio(TOOL, BASE[ISO] as never, { input: null, clones: {} }, {}, deps), (e: unknown) => e instanceof UserFacingError && /audio topilmadi/.test(e.message));
  await assert.rejects(
    buildStudioAudio(TOOL, { ...BASE[STS], voice: `clone:${CLONE_ID}` } as never, { ...ctxOf(BASE[STS]!), clones: {} }, {}, deps),
    (e: unknown) => e instanceof UserFacingError && /ovoz topilmadi/.test(e.message),
  );
  assert.equal((await seen()).length, 0, "no provider call");
});

test("engine: a clone speaks with ITS provider id and is touched; the doc names it", async (t) => {
  quiet(t);
  const { fetchImpl, seen } = stub(() => audio());
  const touched: string[] = [];
  const values = { ...BASE[STS], voice: `clone:${CLONE_ID}` };
  const out = await buildStudioAudio(TOOL, values as never, ctxOf(values, touched), {}, { adapters: studioAudioAdapters({ key: () => KEY }), run: (i) => runMedia({ ...i, deps: { fetchImpl } }) });
  assert.equal((await seen())[0]!.url, "https://api.elevenlabs.io/v1/speech-to-speech/ClonedVoice0001abcd?output_format=mp3_44100_128");
  assert.deepEqual(touched, [CLONE_ID]);
  assert.equal(out.mime, "audio/mpeg");
  assert.deepEqual(out.doc.studioAudio, { mode: "voice-changer", model: STS, seconds: out.doc.studioAudio!.seconds, prompt: null, inputSeconds: 10, voices: ["Mening ovozim"], clone: true, variants: [] });
  assert.ok(!JSON.stringify(out.doc).includes("ClonedVoice"), "the provider id of a clone is never stored in the doc");
});

test("engine: SFX variants — 3 of 4 delivered → `delivered` {3, 4}, 3 assets; none → failure", async (t) => {
  quiet(t);
  const assets: Uint8Array[] = [];
  const putAsset = async (b: Uint8Array) => {
    assets.push(b);
    return String(assets.length).repeat(24);
  };
  const run3 = stub((_s, n) => (n === 2 ? new Response("boom", { status: 400 }) : audio()));
  const out = await buildStudioAudio(TOOL, { ...BASE[SFX], variants: 4 } as never, { input: null, clones: {} }, { putAsset }, {
    adapters: studioAudioAdapters({ key: () => KEY }),
    run: (i) => runMedia({ ...i, deps: { fetchImpl: run3.fetchImpl } }),
  });
  assert.equal((await run3.seen()).length, 4, "the other variants still ran after one failed");
  assert.deepEqual(out.delivered, { got: 3, want: 4 });
  assert.equal(assets.length, 3);
  assert.equal(out.doc.studioAudio!.variants.length, 3);
  const none = stub(() => new Response("boom", { status: 400 }));
  await assert.rejects(
    buildStudioAudio(TOOL, { ...BASE[SFX], variants: 2 } as never, { input: null, clones: {} }, { putAsset }, { adapters: studioAudioAdapters({ key: () => KEY }), run: (i) => runMedia({ ...i, deps: { fetchImpl: none.fetchImpl } }) }),
    (e: unknown) => e instanceof UserFacingError && /Kredit qaytariladi/.test(e.message),
  );
  // One clip asked: a full delivery has no `delivered` and stores no extra asset.
  const before = assets.length;
  const one = await requestsOf(BASE[SFX]!);
  assert.equal(one.length, 1);
  assert.equal(assets.length, before);
});

test("engine: telemetry — the prompt is redacted in media_jobs; the input travels as an asset, never a param", async (t) => {
  quiet(t);
  const calls: Parameters<typeof runMedia>[0][] = [];
  const { fetchImpl } = stub(() => audio());
  const run = (i: Parameters<typeof runMedia>[0]) => {
    calls.push(i);
    return runMedia({ ...i, deps: { fetchImpl } });
  };
  await buildStudioAudio(TOOL, BASE[MUSIC] as never, { input: null, clones: {} }, {}, { adapters: studioAudioAdapters({ key: () => KEY }), run });
  assert.deepEqual(calls[0]!.redact, ["prompt"]);
  assert.equal(calls[0]!.purpose, "studio.music");
  await buildStudioAudio(TOOL, BASE[ISO] as never, ctxOf(BASE[ISO]!), {}, { adapters: studioAudioAdapters({ key: () => KEY }), run });
  const iso = calls[1]!;
  assert.equal(iso.purpose, "studio.isolate");
  assert.ok(iso.assets?.audio?.[0]?.base64, "the input is an asset");
  assert.ok(!JSON.stringify(iso.values).includes(iso.assets!.audio![0]!.base64), "no bytes in the stored params");
});

test("toolBlockedReason: «Audio» follows its own model list", () => {
  assert.equal(tools.toolBlockedReason(TOOL, { studioAudioModels: [] } as never), "Audio xizmati hozircha mavjud emas.");
  assert.equal(tools.toolBlockedReason(TOOL, { studioAudioModels: [MUSIC] } as never), null);
  assert.equal(tools.toolBlockedReason(TOOL, { ttsPremium: true } as never), null, "an older server: the ElevenLabs flag");
  assert.ok(tools.toolBlockedReason(TOOL, { llm: false } as never), "an older server with nothing configured: blocked");
});

/* ───────────────────────── P7c: provider cost telemetry ───────────────────────── */

const usd6 = (n: number) => Number(n.toFixed(6));
/** What `credits` ElevenLabs credits cost on the owner's Creator plan. */
const creditsUsd = (credits: number) => credits * ELEVENLABS_CREATOR_USD_PER_CREDIT;

/** Runs the real engine inside a job meter; returns what the worker would put in `cost_json` (also after a throw). */
async function costOf(values: Record<string, unknown>, respond: (s: Seen, n: number) => Response = () => audio()) {
  const { trackJobCost } = await import("../lib/generation/job-cost.ts");
  const { fetchImpl } = stub(respond);
  const priced: number[] = [];
  core.resetBreakers();
  const tracked = trackJobCost(() =>
    buildStudioAudio(TOOL, values as never, ctxOf(values), { putAsset: async () => "f".repeat(24) }, {
      adapters: studioAudioAdapters({ key: () => KEY }),
      run: (i) => {
        // What `runMedia` stores as this call's `media_jobs.cost_usd`: the SAME values priced with the catalog rule.
        const entry = MEDIA_CATALOG.byId(i.modelId)!;
        priced.push(core.costUsd(entry.cost, core.normalize(entry.params, i.values)));
        return runMedia({ ...i, deps: { fetchImpl } });
      },
    }),
  );
  const built = await tracked.promise.then(
    (b) => ({ ok: true as const, b }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  return { built, cost: tracked.snapshot().toJson(), priced };
}

test("cost: each delivered call is one `audio` entry priced as its media_jobs.cost_usd (music, effect, voice changer, isolator)", async (t) => {
  quiet(t);
  // Music: 30 s × 15 credits / s, ONE call.
  const music = await costOf(BASE[MUSIC]!);
  assert.equal(music.built.ok, true);
  const musicUsd = creditsUsd(30 * 15);
  assert.deepEqual(music.cost.parts, [{ kind: "audio", provider: "elevenlabs", model: "music_v1", calls: 1, inputTokens: 0, outputTokens: 0, units: 30, usd: usd6(musicUsd) }]);
  assert.equal(music.cost.usd, usd6(musicUsd));
  assert.equal(music.cost.calls, 1);
  assert.deepEqual(music.priced, [musicUsd], "the same number runMedia writes to media_jobs");

  // Effect: ONE clip per call (5 s × 40 credits); four variants delivered = four clips, never 4 × 4 and never 1.
  const sfx = await costOf({ ...BASE[SFX], variants: 4 });
  const clip = creditsUsd(5 * 40);
  assert.deepEqual(sfx.cost.parts, [{ kind: "audio", provider: "elevenlabs", model: "eleven_text_to_sound_v2", calls: 4, inputTokens: 0, outputTokens: 0, units: 20, usd: usd6(4 * clip) }]);
  assert.deepEqual(sfx.priced, [clip, clip, clip, clip]);

  // Voice changer / isolator: priced on the server-measured input seconds (10 s × 1 000 credits / min).
  const sts = await costOf(BASE[STS]!);
  assert.deepEqual(sts.cost.parts, [{ kind: "audio", provider: "elevenlabs", model: "eleven_multilingual_sts_v2", calls: 1, inputTokens: 0, outputTokens: 0, units: 10, usd: usd6(creditsUsd((10 * 1000) / 60)) }]);
  const iso = await costOf(BASE[ISO]!);
  assert.deepEqual(iso.cost.parts, [{ kind: "audio", provider: "elevenlabs", model: "audio-isolation", calls: 1, inputTokens: 0, outputTokens: 0, units: 10, usd: usd6(creditsUsd((10 * 1000) / 60)) }]);
  // A longer input is a bigger bill: the cost follows `inputSeconds`, not a constant.
  const iso61 = await costOf({ ...BASE[ISO], inputSeconds: 61 });
  assert.equal(iso61.cost.usd, usd6(creditsUsd((61 * 1000) / 60)));
});

test("cost: SFX 3 of 4 delivered -> three clips recorded; a failed call, or a lone failure, records nothing", async (t) => {
  quiet(t);
  const clip = creditsUsd(5 * 40);
  const three = await costOf({ ...BASE[SFX], variants: 4 }, (_s, n) => (n === 2 ? new Response("boom", { status: 400 }) : audio()));
  assert.equal(three.built.ok, true);
  assert.deepEqual(three.built.ok && three.built.b.delivered, { got: 3, want: 4 });
  assert.equal(three.priced.length, 4, "four calls were made");
  assert.equal(three.cost.calls, 3, "the failed variant must not be recorded");
  assert.equal(three.cost.parts![0]!.units, 15);
  assert.equal(three.cost.usd, usd6(3 * clip));

  // Every call fails: the job fails (refund), nothing delivered, nothing recorded.
  const none = await costOf({ ...BASE[SFX], variants: 2 }, () => new Response("boom", { status: 400 }));
  assert.equal(none.built.ok, false);
  assert.equal(none.cost.calls, 0);
  assert.deepEqual(none.cost.parts, []);
  assert.equal(none.cost.usd, 0);

  // One clip asked and the provider fails: the same.
  const lone = await costOf(BASE[MUSIC]!, () => new Response("boom", { status: 500 }));
  assert.equal(lone.built.ok, false);
  assert.equal(lone.cost.calls, 0);
});

test("cost: with no job meter (previews, scripts) recording is a no-op and the engine is unaffected", async (t) => {
  quiet(t);
  const { currentJobCost } = await import("../lib/generation/job-cost.ts");
  const { fetchImpl } = stub(() => audio());
  core.resetBreakers();
  const out = await buildStudioAudio(TOOL, BASE[MUSIC] as never, { input: null, clones: {} }, {}, { adapters: studioAudioAdapters({ key: () => KEY }), run: (i) => runMedia({ ...i, deps: { fetchImpl } }) });
  assert.equal(out.mime, "audio/mpeg");
  assert.equal(currentJobCost(), undefined);
});
