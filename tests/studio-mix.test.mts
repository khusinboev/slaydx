import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Studio P8c «Montaj» — pure parts (docs/studio/P8-SPEC.md «P8c»). No DB, no network.
 *
 *   goldens     the full ffmpeg argv per mode and option (replace / keep, volume, offset; ducking on / off, fade on / off):
 *               `-nostdin`, `-protocol_whitelist file,pipe` + an explicit demuxer before EACH input, constant file names,
 *               `-t` = the measured base length, video stream copied;
 *   probe       «every param must work»: each non-id param of each mode, moved off its default, changes the argv (through
 *               `normalize` → `planOf` → `mixArgs`, the engine's own path); the id params change the request (inputs);
 *   safety      no argv element carries request text (a hostile «id» / number never reaches it); numbers are clamped;
 *               an unknown file name is refused by the runner; the runner kills a run at the timeout and removes its dir;
 *   rules       `studioMixError` (unknown mode, missing / malformed / equal ids, out-of-range values), price = the fixed
 *               setting (+ `tool_pricing` %), client preview == server formula, `mixPriceOf` bounds (0–100 000);
 *   media       MP4 track handlers / length, MP3 length (real ffmpeg-made files when ffmpeg is present);
 *   engine      a stubbed ffmpeg: missing binary → «Montaj hozircha ishlamayapti» (refund), failure → refund message,
 *               missing input → refund message, too-long video → refused; REAL ffmpeg (skipped with a message when
 *               missing): both modes → output streams / duration checked with ffprobe.
 *
 * Mutations (each turned the named test red, then restored):
 *   `-protocol_whitelist` dropped before the MP3 inputs                        -> the three "goldens" argv tests;
 *   `-t` printed from `startOffset` instead of the length                     -> "goldens" (both video), "safety", both "engine";
 *   keepOriginal ignored (always replace)                                      -> "probe" (keepOriginal), "goldens … keep";
 *   `ducking` branch removed (always plain amix)                               -> "probe" (ducking), "goldens: voice-music (ducking + fade …)";
 *   fade clamp to half the speech removed                                      -> "goldens: voice-music fade longer than half";
 *   `ida === idb` check removed from `studioMixError`                          -> "rules: request errors";
 *   `mixPriceOf` lower bound 0 → 100                                           -> "rules: price";
 *   FfmpegMissingError mapped like any failure                                 -> "engine: stubbed ffmpeg";
 *   runner `rm` of the temp dir removed                                        -> "runner: timeout + cleanup".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const mix = await import("../lib/media/catalog-mix.ts");
const { mixArgs, mixFilter, MIX_FILES } = await import("../lib/generation/studio/mix-args.ts");
const { buildStudioMix, planOf } = await import("../lib/generation/studio/mix.ts");
const { runFfmpeg, FfmpegMissingError, FfmpegFailedError } = await import("../lib/generation/studio/mix-ffmpeg.ts");
const media = await import("../lib/generation/studio/mix-media.ts");
const tools = await import("../lib/tools.ts");
const { applyPriceAdjust } = await import("../lib/price-adjust.ts");
const { normalize } = await import("../lib/studio-core/index.ts");
const { UserFacingError } = await import("../lib/server/user-error.ts");

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const ffSkip = HAS_FFMPEG ? false : "ffmpeg / ffprobe not installed on this machine — real-ffmpeg checks skipped";

const VID = "11111111-1111-4111-8111-111111111111";
const AUD = "22222222-2222-4222-8222-222222222222";
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
const HEAD = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2"];
const IN_VIDEO = ["-protocol_whitelist", "file,pipe", "-f", "mov", "-i", "in-video.mp4"];
const IN_AUDIO = ["-protocol_whitelist", "file,pipe", "-f", "mp3", "-i", "in-audio.mp3"];
const IN_SPEECH = ["-protocol_whitelist", "file,pipe", "-f", "mp3", "-i", "in-speech.mp3"];
const IN_MUSIC = ["-protocol_whitelist", "file,pipe", "-stream_loop", "-1", "-f", "mp3", "-i", "in-music.mp3"];
const V_TAIL = (t: string) => ["-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-t", t, "-movflags", "+faststart", "-f", "mp4", "out.mp4"];
const A_TAIL = (t: string) => ["-map", "[a]", "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", "-t", t, "-f", "mp3", "out.mp3"];
const F48 = "aformat=sample_rates=48000:channel_layouts=stereo";
const F44 = "aformat=sample_rates=44100:channel_layouts=stereo";

test("goldens: video-voice replace (default options)", () => {
  const args = mixArgs({ mode: "video-voice", videoSeconds: 12.345, videoHasAudio: true, keepOriginal: false, audioVolume: 100, startOffset: 0 });
  assert.deepEqual(args, [...HEAD, ...IN_VIDEO, ...IN_AUDIO, "-filter_complex", `[1:a]${F48},volume=1.000,apad[a]`, ...V_TAIL("12.35")]);
});

test("goldens: video-voice keep + volume + offset", () => {
  const args = mixArgs({ mode: "video-voice", videoSeconds: 8, videoHasAudio: true, keepOriginal: true, audioVolume: 150, startOffset: 3 });
  assert.deepEqual(args, [
    ...HEAD,
    ...IN_VIDEO,
    ...IN_AUDIO,
    "-filter_complex",
    `[0:a]${F48},volume=0.350,apad[o];[1:a]${F48},volume=1.500,adelay=delays=3000:all=1,apad[n];[o][n]amix=inputs=2:duration=longest:normalize=0[a]`,
    ...V_TAIL("8.00"),
  ]);
  // A silent video: «keep» has nothing to keep — the same graph as a replace.
  assert.equal(mixFilter({ mode: "video-voice", videoSeconds: 8, videoHasAudio: false, keepOriginal: true, audioVolume: 150, startOffset: 3 }), `[1:a]${F48},volume=1.500,adelay=delays=3000:all=1,apad[a]`);
});

test("goldens: voice-music (ducking + fade, plain, no fade)", () => {
  assert.deepEqual(mixArgs({ mode: "voice-music", speechSeconds: 30, musicVolume: 20, ducking: true, fadeOut: 3 }), [
    ...HEAD,
    ...IN_SPEECH,
    ...IN_MUSIC,
    "-filter_complex",
    `[0:a]${F44},asplit=2[s][k];[1:a]${F44},volume=0.200,afade=t=out:st=27.000:d=3.000[m0];[m0][k]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[m];[s][m]amix=inputs=2:duration=first:normalize=0[a]`,
    ...A_TAIL("30.00"),
  ]);
  assert.equal(mixFilter({ mode: "voice-music", speechSeconds: 30, musicVolume: 45, ducking: false, fadeOut: 0 }), `[0:a]${F44}[s];[1:a]${F44},volume=0.450[m];[s][m]amix=inputs=2:duration=first:normalize=0[a]`);
});

test("goldens: voice-music fade longer than half the speech is cut to half", () => {
  assert.match(mixFilter({ mode: "voice-music", speechSeconds: 4, musicVolume: 20, ducking: false, fadeOut: 10 }), /afade=t=out:st=2\.000:d=2\.000/);
});

test("safety: numbers are clamped, never printed raw; no request text reaches the argv", () => {
  const wild = mixArgs({ mode: "video-voice", videoSeconds: 9_999, videoHasAudio: true, keepOriginal: false, audioVolume: 5_000, startOffset: 9_999 });
  assert.ok(wild.includes("180.50"), "length clamped to the limit (+ tolerance)");
  assert.match(wild.join(" "), /volume=2\.000/);
  assert.match(wild.join(" "), /adelay=delays=180000:all=1/);
  assert.throws(() => mixArgs({ mode: "voice-music", speechSeconds: Number.NaN, musicVolume: 20, ducking: true, fadeOut: 3 }));
  // A request full of shell / ffmpeg syntax: the normalized plan carries defaults only, the argv is the default argv.
  const hostile = { modelId: mix.MIX_VIDEO_MODEL, videoId: VID, audioId: AUD, keepOriginal: "x;rm -rf /", audioVolume: "100,afade=t=in", startOffset: "1|cat /etc/passwd" };
  const p = normalize(mix.MIX_MODES[0]!.entry.params, hostile);
  const args = mixArgs(planOf("video-voice", p, { seconds: 10, videoHasAudio: true }));
  for (const bad of ["rm -rf", "passwd", "afade=t=in", VID, AUD, "|", "x;"]) assert.ok(!args.some((a) => a.includes(bad)), `argv must not carry ${bad}`);
  // Only constant file names appear as inputs / outputs.
  const files = args.filter((a) => /\.(mp4|mp3)$/.test(a));
  assert.deepEqual(files, [MIX_FILES.video, MIX_FILES.audio, MIX_FILES.outVideo]);
});

test("probe: every non-id param of each mode changes the ffmpeg argv; the id params name the inputs", () => {
  const measured = { seconds: 20, videoHasAudio: true };
  for (const m of mix.MIX_MODES) {
    const ids = mix.MIX_INPUTS[m.mode];
    const base = { modelId: m.model, [ids[0]]: VID, [ids[1]]: AUD };
    const ref = mixArgs(planOf(m.mode, normalize(m.entry.params, base), measured)).join(" ");
    for (const p of m.entry.params) {
      if (ids.includes(p.name)) {
        assert.equal(p.affects, "request", `${m.mode}.${p.name}`);
        continue;
      }
      let alt: unknown;
      if (p.type === "bool") alt = !p.default;
      else if (p.type === "int") alt = p.default === p.max ? p.min : p.default + (p.step ?? 1);
      else assert.fail(`${m.mode}.${p.name}: unexpected type ${p.type}`);
      const v = { ...base, [p.name]: alt };
      assert.equal(mix.studioMixError(v), null, `${m.mode}.${p.name}=${String(alt)} is valid`);
      const got = mixArgs(planOf(m.mode, normalize(m.entry.params, v), measured)).join(" ");
      assert.notEqual(got, ref, `${m.mode}.${p.name} changes the argv`);
      // The price is fixed: no param changes it.
      assert.equal(tools.basePriceFor(tools.TOOL_BY_ID["studio-mix"], v, { soumPerUsd: 1, markup: 2, step: 100, overrides: {}, mixPrice: 700 }), 700);
    }
  }
});

test("rules: request errors (refused before charging)", () => {
  const ok = { modelId: mix.MIX_VIDEO_MODEL, videoId: VID, audioId: AUD };
  assert.equal(mix.studioMixError(ok), null);
  assert.equal(mix.studioMixError({ ...ok, modelId: "studio/other" }), "Noma'lum montaj turi — qaytadan tanlang.");
  assert.equal(mix.studioMixError({ ...ok, videoId: "" }), "Avval videoni tanlang.");
  assert.equal(mix.studioMixError({ ...ok, audioId: "https://example.com/a.mp3" }), "Avval audioni tanlang.");
  assert.equal(mix.studioMixError({ ...ok, audioId: VID }), "Ikki xil natijani tanlang.");
  assert.match(mix.studioMixError({ ...ok, audioVolume: 5 }) ?? "", /Audio balandligi/);
  assert.match(mix.studioMixError({ ...ok, audioVolume: 105 }) ?? "", /Audio balandligi/, "step 10");
  assert.match(mix.studioMixError({ ...ok, startOffset: 180 }) ?? "", /boshlanishi/);
  const voice = { modelId: mix.MIX_VOICE_MODEL, speechId: VID, musicId: AUD };
  assert.equal(mix.studioMixError(voice), null);
  assert.equal(mix.studioMixError({ ...voice, musicId: "" }), "Avval musiqani tanlang.");
  assert.match(mix.studioMixError({ ...voice, musicVolume: 55 }) ?? "", /Musiqa balandligi/);
  assert.match(mix.studioMixError({ ...voice, musicVolume: 4 }) ?? "", /Musiqa balandligi/);
  assert.match(mix.studioMixError({ ...voice, fadeOut: 11 }) ?? "", /so‘nish/);
  // The tool's preflight is this rule.
  assert.equal(tools.preflightError(tools.TOOL_BY_ID["studio-mix"], { ...voice, musicId: "" } as never), "Avval musiqani tanlang.");
  assert.deepEqual(tools.missingRequired(tools.TOOL_BY_ID["studio-mix"], {} as never).length > 0, true);
});

test("rules: price = the fixed setting (+ tool %), client == server, setting bounds", () => {
  const tool = tools.TOOL_BY_ID["studio-mix"];
  assert.equal(tool.basePrice, 500);
  assert.equal(tools.basePriceFor(tool, {}, { soumPerUsd: 1, markup: 2, step: 100, overrides: {}, mixPrice: 1_200 }), 1_200);
  assert.equal(tools.basePriceFor(tool, {}, { soumPerUsd: 1, markup: 2, step: 100, overrides: {}, mixPrice: 0 }), 0, "free is allowed");
  assert.equal(mix.mixPriceOf(0), 0);
  assert.equal(mix.mixPriceOf(100_000), 100_000);
  for (const bad of [-1, 100_001, 12.5, "500", null]) assert.equal(mix.mixPriceOf(bad), 500, String(bad));
  // The browser: the sources endpoint's base + the session's tool %, the same formula as the server's effectivePrice.
  mix.setClientMixPrice(800);
  assert.equal(tools.basePriceFor(tool, {}), 800);
  assert.equal(applyPriceAdjust(tools.basePriceFor(tool, {}), { percent: 125, roundTo: 100 }), 1_000, "800 × 125 %");
  mix.setClientMixPrice(null);
  assert.equal(tools.basePriceFor(tool, {}), 500);
  assert.ok(tools.UNLISTED_TOOL_IDS.has("studio-mix"));
  assert.equal(tools.toolBlockedReason(tool, { llm: false } as never), null, "no provider key decides it");
});

/* ── real-media helpers ── */
function ff(dir: string, args: string[]) {
  const r = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { cwd: dir });
  assert.equal(r.status, 0, String(r.stderr));
}
function probe(file: string): { duration: number; streams: string[] } {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(r.stdout) as { format: { duration: string }; streams: { codec_type: string }[] };
  return { duration: Number(j.format.duration), streams: j.streams.map((s) => s.codec_type) };
}
function fixtures(): { dir: string; video: Uint8Array; silentVideo: Uint8Array; speech: Uint8Array; music: Uint8Array } {
  const dir = mkdtempSync(path.join(tmpdir(), "mix-test-"));
  ff(dir, ["-f", "lavfi", "-i", "testsrc=size=160x120:rate=12", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "v.mp4"]);
  ff(dir, ["-f", "lavfi", "-i", "testsrc=size=160x120:rate=12", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "s.mp4"]);
  ff(dir, ["-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:a", "libmp3lame", "sp.mp3"]);
  ff(dir, ["-f", "lavfi", "-i", "sine=frequency=220:duration=2", "-ac", "2", "-c:a", "libmp3lame", "mu.mp3"]);
  const r = (n: string) => new Uint8Array(readFileSync(path.join(dir, n)));
  return { dir, video: r("v.mp4"), silentVideo: r("s.mp4"), speech: r("sp.mp3"), music: r("mu.mp3") };
}

