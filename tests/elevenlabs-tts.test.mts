import test from "node:test";
import assert from "node:assert/strict";
import {
  ELEVENLABS_MODEL,
  ELEVENLABS_OUTPUT_FORMAT,
  elevenLabsBody,
  elevenLabsUrl,
  makeElevenLabsTts,
  scrubKey,
} from "../lib/generation/tts/elevenlabs.ts";
import { makeTtsChain, ttsGroups } from "../lib/generation/tts/chain.ts";
import { TTS_ELEVENLABS_VOICES, TtsError, type TtsAudio, type TtsProvider, type TtsProviderId, type TtsSynthOpts } from "../lib/generation/tts/types.ts";
import { ttsCost } from "../lib/generation/llm-pricing.ts";
import { trackJobCost } from "../lib/generation/job-cost.ts";
import { providerDef } from "../lib/server/providers/registry.ts";
import { resetProviderCache, setProviderSnapshot } from "../lib/server/providers/resolve.ts";
import { ttsPremiumAvailable, voiceProviderUnavailable } from "../lib/server/env.ts";

/**
 * ELEVENLABS TTS adapter (program-17 item 5, voice part) -- stubbed `fetch`, no network, no paid call.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `xi-api-key` header dropped from the request          -> «request shape»;
 *   2. `scrubKey` made a no-op                                 -> «key never reaches an error / a log line»;
 *   3. ElevenLabs added to the standard chain (`configured`)   -> «parity without a key», «standard chain never uses it»;
 *   4. `opts.provider` ignored by the chain                    -> «premium runs on ElevenLabs only».
 */

const KEY = "sk_test_ELEVENLABS_SECRET_0123456789";

/** Three MPEG-1 Layer III 44.1 kHz 128 kbps frames (417 bytes each): a valid MP3 for `mp3Seconds`. */
function mp3Bytes(frames = 3): Uint8Array {
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) {
    out[i * 417] = 0xff;
    out[i * 417 + 1] = 0xfb;
    out[i * 417 + 2] = 0x90;
    out[i * 417 + 3] = 0x00;
  }
  return out;
}

type Seen = { url: string; init: RequestInit };
function stubFetch(respond: (n: number) => Response): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return respond(seen.length);
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

const audioResponse = () => new Response(Buffer.from(mp3Bytes()), { status: 200, headers: { "content-type": "audio/mpeg" } });

/* ══════════════════════════ request / response ══════════════════════════ */

test("request shape: POST /v1/text-to-speech/{voice}?output_format=mp3_44100_128, xi-api-key header, eleven_v3 body", async () => {
  const { fetchImpl, seen } = stubFetch(() => audioResponse());
  const tts = makeElevenLabsTts({ fetchImpl, key: () => KEY });
  await tts.synthesize("Salom dunyo", { lang: "uz", voice: "voice/with space" });
  assert.equal(seen.length, 1);
  const { url, init } = seen[0]!;
  assert.equal(url, "https://api.elevenlabs.io/v1/text-to-speech/voice%2Fwith%20space?output_format=mp3_44100_128");
  assert.equal(init.method, "POST");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers["xi-api-key"], KEY, "MUTATSIYA: header olib tashlansa qizaradi");
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(init.body)), { text: "Salom dunyo", model_id: "eleven_v3", language_code: "uz" });
  assert.equal(ELEVENLABS_MODEL, "eleven_v3");
  assert.equal(ELEVENLABS_OUTPUT_FORMAT, "mp3_44100_128");
  assert.ok(!url.includes(KEY) && !String(init.body).includes(KEY), "the key is in the header only");
});

