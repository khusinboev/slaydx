import test from "node:test";
import assert from "node:assert/strict";
import { costUsd, defineCatalog, normalize, MediaError, type AdapterAsset, type AdapterInput, type CatalogEntry } from "../lib/studio-core/index.ts";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "../lib/media/catalog.ts";
import {
  ASPECT_FOLLOWS_IMAGE,
  END_IMAGE_PARAM,
  FAL_AVATAR_ENTRIES,
  FAL_EFFECT_ENTRIES,
  FAL_VIDEO_MAX_SECONDS,
  KLING_AVATAR_MODEL,
  KLING_EFFECTS,
  KLING_FAL_EFFECTS_ENDPOINT,
  KLING_FAL_EFFECTS_MODEL,
  OMNIHUMAN_AUDIO_MAX_BYTES,
  OMNIHUMAN_MODEL,
  OWN_AUDIO_PARAM,
  PIXVERSE_EFFECTS,
  PIXVERSE_EFFECTS_ENDPOINT,
  PIXVERSE_EFFECTS_MODEL,
  PIXVERSE_PROMPT_MAX_BYTES,
  STUDIO_VIDEO_PURPOSE,
  avatarMaxSeconds,
  avatarMinSeconds,
  effectPhotoHint,
  effectPhotos,
  isAvatarModel,
  isPhotoAvatarModel,
  withAvatarSeconds,
} from "../lib/media/catalog-video.ts";
import { studioVideoAdapters } from "../lib/media/adapters/video.ts";
import { FAL_MODELS, FAL_TOOL_MODELS, FAL_VIDEO_ENDPOINTS, FAL_VIDEO_MODELS, KLEIN_SIZES, falAdapter } from "../lib/media/adapters/fal.ts";
import { FAL_AVATAR_ADAPTER_ID, FAL_AVATAR_ENDPOINTS } from "../lib/media/adapters/fal-avatar.ts";
import { FAL_STORAGE_DELETE_URL, FAL_STORAGE_INITIATE_URL } from "../lib/media/adapters/fal-storage.ts";
import { studioVideoError, studioVideoImageParams, studioVideoPrice } from "../lib/media/studio-video-pricing.ts";
import { studioImagePrice } from "../lib/media/studio-pricing.ts";
import { IMAGE_PRICES, imagePriceOf } from "../lib/generation/llm-pricing.ts";
import { IMAGE_RATIOS } from "../lib/generation/image-studio-options.ts";
import { VIDEO_PROMPT_MAX } from "../lib/generation/video/registry.ts";
import { VIDEO_MAX_BYTES } from "../lib/generation/video/types.ts";
import { TOOL_BY_ID, topicOf } from "../lib/tools.ts";
import { compareModels } from "../components/studio/compare/compare-model.ts";
import { setSafeFetchLookup } from "../lib/generation/safe-fetch.ts";

