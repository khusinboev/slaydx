import test from "node:test";
import assert from "node:assert/strict";
import { chainOfProvider, groupForChoice, makeTtsChain, ttsGroups } from "../lib/generation/tts/chain.ts";
import { makeGeminiTts } from "../lib/generation/tts/gemini.ts";
import { makeAishaTts } from "../lib/generation/tts/aisha.ts";
import { pcmToWav } from "../lib/generation/tts/mp3.ts";
import {
  TTS_GEMINI_VOICES,
  TTS_VOICE_CHOICES,
  TTS_VOICE_DEFAULT,
  TtsError,
  normalizeVoiceChoice,
  otherVoiceChoice,
  ttsChoiceVoices,
  ttsVoiceForChoice,
  ttsVoicesFor,
  type TtsAudio,
  type TtsProvider,
  type TtsProviderId,
  type TtsSynthOpts,
} from "../lib/generation/tts/types.ts";
import { ALL_LANGUAGES } from "../lib/languages.ts";
import { audioInputFromValues, encodeAudioValues } from "../lib/generation/audio/input.ts";
import { AUDIO_VOICE_OPTIONS } from "../lib/generation/audio/registry.ts";
import type { DocMeta } from "../lib/generation/types.ts";

/**
 * VOICE CHOICE (female / male) — provider mapping, chain and input bridge.
 *
 * Contract (owner request 2026-10-10):
 *   • Gemini female = `Kore`, male = `Charon`;
 *   • Azure: the language's own female/male pair (uz: Madina / Sardor); a language
 *     with no row of that gender falls back to the table default;
 *   • Aisha: its single voice — the choice is ignored;
 *   • role A (single-speaker audio, or the lead of a dialog) = the chosen voice,
 *     role B = the other gender's.
 * The engine-level proof (greeting / monologue / dialog through `buildAudioArtifact`)
 * lives in `tests/audio-params.test.mts`; the route / job-values proof in
 * `tests/audio-voice-route.test.mts`.
 *
 * Mutations (each makes a test below fail):
 *   1. `ttsVoiceForChoice` ignores the choice (always the first row)   -> mapping + chain tests;
 *   2. `ttsChoiceVoices` returns [a, a] (role B keeps the chosen voice) -> dialog swap tests;
 *   3. `groupForChoice` returns the group untouched                     -> every chain test;
 *   4. Gemini adapter sends the default voice instead of `opts.voice`   -> Gemini wire test;
 *   5. `TTS_GEMINI_VOICES.male` = "Kore"                                -> mapping + Gemini tests.
 */

const envOf = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

type Rec = { text: string; voice?: string };

function fake(id: TtsProviderId): TtsProvider & { calls: Rec[] } {
  const calls: Rec[] = [];
  return {
    id,
    calls,
    configured: () => true,
    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      calls.push({ text, ...(opts.voice !== undefined ? { voice: opts.voice } : {}) });
      return { mp3: new Uint8Array([1, 2, 3]), seconds: 1, chars: text.length };
    },
  };
}

/** Dialog parts: roles alternate A, B, A, B … (role index 0 / 1). */
const dialog = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `gap ${i}`, voice: i % 2 }));
/** Single-speaker parts: every part role A. */
const monologue = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `gap ${i}`, voice: 0 }));

/* ══════════════════════════ mapping tables ══════════════════════════ */

test("normalizeVoiceChoice: female | male, everything else (old clients, junk) -> female", () => {
  assert.deepEqual([...TTS_VOICE_CHOICES], ["female", "male"]);
  assert.equal(TTS_VOICE_DEFAULT, "female");
  assert.equal(normalizeVoiceChoice("male"), "male");
  assert.equal(normalizeVoiceChoice(" MALE "), "male");
  assert.equal(normalizeVoiceChoice("female"), "female");
  for (const bad of [undefined, null, "", "robot", "m", 0, 1, true, {}, []]) assert.equal(normalizeVoiceChoice(bad), "female", `value ${JSON.stringify(bad)}`);
  assert.equal(otherVoiceChoice("female"), "male");
  assert.equal(otherVoiceChoice("male"), "female");
});

