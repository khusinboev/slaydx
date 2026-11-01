import test from "node:test";
import assert from "node:assert/strict";
import { IMAGE_PROMPT_MIN, TOOL_BY_ID, basePriceFor } from "../lib/tools.ts";
import { IMAGE_MODEL_IDS } from "../lib/generation/image-models.ts";
import { IMAGE_RATIOS, IMAGE_STYLES } from "../lib/generation/image-studio-options.ts";
import { IMAGE_PRICES, OPENAI_IMAGE_FALLBACK_USD, TTS_PRICING } from "../lib/generation/llm-pricing.ts";
import { VIDEO_ASPECTS, VIDEO_PROVIDERS, VIDEO_PROVIDER_IDS, videoParamsError } from "../lib/generation/video/registry.ts";
import { DEFAULT_GEMINI_IMAGE_MODEL, DEFAULT_TTS_ORDER } from "../lib/server/providers/route-effective.ts";
import { costUsd, normalize, resolveModel, validate } from "../lib/studio-core/index.ts";
import {
  IMAGE_MODEL_TO_MEDIA,
  LEGACY_PRICE_OVERRIDES,
  MEDIA_CATALOG,
  MEDIA_IMAGE_PROMPT_MIN,
  MEDIA_PURPOSES,
  VIDEO_PROVIDER_TO_MEDIA,
  videoSecondsParam,
} from "../lib/media/catalog.ts";
import { MEDIA_MARKUP_DEFAULT, mediaQuote } from "../lib/media/quote.ts";

/**
 * SlaydX media catalog (docs/studio/P0-SPEC.md §3.6–3.7, §6.2): P0 changes NO price and NO validation outcome.
 *
 * Mutations (each turned the named test red, then restored): image ladder reads `count - 1` -> "price parity: rasm";
 * kling ladder uses veo's per-second price -> "price parity: video"; video seconds step removed in `videoParams`
 * -> "validation parity: video seconds"; Gemini cost row swapped to the flash (non-lite) model -> "costs come from
 * the price book"; `videoSecondsParam` without its even-spacing check -> "video seconds … EXACTLY …" (5, 8, 10 loads);
 * its step dropped -> the same test and "validation parity: video seconds".
 */

const RATE = 12_800;

test("price parity: rasm (every model × count × style × ratio)", () => {
  let rows = 0;
  for (const model of IMAGE_MODEL_IDS) {
    for (const imageCount of [1, 2, 3, 4]) {
      for (const s of IMAGE_STYLES) {
        for (const r of IMAGE_RATIOS) {
          const values = { prompt: "Registon kechqurun", model, imageCount, imageStyle: s.id, imageRatio: r.id };
          assert.equal(mediaQuote(IMAGE_MODEL_TO_MEDIA[model], values, { soumPerUsd: RATE }), basePriceFor(TOOL_BY_ID.image, values), JSON.stringify(values));
          rows++;
        }
      }
    }
  }
  assert.ok(rows >= 2 * 4 * 9 * 6);
});

test("price parity: video (every provider × allowed seconds × aspect)", () => {
  for (const p of VIDEO_PROVIDERS) {
    for (const seconds of p.seconds) {
      for (const aspect of VIDEO_ASPECTS) {
        const values = { provider: p.id, prompt: "Tong chog'ida Registon", seconds, aspect };
        assert.equal(mediaQuote(VIDEO_PROVIDER_TO_MEDIA[p.id], values, { soumPerUsd: RATE }), basePriceFor(TOOL_BY_ID.video, values), JSON.stringify(values));
      }
    }
  }
});

test("validation parity: video seconds", () => {
  for (const id of VIDEO_PROVIDER_IDS) {
    const entry = MEDIA_CATALOG.byId(VIDEO_PROVIDER_TO_MEDIA[id])!;
    for (const seconds of [1, 4, 5, 6, 7, 8, 9, 10, 15, "x"]) {
      const values = { provider: id, prompt: "Tong chog'ida Registon", seconds };
      assert.equal(validate(entry.params, values) === null, videoParamsError(values) === null, `${id} ${seconds}s`);
    }
  }
});