/**
 * STUDIO P11 package F, pure half: the fal effects, video, image and avatar models. Stubbed `fetch`, no network, no paid call.
 * Every endpoint, param and price below is what the model's own llms.txt page states (read 2026-11-06); the comment of each
 * block names the page. A golden body here is the page's schema, so a builder cannot drift from it unnoticed.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. PixVerse `duration` "8" instead of "5"                       -> «effects: bodies»;
 *   2. Kling `input_image_urls` a string, not a list                 -> «effects: bodies»;
 *   3. `effectPhotos` ignores the model (hug always two photos)      -> «effects: the hug takes one photo on fal»;
 *   4. fal effect entry without `defaultOff`                         -> «effects: catalog», «every package F entry»;
 *   5. `needsStart` guard removed                                    -> «effects: bodies»;
 *   6. Kling 1.6 clip priced $0.056, not 5 × $0.056                  -> «effects: prices»;
 *   7. `plus` left out of `costUsd`                                  -> «video: prices»;
 *   8. `costParams` does not read `plus.param`                       -> «video: prices»;
 *   9. PixVerse's prompt without `maxBytes`                          -> «video: PixVerse's prompt limit»;
 *  10. `validate` compares bytes with 4 × `maxBytes`                 -> «video: PixVerse's prompt limit»;
 *  11. PixVerse `generate_audio_switch` always false                 -> «video: bodies»;
 *  12. `aspect_ratio` also sent in image → video                     -> «video: bodies»;
 *  13. Happy Horse 1080p at the 720p rate                            -> «video: prices»;
 *  14. Klein 16:9 at 1280 × 720 (above 1K by side)                   -> «image: bodies»;
 *  15. Klein edit quoted at $0.009                                   -> «image: catalog», «image: edit bodies»;
 *  16. Klein edit `enable_prompt_expansion: false`                   -> «image: edit bodies»;
 *  17. OmniHuman's audio cap doubled                                 -> «avatars: the stated audio limits»;
 *  18. the audio type check removed                                  -> «avatars: the stated audio limits»;
 *  19. a refused submit keeps the upload                             -> «avatars: a refused submit»;
 *  20. the avatar adapter accepts a clip's op id                     -> «avatars: a refused submit»;
 *  21. a photo avatar priced by an empty script                      -> «avatars: the length»;
 *  22. a photo avatar without a speech passes the preflight          -> «avatars: the length».
 */

setSafeFetchLookup(async () => ["93.184.216.34"]);

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

/* ══════════════════════════ 2. video ══════════════════════════ */

const GROK = "xai/grok-imagine-lite";
const PIX6 = "pixverse/v6";
const HORSE = "alibaba/happy-horse";
const T = { prompt: "Registon at dawn", seconds: 6, aspect: "9:16" };

test("video: catalog — three defaultOff models, ≤ 10 s, the pages' minimum lengths, no end frame, aspect follows the frame", () => {
  const allowed = MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed;
  for (const [id, min] of [[GROK, 1], [PIX6, 1], [HORSE, 3]] as const) {
    const e = entry(id);
    assert.equal(e.defaultOff, true, `${id} ships hidden`);
    assert.ok(allowed.includes(id));
    assert.deepEqual(e.capabilities, ["t2v", "i2v"]);
    assert.equal(e.routes[0]!.adapter, "fal-video");
    const secs = e.params.find((p) => p.name === "seconds")!;
    assert.ok(secs.type === "int" && secs.min === min && secs.max === 10 && FAL_VIDEO_MAX_SECONDS === 10, id);
    assert.ok(!e.params.some((p) => p.name === END_IMAGE_PARAM), `${id}: its page has no end frame`);
    assert.ok(ASPECT_FOLLOWS_IMAGE.has(id));
  }
  assert.ok(!entry(GROK).params.some((p) => p.name === "resolution"), "one tier is no row (no decorative param)");
  assert.ok(!entry(PIX6).params.some((p) => p.name === "resolution"));
  assert.ok(!entry(GROK).params.some((p) => p.name === "sound"), "Grok's page has no audio switch");
  assert.ok(!entry(HORSE).params.some((p) => p.name === "sound"), "Happy Horse's sound is native, no switch");
});

