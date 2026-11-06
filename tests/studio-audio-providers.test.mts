import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Studio P11 package E: the fal audio models (docs/studio/P11-SPEC.md). No network and no database: every fal call is a
 * stubbed `fetch`, the dub's `media_jobs` side an injected store. The real-worker path is `studio-audio-providers-flow`.
 *
 *   catalog    seven entries, all `defaultOff`, fal only, each purpose keeps its default, each route has an adapter;
 *   price      the page's prices to the cent, whole-minute billing with its minimum, client == server;
 *   golden     each endpoint's exact body; Scribe's language codes; HeyGen's enum names;
 *   probe      EVERY param of the seven entries changes the request or the price, and the probe list equals the schema;
 *   storage    the two-step upload, no key on the PUT, the expiry, the constant name, failures never `accepted`, a private
 *              upload host refused, the file deleted after the call whatever happened;
 *   adapter    answers mapped, a lying content type beaten by the sniff, safety, an unusable answer stays `accepted`;
 *   engines    a video reaches Scribe as its audio track, VEED's WAV becomes the MP3, the dub's exactly-once row on fal,
 *              HeyGen's cost on the delivered seconds, its refusal of an audio source;
 *   glue       the picker's helpers, session availability on the fal model alone.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `billed()` returns the seconds unchanged                                  -> "price";
 *   2. the `Math.max(1, …)` minimum dropped (a price of 0 units)                 -> "cost rule";
 *   3. `tag_audio_events` false removed from Scribe                              -> "golden: Scribe";
 *   4. Scribe sends the two-letter code                                          -> "golden: Scribe";
 *   5. the answer's three-letter code not mapped back                            -> "adapter: Scribe";
 *   6. `enable_dynamic_duration` false removed                                   -> "golden: dubbing";
 *   7. the PUT carries the key                                                   -> "storage: upload";
 *   8. the expiry header dropped from the initiate                               -> "storage: upload";
 *   9. `assertPublicHttpsUrl` removed from the upload                            -> "storage: failures";
 *  10. `deleteFalFile` removed from the `finally` of `submit`                    -> "storage: delete";
 *  11. the sniff replaced by trusting the answer (`checkOutput` skipped)         -> "adapter: sniff";
 *  12. the fal `cancel` no longer deletes the upload                             -> "dub engine";
 *  13. the resume branch of the dub uploads again                                -> "dub engine: resume";
 *  14. a fal video goes to Scribe whole (no audio track)                         -> "transcribe engine";
 *  15. `clipOf` keeps the WAV                                                    -> "audio engine";
 *  16. HeyGen's cost recorded on the source seconds                              -> "dub engine: HeyGen";
 *  17. the video-only check removed from `studioDubError`                        -> "rules";
 *  18. Adam left in the fal voice list                                           -> "voices";
 *  19. `speechToolOffered` looks at the default model only                       -> "glue";
 *  20. `pickSpeechModel` keeps an audio source on HeyGen                         -> "glue".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
delete process.env.FAL_KEY;
delete process.env.ELEVENLABS_API_KEY;

const cat = await import("../lib/media/catalog-transcribe.ts");
const au = await import("../lib/media/catalog-audio.ts");
const sp = await import("../lib/media/catalog-speech.ts");
const rules = await import("../lib/media/studio-transcribe.ts");
const speechRules = await import("../lib/media/studio-speech.ts");
const models = await import("../lib/media/adapters/fal-audio-models.ts");
const storage = await import("../lib/media/adapters/fal-storage.ts");
const { falAdapter, parseFalVideoOp } = await import("../lib/media/adapters/fal.ts");
const { falDubAdapter, falDubOutput } = await import("../lib/media/adapters/fal-dub.ts");
const { transcribeAdapters } = await import("../lib/media/adapters/transcribe-studio.ts");
const { studioAudioAdapters } = await import("../lib/media/adapters/audio-studio.ts");
const { studioSpeechAdapters } = await import("../lib/media/adapters/speech-studio.ts");
const { MEDIA_CATALOG, MEDIA_PURPOSES } = await import("../lib/media/catalog.ts");
const { studioEntryPrice } = await import("../lib/media/studio-pricing.ts");
const { MediaError, costUsd, normalize, resetBreakers } = await import("../lib/studio-core/index.ts");
const { UserFacingError } = await import("../lib/server/user-error.ts");
const tools = await import("../lib/tools.ts");
const { pcmToWav, mp3Seconds } = await import("../lib/generation/tts/mp3.ts");
const { audioTrackArgs, AUDIO_TRACK_FILES } = await import("../lib/generation/studio/burn-args.ts");
const { buildStudioTranscribe } = await import("../lib/generation/studio/transcribe.ts");
const { buildStudioAudio } = await import("../lib/generation/studio/audio.ts");
const { buildStudioSpeech } = await import("../lib/generation/studio/speech.ts");
const dubMod = await import("../lib/generation/studio/dub.ts");
const jobCost = await import("../lib/generation/job-cost.ts");
const glue = await import("../components/studio/audio/speech-tool-api.ts");

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const ffSkip = HAS_FFMPEG ? false : "ffmpeg not installed on this machine";

const KEY = "fal0000-test-key:5ecr3t5ecr3t";
const SIG = "sig=PRESIGNED5ECRET";
const UPLOAD_URL = `https://v3.fal.media/upload/abc?${SIG}`;
const FILE_URL = "https://v3b.fal.media/files/b/0a/input.bin";
const REQ = "req-0123456789";
const RES = "result:11111111-1111-4111-8111-111111111111";
const RES2 = "result:22222222-2222-4222-8222-222222222222";
const UP = "upload:" + "a".repeat(24);
const PRICING = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {}, costUsd: {} };
const RACHEL = sp.ELEVENLABS_VOICES.find((v) => v.name === "Rachel")!.id;
const ADAM = sp.ELEVENLABS_VOICES.find((v) => v.name === "Adam")!.id;
const lookup = async () => ["93.184.216.34"];
const entry = (id: string) => MEDIA_CATALOG.byId(id)!;
const clientOf = (id: string) => MEDIA_CATALOG.clientView().find((e) => e.id === id)!;
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

const IDS = [cat.FAL_SCRIBE_MODEL, cat.FAL_DUB_MODEL, cat.HEYGEN_TRANSLATE_MODEL, au.FAL_SFX_MODEL, au.VEED_CLEAN_MODEL, sp.FAL_ELEVEN_V3_MODEL, sp.FAL_ELEVEN_V4_TURBO_MODEL];

