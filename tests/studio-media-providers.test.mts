import test from "node:test";
import assert from "node:assert/strict";
import { normalize, MediaError, type AdapterAsset, type AdapterInput, type CatalogEntry } from "../lib/studio-core/index.ts";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "../lib/media/catalog.ts";
import {
  FAL_EFFECT_ENTRIES,
  KLING_EFFECTS,
  KLING_FAL_EFFECTS_ENDPOINT,
  KLING_FAL_EFFECTS_MODEL,
  PIXVERSE_EFFECTS,
  PIXVERSE_EFFECTS_ENDPOINT,
  PIXVERSE_EFFECTS_MODEL,
  STUDIO_VIDEO_PURPOSE,
  effectPhotoHint,
  effectPhotos,
} from "../lib/media/catalog-video.ts";
import { studioVideoAdapters } from "../lib/media/adapters/video.ts";
import { FAL_VIDEO_ENDPOINTS } from "../lib/media/adapters/fal.ts";
import { studioVideoError, studioVideoImageParams, studioVideoPrice } from "../lib/media/studio-video-pricing.ts";
import { TOOL_BY_ID, topicOf } from "../lib/tools.ts";

/**
 * STUDIO P11 package F, pure half: the fal effects, video, image and avatar models. Stubbed `fetch`, no network, no paid call.
 * Every endpoint, param and price below is what the model's own llms.txt page states (read 2026-11-06); the comment of each
 * block names the page. A golden body here is the page's schema, so a builder cannot drift from it unnoticed.
 *
 * Mutations (each turned the named test red, then restored): listed at the end of this header as they are made.
 *   1. PixVerse `duration` "8" instead of "5"                       -> «effects: bodies»;
 *   2. Kling `input_image_urls` a string, not a list                 -> «effects: bodies»;
 *   3. `effectPhotos` ignores the model (hug always two photos)      -> «effects: the hug takes one photo on fal»;
 *   4. fal effect entry without `defaultOff`                         -> «effects: catalog»;
 *   5. `needsStart` guard removed                                    -> «effects: bodies» (a job without the photo);
 *   6. cost of Kling 1.6 $0.056 instead of 5 × $0.056                -> «effects: prices».
 */

const START: AdapterAsset = { mime: "image/png", base64: "c3RhcnQtZnJhbWU=" };
const ASSET = "0123456789abcdef01234567";
const ASSET2 = "abcdef0123456789abcdef01";
const FKEY = "fal-test-key-0123:secretsecretvalue";
const RATE = 12_700;
const PRICING = { soumPerUsd: RATE, markup: 2, step: 100, overrides: {}, costUsd: {} };
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;
const DATA = `data:image/png;base64,${START.base64}`;

const entry = (id: string): CatalogEntry => MEDIA_CATALOG.byId(id)!;
const adapters = () => studioVideoAdapters({ klingKeyFn: () => "klingstudiosecretvalue0123456789", falKeyFn: () => FKEY });
function input(id: string, values: Record<string, unknown>, assets: Record<string, AdapterAsset[]> = {}): AdapterInput {
  const e = entry(id);
  return { upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, values), ...(Object.keys(assets).length ? { assets } : {}), idempotencyKey: "g:video:0" };
}
const req = (id: string, values: Record<string, unknown>, assets: Record<string, AdapterAsset[]> = {}) => adapters()[entry(id).routes[0]!.adapter]!.buildRequest!(input(id, values, assets));

/* ══════════════════════════ 1. effects ══════════════════════════ */

test("effects: catalog — two fal providers, hidden until the admin's switch, the direct Kling entry stays hidden and last", () => {
  assert.deepEqual(FAL_EFFECT_ENTRIES.map((e) => e.id), [PIXVERSE_EFFECTS_MODEL, KLING_FAL_EFFECTS_MODEL]);
  const allowed = MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed;
  for (const e of FAL_EFFECT_ENTRIES) {
    assert.equal(e.defaultOff, true, `${e.id} ships hidden`);
    assert.deepEqual(e.capabilities, ["effect"]);
    assert.ok(allowed.includes(e.id));
    assert.equal(e.routes[0]!.provider, "fal");
    assert.equal(e.routes[0]!.adapter, "fal-video");
    assert.ok(FAL_VIDEO_ENDPOINTS.has(e.routes[0]!.upstreamModel), "an op id may name the endpoint");
    assert.ok(!e.params.some((p) => p.name === "secondImageAssetId"), "fal effects take one photo");
    assert.ok(!e.params.some((p) => p.name === "prompt"), "an effect has no prompt");
  }
  assert.equal(entry("kling/effects").defaultOff, true);
  assert.equal(allowed.at(-1), "kling/effects");
});

