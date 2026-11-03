import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Studio P10 «Transkripsiya» / «Dublyaj» — pure + engine checks (docs/studio/P10-SPEC.md). No network: every ElevenLabs
 * call is a stubbed `fetch`; no database (the dub engine's `media_jobs` side is an injected store).
 *
 *   catalog      entries, purposes, languages (uz … tg in, tk out), source references, refusals of the shared rules;
 *   price        client preview == server `basePriceFor` == `studioEntryPrice`, exact so'm at ×2 / 12 700, + tool %;
 *   golden       the Speech-to-Text multipart fields; the dubbing create body, poll, download, delete (URLs, methods,
 *                key header, fields); the adapters' answer mapping;
 *   probe        EVERY param of both entries changes the request (or the ffmpeg run) or the price — and the probe list
 *                equals the schema, so a new param without a probe turns this red;
 *   subtitles    SRT / VTT timing format, cue splitting (≤ 42 chars × 2 lines, ≤ 6 s, pause, sentence, speaker), no
 *                overlap, Uzbek apostrophes intact, VTT / libass escaping;
 *   burn         the ffmpeg argv (golden), the 25 MB rate cap, one REAL burn of a generated clip (frames differ where the
 *                subtitle is drawn, streams kept) when ffmpeg is installed;
 *   engines      transcribe: no speech, provider failure, wrong source, burn on audio → refund texts; dub: happy path,
 *                provider `failed`, safety, deadline, a re-run RESUMES the parked op (no second POST), a re-run of a
 *                'submitting' row never resubmits, an accepted submit timeout is not retried, wrong output shape.
 *
 * Mutations (each turned the named test red, then restored):
 *   `diarize` always "false" in `sttRequest`                                   -> "golden: STT", "probe";
 *   `language_code` sent for «auto»                                             -> "golden: STT";
 *   `source_lang` sent for «auto» / `watermark` "true"                          -> "golden: dubbing";
 *   `CUE_MAX_CHARS` 42 → 60                                                     -> "subtitles: splitting";
 *   the pause split removed from `buildCues`                                    -> "subtitles: splitting";
 *   `srtTime` with "." instead of ","                                           -> "subtitles: format";
 *   VTT `&` escape removed                                                      -> "subtitles: format";
 *   `burnVideoKbps` floor check removed (always a number)                       -> "burn: args";
 *   `-c:a copy` → `-an` in `burnArgs`                                           -> "burn: REAL ffmpeg" (audio stream lost);
 *   the resume branch of `buildStudioDub` submits again                         -> "dub engine: resume";
 *   'submitting' re-run treated as resumable                                    -> "dub engine: resume";
 *   `giveUp` without the provider DELETE                                        -> "dub engine: failures";
 *   the video/audio shape check of the dub output removed                       -> "dub engine: failures";
 *   `sourceSeconds` taken out of the cost rule (per job)                        -> "price".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const cat = await import("../lib/media/catalog-transcribe.ts");
const rules = await import("../lib/media/studio-transcribe.ts");
const ad = await import("../lib/media/adapters/transcribe-studio.ts");
const subs = await import("../lib/generation/studio/subtitles.ts");
const burn = await import("../lib/generation/studio/burn-args.ts");
const { buildStudioTranscribe } = await import("../lib/generation/studio/transcribe.ts");
const dubMod = await import("../lib/generation/studio/dub.ts");
const tools = await import("../lib/tools.ts");
const { MEDIA_CATALOG, MEDIA_PURPOSES } = await import("../lib/media/catalog.ts");
const { studioEntryPrice } = await import("../lib/media/studio-pricing.ts");
const { applyPriceAdjust } = await import("../lib/price-adjust.ts");
const { normalize, MediaError } = await import("../lib/studio-core/index.ts");
const { UserFacingError } = await import("../lib/server/user-error.ts");
const { speechToolClientPrice, pickResult, pickUpload, speechToolBlocker, speechSources } = await import("../components/studio/audio/speech-tool-api.ts");

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const ffSkip = HAS_FFMPEG ? false : "ffmpeg / ffprobe not installed on this machine — real-ffmpeg checks skipped";

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
const KEY = "sk_test_P10_0123456789abcdef";
const UP = "upload:" + "a".repeat(24);
const RES = "result:11111111-1111-4111-8111-111111111111";
const RES2 = "result:22222222-2222-4222-8222-222222222222";
const PRICING = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {}, costUsd: {} };
const STT = MEDIA_CATALOG.byId(cat.TRANSCRIBE_MODEL)!;
const DUB = MEDIA_CATALOG.byId(cat.DUB_MODEL)!;
const clientOf = (id: string) => MEDIA_CATALOG.clientView().find((e) => e.id === id)!;

function mp3Bytes(frames = 80): Uint8Array {
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}
const asset = (mime: string, bytes: Uint8Array) => ({ media: [{ mime, base64: Buffer.from(bytes).toString("base64") }] });

/* ───────────────────────── catalog + rules ───────────────────────── */