test("video: bodies are the pages' schemas, text and image, and image → video has no aspect", () => {
  const Q = "https://queue.fal.run";
  const req2 = (id: string, v: Record<string, unknown>) => req(id, { ...T, ...v, imageAssetId: ASSET }, { imageAssetId: [START] });
  assert.deepEqual(req(GROK, T), {
    url: `${Q}/xai/grok-imagine-video/v1.5/lite/text-to-video`,
    headers: { "Content-Type": "application/json" },
    body: { prompt: T.prompt, aspect_ratio: "9:16", duration: 6, resolution: "720p", enable_safety_checker: true },
  });
  assert.deepEqual(req2(GROK, {}), {
    url: `${Q}/xai/grok-imagine-video/v1.5/lite/image-to-video`,
    headers: { "Content-Type": "application/json" },
    body: { prompt: T.prompt, image_url: DATA, duration: 6, resolution: "720p", enable_safety_checker: true },
  });
  assert.deepEqual(req(PIX6, { ...T, sound: true }), {
    url: `${Q}/fal-ai/pixverse/v6/text-to-video`,
    headers: { "Content-Type": "application/json" },
    body: { prompt: T.prompt, aspect_ratio: "9:16", resolution: "720p", duration: 6, generate_audio_switch: true, generate_multi_clip_switch: false, enable_safety_checker: true },
  });
  assert.deepEqual(req2(PIX6, {}), {
    url: `${Q}/fal-ai/pixverse/v6/image-to-video`,
    headers: { "Content-Type": "application/json" },
    body: { prompt: T.prompt, image_url: DATA, resolution: "720p", duration: 6, generate_audio_switch: false, generate_multi_clip_switch: false, enable_safety_checker: true },
  });
  assert.deepEqual(req(HORSE, { ...T, resolution: "1080p" }), {
    url: `${Q}/alibaba/happy-horse/v1.1/text-to-video`,
    headers: { "Content-Type": "application/json" },
    body: { prompt: T.prompt, aspect_ratio: "9:16", resolution: "1080p", duration: 6, enable_safety_checker: true },
  });
  assert.deepEqual(req2(HORSE, {}), {
    url: `${Q}/alibaba/happy-horse/v1.1/image-to-video`,
    headers: { "Content-Type": "application/json" },
    body: { prompt: T.prompt, image_url: DATA, resolution: "720p", duration: 6, enable_safety_checker: true },
  });
  for (const id of [GROK, PIX6, HORSE]) for (const s of [req(id, T), req2(id, {})]) assert.ok(!JSON.stringify(s).includes(FKEY), "no key in a request");
});

test("video: prices — seconds × the page's rate, Grok's input image is billed once, PixVerse's sound and Happy Horse's tier move the price", () => {
  const p = (id: string, v: Record<string, unknown>) => studioVideoPrice({ modelId: id, ...v }, PRICING);
  const soum = (usd: number) => up100(usd * RATE * 2);
  assert.equal(p(GROK, { seconds: 5 }), soum(5 * 0.03));
  assert.equal(p(GROK, { seconds: 5, imageAssetId: ASSET }), soum(5 * 0.03 + 0.01), "the page's $0.16 for 5 s + one image");
  assert.equal(p(GROK, { seconds: 10, imageAssetId: ASSET }), soum(10 * 0.03 + 0.01), "once, not per second");
  assert.equal(p(GROK, { seconds: 5, imageAssetId: "" }), soum(5 * 0.03));
  assert.equal(p(PIX6, { seconds: 5 }), soum(5 * 0.045), "$0.225");
  assert.equal(p(PIX6, { seconds: 5, sound: true }), soum(5 * 0.06), "$0.30");
  assert.equal(p(HORSE, { seconds: 5 }), soum(5 * 0.14));
  assert.equal(p(HORSE, { seconds: 5, resolution: "1080p" }), soum(5 * 0.18));
  assert.ok(p(HORSE, { seconds: 10, resolution: "1080p" })! > p(HORSE, { seconds: 5, resolution: "1080p" })!);
  // What the row stores, for the margin (`media_jobs.cost_usd`, the admin table).
  const e = entry(GROK);
  assert.ok(Math.abs(costUsd(e.cost, normalize(e.params, { seconds: 5, imageAssetId: ASSET })) - 0.16) < 1e-9);
  assert.throws(() => defineCatalog([{ ...e, id: "a/b", params: e.params.filter((x) => x.name === "seconds"), cost: { per: "second", usd: 1, secondsParam: "seconds", plus: { param: "nope", usd: 1 } } }]), /unknown param/);
});

