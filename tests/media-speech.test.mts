import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { MediaError, resetBreakers, snapshotBreakers, type AdapterInput } from "../lib/studio-core/index.ts";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "../lib/media/catalog.ts";
import { withMediaContext } from "../lib/media/context.ts";
import { SPEECH_PROVIDER_TO_MEDIA, SpeechMediaError, speechAdapter, speechCallOf, speechExtraOf, speechRoute, toSpeechError, unwrapSpeechError } from "../lib/media/adapters/speech.ts";
import { chainOfProvider, makeTtsChain, providerOfChain, type TtsChain, type TtsClock, type TtsRun } from "../lib/generation/tts/chain.ts";
import { makeAzureTts } from "../lib/generation/tts/azure.ts";
import { GEMINI_DAILY_QUOTA_MESSAGE, makeGeminiTts } from "../lib/generation/tts/gemini.ts";
import { TtsError, type TtsAudio, type TtsProvider, type TtsProviderId, type TtsSynthOpts } from "../lib/generation/tts/types.ts";
import { AUDIO_KINDS, type AudioLine } from "../lib/generation/audio/types.ts";
import { audioVoicePurpose, buildAudioArtifact } from "../lib/generation/audio/engine.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOLS } from "../lib/tools.ts";
import { UserFacingError } from "../lib/server/user-error.ts";
import type { FormValues, ToolConfig } from "../lib/types.ts";
import type { CompleteFn } from "../lib/generation/research/pipeline.ts";

/**
 * SPEECH ON THE MEDIA CORE (docs/studio/P0-SPEC.md §6.5) — `media.core.speech`.
 *
 *   adapter  : `TtsProvider` → `MediaAdapter` (ids are the catalog routes', the call is the chain's own, `TtsError` →
 *              `MediaError` keeps retryable / status and sets `accepted` only for a timeout), and the provider's own
 *              exception comes back out of the core untouched (`unwrapSpeechError`);
 *   params   : the exact text and every option travel to the provider (the core's normalized text is only the quote);
 *   chain    : ON — one `media_jobs` row per chunk (purpose, catalog model, provider, upstream, key, status, cost), the
 *              fallback provider that served the job is the one recorded, a retried chunk is one row, packed Gemini
 *              chunks are one row each; OFF / no context / no label / a provider the catalog does not sell — the core
 *              is never touched (breaker registry untouched, no row);
 *   parity   : the real Azure and Gemini providers over a stubbed `fetch` get the SAME requests, pacing calls, waits
 *              and the SAME `TtsRun` with the switch OFF (no context), OFF (context) and ON; a Gemini 429 wait / daily
 *              quota behaves the same; the audio engine returns the same MP3 and cost for podcast and greeting;
 *   callers  : podcast / greeting / listening / domla each name their own purpose; listening synthesizes one chain run
 *              per word and every word gets its own row; domla (own worker loop, no build context) attaches its rows to
 *              the deck the defence is about and records nothing when that deck is gone.
 *
 * Mutations (each turned the named tests red, then was restored; test titles shortened):
 *   1. `turns` / `pauseMs` / `speed` / `timeoutMs` dropped from `speechExtraOf`, one at a time -> «params: the call the
 *      provider gets…» for all four, plus «parity: Gemini dialog» (turns), «parity: Azure» and «audio engine: same MP3»
 *      (pauseMs), «parity: Azure» and «params: …exact text» (speed), «parity: the options…» (timeoutMs);
 *   2. `text` removed from `speechExtraOf` (the provider gets the core's whitespace-collapsed text) -> «params: the call…»,
 *      «params: the provider gets the exact text»;
 *   3. `toSpeechError`: `accepted` true for HTTP errors / never true / `retryable` always true -> «adapter: failure mapping»;
 *   4. `unwrapSpeechError` hands back the `MediaError` instead of the provider's exception -> «adapter: failure mapping»,
 *      «fallback», «ON: a retried chunk…», «parity: Gemini 429», «parity: Gemini daily quota»;
 *   5. step without the provider (`speech:<chunk>`) -> «ON: one row per chunk», «ON: packed Gemini», «fallback»,
 *      «listening», «domla: ON»;
 *   6. step without the run's `scope` -> «listening: one row per word», «domla: ON»;
 *   7. chain ignores `mediaCoreOn("speech")` -> «OFF: the core is never touched», «ON: no row without the switch…»,
 *      «fallback», «parity: Azure», «audio engine: same MP3», «domla: OFF…»; a run without a label uses the core when the
 *      switch is on -> «ON: no row without the switch…»;
 *   8. the chain never uses the core -> «ON: one row per chunk», «ON: packed Gemini», «ON: a retried chunk», «fallback»,
 *      «parity: Azure / Gemini dialog / 429 / daily quota» (rows), «audio engine: same MP3», «listening», «domla: ON»;
 *   9. `text` left out of `values` in `synthesizeViaCore` (a $0 quote) -> «ON: one row per chunk», «ON: packed Gemini»,
 *      «listening»;
 *  10. Gemini `upstream` hook removed (row says `gemini`, not the model) -> «ON: packed Gemini chunks»;
 *  11. `audioVoicePurpose` constant `podcast.voice` -> «purposes: …», «audio engine: purpose per kind», «audio engine: same
 *      MP3»; the engine stops passing the label -> «audio engine: purpose per kind», «audio engine: same MP3»;
 *  12. domla: scope without the job id -> «domla: ON»; core context without the switch check -> «domla: ON» (OFF half),
 *      «domla: OFF…»; context for a null generation (orphan rows) -> «domla: OFF…, no generation»;
 *  13. `SPEECH_PROVIDER_TO_MEDIA.azure` -> `aisha/tts` -> «catalog: every speech provider» and every Azure row test;
 *  14. `providerOfChain` run counter removed -> «providerOfChain: label per word», «listening: one row per word»;
 *      `media` not forwarded by `makeTtsChain` -> every chain «ON» test; by `chainOfProvider` -> «audio engine: same MP3»,
 *      «listening», «domla: ON».
  */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-media-speech-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
