import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, TOOLS, basePriceFor, preflightError, priceFor, toolBlockedReason, topicOf, missingRequired } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { VIDEO_FORM_FIELDS, VIDEO_PARAMS } from "../lib/generation/video-params.ts";
import {
  VIDEO_PROVIDERS,
  VIDEO_PROMPT_MAX,
  encodeVideoValues,
  normalizeVideoPrompt,
  offeredVideoProviders,
  videoInputFromValues,
  videoParamsError,
  videoPrice,
  videoProviderById,
} from "../lib/generation/video/registry.ts";
import { VIDEO_ADAPTERS } from "../lib/generation/video/index.ts";
import { providerDef } from "../lib/server/providers/registry.ts";
import { resetProviderCache, setProviderSnapshot } from "../lib/server/providers/resolve.ts";
import { videoProviderUnavailable, videoProvidersAvailable } from "../lib/server/env.ts";
import { viewerKind } from "../lib/viewers/kind.ts";

/**
 * «VIDEO YARATISH» -- the "every param must work" registry, the differential probe, the price per second per provider,
 * and the availability rules. No network, no database.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `seconds` dropped from the Kling request body                  -> «differential probe», «every provider's lengths»;
 *   2. Veo price 3 000 -> 2 000 / second                              -> «price per second per provider»;
 *   3. `aspect` no longer reaches the Veo request                     -> «differential probe»;
 *   4. the start image no longer reaches the Kling request            -> «differential probe»;
 *   5. `toolBlockedReason` returns null without providers             -> «tool is hidden without a key».
 */

const tool = TOOL_BY_ID.video;
const IMG_A = "0123456789abcdef01234567";

/** The request a provider would get for these form values (the worker resolves the image bytes from `photo_uploads`). */
function requestOf(values: FormValues): string {
  const input = videoInputFromValues(values);
  const image = input.imageAssetId ? { mime: "image/jpeg", base64: Buffer.from(`bytes-of-${input.imageAssetId}`).toString("base64") } : undefined;
  return JSON.stringify(VIDEO_ADAPTERS[input.provider].buildRequest({ prompt: input.prompt, seconds: input.seconds, aspect: input.aspect, ...(image ? { image } : {}) }));
}

const BASE: FormValues = { provider: "veo", prompt: "Tong chog‘ida Registon maydoni", seconds: 5, aspect: "16:9", imageAssetId: "" };

/* ══════════════════════════ registry integrity ══════════════════════════ */

test("registry: unique ids, probeA != probeB, form fields = declared params (no decorative field)", () => {
  const ids = VIDEO_PARAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(VIDEO_FORM_FIELDS, ids);
  for (const p of VIDEO_PARAMS) {
    assert.notEqual(p.probeA, p.probeB, `${p.id}: probe pair is identical`);
    assert.ok(p.impacts.length > 0, `${p.id}: no declared impact = decorative`);
  }
  assert.deepEqual([...tool.fields.map((f) => f.name)].sort(), [...ids].sort(), "tool.fields and the params registry list the same fields");
});

test("tool: group media, mp4, viewer `video`, requires a prompt, hidden-by-default nothing else", () => {
  assert.equal(tool.group, "media");
  assert.equal(tool.output, "mp4");
  assert.equal(viewerKind("video"), "video");
  assert.ok(TOOLS.some((t) => t.id === "video"));
  assert.deepEqual(missingRequired(tool, { ...BASE, prompt: "" }), ["Video tavsifi"]);
  assert.deepEqual(missingRequired(tool, BASE), []);
  assert.equal(topicOf({ prompt: "  Tong   chog‘ida  " }, tool), "Tong chog‘ida");
});

/* ══════════════════════════ differential probe ══════════════════════════ */

test("differential probe: every param changes the provider request (and the price where declared)", () => {
  const failures: string[] = [];
  for (const p of VIDEO_PARAMS) {
    const a = { ...BASE, ...p.probeWith, [p.id]: p.probeA };
    const b = { ...BASE, ...p.probeWith, [p.id]: p.probeB };
    for (const impact of p.impacts) {
      const differs = impact === "request" ? requestOf(a) !== requestOf(b) : priceFor(tool, a) !== priceFor(tool, b);
      if (!differs) failures.push(`${p.id} -> ${impact}`);
    }
  }
  assert.deepEqual(failures, [], `decorative params:\n  ${failures.join("\n  ")}`);
});