function mp3Bytes(frames = 80): Uint8Array {
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}
const wavBytes = (seconds = 1) => pcmToWav(new Uint8Array(48_000 * 2 * seconds), { sampleRate: 48_000 });
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const assetOf = (mime: string, bytes: Uint8Array) => ({ mime, base64: b64(bytes) });
let VIDEO: Uint8Array | null = null;
function videoMp4(): Uint8Array {
  if (VIDEO) return VIDEO;
  const dir = mkdtempSync(path.join(tmpdir(), "p11-e-"));
  try {
    const f = path.join(dir, "v.mp4");
    const r = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:size=64x48:rate=6", "-f", "lavfi", "-i", "sine", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f]);
    assert.equal(r.status, 0);
    return (VIDEO = new Uint8Array(readFileSync(f)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ───────────────────────── a fake fal ───────────────────────── */

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; redirect?: string };
type FakeOpts = {
  result?: unknown;
  resultStatus?: number;
  status?: () => Record<string, unknown>;
  download?: Uint8Array;
  initiate?: () => Response;
  put?: () => Response;
  submit?: () => Response;
  uploadUrl?: string;
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFal(o: FakeOpts = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u);
    const method = String(init.method ?? "GET");
    let body: unknown = init.body;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, headers: { ...((init.headers ?? {}) as Record<string, string>) }, body, redirect: init.redirect });
    if (url === storage.FAL_STORAGE_INITIATE_URL) return o.initiate?.() ?? json(200, { upload_url: o.uploadUrl ?? UPLOAD_URL, file_url: FILE_URL });
    if (url === (o.uploadUrl ?? UPLOAD_URL) && method === "PUT") return o.put?.() ?? new Response(null, { status: 200 });
    if (url === storage.FAL_STORAGE_DELETE_URL) return json(200, {});
    if (url.endsWith("/cancel")) return json(400, { detail: "already complete" });
    if (url.endsWith("/status")) return json(200, o.status?.() ?? { status: "COMPLETED" });
    if (url.includes(`/requests/${REQ}`)) return json(o.resultStatus ?? 200, o.result ?? {});
    if (url.startsWith("https://queue.fal.run/")) return o.submit?.() ?? json(200, { request_id: REQ });
    if (url.startsWith("https://v3.fal.media/out")) return new Response(new Uint8Array(o.download ?? mp3Bytes()), { status: 200, headers: { "content-type": "image/png" } });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const fal = () => falAdapter({ key: () => KEY, lookup, sleep: async () => {}, pollMs: 1, pollMaxMs: 1 });
const falDeps = { key: () => KEY, lookup, sleep: async () => {}, pollMs: 1, pollMaxMs: 1 };
const bodyOf = (id: string, values: Record<string, unknown>, assets?: Record<string, { mime: string; base64: string }[]>) => {
  const e = entry(id);
  return fal().buildRequest!({ upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, values), ...(assets ? { assets } : {}) }).body as Record<string, unknown>;
};
const queueBody = (id: string, values: Record<string, unknown>, mime = "video/mp4") => {
  const e = entry(id);
  return models.falDubBody(e.routes[0]!.upstreamModel, normalize(e.params, values), assetOf(mime, new Uint8Array(4)), "https://f/x");
};
const MP3_ASSET = { audio: [assetOf("audio/mpeg", mp3Bytes(10))] };
const MEDIA_ASSET = { media: [assetOf("audio/mpeg", mp3Bytes(10))] };

/* ───────────────────────── catalog ───────────────────────── */

test("catalog: seven fal entries, all defaultOff, each purpose keeps its default, every route has an adapter", () => {
  const maps: Record<string, Record<string, unknown>> = {
    [cat.STUDIO_TRANSCRIBE_PURPOSE]: transcribeAdapters(),
    [cat.STUDIO_DUB_PURPOSE]: transcribeAdapters(),
    [au.STUDIO_SFX_PURPOSE]: studioAudioAdapters(),
    [au.STUDIO_ISOLATE_PURPOSE]: studioAudioAdapters(),
    [sp.STUDIO_SPEECH_PURPOSE]: studioSpeechAdapters({ gemini: {} as never }),
  };
  const defaults: Record<string, string> = {
    [cat.STUDIO_TRANSCRIBE_PURPOSE]: cat.TRANSCRIBE_MODEL,
    [cat.STUDIO_DUB_PURPOSE]: cat.DUB_MODEL,
    [au.STUDIO_SFX_PURPOSE]: au.SFX_MODEL,
    [au.STUDIO_ISOLATE_PURPOSE]: au.ISOLATOR_MODEL,
    [sp.STUDIO_SPEECH_PURPOSE]: "elevenlabs/eleven-v3",
  };
  for (const id of IDS) {
    const e = entry(id);
    assert.equal(e.defaultOff, true, `${id} ships hidden`);
    assert.deepEqual(e.routes.map((r) => r.provider), ["fal"], `${id} needs only the fal key`);
    const purpose = Object.keys(maps).filter((p) => MEDIA_PURPOSES.byId(p)!.allowed.includes(id));
    assert.equal(purpose.length, 1, `${id} belongs to one purpose`);
    assert.ok(maps[purpose[0]!]![e.routes[0]!.adapter], `${id}: the engine has its adapter`);
    assert.equal(MEDIA_PURPOSES.byId(purpose[0]!)!.userCanChoose, true);
  }
  for (const [p, d] of Object.entries(defaults)) assert.equal(MEDIA_PURPOSES.byId(p)!.default, d, `${p} keeps its default`);
  // No new model reaches a default-on path: the older entries did not change.
  for (const id of [cat.TRANSCRIBE_MODEL, cat.DUB_MODEL, au.SFX_MODEL, au.ISOLATOR_MODEL, "elevenlabs/eleven-v3"]) assert.equal(entry(id).defaultOff, undefined, id);
  assert.deepEqual(MEDIA_CATALOG.entries.filter((e) => e.routes.some((r) => r.adapter === "fal-dub")).map((e) => e.id), [cat.FAL_DUB_MODEL, cat.HEYGEN_TRANSLATE_MODEL]);
});

/* ───────────────────────── price ───────────────────────── */

const usd = (id: string, v: Record<string, unknown>) => costUsd(entry(id).cost, normalize(entry(id).params, v));
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} != ${b}`);

test("cost rule: `unitSeconds` bills whole started units, at least one; absent it changes nothing", () => {
  const rule = { per: "second" as const, usd: 0.01, secondsParam: "s", unitSeconds: 60 };
  near(costUsd(rule, { s: 1 }), 0.6, "1 s");
  near(costUsd(rule, { s: 60 }), 0.6, "60 s");
  near(costUsd(rule, { s: 61 }), 1.2, "61 s");
  near(costUsd(rule, {}), 0.6, "no length is still one unit");
  near(costUsd({ per: "second", usd: 0.01, secondsParam: "s" }, { s: 61 }), 0.61, "per second");
});

test("price: each page's price, whole-minute billing, client preview == server", () => {
  near(usd(cat.FAL_SCRIBE_MODEL, { sourceSeconds: 60 }), 0.008, "Scribe, 1 min");
  near(usd(cat.FAL_SCRIBE_MODEL, { sourceSeconds: 30 }), 0.004, "Scribe, 30 s");
  near(usd(cat.FAL_DUB_MODEL, { sourceSeconds: 15 }), 0.6, "dubbing, 15 s rounds up to a minute");
  near(usd(cat.FAL_DUB_MODEL, { sourceSeconds: 60 }), 0.6, "dubbing, 1 min");
  near(usd(cat.FAL_DUB_MODEL, { sourceSeconds: 61 }), 1.2, "dubbing, 61 s");
  near(usd(cat.FAL_DUB_MODEL, { sourceSeconds: 180 }), 1.8, "dubbing, 3 min");
  near(usd(cat.HEYGEN_TRANSLATE_MODEL, { sourceSeconds: 10 }), 0.5, "HeyGen, per second");
  near(usd(au.FAL_SFX_MODEL, { duration: 5, variants: 1 }), 0.01, "SFX 5 s");
  near(usd(au.FAL_SFX_MODEL, { duration: 5, variants: 3 }), 0.03, "SFX × 3");
  near(usd(au.VEED_CLEAN_MODEL, { inputSeconds: 3 }), 0.0125, "VEED, the one-minute minimum");
  near(usd(au.VEED_CLEAN_MODEL, { inputSeconds: 60 }), 0.0125, "VEED, 1 min");
  near(usd(au.VEED_CLEAN_MODEL, { inputSeconds: 61 }), 0.025, "VEED, 61 s");
  near(usd(au.VEED_CLEAN_MODEL, { inputSeconds: 300 }), 0.0625, "VEED, 5 min");
  near(usd(sp.FAL_ELEVEN_V3_MODEL, { text: "x".repeat(1000) }), 0.1, "v3");
  near(usd(sp.FAL_ELEVEN_V4_TURBO_MODEL, { text: "x".repeat(1000) }), 0.04, "v4 turbo");

  // At ×2 and 12 700 so'm/$: never under cost, and the short dub pays for the minute fal bills.
  const som = (id: string, v: Record<string, unknown>) => studioEntryPrice(entry(id), v, PRICING);
  assert.equal(som(cat.FAL_DUB_MODEL, { sourceSeconds: 15 }), 15_300);
  assert.equal(som(au.VEED_CLEAN_MODEL, { inputSeconds: 3 }), 400);
  assert.equal(som(cat.HEYGEN_TRANSLATE_MODEL, { sourceSeconds: 60 }), 76_200);

  // The browser's entry (no routes) prices the same; the tool's server formula reads the chosen model.
  for (const [id, v] of [[cat.FAL_DUB_MODEL, { sourceSeconds: 15 }], [au.VEED_CLEAN_MODEL, { inputSeconds: 61 }]] as const) {
    assert.equal(studioEntryPrice(clientOf(id), v, PRICING), som(id, v), id);
  }
  const dub = (modelId: string, sourceSeconds: number) => tools.basePriceFor(tools.TOOL_BY_ID["studio-dub"], { modelId, source: RES, sourceSeconds } as never, PRICING);
  assert.equal(dub(cat.FAL_DUB_MODEL, 15), 15_300, "the server charges the model the request names");
  assert.notEqual(dub(cat.FAL_DUB_MODEL, 15), dub(cat.DUB_MODEL, 15));
  assert.equal(tools.basePriceFor(tools.TOOL_BY_ID["studio-transcribe"], { modelId: cat.FAL_SCRIBE_MODEL, source: RES, sourceSeconds: 60 } as never, PRICING), 300);
});

/* ───────────────────────── golden requests ───────────────────────── */

test("golden: Scribe — audio_url, both defaults switched explicitly, three-letter language codes", () => {
  assert.deepEqual(bodyOf(cat.FAL_SCRIBE_MODEL, { source: RES, sourceSeconds: 5 }, MEDIA_ASSET), { audio_url: storage.FAL_FILE_PENDING, tag_audio_events: false, diarize: false });
  assert.deepEqual(bodyOf(cat.FAL_SCRIBE_MODEL, { source: RES, sourceSeconds: 5, language: "uz", speakers: true }, MEDIA_ASSET), { audio_url: storage.FAL_FILE_PENDING, tag_audio_events: false, diarize: true, language_code: "uzb" });
  assert.equal(bodyOf(cat.FAL_SCRIBE_MODEL, { source: RES, language: "en" }, MEDIA_ASSET).language_code, "eng", "the page's own example");
  for (const l of cat.SPEECH_LANGUAGES) assert.match(models.SCRIBE_LANGUAGE[l.value] ?? "", /^[a-z]{3}$/, `${l.value} has a three-letter code`);
});

test("golden: dubbing — fal by source kind; HeyGen's enum name and a fixed output length", () => {
  assert.deepEqual(queueBody(cat.FAL_DUB_MODEL, { source: RES, target: "ru" }), { video_url: "https://f/x", target_lang: "ru", highest_resolution: false });
  assert.deepEqual(queueBody(cat.FAL_DUB_MODEL, { source: UP, target: "uz", sourceLang: "en" }, "audio/mpeg"), { audio_url: "https://f/x", target_lang: "uz", source_lang: "en", highest_resolution: false });
  assert.deepEqual(queueBody(cat.HEYGEN_TRANSLATE_MODEL, { source: RES }), { video_url: "https://f/x", output_language: "Uzbek (Latin, Uzbekistan)", translate_audio_only: false, enable_dynamic_duration: false });
  const heygen = entry(cat.HEYGEN_TRANSLATE_MODEL).params.find((p) => p.name === "target");
  assert.ok(heygen?.type === "enum");
  assert.deepEqual(heygen.options.map((o) => o.value).sort(), Object.keys(cat.HEYGEN_LANGUAGE).sort(), "every offered language has its enum name");
  assert.ok(!cat.HEYGEN_LANGUAGE.ky && !cat.HEYGEN_LANGUAGE.tg, "the page's enum has neither");
  assert.throws(() => queueBody(cat.HEYGEN_TRANSLATE_MODEL, { source: RES }, "audio/mpeg"), /video only/);
});

test("golden: sound effects, clean audio, the two speech models", () => {
  assert.deepEqual(bodyOf(au.FAL_SFX_MODEL, { prompt: "eshik ochiladi", duration: 4, influence: "0.8", loop: true }), { text: "eshik ochiladi", duration_seconds: 4, prompt_influence: 0.8, loop: true, output_format: "mp3_44100_128" });
  assert.deepEqual(bodyOf(au.VEED_CLEAN_MODEL, { inputId: "a".repeat(24), inputSeconds: 10 }, MP3_ASSET), { audio_url: storage.FAL_FILE_PENDING, strength: 0.874, output_format: "wav" });
  const speech = { text: "Salom", voice: RACHEL, stability: "0.5", lang: "uz" };
  assert.deepEqual(bodyOf(sp.FAL_ELEVEN_V3_MODEL, speech), { text: "Salom", voice: "Rachel", stability: 0.5, language_code: "uz", apply_text_normalization: "auto" });
  assert.deepEqual(bodyOf(sp.FAL_ELEVEN_V4_TURBO_MODEL, speech), { text: "Salom", voice: "Rachel", stability: 0.5, language_code: "uz", apply_text_normalization: "auto", output_format: "mp3_44100_128" });
});

/* ───────────────────────── probe ───────────────────────── */

const differ = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
const priced = (id: string, a: Record<string, unknown>, b: Record<string, unknown>) => studioEntryPrice(entry(id), a, PRICING) !== studioEntryPrice(entry(id), b, PRICING);

/** The asset the engine hands the adapter for a source (`source` / `inputId` have no field of their own in the body). */
async function seenAsset(run: (capture: (i: { assets?: unknown }) => void) => Promise<unknown>): Promise<unknown> {
  let seen: unknown;
  await run((i) => void (seen = i.assets)).catch(() => undefined);
  return seen;
}
const stt = { text: "bir", language_code: "uzb", words: [{ text: "bir", start: 0, end: 1, type: "word" }] };
const sttRun = (capture: (i: { assets?: unknown }) => void) => async (i: { assets?: unknown }) => {
  capture(i);
  return { outputs: [{ kind: "inline" as const, bytes: new TextEncoder().encode(JSON.stringify(stt)), mime: "application/json" }] };
};
const scribeSource = (src: string, bytes: Uint8Array) => (capture: (i: { assets?: unknown }) => void) =>
  buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { modelId: cat.FAL_SCRIBE_MODEL, source: src, sourceSeconds: 3 } as never, { source: { kind: "result", id: src.slice(7), mime: "audio/mpeg", bytes, seconds: 3 } }, {}, { run: sttRun(capture) as never });

test("probe: every param of the seven models changes the request or the price (and the probe list = the schema)", async (t) => {
  quiet(t);
  const scribe = (v: Record<string, unknown>) => bodyOf(cat.FAL_SCRIBE_MODEL, { source: RES, ...v }, MEDIA_ASSET);
  const dub = (v: Record<string, unknown>, mime?: string) => queueBody(cat.FAL_DUB_MODEL, { source: RES, ...v }, mime);
  const heygen = (v: Record<string, unknown>) => queueBody(cat.HEYGEN_TRANSLATE_MODEL, { source: RES, ...v });
  const sfx = (v: Record<string, unknown>) => bodyOf(au.FAL_SFX_MODEL, { prompt: "eshik ochiladi", ...v });
  const clean = (v: Record<string, unknown>) => bodyOf(au.VEED_CLEAN_MODEL, { inputId: "a".repeat(24), inputSeconds: 10, ...v }, MP3_ASSET);
  const tts = (id: string) => (v: Record<string, unknown>) => bodyOf(id, { text: "Salom", ...v });
  const speechProbes = (id: string) => {
    const b = tts(id);
    return {
      text: () => differ(b({ text: "Salom" }), b({ text: "Xayr" })) && priced(id, { text: "x".repeat(100) }, { text: "x".repeat(900) }),
      voice: () => differ(b({ voice: RACHEL }), b({ voice: sp.FAL_ELEVEN_VOICES[1]!.id })),
      stability: () => differ(b({ stability: "0" }), b({ stability: "1" })),
      lang: () => differ(b({ lang: "uz" }), b({ lang: "ru" })),
    };
  };
  const inputAsset = (inputId: string, bytes: Uint8Array) =>
    seenAsset(async (capture) => {
      const run = async (i: { assets?: unknown }) => {
        capture(i);
        return { outputs: [{ kind: "inline" as const, bytes: wavBytes(), mime: "audio/wav" }] };
      };
      await buildStudioAudio(tools.TOOL_BY_ID["studio-audio"], { modelId: au.VEED_CLEAN_MODEL, inputId, inputSeconds: 3 } as never, { input: { mime: "audio/mpeg", base64: b64(bytes), seconds: 3 }, clones: {} }, {}, { run: run as never });
    });
  const dubSource = (id: string, src: string, bytes: Uint8Array) =>
    seenAsset(async (capture) => {
      const adapter = { id: "fal-dub", configured: () => true, submit: async (i: { assets?: unknown }) => (capture(i), Promise.reject(new MediaError("fal", "probe stop"))), fetchOutput: async () => new Uint8Array() };
      await dubMod.buildStudioDub(tools.TOOL_BY_ID["studio-dub"], { modelId: id, source: src, sourceSeconds: 2, target: "ru" } as never, { source: { kind: "result", id: src.slice(7), mime: "video/mp4", bytes, seconds: 2 } }, {}, { adapters: { "fal-dub": adapter as never }, store: null, health: HEALTH });
    });
  const probes: Record<string, Record<string, () => Promise<boolean> | boolean>> = {
    [cat.FAL_SCRIBE_MODEL]: {
      language: () => differ(scribe({}), scribe({ language: "ru" })),
      speakers: () => differ(scribe({}), scribe({ speakers: true })),
      sourceSeconds: () => priced(cat.FAL_SCRIBE_MODEL, { sourceSeconds: 60 }, { sourceSeconds: 600 }),
      source: async () => differ(await seenAsset(scribeSource(RES, mp3Bytes(3))), await seenAsset(scribeSource(RES2, mp3Bytes(5)))),
      burn: async () => {
        let ran = 0;
        const ff = async () => (ran++, Promise.reject(new Error("probe stop")));
        // The audio track is the first run on a fal video; only the burn makes a second one.
        const ctx = { source: { kind: "result" as const, id: RES.slice(7), mime: "video/mp4", bytes: new Uint8Array(10), seconds: 3 } };
        const track = async (r: { output: string }) => (r.output === AUDIO_TRACK_FILES.out ? mp3Bytes(4) : ff());
        const run = sttRun(() => undefined) as never;
        await buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { modelId: cat.FAL_SCRIBE_MODEL, source: RES, sourceSeconds: 3 } as never, ctx, {}, { run, ffmpeg: track });
        await assert.rejects(buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { modelId: cat.FAL_SCRIBE_MODEL, source: RES, sourceSeconds: 3, burn: true } as never, ctx, {}, { run, ffmpeg: track }));
        return ran === 1;
      },
    },
    [cat.FAL_DUB_MODEL]: {
      target: () => differ(dub({ target: "ru" }), dub({ target: "en" })),
      sourceLang: () => differ(dub({}), dub({ sourceLang: "en" })),
      sourceSeconds: () => priced(cat.FAL_DUB_MODEL, { sourceSeconds: 60 }, { sourceSeconds: 61 }),
      source: async () => differ(await dubSource(cat.FAL_DUB_MODEL, RES, new Uint8Array(30)), await dubSource(cat.FAL_DUB_MODEL, RES2, new Uint8Array(40))) && differ(dub({}), dub({}, "audio/mpeg")),
    },
    [cat.HEYGEN_TRANSLATE_MODEL]: {
      target: () => differ(heygen({ target: "uz" }), heygen({ target: "ru" })),
      translateAudioOnly: () => differ(heygen({}), heygen({ translateAudioOnly: true })),
      sourceSeconds: () => priced(cat.HEYGEN_TRANSLATE_MODEL, { sourceSeconds: 10 }, { sourceSeconds: 11 }),
      source: async () => differ(await dubSource(cat.HEYGEN_TRANSLATE_MODEL, RES, new Uint8Array(30)), await dubSource(cat.HEYGEN_TRANSLATE_MODEL, RES2, new Uint8Array(40))),
    },
    [au.FAL_SFX_MODEL]: {
      prompt: () => differ(sfx({}), sfx({ prompt: "momaqaldiroq" })),
      duration: () => differ(sfx({ duration: 4 }), sfx({ duration: 8 })) && priced(au.FAL_SFX_MODEL, { duration: 4 }, { duration: 8 }),
      influence: () => differ(sfx({ influence: "0.3" }), sfx({ influence: "0.8" })),
      loop: () => differ(sfx({}), sfx({ loop: true })),
      variants: () => priced(au.FAL_SFX_MODEL, { variants: 1 }, { variants: 2 }),
    },
    [au.VEED_CLEAN_MODEL]: {
      inputId: async () => differ(await inputAsset("a".repeat(24), mp3Bytes(3)), await inputAsset("b".repeat(24), mp3Bytes(5))),
      inputSeconds: () => priced(au.VEED_CLEAN_MODEL, { inputSeconds: 60 }, { inputSeconds: 61 }),
      strength: () => differ(clean({ strength: "0.5" }), clean({ strength: "1" })),
    },
    [sp.FAL_ELEVEN_V3_MODEL]: speechProbes(sp.FAL_ELEVEN_V3_MODEL),
    [sp.FAL_ELEVEN_V4_TURBO_MODEL]: speechProbes(sp.FAL_ELEVEN_V4_TURBO_MODEL),
  };
  assert.deepEqual(Object.keys(probes).sort(), [...IDS].sort(), "one probe table per new model");
  for (const id of IDS) {
    assert.deepEqual(Object.keys(probes[id]!).sort(), entry(id).params.map((p) => p.name).sort(), `${id}: one probe per param`);
    for (const [name, probe] of Object.entries(probes[id]!)) assert.equal(await probe(), true, `${id}.${name} changes nothing`);
  }
});

/* ───────────────────────── storage ───────────────────────── */

const AUDIO = assetOf("audio/mpeg", mp3Bytes(5));

test("storage: upload — initiate with the key and the expiry, PUT without the key, a constant file name", async () => {
  const { calls, fetchImpl } = fakeFal();
  const url = await storage.uploadFalFile(AUDIO, { key: KEY, fetchImpl, lookup });
  assert.equal(url, FILE_URL);
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [["POST", storage.FAL_STORAGE_INITIATE_URL], ["PUT", UPLOAD_URL]]);
  assert.equal(calls[0]!.headers.Authorization, `Key ${KEY}`);
  assert.equal(calls[0]!.headers["X-Fal-Object-Lifecycle-Preference"], JSON.stringify({ expiration_duration_seconds: storage.FAL_RETENTION_SEC }));
  assert.deepEqual(calls[0]!.body, { file_name: "input.mp3", content_type: "audio/mpeg" });
  assert.equal(calls[0]!.redirect, "manual");
  assert.equal(calls[1]!.headers.Authorization, undefined, "the key never goes to the presigned URL");
  assert.equal(calls[1]!.headers["Content-Type"], "audio/mpeg");
  assert.equal(calls[1]!.redirect, "manual");
  assert.deepEqual([...(calls[1]!.body as Uint8Array)], [...mp3Bytes(5)], "the bytes as stored");
  assert.ok(storage.FAL_RETENTION_SEC <= 3_600, "a user's file is not kept for days");
});

test("storage: failures are never `accepted`; no key, signature or user data in a message; a private upload host is refused", async (t) => {
  quiet(t);
  const failure = async (o: FakeOpts, asset = AUDIO) => {
    const { calls, fetchImpl } = fakeFal(o);
    const e = await storage.uploadFalFile(asset, { key: KEY, fetchImpl, lookup: async (h: string) => (h === "evil.internal" ? ["10.0.0.5"] : lookup()) }).then(
      () => assert.fail("must throw"),
      (x: unknown) => x as InstanceType<typeof MediaError>,
    );
    assert.ok(e instanceof MediaError);
    assert.equal(e.accepted, false, e.message);
    assert.ok(!e.message.includes(KEY) && !e.message.includes("PRESIGNED"), e.message);
    return { e, calls };
  };
  assert.equal((await failure({ initiate: () => json(401, { detail: KEY }) })).e.retryable, false);
  assert.equal((await failure({ initiate: () => json(503, {}) })).e.retryable, true);
  assert.equal((await failure({ put: () => new Response(null, { status: 500 }) })).e.retryable, true);
  assert.equal((await failure({ put: () => new Response(null, { status: 403 }) })).e.retryable, false);
  await failure({ initiate: () => json(200, { upload_url: UPLOAD_URL }) });
  await failure({ initiate: () => json(200, { upload_url: UPLOAD_URL, file_url: "http://plain/x" }) });
  for (const bad of ["http://v3.fal.media/up", "https://evil.internal/up", "https://127.0.0.1/up"]) {
    const { calls } = await failure({ uploadUrl: bad });
    assert.ok(!calls.some((c) => c.method === "PUT"), `no bytes went to ${bad}`);
  }
  const unknown = await failure({}, assetOf("text/html", new Uint8Array(4)));
  assert.equal(unknown.calls.length, 0, "an unknown type is not even initiated");
});

test("storage: delete — after the call, also when the model failed; a failed delete changes nothing", async (t) => {
  quiet(t);
  const input = { upstreamModel: entry(cat.FAL_SCRIBE_MODEL).routes[0]!.upstreamModel, params: normalize(entry(cat.FAL_SCRIBE_MODEL).params, { source: RES }), assets: MEDIA_ASSET };
  const deletes = (calls: Call[]) => calls.filter((c) => c.url === storage.FAL_STORAGE_DELETE_URL);
  const ok = fakeFal({ result: stt });
  await fal().submit(input, { fetchImpl: ok.fetchImpl });
  assert.deepEqual(deletes(ok.calls).map((c) => c.body), [{ file_url: FILE_URL }]);
  assert.equal(deletes(ok.calls)[0]!.headers.Authorization, `Key ${KEY}`);

  const bad = fakeFal({ resultStatus: 500, result: { detail: "boom" } });
  await assert.rejects(fal().submit(input, { fetchImpl: bad.fetchImpl }));
  assert.equal(deletes(bad.calls).length, 1, "a failed job leaves nothing behind");

  // A refused submit never reached a model; the upload still goes.
  const refused = fakeFal({ submit: () => json(422, { detail: "bad input" }) });
  await assert.rejects(fal().submit(input, { fetchImpl: refused.fetchImpl }));
  assert.equal(deletes(refused.calls).length, 1);

  // Missing file: nothing is uploaded at all.
  const none = fakeFal({ result: stt });
  await assert.rejects(fal().submit({ ...input, assets: {} }, { fetchImpl: none.fetchImpl }), /kirish fayli/);
  assert.equal(none.calls.length, 0);

  const logs: string[] = [];
  t.mock.method(console, "warn", (m: string) => void logs.push(m));
  const throwing = (async () => {
    throw new Error(`boom ${KEY} ${FILE_URL}`);
  }) as unknown as typeof fetch;
  await storage.deleteFalFile(FILE_URL, { key: KEY, fetchImpl: throwing });
  assert.ok(!logs.join(" ").includes(KEY) && !logs.join(" ").includes(FILE_URL), "the log names neither");
});

/* ───────────────────────── sync adapter ───────────────────────── */

test("adapter: Scribe — upload, submit with retention, the file's URL in the body, a normalized transcript", async () => {
  const { calls, fetchImpl } = fakeFal({ result: { ...stt, language_probability: 1 } });
  const e = entry(cat.FAL_SCRIBE_MODEL);
  const r = await fal().submit({ upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, { source: RES, language: "uz" }), assets: MEDIA_ASSET }, { fetchImpl });
  assert.ok("done" in r);
  const submit = calls.find((c) => c.method === "POST" && c.url.startsWith("https://queue.fal.run/"))!;
  assert.equal(submit.url, "https://queue.fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2");
  assert.deepEqual(submit.body, { audio_url: FILE_URL, tag_audio_events: false, diarize: false, language_code: "uzb" });
  assert.equal(submit.headers["X-Fal-Object-Lifecycle-Preference"], JSON.stringify({ expiration_duration_seconds: storage.FAL_RETENTION_SEC }));
  const out = r.done[0]!;
  assert.ok(out.kind === "inline");
  assert.equal(out.mime, "application/json");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(out.bytes)), { text: "bir", language_code: "uz", words: stt.words });
});

test("adapter: Scribe answers — the page's one-object example reads; no text = billed and unusable, so `accepted`", async () => {
  assert.deepEqual(models.falSttResult({ text: "x", language_code: "eng", words: { text: "x", start: 0, end: 1 } })?.words, [{ text: "x", start: 0, end: 1 }]);
  assert.equal(models.falSttResult({ text: "x", language_code: "eng", words: [] })?.language_code, "en");
  assert.equal(models.falSttResult({ text: "x", language_code: "xxx", words: [] })?.language_code, "xxx", "an unknown code stays");
  for (const bad of [null, [], {}, { text: 1, words: [] }, { text: "x" }]) assert.equal(models.falSttResult(bad), null, JSON.stringify(bad));
  const { fetchImpl } = fakeFal({ result: { detail: "nothing" } });
  const e = entry(cat.FAL_SCRIBE_MODEL);
  await assert.rejects(fal().submit({ upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, { source: RES }), assets: MEDIA_ASSET }, { fetchImpl }), (x: unknown) => x instanceof MediaError && x.accepted === true);
});

test("adapter: sniff — a lying content type is beaten, the output's download carries no key, a wrong file fails `accepted`", async () => {
  const e = entry(au.FAL_SFX_MODEL);
  const input = { upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, { prompt: "eshik", duration: 3 }) };
  const good = fakeFal({ result: { audio: { url: "https://v3.fal.media/out/s.mp3", content_type: "text/plain" } } });
  const r = await fal().submit(input, { fetchImpl: good.fetchImpl });
  assert.ok("done" in r);
  assert.equal((r.done[0] as { mime: string }).mime, "audio/mpeg", "the bytes decide");
  const dl = good.calls.find((c) => c.url.startsWith("https://v3.fal.media/out"))!;
  assert.equal(dl.headers.Authorization, undefined);
  assert.ok(!good.calls.some((c) => c.url === storage.FAL_STORAGE_INITIATE_URL), "a text-only model uploads nothing");

  const html = fakeFal({ result: { audio: { url: "https://v3.fal.media/out/s.mp3", content_type: "audio/mpeg" } }, download: new TextEncoder().encode("<html><body>not audio</body></html>") });
  await assert.rejects(fal().submit(input, { fetchImpl: html.fetchImpl }), (x: unknown) => x instanceof MediaError && x.accepted === true);
  const empty = fakeFal({ result: {} });
  await assert.rejects(fal().submit(input, { fetchImpl: empty.fetchImpl }), /javobda fayl/);
  // A 25 MB cap for audio, not the picture's 12 MB.
  const big = fakeFal({ result: { audio: { url: "https://v3.fal.media/out/s.mp3" } }, download: new Uint8Array(13 * 1024 * 1024).fill(0xff) });
  const ok = await fal().submit(input, { fetchImpl: big.fetchImpl });
  assert.ok("done" in ok, "13 MB of audio is delivered");
});

test("adapter: the shared failure rules hold — safety on the result, retryable before acceptance, the key scrubbed", async () => {
  const e = entry(au.FAL_SFX_MODEL);
  const input = { upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, { prompt: "eshik", duration: 3 }) };
  const policy = fakeFal({ resultStatus: 422, result: { detail: [{ type: "content_policy_violation", msg: "refused" }] } });
  await assert.rejects(fal().submit(input, { fetchImpl: policy.fetchImpl }), (x: unknown) => x instanceof MediaError && x.safety === true && x.accepted === true);
  const busy = fakeFal({ submit: () => json(503, { detail: `down ${KEY}` }) });
  await assert.rejects(fal().submit(input, { fetchImpl: busy.fetchImpl }), (x: unknown) => x instanceof MediaError && x.retryable === true && x.accepted === false && !x.message.includes(KEY));
  await assert.rejects(falAdapter({ key: () => null }).submit(input, {}), /FAL_KEY/);
});

/* ───────────────────────── engines ───────────────────────── */

const HEALTH = { allow: () => true, success: () => undefined, failure: () => undefined };
type StoreCall = [string, ...unknown[]];
function fakeStore(row: { status: string; opId: string | null; fresh: boolean } = { status: "submitting", opId: null, fresh: true }) {
  const calls: StoreCall[] = [];
  return {
    calls,
    store: {
      begin: async (i: { key: string }) => (calls.push(["begin", i.key]), { id: "row1", ...row }),
      park: async (id: string, opId: string) => void calls.push(["park", id, opId]),
      finish: async (id: string, meta: { mime: string }) => void calls.push(["finish", id, meta.mime]),
      fail: async (id: string, message: string) => void calls.push(["fail", id, message]),
    },
  };
}
const clock = () => {
  let now = 1_000_000;
  return { now: () => now, sleep: async (ms: number) => void (now += ms) };
};
/** Runs `fn` with `globalThis.fetch` swapped for the fake fal (the engines take no fetch seam). */
async function withFetch<T>(t: TestContext, f: ReturnType<typeof fakeFal>, fn: () => Promise<T>): Promise<T> {
  t.mock.method(globalThis, "fetch", f.fetchImpl as never);
  resetBreakers();
  try {
    return await fn();
  } finally {
    t.mock.restoreAll();
    quiet(t);
  }
}
const dubOutputResult = (kind: "video" | "audio") => ({ [kind]: { url: "https://v3.fal.media/out/d.bin", content_type: "application/pdf" }, target_lang: "ru" });
const audioCtx = () => ({ source: { kind: "result" as const, id: RES.slice(7), mime: "audio/mpeg", bytes: mp3Bytes(80), seconds: 2 } });

test("dub engine: fal — upload, op parked, poll, download by sniff, upload deleted; never the ElevenLabs key", { skip: ffSkip }, async (t) => {
  quiet(t);
  const f = fakeFal({ result: dubOutputResult("video"), download: videoMp4(), status: () => ({ status: "COMPLETED" }) });
  const { store, calls } = fakeStore();
  const c = clock();
  const out = await dubMod.buildStudioDub(
    tools.TOOL_BY_ID["studio-dub"],
    { modelId: cat.FAL_DUB_MODEL, source: RES, sourceSeconds: 2, target: "ru" } as never,
    { source: { kind: "result", id: RES.slice(7), mime: "video/mp4", bytes: videoMp4(), seconds: 2, aspect: "9:16" } },
    { deadline: c.now() + 500_000 },
    { adapters: { "fal-dub": wrapped(f) }, store, health: HEALTH, ...c },
  );
  assert.equal(out.mime, "video/mp4");
  assert.equal(out.doc?.dub?.model, cat.FAL_DUB_MODEL);
  assert.equal(out.doc?.video?.provider, "fal");
  assert.equal(out.doc?.video?.model, cat.FAL_DUB_MODEL);
  assert.deepEqual(calls.map((x) => x[0]), ["begin", "park", "finish"]);
  assert.equal(calls[1]![2], `fal:${cat.FAL_DUB_ENDPOINT}:${REQ}`);
  const submit = f.calls.find((x) => x.method === "POST" && x.url === `https://queue.fal.run/${cat.FAL_DUB_ENDPOINT}`)!;
  assert.deepEqual(submit.body, { video_url: FILE_URL, target_lang: "ru", highest_resolution: false });
  assert.equal(submit.headers["X-Fal-Request-Start-Timeout"], "180");
  assert.ok(!f.calls.some((x) => x.url.includes("elevenlabs.io")));
  assert.equal(f.calls.filter((x) => x.url === storage.FAL_STORAGE_DELETE_URL).length, 1, "the source does not stay on fal");
  const dl = f.calls.find((x) => x.url.startsWith("https://v3.fal.media/out"))!;
  assert.equal(dl.headers.Authorization, undefined);
});