process.env.GEMINI_API_KEY = "AIza-test-gemini-key-0123456789";
process.env.TTS_GEMINI_MODEL = "gemini-2.5-flash-preview-tts";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("mediaspeech") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";
const db = skip ? null : await import("../lib/server/db.ts");
if (db) await db.migrate();
after(async () => {
  if (!db) return;
  await db.pool().end();
  await iso.drop();
});

const settingsMod = skip ? null : await import("../lib/server/settings.ts");
const routeResolve = skip ? null : await import("../lib/server/providers/route-resolve.ts");

/* ══════════════════════════ fixtures ══════════════════════════ */

const envOf = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const EMPTY_ENV = envOf({});

/** MPEG2 / 24 kHz / 96 kbps mono frame (288 bytes), what Azure answers with. */
function mp3Of(frames: number): Uint8Array {
  const out = new Uint8Array(288 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xf3, 0xa4, 0xc0], i * 288);
  return out;
}
const FRAME_SECONDS = 576 / 24_000;
const arrayBufferOf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

type Rec = { text: string; opts: TtsSynthOpts };

/** A provider that records its calls; `script(n, text)` returns the error call number `n` (1-based) throws, if any. */
function fake(id: TtsProviderId, script: (n: number, text: string) => Error | null = () => null): TtsProvider & { calls: Rec[] } {
  const calls: Rec[] = [];
  return {
    id,
    calls,
    configured: () => true,
    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      calls.push({ text, opts: { ...opts } });
      const err = script(calls.length, text);
      if (err) throw err;
      if (id === "aisha") return { wav: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]), seconds: 1, chars: text.length };
      return { mp3: mp3Of(2), seconds: 2 * FRAME_SECONDS, chars: text.length };
    },
  };
}

function clock() {
  const s = { t: 1_000_000, sleeps: [] as number[] };
  const c: TtsClock = {
    now: () => s.t,
    sleep: async (ms) => {
      if (ms > 0) {
        s.sleeps.push(ms);
        s.t += ms;
      }
    },
  };
  return { c, s };
}

const parts3 = [{ text: "Birinchi gap." }, { text: "Ikkinchi gap." }, { text: "Uchinchi gap." }];
const chainOf = (providers: TtsProvider[], c?: TtsClock, env = EMPTY_ENV) => makeTtsChain({ providers, env, log: () => undefined, ...(c ? { clock: c } : {}) });

type Wire = { url: string; headers: Record<string, string>; body: string };
/** A `fetch` that records what goes out (without the abort signal) and answers `respond(call number)`. */
function recorder(respond: (n: number) => Response) {
  const wires: Wire[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    wires.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body) });
    return respond(wires.length);
  }) as unknown as typeof fetch;
  return { fetchImpl, wires };
}

const PCM = Buffer.from(new Uint8Array(48_000)).toString("base64");
const geminiOk = () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: PCM } }] } }] });
const minute429 = () =>
  new Response(
    JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "39s" },
        ],
      },
    }),
    { status: 429, statusText: "Too Many Requests" },
  );
const day429 = () =>
  new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }] } }), {
    status: 429,
    statusText: "Too Many Requests",
  });
const azureOk = () => new Response(arrayBufferOf(mp3Of(5)), { status: 200, headers: { "content-type": "audio/mpeg" } });

const realAzure = (r: ReturnType<typeof recorder>) => makeAzureTts({ fetchImpl: r.fetchImpl, key: () => "k", region: () => "westeurope" });
const realGemini = (r: ReturnType<typeof recorder>, pace?: () => Promise<void>) =>
  makeGeminiTts({ fetchImpl: r.fetchImpl, key: () => "k", model: () => "gemini-2.5-flash-preview-tts", ...(pace ? { pace } : {}) });

/* ── database fixtures ── */

let seq = 0;
async function newGeneration(tool = "podcast"): Promise<{ gen: string; userId: string }> {
  const { query } = db!;
  const [user] = await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'T', 0, 0, 0) RETURNING id", [`mspeech-${Date.now()}-${seq++}`]);
  const gen = randomUUID();
  await query("INSERT INTO generations (id, user_id, tool_id, status) VALUES ($1, $2, $3, 'IN_PROGRESS')", [gen, user.id, tool]);
  return { gen, userId: String(user.id) };
}

type JobRow = {
  idempotency_key: string;
  purpose: string;
  model_id: string;
  provider: string;
  upstream_model: string;
  status: string;
  attempts: number;
  errors: number;
  last_error: string | null;
  outputs: { mime: string; size: number }[] | null;
  params: { text?: string; voice?: string };
  cost_usd: string | null;
};
const rowsOf = (gen: string) =>
  db!.query<JobRow>(
    "SELECT idempotency_key, purpose, model_id, provider, upstream_model, status, attempts, errors, last_error, outputs, params, cost_usd FROM media_jobs WHERE generation_id = $1 ORDER BY created_at, idempotency_key",
    [gen],
  );
const keysOf = (gen: string, rows: JobRow[]) => rows.map((r) => r.idempotency_key.replace(`${gen}:`, ""));

type Mode = "off-no-context" | "off" | "on";
/** Runs `fn` as the worker would: no media context, a context with the switch OFF, or with it ON. */
async function inMode<T>(mode: Mode, fn: () => Promise<T>): Promise<{ out: T; gen: string | null }> {
  resetBreakers();
  if (mode === "off-no-context") return { out: await fn(), gen: null };
  const { gen } = await newGeneration();
  return { out: await withMediaContext({ generationId: gen, core: { image: false, video: false, speech: mode === "on" } }, fn), gen };
}
const mediaBreakers = () => snapshotBreakers().filter((b) => b.name.startsWith("media:"));

const inputOf = (params: AdapterInput["params"]): AdapterInput => ({ upstreamModel: "azure", params, idempotencyKey: "k" });

/* ══════════════════════════ catalog and adapter ══════════════════════════ */

