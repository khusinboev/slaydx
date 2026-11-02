import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * Studio P5 «Ovoz» — pure parts (docs/studio/P5-SPEC.md). No DB, no network (every provider call is a stubbed fetch).
 *
 *   catalog     the five P5 entries + purposes `studio.speech` / `studio.clone`; costs from the price book (ElevenLabs
 *               Creator plan $22 / 121 000 credits ≈ $0.1818 / 1 000 chars (owner 2026-11-02), Gemini Flash TTS quote); the ElevenLabs language list = the adapter's;
 *   request     golden bodies: ElevenLabs TTS (voice in the URL, eleven_v3, language, speed, stability), text-to-dialogue
 *               (one input per turn), the IVC multipart form; the Gemini single / two-speaker bodies;
 *   probe       «every param must work»: each param of each speech model changes the provider request or the price,
 *               as its `affects` says (through the REAL engine → runMedia → adapter, fetch stubbed);
 *   errors      429 / 5xx retryable, 401 / 402 not, a timeout `accepted`, a 200 that is not audio refused, a clone answer
 *               without `voice_id` `accepted` (the voice may exist);
 *   price       goldens (chars × model × markup, rounded up to 100; override; `tool_pricing` %), the clone's fixed price,
 *               client preview == server price;
 *   rules       dialogue grammar, `studioSpeechError` (unknown model / voice, malformed clone id, two equal voices), the
 *               4 000-character cap = `sanitizeValues`' field cap, sample sniffing + length bounds, the browser WAV
 *               encoder, `toolBlockedReason`.
 *
 * Mutations (each turned the named test red, then restored):
 *   `voice_settings.stability` dropped from `elevenLabsStudioBody`            -> "golden: ElevenLabs TTS", "probe";
 *   dialogue input voice from `voiceId` → always voice1                       -> "golden: dialogue", "probe";
 *   `language_code` never sent                                               -> "probe" (lang);
 *   speech cost reads `text` for the dialogue (`textParam: "text"`)           -> "price goldens" (dialogue);
 *   `roundUpTo` → `Math.round` in the shared formula                           -> "price goldens";
 *   clone price ignores the setting (`STUDIO_CLONE_PRICE_DEFAULT` only)        -> "price: clone";
 *   `toSpeechError` accepted on every error                                    -> "errors";
 *   clone adapter accepts a non-string voice_id                               -> "errors: clone";
 *   `sniffAudio` MP3 frame minimum removed (≥ 10)                              -> "sniff";
 *   `CLONE_SAMPLE_MIN_SECONDS` check removed from `sampleError`               -> "sniff";
 *   `parseDialogue` accepts three speakers                                     -> "dialogue grammar";
 *   review M1: `spokenOverLimit` dropped from `studioSpeechError`              -> "review M1";
 *   review M1: the engine's over-limit check dropped                          -> "review M1" (the provider was called);
 *   review M1: `doc.speech.chars` = the whole script                          -> "review M1";
 *   review m4: `voiceOf` reads the untrimmed value                            -> "review m4".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const cat = await import("../lib/media/catalog.ts");
const sp = await import("../lib/media/catalog-speech.ts");
const rules = await import("../lib/media/studio-speech.ts");
const el = await import("../lib/generation/tts/elevenlabs.ts");
const { makeGeminiTts } = await import("../lib/generation/tts/gemini.ts");
const { studioSpeechAdapters, studioElevenRequest, cloneAdapter } = await import("../lib/media/adapters/speech-studio.ts");
const { buildStudioSpeech } = await import("../lib/generation/studio/speech.ts");
const { runMedia } = await import("../lib/server/media/run.ts");
const core = await import("../lib/studio-core/index.ts");
const { TTS_PRICING } = await import("../lib/generation/llm-pricing.ts");
const tools = await import("../lib/tools.ts");
const { applyPriceAdjust } = await import("../lib/price-adjust.ts");
const { sanitizeValues } = await import("../lib/server/validate.ts");
const { sniffAudio, sampleError } = await import("../lib/server/media/voices.ts");
const { encodeWav, mixToMono, looksLikeMp3 } = await import("../components/studio/voice/wav.ts");
const { speechClientPrice, cloneClientPrice } = await import("../components/studio/voice/voice-price.ts");
const { wavInfo, wavSeconds } = await import("../lib/generation/tts/mp3.ts");