test("video: PixVerse's prompt limit counts UTF-8 bytes, so a Cyrillic or apostrophe-heavy prompt is refused before charging", () => {
  const base = { modelId: PIX6, seconds: 5 };
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const fits = "я".repeat(1000);
  assert.ok(bytes(fits) <= PIXVERSE_PROMPT_MAX_BYTES);
  assert.equal(studioVideoError({ ...base, prompt: fits }), null, "1000 Cyrillic letters are 2000 bytes");
  // «‘» is three bytes: 700 of them pass the character limit and fail the byte limit.
  const over = "‘".repeat(700);
  assert.ok(over.length <= VIDEO_PROMPT_MAX);
  assert.ok(bytes(over) > PIXVERSE_PROMPT_MAX_BYTES);
  assert.match(studioVideoError({ ...base, prompt: over })!, /juda uzun/);
  assert.equal(studioVideoError({ modelId: HORSE, seconds: 5, prompt: over }), null, "characters on Happy Horse (2500 stated)");
  assert.equal(studioVideoError({ modelId: GROK, seconds: 5, prompt: over }), null);
  assert.ok(VIDEO_PROMPT_MAX <= 2500, "the shared prompt limit fits Happy Horse's page");
});

/* ══════════════════════════ 3. image ══════════════════════════ */

const IMG = (id: string, values: Record<string, unknown>, inputs: AdapterAsset[] = []) => {
  const e = entry(id);
  return falAdapter({ key: () => FKEY }).buildRequest!({ upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, values), ...(inputs.length ? { assets: { inputImages: inputs } } : {}), idempotencyKey: "k" });
};
const PIC = { prompt: "Registon at dawn", imageRatio: "16:9", imageCount: 1 };

test("image: catalog — four defaultOff entries, two pictures and two edits, each priced from the book", () => {
  for (const [id, purpose, endpoint, usd] of [
    ["meta/muse", "studio.image", "meta/muse-image/text-to-image", 0.01],
    ["bfl/flux-klein", "studio.image", "blackforestlabs/flux-3/klein/text-to-image", 0.009],
    ["meta/muse-edit", "studio.edit", "meta/muse-image/edit", 0.01],
    ["bfl/flux-klein-edit", "studio.edit", "blackforestlabs/flux-3/klein/edit-image", 0.014],
  ] as const) {
    const e = entry(id);
    assert.equal(e.defaultOff, true, `${id} ships hidden`);
    assert.ok(MEDIA_PURPOSES.byId(purpose)!.allowed.includes(id));
    assert.deepEqual(e.routes, [{ provider: "fal", upstreamModel: endpoint, adapter: "fal" }]);
    assert.equal(IMAGE_PRICES[endpoint], usd);
    assert.equal(imagePriceOf(endpoint), usd, "the longest prefix: never FLUX 3's row");
    assert.equal(e.cost.per, "output");
    assert.equal(studioImagePrice({ modelId: id, imageCount: 2 }, PRICING), up100(2 * usd * RATE * 2));
  }
  assert.equal(MEDIA_PURPOSES.byId("studio.image")!.default, "google/nano-banana");
  assert.equal(MEDIA_PURPOSES.byId("studio.edit")!.default, "google/nano-banana-edit");
});

test("image: bodies are the pages' schemas; every ratio changes the request; Klein stays on its 1K tier", () => {
  assert.deepEqual(IMG("meta/muse", PIC).body, { prompt: PIC.prompt, aspect_ratio: "16:9", num_images: 1, output_format: "jpeg", sync_mode: true });
  assert.deepEqual(IMG("bfl/flux-klein", PIC).body, {
    prompt: PIC.prompt,
    image_size: { width: 1024, height: 576 },
    num_images: 1,
    output_format: "jpeg",
    enable_prompt_expansion: false,
    enable_safety_checker: true,
    sync_mode: true,
  });
  assert.equal(IMG("meta/muse", PIC).url, "https://queue.fal.run/meta/muse-image/text-to-image");
  for (const id of ["meta/muse", "bfl/flux-klein"]) {
    const bodies = IMAGE_RATIOS.map((r) => JSON.stringify(IMG(id, { ...PIC, imageRatio: r.id }).body));
    assert.equal(new Set(bodies).size, IMAGE_RATIOS.length, `${id}: every ratio reaches the request`);
  }
  for (const r of IMAGE_RATIOS) {
    const s = KLEIN_SIZES[r.id];
    assert.ok(Math.max(s.width, s.height) <= 1024, `${r.id}: the 1K tier by side`);
    assert.ok(Math.min(s.width, s.height) >= 256, `${r.id}: the page's minimum`);
    const [w, h] = r.id.split(":").map(Number) as [number, number];
    assert.ok(Math.abs(s.width / s.height - w / h) < 0.01, `${r.id}: the ratio`);
  }
});