test("media: MP4 tracks + length, MP3 length (real files)", { skip: ffSkip }, () => {
  const f = fixtures();
  try {
    assert.deepEqual(media.mp4TrackHandlers(f.video).sort(), ["soun", "vide"]);
    assert.equal(media.mp4HasAudio(f.silentVideo), false);
    assert.equal(media.mp4HasVideo(f.silentVideo), true);
    assert.ok(Math.abs(media.mediaSeconds(f.video, "video/mp4") - 6) < 0.2);
    assert.ok(Math.abs(media.mediaSeconds(f.speech, "audio/mpeg") - 3) < 0.15);
    assert.equal(media.mediaSeconds(f.speech, "video/mp4"), 0);
    assert.deepEqual(media.mp4TrackHandlers(new Uint8Array([0, 0, 0, 1, 0x6d, 0x6f, 0x6f, 0x76])), [], "malformed box: nothing, no throw");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

const TOOL = tools.TOOL_BY_ID["studio-mix"];
const V_VALUES = { modelId: mix.MIX_VIDEO_MODEL, videoId: VID, audioId: AUD };
const S_VALUES = { modelId: mix.MIX_VOICE_MODEL, speechId: VID, musicId: AUD };

test("engine: stubbed ffmpeg — missing binary, failure, missing input, too long, bad output", { skip: ffSkip }, async (t) => {
  quiet(t);
  const f = fixtures();
  try {
    const ctx = { inputs: [{ bytes: f.video, mime: "video/mp4" }, { bytes: f.speech, mime: "audio/mpeg" }] as const };
    await assert.rejects(buildStudioMix(TOOL, V_VALUES as never, ctx, {}, { ffmpeg: async () => { throw new FfmpegMissingError(); } }), (e: Error) => e instanceof UserFacingError && /hozircha ishlamayapti\. Kredit qaytariladi/.test(e.message));
    await assert.rejects(buildStudioMix(TOOL, V_VALUES as never, ctx, {}, { ffmpeg: async () => { throw new FfmpegFailedError("exit 1", "boom"); } }), (e: Error) => e instanceof UserFacingError && e.message === "Montaj bajarilmadi. Kredit qaytariladi.");
    await assert.rejects(buildStudioMix(TOOL, V_VALUES as never, { inputs: [ctx.inputs[0], null] }, {}, { ffmpeg: async () => f.video }), /topilmadi .* Kredit qaytariladi/);
    await assert.rejects(buildStudioMix(TOOL, V_VALUES as never, { inputs: [{ bytes: f.speech, mime: "audio/mpeg" }, ctx.inputs[1]] }, {}, { ffmpeg: async () => f.video }), /video o‘qilmadi/);
    await assert.rejects(buildStudioMix(TOOL, { ...V_VALUES, startOffset: 7 } as never, ctx, {}, { ffmpeg: async () => f.video }), /boshlanishi video uzunligidan katta/);
    // An output without a sound track (ffmpeg «succeeded» but dropped the audio) is a failure, not a result.
    await assert.rejects(buildStudioMix(TOOL, V_VALUES as never, ctx, {}, { ffmpeg: async () => f.silentVideo }), /Montaj bajarilmadi/);
    // The argv the engine passes is the builder's, with the measured length.
    let seen: readonly string[] = [];
    const built = await buildStudioMix(TOOL, { ...V_VALUES, audioVolume: 150 } as never, ctx, {}, { ffmpeg: async (r) => ((seen = r.args), f.video) });
    assert.ok(seen.includes("-t") && Math.abs(Number(seen[seen.indexOf("-t") + 1]) - 6) < 0.2);
    assert.match(seen.join(" "), /volume=1\.500/);
    assert.equal(built.mime, "video/mp4");
    assert.equal(built.doc?.mix?.output, "mp4");
    assert.deepEqual(built.doc?.mix?.sources, [VID, AUD]);
    assert.equal(built.doc?.video?.model, mix.MIX_VIDEO_MODEL);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("engine: REAL ffmpeg — both modes, streams and duration checked with ffprobe", { skip: ffSkip }, async (t) => {
  quiet(t);
  const f = fixtures();
  const out = mkdtempSync(path.join(tmpdir(), "mix-out-"));
  try {
    const v = await buildStudioMix(TOOL, { ...V_VALUES, keepOriginal: true, startOffset: 2 } as never, { inputs: [{ bytes: f.video, mime: "video/mp4" }, { bytes: f.speech, mime: "audio/mpeg" }] });
    const vf = path.join(out, "v.mp4");
    (await import("node:fs")).writeFileSync(vf, v.bytes);
    const pv = probe(vf);
    assert.deepEqual(pv.streams.sort(), ["audio", "video"]);
    assert.ok(Math.abs(pv.duration - 6) < 0.25, `video length kept (${pv.duration})`);
    // A silent video + replace.
    const s = await buildStudioMix(TOOL, V_VALUES as never, { inputs: [{ bytes: f.silentVideo, mime: "video/mp4" }, { bytes: f.speech, mime: "audio/mpeg" }] });
    const sf = path.join(out, "s.mp4");
    (await import("node:fs")).writeFileSync(sf, s.bytes);
    assert.deepEqual(probe(sf).streams.sort(), ["audio", "video"], "the silent video got the audio");
    assert.ok(Math.abs(probe(sf).duration - 4) < 0.25, "padded/trimmed to the video (4 s), not the audio (3 s)");

    const a = await buildStudioMix(TOOL, { ...S_VALUES, musicVolume: 30, ducking: true, fadeOut: 1 } as never, { inputs: [{ bytes: f.speech, mime: "audio/mpeg" }, { bytes: f.music, mime: "audio/mpeg" }] });
    const af = path.join(out, "a.mp3");
    (await import("node:fs")).writeFileSync(af, a.bytes);
    const pa = probe(af);
    assert.deepEqual(pa.streams, ["audio"]);
    assert.ok(Math.abs(pa.duration - 3) < 0.2, `length = the speech (${pa.duration}), the 2 s music looped`);
    assert.equal(a.mime, "audio/mpeg");
    assert.equal(a.doc?.mix?.output, "mp3");
    assert.ok(!a.doc?.video, "an MP3 mix has no video model");
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runner: refuses non-constant file names; timeout kills; the temp dir is removed", { skip: ffSkip }, async () => {
  await assert.rejects(runFfmpeg({ inputs: { "../x.mp4": new Uint8Array(1) }, args: [], output: "out.mp4" }), /bad file name/);
  const before = new Set((await import("node:fs")).readdirSync(tmpdir()).filter((n) => n.startsWith("slaydx-mix-")));
  // An endless input (looped lavfi is not allowed by the whitelist, so use a plain long sine) — killed at 300 ms.
  const t0 = Date.now();
  await assert.rejects(
    runFfmpeg({ inputs: {}, args: ["-nostdin", "-f", "lavfi", "-i", "sine=frequency=1:duration=3600", "-f", "null", "-"], output: "out.mp3", timeoutMs: 300 }),
    (e: Error) => e instanceof FfmpegFailedError && /timed out/.test(e.message),
  );
  assert.ok(Date.now() - t0 < 5_000);
  await assert.rejects(runFfmpeg({ inputs: {}, args: [], output: "out.mp3", bin: "slaydx-no-such-ffmpeg" }), (e: Error) => e instanceof FfmpegMissingError);
  const after = (await import("node:fs")).readdirSync(tmpdir()).filter((n) => n.startsWith("slaydx-mix-") && !before.has(n));
  assert.deepEqual(after, [], "no temp dir left behind");
});