const { MEDIA_CATALOG, MEDIA_PURPOSES } = cat;
const KEY = "sk_test_STUDIO_ELEVEN_0123456789";
const EL_TTS = "elevenlabs/eleven-v3";
const EL_DIA = "elevenlabs/v3-dialogue";
const GM_TTS = "google/gemini-tts";
const GM_DIA = "google/gemini-dialogue";
const CLONE = "elevenlabs/voice-clone";
const RACHEL = "21m00Tcm4TlvDq8ikWAM";
const ADAM = "pNInz6obpgDQGcFmaJgB";
const PRICING = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {}, costUsd: {} };

/** `frames` MPEG-1 Layer III 44.1 kHz 128 kbps frames (417 bytes, 1152 samples each): a valid MP3 for `mp3Seconds`. */
export function mp3Bytes(frames = 40): Uint8Array {
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}
const mp3Of = (seconds: number) => mp3Bytes(Math.ceil((seconds * 44_100) / 1152));

type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
function stub(respond: (s: Seen, n: number) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = (async (u: string | URL, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body instanceof FormData ? init.body : null;
    const s: Seen = { url: String(u), method: String(init.method ?? "GET"), headers: { ...((init.headers ?? {}) as Record<string, string>) }, body };
    seen.push(s);
    return respond(s, seen.length);
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const audio = () => new Response(Buffer.from(mp3Bytes()), { status: 200, headers: { "content-type": "audio/mpeg" } });
const geminiAudio = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(9600).toString("base64"), mimeType: "audio/L16;codec=pcm;rate=24000" } }] } }] }), { status: 200 });
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

/** The real engine with stubbed providers: every fetch it makes, for these values. */
async function requestsOf(values: Record<string, unknown>): Promise<Seen[]> {
  const { fetchImpl, seen } = stub((s) => (s.url.includes("generativelanguage") ? geminiAudio() : audio()));
  const adapters = studioSpeechAdapters({ key: () => KEY, gemini: makeGeminiTts({ fetchImpl, key: () => "gem-key", model: () => "gemini-2.5-flash-preview-tts" }) });
  core.resetBreakers();
  await buildStudioSpeech(tools.TOOL_BY_ID["studio-speech"], values as never, { clones: {} }, {}, { adapters, run: (i) => runMedia({ ...i, deps: { fetchImpl } }) });
  return seen.map((s) => ({ ...s, headers: {} }));
}

/* ───────────────────────── catalog ───────────────────────── */

test("catalog: the P5 entries, their purposes and price-book costs", () => {
  assert.deepEqual(MEDIA_PURPOSES.byId("studio.speech")!.allowed, [EL_TTS, GM_TTS, EL_DIA, GM_DIA]);
  assert.equal(MEDIA_PURPOSES.byId("studio.speech")!.default, EL_TTS);
  assert.deepEqual(MEDIA_PURPOSES.byId("studio.clone")!.allowed, [CLONE]);
  for (const id of [EL_TTS, GM_TTS, EL_DIA, GM_DIA, CLONE]) assert.equal(MEDIA_CATALOG.byId(id)!.kind, "speech", id);
  const row = TTS_PRICING.find((r) => r.provider === "elevenlabs" && r.billing === "chars") as { usdPerMChars: number };
  // Owner 2026-11-02: the REAL Creator-plan cost ($22 / 121 000 credits, 1 credit per eleven_v3 character), not the $0.08 list price.
  assert.equal(row.usdPerMChars, (22 / 121_000) * 1_000_000, "ElevenLabs Creator plan ≈ $181.82 / 1M characters");
  for (const id of [EL_TTS, EL_DIA]) assert.equal((MEDIA_CATALOG.byId(id)!.cost as { usd: number }).usd, 22 / 121, `${id}: $0.1818 / 1 000 characters`);
  // Gemini Flash TTS: 1 000 chars / 15 chars/s × 25 tokens/s × $10/M + 1 000/3 text tokens × $0.50/M.
  assert.equal(sp.geminiUsdPerKchar(), 0.016833);
  assert.equal((MEDIA_CATALOG.byId(EL_DIA)!.cost as { textParam: string }).textParam, "script");
  assert.deepEqual(MEDIA_CATALOG.byId(CLONE)!.cost, { per: "job", usd: 0 });
  // The podcast's own speech entries are untouched (their behaviour must stay byte-identical).
  assert.deepEqual(MEDIA_CATALOG.byId("elevenlabs/tts")!.params.map((p) => p.name), ["text", "voice"]);
  assert.deepEqual(MEDIA_PURPOSES.byId("podcast.voice")!.allowed, ["azure/tts", "aisha/tts", "google/tts", "elevenlabs/tts"]);
});