test("catalog: every speech provider the chain builds maps to an entry whose route names it", () => {
  const adapters: Record<string, string> = { gemini: "gemini-speech", elevenlabs: "elevenlabs-speech", azure: "azure-speech", aisha: "aisha-speech" };
  const models: Record<string, string> = { gemini: "google/tts", elevenlabs: "elevenlabs/tts", azure: "azure/tts", aisha: "aisha/tts" };
  assert.deepEqual(Object.keys(SPEECH_PROVIDER_TO_MEDIA).sort(), Object.keys(adapters).sort());
  for (const [provider, adapter] of Object.entries(adapters)) {
    const r = speechRoute(provider as TtsProviderId);
    assert.ok(r, `${provider} is sold`);
    assert.equal(r.entry.id, models[provider]);
    assert.equal(r.entry.kind, "speech");
    assert.equal(r.route.provider, provider);
    assert.equal(r.route.adapter, adapter, `${provider}: adapter id is the catalog route's`);
    assert.equal(MEDIA_CATALOG.byId(models[provider])!.routes.length, 1, "P0: one route per speech model");
  }
  assert.equal(speechRoute("google"), null, "a provider id the catalog does not sell keeps the direct path");
});

test("purposes: every caller's purpose is a catalog purpose that allows the providers it can run on", () => {
  const allows = (purpose: string, provider: TtsProviderId) => MEDIA_PURPOSES.byId(purpose)!.allowed.includes(SPEECH_PROVIDER_TO_MEDIA[provider]!);
  for (const kind of AUDIO_KINDS) {
    const purpose = audioVoicePurpose(kind);
    assert.equal(purpose, `${kind}.voice`);
    assert.ok(MEDIA_PURPOSES.byId(purpose), `${purpose} is a catalog purpose`);
    for (const p of ["azure", "aisha", "gemini", "elevenlabs"] as const) assert.ok(allows(purpose, p), `${purpose} allows ${p}`);
  }
  for (const p of ["azure", "aisha", "gemini"] as const) assert.ok(allows("listening.voice", p), `listening.voice allows ${p}`);
  assert.ok(allows("domla.voice", "gemini"), "domla speaks with Gemini");
});

test("adapter: ok — the provider's own call and answer, mp3 and wav", async () => {
  const seen: TtsAudio[] = [];
  const mp3 = fake("azure");
  const out = await speechAdapter("azure-speech", mp3, { onAudio: (a) => seen.push(a) }).submit(inputOf({ text: "Salom", lang: "uz", voice: "uz-UZ-MadinaNeural", speed: 1.1, pauseMs: 300, timeoutMs: 9_000 }));
  assert.ok("done" in out);
  assert.equal(out.done.length, 1);
  const o = out.done[0]!;
  assert.ok(o.kind === "inline" && o.mime === "audio/mpeg");
  assert.deepEqual([...o.bytes], [...mp3Of(2)]);
  assert.deepEqual(mp3.calls, [{ text: "Salom", opts: { lang: "uz", voice: "uz-UZ-MadinaNeural", speed: 1.1, pauseMs: 300, timeoutMs: 9_000 } }]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.chars, 5, "the provider's full answer (seconds, chars…) reaches the chain");

  const wav = await speechAdapter("aisha-speech", fake("aisha")).submit(inputOf({ text: "Salom", lang: "uz" }));
  assert.ok("done" in wav);
  const w = wav.done[0]!;
  assert.ok(w.kind === "inline" && w.mime === "audio/wav", "a WAV answer is recorded as audio/wav");

  const a = speechAdapter("azure-speech", mp3);
  assert.equal(a.configured(), true);
  assert.deepEqual([...(await a.fetchOutput({ kind: "inline", bytes: new Uint8Array([1, 2]), mime: "audio/mpeg" }))], [1, 2]);
  await assert.rejects(a.fetchOutput({ kind: "url", url: "https://x.test/a.mp3" }), MediaError);
});

test("adapter: failure mapping — retryable and status kept, accepted only for a timeout after the call started", async () => {
  const cases: { name: string; err: Error; retryable: boolean; accepted: boolean; status?: number }[] = [
    { name: "5xx", err: new TtsError("azure", "503 Service Unavailable", { retryable: true, status: 503 }), retryable: true, accepted: false, status: 503 },
    { name: "401", err: new TtsError("azure", "401 Unauthorized", { retryable: false, status: 401 }), retryable: false, accepted: false, status: 401 },
    { name: "429", err: new TtsError("gemini", "429 Too Many Requests", { retryable: true, status: 429, rateLimited: true, retryAfterMs: 40_000 }), retryable: true, accepted: false, status: 429 },
    { name: "timeout after the call started", err: new TtsError("azure", "The operation was aborted due to timeout", { retryable: true }), retryable: true, accepted: true },
    { name: "aborted", err: new TtsError("aisha", "This operation was aborted", { retryable: true }), retryable: true, accepted: true },
    { name: "network failure before any answer", err: new TtsError("azure", "fetch failed", { retryable: true }), retryable: true, accepted: false },
    { name: "config error (no key)", err: new TtsError("azure", "AZURE_SPEECH_KEY yo'q"), retryable: false, accepted: false },
    { name: "a bare exception is retryable, as the chain always treated it", err: new TypeError("socket hang up"), retryable: true, accepted: false },
  ];
  for (const c of cases) {
    const p = fake("azure", () => c.err);
    const thrown = await speechAdapter("azure-speech", p).submit(inputOf({ text: "x", lang: "uz" })).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(thrown instanceof MediaError && thrown instanceof SpeechMediaError, c.name);
    assert.equal(thrown.retryable, c.retryable, `${c.name}: retryable`);
    assert.equal(thrown.accepted, c.accepted, `${c.name}: accepted`);
    assert.equal(thrown.safety, false, `${c.name}: speech has no safety refusals`);
    assert.equal(thrown.status, c.status, `${c.name}: status`);
    assert.equal(unwrapSpeechError(thrown, "azure"), c.err, `${c.name}: the provider's own exception comes back`);
  }
  assert.equal(toSpeechError(new TtsError("gemini", "x"), "azure").provider, "gemini", "the error names the provider that raised it");
});

test("adapter: a core error becomes a TtsError the chain's rules understand; anything else is unchanged", () => {
  const e = unwrapSpeechError(new MediaError("router", "no route available", { retryable: true }), "azure");
  assert.ok(e instanceof TtsError);
  assert.equal(e.provider, "azure");
  assert.equal(e.retryable, true);
  const boom = new RangeError("boom");
  assert.equal(unwrapSpeechError(boom, "azure"), boom);
});

/* ══════════════════════════ params ══════════════════════════ */