test("mapping: Gemini Kore / Charon; Azure uz Madina / Sardor; Aisha ignores the choice", () => {
  assert.deepEqual(TTS_GEMINI_VOICES, { female: "Kore", male: "Charon" });
  assert.equal(ttsVoiceForChoice("gemini", "uz", "female"), "Kore");
  assert.equal(ttsVoiceForChoice("gemini", "uz", "male"), "Charon");
  // Gemini is language-neutral.
  assert.equal(ttsVoiceForChoice("gemini", "ja", "male"), "Charon");

  assert.equal(ttsVoiceForChoice("azure", "uz", "female"), "uz-UZ-MadinaNeural");
  assert.equal(ttsVoiceForChoice("azure", "uz", "male"), "uz-UZ-SardorNeural");

  // Aisha has ONE voice: both choices land on it.
  assert.equal(ttsVoiceForChoice("aisha", "uz", "female"), "gulnoza");
  assert.equal(ttsVoiceForChoice("aisha", "uz", "male"), "gulnoza");

  // A provider with no table row for the language -> null (the operator's list stays).
  assert.equal(ttsVoiceForChoice("elevenlabs", "uz", "male"), null);
});

test("mapping: every language with a female/male Azure pair uses it; one-voice languages use the table default", () => {
  const pair: string[] = [];
  const single: string[] = [];
  for (const l of ALL_LANGUAGES) {
    const rows = ttsVoicesFor(l.value).filter((v) => v.provider === "azure");
    const f = ttsVoiceForChoice("azure", l.value, "female");
    const m = ttsVoiceForChoice("azure", l.value, "male");
    assert.ok(f && m, `${l.value}: no Azure voice`);
    if (rows.some((v) => v.gender === "male") && rows.some((v) => v.gender === "female")) {
      pair.push(l.value);
      assert.notEqual(f, m, `${l.value}: female and male must differ`);
      assert.equal(rows.find((v) => v.voice === f)?.gender, "female", `${l.value}: female voice is not a female row`);
      assert.equal(rows.find((v) => v.voice === m)?.gender, "male", `${l.value}: male voice is not a male row`);
    } else {
      single.push(l.value);
      assert.equal(f, m, `${l.value}: one-voice language must not invent a second voice`);
      assert.equal(f, rows[0].voice, `${l.value}: must be the table default`);
    }
  }
  assert.ok(pair.length >= 14, `expected a pair for the 14 verified languages, got ${pair.join(",")}`);
  assert.deepEqual(single.sort(), ["kaa", "ky", "tg", "tk"]);
  // An unknown language reads from the fallback (Uzbek) table, like ttsVoicesFor.
  assert.equal(ttsVoiceForChoice("azure", "xx", "male"), "uz-UZ-SardorNeural");
});

test("ttsChoiceVoices: role A = chosen gender, role B = the other gender", () => {
  assert.deepEqual(ttsChoiceVoices("azure", "uz", "female"), ["uz-UZ-MadinaNeural", "uz-UZ-SardorNeural"]);
  assert.deepEqual(ttsChoiceVoices("azure", "uz", "male"), ["uz-UZ-SardorNeural", "uz-UZ-MadinaNeural"]);
  assert.deepEqual(ttsChoiceVoices("gemini", "uz", "female"), ["Kore", "Charon"]);
  assert.deepEqual(ttsChoiceVoices("gemini", "uz", "male"), ["Charon", "Kore"]);
  // Aisha: no second voice, both roles share the only one.
  assert.deepEqual(ttsChoiceVoices("aisha", "uz", "male"), ["gulnoza", "gulnoza"]);
  assert.equal(ttsChoiceVoices("elevenlabs", "uz", "male"), null);
});

test("groupForChoice: no choice leaves the group; unknown provider keeps the operator's voices", () => {
  const g = { provider: "azure" as const, voices: ["uz-UZ-SardorNeural"] };
  assert.equal(groupForChoice(g, "uz", undefined), g);
  assert.deepEqual(groupForChoice(g, "uz", "female").voices, ["uz-UZ-MadinaNeural", "uz-UZ-SardorNeural"]);
  const custom = { provider: "elevenlabs" as const, voices: ["my-voice"] };
  assert.equal(groupForChoice(custom, "uz", "male"), custom);
});

/* ══════════════════════════ chain: voice names reach the provider ══════════════════════════ */