test("catalog: entries, purposes, languages, source references, the shared refusals", () => {
  assert.equal(STT.kind, "speech");
  assert.deepEqual(STT.capabilities, ["stt"]);
  assert.deepEqual(DUB.capabilities, ["dub"]);
  assert.deepEqual(MEDIA_PURPOSES.byId(cat.STUDIO_TRANSCRIBE_PURPOSE)!.allowed, [cat.TRANSCRIBE_MODEL]);
  assert.deepEqual(MEDIA_PURPOSES.byId(cat.STUDIO_DUB_PURPOSE)!.allowed, [cat.DUB_MODEL]);
  const codes = cat.SPEECH_LANGUAGES.map((l) => l.value);
  for (const c of ["uz", "ru", "en", "tr", "kk", "ky", "tg"]) assert.ok(codes.includes(c), c);
  assert.ok(!codes.includes("tk"), "Turkmen is not in the ElevenLabs dubbing list");
  assert.deepEqual(cat.parseSource(UP), { kind: "upload", id: "a".repeat(24) });
  assert.deepEqual(cat.parseSource(RES.toUpperCase()), { kind: "result", id: RES.slice(7) });
  for (const bad of ["", "upload:xyz", "result:1", "http://x", "upload:" + "a".repeat(25), null]) assert.equal(cat.parseSource(bad), null, String(bad));

  assert.equal(rules.studioTranscribeError({}), "Avval manbani tanlang: audio yuklang yoki natijalaringizdan birini tanlang.");
  assert.equal(rules.studioTranscribeError({ source: RES, sourceSeconds: 10 }), null);
  assert.match(String(rules.studioTranscribeError({ source: RES, language: "xx" })), /Nutq tili/);
  assert.match(String(rules.studioTranscribeError({ source: UP, burn: true })), /faqat videoga/);
  assert.match(String(rules.studioDubError({ source: RES, sourceSeconds: 200 })), /1–180/);
  assert.match(String(rules.studioDubError({ source: RES, target: "ru", sourceLang: "ru" })), /bir xil/);
  assert.equal(rules.studioDubError({ source: RES, target: "uz", sourceLang: "ru" }), null);
  // The tool registry calls the same rules (preflight before charging).
  assert.equal(tools.preflightError(tools.TOOL_BY_ID["studio-dub"], { source: RES, target: "en", sourceLang: "en" } as never), "Asl til va dublyaj tili bir xil — boshqa tilni tanlang.");
  assert.ok(tools.UNLISTED_TOOL_IDS.has("studio-transcribe") && tools.UNLISTED_TOOL_IDS.has("studio-dub"));
});

test("price: client preview == server basePriceFor == studioEntryPrice; exact so'm; the tool % after", () => {
  const cases: [string, "transcribe" | "dub", number, number][] = [
    ["studio-transcribe", "transcribe", 30, 800],
    ["studio-transcribe", "transcribe", 60, 1_600],
    ["studio-transcribe", "transcribe", 600, 15_300],
    ["studio-dub", "dub", 15, 3_500],
    ["studio-dub", "dub", 60, 13_900],
    ["studio-dub", "dub", 180, 41_600],
  ];
  for (const [toolId, mode, seconds, want] of cases) {
    const values = { source: RES, sourceSeconds: seconds };
    const tool = tools.TOOL_BY_ID[toolId as "studio-dub"];
    const server = tools.basePriceFor(tool, values as never, PRICING);
    const entry = clientOf(mode === "dub" ? cat.DUB_MODEL : cat.TRANSCRIBE_MODEL);
    assert.equal(server, want, `${toolId} ${seconds} s`);
    assert.equal(studioEntryPrice(entry, values, PRICING), server, "the catalog client view prices the same");
    assert.equal(speechToolClientPrice(mode, entry, values, PRICING, undefined), server, "the browser preview");
    const adj = { percent: 150, roundTo: 100 };
    assert.equal(speechToolClientPrice(mode, entry, values, PRICING, adj), applyPriceAdjust(server, adj), "+ tool_pricing %");
  }
  // More seconds = more money (the billed length is THE price input); a model markup override wins.
  assert.ok(tools.basePriceFor(tools.TOOL_BY_ID["studio-dub"], { source: RES, sourceSeconds: 61 } as never, PRICING) > 13_900);
  assert.equal(tools.basePriceFor(tools.TOOL_BY_ID["studio-transcribe"], { source: RES, sourceSeconds: 60 } as never, { ...PRICING, overrides: { [cat.TRANSCRIBE_MODEL]: { markup: 4 } } }), 3_100);
});

test("client glue: pickers set source + billed seconds, drop the burn for audio; blockers", () => {
  const video = { id: RES.slice(7), title: "Klip", kind: "Video", seconds: 8.2, createdAt: "", media: "video" as const };
  const audio = { id: RES2.slice(7), title: "Ovoz", kind: "Ovoz", seconds: 30, createdAt: "", media: "audio" as const };
  assert.deepEqual(pickResult({ burn: true }, video), { burn: true, source: RES, sourceSeconds: 9 });
  assert.deepEqual(pickResult({ burn: true }, audio), { source: RES2, sourceSeconds: 30 });
  assert.deepEqual(pickUpload({ burn: true, language: "uz" }, { id: "b".repeat(24), seconds: 12 }), { language: "uz", source: "upload:" + "b".repeat(24), sourceSeconds: 12 });
  assert.match(String(speechToolBlocker("transcribe", {})), /manbani tanlang/);
  assert.match(String(speechToolBlocker("dub", { source: RES, sourceSeconds: 5, target: "ru", sourceLang: "ru" })), /bir xil/);
  assert.equal(speechToolBlocker("dub", { source: RES, sourceSeconds: 5, target: "uz" }), null);
  const list = speechSources("dub", { video: [{ ...video, seconds: 200 }, video], audio: [audio] });
  assert.deepEqual(list.map((s) => s.id), [video.id, audio.id], "the 200 s video is not offered for a dub (≤ 180 s)");
});

/* ───────────────────────── golden requests ───────────────────────── */

