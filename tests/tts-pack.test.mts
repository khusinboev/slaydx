import test from "node:test";
import assert from "node:assert/strict";
import { packParts } from "../lib/generation/tts/pack.ts";
import { makeTtsChain } from "../lib/generation/tts/chain.ts";
import { makeGeminiTts } from "../lib/generation/tts/gemini.ts";
import { TTS_LIMITS, TtsError, ttsChunkLimit, type TtsAudio, type TtsProvider, type TtsProviderId, type TtsSynthOpts } from "../lib/generation/tts/types.ts";
import { speechParts } from "../lib/generation/audio/script.ts";
import type { AudioLine } from "../lib/generation/audio/types.ts";

/**
 * Gemini TTS has a per-minute REQUEST quota, so Gemini requests are packed up to 2 400 chars
 * (Azure/Aisha keep one request per <=900-char part). These tests lock:
 *   - the per-provider limit (Gemini 2 400, others 900);
 *   - call counts for a 1-minute greeting and a 2-minute dialog podcast (a fake provider);
 *   - a dialog still alternates voices (two-speaker request; one-speaker chunks otherwise);
 *   - no part is ever split or reordered, no text lost.
 *
 * Mutations checked: chunk size back to 900 (counts + limit tests fail); packing disabled
 * (counts fail); multi-speaker disabled (podcast count + voice tests fail).
 */

const ENV = {} as unknown as NodeJS.ProcessEnv;
const AUDIO: TtsAudio = { mp3: new Uint8Array([0xff, 0xfb, 0x90, 0x00]), seconds: 1, chars: 5 };

type Seen = { text: string; voice?: string; turns?: { voice: string; text: string }[] };

function fake(id: TtsProviderId, multiSpeaker = false): TtsProvider & { seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    id,
    seen,
    configured: () => true,
    ...(multiSpeaker ? { multiSpeaker: true } : {}),
    async synthesize(text: string, opts: TtsSynthOpts) {
      seen.push({ text, ...(opts.voice !== undefined ? { voice: opts.voice } : {}), ...(opts.turns ? { turns: opts.turns } : {}) });
      return AUDIO;
    },
  };
}

/** A sentence of EXACTLY `len` chars. */
const sentence = (n: number, len: number): string => {
  const head = `Gap ${n} `;
  return `${head}${"x".repeat(Math.max(0, len - head.length - 1))}.`;
};

/** ~1 minute greeting: 11 short lines, one speaker (what the engine produced 11 calls for). */
const greeting = (): AudioLine[] => Array.from({ length: 11 }, (_, i) => ({ speaker: "A", text: sentence(i, 85) }));
/** ~2 minute podcast: 9 alternating turns, ~200 chars each. */
const podcast = (turns = 9, len = 200): AudioLine[] => Array.from({ length: turns }, (_, i) => ({ speaker: i % 2 ? "B" : "A", text: sentence(i, len) }));

const chainOf = (p: TtsProvider) => makeTtsChain({ providers: [p], env: ENV, log: () => {} });

test("limits: Gemini 2 400 chars, every other provider keeps 900", () => {
  assert.equal(TTS_LIMITS.geminiChunkChars, 2_400);
  assert.equal(ttsChunkLimit("gemini"), 2_400);
  for (const id of ["azure", "aisha", "google", "elevenlabs"] as const) assert.equal(ttsChunkLimit(id), 900, id);
  assert.equal(TTS_LIMITS.chunkChars, 900);
});

test("packParts: Azure/Aisha are NOT packed (one request per part, pauses kept)", () => {
  const parts = [{ text: "a", voice: 0, pauseMs: 100 }, { text: "b", voice: 0, pauseMs: 200 }];
  const out = packParts(parts, { provider: "azure", multiSpeaker: false, twoVoices: true });
  assert.deepEqual(out.map((c) => [c.text, c.voice, c.pauseMs]), [["a", 0, 100], ["b", 0, 200]]);
  assert.equal(packParts(parts, { provider: "aisha" }).length, 2);
});

test("packParts: Gemini merges same-voice parts up to 2 400 and never splits a part", () => {
  const parts = Array.from({ length: 8 }, (_, i) => ({ text: sentence(i, 800), voice: 0 }));
  const out = packParts(parts, { provider: "gemini", multiSpeaker: true, twoVoices: false });
  // 800-char parts: two fit (1 601 chars), a third would make 2 402 > 2 400.
  assert.deepEqual(out.map((c) => c.text.length), [1_601, 1_601, 1_601, 1_601]);
  assert.equal(out.map((c) => c.text).join(" "), parts.map((p) => p.text).join(" "), "text lost or reordered");
  for (const c of out) assert.ok(c.text.length <= TTS_LIMITS.geminiChunkChars);
});

test("packParts: one-voice group (both roles share a voice) never alternates, even in a dialog", () => {
  const parts = [0, 1, 0, 1].map((voice, i) => ({ text: sentence(i, 100), voice }));
  const out = packParts(parts, { provider: "gemini", multiSpeaker: true, twoVoices: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].turns, undefined);
});

test("packParts: dialog without multi-speaker support -> chunks of consecutive turns of ONE speaker", () => {
  const parts = [0, 0, 1, 1, 0].map((voice, i) => ({ text: sentence(i, 100), voice }));
  const out = packParts(parts, { provider: "gemini", multiSpeaker: false, twoVoices: true });
  assert.deepEqual(out.map((c) => c.voice), [0, 1, 0]);
  assert.ok(out.every((c) => c.turns === undefined));
});