test("dub engine: resume — a parked fal op is polled, never uploaded or submitted again", { skip: ffSkip }, async (t) => {
  quiet(t);
  const f = fakeFal({ result: dubOutputResult("video"), download: videoMp4() });
  const { store } = fakeStore({ status: "pending", opId: `fal:${cat.FAL_DUB_ENDPOINT}:${REQ}`, fresh: false });
  const c = clock();
  const out = await dubMod.buildStudioDub(
    tools.TOOL_BY_ID["studio-dub"],
    { modelId: cat.FAL_DUB_MODEL, source: RES, sourceSeconds: 2, target: "ru" } as never,
    { source: { kind: "result", id: RES.slice(7), mime: "video/mp4", bytes: videoMp4(), seconds: 2 } },
    { deadline: c.now() + 500_000 },
    { adapters: { "fal-dub": wrapped(f) }, store, health: HEALTH, ...c },
  );
  assert.equal(out.mime, "video/mp4");
  assert.ok(!f.calls.some((x) => x.url === storage.FAL_STORAGE_INITIATE_URL), "nothing uploaded");
  assert.ok(!f.calls.some((x) => x.method === "POST" && x.url.startsWith("https://queue.fal.run/")), "nothing resubmitted");
  // An op id for an endpoint outside the dub list is refused, so a stored row cannot steer the key.
  assert.equal(parseFalVideoOp(`fal:${cat.FAL_DUB_ENDPOINT}:${REQ}`), null, "the clip list does not know a dub");
  assert.deepEqual(parseFalVideoOp(`fal:${cat.FAL_DUB_ENDPOINT}:${REQ}`, models.FAL_DUB_ENDPOINTS), { endpoint: cat.FAL_DUB_ENDPOINT, requestId: REQ });
});

