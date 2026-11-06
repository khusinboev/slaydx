import { test } from "node:test";
import assert from "node:assert/strict";
import { ENHANCE_INPUT_MAX, ENHANCE_KINDS, ENHANCE_OUTPUT_MAX, enhanceSystemPrompt, isEnhanceKind, parseEnhanced } from "../lib/media/enhance.ts";
import { IMAGE_PROMPT_LIMIT } from "../lib/generation/image-params.ts";
import { VIDEO_PROMPT_MAX } from "../lib/generation/video/registry.ts";
import { MEDIA_CATALOG } from "../lib/media/catalog.ts";

/**
 * «Yaxshilash (AI)» prompts (docs/studio/P11-SPEC.md §B).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. the English rule dropped from the system prompt    -> «every kind asks for English»;
 *   2. the verbatim rule dropped                          -> «every kind asks for English»;
 *   3. `parseEnhanced` clips at the image limit           -> «the rewrite is clipped by its kind»;
 *   4. the sfx output limit raised above its tool's limit -> «limits fit the tools».
 */

test("every kind asks for English from any language, keeps quoted text verbatim, and has its own role", () => {
  const prompts = ENHANCE_KINDS.map((k) => enhanceSystemPrompt(k));
  for (const p of prompts) {
    assert.match(p, /Detect the language/);
    assert.match(p, /in ENGLISH, whatever the input language, even when the input is already good English/);
    assert.match(p, /stays verbatim in its own language/);
  }
  assert.equal(new Set(prompts).size, ENHANCE_KINDS.length, "each kind has its own instructions");
  assert.match(enhanceSystemPrompt("music"), /vocal language/, "an Uzbek song stays an Uzbek song");
  assert.equal(enhanceSystemPrompt(), enhanceSystemPrompt("image"));
});

test("the rewrite is clipped by its kind, whitespace collapsed; junk is null", () => {
  const long = "a ".repeat(800);
  const json = JSON.stringify({ prompt: long });
  assert.equal(parseEnhanced(json, "image")!.length, ENHANCE_OUTPUT_MAX.image);
  assert.equal(parseEnhanced(json, "video")!.length, ENHANCE_OUTPUT_MAX.video);
  assert.equal(parseEnhanced('x {"prompt":"Sunset   over\\n Registon"} y'), "Sunset over Registon");
  for (const bad of [null, "", "not json", '{"prompt":"ab"}', '{"prompt":5}']) assert.equal(parseEnhanced(bad), null);
});

test("limits fit the tools: a rewrite never exceeds the shortest prompt limit of its kind's models", () => {
  const promptMax = (id: string) => {
    const p = MEDIA_CATALOG.byId(id)!.params.find((x) => x.name === "prompt");
    assert.ok(p?.type === "text", id);
    return p.max;
  };
  assert.equal(ENHANCE_OUTPUT_MAX.image, IMAGE_PROMPT_LIMIT);
  assert.equal(ENHANCE_OUTPUT_MAX.video, VIDEO_PROMPT_MAX);
  assert.ok(ENHANCE_OUTPUT_MAX.sfx <= promptMax("elevenlabs/sfx"));
  assert.ok(ENHANCE_INPUT_MAX.sfx >= promptMax("elevenlabs/sfx"));
  assert.ok(isEnhanceKind("sfx") && !isEnhanceKind("speech") && !isEnhanceKind(undefined));
});
