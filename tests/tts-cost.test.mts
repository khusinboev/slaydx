import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import {
  GEMINI_AUDIO_TOKENS_PER_SECOND,
  IMAGE_PRICES,
  TTS_PRICING,
  imagePriceOf,
  imageUnitUsd,
  ttsCost,
  type TtsPriceRow,
} from "../lib/generation/llm-pricing.ts";
import { geminiTtsUsage, makeGeminiTts } from "../lib/generation/tts/gemini.ts";
import { chainOfProvider } from "../lib/generation/tts/chain.ts";
import { TtsMeter, ttsUsageCost, type TtsAudio, type TtsProvider } from "../lib/generation/tts/types.ts";
import { buildAudioArtifact } from "../lib/generation/audio/engine.ts";
import { type AudioLine } from "../lib/generation/audio/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOLS } from "../lib/tools.ts";
import type { CompleteFn } from "../lib/generation/research/pipeline.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * TTS COST (price book `llm-pricing.ts ttsCost`, `TtsMeter`, the chain's `recordTts`,
 * `ai_usage.parts`): Gemini TTS bills TOKENS (text-in + audio-out), the other
 * providers characters; an unknown model is flagged «unpriced», never a silent $0.
 *
 * Production probe (2026-10-10): 15 s of Uzbek speech = 370 audio tokens + 70 text
 * tokens on gemini-2.5-flash-preview-tts ≈ $0.0037.
 *
 * Mutations (each turned the named test red):
 *   1. `ttsCost` returning usd 0 for token billing  -> «exact numbers», «TtsMeter»,
 *      «end to end through the audio engine» (usd > 0 in cost_json.parts and ai_usage);
 *   2. an unknown model priced as flash                -> «unknown model is flagged»;
 *   3. `priced:false` dropped in `chain.ts recordTts`  -> «unknown model … end to end»;
 *   4. output tokens read from candidatesTokenCount instead of the AUDIO detail
 *      -> «usageMetadata».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("ttscost") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const jc = await import("../lib/generation/job-cost.ts");

const FLASH = "gemini-2.5-flash-preview-tts";
const PRO = "gemini-2.5-pro-preview-tts";

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
}

/* ══════════════════════════ price book ══════════════════════════ */

test("ttsCost: exact numbers from reported tokens (flash, pro, prefix, `models/` form)", () => {
  // The prod probe: 370 audio + 70 text tokens = 370 × $10/M + 70 × $0.50/M.
  const probe = ttsCost({ provider: "gemini", model: FLASH, chars: 300, seconds: 15, inputTokens: 70, outputTokens: 370 });
  assert.equal(probe.usd, 0.003735);
  assert.equal(Number(probe.usd.toFixed(4)), 0.0037);
  assert.deepEqual([probe.priced, probe.estimated, probe.textTokens, probe.audioTokens], [true, false, 70, 370]);

  // A 2-minute podcast: 120 s × 25 tokens/s = 3000 audio tokens ≈ $0.03 (+ ~560 text tokens).
  const podcast = ttsCost({ provider: "gemini", model: FLASH, chars: 1700, seconds: 120, inputTokens: 560, outputTokens: 3000 });
  assert.equal(podcast.usd, 0.03028);

  // Pro is exactly double on both sides: $1/M in + $20/M out.
  assert.equal(ttsCost({ provider: "gemini", model: PRO, chars: 0, inputTokens: 1_000_000, outputTokens: 1_000_000 }).usd, 21);
  assert.equal(ttsCost({ provider: "gemini", model: FLASH, chars: 0, inputTokens: 1_000_000, outputTokens: 1_000_000 }).usd, 10.5);

  // Version suffix and the `models/` prefix still find the row; pro is not mistaken for flash.
  assert.equal(ttsCost({ provider: "gemini", model: `${FLASH}-001`, chars: 0, inputTokens: 0, outputTokens: 1_000_000, seconds: 1 }).usd, 10 + 0);
  // pro row: $1/M text-in + 25 estimated audio tokens (1 s) × $20/M.
  assert.equal(ttsCost({ provider: "gemini", model: `models/${PRO}`, chars: 0, inputTokens: 1_000_000, outputTokens: 0, seconds: 1 }).usd, 1.0005);
});