test("a param WITHOUT a declared price impact does not move the price (prompt, aspect, image)", () => {
  for (const p of VIDEO_PARAMS.filter((x) => !x.impacts.includes("price"))) {
    const a = { ...BASE, ...p.probeWith, [p.id]: p.probeA };
    const b = { ...BASE, ...p.probeWith, [p.id]: p.probeB };
    assert.equal(priceFor(tool, a), priceFor(tool, b), `${p.id} changed the price`);
  }
});

test("every provider's own lengths reach its request and its price", () => {
  for (const prov of VIDEO_PROVIDERS) {
    const reqs = prov.seconds.map((s) => requestOf({ ...BASE, provider: prov.id, seconds: s }));
    assert.equal(new Set(reqs).size, prov.seconds.length, `${prov.id}: lengths ${prov.seconds.join("/")} give different requests`);
    const prices = prov.seconds.map((s) => priceFor(tool, { ...BASE, provider: prov.id, seconds: s }));
    assert.equal(new Set(prices).size, prov.seconds.length, `${prov.id}: lengths give different prices`);
  }
});

test("the prompt reaches the provider, the aspect too (text to video), the image only when one was chosen", () => {
  const req = JSON.parse(requestOf({ ...BASE, provider: "kling", prompt: "Hello unique prompt 123" })) as { body: Record<string, unknown> };
  assert.equal(req.body.prompt, "Hello unique prompt 123");
  assert.equal(req.body.aspect_ratio, "16:9");
  assert.equal(req.body.duration, "5");
  assert.equal(req.body.image, undefined);
  assert.match(JSON.stringify(JSON.parse(requestOf({ ...BASE, provider: "veo", aspect: "9:16" }))), /"aspect_ratio":"9:16"/);
  const withImage = JSON.parse(requestOf({ ...BASE, provider: "kling", imageAssetId: IMG_A })) as { url: string; body: Record<string, unknown> };
  assert.match(withImage.url, /image2video$/);
  assert.ok(typeof withImage.body.image === "string" && withImage.body.image.length > 10);
  assert.equal(withImage.body.aspect_ratio, undefined, "Kling image-to-video takes the picture's proportions");
});

/* ══════════════════════════ price ══════════════════════════ */

test("price per second per provider: Veo 3 000, Kling 2 000 so'm / second x the clip length", () => {
  assert.equal(videoProviderById("veo").soumPerSecond, 3000);
  assert.equal(videoProviderById("kling").soumPerSecond, 2000);
  for (const prov of VIDEO_PROVIDERS) {
    for (const s of prov.seconds) {
      const expected = prov.soumPerSecond * s;
      assert.equal(videoPrice({ provider: prov.id, seconds: s }), expected, `${prov.id} ${s}s`);
      assert.equal(priceFor(tool, { ...BASE, provider: prov.id, seconds: s }), expected);
      assert.equal(basePriceFor(tool, { ...BASE, provider: prov.id, seconds: s }), expected);
    }
  }
  // Concrete numbers a human can check: 5 s Veo = 15 000, 8 s Veo = 24 000, 5 s Kling = 10 000, 10 s Kling = 20 000.
  assert.deepEqual([videoPrice({ provider: "veo", seconds: 5 }), videoPrice({ provider: "veo", seconds: 8 }), videoPrice({ provider: "kling", seconds: 5 }), videoPrice({ provider: "kling", seconds: 10 })], [15000, 24000, 10000, 20000]);
});

test("normalizeVideoPrompt: collapses whitespace runs (tabs, newlines, NBSP), trims, clips; videoInputFromValues uses it", () => {
  assert.equal(normalizeVideoPrompt("  salom \t\n dunyo\u00a0 "), "salom dunyo");
  assert.equal(normalizeVideoPrompt(undefined), "");
  assert.equal(normalizeVideoPrompt(null), "");
  assert.equal(normalizeVideoPrompt("a ".repeat(VIDEO_PROMPT_MAX)).length, VIDEO_PROMPT_MAX);
  assert.equal(videoInputFromValues({ prompt: "  salom   dunyo " }).prompt, normalizeVideoPrompt("  salom   dunyo "));
});