test("image: edit bodies — references as data URLs; Klein expands the instruction and follows the reference, priced at its 2K tier", () => {
  const edit = { prompt: "Make the sky red", inputImages: ASSET, imageCount: 1 };
  assert.deepEqual(IMG("meta/muse-edit", edit, [START]).body, { prompt: edit.prompt, image_urls: [DATA], num_images: 1, output_format: "jpeg", sync_mode: true });
  const klein = IMG("bfl/flux-klein-edit", edit, [START]);
  assert.equal(klein.url, "https://queue.fal.run/blackforestlabs/flux-3/klein/edit-image");
  assert.deepEqual(klein.body, { prompt: edit.prompt, image_urls: [DATA], num_images: 1, output_format: "jpeg", enable_prompt_expansion: true, enable_safety_checker: true, sync_mode: true });
  assert.ok(!("image_size" in (klein.body as object)), "the reference's own size");
  // The page's «$0.009 at 1K» is not what an unset size bills: the output keeps up to 4 MP.
  assert.ok(IMAGE_PRICES["blackforestlabs/flux-3/klein/edit-image"]! > IMAGE_PRICES["blackforestlabs/flux-3/klein/text-to-image"]!);
  const three = IMG("meta/muse-edit", { ...edit, inputImages: `${ASSET},${ASSET2}` }, [START, START, START]);
  assert.equal((three.body as { image_urls: string[] }).image_urls.length, 3);
  assert.throws(() => IMG("meta/muse-edit", edit, []), MediaError, "no picture, no request");
  assert.throws(() => IMG("bfl/flux-klein-edit", edit, []), MediaError);
});

/* ══════════════════════════ 4. avatars ══════════════════════════ */

const OWN = "0f0e0d0c-0b0a-4908-8706-050403020100";
const MP3: AdapterAsset = { mime: "audio/mpeg", base64: Buffer.from("ID3 speech bytes").toString("base64") };
const AV = { [OWN_AUDIO_PARAM]: OWN, imageAssetId: ASSET, seconds: 7 };
const avatarAssets = { imageAssetId: [START], [OWN_AUDIO_PARAM]: [MP3] };
const FILE_URL = "https://v3b.fal.media/files/b/audio.mp3";
const UPLOAD_URL = "https://upload.fal.media/presigned/abc";
const REQ = "4f1c2b3a-9d8e-4c7b-a6f5-0123456789ab";

function falStub(respond?: (url: string, init: RequestInit) => Response | null) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    seen.push({ url, init: init ?? {} });
    const custom = respond?.(url, init ?? {});
    if (custom) return custom;
    if (url === FAL_STORAGE_INITIATE_URL) return new Response(JSON.stringify({ upload_url: UPLOAD_URL, file_url: FILE_URL }), { status: 200 });
    if (url === UPLOAD_URL) return new Response(null, { status: 200 });
    if (url === FAL_STORAGE_DELETE_URL) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ request_id: REQ }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