test("ttsCost: per-character providers — Azure $16/1M, Aisha 1 so'm per char via SOUM_PER_USD", () => {
  assert.equal(ttsCost({ provider: "azure", chars: 1_000_000 }).usd, 16);
  assert.equal(ttsCost({ provider: "azure", chars: 4000 }).usd, 0.064);
  assert.equal(ttsCost({ provider: "google", chars: 1_000_000 }).usd, 16);
  assert.equal(ttsCost({ provider: "elevenlabs", chars: 1_000_000 }).usd, 165);
  // Characters are what these providers bill, tokens given are ignored.
  assert.deepEqual(ttsCost({ provider: "azure", chars: 1000, inputTokens: 5, outputTokens: 5 }), { usd: 0.016, priced: true, estimated: false, textTokens: 0, audioTokens: 0 });

  const prev = process.env.SOUM_PER_USD;
  try {
    delete process.env.SOUM_PER_USD;
    assert.equal(ttsCost({ provider: "aisha", chars: 12_700 }).usd, 1, "12 700 so'm / 12 700 so'm per USD");
    process.env.SOUM_PER_USD = "10000";
    assert.equal(ttsCost({ provider: "aisha", chars: 5_000 }).usd, 0.5, "the rate follows SOUM_PER_USD");
  } finally {
    if (prev === undefined) delete process.env.SOUM_PER_USD;
    else process.env.SOUM_PER_USD = prev;
  }
  // Negative / missing characters never reduce the cost.
  assert.equal(ttsCost({ provider: "azure", chars: -5_000 }).usd, 0);
});

test("ttsCost: unknown model / provider is flagged «unpriced» (usd 0, priced false), never priced like flash", (t) => {
  quiet(t);
  for (const u of [
    { provider: "gemini", model: "gemini-3.1-flash-tts-preview", chars: 300, seconds: 15, inputTokens: 70, outputTokens: 370 },
    { provider: "gemini", model: "", chars: 300, seconds: 15, inputTokens: 70, outputTokens: 370 },
    { provider: "gemini", chars: 300, seconds: 15 },
    { provider: "yandex", chars: 300 },
  ]) {
    const c = ttsCost(u);
    assert.deepEqual([c.usd, c.priced], [0, false], JSON.stringify(u));
  }
  // A priced model with nothing to bill on (no usage, no audio length) cannot be priced either.
  assert.equal(ttsCost({ provider: "gemini", model: FLASH, chars: 300 }).priced, false);
});

test("ttsCost: missing usage is ESTIMATED from the audio length (25 tokens/s) and flagged estimated", () => {
  const c = ttsCost({ provider: "gemini", model: FLASH, chars: 300, seconds: 15 });
  assert.equal(GEMINI_AUDIO_TOKENS_PER_SECOND, 25);
  assert.deepEqual([c.priced, c.estimated, c.audioTokens, c.textTokens], [true, true, 375, 100]);
  assert.equal(c.usd, Number(((375 * 10 + 100 * 0.5) / 1_000_000).toFixed(6)));
  // Reported usage wins over the estimate for the side that was reported.
  const half = ttsCost({ provider: "gemini", model: FLASH, chars: 300, seconds: 15, outputTokens: 370 });
  assert.deepEqual([half.audioTokens, half.estimated], [370, true], "text tokens still estimated");
});

test("ttsCost: dated rows — the newest row valid at the call date wins (like the LLM table)", () => {
  const rows = TTS_PRICING as TtsPriceRow[];
  const added: TtsPriceRow = { billing: "tokens", provider: "gemini", model: FLASH, inUsdPerM: 1, outUsdPerM: 20, from: "2027-01-01", note: "test row" };
  rows.push(added);
  try {
    const u = { provider: "gemini", model: FLASH, chars: 0, inputTokens: 1_000_000, outputTokens: 1_000_000 };
    assert.equal(ttsCost(u, new Date("2026-12-31T23:59:59Z")).usd, 10.5);
    assert.equal(ttsCost(u, new Date("2027-01-01T00:00:00Z")).usd, 21);
  } finally {
    rows.splice(rows.indexOf(added), 1);
  }
});

test("the book covers every TTS provider id and every row has a source note", () => {
  for (const p of ["azure", "aisha", "gemini", "google", "elevenlabs"]) assert.ok(TTS_PRICING.some((r) => r.provider === p), `${p}: no TTS price row`);
  for (const r of TTS_PRICING) assert.ok(r.note.length > 10);
});