test("normalizer: a length the provider does not offer falls back to its first one (price and request agree)", () => {
  assert.equal(videoInputFromValues({ provider: "kling", seconds: 8 }).seconds, 5);
  assert.equal(videoInputFromValues({ provider: "veo", seconds: 10 }).seconds, 5);
  assert.equal(videoInputFromValues({ provider: "kling", seconds: 10 }).seconds, 10);
  assert.equal(videoInputFromValues({}).provider, "veo");
  assert.equal(videoInputFromValues({ prompt: "x".repeat(5000) }).prompt.length, VIDEO_PROMPT_MAX);
  assert.equal(videoInputFromValues({ imageAssetId: "not-hex" }).imageAssetId, "");
  assert.deepEqual(videoInputFromValues(encodeVideoValues(videoInputFromValues({ provider: "kling", prompt: "abcde", seconds: 10, aspect: "9:16", imageAssetId: IMG_A }))), {
    provider: "kling",
    prompt: "abcde",
    seconds: 10,
    aspect: "9:16",
    imageAssetId: IMG_A,
  });
});

test("server-side refusals before any charge: unknown provider, short prompt, a length the provider lacks, a malformed image id", () => {
  assert.equal(videoParamsError(BASE), null);
  assert.match(videoParamsError({ ...BASE, provider: "sora" }) ?? "", /provayder/i);
  assert.match(videoParamsError({ ...BASE, prompt: "hi" }) ?? "", /kamida 5/);
  assert.match(videoParamsError({ ...BASE, provider: "veo", seconds: 10 }) ?? "", /5 yoki 8/);
  assert.match(videoParamsError({ ...BASE, imageAssetId: "../etc/passwd" }) ?? "", /noto'g'ri/);
  assert.equal(preflightError(tool, { ...BASE, provider: "sora" }) !== null, true, "preflightError runs the same check");
  assert.equal(preflightError(tool, BASE), null);
});

/* ══════════════════════════ availability ══════════════════════════ */

test("the tool is hidden without a key: toolBlockedReason follows features.videoProviders", () => {
  const f = { llm: true, images: true };
  assert.match(toolBlockedReason(tool, { ...f, videoProviders: [] }) ?? "", /mavjud emas/);
  assert.match(toolBlockedReason(tool, f) ?? "", /mavjud emas/, "an older server that sends nothing: hidden");
  assert.equal(toolBlockedReason(tool, { ...f, videoProviders: ["kling"] }), null);
  assert.equal(toolBlockedReason(tool, null), null, "features not loaded yet: nothing is blocked");
  // The LLM flag is irrelevant to video.
  assert.equal(toolBlockedReason(tool, { llm: false, images: false, videoProviders: ["veo"] }), null);
  assert.deepEqual(offeredVideoProviders(["kling", "veo", "x"]), ["veo", "kling"]);
  assert.deepEqual(offeredVideoProviders(undefined), []);
});

test("registry: veo and kling are implemented video providers; Veo uses the Gemini key", () => {
  for (const id of ["veo", "kling"]) {
    const def = providerDef(id)!;
    assert.equal(def.implemented, true, id);
    assert.ok(def.kinds.includes("video"));
  }
  assert.deepEqual(providerDef("veo")!.envKeys, ["GEMINI_API_KEY"]);
});

test("availability: enabled AND keyed; a switched-off provider or a malformed Kling key is not offered", () => {
  const prev = { g: process.env.GEMINI_API_KEY, k: process.env.KLING_API_KEY };
  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.KLING_API_KEY;
    resetProviderCache();
    assert.deepEqual(videoProvidersAvailable(), [], "no key at all");
    assert.match(videoProviderUnavailable({ provider: "veo" }) ?? "", /mavjud emas/);

    process.env.GEMINI_API_KEY = "AIza-test-key-0123456789";
    assert.deepEqual(videoProvidersAvailable(), ["veo"]);
    assert.equal(videoProviderUnavailable({ provider: "veo" }), null);
    assert.notEqual(videoProviderUnavailable({ provider: "kling" }), null, "the user picked a provider that is not offered");

    process.env.KLING_API_KEY = "justonetoken";
    assert.deepEqual(videoProvidersAvailable(), ["veo"], "Kling needs <accessKey>:<secretKey>");
    process.env.KLING_API_KEY = "AK123:SK456";
    assert.deepEqual(videoProvidersAvailable(), ["veo", "kling"]);

    setProviderSnapshot(new Map([["veo", { enabled: false, key: null, unreadable: false }]]));
    assert.deepEqual(videoProvidersAvailable(), ["kling"], "switched off in «Provayderlar»");
    setProviderSnapshot(new Map([["kling", { enabled: true, key: "DBAK:DBSK", unreadable: false }]]));
    assert.deepEqual(videoProvidersAvailable(), ["veo", "kling"], "DB key");
  } finally {
    if (prev.g === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev.g;
    if (prev.k === undefined) delete process.env.KLING_API_KEY;
    else process.env.KLING_API_KEY = prev.k;
    resetProviderCache();
  }
});