test("golden: STT multipart fields (model, word timestamps, no audio events, diarize, language only when chosen)", () => {
  const src = asset("video/mp4", new Uint8Array(300));
  const base = ad.sttRequest({ upstreamModel: "scribe_v2", params: normalize(STT.params, { source: RES }), assets: src });
  assert.equal(base.url, "https://api.elevenlabs.io/v1/speech-to-text");
  assert.deepEqual(base.form.fields, { model_id: "scribe_v2", timestamps_granularity: "word", tag_audio_events: "false", diarize: "false" });
  assert.deepEqual(base.form.file, { name: "input.mp4", mime: "video/mp4", bytes: 300 });
  const uz = ad.sttRequest({ upstreamModel: "scribe_v2", params: normalize(STT.params, { source: RES, language: "uz", speakers: true }), assets: asset("audio/wav", new Uint8Array(9)) });
  assert.deepEqual(uz.form.fields, { model_id: "scribe_v2", timestamps_granularity: "word", tag_audio_events: "false", diarize: "true", language_code: "uz" });
  assert.equal(uz.form.file.name, "input.wav");
  assert.throws(() => ad.sttRequest({ upstreamModel: "scribe_v2", params: normalize(STT.params, {}), assets: {} }), MediaError);
});

type Seen = { url: string; method: string; key: string | null; fields: Record<string, string>; file: string | null };
function stubFetch(t: TestContext, reply: (s: Seen) => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  t.mock.method(globalThis, "fetch", async (u: string | URL, init: RequestInit = {}) => {
    const fields: Record<string, string> = {};
    let file: string | null = null;
    if (init.body instanceof FormData) {
      for (const [k, v] of init.body.entries()) {
        if (typeof v === "string") fields[k] = v;
        else file = `${k}:${(v as File).name}:${(v as File).type}:${(v as File).size}`;
      }
    }
    const headers = new Headers(init.headers);
    const s: Seen = { url: String(u), method: String(init.method ?? "GET"), key: headers.get("xi-api-key"), fields, file };
    seen.push(s);
    return reply(s);
  });
  return seen;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("golden: STT adapter answer → normalized inline JSON; 5xx retryable; a 200 without words is accepted (never retried)", async (t) => {
  const seen = stubFetch(t, () => json(200, { language_code: "uzb", text: "Salom dunyo", words: [{ text: "Salom", start: 0, end: 0.4, type: "word", speaker_id: "speaker_0" }, { text: " ", start: 0.4, end: 0.5, type: "spacing" }] }));
  const a = ad.sttAdapter({ key: () => KEY });
  const r = await a.submit({ upstreamModel: "scribe_v2", params: normalize(STT.params, { source: RES, speakers: true }), assets: asset("audio/mpeg", mp3Bytes(2)), idempotencyKey: "k" });
  assert.equal(seen[0]!.method, "POST");
  assert.equal(seen[0]!.key, KEY);
  assert.equal(seen[0]!.fields.diarize, "true");
  assert.match(String(seen[0]!.file), /^file:input\.mp3:audio\/mpeg:834$/);
  const out = (r as { done: { kind: string; bytes: Uint8Array; mime: string }[] }).done[0]!;
  assert.equal(out.mime, "application/json");
  const body = JSON.parse(new TextDecoder().decode(out.bytes));
  assert.equal(body.text, "Salom dunyo");
  assert.equal(body.languageCode, "uzb");
  assert.equal(body.words[0].speaker_id, "speaker_0");

  t.mock.restoreAll();
  stubFetch(t, () => json(503, { detail: "busy" }));
  await assert.rejects(a.submit({ upstreamModel: "scribe_v2", params: normalize(STT.params, { source: RES }), assets: asset("audio/mpeg", mp3Bytes(2)), idempotencyKey: "k" }), (e: unknown) => e instanceof MediaError && e.retryable && !String(e.message).includes(KEY));
  t.mock.restoreAll();
  stubFetch(t, () => json(200, { detail: "odd" }));
  await assert.rejects(a.submit({ upstreamModel: "scribe_v2", params: normalize(STT.params, { source: RES }), assets: asset("audio/mpeg", mp3Bytes(2)), idempotencyKey: "k" }), (e: unknown) => e instanceof MediaError && e.accepted);
});

test("golden: dubbing create body, op id, poll states, download URL, DELETE", async (t) => {
  const seen = stubFetch(t, (s) => {
    if (s.method === "POST") return json(200, { dubbing_id: "dub_ABC123", expected_duration_sec: 12 });
    if (s.method === "DELETE") return json(200, { status: "ok" });
    if (s.url.endsWith("/audio/uz")) return new Response(Buffer.from(mp3Bytes(4)), { status: 200 });
    return json(200, { status: "dubbing" });
  });
  const a = ad.dubAdapter({ key: () => KEY });
  const auto = ad.dubRequest({ params: normalize(DUB.params, { source: RES }), assets: asset("video/mp4", new Uint8Array(50)) });
  assert.deepEqual(auto.form.fields, { target_lang: "uz", num_speakers: "0", watermark: "false", name: "SlaydX Studio" });
  const chosen = ad.dubRequest({ params: normalize(DUB.params, { source: RES, target: "ru", sourceLang: "uz" }), assets: asset("video/mp4", new Uint8Array(50)) });
  assert.deepEqual(chosen.form.fields, { target_lang: "ru", source_lang: "uz", num_speakers: "0", watermark: "false", name: "SlaydX Studio" });

  const r = await a.submit({ upstreamModel: "dubbing-automatic", params: normalize(DUB.params, { source: RES }), assets: asset("audio/mpeg", mp3Bytes(2)), idempotencyKey: "k" });
  assert.deepEqual(r, { opId: "dub_ABC123:uz" });
  assert.equal(seen[0]!.url, "https://api.elevenlabs.io/v1/dubbing");
  assert.equal(seen[0]!.key, KEY);
  assert.equal(seen[0]!.fields.target_lang, "uz");
  assert.ok(seen[0]!.file?.startsWith("file:input.mp3:audio/mpeg"));
  assert.deepEqual(await a.poll!("dub_ABC123:uz"), { state: "running" });
  assert.equal(seen[1]!.url, "https://api.elevenlabs.io/v1/dubbing/dub_ABC123");
  assert.equal(seen[1]!.method, "GET");
  const bytes = await a.fetchOutput({ kind: "url", url: ad.elevenLabsDubAudioUrl("dub_ABC123", "uz") });
  assert.equal(bytes.length, 417 * 4);
  assert.equal(seen[2]!.url, "https://api.elevenlabs.io/v1/dubbing/dub_ABC123/audio/uz");
  await assert.rejects(a.fetchOutput({ kind: "url", url: "https://evil.example/x" }), /unexpected download url/);
  assert.equal(await a.cancel!("dub_ABC123:uz"), "cancelled");
  assert.equal(seen.at(-1)!.method, "DELETE");
  assert.equal(seen.at(-1)!.url, "https://api.elevenlabs.io/v1/dubbing/dub_ABC123");

  t.mock.restoreAll();
  stubFetch(t, () => json(200, { status: "dubbed" }));
  assert.deepEqual(await a.poll!("dub_ABC123:ru"), { state: "done", outputs: [{ kind: "url", url: "https://api.elevenlabs.io/v1/dubbing/dub_ABC123/audio/ru" }] });
  t.mock.restoreAll();
  stubFetch(t, () => json(200, { status: "failed", error: "Content moderation: not allowed" }));
  assert.deepEqual(await a.poll!("dub_ABC123:uz"), { state: "failed", message: "Content moderation: not allowed", safety: true });
  assert.deepEqual(await a.poll!("bad op"), { state: "failed", message: "bad dubbing op id", safety: false });
});

/* ───────────────────────── probe ───────────────────────── */

const sttWords = (text: string) => ({ language_code: "uz", text, words: text.split(" ").map((w, i) => ({ text: w, start: i * 0.5, end: i * 0.5 + 0.4, type: "word", speaker_id: `speaker_${i % 2}` })) });
const runStub = (answer: unknown, seen: { values?: Record<string, unknown>; assets?: unknown }[] = []) => async (i: { values: Readonly<Record<string, unknown>>; assets?: unknown }) => {
  seen.push({ values: { ...i.values }, assets: i.assets });
  return { outputs: [{ kind: "inline" as const, bytes: new TextEncoder().encode(JSON.stringify(ad.sttResultOf(answer))), mime: "application/json" }] };
};

test("probe: every P10 param changes the request, the ffmpeg run or the price (and the probe list = the schema)", async (t) => {
  quiet(t);
  const probes: Record<string, Record<string, () => Promise<boolean> | boolean>> = {
    [cat.TRANSCRIBE_MODEL]: {
      language: () => JSON.stringify(ad.sttRequest({ upstreamModel: "m", params: normalize(STT.params, { source: RES }), assets: asset("audio/mpeg", new Uint8Array(1)) }).form.fields) !== JSON.stringify(ad.sttRequest({ upstreamModel: "m", params: normalize(STT.params, { source: RES, language: "ru" }), assets: asset("audio/mpeg", new Uint8Array(1)) }).form.fields),
      speakers: () => ad.sttRequest({ upstreamModel: "m", params: normalize(STT.params, { source: RES, speakers: true }), assets: asset("audio/mpeg", new Uint8Array(1)) }).form.fields.diarize === "true" && ad.sttRequest({ upstreamModel: "m", params: normalize(STT.params, { source: RES }), assets: asset("audio/mpeg", new Uint8Array(1)) }).form.fields.diarize === "false",
      sourceSeconds: () => tools.basePriceFor(tools.TOOL_BY_ID["studio-transcribe"], { source: RES, sourceSeconds: 10 } as never, PRICING) !== tools.basePriceFor(tools.TOOL_BY_ID["studio-transcribe"], { source: RES, sourceSeconds: 100 } as never, PRICING),
      source: async () => {
        const seen: { assets?: unknown }[] = [];
        const ctxA = { source: { kind: "result" as const, id: RES.slice(7), mime: "audio/mpeg", bytes: mp3Bytes(3), seconds: 3 } };
        const ctxB = { source: { kind: "result" as const, id: RES2.slice(7), mime: "audio/mpeg", bytes: mp3Bytes(5), seconds: 5 } };
        await buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { source: RES, sourceSeconds: 3 } as never, ctxA, {}, { run: runStub(sttWords("bir ikki"), seen) as never });
        await buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { source: RES2, sourceSeconds: 5 } as never, ctxB, {}, { run: runStub(sttWords("bir ikki"), seen) as never });
        return JSON.stringify(seen[0]!.assets) !== JSON.stringify(seen[1]!.assets);
      },
      burn: async () => {
        let ran = 0;
        const ctx = { source: { kind: "result" as const, id: RES.slice(7), mime: "video/mp4", bytes: new Uint8Array(10), seconds: 3 } };
        const ff = async () => {
          ran++;
          throw new Error("probe stop");
        };
        await buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { source: RES, sourceSeconds: 3 } as never, ctx, {}, { run: runStub(sttWords("bir ikki")) as never, ffmpeg: ff });
        await assert.rejects(buildStudioTranscribe(tools.TOOL_BY_ID["studio-transcribe"], { source: RES, sourceSeconds: 3, burn: true } as never, ctx, {}, { run: runStub(sttWords("bir ikki")) as never, ffmpeg: ff }));
        return ran === 1;
      },
    },
    [cat.DUB_MODEL]: {
      target: () => ad.dubRequest({ params: normalize(DUB.params, { source: RES, target: "ru" }), assets: asset("audio/mpeg", new Uint8Array(1)) }).form.fields.target_lang === "ru",
      sourceLang: () => ad.dubRequest({ params: normalize(DUB.params, { source: RES, sourceLang: "en" }), assets: asset("audio/mpeg", new Uint8Array(1)) }).form.fields.source_lang === "en",
      sourceSeconds: () => tools.basePriceFor(tools.TOOL_BY_ID["studio-dub"], { source: RES, sourceSeconds: 10 } as never, PRICING) !== tools.basePriceFor(tools.TOOL_BY_ID["studio-dub"], { source: RES, sourceSeconds: 100 } as never, PRICING),
      source: () => ad.dubRequest({ params: normalize(DUB.params, { source: RES }), assets: asset("video/mp4", new Uint8Array(7)) }).form.file.name !== ad.dubRequest({ params: normalize(DUB.params, { source: UP }), assets: asset("audio/wav", new Uint8Array(7)) }).form.file.name,
    },
  };
  for (const entry of [STT, DUB]) {
    assert.deepEqual(Object.keys(probes[entry.id]!).sort(), entry.params.map((p) => p.name).sort(), `${entry.id}: one probe per param`);
    for (const [name, probe] of Object.entries(probes[entry.id]!)) assert.equal(await probe(), true, `${entry.id}.${name} changes nothing`);
  }
});