test("images: one price source in the book; an unknown Gemini image model is an ESTIMATE (default lite price), not 0", (t) => {
  quiet(t);
  assert.equal(imagePriceOf("gemini-3.1-flash-lite-image"), 0.034);
  assert.equal(imagePriceOf("gemini-9-image"), null);
  assert.equal(imageUnitUsd("gemini-9-image"), 0.034);
  assert.equal(IMAGE_PRICES["gemini-3.1-flash-image"], 0.067);
  // job-cost re-exports the very same table (no second copy).
  assert.equal(jc.IMAGE_PRICES, IMAGE_PRICES);
  const c = new jc.JobCost();
  c.addImage("gemini", "gemini-3.1-flash-lite-image", 2);
  c.addImage("gemini", "gemini-9-image", 3);
  const parts = c.toJson().parts!;
  const known = parts.find((p) => p.model === "gemini-3.1-flash-lite-image")!;
  const unknown = parts.find((p) => p.model === "gemini-9-image")!;
  assert.equal(known.estimated, undefined);
  assert.equal(known.usd, 0.068);
  assert.equal(unknown.estimated, true);
  assert.equal(unknown.usd, Number((3 * 0.034).toFixed(6)));
});

/* ══════════════════════════ gemini adapter ══════════════════════════ */

test("geminiTtsUsage: text tokens = promptTokenCount, audio = the AUDIO detail else candidatesTokenCount; junk ignored", () => {
  assert.deepEqual(geminiTtsUsage({ usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 370 } }), { inputTokens: 70, outputTokens: 370 });
  // The AUDIO modality wins over the bare count (a TEXT entry is not audio).
  assert.deepEqual(
    geminiTtsUsage({
      usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 999, candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 3 }, { modality: "AUDIO", tokenCount: 200 }, { modality: "audio", tokenCount: 170 }] },
    }),
    { inputTokens: 70, outputTokens: 370 },
  );
  // Unreported / malformed fields are left out, so the price book estimates instead of trusting garbage.
  assert.deepEqual(geminiTtsUsage({ usageMetadata: { promptTokenCount: -5, candidatesTokenCount: "x" } }), {});
  assert.deepEqual(geminiTtsUsage({ usageMetadata: { promptTokenCount: 12 } }), { inputTokens: 12 });
  assert.deepEqual(geminiTtsUsage({}), {});
  assert.deepEqual(geminiTtsUsage(null), {});
});

test("makeGeminiTts: the audio comes back WITH the model and the reported usage", async () => {
  const pcm = new Uint8Array(48_000); // 1 s of 24 kHz 16-bit mono
  const reply = (usage: unknown) =>
    Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from(pcm).toString("base64") } }] } }], ...(usage ? { usageMetadata: usage } : {}) });
  const make = (usage: unknown) => makeGeminiTts({ key: () => "k", model: () => FLASH, fetchImpl: (async () => reply(usage)) as unknown as typeof fetch });

  const a = await make({ promptTokenCount: 70, candidatesTokenCount: 370 }).synthesize("Salom dunyo", { lang: "uz" });
  assert.equal(a.model, FLASH);
  assert.equal(a.inputTokens, 70);
  assert.equal(a.outputTokens, 370);
  assert.equal(a.chars, "Salom dunyo".length);
  assert.ok(a.wav && a.wav.byteLength > 48_000);

  // No usageMetadata at all: no token fields (the price book estimates from the length).
  const b = await make(undefined).synthesize("Salom", { lang: "uz" });
  assert.equal(b.model, FLASH);
  assert.ok(!("inputTokens" in b) && !("outputTokens" in b));
});

/* ══════════════════════════ meters ══════════════════════════ */

test("TtsMeter: usd from the book (tokens for Gemini, chars for Azure), tokens summed, unpriced counted, chars kept for display", (t) => {
  quiet(t);
  const m = new TtsMeter();
  m.add({ provider: "gemini", voice: "Kore", model: FLASH, chars: 300, seconds: 15, inputTokens: 70, outputTokens: 370 });
  m.add({ provider: "gemini", voice: "Kore", model: FLASH, chars: 300, seconds: 15, inputTokens: 70, outputTokens: 370 });
  const j = m.toJson();
  assert.equal(j.usd, 0.00747, "2 × $0.003735");
  assert.equal(j.chars, 600, "chars stay for display");
  assert.deepEqual([j.textTokens, j.audioTokens, j.unpricedCalls, j.calls], [140, 740, 0, 2]);
  assert.equal(j.provider, "gemini");

  const mixed = new TtsMeter();
  mixed.add({ provider: "azure", voice: "v", chars: 1_000_000, seconds: 60 });
  mixed.add({ provider: "gemini", voice: "Kore", model: "gemini-3.1-flash-tts-preview", chars: 300, seconds: 15, inputTokens: 70, outputTokens: 370 });
  const k = mixed.toJson();
  assert.equal(k.usd, 16, "the unknown model adds 0 …");
  assert.equal(k.unpricedCalls, 1, "… and is counted as unpriced");

  // The chain prices each synthesis through the same function the meter uses.
  assert.equal(ttsUsageCost({ provider: "gemini", voice: "Kore", model: FLASH, chars: 300, seconds: 15, inputTokens: 70, outputTokens: 370 }).usd, 0.003735);
});