test("body: language_code only for a language the model lists; speed -> voice_settings clamped to 0.7..1.2", () => {
  assert.equal(elevenLabsBody("x", { lang: "kaa" }).language_code, undefined, "Karakalpak is not an eleven_v3 language");
  assert.equal(elevenLabsBody("x", { lang: "RU" }).language_code, "ru");
  assert.equal(elevenLabsBody("x", { lang: "uz" }).voice_settings, undefined, "pace 1 sends no voice_settings");
  assert.deepEqual(elevenLabsBody("x", { lang: "uz", speed: 1.1 }).voice_settings, { speed: 1.1 });
  assert.deepEqual(elevenLabsBody("x", { lang: "uz", speed: 3 }).voice_settings, { speed: 1.2 });
  assert.deepEqual(elevenLabsBody("x", { lang: "uz", speed: 0.1 }).voice_settings, { speed: 0.7 });
  assert.match(elevenLabsUrl("abc"), /\/abc\?output_format=mp3_44100_128$/);
});

test("audio bytes: the response body is returned as MP3 with a measured length and the model recorded", async () => {
  const { fetchImpl } = stubFetch(() => audioResponse());
  const audio = await makeElevenLabsTts({ fetchImpl, key: () => KEY }).synthesize("Salom", { lang: "uz", voice: "v1" });
  assert.deepEqual(audio.mp3, mp3Bytes());
  assert.ok(audio.seconds > 0.05 && audio.seconds < 0.2, `3 frames = ~78 ms, got ${audio.seconds}`);
  assert.equal(audio.chars, 5);
  assert.equal(audio.model, "eleven_v3");
});

test("a 200 that is not MP3 (an error page) is rejected, never passed on as a voice", async () => {
  const { fetchImpl } = stubFetch(() => new Response("<html>oops</html>", { status: 200 }));
  await assert.rejects(
    makeElevenLabsTts({ fetchImpl, key: () => KEY }).synthesize("Salom", { lang: "uz", voice: "v1" }),
    (e: unknown) => e instanceof TtsError && e.retryable === false,
  );
});

/* ══════════════════════════ refusals and errors ══════════════════════════ */

test("refusals: policy 400 / auth 401 are not retried; 429 and 5xx are; Retry-After is honoured", async () => {
  const cases: [number, string, boolean][] = [
    [400, JSON.stringify({ detail: { status: "content_against_policy", message: "blocked" } }), false],
    [401, JSON.stringify({ detail: { status: "invalid_api_key", message: "bad key" } }), false],
    [422, JSON.stringify({ detail: [{ loc: ["body", "text"], msg: "field required", type: "missing" }] }), false],
    [429, "{}", true],
    [503, "{}", true],
  ];
  for (const [status, body, retryable] of cases) {
    const { fetchImpl } = stubFetch(() => new Response(body, { status, headers: status === 429 ? { "retry-after": "2" } : {} }));
    const err = await makeElevenLabsTts({ fetchImpl, key: () => KEY })
      .synthesize("Salom", { lang: "uz", voice: "v1" })
      .then(() => null, (e: unknown) => e);
    assert.ok(err instanceof TtsError, `status ${status}`);
    assert.equal(err.retryable, retryable, `status ${status}: retryable`);
    assert.equal(err.status, status);
    if (status === 429) assert.equal(err.retryAfterMs, 2000);
  }
});

test("key never reaches an error message or a log line (even when the provider echoes it)", async () => {
  const echoing = JSON.stringify({ detail: { status: "invalid_api_key", message: `key ${KEY} rejected, xi-api-key: ${KEY}` } });
  const { fetchImpl } = stubFetch(() => new Response(echoing, { status: 401 }));
  const provider = makeElevenLabsTts({ fetchImpl, key: () => KEY });
  const err = await provider.synthesize("Salom", { lang: "uz", voice: "v1" }).then(() => null, (e: unknown) => e as Error);
  assert.ok(err);
  assert.ok(!err.message.includes(KEY), `MUTATSIYA: scrubKey no-op bo'lsa kalit xabarda qoladi: ${err.message}`);
  assert.ok(!/sk_test_/.test(err.message));

  // Through the chain: every log line and the final error.
  const lines: string[] = [];
  const chain = makeTtsChain({ providers: [provider], env: {} as NodeJS.ProcessEnv, log: (l) => lines.push(l) });
  const thrown = await chain.synthesizeAll([{ text: "Salom" }], { lang: "uz", provider: "elevenlabs" }).then(() => null, (e: unknown) => e as Error);
  assert.ok(thrown);
  assert.ok(![...lines, thrown.message].some((l) => l.includes(KEY)), "the key is in no log line");
  assert.equal(scrubKey(`a ${KEY} b`, KEY), "a [key] b");
  // A network failure message that carries the key is scrubbed too.
  const net = makeElevenLabsTts({ fetchImpl: (async () => { throw new Error(`connect failed for ${KEY}`); }) as unknown as typeof fetch, key: () => KEY });
  const neterr = await net.synthesize("Salom", { lang: "uz", voice: "v1" }).then(() => null, (e: unknown) => e as Error);
  assert.ok(neterr && !neterr.message.includes(KEY));
});