/* ───────────────────────── subtitles ───────────────────────── */

test("subtitles: format — SRT comma / VTT dot, hours, escaping, Uzbek apostrophes intact", () => {
  assert.equal(subs.srtTime(0), "00:00:00,000");
  assert.equal(subs.srtTime(3_723.0456), "01:02:03,046");
  assert.equal(subs.vttTime(61.5), "00:01:01.500");
  const cues = [
    { start: 0.2, end: 1.5, lines: ["Oʻzbekiston gʻalabasi — o‘g‘il, o’rik, o'tin"], speaker: null },
    { start: 2, end: 3, lines: ["A & B <i>", "{\\an8}qavs"], speaker: null },
  ];
  assert.equal(subs.toSrt(cues), "1\n00:00:00,200 --> 00:00:01,500\nOʻzbekiston gʻalabasi — o‘g‘il, o’rik, o'tin\n\n2\n00:00:02,000 --> 00:00:03,000\nA & B <i>\n{\\an8}qavs\n");
  assert.equal(subs.toVtt(cues), "WEBVTT\n\n00:00:00.200 --> 00:00:01.500\nOʻzbekiston gʻalabasi — o‘g‘il, o’rik, o'tin\n\n00:00:02.000 --> 00:00:03.000\nA &amp; B &lt;i&gt;\n{\\an8}qavs\n");
  // The burn copy neutralises libass override braces / escapes, nothing else.
  assert.equal(subs.toSrt([cues[1]!], { forBurn: true }), "1\n00:00:02,000 --> 00:00:03,000\nA & B <i>\n(/an8)qavs\n");
});

