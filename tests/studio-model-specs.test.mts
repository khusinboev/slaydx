import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_CATALOG } from "../lib/media/catalog.ts";
import { groupDigits } from "../lib/format.ts";
import type { ClientEntry, ParamSchema } from "../lib/studio-core/index.ts";
import { hasFlag, lengthText, longestText, modelSpecs, qualityText, specChips, specLine } from "../components/studio/model-specs.ts";

/**
 * ModelSpecs (docs/studio/P11-SPEC.md §D, `components/studio/model-specs.ts`): a model card's words are DERIVED from the
 * catalog entry's ParamSchema and capabilities, so a card can never disagree with the form.
 *
 * Locked here:
 *   - the longest length is the `seconds` / `duration` param's `max` (an enum `length`: its longest option), formatted as
 *     the music lengths are («15 s», «3 daq»);
 *   - the best quality is the top `resolution` option by its number («1080p» over «720p», whatever the order), else the
 *     last `quality` / `factor` option;
 *   - sound comes from the `sound` bool (its default decides «ovoz bilan» / «ovozli») or the «ovozli» badge; the frames
 *     from the image params; the count from `imageCount` / `variants`; capabilities add their word once;
 *   - every real catalog model's line starts with its maker and holds only words the schema justifies;
 *   - the filter chips: a badge or a flag is a chip only when SOME model carries it and NOT EVERY one does.
 *
 * Mutations (each turned the named test red, then restored):
 *   `longestText` reads `p.min` instead of `p.max`                        -> «length»;
 *   `topOption` takes the last option instead of the largest number        -> «quality» (1080p listed before 720p);
 *   `hasFlag("sound")` ignores the badge                                   -> «sound and frames» (Omni);
 *   `specChips` keeps a chip every model carries (`!models.every` removed)  -> «chips».
 */

const view = MEDIA_CATALOG.clientView();
const by = (id: string): ClientEntry => view.find((e) => e.id === id)!;

const synth = (params: ParamSchema[], extra: Partial<ClientEntry> = {}): ClientEntry => ({
  id: "x/y",
  kind: "video",
  capabilities: [],
  label: "X",
  maker: "Maker",
  badges: [],
  params,
  cost: { per: "job", usd: 1 },
  limits: { timeoutMs: 1 },
  output: { mimes: ["video/mp4"], maxBytes: 1 },
  ...extra,
});

test("length: seconds / duration max, enum length's longest option, the music wording", () => {
  assert.equal(lengthText(15), "15 s");
  assert.equal(lengthText(60), "1 daq");
  assert.equal(lengthText(90), "1,5 daq");
  assert.equal(lengthText(180), "3 daq");
  assert.equal(longestText(by("kling/kling-4")), "15 s gacha");
  assert.equal(longestText(by("elevenlabs/sfx")), "30 s gacha");
  assert.equal(longestText(by("elevenlabs/music")), "3 daq gacha", "the enum's largest value, not its default");
  assert.equal(longestText(by("google/lyria-3")), "To‘liq qo‘shiq", "non-numeric options: the last one");
  assert.equal(longestText(synth([{ name: "seconds", label: "D", type: "int", min: 2, max: 7, default: 5, affects: "both" }])), "7 s gacha");
  assert.equal(longestText(by("google/nano-banana")), null, "no length param, no length");
});

test("quality: the top resolution by its number whatever the order; quality / factor take the last option", () => {
  assert.equal(qualityText(by("kling/kling-4")), "1080p");
  assert.equal(qualityText(by("minimax/h3")), "768p");
  const reversed = synth([{ name: "resolution", label: "S", type: "enum", options: [{ value: "1080p", label: "Full HD" }, { value: "720p", label: "HD" }], default: "720p", affects: "both" }]);
  assert.equal(qualityText(reversed), "1080p", "MUTATSIYA: the last option (720p) must not win");
  assert.equal(qualityText(by("ideogram/ideogram")), "Yuqori");
  assert.equal(qualityText(by("openai/gpt-image")), null, "no quality param");
  assert.equal(qualityText(by("bytedance/seedvr-upscale")), "×4");
  assert.equal(qualityText(by("kling/kling-4-flash")), null, "one resolution only: nothing to say");
});