test("params: the call the provider gets is the chain's call, field for field", () => {
  const turns = [
    { voice: "Kore", text: "Salom." },
    { voice: "Charon", text: "Assalomu alaykum." },
  ];
  const calls: { text: string; opts: TtsSynthOpts }[] = [
    { text: "oddiy", opts: { lang: "uz" } },
    { text: "ovoz bilan", opts: { lang: "ru", voice: "ru-RU-SvetlanaNeural" } },
    { text: "hammasi", opts: { lang: "uz", voice: "uz-UZ-SardorNeural", speed: 1.1, pauseMs: 450, timeoutMs: 12_345 } },
    { text: "dialog", opts: { lang: "uz", voice: "Kore", turns } },
    { text: "tez", opts: { lang: "uz", speed: 0.9 } },
  ];
  for (const c of calls) assert.deepEqual(speechCallOf(speechExtraOf(c.text, c.opts)), c, c.text);
  assert.deepEqual(speechCallOf({ text: "x", voice: "", lang: "uz" }), { text: "x", opts: { lang: "uz" } }, "an empty voice is an absent voice (every provider reads voice?.trim() || default)");
});

test("params: the provider gets the exact text — the core's whitespace-collapsed text is only the quote", async () => {
  const { runMedia } = await import("../lib/server/media/run.ts");
  const text = "  Birinchi   gap.\n\nIkkinchi\tgap.  ";
  const p = fake("azure");
  resetBreakers();
  const r = await runMedia({
    purpose: "podcast.voice",
    modelId: "azure/tts",
    values: { text, voice: "uz-UZ-MadinaNeural" },
    extra: speechExtraOf(text, { lang: "uz", voice: "uz-UZ-MadinaNeural", speed: 1.1 }),
    step: "speech:0:azure",
    adapters: { "azure-speech": speechAdapter("azure-speech", p) },
  });
  assert.equal(r.outputs.length, 1);
  assert.deepEqual(p.calls, [{ text, opts: { lang: "uz", voice: "uz-UZ-MadinaNeural", speed: 1.1 } }], "text byte for byte, speed carried");
});

/* ══════════════════════════ OFF: the core is never touched ══════════════════════════ */

test("OFF: the core is never touched — no context, a label alone, the label of a provider the catalog does not sell", async () => {
  resetBreakers();
  const label = { purpose: "podcast.voice" };
  const a = fake("azure");
  await chainOf([a]).synthesizeAll(parts3, { lang: "uz", media: label });
  assert.equal(a.calls.length, 3, "the provider is called directly");
  assert.deepEqual(mediaBreakers(), [], "no context: the breaker registry of the core was never used");

  // The unlabeled run and the unsold provider need a context to prove «no row»: below, in the database tests.
  const g = fake("google");
  await chainOfProvider(g, ["v"]).synthesizeAll(parts3, { lang: "uz", media: label });
  assert.equal(g.calls.length, 3);
  assert.deepEqual(mediaBreakers(), []);
});

test("providerOfChain: label per word — the listening purpose, a unique scope for every run", async () => {
  const seen: unknown[] = [];
  const spy: TtsChain = {
    configured: () => true,
    providersFor: () => ["azure"],
    synthesizeAll: async (_parts, o) => {
      seen.push(o.media);
      return { provider: "azure", voiceA: "azure:a", voiceB: "azure:a", audios: [{ mp3: mp3Of(1), seconds: 1, chars: 1 }], usages: [], seconds: 1, chars: 1 };
    },
  };
  const p = providerOfChain(spy);
  for (const w of ["bir", "ikki", "uch"]) await p.synthesize(w, { lang: "uz" });
  assert.deepEqual(seen, [
    { purpose: "listening.voice", scope: "listening:0" },
    { purpose: "listening.voice", scope: "listening:1" },
    { purpose: "listening.voice", scope: "listening:2" },
  ]);
  assert.equal(new Set(seen.map((m) => (m as { scope: string }).scope)).size, 3, "scopes are unique");
  seen.length = 0;
  await providerOfChain(spy, "podcast.voice").synthesize("x", { lang: "uz" });
  assert.deepEqual(seen, [{ purpose: "podcast.voice", scope: "podcast:0" }]);
});

/* ── audio engine fixtures (as tests/audio-engine.test.mts) ── */

const words = (n: number) => Array.from({ length: n }, () => "so'z").join(" ");
const scriptOf = (lines: { speaker: string; words: number }[]): AudioLine[] => lines.map((l, i) => ({ speaker: l.speaker, text: `${i === 0 ? "Nega bu savol muhim?" : ""} ${words(l.words)}.`.trim() }));
const goodScript = () => scriptOf(Array.from({ length: 8 }, (_, i) => ({ speaker: i % 2 === 0 ? "A" : "B", words: 37 })));
const greetingScript = (): AudioLine[] => [
  { speaker: "A", text: `Hurmatli Dilnoza opa, Sizni Ustozlar va murabbiylar kuni bilan chin qalbdan tabriklayman. ${words(60)}.` },
  { speaker: "A", text: `${words(80)}. Sog' va omon bo'ling.` },
];
function fakeComplete(script: AudioLine[]): CompleteFn {
  return (async (role: string) => {
    if (role === "judge") return { text: JSON.stringify({ notes: [], fixes: [] }), usage: { provider: "gemini", model: "m", inputTokens: 10, outputTokens: 10 } };
    return { text: JSON.stringify({ script }), usage: { provider: "gemini", model: "m", inputTokens: 100, outputTokens: 200 } };
  }) as unknown as CompleteFn;
}
const podcastTool = (): ToolConfig => TOOLS.find((t) => t.id === "podcast")!;
const greetingTool = (): ToolConfig => TOOLS.find((t) => t.id === "greeting")!;
const PODCAST_VALUES: FormValues = { topic: "Uyqu va xotira", durationMin: 2, podcastType: "intervyu", language: "uz", mode: "topic" };
const GREETING_VALUES: FormValues = { recipient: "Dilnoza opa", relation: "ustozim", occasion: "ustoz-kuni", durationMin: 1, language: "uz" };