test("dub engine: an audio source comes back as MP3 from `audio`; failures refund and clean up", async (t) => {
  quiet(t);
  const f = fakeFal({ result: dubOutputResult("audio"), download: mp3Bytes(90) });
  const c = clock();
  const run = (ff: ReturnType<typeof fakeFal>, ctx = audioCtx()) =>
    dubMod.buildStudioDub(tools.TOOL_BY_ID["studio-dub"], { modelId: cat.FAL_DUB_MODEL, source: RES, sourceSeconds: 2, target: "uz" } as never, ctx, { deadline: c.now() + 500_000 }, { adapters: { "fal-dub": wrapped(ff) }, store: null, health: HEALTH, ...c });
  const out = await run(f);
  assert.equal(out.mime, "audio/mpeg");
  assert.equal(out.doc?.dub?.output, "mp3");
  assert.ok(f.calls.some((x) => JSON.stringify(x.body).includes(`"audio_url":"${FILE_URL}"`)));

  // The model failed at fal: refund + the upload deleted.
  const failed = fakeFal({ status: () => ({ status: "COMPLETED", error: "dubbing failed" }) });
  await assert.rejects(run(failed), (e: unknown) => e instanceof UserFacingError && /Kredit qaytariladi/.test(e.message));
  assert.equal(failed.calls.filter((x) => x.url === storage.FAL_STORAGE_DELETE_URL).length, 1);

  // A content-policy refusal says so.
  const safe = fakeFal({ status: () => ({ status: "COMPLETED", error: "content policy", error_type: "content_policy_violation" }) });
  await assert.rejects(run(safe), (e: unknown) => e instanceof UserFacingError && e.message === dubMod.DUB_SAFETY_MESSAGE);

  // A file of another kind than the source: refused by the bytes, whatever the answer claimed.
  const wrong = fakeFal({ result: dubOutputResult("audio"), download: new TextEncoder().encode("<html>nope, this is not a media file</html>") });
  await assert.rejects(run(wrong), (e: unknown) => e instanceof UserFacingError && /Kredit qaytariladi/.test(e.message));
  assert.equal(falDubOutput({ video: { url: "https://v/1" }, audio: { url: "https://a/2" } }), "https://v/1", "a video source's file is the video");
  assert.equal(falDubOutput({ target_lang: "uz" }), null);
});