const word = (text: string, start: number, end: number, speaker = "s0") => ({ text, start, end, type: "word", speaker_id: speaker });

test("subtitles: splitting — ≤ 42 chars × 2 lines, ≤ 6 s, a pause, a sentence end, a speaker change; no overlap", () => {
  // 24 words of «ozbekcha» (8 chars): 4 per 42-char line, 8 per cue — three cues; spacing items are ignored.
  const many = Array.from({ length: 24 }, (_, i) => word("o‘zbekcha", i * 0.2, i * 0.2 + 0.15));
  const withSpacing = many.flatMap((w) => [w, { text: " ", start: w.end, end: w.end, type: "spacing" }]);
  const cues = subs.buildCues(withSpacing, { speakers: false });
  assert.equal(cues.length, 3);
  for (const c of cues) {
    assert.ok(c.lines.length <= 2 && c.lines.every((l) => l.length <= 42), JSON.stringify(c.lines));
    assert.ok(c.lines.join(" ").split(" ").every((w) => w === "o‘zbekcha"), "words never cut, apostrophes kept");
  }
  assert.deepEqual(cues[0]!.lines, ["o‘zbekcha o‘zbekcha o‘zbekcha o‘zbekcha", "o‘zbekcha o‘zbekcha o‘zbekcha o‘zbekcha"]);
  // ≤ 6 s: slow words (1 s each) split at 6 s even with room left.
  const slow = subs.buildCues(Array.from({ length: 9 }, (_, i) => word("a", i, i + 0.9)), { speakers: false });
  assert.ok(slow.every((c) => c.end - c.start <= 6 + 1e-9), JSON.stringify(slow));
  assert.equal(slow.length, 2);
  // A pause > 1 s starts a new cue; a sentence end after ≥ 1.5 s too.
  assert.equal(subs.buildCues([word("bir", 0, 0.3), word("ikki", 1.6, 1.9)], { speakers: false }).length, 2);
  assert.equal(subs.buildCues([word("bir", 0, 0.3), word("ikki", 0.5, 0.8)], { speakers: false }).length, 1);
  assert.equal(subs.buildCues([word("Salom.", 0, 1.6), word("Yana", 1.7, 2)], { speakers: false }).length, 2);
  // Speakers: a change splits, the label leads the first line; off = one cue, no label.
  const two = [word("Salom", 0, 0.4, "a"), word("Va", 0.5, 0.7, "b"), word("alaykum", 0.8, 1.1, "b")];
  const labelled = subs.buildCues(two, { speakers: true });
  assert.deepEqual(labelled.map((c) => [c.speaker, c.lines]), [[1, ["1: Salom"]], [2, ["2: Va alaykum"]]]);
  assert.deepEqual(subs.buildCues(two, { speakers: false }).map((c) => c.lines), [["Salom Va alaykum"]]);
  // Min 0.7 s gives way to the next cue: never an overlap.
  const tight = subs.buildCues([word("bir.", 0, 0.1), word("ikki", 1.2, 1.4)], { speakers: false });
  assert.ok(tight[0]!.end <= tight[1]!.start);
  assert.equal(tight[0]!.end, 0.7);
  // Transcript text: the provider's own text without labels, turns with them.
  assert.equal(subs.transcriptOf(two, "Salom. Va alaykum!", { speakers: false }), "Salom. Va alaykum!");
  assert.equal(subs.transcriptOf(two, "x", { speakers: true }), "1: Salom\n\n2: Va alaykum");
  assert.deepEqual(subs.buildCues([], { speakers: false }), []);
});