test("catalog: ElevenLabs language list = the adapter's eleven_v3 list; voices; clone ids", () => {
  assert.deepEqual(sp.ELEVENLABS_LANGS.map((l) => l.value).sort(), [...el.ELEVENLABS_V3_LANGS].sort());
  assert.equal(sp.ELEVENLABS_VOICES[0]!.id, RACHEL);
  assert.ok(sp.ELEVENLABS_VOICES.some((v) => v.gender === "male") && sp.GEMINI_VOICES.some((v) => v.gender === "female"));
  assert.equal(sp.cloneIdOf("clone:0e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a"), "0e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a");
  assert.equal(sp.cloneIdOf("clone:../../x"), null);
  assert.equal(sp.cloneIdOf(RACHEL), null);
});

/* ───────────────────────── golden requests ───────────────────────── */

test("golden: ElevenLabs TTS body / URL", () => {
  const p = core.normalize(MEDIA_CATALOG.byId(EL_TTS)!.params, { text: "Salom", voice: RACHEL, speed: "1.2", stability: "0", lang: "ru" });
  const r = studioElevenRequest("tts", { params: { ...p, voice: RACHEL } });
  assert.equal(r.url, `https://api.elevenlabs.io/v1/text-to-speech/${RACHEL}?output_format=mp3_44100_128`);
  assert.deepEqual(r.body, { text: "Salom", model_id: "eleven_v3", language_code: "ru", voice_settings: { stability: 0, speed: 1.2 } });
  const d = studioElevenRequest("tts", { params: core.normalize(MEDIA_CATALOG.byId(EL_TTS)!.params, { text: "Salom" }) });
  assert.deepEqual(d.body, { text: "Salom", model_id: "eleven_v3", language_code: "uz", voice_settings: { stability: 0.5 } }, "defaults: Uzbek, Natural");
  assert.ok(!JSON.stringify(r).includes(KEY), "no key in the pure request");
});

test("golden: ElevenLabs text-to-dialogue body", () => {
  const turns = JSON.stringify([
    { text: "Salom!", voiceId: RACHEL },
    { text: "Assalomu alaykum.", voiceId: ADAM },
  ]);
  const r = studioElevenRequest("dialogue", { params: { turns, stability: "1", lang: "uz" } });
  assert.equal(r.url, "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128");
  assert.deepEqual(r.body, {
    inputs: [
      { text: "Salom!", voice_id: RACHEL },
      { text: "Assalomu alaykum.", voice_id: ADAM },
    ],
    model_id: "eleven_v3",
    language_code: "uz",
    settings: { stability: 1 },
  });
});

test("golden: IVC multipart form; the podcast body is unchanged", async () => {
  const form = el.elevenLabsCloneForm({ name: "Mening ovozim", sample: new Uint8Array([1, 2, 3]), mime: "audio/wav", fileName: "sample.wav" });
  assert.equal(form.get("name"), "Mening ovozim");
  assert.equal(form.get("remove_background_noise"), "false");
  const f = form.get("files") as File;
  assert.equal(f.name, "sample.wav");
  assert.equal(f.type, "audio/wav");
  assert.deepEqual([...new Uint8Array(await f.arrayBuffer())], [1, 2, 3]);
  // The premium voice of the podcast keeps its own body (no stability, speed only when asked).
  assert.deepEqual(el.elevenLabsBody("Salom", { lang: "uz" }), { text: "Salom", model_id: "eleven_v3", language_code: "uz" });
});