test("chain (azure): a single-speaker job is read entirely in the chosen voice", async () => {
  for (const [choice, want] of [["female", "uz-UZ-MadinaNeural"], ["male", "uz-UZ-SardorNeural"]] as const) {
    const azure = fake("azure");
    const chain = makeTtsChain({ providers: [azure], env: envOf({}), log: () => {} });
    const run = await chain.synthesizeAll(monologue(3), { lang: "uz", voice: choice });
    assert.deepEqual(azure.calls.map((c) => c.voice), [want, want, want], choice);
    assert.equal(run.voiceA, `azure:${want}`);
    assert.deepEqual(run.usages.map((u) => u.voice), [want, want, want]);
  }
});

test("chain (azure): a dialog swaps — the choice decides who leads", async () => {
  const f = fake("azure");
  await makeTtsChain({ providers: [f], env: envOf({}), log: () => {} }).synthesizeAll(dialog(4), { lang: "uz", voice: "female" });
  assert.deepEqual(f.calls.map((c) => c.voice), ["uz-UZ-MadinaNeural", "uz-UZ-SardorNeural", "uz-UZ-MadinaNeural", "uz-UZ-SardorNeural"]);

  const m = fake("azure");
  const run = await makeTtsChain({ providers: [m], env: envOf({}), log: () => {} }).synthesizeAll(dialog(4), { lang: "uz", voice: "male" });
  assert.deepEqual(m.calls.map((c) => c.voice), ["uz-UZ-SardorNeural", "uz-UZ-MadinaNeural", "uz-UZ-SardorNeural", "uz-UZ-MadinaNeural"]);
  // The run reports the swap for the model (`AudioModel.voice` / `voiceB`).
  assert.equal(run.voiceA, "azure:uz-UZ-SardorNeural");
  assert.equal(run.voiceB, "azure:uz-UZ-MadinaNeural");
});

test("chain: no choice = the previous behaviour (group order), so the listening game is untouched", async () => {
  const azure = fake("azure");
  await makeTtsChain({ providers: [azure], env: envOf({}), log: () => {} }).synthesizeAll(dialog(2), { lang: "uz" });
  assert.deepEqual(azure.calls.map((c) => c.voice), ["uz-UZ-MadinaNeural", "uz-UZ-SardorNeural"]);
});

test("chain: TTS_VOICE_<LANG> decides which providers run and in what order; the choice decides the voice", async () => {
  const azure = fake("azure");
  // The operator pinned Sardor, but the user asked for the female voice -> Madina.
  const chain = makeTtsChain({ providers: [azure], env: envOf({ TTS_VOICE_UZ: "azure:uz-UZ-SardorNeural" }), log: () => {} });
  await chain.synthesizeAll(monologue(2), { lang: "uz", voice: "female" });
  assert.deepEqual(azure.calls.map((c) => c.voice), ["uz-UZ-MadinaNeural", "uz-UZ-MadinaNeural"]);

  // A provider the table has no row for keeps the operator's voice whatever the choice.
  const eleven = fake("elevenlabs");
  const chain2 = makeTtsChain({ providers: [eleven], env: envOf({ TTS_VOICE_UZ: "elevenlabs:my-voice" }), log: () => {} });
  await chain2.synthesizeAll(monologue(1), { lang: "uz", voice: "male" });
  assert.deepEqual(eleven.calls.map((c) => c.voice), ["my-voice"]);
});

test("chain (aisha): the single voice is used whatever the choice", async () => {
  const aisha = fake("aisha");
  const chain = makeTtsChain({ providers: [aisha], env: envOf({ TTS_VOICE_UZ: "aisha:gulnoza" }), log: () => {} });
  await chain.synthesizeAll(dialog(2), { lang: "uz", voice: "male" });
  assert.deepEqual(aisha.calls.map((c) => c.voice), ["gulnoza", "gulnoza"]);

  const wire: Record<string, unknown>[] = [];
  const real = makeAishaTts({
    key: () => "k",
    fetchImpl: (async (_u: unknown, init: RequestInit) => {
      wire.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(pcmToWav(new Uint8Array(32_000), { sampleRate: 16_000, channels: 1, bits: 16 }) as unknown as ArrayBuffer, { headers: { "content-type": "audio/wav" } });
    }) as unknown as typeof fetch,
  });
  await makeTtsChain({ providers: [real], env: envOf({}), log: () => {} }).synthesizeAll(monologue(1), { lang: "uz", voice: "male" });
  assert.equal(wire[0].model, "gulnoza");
});