test("video seconds: the int param accepts EXACTLY the provider's list; an uneven list is refused at load time", () => {
  for (const p of VIDEO_PROVIDERS) {
    const entry = MEDIA_CATALOG.byId(VIDEO_PROVIDER_TO_MEDIA[p.id])!;
    const accepted: number[] = [];
    for (let s = 0; s <= 60; s++) if (validate(entry.params, { prompt: "Tong chog'ida Registon", seconds: s }) === null) accepted.push(s);
    assert.deepEqual(accepted, [...p.seconds], p.id);
  }
  assert.deepEqual(validate([videoSecondsParam([5, 10, 15])], { seconds: 15 }), null, "evenly spaced: 3 values");
  assert.notEqual(validate([videoSecondsParam([5, 10, 15])], { seconds: 12 }), null);
  assert.equal(validate([videoSecondsParam([6])], { seconds: 6 }), null, "a single length");
  assert.notEqual(validate([videoSecondsParam([6])], { seconds: 7 }), null);
  assert.throws(() => videoSecondsParam([5, 8, 10]), /not evenly spaced/);
});

test("validation parity: prompt minimum", () => {
  assert.equal(MEDIA_IMAGE_PROMPT_MIN, IMAGE_PROMPT_MIN);
  const veo = MEDIA_CATALOG.byId("google/omni-video")!;
  for (const prompt of ["", "abcd", "abcde", "  abcde  "]) {
    assert.equal(validate(veo.params, { prompt }) === null, videoParamsError({ provider: "veo", prompt }) === null, JSON.stringify(prompt));
  }
});

test("costs come from the price book", () => {
  const nano = MEDIA_CATALOG.byId("google/nano-banana")!;
  assert.equal(costUsd(nano.cost, normalize(nano.params, { imageCount: 2 })), 2 * IMAGE_PRICES[DEFAULT_GEMINI_IMAGE_MODEL]);
  const gpt = MEDIA_CATALOG.byId("openai/gpt-image")!;
  assert.equal(costUsd(gpt.cost, normalize(gpt.params, { imageCount: 1 })), OPENAI_IMAGE_FALLBACK_USD);
  for (const provider of ["elevenlabs", "azure"]) {
    const row = TTS_PRICING.find((r) => r.provider === provider && r.billing === "chars") as { usdPerMChars: number };
    const e = MEDIA_CATALOG.byId(`${provider}/tts`)!;
    assert.equal(costUsd(e.cost, { text: "x".repeat(1000) }), row.usdPerMChars / 1000);
  }
});

test("defaults match the routing slots", () => {
  assert.equal(MEDIA_CATALOG.byId("google/nano-banana")!.routes[0].upstreamModel, DEFAULT_GEMINI_IMAGE_MODEL);
  const chain = MEDIA_PURPOSES.byId("listening.voice")!.allowed.map((id) => MEDIA_CATALOG.byId(id)!.routes[0].provider);
  assert.deepEqual(chain, [...DEFAULT_TTS_ORDER]);
});

test("purposes: rasm and video keep today's defaults and choices", () => {
  const all = () => true;
  assert.deepEqual(resolveModel(MEDIA_PURPOSES, "rasm.image", { available: all }), { ok: true, modelId: "google/nano-banana" });
  assert.deepEqual(resolveModel(MEDIA_PURPOSES, "video.clip", { available: all }), { ok: true, modelId: "google/omni-video" });
  assert.deepEqual(MEDIA_PURPOSES.byId("rasm.image")!.allowed, IMAGE_MODEL_IDS.map((m) => IMAGE_MODEL_TO_MEDIA[m]));
  assert.deepEqual(MEDIA_PURPOSES.byId("video.clip")!.allowed, VIDEO_PROVIDER_IDS.map((p) => VIDEO_PROVIDER_TO_MEDIA[p]));
});

test("cost × markup path (P1 rule) and admin override", () => {
  const nano = "google/nano-banana";
  // 0.034 × 1 × 12 800 × 2 = 870.4 -> 900
  assert.equal(mediaQuote(nano, { imageCount: 1 }, { soumPerUsd: RATE, override: { mode: "markup", markup: MEDIA_MARKUP_DEFAULT } }), 900);
  assert.equal(mediaQuote(nano, { imageCount: 1 }, { soumPerUsd: RATE, override: { mode: "markup", markup: 3 } }), 1400);
  assert.equal(mediaQuote("nope/model", {}, { soumPerUsd: RATE }), null);
  assert.ok(LEGACY_PRICE_OVERRIDES[nano]);
});