const NOW = new Date("2026-11-01T00:00:00Z");
function buildAudio(tool: ToolConfig, values: FormValues, script: AudioLine[], tts: TtsChain | TtsProvider) {
  return buildAudioArtifact(tool, extractMeta(tool, values), values, { deadline: Date.now() + 600_000, complete: fakeComplete(script), tts, judge: false, polish: false, now: NOW });
}

test("audio engine: purpose per kind — the label the engine gives the chain", async () => {
  for (const [tool, values, script, purpose] of [
    [podcastTool(), PODCAST_VALUES, goodScript(), "podcast.voice"],
    [greetingTool(), GREETING_VALUES, greetingScript(), "greeting.voice"],
  ] as const) {
    let seen: unknown = null;
    const spy: TtsChain = {
      configured: () => true,
      providersFor: () => ["azure"],
      synthesizeAll: async (_parts, o) => {
        seen = o.media;
        throw new TtsError("azure", "stop here", { retryable: false });
      },
    };
    await assert.rejects(buildAudio(tool, values, script, spy), /stop here/);
    assert.deepEqual(seen, { purpose }, tool.id);
  }
});

/* ══════════════════════════ ON: rows ══════════════════════════ */

test("ON: one row per chunk — purpose, catalog model, provider, upstream, key, status, outputs, cost", { skip }, async () => {
  const p = fake("azure");
  const { out, gen } = await inMode("on", () => chainOf([p]).synthesizeAll(parts3, { lang: "uz", voice: "male", media: { purpose: "podcast.voice" } }));
  assert.equal(out.provider, "azure");
  assert.equal(out.audios.length, 3);
  const rows = await rowsOf(gen!);
  assert.deepEqual(keysOf(gen!, rows), ["speech:0:azure", "speech:1:azure", "speech:2:azure"]);
  const entry = MEDIA_CATALOG.byId("azure/tts")!;
  for (const [i, r] of rows.entries()) {
    assert.equal(r.purpose, "podcast.voice");
    assert.equal(r.model_id, "azure/tts");
    assert.equal(r.provider, "azure");
    assert.equal(r.upstream_model, "azure");
    assert.equal(r.status, "succeeded");
    assert.equal(r.attempts, 1);
    assert.equal(r.errors, 0);
    assert.deepEqual(r.outputs, [{ mime: "audio/mpeg", size: mp3Of(2).byteLength }]);
    assert.equal(r.params.text, parts3[i]!.text);
    assert.equal(r.params.voice, p.calls[i]!.opts.voice, "the voice the chain chose");
    // MUTATION 9: a quote without the text is $0.
    const expected = (entry.cost.per === "kchar" ? entry.cost.usd : 0) * (parts3[i]!.text.length / 1000);
    assert.ok(expected > 0);
    assert.ok(Math.abs(Number(r.cost_usd) - expected) < 1e-6, `cost ${r.cost_usd} vs ${expected}`);
  }
  assert.deepEqual(
    p.calls.map((c) => c.text),
    parts3.map((x) => x.text),
    "the provider received every chunk, in order",
  );
  assert.ok(mediaBreakers().some((b) => b.name === "media:azure:azure"), "breaker health of the route was fed");
});

test("ON: packed Gemini chunks — one row per packed call, the operator's TTS_GEMINI_MODEL as the upstream", { skip }, async () => {
  const p = fake("gemini");
  const parts = [{ text: "Bir." }, { text: "Ikki." }, { text: "Uch." }];
  const { gen } = await inMode("on", () => chainOf([p]).synthesizeAll(parts, { lang: "uz", media: { purpose: "greeting.voice" } }));
  assert.equal(p.calls.length, 1, "three short parts are packed into one request");
  const rows = await rowsOf(gen!);
  assert.deepEqual(keysOf(gen!, rows), ["speech:0:gemini"]);
  assert.equal(rows[0]!.model_id, "google/tts");
  assert.equal(rows[0]!.provider, "gemini");
  // MUTATION 10: without the hook the row would say «gemini», not the model that served it.
  assert.equal(rows[0]!.upstream_model, "gemini-2.5-flash-preview-tts");
  assert.equal(rows[0]!.purpose, "greeting.voice");
  assert.equal(rows[0]!.params.text, "Bir. Ikki. Uch.", "the quote is for the packed text");
});

test("ON: no row without the switch, without a label, or for a provider the catalog does not sell", { skip }, async () => {
  const off = await inMode("off", () => chainOf([fake("azure")]).synthesizeAll(parts3, { lang: "uz", media: { purpose: "podcast.voice" } }));
  assert.deepEqual(await rowsOf(off.gen!), [], "switch OFF in a context: no row");
  assert.deepEqual(mediaBreakers(), [], "switch OFF in a context: the core is never touched");

  const unlabeled = await inMode("on", () => chainOf([fake("azure")]).synthesizeAll(parts3, { lang: "uz" }));
  assert.deepEqual(await rowsOf(unlabeled.gen!), [], "a run without a label never uses the core");
  assert.deepEqual(mediaBreakers(), []);

  const g = fake("google");
  const unsold = await inMode("on", () => chainOfProvider(g, ["v"]).synthesizeAll(parts3, { lang: "uz", media: { purpose: "podcast.voice" } }));
  assert.equal(g.calls.length, 3, "an unsold provider is still synthesized, directly");
  assert.deepEqual(await rowsOf(unsold.gen!), []);
  assert.deepEqual(mediaBreakers(), []);
});

/* ══════════════════════════ ON: the chain keeps its rules ══════════════════════════ */