test("golden: Gemini single and two-speaker requests through the engine", async () => {
  const one = await requestsOf({ modelId: GM_TTS, text: "Salom dunyo", voice: "Puck" });
  assert.equal(one.length, 1);
  assert.match(one[0]!.url, /models\/gemini-2\.5-flash-preview-tts:generateContent$/);
  assert.deepEqual((one[0]!.body as { generationConfig: unknown }).generationConfig, { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } });
  const two = await requestsOf({ modelId: GM_DIA, script: "Ali: Salom!\nVali: Assalomu alaykum.", voice1: "Kore", voice2: "Charon" });
  const b = two[0]!.body as { contents: { parts: { text: string }[] }[]; generationConfig: { speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: { speaker: string; voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }[] } } } };
  assert.deepEqual(
    b.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs.map((s) => [s.speaker, s.voiceConfig.prebuiltVoiceConfig.voiceName]),
    [
      ["Speaker1", "Kore"],
      ["Speaker2", "Charon"],
    ],
  );
  assert.match(b.contents[0]!.parts[0]!.text, /Speaker1: Salom!\nSpeaker2: Assalomu alaykum\./);
});

/* ───────────────────────── differential probe ───────────────────────── */

const BASE: Record<string, Record<string, unknown>> = {
  [EL_TTS]: { modelId: EL_TTS, text: "Salom dunyo", voice: RACHEL, speed: "1", stability: "0.5", lang: "uz" },
  [GM_TTS]: { modelId: GM_TTS, text: "Salom dunyo", voice: "Kore" },
  [EL_DIA]: { modelId: EL_DIA, script: "Ali: Salom!\nVali: Xayr!", voice1: RACHEL, voice2: ADAM, stability: "0.5", lang: "uz" },
  [GM_DIA]: { modelId: GM_DIA, script: "Ali: Salom!\nVali: Xayr!", voice1: "Kore", voice2: "Charon" },
};
const OTHER: Record<string, unknown> = {
  text: `Boshqa matn, uzunroq — narx ham o'zgaradi. ${"Ovoz ".repeat(120)}`,
  script: `Ali: Salom, bugun ob-havo juda yaxshi! ${"Ha ".repeat(150)}\nVali: Ha, sayrga chiqamiz.`,
  voice: "voice-other",
  voice1: "voice-other",
  voice2: "voice-other",
  speed: "0.8",
  stability: "1",
  lang: "ru",
};

test("probe: every param of every speech model changes the request or the price (as `affects` says)", async (t) => {
  quiet(t);
  for (const [id, base] of Object.entries(BASE)) {
    const entry = MEDIA_CATALOG.byId(id)!;
    const eleven = id.startsWith("elevenlabs/");
    const baseReq = JSON.stringify(await requestsOf(base));
    const basePrice = rules.studioSpeechPrice(base, PRICING);
    for (const p of entry.params) {
      let v = OTHER[p.name];
      // Another library voice that keeps the two speakers distinct (Sarah / Puck).
      if (/^voice\d$/.test(p.name)) v = eleven ? sp.ELEVENLABS_VOICES[1]!.id : "Puck";
      if (p.name === "voice") v = eleven ? ADAM : "Puck";
      assert.ok(v !== undefined, `${id}.${p.name}: no probe value`);
      const changed = { ...base, [p.name]: v };
      assert.equal(rules.studioSpeechError(changed), null, `${id}.${p.name}: probe value must be valid`);
      const req = JSON.stringify(await requestsOf(changed));
      const price = rules.studioSpeechPrice(changed, PRICING);
      if (p.affects !== "price") assert.notEqual(req, baseReq, `${id}.${p.name} must change the request`);
      if (p.affects !== "request") assert.notEqual(price, basePrice, `${id}.${p.name} must change the price`);
    }
  }
});

/* ───────────────────────── errors ───────────────────────── */

async function failOf(respond: (s: Seen) => Response, kind: "tts" | "clone" = "tts") {
  const { fetchImpl } = stub(respond);
  const input = {
    upstreamModel: "eleven_v3",
    params: { text: "Salom", voice: RACHEL, name: "Men" },
    idempotencyKey: "g:speech:0",
    assets: { sample: [{ mime: "audio/wav", base64: "AAAA" }] },
  };
  const a = kind === "clone" ? cloneAdapter({ key: () => KEY }) : studioSpeechAdapters({ key: () => KEY })["studio-elevenlabs-tts"]!;
  try {
    await a.submit(input as never, { fetchImpl });
  } catch (e) {
    assert.ok(e instanceof core.MediaError, String(e));
    return e as InstanceType<typeof core.MediaError>;
  }
  assert.fail("expected a failure");
}