test("avatars: catalog — two defaultOff models on their own adapter, photo required, no prompt, no decorative row", () => {
  assert.deepEqual(FAL_AVATAR_ENTRIES.map((e) => e.id), [OMNIHUMAN_MODEL, KLING_AVATAR_MODEL]);
  for (const e of FAL_AVATAR_ENTRIES) {
    assert.equal(e.defaultOff, true, `${e.id} ships hidden`);
    assert.equal(e.routes[0]!.adapter, FAL_AVATAR_ADAPTER_ID);
    assert.deepEqual(e.params.map((p) => p.name), [OWN_AUDIO_PARAM, "imageAssetId", "seconds"]);
    assert.ok(isAvatarModel(e.id) && isPhotoAvatarModel(e.id));
    assert.ok(adapters()[FAL_AVATAR_ADAPTER_ID]);
    const secs = e.params.find((p) => p.name === "seconds")!;
    assert.ok(secs.type === "int" && secs.max === 30, "30 s fits the 25 MB result cap until live sizes are known");
  }
  assert.equal(isPhotoAvatarModel("heygen/avatar"), false);
  assert.equal(isAvatarModel("heygen/avatar"), true);
  assert.equal(avatarMinSeconds(OMNIHUMAN_MODEL), 4);
  assert.equal(avatarMaxSeconds(OMNIHUMAN_MODEL), 30);
  assert.equal(avatarMaxSeconds("heygen/avatar"), 60);
  assert.ok(compareModels("video", MEDIA_CATALOG.clientView().filter((e) => e.id === OMNIHUMAN_MODEL)).length === 0, "not in the compare view");
});

test("avatars: bodies carry the photo inline and the audio by its fal URL, nothing else", async () => {
  for (const [id, endpoint, extra] of [
    [OMNIHUMAN_MODEL, "bytedance/omnihuman/v2", {}],
    [KLING_AVATAR_MODEL, "fal-ai/kling-video/ai-avatar/v2/standard", { enable_safety_checker: true }],
  ] as const) {
    const { fetchImpl, seen } = falStub();
    const stored: string[] = [];
    const r = await adapters()[FAL_AVATAR_ADAPTER_ID]!.submit(input(id, AV, avatarAssets), { fetchImpl, onInputStored: async (u) => void stored.push(u) });
    assert.deepEqual(r, { opId: `fal:${endpoint}:${REQ}` });
    assert.deepEqual(seen.map((s) => s.url), [FAL_STORAGE_INITIATE_URL, UPLOAD_URL, `https://queue.fal.run/${endpoint}`], "upload first, one submit");
    assert.deepEqual(stored, [FILE_URL], "the host holds the URL before the paid call");
    assert.deepEqual(JSON.parse(String(seen[2]!.init.body)), { image_url: DATA, audio_url: FILE_URL, ...extra });
    // The presigned PUT never sees the key; the queue does.
    assert.equal(new Headers(seen[1]!.init.headers).get("authorization"), null);
    assert.equal(new Headers(seen[2]!.init.headers).get("authorization"), `Key ${FKEY}`);
    assert.equal(seen[2]!.init.redirect, "manual");
    assert.equal(Buffer.from(seen[1]!.init.body as Uint8Array).toString(), "ID3 speech bytes", "the audioId param's own bytes travel");
  }
});