test("sound and frames: the bool's default, the badge, the image params; capabilities once", () => {
  assert.ok(hasFlag(by("google/omni-video"), "sound"), "the «ovozli» badge counts as sound");
  assert.ok(!hasFlag(by("kling/kling-4"), "sound"));
  assert.ok(hasFlag(by("kling/kling-4"), "end-frame"));
  assert.ok(!hasFlag(by("kling/kling-4-flash"), "end-frame"));
  assert.ok(hasFlag(by("kling/kling-4"), "start-image"));
  assert.ok(!hasFlag(by("heygen/avatar"), "start-image"));
  assert.deepEqual(modelSpecs(by("alibaba/wan-3")), ["10 s gacha", "1080p", "ovoz bilan", "suratdan", "oxirgi kadr"], "sound default true → «ovoz bilan»");
  assert.deepEqual(modelSpecs(by("kling/kling-3")), ["15 s gacha", "ovozli", "suratdan", "oxirgi kadr"], "sound default false → «ovozli»");
  assert.deepEqual(modelSpecs(by("elevenlabs/sfx")), ["30 s gacha", "4 variantgacha"]);
  assert.deepEqual(modelSpecs(by("google/nano-banana")), ["4 tagacha", "tahrir"]);
  assert.deepEqual(modelSpecs(by("elevenlabs/v3-dialogue")), ["suhbat", `${groupDigits(2000)} belgigacha`]);
  assert.deepEqual(modelSpecs(by("heygen/avatar")), ["1 daq gacha", "avatar"]);
});

test("every catalog model: the line starts with the maker and says nothing the schema does not hold", () => {
  for (const e of view) {
    const line = specLine(e);
    assert.ok(line.startsWith(e.maker), `${e.id}: ${line}`);
    const words = modelSpecs(e);
    if (words.some((w) => w.endsWith("gacha") && /\d/.test(w) && !w.includes("belgi") && !w.includes("tagacha") && !w.includes("variant"))) {
      assert.ok(e.params.some((p) => (p.name === "seconds" || p.name === "duration" || p.name === "length") && (p.type === "int" || p.type === "enum")), `${e.id}: a length word needs a length param`);
    }
    if (words.includes("oxirgi kadr")) assert.ok(e.params.some((p) => p.name === "endImageAssetId"), `${e.id}: end frame`);
    if (words.includes("suratdan")) assert.ok(e.params.some((p) => p.name === "imageAssetId"), `${e.id}: start image`);
    if (words.some((w) => /^\d+p$/.test(w))) assert.ok(e.params.some((p) => p.name === "resolution"), `${e.id}: resolution`);
  }
});

test("chips: a badge or a flag only when some model carries it and not every one does", () => {
  const video = view.filter((e) => e.kind === "video" && !e.capabilities.includes("effect"));
  const ids = specChips(video).map((c) => c.id);
  assert.ok(ids.includes("sound"), "some video models have sound, some not");
  assert.ok(ids.includes("start-image"), "the avatar takes no start image, every clip model does: a chip that narrows");
  assert.ok(ids.includes("end-frame"));
  const clips = video.filter((e) => !e.capabilities.includes("lipsync"));
  assert.ok(!specChips(clips).some((c) => c.id === "start-image"), "MUTATSIYA: without the avatar every model takes a start image — no chip");
  const allSound = [by("alibaba/wan-3"), by("bytedance/seedance-2.5")];
  assert.ok(!specChips(allSound).some((c) => c.id === "sound"), "MUTATSIYA: a chip every model carries changes nothing");
  assert.deepEqual(specChips([by("google/nano-banana"), by("openai/gpt-image")]).map((c) => c.id), ["tez", "sifatli", "arzon", "matn"]);
  assert.deepEqual(specChips([by("google/nano-banana")]).map((c) => c.id), [], "one model: nothing to narrow");
});