test("errors: status → retryable / accepted; the key never leaks", async () => {
  const r429 = await failOf(() => new Response(`{"detail":"rate ${KEY}"}`, { status: 429 }));
  assert.equal(r429.retryable, true);
  assert.equal(r429.accepted, false);
  assert.ok(!r429.message.includes(KEY), "key scrubbed");
  const r500 = await failOf(() => new Response("x", { status: 503 }));
  assert.equal(r500.retryable, true);
  for (const s of [400, 401, 402, 422]) {
    const e = await failOf(() => new Response("{}", { status: s }));
    assert.equal(e.retryable, false, String(s));
    assert.equal(e.accepted, false, String(s));
    assert.equal(e.status, s);
  }
  const timeout = await failOf(() => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  assert.equal(timeout.retryable, true);
  assert.equal(timeout.accepted, true, "a call that timed out may have been billed: never a second route");
  const notAudio = await failOf(() => new Response("<html>ok</html>", { status: 200 }));
  assert.equal(notAudio.retryable, false);
});

test("errors: clone answer without a voice_id is accepted (the voice may exist); a good one returns it", async () => {
  const bad = await failOf(() => new Response(JSON.stringify({ voice_id: 42 }), { status: 200 }), "clone");
  assert.equal(bad.accepted, true);
  const { fetchImpl, seen } = stub(() => new Response(JSON.stringify({ voice_id: "VoiceAbc12345", requires_verification: false }), { status: 200 }));
  const out = await cloneAdapter({ key: () => KEY }).submit({ upstreamModel: "ivc", params: { name: "Men" }, idempotencyKey: "g:clone:0", assets: { sample: [{ mime: "audio/wav", base64: Buffer.from("RIFF").toString("base64") }] } }, { fetchImpl });
  assert.ok("done" in out);
  const o = out.done[0]!;
  assert.equal(o.kind === "inline" ? new TextDecoder().decode(o.bytes) : "", '{"voice_id":"VoiceAbc12345"}');
  assert.equal(seen[0]!.url, "https://api.elevenlabs.io/v1/voices/add");
  assert.equal(seen[0]!.method, "POST");
  assert.ok(seen[0]!.body instanceof FormData);
});

/* ───────────────────────── price ───────────────────────── */

test("price goldens: characters × model × markup, rounded UP to 100; override; tool_pricing %", () => {
  const k = "x".repeat(1000);
  assert.equal(rules.studioSpeechPrice({ modelId: EL_TTS, text: k }, PRICING), 4700, "0.181818 × 12 700 × 2 = 4 618.2 → 4 700 (Creator plan)");
  assert.equal(rules.studioSpeechPrice({ modelId: EL_TTS, text: "x" }, PRICING), 100, "one character still costs a step");
  assert.equal(rules.studioSpeechPrice({ modelId: EL_TTS, text: "x".repeat(140) }, PRICING), 700, "140 characters: 646.5 → 700");
  assert.equal(rules.studioSpeechPrice({ modelId: GM_TTS, text: k }, PRICING), 500, "0.016833 × 25 400 = 427.6 → 500");
  assert.equal(rules.studioSpeechPrice({ modelId: EL_DIA, script: `A: ${"x".repeat(497)}\nB: ${"y".repeat(497)}` }, PRICING), 4700, "the script's 1 000 normalized characters");
  // Whitespace runs collapse before pricing (the server sees the same text).
  assert.equal(rules.studioSpeechPrice({ modelId: EL_TTS, text: `${"x".repeat(500)}      \n\n${"x".repeat(499)}` }, PRICING), 4700);
  assert.equal(rules.studioSpeechPrice({ modelId: EL_TTS, text: k }, { ...PRICING, overrides: { [EL_TTS]: { markup: 3 } } }), 7000, "the model's markup wins: 6 927.3 → 7 000");
  assert.equal(rules.studioSpeechPrice({ modelId: "elevenlabs/tts", text: k }, PRICING), null, "not a Studio model");
  const adj = { percent: 150, roundTo: 100 as const };
  assert.equal(tools.basePriceFor(tools.TOOL_BY_ID["studio-speech"], { modelId: EL_TTS, text: k }, PRICING), 4700);
  assert.equal(applyPriceAdjust(4700, adj), 7100);
});

test("price: clone is the fixed setting (+ its tool %), never cost × markup", () => {
  const voice = tools.TOOL_BY_ID["studio-voice"];
  assert.equal(tools.basePriceFor(voice, {}, { ...PRICING, clonePrice: 7000 }), 7000);
  assert.equal(tools.basePriceFor(voice, {}, PRICING), 5000, "default 5 000 (owner 2026-11-02)");
  assert.equal(rules.clonePriceOf(7000), 7000);
  for (const bad of ["7000", 50, 0, -1, 2_000_000, 1234.5, null]) assert.equal(rules.clonePriceOf(bad), 5000, String(bad));
  assert.equal(cloneClientPrice(5000, { percent: 120, roundTo: 500 }), 6000);
});

test("client preview == server price (per model × text × override × %)", () => {
  const client = new Map(MEDIA_CATALOG.clientView().map((e) => [e.id, e]));
  const texts = ["Salom", "x".repeat(333), "y".repeat(3999)];
  for (const id of [EL_TTS, GM_TTS, EL_DIA, GM_DIA]) {
    for (const t of texts) {
      for (const pricing of [PRICING, { ...PRICING, markup: 2.5, overrides: { [id]: { markup: 4 } } }]) {
        for (const adj of [undefined, { percent: 80, roundTo: 500 as const }]) {
          const field = id.endsWith("-dialogue") ? "script" : "text";
          const values = { modelId: id, [field]: field === "script" ? `A: ${t.slice(0, 900)}\nB: ok` : t };
          const server = applyPriceAdjust(tools.basePriceFor(tools.TOOL_BY_ID["studio-speech"], values as never, pricing), adj);
          assert.equal(speechClientPrice(client.get(id)!, values, pricing, adj), server, `${id} ${t.length}`);
        }
      }
    }
  }
});

/* ───────────────────────── rules ───────────────────────── */

test("dialogue grammar", () => {
  const d = rules.parseDialogue("Ali: Salom!\n  davomi shu\nMalika: Assalomu alaykum.\nali: Yana men");
  assert.ok(typeof d !== "string");
  assert.deepEqual(d.speakers, ["Ali", "Malika"]);
  assert.deepEqual(d.turns, [
    { speaker: 0, text: "Salom! davomi shu" },
    { speaker: 1, text: "Assalomu alaykum." },
    { speaker: 0, text: "Yana men" },
  ]);
  assert.match(String(rules.parseDialogue("Salom hammaga")), /Ism: gap/);
  assert.match(String(rules.parseDialogue("Ali: bir\nAli: ikki")), /ikki kishi/);
  assert.match(String(rules.parseDialogue("A: 1\nB: 2\nC: 3")), /faqat ikki/);
  // A colon inside a long sentence is not a speaker («Masalan bu juda uzun gap: …» has more than three words).
  const long = rules.parseDialogue("Ali: Salom\nVali: Ha\nMasalan bu juda uzun gap: davomi");
  assert.ok(typeof long !== "string");
  assert.equal(long.turns.at(-1)!.text, "Ha Masalan bu juda uzun gap: davomi");
});

test("studioSpeechError: refused before charging", () => {
  assert.equal(rules.studioSpeechError(BASE[EL_TTS]!), null);
  assert.equal(rules.studioSpeechError({ ...BASE[EL_TTS], voice: "clone:0e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a" }), null, "a well-formed clone ref (ownership is the server's SQL)");
  assert.match(String(rules.studioSpeechError({ ...BASE[EL_TTS], modelId: "elevenlabs/tts" })), /Noma'lum ovoz modeli/);
  assert.match(String(rules.studioSpeechError({ ...BASE[EL_TTS], voice: "Kore" })), /Noma'lum ovoz/, "a Gemini voice on ElevenLabs");
  assert.match(String(rules.studioSpeechError({ ...BASE[GM_TTS], voice: RACHEL })), /noma'lum qiymat|Noma'lum ovoz/);
  assert.match(String(rules.studioSpeechError({ ...BASE[EL_TTS], voice: "clone:not-a-uuid" })), /topilmadi/);
  assert.match(String(rules.studioSpeechError({ ...BASE[EL_TTS], speed: "3" })), /noma'lum qiymat/);
  assert.match(String(rules.studioSpeechError({ ...BASE[EL_TTS], text: "   " })), /kamida 1/);
  assert.match(String(rules.studioSpeechError({ ...BASE[EL_DIA], voice2: RACHEL })), /ikki xil ovoz/);
  assert.match(String(rules.studioSpeechError({ ...BASE[EL_DIA], script: "A: 1\nB: 2\nC: 3" })), /faqat ikki/);
  assert.ok(tools.preflightError(tools.TOOL_BY_ID["studio-speech"], { ...BASE[EL_TTS], voice: "Kore" } as never));
});

test("review M1: a text / script over the model's limit is refused before charging AND never spoken", async (t) => {
  quiet(t);
  const long = (n: number) => `Ali: ${"a".repeat(Math.ceil(n / 2))}\nVali: ${"b".repeat(n)}`;
  // ElevenLabs dialogue: ≤ 2 000 normalized characters (names included, as priced).
  assert.match(String(rules.studioSpeechError({ ...BASE[EL_DIA], script: long(2000) })), /Matn juda uzun: eng ko‘pi 2 000 belgi/);
  assert.match(String(rules.studioSpeechError({ ...BASE[EL_TTS], text: "x".repeat(4001) })), /eng ko‘pi 4 000 belgi/);
  assert.equal(rules.studioSpeechError({ ...BASE[EL_TTS], text: "x".repeat(4000) }), null, "exactly the limit is fine");
  assert.match(String(rules.studioSpeechError({ ...BASE[GM_DIA], script: long(1000) })), /1 400/);
  // The engine re-checks (a job row written by an older route): refused, nothing sent, full refund.
  const { fetchImpl, seen } = stub(() => audio());
  const adapters = studioSpeechAdapters({ key: () => KEY });
  await assert.rejects(
    buildStudioSpeech(tools.TOOL_BY_ID["studio-speech"], { ...BASE[EL_DIA], script: long(2000) } as never, { clones: {} }, {}, { adapters, run: (i) => runMedia({ ...i, deps: { fetchImpl } }) }),
    /Matn juda uzun.*Kredit qaytariladi/,
  );
  assert.equal(seen.length, 0, "MUTATSIYA: over-limit script reached the provider");
  // At the limit: what is sent is the turns' text, ≤ max, and `doc.speech.chars` counts exactly that.
  const fit = `Ali: ${"a".repeat(900)}\nVali: ${"b".repeat(1080)}`;
  assert.equal(rules.studioSpeechError({ ...BASE[EL_DIA], script: fit }), null);
  const sent = stub(() => audio());
  const built = await buildStudioSpeech(tools.TOOL_BY_ID["studio-speech"], { ...BASE[EL_DIA], script: fit } as never, { clones: {} }, {}, { adapters, run: (i) => runMedia({ ...i, deps: { fetchImpl: sent.fetchImpl } }) });
  const inputs = (sent.seen[0]!.body as { inputs: { text: string }[] }).inputs;
  const total = inputs.reduce((n, x) => n + x.text.length, 0);
  assert.equal(total, 1980);
  assert.ok(total <= 2000);
  assert.equal(built.doc.speech!.chars, 1980, "chars = what was sent");
});

test("review m4: the worker uses the trimmed voice value (a padded library id still speaks)", async (t) => {
  quiet(t);
  const r = await requestsOf({ ...BASE[EL_TTS], voice: `  ${ADAM}  ` });
  assert.equal(r[0]!.url, `https://api.elevenlabs.io/v1/text-to-speech/${ADAM}?output_format=mp3_44100_128`);
  assert.equal(rules.studioSpeechError({ ...BASE[EL_TTS], voice: `  ${ADAM}  ` }), null, "the route accepts the same value");
});

test("4 000 characters: the speech cap is exactly what the form-field sanitizer keeps", () => {
  assert.equal(sp.STUDIO_SPEECH_MAX_CHARS, 4000);
  assert.equal((MEDIA_CATALOG.byId(EL_TTS)!.params[0] as { max: number }).max, 4000);
  assert.equal(String(sanitizeValues({ text: "x".repeat(4000) })!.text).length, 4000, "nothing cut at the cap");
  assert.ok(String(sanitizeValues({ text: "x".repeat(4001) })!.text).length <= 4000, "the sanitizer cuts above it (a bigger cap would price differently)");
  assert.equal(sp.ELEVENLABS_DIALOGUE_MAX_CHARS, 2000, "text-to-dialogue documented limit");
});

test("sniff: WAV / MP3 by their bytes, 30–180 s; anything else refused", () => {
  const wav30 = encodeWav(new Float32Array(24_000 * 30));
  assert.deepEqual(sniffAudio(wav30), { mime: "audio/wav", seconds: 30 });
  assert.equal(sampleError(sniffAudio(wav30)), null);
  const short = sampleError(sniffAudio(encodeWav(new Float32Array(24_000 * 29))));
  assert.equal(short?.status, 422);
  assert.match(String(short?.message), /kamida 30 soniya/);
  assert.equal(sampleError(sniffAudio(encodeWav(new Float32Array(24_000 * 181))))?.status, 422);
  const mp3 = sniffAudio(mp3Of(40));
  assert.equal(mp3?.mime, "audio/mpeg");
  assert.ok(Math.abs(mp3!.seconds - 40) < 0.1);
  assert.equal(sniffAudio(mp3Bytes(3)), null, "a few stray frames are not a recording");
  assert.equal(sniffAudio(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(500).fill(1)])), null, "WebM is converted by the browser, never accepted raw");
  assert.equal(sampleError(null)?.status, 415);
});

test("browser WAV encoder: mono mix, resample, header the server reads", () => {
  const left = new Float32Array(48_000).fill(0.5);
  const right = new Float32Array(48_000).fill(-0.5);
  const mono = mixToMono([left, right], 48_000);
  assert.equal(mono.length, 24_000);
  assert.ok(Math.abs(mono[100]!) < 1e-6, "channels averaged");
  const wav = encodeWav(mono);
  assert.deepEqual(wavInfo(wav), { sampleRate: 24_000, channels: 1, bits: 16, dataOffset: 44, dataLength: 48_000 });
  assert.equal(wavSeconds(wav), 1);
  assert.equal(looksLikeMp3(mp3Bytes(1)), true);
  assert.equal(looksLikeMp3(new Uint8Array([0x49, 0x44, 0x33, 4])), true);
  assert.equal(looksLikeMp3(wav), false);
});

test("admin: the ElevenLabs «Tekshirish» line shows the voice slots the clones take", async () => {
  const { elevenLabsMessage } = await import("../lib/server/providers/probe.ts");
  const msg = elevenLabsMessage({ tier: "starter", character_count: 1000, character_limit: 30000, voice_slots_used: 3, voice_limit: 10 });
  assert.match(msg, /ovoz slotlari: 3 \/ 10 band/);
  assert.ok(!elevenLabsMessage({ tier: "starter" }).includes("slot"), "no slot line when the answer has none");
  assert.deepEqual(el.elevenLabsSlotsOf({ voice_slots_used: 3, voice_limit: 10, can_use_instant_voice_cloning: false }), { used: 3, limit: 10, canClone: false });
  assert.equal(el.elevenLabsSlotsOf({ voice_limit: 10 }), null);
});

test("toolBlockedReason: the «Ovoz» tools follow their own model list", () => {
  const speech = tools.TOOL_BY_ID["studio-speech"];
  const clone = tools.TOOL_BY_ID["studio-voice"];
  assert.ok(tools.toolBlockedReason(speech, { llm: true, images: true, studioSpeechModels: [] }), "switch off / no model → blocked");
  assert.equal(tools.toolBlockedReason(speech, { llm: false, images: false, studioSpeechModels: [EL_TTS] }), null, "no text key needed");
  assert.ok(tools.toolBlockedReason(clone, { llm: true, images: true, studioSpeechModels: [] }));
  assert.ok(tools.UNLISTED_TOOL_IDS.has("studio-speech") && tools.UNLISTED_TOOL_IDS.has("studio-voice"), "sold inside the Studio only");
});