test("no key: configured() is false and no request is made", async () => {
  const { fetchImpl, seen } = stubFetch(() => audioResponse());
  const tts = makeElevenLabsTts({ fetchImpl, key: () => "" });
  assert.equal(tts.configured(), false);
  await assert.rejects(tts.synthesize("Salom", { lang: "uz", voice: "v1" }), TtsError);
  assert.equal(seen.length, 0);
});

/* ══════════════════════════ chain: premium is opt-in ══════════════════════════ */

function fake(id: TtsProviderId, configured = true): TtsProvider & { calls: { text: string; voice?: string }[] } {
  const calls: { text: string; voice?: string }[] = [];
  return {
    id,
    calls,
    configured: () => configured,
    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      calls.push({ text, ...(opts.voice !== undefined ? { voice: opts.voice } : {}) });
      return { mp3: mp3Bytes(), seconds: 0.078, chars: text.length };
    },
  };
}

test("premium runs on ElevenLabs only (gender voice A/B), the standard providers are never called", async () => {
  const azure = fake("azure");
  const eleven = fake("elevenlabs");
  const chain = makeTtsChain({ providers: [azure, eleven], env: {} as NodeJS.ProcessEnv, log: () => {} });
  const run = await chain.synthesizeAll([{ text: "Salom", voice: 0 }, { text: "Xayr", voice: 1 }], { lang: "uz", voice: "male", provider: "elevenlabs" });
  assert.equal(azure.calls.length, 0, "MUTATSIYA: opts.provider e'tiborsiz qoldirilsa Azure chaqiriladi");
  assert.deepEqual(eleven.calls.map((c) => c.voice), [TTS_ELEVENLABS_VOICES.male, TTS_ELEVENLABS_VOICES.female]);
  assert.equal(run.provider, "elevenlabs");
  assert.equal(run.voiceA, `elevenlabs:${TTS_ELEVENLABS_VOICES.male}`);
});

test("premium failure does NOT fall back to the standard chain (a cheaper voice at the premium price)", async () => {
  const azure = fake("azure");
  const failing: TtsProvider = { ...fake("elevenlabs"), synthesize: async () => { throw new TtsError("elevenlabs", "401", { retryable: false, status: 401 }); } };
  const chain = makeTtsChain({ providers: [azure, failing], env: {} as NodeJS.ProcessEnv, log: () => {} });
  await assert.rejects(chain.synthesizeAll([{ text: "Salom" }], { lang: "uz", provider: "elevenlabs" }), TtsError);
  assert.equal(azure.calls.length, 0);
});

test("premium without a key fails with a clear error, before any request", async () => {
  const eleven = fake("elevenlabs", false);
  const chain = makeTtsChain({ providers: [fake("azure"), eleven], env: {} as NodeJS.ProcessEnv, log: () => {} });
  await assert.rejects(chain.synthesizeAll([{ text: "Salom" }], { lang: "uz", provider: "elevenlabs" }), /sozlanmagan/);
  assert.equal(eleven.calls.length, 0);
  assert.equal(chain.providerReady?.("elevenlabs"), false);
});

