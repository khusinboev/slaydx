import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, basePriceFor, preflightError, priceFor, toolBlockedReason } from "../lib/tools.ts";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  imageBasePrice,
  imageModelError,
  imageModelOf,
  offeredImageModels,
} from "../lib/generation/image-models.ts";
import { imageModelsAvailable, imageModelUnavailable } from "../lib/server/env.ts";
import { PROVIDERS, providerDef } from "../lib/server/providers/registry.ts";
import { resetProviderCache, setProviderSnapshot } from "../lib/server/providers/resolve.ts";
import { imageProviderFor } from "../lib/generation/image-studio.ts";

/**
 * `rasm` model choice, pure parts (program-17 item 5). The paid flow is in `image-models-flow.test.mts`.
 *
 * Mutations (each made the named test fail, then restored): `imageModelOf` always "gemini" -> the price / provider
 * tests; drop `isProviderEnabled` from `imageModelsAvailable` -> "disabled provider is hidden"; drop the key test
 * -> "no key: hidden".
 */

const image = TOOL_BY_ID.image;
const saved = { openai: process.env.OPENAI_API_KEY, gemini: process.env.GEMINI_API_KEY };
const snap = (rows: Record<string, { enabled?: boolean; key?: string | null }>) =>
  new Map(Object.entries(rows).map(([id, r]) => [id, { enabled: r.enabled ?? true, key: r.key ?? null, unreadable: false }]));

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  resetProviderCache();
});
afterEach(() => {
  for (const [k, v] of [["OPENAI_API_KEY", saved.openai], ["GEMINI_API_KEY", saved.gemini]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetProviderCache();
});

test("catalogue: Gemini first and default, ChatGPT second; every model points at an implemented image provider", () => {
  assert.deepEqual(IMAGE_MODELS.map((m) => m.id), ["gemini", "openai"]);
  assert.equal(DEFAULT_IMAGE_MODEL, "gemini");
  assert.equal(IMAGE_MODELS[0].label, "Nano Banana (Google Gemini)");
  assert.equal(IMAGE_MODELS[1].label, "ChatGPT (OpenAI gpt-image)");
  for (const m of IMAGE_MODELS) {
    const def = providerDef(m.provider);
    assert.ok(def && def.implemented && (def.kinds as readonly string[]).includes("image"), m.provider);
  }
  assert.ok(PROVIDERS.find((p) => p.id === "openai-image")!.implemented, "the registry marks openai-image implemented");
});

test("pricing: Gemini keeps today's table, ChatGPT is its own (2x); count boundaries as before", () => {
  // The pre-choice formula, re-implemented as the oracle: >=4 -> 6000, >=2 -> 3500, else 2000.
  const old = (n: number) => (n >= 4 ? 6000 : n >= 2 ? 3500 : 2000);
  for (const n of [0, 1, 2, 3, 4, 5, 9]) {
    assert.equal(priceFor(image, { imageCount: n }), old(n), `no model, n=${n}`);
    assert.equal(priceFor(image, { imageCount: n, model: "gemini" }), old(n), `gemini, n=${n}`);
    assert.equal(priceFor(image, { imageCount: n, model: "openai" }), old(n) * 2, `openai, n=${n}`);
  }
  assert.equal(priceFor(image, {}), 2000, "no count, no model: the 1-image Gemini price");
  assert.equal(priceFor(image, { imageCount: "4", model: "openai" }), 12000, "string count");
  assert.equal(imageBasePrice("openai", 1), 4000);
  assert.equal(imageBasePrice("openai", 2), 7000);
  assert.equal(basePriceFor(image, { imageCount: 4, model: "openai" }), 12000, "the server formula (before the admin adjustment)");
  assert.notEqual(priceFor(image, { model: "gemini" }), priceFor(image, { model: "openai" }));
});

test("imageModelOf / imageModelError: absent = Gemini, unknown is an error (never silently Gemini)", () => {
  assert.equal(imageModelOf({}), "gemini");
  assert.equal(imageModelOf({ model: "" }), "gemini");
  assert.equal(imageModelOf({ model: " openai " }), "openai");
  assert.equal(imageModelError({}), null);
  assert.equal(imageModelError({ model: "" }), null);
  assert.equal(imageModelError({ model: "gemini" }), null);
  assert.equal(imageModelError({ model: "openai" }), null);
  for (const bad of ["dall-e", "OpenAI", "gpt-image", 7, true, "__proto__"]) assert.match(String(imageModelError({ model: bad as never })), /Noma'lum/, String(bad));
});

test("preflight (server and client share it): an unknown model is rejected for `rasm` only", () => {
  assert.equal(preflightError(image, { prompt: "a red apple", model: "openai" }), null);
  assert.equal(preflightError(image, { prompt: "a red apple" }), null);
  assert.match(String(preflightError(image, { prompt: "a red apple", model: "dall-e" })), /Noma'lum rasm modeli/);
  assert.equal(preflightError(TOOL_BY_ID.portrait, { model: "dall-e" }), null, "other tools are untouched");
});

test("offeredImageModels: absent list = Gemini only (today's form); order follows the catalogue; unknown ids dropped", () => {
  assert.deepEqual(offeredImageModels(undefined), ["gemini"]);
  assert.deepEqual(offeredImageModels(null), ["gemini"]);
  assert.deepEqual(offeredImageModels(["openai", "gemini"]), ["gemini", "openai"]);
  assert.deepEqual(offeredImageModels(["openai"]), ["openai"]);
  assert.deepEqual(offeredImageModels(["gemini", "sora"]), ["gemini"]);
  assert.deepEqual(offeredImageModels([]), []);
});

test("availability: no key -> hidden and unavailable", () => {
  assert.deepEqual(imageModelsAvailable(), []);
  assert.ok(imageModelUnavailable({ model: "openai" }));
  assert.ok(imageModelUnavailable({}));
});

test("availability: a key shows exactly its model (env), and the same key works from the admin store", () => {
  process.env.GEMINI_API_KEY = "gem-key-12345678";
  assert.deepEqual(imageModelsAvailable(), ["gemini"]);
  assert.equal(imageModelUnavailable({}), null);
  assert.ok(imageModelUnavailable({ model: "openai" }), "OpenAI has no key");
  process.env.OPENAI_API_KEY = "sk-openai-12345678";
  assert.deepEqual(imageModelsAvailable(), ["gemini", "openai"]);
  assert.equal(imageModelUnavailable({ model: "openai" }), null);
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  setProviderSnapshot(snap({ "openai-image": { key: "sk-stored-12345678" } }));
  assert.deepEqual(imageModelsAvailable(), ["openai"], "a key stored in «Provayderlar» counts");
});

test("availability: a disabled provider is hidden even with a key in env or in the store", () => {
  process.env.GEMINI_API_KEY = "gem-key-12345678";
  process.env.OPENAI_API_KEY = "sk-openai-12345678";
  setProviderSnapshot(snap({ "openai-image": { enabled: false } }));
  assert.deepEqual(imageModelsAvailable(), ["gemini"]);
  assert.ok(imageModelUnavailable({ model: "openai" }));
  setProviderSnapshot(snap({ "openai-image": { enabled: false, key: "sk-stored-12345678" }, gemini: { enabled: false } }));
  assert.deepEqual(imageModelsAvailable(), []);
  setProviderSnapshot(snap({ "openai-image": { enabled: true } }));
  assert.deepEqual(imageModelsAvailable(), ["gemini", "openai"]);
});

test("the OpenAI image key is the OpenAI text key: one OPENAI_API_KEY serves both providers", () => {
  process.env.OPENAI_API_KEY = "sk-openai-12345678";
  assert.deepEqual(imageModelsAvailable(), ["openai"]);
});

test("toolBlockedReason: with a model list the list decides (OpenAI alone is enough); without it the `images` flag decides as before", () => {
  const base = { llm: true, images: false };
  assert.equal(toolBlockedReason(image, { ...base, imageModels: ["openai"] }), null, "Gemini off, ChatGPT on: rasm stays open");
  assert.match(String(toolBlockedReason(image, { ...base, images: true, imageModels: [] })), /Rasm xizmati/);
  assert.match(String(toolBlockedReason(image, base)), /Rasm xizmati/, "older server: images flag");
  assert.equal(toolBlockedReason(image, { ...base, images: true }), null, "older server: unchanged");
  assert.equal(toolBlockedReason(image, null), null);
  // The portrait tool is Gemini-only: the model list must not open it.
  assert.match(String(toolBlockedReason(TOOL_BY_ID.portrait, { ...base, imageModels: ["openai"] })), /Rasm xizmati/);
});

test("engine: `imageProviderFor` follows the model param (absent = Gemini)", () => {
  assert.equal(imageProviderFor({}).id, "gemini");
  assert.equal(imageProviderFor({ model: "gemini" }).id, "gemini");
  assert.equal(imageProviderFor({ model: "openai" }).id, "openai");
});