/* ───────────────────────── burn ───────────────────────── */

test("burn: args (golden), the 25 MB rate cap, the vertical style", () => {
  assert.equal(burn.burnVideoKbps(60), 3_163);
  assert.equal(burn.burnVideoKbps(180), 926);
  assert.equal(burn.burnVideoKbps(10), 6_000, "capped");
  assert.equal(burn.burnVideoKbps(300), null, "even 800 kb/s cannot fit 25 MB — refused before charging");
  assert.equal(burn.burnVideoKbps(0), null);
  assert.deepEqual(burn.burnArgs({ seconds: 5, vertical: false, videoKbps: 3000 }), [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-protocol_whitelist", "file", "-f", "mov", "-i", "in-video.mp4",
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", "subtitles=filename=subs.srt:charenc=UTF-8:force_style='FontName=Noto Sans,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.2,Shadow=0,MarginV=18'",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "3000k", "-bufsize", "6000k", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", "-threads", "2", "-t", "5.000", "-y", "out-burn.mp4",
  ]);
  assert.match(burn.burnArgs({ seconds: 5, vertical: true, videoKbps: 99_999 }).join(" "), /FontSize=9,.*MarginV=40.*-maxrate 6000k/);
});

function grayFrame(file: string, at: number): Buffer {
  const r = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 10 << 20 });
  assert.equal(r.status, 0, String(r.stderr));
  return r.stdout as Buffer;
}
function probeStreams(file: string): { duration: number; streams: string[] } {
  const j = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file], { encoding: "utf8" }).stdout) as { format: { duration: string }; streams: { codec_type: string }[] };
  return { duration: Number(j.format.duration), streams: j.streams.map((s) => s.codec_type).sort() };
}