test("parity without a key: the standard chain never uses ElevenLabs, even when it is keyed", async () => {
  const azure = fake("azure");
  const eleven = fake("elevenlabs");
  const chain = makeTtsChain({ providers: [azure, eleven], env: {} as NodeJS.ProcessEnv, log: () => {} });
  assert.deepEqual(chain.providersFor("uz"), ["azure"], "MUTATSIYA: standart zanjirga elevenlabs qo'shilsa qizaradi");
  await chain.synthesizeAll([{ text: "Salom" }], { lang: "uz" });
  assert.equal(eleven.calls.length, 0);
  assert.ok(!ttsGroups("uz", {} as NodeJS.ProcessEnv).some((g) => g.provider === "elevenlabs"));
  // The ElevenLabs key alone does not make the standard voice chain «configured».
  const only = makeTtsChain({ providers: [fake("azure", false), fake("elevenlabs")], env: {} as NodeJS.ProcessEnv, log: () => {} });
  assert.equal(only.configured(), false);
  assert.equal(only.providerReady?.("elevenlabs"), true);
});

test("the operator's TTS_VOICE_<LANG>=elevenlabs:<id> replaces the default premium voices", async () => {
  const eleven = fake("elevenlabs");
  const chain = makeTtsChain({ providers: [eleven], env: { TTS_VOICE_UZ: "elevenlabs:custom123" } as unknown as NodeJS.ProcessEnv, log: () => {} });
  await chain.synthesizeAll([{ text: "Salom" }], { lang: "uz", provider: "elevenlabs", voice: "female" });
  assert.deepEqual(eleven.calls.map((c) => c.voice), ["custom123"]);
});

/* ══════════════════════════ cost, registry, availability ══════════════════════════ */

test("cost: recordTts books the synthesis at the ElevenLabs price ($80 per 1M characters)", async () => {
  const { fetchImpl } = stubFetch(() => audioResponse());
  const chain = makeTtsChain({ providers: [makeElevenLabsTts({ fetchImpl, key: () => KEY })], env: {} as NodeJS.ProcessEnv, log: () => {} });
  const text = "a".repeat(800);
  const tracked = trackJobCost(() => chain.synthesizeAll([{ text }], { lang: "uz", provider: "elevenlabs" }));
  const run = await tracked.promise;
  assert.equal(run.chars, 800);
  const cost = tracked.snapshot().toJson();
  const part = cost.parts?.find((p) => p.provider === "elevenlabs");
  assert.ok(part, "an elevenlabs cost part was recorded");
  assert.equal(part.usd, 0.064, "800 chars x $80/1M");
  assert.equal(ttsCost({ provider: "elevenlabs", chars: 1_000_000 }).usd, 80);
});

test("registry: elevenlabs is implemented; availability follows key AND the admin switch; no key = unavailable", () => {
  assert.equal(providerDef("elevenlabs")?.implemented, true);
  const prev = process.env.ELEVENLABS_API_KEY;
  try {
    delete process.env.ELEVENLABS_API_KEY;
    resetProviderCache();
    assert.equal(ttsPremiumAvailable(), false, "no key");
    assert.match(voiceProviderUnavailable({ voiceProvider: "elevenlabs" }) ?? "", /Premium ovoz/);
    assert.equal(voiceProviderUnavailable({ voiceProvider: "auto" }), null);
    assert.equal(voiceProviderUnavailable({}), null, "an old client");

    process.env.ELEVENLABS_API_KEY = KEY;
    assert.equal(ttsPremiumAvailable(), true, "env key");
    assert.equal(voiceProviderUnavailable({ voiceProvider: "elevenlabs" }), null);

    setProviderSnapshot(new Map([["elevenlabs", { enabled: false, key: null, unreadable: false }]]));
    assert.equal(ttsPremiumAvailable(), false, "switched off in «Provayderlar» even with an env key");
    assert.notEqual(voiceProviderUnavailable({ voiceProvider: "elevenlabs" }), null);

    setProviderSnapshot(new Map([["elevenlabs", { enabled: true, key: "sk_db_key_0123456789", unreadable: false }]]));
    assert.equal(ttsPremiumAvailable(), true, "DB key");
  } finally {
    if (prev === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = prev;
    resetProviderCache();
  }
});