test("avatars: differential probe — the speech and the photo each reach the request, the length moves the price", async () => {
  const bodyOf = async (assets: Record<string, AdapterAsset[]>) => {
    const { fetchImpl, seen } = falStub();
    await adapters()[FAL_AVATAR_ADAPTER_ID]!.submit(input(OMNIHUMAN_MODEL, AV, assets), { fetchImpl });
    return { put: Buffer.from(seen[1]!.init.body as Uint8Array).toString(), body: String(seen[2]!.init.body) };
  };
  const a = await bodyOf(avatarAssets);
  const otherSpeech = await bodyOf({ ...avatarAssets, [OWN_AUDIO_PARAM]: [{ mime: "audio/mpeg", base64: Buffer.from("another").toString("base64") }] });
  assert.notEqual(a.put, otherSpeech.put, "audioId changes what is uploaded");
  const otherPhoto = await bodyOf({ ...avatarAssets, imageAssetId: [{ mime: "image/jpeg", base64: "b3RoZXI=" }] });
  assert.notEqual(a.body, otherPhoto.body, "the photo changes the request");
  for (const e of FAL_AVATAR_ENTRIES) {
    const p = (seconds: number) => studioVideoPrice({ modelId: e.id, [OWN_AUDIO_PARAM]: OWN, imageAssetId: ASSET, seconds }, PRICING);
    assert.notEqual(p(5), p(20), `${e.id}: seconds moves the price`);
  }
  assert.equal(studioVideoPrice({ modelId: OMNIHUMAN_MODEL, seconds: 10 }, PRICING), up100(10 * 0.105 * RATE * 2));
  assert.equal(studioVideoPrice({ modelId: KLING_AVATAR_MODEL, seconds: 10 }, PRICING), up100(10 * 0.0562 * RATE * 2));
});

test("avatars: the stated audio limits refuse before anything is uploaded", async () => {
  const refused = async (id: string, audio: AdapterAsset, re: RegExp) => {
    const { fetchImpl, seen } = falStub();
    await assert.rejects(adapters()[FAL_AVATAR_ADAPTER_ID]!.submit(input(id, AV, { ...avatarAssets, [OWN_AUDIO_PARAM]: [audio] }), { fetchImpl }), (e: MediaError) => e.accepted === false && re.test(e.message));
    assert.equal(seen.length, 0, "no upload, no submit");
  };
  const overCap = "A".repeat(Math.ceil(((OMNIHUMAN_AUDIO_MAX_BYTES + 3) * 4) / 3));
  // A type fal storage would take, so this is the model's own rule.
  await refused(OMNIHUMAN_MODEL, { mime: "video/mp4", base64: "AAAA" }, /video\/mp4/);
  await refused(OMNIHUMAN_MODEL, { mime: "audio/mpeg", base64: overCap }, /15 MB/);
  const noPhoto = falStub();
  await assert.rejects(adapters()[FAL_AVATAR_ADAPTER_ID]!.submit(input(OMNIHUMAN_MODEL, AV, { [OWN_AUDIO_PARAM]: [MP3] }), { fetchImpl: noPhoto.fetchImpl }), MediaError);
  assert.equal(noPhoto.seen.length, 0);
  const noAudio = falStub();
  await assert.rejects(adapters()[FAL_AVATAR_ADAPTER_ID]!.submit(input(OMNIHUMAN_MODEL, AV, { imageAssetId: [START] }), { fetchImpl: noAudio.fetchImpl }), MediaError);
  assert.equal(noAudio.seen.length, 0);
  // A bigger file on Kling: its page states no limit.
  const big = falStub();
  await adapters()[FAL_AVATAR_ADAPTER_ID]!.submit(input(KLING_AVATAR_MODEL, AV, { ...avatarAssets, [OWN_AUDIO_PARAM]: [{ mime: "audio/wav", base64: overCap }] }), { fetchImpl: big.fetchImpl });
  assert.equal(big.seen.length, 3);
});