test("dub engine: HeyGen — video only, its enum name sent, the cost on the DELIVERED seconds", { skip: ffSkip }, async (t) => {
  quiet(t);
  const c = clock();
  await assert.rejects(
    dubMod.buildStudioDub(tools.TOOL_BY_ID["studio-dub"], { modelId: cat.HEYGEN_TRANSLATE_MODEL, source: RES, sourceSeconds: 2 } as never, audioCtx(), { deadline: c.now() + 500_000 }, { adapters: { "fal-dub": wrapped(fakeFal()) }, store: null, health: HEALTH, ...c }),
    (e: unknown) => e instanceof UserFacingError && /faqat videoni/.test(e.message) && /Kredit qaytariladi/.test(e.message),
  );

  const f = fakeFal({ result: { video: { url: "https://v3.fal.media/out/h.mp4" } }, download: videoMp4() });
  const tracked = jobCost.trackJobCost(() =>
    dubMod.buildStudioDub(
      tools.TOOL_BY_ID["studio-dub"],
      { modelId: cat.HEYGEN_TRANSLATE_MODEL, source: RES, sourceSeconds: 1, target: "uz", translateAudioOnly: true } as never,
      { source: { kind: "result", id: RES.slice(7), mime: "video/mp4", bytes: videoMp4(), seconds: 1 } },
      { deadline: c.now() + 500_000 },
      { adapters: { "fal-dub": wrapped(f) }, store: null, health: HEALTH, ...c },
    ),
  );
  const out = await tracked.promise;
  assert.equal(out.doc?.dub?.sourceLang, "auto", "the model has no such field");
  const submit = f.calls.find((x) => x.url === `https://queue.fal.run/${cat.HEYGEN_TRANSLATE_ENDPOINT}`)!;
  assert.deepEqual(submit.body, { video_url: FILE_URL, output_language: "Uzbek (Latin, Uzbekistan)", translate_audio_only: true, enable_dynamic_duration: false });
  // The billed source was 1 s; the delivered clip measures ≈ 2 s, and fal bills what it delivered.
  const meter = tracked.snapshot();
  assert.equal(meter.calls, 1, "one fal part");
  assert.ok(meter.toJson().usd > 0.09, `cost follows the output, got ${meter.toJson().usd}`);
});