test("fallback: the provider that served the job is recorded (tts.order slot, whole job restarts)", { skip }, async () => {
  const slot = (provider: string) => ({ provider });
  routeResolve!.setRouteSnapshot(new Map([["tts.order", [slot("aisha"), slot("azure")]]]) as never);
  try {
    const run = (mode: Mode) => {
      const aisha = fake("aisha", (n) => (n === 1 ? new TtsError("aisha", "403 forbidden", { retryable: false, status: 403 }) : null));
      const azure = fake("azure");
      return inMode(mode, () => chainOf([azure, aisha]).synthesizeAll(parts3, { lang: "uz", media: { purpose: "podcast.voice" } })).then((r) => ({ ...r, aisha, azure }));
    };
    const off = await run("off");
    const on = await run("on");
    assert.equal(on.out.provider, "azure", "aisha is first by the admin order, fails, azure serves the whole job");
    assert.equal(on.out.provider, off.out.provider);
    assert.deepEqual(
      on.aisha.calls.map((c) => c.text),
      off.aisha.calls.map((c) => c.text),
    );
    assert.deepEqual(
      on.azure.calls.map((c) => c.text),
      off.azure.calls.map((c) => c.text),
      "the same chunks, in the same order, on the fallback provider",
    );
    assert.deepEqual(await rowsOf(off.gen!), []);
    const rows = await rowsOf(on.gen!);
    // MUTATION 5: without the provider in the step, azure's rows would collide with aisha's `speech:0`.
    assert.deepEqual(keysOf(on.gen!, rows), ["speech:0:aisha", "speech:0:azure", "speech:1:azure", "speech:2:azure"]);
    assert.deepEqual(
      rows.map((r) => [r.provider, r.model_id, r.status]),
      [
        ["aisha", "aisha/tts", "failed"],
        ["azure", "azure/tts", "succeeded"],
        ["azure", "azure/tts", "succeeded"],
        ["azure", "azure/tts", "succeeded"],
      ],
    );
    assert.match(rows[0]!.last_error ?? "", /403 forbidden/);
  } finally {
    routeResolve!.resetRouteSnapshot();
  }
});

test("ON: a retried chunk is one row; a provider error reaches the chain unchanged", { skip }, async () => {
  const { c, s } = clock();
  const flaky = fake("azure", (n) => (n === 1 ? new TtsError("azure", "502 Bad Gateway", { retryable: true, status: 502 }) : null));
  const { out, gen } = await inMode("on", () => chainOf([flaky], c).synthesizeAll([{ text: "Faqat bitta gap." }], { lang: "uz", media: { purpose: "podcast.voice" } }));
  assert.equal(out.audios.length, 1);
  assert.equal(flaky.calls.length, 2, "the chain's own retry ran the provider twice");
  assert.equal(s.sleeps.length, 1, "with the chain's backoff");
  const rows = await rowsOf(gen!);
  assert.equal(rows.length, 1, "two attempts, one chunk, one row");
  assert.deepEqual([rows[0]!.status, rows[0]!.attempts, rows[0]!.errors], ["succeeded", 2, 1]);
  assert.match(rows[0]!.last_error ?? "", /502 Bad Gateway/);

  const err = new TtsError("azure", "401 Unauthorized", { retryable: false, status: 401 });
  const dead = fake("azure", () => err);
  const failed = await inMode("on", () =>
    chainOf([dead])
      .synthesizeAll(parts3, { lang: "uz", media: { purpose: "podcast.voice" } })
      .then(
        () => null,
        (e: unknown) => e,
      ),
  );
  // MUTATION 4: the MediaError would reach the chain instead of the provider's exception.
  assert.equal(failed.out, err, "the very exception the provider raised");
  assert.equal(dead.calls.length, 1, "a non-retryable error is not retried");
  const rows2 = await rowsOf(failed.gen!);
  assert.deepEqual(
    rows2.map((r) => [r.status, r.attempts]),
    [["failed", 1]],
  );
});

/* ══════════════════════════ parity with real providers ══════════════════════════ */

type ParityRun = { run: TtsRun | unknown; wires: Wire[]; sleeps: number[]; paced: number };

async function parity(mode: Mode, build: (r: ReturnType<typeof recorder>, pace: () => Promise<void>) => { provider: TtsProvider; responses: (() => Response)[] }, parts: { text: string; voice?: number; pauseMs?: number }[], opts: Partial<Parameters<TtsChain["synthesizeAll"]>[1]> = {}) {
  let paced = 0;
  const holder: { responses: (() => Response)[] } = { responses: [] };
  const r = recorder((n) => holder.responses[Math.min(n, holder.responses.length) - 1]!());
  const { provider, responses } = build(r, async () => void paced++);
  holder.responses = responses;
  const { c, s } = clock();
  const { out, gen } = await inMode(mode, () =>
    chainOf([provider], c)
      .synthesizeAll(parts, { lang: "uz", media: { purpose: "podcast.voice" }, ...opts })
      .catch((e: unknown) => e),
  );
  return { done: { run: out, wires: r.wires, sleeps: s.sleeps, paced } as ParityRun, gen };
}

test("parity: Azure — same requests, same run with the switch OFF (no context), OFF (context) and ON", { skip }, async () => {
  const parts = [{ text: "Salom <dunyo> & hamma!", voice: 0, pauseMs: 300 }, { text: "Qalaysiz?", voice: 1, pauseMs: 600 }, { text: "Yaxshi, rahmat.", voice: 0 }];
  const o = { voice: "male" as const, speed: 1.1, timeoutMs: 20_000 };
  const build = (r: ReturnType<typeof recorder>) => ({ provider: realAzure(r), responses: [azureOk] });
  const a = await parity("off-no-context", build, parts, o);
  const b = await parity("off", build, parts, o);
  const c = await parity("on", build, parts, o);
  assert.equal((a.done.run as TtsRun).audios.length, 3);
  assert.equal(a.done.wires.length, 3);
  assert.deepEqual(b.done, a.done, "OFF with a context = OFF without");
  assert.deepEqual(c.done, a.done, "ON = OFF: requests, run (audios, usages, seconds, chars), waits");
  assert.deepEqual(await rowsOf(b.gen!), []);
  assert.equal((await rowsOf(c.gen!)).length, 3);
});

test("parity: the options the provider is called with are identical ON and OFF (voices, speed, pause, timeouts)", { skip }, async () => {
  const parts = [{ text: "Salom.", voice: 0, pauseMs: 250 }, { text: "Qalaysiz?", voice: 1 }, { text: "Yaxshi.", voice: 0, pauseMs: 700 }];
  const run = async (mode: Mode, withDeadline: boolean) => {
    const p = fake("azure");
    const { c } = clock();
    await inMode(mode, () => chainOf([p], c).synthesizeAll(parts, { lang: "uz", voice: "male", speed: 1.15, timeoutMs: 12_345, ...(withDeadline ? { deadline: c.now() + 600_000 } : {}), media: { purpose: "podcast.voice" } }));
    return p.calls;
  };
  const plain = await run("off", false);
  assert.equal(plain.length, 3);
  assert.deepEqual(plain.map((c) => c.opts.timeoutMs), [12_345, 12_345, 12_345]);
  assert.deepEqual(plain.map((c) => c.opts.pauseMs), [250, undefined, 700]);
  assert.ok(plain.every((c) => c.opts.speed === 1.15 && c.opts.lang === "uz"));
  assert.deepEqual(await run("on", false), plain, "no deadline: the same calls");
  const capped = await run("off", true);
  assert.deepEqual(await run("on", true), capped, "with a job deadline: the same (deadline-capped) calls");
});