test("JobCost.addTts: flags and tokens land in the part, merge through absorb, and stay out of the LLM token columns", () => {
  const a = new jc.JobCost();
  a.addTts("gemini", FLASH, 300, 0.003735, { textTokens: 70, audioTokens: 370 });
  a.addTts("gemini", FLASH, 300, 0.003735, { textTokens: 70, audioTokens: 370, estimated: true });
  a.addTts("gemini", "gemini-3.1-flash-tts-preview", 300, 0, { priced: false });
  a.addTts("azure", "azure:uz-UZ-MadinaNeural", 1000, 0.016);
  const b = new jc.JobCost();
  b.absorb(a);
  const j = b.toJson();
  const flash = j.parts!.find((p) => p.model === FLASH)!;
  assert.deepEqual([flash.calls, flash.units, flash.usd, flash.textTokens, flash.audioTokens, flash.estimated, flash.priced], [2, 600, 0.00747, 140, 740, true, undefined]);
  const unknown = j.parts!.find((p) => p.model === "gemini-3.1-flash-tts-preview")!;
  assert.deepEqual([unknown.usd, unknown.priced], [0, false]);
  const azure = j.parts!.find((p) => p.provider === "azure")!;
  assert.ok(!("priced" in azure) && !("textTokens" in azure) && !("estimated" in azure), "a plain part carries no markers");
  assert.deepEqual([j.inputTokens, j.outputTokens], [0, 0], "TTS tokens never enter the LLM columns");
  assert.equal(j.usd, Number((0.00747 + 0.016).toFixed(6)));
});

/* ══════════════ end to end: audio engine → JobCost → ai_usage ══════════════ */

function frame(): Uint8Array {
  const b = new Uint8Array(288);
  b[0] = 0xff;
  b[1] = 0xf3;
  b[2] = 0xa4;
  b[3] = 0xc0;
  return b;
}
const mp3Of = (frames: number): Uint8Array => {
  const out = new Uint8Array(288 * frames);
  for (let i = 0; i < frames; i++) out.set(frame(), i * 288);
  return out;
};

/** A fake Gemini TTS: every call reports 70 text + 370 audio tokens, like the 2026-10-10 probe. */
function fakeGemini(model: string, tokens = true): TtsProvider & { calls: number } {
  const self = {
    id: "gemini" as const,
    calls: 0,
    configured: () => true,
    async synthesize(text: string): Promise<TtsAudio> {
      self.calls += 1;
      return { mp3: mp3Of(20), seconds: 15, chars: text.length, model, ...(tokens ? { inputTokens: 70, outputTokens: 370 } : {}) };
    },
  };
  return self;
}

const words = (n: number) => Array.from({ length: n }, () => "so'z").join(" ");
const goodScript = (): AudioLine[] =>
  Array.from({ length: 8 }, (_, i) => ({ speaker: i % 2 === 0 ? "A" : "B", text: `${i === 0 ? "Nega bu savol muhim?" : ""} ${words(37)}.`.trim() }));
const fakeComplete = (): CompleteFn =>
  (async (role: string) =>
    role === "judge"
      ? { text: JSON.stringify({ notes: [], fixes: [] }), usage: { provider: "gemini", model: "m", inputTokens: 10, outputTokens: 10 } }
      : { text: JSON.stringify({ script: goodScript() }), usage: { provider: "gemini", model: "m", inputTokens: 100, outputTokens: 200 } }) as unknown as CompleteFn;

const PODCAST_VALUES: FormValues = { topic: "Uyqu va xotira", durationMin: 2, podcastType: "intervyu", language: "uz", mode: "topic" };

async function podcastCost(tts: TtsProvider) {
  const tool = TOOLS.find((x) => x.id === "podcast")!;
  const values = PODCAST_VALUES;
  const { value, cost } = await jc.withJobCost(() =>
    buildAudioArtifact(tool, extractMeta(tool, values), values, { deadline: Date.now() + 600_000, complete: fakeComplete(), tts: chainOfProvider(tts, ["Kore", "Charon"]), judge: false, polish: false }),
  );
  assert.ok(value, "the engine produced a file");
  return cost.toJson();
}