test("chain (table path): Gemini is the last group and a Gemini-only deployment works in any language", async () => {
  // `TTS_VOICE_*` is not set, so the table path decides. Gemini is configured, Azure/Aisha are not.
  const gemini = fake("gemini");
  const azure = { ...fake("azure"), configured: () => false };
  const aisha = { ...fake("aisha"), configured: () => false };
  const chain = makeTtsChain({ providers: [azure, aisha, gemini], env: envOf({}), log: () => {} });
  assert.deepEqual(ttsGroups("ja", envOf({})).map((g) => g.provider), ["azure", "gemini"]);
  assert.deepEqual(chain.providersFor("ja"), ["gemini"]);

  await chain.synthesizeAll(dialog(2), { lang: "ja", voice: "male" });
  assert.deepEqual(gemini.calls.map((c) => c.voice), ["Charon", "Kore"]);
  const g2 = fake("gemini");
  await makeTtsChain({ providers: [{ ...fake("azure"), configured: () => false }, g2], env: envOf({}), log: () => {} }).synthesizeAll(monologue(2), { lang: "uz", voice: "female" });
  assert.deepEqual(g2.calls.map((c) => c.voice), ["Kore", "Kore"]);
});

test("chain (Gemini wire): the voiceName sent to the API is Kore for female, Charon for male", async () => {
  const sent: string[] = [];
  const geminiOk = () =>
    Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from(new Uint8Array(48_000)).toString("base64") } }] } }] });
  const real = makeGeminiTts({
    key: () => "k",
    model: () => "gemini-2.5-flash-preview-tts",
    fetchImpl: (async (_u: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } } };
      sent.push(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName);
      return geminiOk();
    }) as unknown as typeof fetch,
  });
  const only = () => makeTtsChain({ providers: [real], env: envOf({}), log: () => {} });

  await only().synthesizeAll(monologue(2), { lang: "uz", voice: "female" });
  await only().synthesizeAll(monologue(2), { lang: "uz", voice: "male" });
  await only().synthesizeAll(dialog(2), { lang: "uz", voice: "male" });
  assert.deepEqual(sent, ["Kore", "Kore", "Charon", "Charon", "Charon", "Kore"]);
});

test("chainOfProvider: explicit voices win (test seam); otherwise the table + choice apply", async () => {
  const a = fake("azure");
  await chainOfProvider(a, ["x-A", "x-B"]).synthesizeAll(dialog(2), { lang: "uz", voice: "male" });
  assert.deepEqual(a.calls.map((c) => c.voice), ["x-A", "x-B"]);

  const b = fake("azure");
  await chainOfProvider(b).synthesizeAll(dialog(2), { lang: "uz", voice: "male" });
  assert.deepEqual(b.calls.map((c) => c.voice), ["uz-UZ-SardorNeural", "uz-UZ-MadinaNeural"]);

  // Never a thrown surprise for a provider that is not configured.
  await assert.rejects(() => chainOfProvider({ ...fake("azure"), configured: () => false }).synthesizeAll(monologue(1), { lang: "uz", voice: "male" }), TtsError);
});

/* ══════════════════════════ input bridge + form options ══════════════════════════ */

const META = {} as unknown as DocMeta;

test("audio input: voice is normalized and round-trips through encodeAudioValues", () => {
  for (const kind of ["podcast", "greeting"] as const) {
    assert.equal(audioInputFromValues(kind, META, {}).voice, "female", `${kind}: missing -> female`);
    assert.equal(audioInputFromValues(kind, META, { voice: "male" }).voice, "male");
    assert.equal(audioInputFromValues(kind, META, { voice: "robot" }).voice, "female", `${kind}: unknown -> female`);
    const enc = encodeAudioValues(audioInputFromValues(kind, META, { voice: "male" }));
    assert.equal(enc.voice, "male", `${kind}: voice must survive encode`);
  }
});

test("form options: exactly two voices, female first, each with its own sample file", () => {
  assert.deepEqual(AUDIO_VOICE_OPTIONS.map((o) => o.value), [...TTS_VOICE_CHOICES]);
  assert.deepEqual(AUDIO_VOICE_OPTIONS.map((o) => o.label), ["👩 Ayol ovozi", "👨 Erkak ovozi"]);
  assert.deepEqual(AUDIO_VOICE_OPTIONS.map((o) => o.sample), ["/audio/voices/female.mp3", "/audio/voices/male.mp3"]);
});