test("parity: Gemini dialog — one packed two-speaker request, same body ON and OFF, the pacing gate before every attempt", { skip }, async () => {
  const parts = Array.from({ length: 6 }, (_, i) => ({ text: `Replika ${i + 1}.`, voice: i % 2 }));
  const build = (r: ReturnType<typeof recorder>, pace: () => Promise<void>) => ({ provider: realGemini(r, pace), responses: [geminiOk] });
  const a = await parity("off-no-context", build, parts, { voice: "female" });
  const c = await parity("on", build, parts, { voice: "female" });
  assert.equal(a.done.wires.length, 1);
  assert.match(a.done.wires[0]!.body, /multiSpeakerVoiceConfig/, "MUTATION 1: the turns reach the provider");
  assert.equal(a.done.paced, 1);
  assert.deepEqual(c.done, a.done, "ON = OFF, pacing calls included");
  assert.equal((await rowsOf(c.gen!)).length, 1);
});

test("parity: Gemini 429 — the chain waits retryDelay + 1 s and retries on both paths; one row for the chunk", { skip }, async () => {
  const build = (r: ReturnType<typeof recorder>, pace: () => Promise<void>) => ({ provider: realGemini(r, pace), responses: [minute429, geminiOk] });
  const off = await parity("off-no-context", build, [{ text: "Salom dunyo." }]);
  const on = await parity("on", build, [{ text: "Salom dunyo." }]);
  assert.deepEqual(off.done.sleeps, [40_000]);
  assert.equal(off.done.paced, 2);
  assert.deepEqual(on.done, off.done, "same waits, same pacing, same run");
  const rows = await rowsOf(on.gen!);
  assert.deepEqual(rows.map((r) => [r.status, r.attempts, r.errors]), [["succeeded", 2, 1]]);
  assert.match(rows[0]!.last_error ?? "", /429/);
});

test("parity: Gemini daily quota — the user sees the same Uzbek message, the row is failed", { skip }, async () => {
  const build = (r: ReturnType<typeof recorder>, pace: () => Promise<void>) => ({ provider: realGemini(r, pace), responses: [day429] });
  const off = await parity("off-no-context", build, [{ text: "Salom dunyo." }]);
  const on = await parity("on", build, [{ text: "Salom dunyo." }]);
  for (const r of [off, on]) {
    assert.ok(r.done.run instanceof UserFacingError, "daily quota → UserFacingError");
    assert.equal((r.done.run as UserFacingError).message, GEMINI_DAILY_QUOTA_MESSAGE);
    assert.equal(r.done.wires.length, 1, "a per-day quota is not retried");
    assert.deepEqual(r.done.sleeps, []);
  }
  const rows = await rowsOf(on.gen!);
  assert.deepEqual(rows.map((r) => r.status), ["failed"]);
});

/* ══════════════════════════ callers ══════════════════════════ */

function fakeAudioTts(): TtsProvider & { calls: Rec[] } {
  const p = fake("azure");
  const synth = p.synthesize.bind(p);
  p.synthesize = async (text, opts) => ({ ...(await synth(text, opts)), mp3: mp3Of(20), seconds: 20 * FRAME_SECONDS * 3 });
  return p;
}

test("audio engine: same MP3, cost and model with the switch OFF and ON; rows carry the kind's purpose", { skip }, async () => {
  for (const [tool, values, script, purpose] of [
    [podcastTool(), PODCAST_VALUES, goodScript(), "podcast.voice"],
    [greetingTool(), GREETING_VALUES, greetingScript(), "greeting.voice"],
  ] as const) {
    const run = async (mode: Mode) => {
      const tts = fakeAudioTts();
      const { out, gen } = await inMode(mode, () => buildAudio(tool, values, script, chainOfProvider(tts, ["azure-A", "azure-B"])));
      assert.ok(out, `${tool.id} built`);
      return { out, gen, tts };
    };
    const off = await run("off");
    const on = await run("on");
    assert.deepEqual([...on.out.bytes], [...off.out.bytes], `${tool.id}: the same MP3`);
    assert.deepEqual({ ...on.out.cost }, { ...off.out.cost }, `${tool.id}: the same cost_json`);
    assert.deepEqual(on.out.delivered, off.out.delivered);
    assert.equal(on.out.doc.audio!.voice, off.out.doc.audio!.voice);
    assert.deepEqual(
      on.tts.calls.map((c) => [c.text, c.opts.voice, c.opts.pauseMs]),
      off.tts.calls.map((c) => [c.text, c.opts.voice, c.opts.pauseMs]),
      "the same provider calls",
    );
    assert.deepEqual(await rowsOf(off.gen!), []);
    const rows = await rowsOf(on.gen!);
    // MUTATION 11: a constant purpose would label every greeting a podcast.
    assert.equal(rows.length, on.tts.calls.length, `${tool.id}: one row per chunk`);
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((r) => r.purpose === purpose && r.model_id === "azure/tts" && r.status === "succeeded"), `${tool.id}: purpose ${purpose}`);
  }
});