test("effects: PixVerse sells twelve scenes by their exact enum values, Kling 1.6 the nine plus the hug", () => {
  assert.equal(PIXVERSE_EFFECTS.length, 12);
  assert.equal(new Set(PIXVERSE_EFFECTS.map((e) => e.label)).size, 12, "labels stay distinct");
  const options = (id: string) => {
    const p = entry(id).params.find((x) => x.name === "effect")!;
    return p.type === "enum" ? p.options.map((o) => o.value) : [];
  };
  assert.deepEqual(options(PIXVERSE_EFFECTS_MODEL), PIXVERSE_EFFECTS.map((e) => e.id));
  assert.deepEqual(options(KLING_FAL_EFFECTS_MODEL), [...KLING_EFFECTS.map((e) => e.id), "hug_pro"]);
  // Nothing religious or sexual reaches the grid (the page lists both kinds).
  for (const e of PIXVERSE_EFFECTS) assert.doesNotMatch(e.id, /jesus|holy|kiss|bikini|pole|abs|succubus|naked|girlfriend|boyfriend/i);
});

test("effects: bodies are the pages' schemas; every scene changes the request; no photo means no request", () => {
  const px = req(PIXVERSE_EFFECTS_MODEL, { effect: "Liquid Metal", imageAssetId: ASSET }, { imageAssetId: [START] });
  assert.equal(px.url, `https://queue.fal.run/${PIXVERSE_EFFECTS_ENDPOINT}`);
  assert.deepEqual(px.body, { effect: "Liquid Metal", image_url: DATA, resolution: "720p", duration: "5", enable_safety_checker: true });

  const kl = req(KLING_FAL_EFFECTS_MODEL, { effect: "hug_pro", imageAssetId: ASSET }, { imageAssetId: [START] });
  assert.equal(kl.url, `https://queue.fal.run/${KLING_FAL_EFFECTS_ENDPOINT}`);
  assert.deepEqual(kl.body, { effect_scene: "hug_pro", input_image_urls: [DATA], duration: "5", enable_safety_checker: true });

  // Every param is a differential probe: another scene, another body.
  for (const e of FAL_EFFECT_ENTRIES) {
    const p = e.params.find((x) => x.name === "effect")!;
    assert.ok(p.type === "enum");
    const bodies = p.options.map((o) => JSON.stringify(req(e.id, { effect: o.value, imageAssetId: ASSET }, { imageAssetId: [START] }).body));
    assert.equal(new Set(bodies).size, p.options.length, `${e.id}: every scene reaches the request`);
  }
  assert.throws(() => req(PIXVERSE_EFFECTS_MODEL, { effect: "Liquid Metal" }), MediaError);
  assert.throws(() => req(KLING_FAL_EFFECTS_MODEL, { effect: "snowglobe" }), (e: MediaError) => e.accepted === false);
});

test("effects: the hug takes one photo on fal, two on the direct API", () => {
  assert.equal(effectPhotos("hug_pro"), 2);
  assert.equal(effectPhotos("hug_pro", "kling/effects"), 2);
  assert.equal(effectPhotos("hug_pro", KLING_FAL_EFFECTS_MODEL), 1);
  assert.equal(studioVideoError({ modelId: KLING_FAL_EFFECTS_MODEL, effect: "hug_pro", imageAssetId: ASSET }), null);
  assert.match(studioVideoError({ modelId: KLING_FAL_EFFECTS_MODEL, effect: "hug_pro", imageAssetId: ASSET, secondImageAssetId: ASSET2 })!, /bitta surat/);
  assert.match(studioVideoError({ modelId: "kling/effects", effect: "hug_pro", imageAssetId: ASSET })!, /ikkinchi suratni/);
  assert.deepEqual(studioVideoImageParams(entry(KLING_FAL_EFFECTS_MODEL), { effect: "hug_pro" }), ["imageAssetId"]);
  assert.match(effectPhotoHint("hug_pro", KLING_FAL_EFFECTS_MODEL), /ikki kishi/);
  assert.doesNotMatch(effectPhotoHint("snowglobe", KLING_FAL_EFFECTS_MODEL), /ikki kishi/);
  assert.doesNotMatch(effectPhotoHint("hug_pro", "kling/effects"), /ikki kishi/);
});

test("effects: prices are the pages' clip prices × markup; a job needs its photo; a scene of another provider is refused", () => {
  const p = (modelId: string, effect: string) => studioVideoPrice({ modelId, effect }, PRICING);
  assert.equal(p(PIXVERSE_EFFECTS_MODEL, "Liquid Metal"), up100(0.2 * RATE * 2));
  assert.equal(p(KLING_FAL_EFFECTS_MODEL, "snowglobe"), up100(5 * 0.056 * RATE * 2));
  assert.equal(studioVideoError({ modelId: PIXVERSE_EFFECTS_MODEL, effect: "Liquid Metal" }), "Effekt uchun surat yuklang.");
  assert.ok(studioVideoError({ modelId: PIXVERSE_EFFECTS_MODEL, effect: "snowglobe", imageAssetId: ASSET }), "a Kling scene on PixVerse");
  assert.ok(studioVideoError({ modelId: PIXVERSE_EFFECTS_MODEL, effect: "Kiss", imageAssetId: ASSET }), "a page effect we do not sell");
  assert.equal(topicOf({ modelId: PIXVERSE_EFFECTS_MODEL, effect: "Liquid Metal" }, TOOL_BY_ID["studio-video"]), "Effekt: Suyuq metall");
});