/** The async adapter with the fake fal in place of `fetch`: the engine passes no fetch seam. */
function wrapped(f: ReturnType<typeof fakeFal>) {
  const a = falDubAdapter({ key: () => KEY, lookup });
  const deps = (d: object = {}) => ({ ...d, fetchImpl: f.fetchImpl });
  return {
    ...a,
    submit: (i: never, d: object) => a.submit(i, deps(d)),
    poll: (o: string, d: object) => a.poll!(o, deps(d)),
    cancel: (o: string, d?: object) => a.cancel!(o, deps(d)),
    fetchOutput: (o: never, d: object) => a.fetchOutput(o, deps(d)),
  } as never;
}

test("transcribe engine: a fal video goes as its audio track (ffmpeg before the paid call); ElevenLabs keeps the whole file", async (t) => {
  quiet(t);
  const video = { source: { kind: "result" as const, id: RES.slice(7), mime: "video/mp4", bytes: new Uint8Array(2048).fill(7), seconds: 3 } };
  const seen: { assets?: { media: { mime: string; base64: string }[] }; modelId?: string }[] = [];
  const run = sttRun((i) => seen.push(i as never)) as never;
  const track = mp3Bytes(20);
  const ran: { inputs: Record<string, Uint8Array>; args: readonly string[]; output: string }[] = [];
  const out = await buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { modelId: cat.FAL_SCRIBE_MODEL, source: RES, sourceSeconds: 3, language: "uz" } as never, video, {}, {
    run,
    ffmpeg: async (r) => (ran.push(r as never), track),
  });
  assert.equal(ran.length, 1);
  assert.deepEqual(Object.keys(ran[0]!.inputs), [AUDIO_TRACK_FILES.video]);
  assert.equal(ran[0]!.output, AUDIO_TRACK_FILES.out);
  assert.equal(seen[0]!.modelId, cat.FAL_SCRIBE_MODEL);
  assert.deepEqual(seen[0]!.assets, { media: [{ mime: "audio/mpeg", base64: b64(track) }] }, "the track, not the video");
  assert.equal(out.doc?.transcribe?.model, cat.FAL_SCRIBE_MODEL);
  assert.equal(out.doc?.transcribe?.language, "uzb", "the stub's answer passes through (the real adapter maps it back)");

  // No track (a silent clip): refund, and the paid call never ran.
  seen.length = 0;
  await assert.rejects(
    buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { modelId: cat.FAL_SCRIBE_MODEL, source: RES, sourceSeconds: 3 } as never, video, {}, { run, ffmpeg: async () => Promise.reject(new Error("no stream")) }),
    (e: unknown) => e instanceof UserFacingError && /ovozni ajratib/.test(e.message) && /Kredit qaytariladi/.test(e.message),
  );
  assert.equal(seen.length, 0);

  // ElevenLabs takes the MP4 as stored: no ffmpeg.
  let ffmpegRuns = 0;
  await buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { modelId: cat.TRANSCRIBE_MODEL, source: RES, sourceSeconds: 3 } as never, video, {}, { run, ffmpeg: async () => (ffmpegRuns++, track) });
  assert.equal(ffmpegRuns, 0);
  assert.equal(seen[0]!.assets!.media[0]!.mime, "video/mp4");
});