test("listening: one row per word — the per-run scope keeps every key unique, a retried job finds its rows again", { skip }, async () => {
  const { gen } = await newGeneration("listening");
  const ctx = { generationId: gen, core: { image: false, video: false, speech: true } };
  const synthAll = async () => {
    const tts = fake("azure");
    const p = providerOfChain(chainOfProvider(tts, ["v"]));
    for (const w of ["bir", "ikki", "uch"]) await p.synthesize(w, { lang: "uz", voice: "azure:ignored" });
    return tts;
  };
  resetBreakers();
  const first = await withMediaContext(ctx, synthAll);
  assert.deepEqual(first.calls.map((c) => c.text), ["bir", "ikki", "uch"]);
  let rows = await rowsOf(gen);
  // MUTATION 6 / 14: without a scope or counter all three words would share `speech:0:azure` — one row.
  assert.deepEqual(keysOf(gen, rows), ["speech:listening:0:0:azure", "speech:listening:1:0:azure", "speech:listening:2:0:azure"]);
  assert.ok(rows.every((r) => r.purpose === "listening.voice" && r.status === "succeeded" && r.attempts === 1));
  assert.deepEqual(rows.map((r) => r.params.text), ["bir", "ikki", "uch"]);

  await withMediaContext(ctx, synthAll);
  rows = await rowsOf(gen);
  assert.equal(rows.length, 3, "the retried job reuses its rows");
  assert.ok(rows.every((r) => r.attempts === 2));
});

/* ── domla (own worker loop, outside the build's media context) ── */

const QUESTIONS = Array.from({ length: 5 }, (_, i) => ({ kind: "why", text: `Savol raqami ${i + 1}: nega shunday?`, ideal: "Chunki shunday bo'lishi kerak va bu aniq asoslangan." }));

type DomlaFixture = { user: string; gen: string; session: string; jobs: string[] };
async function domlaFixture(): Promise<DomlaFixture> {
  const { query } = db!;
  const tg = 7_700_000_000 + randomInt(0, 99_999_999);
  const [user] = await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance, telegram_id) VALUES ($1, 'Domla', 0, 0, 0, $2) RETURNING id", [`mdomla-${Date.now()}-${seq++}`, tg]);
  const gen = randomUUID();
  await query("INSERT INTO generations (id, user_id, tool_id, topic, status, doc_json) VALUES ($1, $2, 'slide', 'Fotosintez', 'COMPLETED', '{\"slides\":[]}'::jsonb)", [gen, user.id]);
  const session = randomUUID();
  await query("INSERT INTO domla_sessions (id, user_id, source_generation_id, status, topic, questions) VALUES ($1, $2, $3, 'active', 'Fotosintez', $4::jsonb)", [session, user.id, gen, JSON.stringify(QUESTIONS)]);
  const jobs: string[] = [];
  for (const idx of [0, 1]) jobs.push(String((await query<{ id: string }>("INSERT INTO domla_jobs (session_id, kind, idx) VALUES ($1, 'ask', $2) RETURNING id::text AS id", [session, idx]))[0]!.id));
  return { user: String(user.id), gen, session, jobs };
}

/** Runs the queued domla jobs with the REAL voice edge (`defaultDeps().synthesize`, Gemini over a stubbed `fetch`). */
async function runDomla(): Promise<{ audio: Uint8Array[]; texts: string[]; geminiCalls: number }> {
  const { query } = db!;
  const edges = await import("../lib/server/domla-deps.ts");
  const engine = await import("../lib/server/domla-engine.ts");
  const real = edges.defaultDeps();
  const audio: Uint8Array[] = [];
  const texts: string[] = [];
  const deps = {
    ...real,
    telegram: {
      sendText: async (_chat: string, text: string) => (texts.push(text), true),
      sendAudio: async (_chat: string, a: { bytes: Uint8Array }) => (audio.push(a.bytes), true),
      sendAction: async () => undefined,
      downloadFile: async () => new Uint8Array(),
    },
  };
  const realFetch = globalThis.fetch;
  let geminiCalls = 0;
  globalThis.fetch = (async (url: unknown) => {
    if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) throw new Error(`unexpected fetch ${String(url)}`);
    geminiCalls++;
    return geminiOk();
  }) as unknown as typeof fetch;
  try {
    for (let i = 0; i < 6; i++) {
      await query("UPDATE domla_jobs SET run_after = now(), locked_until = NULL");
      if (!(await engine.domlaTick(deps))) break;
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  return { audio, texts, geminiCalls };
}
const setSpeechSwitch = async (on: boolean) => {
  await db!.query("INSERT INTO app_settings (key, value) VALUES ('media.core.speech', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(on)]);
  settingsMod!.invalidateSettingsCache();
};

test("domla: ON — the rows belong to the deck the defence is about, one per asked question, same audio as OFF", { skip }, async () => {
  const off = await domlaFixture();
  await setSpeechSwitch(false);
  const offRun = await runDomla();
  assert.equal(offRun.audio.length, 2, "both questions were spoken");
  assert.deepEqual(await rowsOf(off.gen), [], "domla: OFF — no row");

  const on = await domlaFixture();
  await setSpeechSwitch(true);
  resetBreakers();
  const onRun = await runDomla();
  assert.equal(onRun.audio.length, 2);
  assert.deepEqual(
    onRun.audio.map((a) => [...a]),
    offRun.audio.map((a) => [...a]),
    "the same MP3 bytes",
  );
  assert.equal(onRun.geminiCalls, offRun.geminiCalls, "the same number of provider requests");
  const rows = await rowsOf(on.gen);
  // MUTATION 12: a scope without the job id would make both questions one row.
  assert.deepEqual(
    keysOf(on.gen, rows),
    on.jobs.map((id) => `speech:domla:${id}:0:gemini`),
  );
  assert.ok(rows.every((r) => r.purpose === "domla.voice" && r.model_id === "google/tts" && r.provider === "gemini" && r.status === "succeeded"));
  await setSpeechSwitch(false);
});

test("domla: OFF with a generation records nothing, and no generation (deck deleted) records nothing even when ON", { skip }, async () => {
  const { query } = db!;
  await setSpeechSwitch(false);
  const a = await domlaFixture();
  await runDomla();
  assert.deepEqual(await rowsOf(a.gen), []);

  await setSpeechSwitch(true);
  resetBreakers();
  const b = await domlaFixture();
  await query("DELETE FROM generations WHERE id = $1", [b.gen]);
  const run = await runDomla();
  assert.equal(run.audio.length, 2, "the questions are still spoken");
  // MUTATION 12: a context for a null generation would leave orphan rows (generation_id is nullable).
  assert.deepEqual(await query("SELECT idempotency_key FROM media_jobs WHERE generation_id IS NULL"), [], "no generation: nothing to attach a row to");
  assert.deepEqual(mediaBreakers(), [], "and the core is not used");
  await setSpeechSwitch(false);
});