test("end to end (audio engine → JobCost → ai_usage → admin)", { skip }, async (t) => {
  quiet(t);
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const { recordAiUsage, flushAiUsage } = await import("../lib/server/ai-usage.ts");
  const cost = await import("../lib/server/admin-cost.ts");
  const { parseDateRange } = await import("../lib/server/admin-list.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const uid = (await queryOne<{ id: string }>(`INSERT INTO users (name) VALUES ('tts cost') RETURNING id::text AS id`, []))!.id;

  await t.test("a Gemini podcast has a NON-ZERO tts usd in cost_json.parts and in ai_usage.parts", async () => {

    const tts = fakeGemini(FLASH);
    const built = await podcastCost(tts);
    const part = built.parts!.find((p) => p.kind === "tts")!;
    assert.ok(tts.calls >= 2, "several synthesis calls");
    // MUTATION (usd forced to 0): this block turns red.
    assert.equal(part.model, FLASH, "the part is keyed by the model, so unknown models are findable");
    assert.equal(part.calls, tts.calls);
    assert.equal(part.usd, Number((tts.calls * 0.003735).toFixed(6)));
    assert.ok(part.usd > 0);
    assert.equal(part.textTokens, 70 * tts.calls);
    assert.equal(part.audioTokens, 370 * tts.calls);
    assert.ok(part.units > 0, "units stay the characters (display)");
    assert.equal(part.priced, undefined);
    assert.ok(built.usd >= part.usd);

    // The same part is what the worker flushes into ai_usage.
    const gen = randomUUID();
    await query(`INSERT INTO generations (id, user_id, tool_id, status, finished_at) VALUES ($1, $2, 'podcast', 'COMPLETED', now())`, [gen, uid]);
    assert.equal(await recordAiUsage({ source: "job", outcome: "completed", generationId: gen, userId: uid, toolId: "podcast", cost: built }), true);
    await flushAiUsage();
    const row = (await query<{ usd: string; parts: { kind: string; usd: number; model: string; textTokens?: number }[] }>(`SELECT usd::text, parts FROM ai_usage WHERE generation_id = $1`, [gen]))[0];
    const stored = row.parts.find((p) => p.kind === "tts")!;
    assert.equal(stored.usd, part.usd);
    assert.equal(stored.model, FLASH);
    assert.equal(stored.textTokens, 70 * tts.calls);
    assert.ok(Number(row.usd) >= part.usd);

    // A gemini TTS answering without usageMetadata is estimated from the audio length: still non-zero, flagged.
    const bare = await podcastCost(fakeGemini(FLASH, false));
    const bp = bare.parts!.find((p) => p.kind === "tts")!;
    assert.ok(bp.usd > 0 && bp.estimated === true && bp.priced === undefined);
    assert.equal(bp.audioTokens, bp.calls * 15 * 25);
  });

  await t.test("an UNKNOWN Gemini TTS model is recorded flagged (priced:false, usd 0) and listed in the admin caveats", async () => {
    await query(`DELETE FROM ai_usage`, []);
    const unknown = "gemini-3.1-flash-tts-preview";
    const tts = fakeGemini(unknown);
    const c = await podcastCost(tts);
    const part = c.parts!.find((p) => p.kind === "tts")!;
    assert.equal(part.usd, 0);
    assert.equal(part.priced, false, "MUTATION (priced flag dropped): red");
    assert.equal(part.model, unknown);

    const gen = randomUUID();
    await query(`INSERT INTO generations (id, user_id, tool_id, status, finished_at) VALUES ($1, $2, 'podcast', 'COMPLETED', now())`, [gen, uid]);
    await recordAiUsage({ source: "job", outcome: "completed", generationId: gen, userId: uid, toolId: "podcast", cost: c });
    await flushAiUsage();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
    const range = parseDateRange(today, today);
    const by = await cost.spendBy(pool(), range, "kind");
    assert.equal(by.find((r) => r.key === "tts")!.unpricedCalls, tts.calls, "the unpriced TTS calls are counted in the admin");
    const caveats = await cost.costCaveats(pool(), range);
    assert.ok(
      caveats.some((x) => x.startsWith("Narxlanmagan xizmatlar:") && x.includes(`ovoz (TTS) gemini:${unknown} (${tts.calls} chaqiruv)`)),
      caveats.join("\n"),
    );
  });
});