test("transcribe: the audio-track argv is pinned, and really extracts a track", { skip: ffSkip }, async () => {
  assert.deepEqual(audioTrackArgs(5), [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file", "-f", "mov", "-i", "in-video.mp4",
    "-map", "0:a:0", "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", "-threads", "2", "-t", "5.000", "-y", "out-track.mp3",
  ]);
  const { runFfmpeg } = await import("../lib/generation/studio/mix-ffmpeg.ts");
  const out = await runFfmpeg({ inputs: { [AUDIO_TRACK_FILES.video]: videoMp4() }, args: audioTrackArgs(2), output: AUDIO_TRACK_FILES.out });
  assert.ok(mp3Seconds(out) > 1, "a playable MP3 of the clip's sound");
});

test("audio engine: VEED's WAV becomes the MP3 result; the second models run through the fal adapter", async (t) => {
  quiet(t);
  const ctx = { input: { mime: "audio/mpeg", base64: b64(mp3Bytes(40)), seconds: 3 }, clones: {} };
  const adapters = studioAudioAdapters({ fal: falDeps });
  const f = fakeFal({ result: { audio: { url: "https://v3.fal.media/out/c.wav", content_type: "audio/flac" }, audio_duration: 3 }, download: wavBytes(2) });
  const out = await withFetch(t, f, () => buildStudioAudio(tools.TOOL_BY_ID["studio-audio"], { modelId: au.VEED_CLEAN_MODEL, inputId: "a".repeat(24), inputSeconds: 3, strength: "1" } as never, ctx, {}, { adapters }));
  assert.equal(out.mime, "audio/mpeg");
  assert.ok(out.fileName.endsWith(".mp3"));
  assert.ok(mp3Seconds(out.bytes) > 1.5, "the WAV was encoded, whatever the answer claimed");
  assert.equal(out.doc?.studioAudio?.mode, "isolate");
  assert.equal(out.doc?.studioAudio?.model, au.VEED_CLEAN_MODEL);
  assert.deepEqual(f.calls.find((c) => c.url === "https://queue.fal.run/veed/clean-audio")!.body, { audio_url: FILE_URL, strength: 1, output_format: "wav" });
  assert.equal(f.calls.filter((c) => c.url === storage.FAL_STORAGE_DELETE_URL).length, 1);

  const sfx = fakeFal({ result: { audio: { url: "https://v3.fal.media/out/s.mp3" } } });
  const clips: string[] = [];
  const two = await withFetch(t, sfx, () =>
    buildStudioAudio(tools.TOOL_BY_ID["studio-audio"], { modelId: au.FAL_SFX_MODEL, prompt: "eshik ochiladi", duration: 2, variants: 2 } as never, { input: null, clones: {} }, { putAsset: async (_b, m) => (clips.push(m), `a${clips.length}`) }, { adapters }),
  );
  assert.equal(two.doc?.studioAudio?.variants?.length, 2, "one call per variant");
  assert.equal(sfx.calls.filter((c) => c.url === "https://queue.fal.run/elevenlabs/sound-effects/v3").length, 2);
});