test("avatars: a refused submit deletes the upload, the op's protocol is the clip's, the key stays out of messages", async () => {
  const { fetchImpl, seen } = falStub((url) => (url.startsWith("https://queue.fal.run") ? new Response(JSON.stringify({ detail: `bad ${FKEY}` }), { status: 422 }) : null));
  await assert.rejects(adapters()[FAL_AVATAR_ADAPTER_ID]!.submit(input(OMNIHUMAN_MODEL, AV, avatarAssets), { fetchImpl }), (e: MediaError) => e.accepted === false && !e.message.includes(FKEY));
  assert.equal(seen.at(-1)!.url, FAL_STORAGE_DELETE_URL);
  assert.ok(FAL_AVATAR_ENDPOINTS.has("bytedance/omnihuman/v2") && !FAL_VIDEO_ENDPOINTS.has("bytedance/omnihuman/v2"), "each adapter names only its own ops");
  const a = adapters()[FAL_AVATAR_ADAPTER_ID]!;
  const foreign = falStub();
  await assert.rejects(a.poll!(`fal:alibaba/wan-3.0/text-to-video:${REQ}`, { fetchImpl: foreign.fetchImpl }), MediaError, "a clip's op is not this adapter's");
  assert.equal(foreign.seen.length, 0, "the key goes nowhere for a foreign op");
  const polled = falStub((url) => (url.endsWith("/status") ? new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 }) : new Response(JSON.stringify({ video: { url: "https://v3b.fal.media/files/out.mp4" }, duration: 6.2 }), { status: 200 })));
  assert.deepEqual(await a.poll!(`fal:bytedance/omnihuman/v2:${REQ}`, { fetchImpl: polled.fetchImpl }), { state: "done", outputs: [{ kind: "url", url: "https://v3b.fal.media/files/out.mp4" }] });
  assert.equal(polled.seen[0]!.url, `https://queue.fal.run/bytedance/omnihuman/requests/${REQ}/status`, "the queue's owner/app");
});

test("avatars: the length follows the speech, never the request; preflight wants the photo and the speech", () => {
  const v = { modelId: OMNIHUMAN_MODEL, [OWN_AUDIO_PARAM]: OWN, imageAssetId: ASSET };
  assert.equal(withAvatarSeconds(v, 7.04).seconds, 7, "to 0.1 s, then up: the list's number");
  assert.equal(withAvatarSeconds(v, 7.16).seconds, 8);
  assert.equal(withAvatarSeconds(v, 30.1).seconds, 30, "the tolerance never buys more than the cap");
  assert.equal(withAvatarSeconds({ ...v, [OWN_AUDIO_PARAM]: "" }, null).seconds, undefined, "no script to measure");
  assert.equal(withAvatarSeconds({ modelId: "heygen/avatar", prompt: "Assalomu alaykum" }, null).seconds, 2, "HeyGen unchanged");
  assert.equal(studioVideoError({ ...v, seconds: 7 }), null);
  assert.match(studioVideoError({ modelId: OMNIHUMAN_MODEL, imageAssetId: ASSET })!, /ovozingizni tanlang/);
  assert.match(studioVideoError({ modelId: OMNIHUMAN_MODEL, [OWN_AUDIO_PARAM]: OWN })!, /rasm yuklang/);
  assert.match(studioVideoError({ ...v, [OWN_AUDIO_PARAM]: "not-a-uuid" })!, /topilmadi/);
  assert.match(studioVideoError({ ...v, seconds: 3 })!, /4–30/);
  assert.equal(studioVideoError({ modelId: KLING_AVATAR_MODEL, [OWN_AUDIO_PARAM]: OWN, imageAssetId: ASSET, seconds: 3 }), null);
});

test("every package F entry: defaultOff, on fal, an MP4 cap for a clip, and an upstream the adapters know", () => {
  const ids = [PIXVERSE_EFFECTS_MODEL, KLING_FAL_EFFECTS_MODEL, GROK, PIX6, HORSE, OMNIHUMAN_MODEL, KLING_AVATAR_MODEL, "meta/muse", "bfl/flux-klein", "meta/muse-edit", "bfl/flux-klein-edit"];
  for (const id of ids) {
    const e = entry(id);
    assert.equal(e.defaultOff, true, id);
    assert.equal(e.routes.length, 1);
    assert.equal(e.routes[0]!.provider, "fal");
    if (e.kind === "video") assert.equal(e.output.maxBytes, VIDEO_MAX_BYTES, id);
    const up = e.routes[0]!.upstreamModel;
    const known = e.kind === "video" ? up in FAL_VIDEO_MODELS || FAL_AVATAR_ENDPOINTS.has(up) : up in FAL_MODELS || up in FAL_TOOL_MODELS;
    assert.ok(known, `${id}: a builder for ${up}`);
  }
});