test("burn: REAL ffmpeg — a generated clip gets the Uzbek subtitle drawn (bottom pixels change), audio kept", { skip: ffSkip }, async (t) => {
  quiet(t);
  const dir = mkdtempSync(path.join(tmpdir(), "p10-burn-"));
  try {
    const src = path.join(dir, "src.mp4");
    const mk = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:size=320x240:rate=12", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
    assert.equal(mk.status, 0, String(mk.stderr));
    const bytes = new Uint8Array(readFileSync(src));
    const answer = { language_code: "uz", text: "Oʻzbekiston gʻalabasi", words: [word("Oʻzbekiston", 0.1, 1.2), word("gʻalabasi", 1.3, 2.8)] };
    const built = await buildStudioTranscribe(
      tools.TOOL_BY_ID["studio-transcribe"],
      { source: RES, sourceSeconds: 3, burn: true } as never,
      { source: { kind: "result", id: RES.slice(7), mime: "video/mp4", bytes, seconds: 3, aspect: "4:3" } },
      {},
      { run: runStub(answer) as never },
    );
    assert.equal(built.mime, "video/mp4");
    assert.equal(built.doc?.transcribe?.burned, true);
    assert.equal(built.doc?.transcribe?.output, "mp4");
    assert.equal(built.doc?.video?.model, cat.TRANSCRIBE_MODEL);
    const out = path.join(dir, "out.mp4");
    writeFileSync(out, built.bytes);
    const p = probeStreams(out);
    assert.deepEqual(p.streams, ["audio", "video"], "the audio track is kept");
    assert.ok(Math.abs(p.duration - 3) < 0.3, `length kept (${p.duration})`);
    const a = grayFrame(src, 1.5);
    const b = grayFrame(out, 1.5);
    assert.equal(a.length, 320 * 240);
    const diff = (from: number, to: number) => {
      let n = 0;
      for (let i = from * 320; i < to * 320; i++) if (Math.abs(a[i]! - b[i]!) > 40) n++;
      return n;
    };
    assert.ok(diff(170, 240) > 300, `the subtitle is drawn at the bottom (${diff(170, 240)} px changed)`);
    assert.ok(diff(0, 100) < 50, `the top stays clean (${diff(0, 100)} px changed)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ───────────────────────── engines ───────────────────────── */

const TR = () => tools.TOOL_BY_ID["studio-transcribe"];
const audioCtx = (id = RES) => ({ source: { kind: "result" as const, id: id.slice(7), mime: "audio/mpeg", bytes: mp3Bytes(40), seconds: 1.04 } });

test("transcribe engine: TXT result + cues; no speech is a result (not burned); failures refund", async (t) => {
  quiet(t);
  const ok = await buildStudioTranscribe(TR(), { source: RES, sourceSeconds: 2, speakers: true, language: "uz" } as never, audioCtx(), {}, { run: runStub(sttWords("Salom Oʻzbekiston")) as never });
  assert.equal(ok.mime, "text/plain; charset=utf-8");
  assert.equal(new TextDecoder().decode(ok.bytes), "1: Salom\n\n2: Oʻzbekiston\n");
  assert.ok(ok.fileName.endsWith(".txt"));
  assert.equal(ok.doc?.transcribe?.language, "uz");
  assert.equal(ok.doc?.transcribe?.requestedLanguage, "uz");
  assert.equal(ok.doc?.transcribe?.speakers, true);
  assert.equal(ok.doc?.transcribe?.sourceId, RES.slice(7));
  assert.equal(ok.doc?.transcribe?.cues.length, 2);
  assert.ok(!ok.doc?.video);

  let ffRan = false;
  const silent = await buildStudioTranscribe(TR(), { source: RES, sourceSeconds: 3, burn: true } as never, { source: { kind: "result", id: RES.slice(7), mime: "video/mp4", bytes: new Uint8Array(9), seconds: 3 } }, {}, {
    run: runStub({ language_code: "uz", text: "", words: [] }) as never,
    ffmpeg: async () => ((ffRan = true), new Uint8Array(0)),
  });
  assert.equal(silent.doc?.transcribe?.burned, false);
  assert.equal(ffRan, false, "nothing to burn");
  assert.equal(new TextDecoder().decode(silent.bytes), "(Nutq topilmadi)\n");

  const failing = async () => {
    throw new MediaError("elevenlabs", "500 boom", { retryable: true });
  };
  await assert.rejects(buildStudioTranscribe(TR(), { source: RES, sourceSeconds: 2 } as never, audioCtx(), {}, { run: failing as never }), (e: Error) => e instanceof UserFacingError && /Transkripsiya bajarilmadi.*Kredit qaytariladi/.test(e.message));
  await assert.rejects(buildStudioTranscribe(TR(), { source: RES, sourceSeconds: 2 } as never, audioCtx(RES2), {}, { run: runStub(sttWords("a")) as never }), /manba topilmadi/);
  await assert.rejects(buildStudioTranscribe(TR(), { source: RES, sourceSeconds: 2 } as never, { source: null }, {}, { run: runStub(sttWords("a")) as never }), /Kredit qaytariladi/);
  await assert.rejects(buildStudioTranscribe(TR(), { source: UP, sourceSeconds: 2, burn: true } as never, { source: { ...audioCtx().source, kind: "upload", id: "a".repeat(24) } }, {}, { run: runStub(sttWords("a")) as never }), /faqat videoga/);
  const long = { source: { kind: "result" as const, id: RES.slice(7), mime: "video/mp4", bytes: new Uint8Array(9), seconds: 200 } };
  await assert.rejects(buildStudioTranscribe(TR(), { source: RES, sourceSeconds: 3 } as never, long, {}, { run: runStub(sttWords("a")) as never }), /3 daqiqadan uzun/);
});

type StoreCall = [string, ...unknown[]];
function fakeStore(row: { status: string; opId: string | null; fresh: boolean } = { status: "submitting", opId: null, fresh: true }) {
  const calls: StoreCall[] = [];
  const store = {
    begin: async (i: { key: string }) => (calls.push(["begin", i.key]), { id: "row1", ...row }),
    park: async (id: string, opId: string) => void calls.push(["park", id, opId]),
    finish: async (id: string, meta: { mime: string }) => void calls.push(["finish", id, meta.mime]),
    fail: async (id: string, message: string) => void calls.push(["fail", id, message]),
  };
  return { store, calls };
}
const HEALTH = { allow: () => true, success: () => undefined, failure: () => undefined };
const DUBT = () => tools.TOOL_BY_ID["studio-dub"];
const clock = () => {
  let now = 1_000_000;
  return { now: () => now, sleep: async (ms: number) => void (now += ms) };
};

let VIDEO_MP4: Uint8Array | null = null;
function videoMp4(): Uint8Array {
  if (VIDEO_MP4) return VIDEO_MP4;
  const dir = mkdtempSync(path.join(tmpdir(), "p10-dub-"));
  try {
    const f = path.join(dir, "v.mp4");
    const r = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:size=64x48:rate=6", "-f", "lavfi", "-i", "sine", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f]);
    assert.equal(r.status, 0);
    return (VIDEO_MP4 = new Uint8Array(readFileSync(f)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function dubFetch(t: TestContext, o: { statuses?: string[]; output?: () => Uint8Array; create?: () => Response; error?: string } = {}) {
  const statuses = [...(o.statuses ?? ["dubbing", "dubbed"])];
  return stubFetch(t, (s) => {
    if (s.method === "POST") return o.create ? o.create() : json(200, { dubbing_id: "dub_X1", expected_duration_sec: 5 });
    if (s.method === "DELETE") return json(200, {});
    if (s.url.includes("/audio/")) return new Response(Buffer.from((o.output ?? (() => mp3Bytes(60)))()), { status: 200 });
    const st = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
    return json(200, { status: st, ...(o.error ? { error: o.error } : {}) });
  });
}

test("dub engine: happy path (audio → MP3, video → MP4), the row parked then finished, the project deleted", { skip: ffSkip }, async (t) => {
  quiet(t);
  const seen = dubFetch(t);
  const { store, calls } = fakeStore();
  const c = clock();
  const out = await dubMod.buildStudioDub(DUBT(), { source: RES, sourceSeconds: 2, target: "ru" } as never, audioCtx(), { deadline: c.now() + 500_000 }, { adapters: ad.transcribeAdapters({ key: () => KEY }), store, health: HEALTH, ...c });
  assert.equal(out.mime, "audio/mpeg");
  assert.equal(out.doc?.dub?.output, "mp3");
  assert.equal(out.doc?.dub?.target, "ru");
  assert.ok(!out.doc?.video);
  assert.deepEqual(calls.map((x) => x[0]), ["begin", "park", "finish"]);
  assert.equal(calls[1]![2], "dub_X1:uz".replace("uz", "ru"));
  assert.deepEqual(seen.map((s) => s.method), ["POST", "GET", "GET", "GET", "DELETE"]);

  t.mock.restoreAll();
  quiet(t);
  dubFetch(t, { statuses: ["dubbed"], output: videoMp4 });
  const v = await dubMod.buildStudioDub(DUBT(), { source: RES, sourceSeconds: 2 } as never, { source: { kind: "result", id: RES.slice(7), mime: "video/mp4", bytes: videoMp4(), seconds: 2, aspect: "9:16" } }, { deadline: c.now() + 500_000 }, { adapters: ad.transcribeAdapters({ key: () => KEY }), store: null, health: HEALTH, ...c });
  assert.equal(v.mime, "video/mp4");
  assert.equal(v.doc?.dub?.output, "mp4");
  assert.equal(v.doc?.video?.aspect, "9:16");
  assert.ok(v.fileName.endsWith(".mp4"));
});

test("dub engine: resume — a re-run polls the parked op (no second POST); a 'submitting' row is never resubmitted", async (t) => {
  quiet(t);
  const seen = dubFetch(t, { statuses: ["dubbed"] });
  const resumed = fakeStore({ status: "pending", opId: "dub_OLD:uz", fresh: false });
  const c = clock();
  const out = await dubMod.buildStudioDub(DUBT(), { source: RES, sourceSeconds: 2 } as never, audioCtx(), { deadline: c.now() + 500_000 }, { adapters: ad.transcribeAdapters({ key: () => KEY }), store: resumed.store, health: HEALTH, ...c });
  assert.equal(out.mime, "audio/mpeg");
  assert.ok(!seen.some((s) => s.method === "POST"), "the paid dub is never submitted twice");
  assert.ok(seen.some((s) => s.url.endsWith("/v1/dubbing/dub_OLD")), "the old op is polled");

  for (const row of [{ status: "submitting", opId: null, fresh: false }, { status: "failed", opId: null, fresh: false }]) {
    t.mock.restoreAll();
    quiet(t);
    const s2 = dubFetch(t);
    const st = fakeStore(row);
    await assert.rejects(
      dubMod.buildStudioDub(DUBT(), { source: RES, sourceSeconds: 2 } as never, audioCtx(), {}, { adapters: ad.transcribeAdapters({ key: () => KEY }), store: st.store, health: HEALTH, ...clock() }),
      (e: Error) => e instanceof UserFacingError && e.message === dubMod.DUB_LOST_MESSAGE,
    );
    assert.equal(s2.length, 0, `${row.status}: no provider call at all`);
    assert.equal(st.calls.at(-1)![0], "fail");
  }
});

test("dub engine: failures — provider failed / safety / deadline / submit 500 / accepted timeout / wrong output shape → refund texts", async (t) => {
  quiet(t);
  const run = async (fetchOpts: Parameters<typeof dubFetch>[1], ctx = audioCtx(), deadlineIn = 500_000) => {
    t.mock.restoreAll();
    quiet(t);
    const seen = dubFetch(t, fetchOpts);
    const st = fakeStore();
    const c = clock();
    const err = await dubMod
      .buildStudioDub(DUBT(), { source: RES, sourceSeconds: 2 } as never, ctx, { deadline: c.now() + deadlineIn }, { adapters: ad.transcribeAdapters({ key: () => KEY }), store: st.store, health: HEALTH, ...c })
      .then(() => null, (e: Error) => e);
    return { err, seen, calls: st.calls };
  };
  const failed = await run({ statuses: ["failed"], error: "internal" });
  assert.equal(failed.err?.message, dubMod.DUB_FAILED_MESSAGE);
  assert.ok(failed.seen.some((s) => s.method === "DELETE"), "a dub we give up on is deleted at ElevenLabs");
  assert.equal(failed.calls.at(-1)![0], "fail");

  const safety = await run({ statuses: ["failed"], error: "Content moderation policy" });
  assert.equal(safety.err?.message, dubMod.DUB_SAFETY_MESSAGE);

  const late = await run({ statuses: ["dubbing"] }, audioCtx(), 120_000);
  assert.equal(late.err?.message, dubMod.DUB_DEADLINE_MESSAGE);
  assert.ok(late.seen.some((s) => s.method === "DELETE"));
  assert.ok(!late.seen.some((s) => s.url.includes("/audio/")), "nothing downloaded");

  const boom = await run({ create: () => json(500, { detail: "boom" }) });
  assert.equal(boom.err?.message, dubMod.DUB_FAILED_MESSAGE);
  assert.equal(boom.seen.filter((s) => s.method === "POST").length, 1, "one route: a 5xx is not resent elsewhere");
  assert.deepEqual(boom.calls.map((x) => x[0]), ["begin", "fail"]);

  const timedOut = await run({ create: () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); } });
  assert.equal(timedOut.err?.message, dubMod.DUB_FAILED_MESSAGE);
  assert.equal(timedOut.seen.filter((s) => s.method === "POST").length, 1, "an accepted (timed-out) submit is never retried");

  // An audio source must come back as an MP3 (here: garbage bytes) — refused, refunded, deleted.
  const shape = await run({ statuses: ["dubbed"], output: () => new Uint8Array([1, 2, 3, 4]) });
  assert.equal(shape.err?.message, dubMod.DUB_FAILED_MESSAGE);
  assert.ok(shape.seen.some((s) => s.method === "DELETE"));

  const tooLong = await dubMod.buildStudioDub(DUBT(), { source: RES, sourceSeconds: 2 } as never, { source: { ...audioCtx().source, seconds: 200 } }, {}, { store: null, health: HEALTH }).then(() => null, (e: Error) => e);
  assert.match(String(tooLong?.message), /3 daqiqadan uzun/);
});