test("speech engine and voices: the voice goes by name; clones and unlisted voices are refused before charging", async (t) => {
  quiet(t);
  assert.ok(!sp.FAL_ELEVEN_VOICES.some((v) => v.name === "Adam"), "the pages list no Adam");
  assert.equal(sp.FAL_ELEVEN_VOICES.length, 9);
  assert.deepEqual(sp.offeredVoices(sp.FAL_ELEVEN_V3_MODEL, sp.ELEVENLABS_VOICES).map((v) => v.id), sp.FAL_ELEVEN_VOICES.map((v) => v.id));
  assert.equal(sp.offeredVoices("elevenlabs/eleven-v3", sp.ELEVENLABS_VOICES).length, sp.ELEVENLABS_VOICES.length, "the direct model keeps all ten");
  assert.equal(sp.libraryVoicesOf(sp.FAL_ELEVEN_V4_TURBO_MODEL), sp.FAL_ELEVEN_VOICES);
  assert.equal(sp.takesClones(entry(sp.FAL_ELEVEN_V3_MODEL)), false, "no «Mening ovozlarim» on fal");
  assert.equal(speechRules.studioSpeechError({ modelId: sp.FAL_ELEVEN_V3_MODEL, text: "Salom", voice: RACHEL }), null);
  assert.ok(speechRules.studioSpeechError({ modelId: sp.FAL_ELEVEN_V3_MODEL, text: "Salom", voice: ADAM }), "Adam is refused");
  assert.ok(speechRules.studioSpeechError({ modelId: sp.FAL_ELEVEN_V3_MODEL, text: "Salom", voice: "clone:11111111-1111-4111-8111-111111111111" }), "a clone is refused");

  const f = fakeFal({ result: { audio: { url: "https://v3.fal.media/out/t.mp3" } }, download: mp3Bytes(120) });
  const adapters = studioSpeechAdapters({ gemini: {} as never, fal: falDeps });
  const out = await withFetch(t, f, () => buildStudioSpeech(tools.TOOL_BY_ID["studio-speech"], { modelId: sp.FAL_ELEVEN_V4_TURBO_MODEL, text: "Assalomu alaykum", voice: RACHEL, stability: "1", lang: "uz" } as never, { clones: {} }, {}, { adapters }));
  assert.equal(out.mime, "audio/mpeg");
  assert.deepEqual(f.calls.find((c) => c.url === "https://queue.fal.run/elevenlabs/tts/eleven-v4-turbo")!.body, { text: "Assalomu alaykum", voice: "Rachel", stability: 1, language_code: "uz", apply_text_normalization: "auto", output_format: "mp3_44100_128" });
  assert.deepEqual(out.doc?.speech?.voices, ["Rachel"]);
});

/* ───────────────────────── rules + glue ───────────────────────── */

test("rules: the chosen model decides; an unknown model and HeyGen's audio source are refused before charging", () => {
  assert.equal(rules.transcribeEntry({ modelId: cat.FAL_SCRIBE_MODEL }).id, cat.FAL_SCRIBE_MODEL);
  assert.equal(rules.transcribeEntry({}).id, cat.TRANSCRIBE_MODEL, "blank = the default");
  assert.equal(rules.dubEntry({ modelId: cat.HEYGEN_TRANSLATE_MODEL }).id, cat.HEYGEN_TRANSLATE_MODEL);
  assert.match(String(rules.studioTranscribeError({ modelId: cat.DUB_MODEL, source: RES })), /Noma'lum model/, "another tool's model");
  assert.match(String(rules.studioDubError({ modelId: "x/y", source: RES })), /Noma'lum model/);
  assert.equal(rules.studioDubError({ modelId: cat.HEYGEN_TRANSLATE_MODEL, source: RES, sourceSeconds: 10 }), null);
  assert.match(String(rules.studioDubError({ modelId: cat.HEYGEN_TRANSLATE_MODEL, source: UP, sourceSeconds: 10 })), /faqat videoni/);
  assert.equal(rules.studioDubError({ modelId: cat.FAL_DUB_MODEL, source: UP, sourceSeconds: 10 }), null, "fal dubbing takes audio");
  assert.match(String(rules.studioDubError({ modelId: cat.HEYGEN_TRANSLATE_MODEL, source: RES, target: "tg" })), /Qaysi tilga/, "not in HeyGen's enum");
  // A value left over from another model does not refuse a model without the field.
  assert.equal(rules.studioDubError({ modelId: cat.HEYGEN_TRANSLATE_MODEL, source: RES, target: "ru", sourceLang: "ru" }), null);
  assert.match(String(rules.studioDubError({ modelId: cat.FAL_DUB_MODEL, source: RES, target: "ru", sourceLang: "ru" })), /bir xil/);
  // The registry calls the same rules.
  assert.match(String(tools.preflightError(tools.TOOL_BY_ID["studio-dub"], { modelId: cat.HEYGEN_TRANSLATE_MODEL, source: UP } as never)), /faqat videoni/);
});

test("glue: the tool opens on the fal model alone; pickers, the model switch, the minute line", () => {
  // The session lists only the fal models (an ElevenLabs key without the permission, its models switched off).
  assert.equal(rules.speechToolOffered("studio-transcribe", [cat.FAL_SCRIBE_MODEL]), true);
  assert.equal(rules.speechToolOffered("studio-dub", [cat.HEYGEN_TRANSLATE_MODEL]), true);
  assert.equal(rules.speechToolOffered("studio-dub", [cat.FAL_SCRIBE_MODEL]), false);
  const features = { llm: true, studioSpeechToolModels: [cat.FAL_SCRIBE_MODEL] };
  assert.equal(tools.toolBlockedReason(tools.TOOL_BY_ID["studio-transcribe"], features as never), null);
  assert.match(String(tools.toolBlockedReason(tools.TOOL_BY_ID["studio-dub"], features as never)), /Dublyaj hozircha/);

  const view = MEDIA_CATALOG.clientView();
  const dubs = view.filter((e) => cat.DUB_MODELS.includes(e.id));
  const tool = glue.offeredSpeechTools(dubs).find((x) => x.mode === "dub")!;
  assert.deepEqual(tool.entries.map((e) => e.id), cat.DUB_MODELS);
  assert.equal(tool.entry.id, cat.DUB_MODEL);
  const falOnly = glue.offeredSpeechTools([clientOf(cat.FAL_SCRIBE_MODEL)]);
  assert.deepEqual(falOnly.map((x) => [x.mode, x.entry.id]), [["transcribe", cat.FAL_SCRIBE_MODEL]]);

  const sources = { video: [{ id: "v", title: "V", kind: "Video", seconds: 5, createdAt: "" }], audio: [{ id: "a", title: "A", kind: "Ovoz", seconds: 5, createdAt: "" }] };
  assert.deepEqual(glue.speechSources("dub", sources as never).map((s) => s.id), ["v", "a"]);
  assert.deepEqual(glue.speechSources("dub", sources as never, true).map((s) => s.id), ["v"], "a video-only model lists no audio");

  const heygen = clientOf(cat.HEYGEN_TRANSLATE_MODEL);
  const audioState = { raw: { source: UP, sourceSeconds: 20, target: "tg", sourceLang: "ru" }, tab: "upload" as const, kind: "audio" as const };
  const next = glue.pickSpeechModel(audioState, heygen);
  assert.equal(next.model, heygen.id);
  assert.deepEqual([next.raw.source, next.raw.sourceSeconds, next.kind, next.tab], [undefined, undefined, null, "result"], "an audio source cannot stay");
  assert.equal(next.raw.target, undefined, "a language HeyGen lacks falls back to the default");
  assert.equal(next.raw.sourceLang, undefined, "the field does not exist there");
  const videoState = { raw: { source: RES, sourceSeconds: 20, target: "ru" }, tab: "result" as const, kind: "video" as const };
  assert.deepEqual(glue.pickSpeechModel(videoState, heygen).raw, { source: RES, sourceSeconds: 20, target: "ru" }, "a video stays");
  assert.equal(glue.pickSpeechModel(audioState, clientOf(cat.FAL_DUB_MODEL)).raw.source, UP, "fal dubbing keeps the audio");

  assert.match(glue.billedLine(clientOf(cat.FAL_DUB_MODEL), 15), /to‘liq daqiqalar.*1 daqiqa/);
  assert.match(glue.billedLine(clientOf(cat.FAL_DUB_MODEL), 61), /2 daqiqa/);
  assert.equal(glue.billedLine(clientOf(cat.FAL_SCRIBE_MODEL), 15), "Narx 15 soniya uchun hisoblanadi.");
});