test("packParts: dialog with multi-speaker -> alternating turns in one request, same-speaker neighbours merged", () => {
  const parts = [0, 0, 1, 0].map((voice, i) => ({ text: `t${i}`, voice }));
  const [call, ...rest] = packParts(parts, { provider: "gemini", multiSpeaker: true, twoVoices: true });
  assert.equal(rest.length, 0);
  assert.deepEqual(call.turns, [{ voice: 0, text: "t0 t1" }, { voice: 1, text: "t2" }, { voice: 0, text: "t3" }]);
});

test("packParts: the 2 400 cap counts the speaker labels of a dialog request", () => {
  const parts = Array.from({ length: 30 }, (_, i) => ({ text: sentence(i, 200), voice: i % 2 }));
  const out = packParts(parts, { provider: "gemini", multiSpeaker: true, twoVoices: true });
  assert.ok(out.length >= 3);
  for (const c of out) {
    const rendered = (c.turns ?? [{ voice: c.voice, text: c.text }]).map((t) => `Speaker${t.voice + 1}: ${t.text}`).join("\n");
    assert.ok(rendered.length <= TTS_LIMITS.geminiChunkChars, `request of ${rendered.length} chars`);
  }
});

test("calls per job: 1-min greeting 11 -> 1 on Gemini (Azure unchanged: 11)", async () => {
  const parts = speechParts(greeting());
  assert.equal(parts.length, 11);

  const gem = fake("gemini", true);
  await chainOf(gem).synthesizeAll(parts, { lang: "uz" });
  assert.equal(gem.seen.length, 1);

  const az = fake("azure");
  await chainOf(az).synthesizeAll(parts, { lang: "uz" });
  assert.equal(az.seen.length, 11, "Azure keeps one call per part");
});

test("calls per job: 2-min dialog podcast 9 -> 1 on Gemini (Azure unchanged: 9), voices still alternate", async () => {
  const parts = speechParts(podcast());
  assert.equal(parts.length, 9);

  const gem = fake("gemini", true);
  await chainOf(gem).synthesizeAll(parts, { lang: "uz", voice: "female" });
  assert.equal(gem.seen.length, 1);
  const turns = gem.seen[0].turns ?? [];
  assert.equal(turns.length, 9, "every turn keeps its own speaker slot");
  assert.deepEqual(new Set(turns.map((t) => t.voice)).size, 2);
  assert.ok(turns.every((t, i) => i === 0 || t.voice !== turns[i - 1].voice), "voices must alternate A,B,A,B…");

  const az = fake("azure");
  await chainOf(az).synthesizeAll(parts, { lang: "uz" });
  assert.equal(az.seen.length, 9);
});

test("calls per job: a long 5-min podcast (~4 500 chars) needs <= ceil(chars/2400)+1 Gemini calls", async () => {
  const script = podcast(18, 250);
  const total = script.reduce((n, l) => n + l.text.length, 0);
  const gem = fake("gemini", true);
  await chainOf(gem).synthesizeAll(speechParts(script), { lang: "uz" });
  assert.ok(gem.seen.length <= Math.ceil(total / TTS_LIMITS.geminiChunkChars) + 1, `${gem.seen.length} calls for ${total} chars`);
  assert.ok(gem.seen.length >= 2);
});

test("a part longer than the provider limit still fails (contract), Gemini limit is 2 400 not 900", async () => {
  const gem = fake("gemini", true);
  await assert.rejects(() => chainOf(gem).synthesizeAll([{ text: "x".repeat(2_401) }], { lang: "uz" }), (e) => e instanceof TtsError && /2400/.test(e.message));
  // 1 500 chars is fine on Gemini …
  await chainOf(gem).synthesizeAll([{ text: "y".repeat(1_500) }], { lang: "uz" });
  assert.equal(gem.seen.length, 1);
  // … but not on Azure (900).
  await assert.rejects(() => chainOf(fake("azure")).synthesizeAll([{ text: "y".repeat(1_500) }], { lang: "uz" }), TtsError);
});

test("Gemini wire: a two-speaker request sends multiSpeakerVoiceConfig + 'Speaker1:/Speaker2:' text; chars exclude the labels", async () => {
  type Body = { contents: { parts: { text: string }[] }[]; generationConfig: { speechConfig: Record<string, unknown> } };
  const box: { body?: Body } = {};
  const pcm = Buffer.from(new Uint8Array(48_000)).toString("base64");
  const real = makeGeminiTts({
    key: () => "k",
    model: () => "gemini-2.5-flash-preview-tts",
    fetchImpl: (async (_u: unknown, init: RequestInit) => {
      box.body = JSON.parse(String(init.body)) as Body;
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm } }] } }] });
    }) as unknown as typeof fetch,
  });
  const audio = await real.synthesize("ignored", {
    lang: "uz",
    voice: "Kore",
    turns: [{ voice: "Kore", text: "Salom" }, { voice: "Charon", text: "Assalomu alaykum" }, { voice: "Kore", text: "Yaxshimisiz" }],
  });
  assert.ok(box.body);
  const sent = box.body;
  assert.equal(sent.contents[0].parts[0].text, "Speaker1: Salom\nSpeaker2: Assalomu alaykum\nSpeaker1: Yaxshimisiz");
  assert.deepEqual(sent.generationConfig.speechConfig, {
    multiSpeakerVoiceConfig: {
      speakerVoiceConfigs: [
        { speaker: "Speaker1", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
        { speaker: "Speaker2", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
      ],
    },
  });
  assert.equal(audio.chars, "Salom".length + "Assalomu alaykum".length + "Yaxshimisiz".length);
});
