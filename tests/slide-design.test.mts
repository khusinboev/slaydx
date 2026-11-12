import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { buildSlideAcademicDoc, resolveDeckDesign, resolveDeckTemplate } from "../lib/generation/slide-write.ts";
import { buildSlideDeck } from "../lib/generation/slides.ts";
import { DESIGN_POOL, VISUAL_PALETTES, chooseDeckDesign, subjectScores, weightedPick } from "../lib/generation/slide-design.ts";
import { SLIDE_TEMPLATE_BY_ID } from "../lib/generation/slide-templates.ts";
import { photoSlot } from "../lib/generation/slide-layout.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * Slide quality §A (docs/slide-quality/SPEC.md): «Avtomatik» picks a design and a palette per generation, by
 * subject affinity and a stored seed; explicit choices win; a rebuild never re-rolls.
 */
const meta = (values: FormValues) => extractMeta(TOOL_BY_ID.slide, { topic: "Fotosintez", ...values });

test("subject scoring: scored, not first-match — the topic counts more than the subject field", () => {
  assert.equal(subjectScores("Fotosintez jarayoni")[0]?.id, "nature");
  assert.equal(subjectScores("Amir Temur davlatining tashkil topishi")[0]?.id, "history");
  assert.equal(subjectScores("Sun’iy intellektning iqtisodiyotga ta’siri")[0]?.id === "tech" || subjectScores("Sun’iy intellektning iqtisodiyotga ta’siri")[0]?.id === "economy", true);
  // Two stems of one area beat one stem of another: «bank» + «moliya» (economy) over «kompyuter» (tech).
  assert.equal(subjectScores("Bank moliya tizimida kompyuter")[0]?.id, "economy");
  // The topic (×2) outweighs the subject hint (×1).
  assert.equal(subjectScores("Navoiy g'azallari", "", "Biologiya")[0]?.id, "literature");
  assert.deepEqual(subjectScores("Xyz qwerty"), []);
});

test("extractMeta: an untouched/absent palette is «auto»; an explicit id passes; garbage falls back to «auto»", () => {
  assert.equal(meta({}).slideTheme, "auto");
  assert.equal(meta({ slideTheme: "auto" }).slideTheme, "auto");
  assert.equal(meta({ slideTheme: "grove" }).slideTheme, "grove");
  assert.equal(meta({ slideTheme: "nope" }).slideTheme, "auto");
});

test("auto design: different seeds give different designs/palettes on the same topic; the same seed gives the same", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 40; seed += 1) {
    const d = resolveDeckDesign({ ...meta({}), slideSeed: seed });
    seen.add(`${d.tpl.visual}/${d.theme}`);
    const again = resolveDeckDesign({ ...meta({}), slideSeed: seed });
    assert.equal(`${again.tpl.visual}/${again.theme}`, `${d.tpl.visual}/${d.theme}`, "deterministic per seed");
    assert.ok(DESIGN_POOL.lecture.includes(d.tpl.visual), `visual ${d.tpl.visual} from the lecture pool`);
    assert.ok(VISUAL_PALETTES[d.tpl.visual].includes(d.theme), `palette ${d.theme} curated for ${d.tpl.visual}`);
    // The content template (beats, audience) is untouched — only the visual changes.
    assert.equal(d.tpl.id, "lecture");
    assert.deepEqual(d.tpl.beats, SLIDE_TEMPLATE_BY_ID.lecture.beats);
  }
  // MUTATION: ignore the seed in `weightedPick` → one combination only.
  assert.ok(seen.size >= 6, `variety across seeds: ${[...seen].join(", ")}`);
});

test("auto pool: every general-purpose design carries a picture on bullets and on the cover", () => {
  for (const v of DESIGN_POOL.lecture) {
    assert.ok(photoSlot("bullets", v), `${v}: no bullets photo slot`);
    assert.ok(photoSlot("title", v), `${v}: no cover photo slot`);
  }
});

test("subject affinity steers the draw: history decks get rail/story more often than economy decks do", () => {
  const share = (topic: string, visuals: string[]) => {
    let n = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      if (visuals.includes(resolveDeckDesign({ ...meta({ topic }), slideSeed: seed }).tpl.visual)) n += 1;
    }
    return n / 400;
  };
  // Both topics infer the SAME content template (lecture), so only the subject weights can differ.
  assert.equal(resolveDeckTemplate(meta({ topic: "Amir Temur saltanati" })).id, "lecture");
  assert.equal(resolveDeckTemplate(meta({ topic: "Bank va moliya bozori" })).id, "lecture");
  const hist = share("Amir Temur saltanati", ["rail", "story"]);
  const econ = share("Bank va moliya bozori", ["rail", "story"]);
  // MUTATION: drop the area weights in `chooseDeckDesign` → both shares are equal (~2/7).
  assert.ok(hist > econ + 0.2, `history ${hist} vs economy ${econ}`);
});

test("explicit choices win: a picked template keeps its own visual, a picked palette is used as is", () => {
  const tplPicked = resolveDeckDesign({ ...meta({ slideTemplate: "report" }), slideSeed: 7 });
  assert.equal(tplPicked.tpl.visual, SLIDE_TEMPLATE_BY_ID.report.visual);
  assert.ok(VISUAL_PALETTES.dashboard.includes(tplPicked.theme), "auto palette still comes from the design's list");
  for (let seed = 0; seed < 30; seed += 1) {
    assert.equal(resolveDeckDesign({ ...meta({ slideTheme: "chalk" }), slideSeed: seed }).theme, "chalk");
  }
});

test("no seed (legacy call, probe, preview): the content template's own visual and a deterministic palette", () => {
  const m = meta({});
  assert.equal(resolveDeckTemplate(m).visual, SLIDE_TEMPLATE_BY_ID.lecture.visual);
  assert.equal(resolveDeckDesign(meta({ topic: "Xyz qwerty" })).theme, "atlas", "academic + no subject → first curated palette");
  assert.ok(["grove", "clinic"].includes(resolveDeckDesign(m).theme), "nature topic → a nature palette");
  assert.equal(chooseDeckDesign({ topic: "Fotosintez" }, SLIDE_TEMPLATE_BY_ID.lecture).visual, "academic");
  assert.equal(weightedPick(["a", "b", "c"], (x) => (x === "b" ? 3 : 1), undefined, "s"), "b");
});

test("persistence: the build stores seed + design; buildSlideDeck reads the pinned values; a rebuild never re-rolls", async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const doc = await buildSlideAcademicDoc(meta({ topic: "Amir Temur davlatining tarixi" }), Date.now() + 60_000, { seed: 123 });
    assert.equal(doc.meta.slideSeed, 123, "seed stored in doc.meta");
    const want = resolveDeckDesign({ ...doc.meta });
    assert.equal(doc.slideVisual, want.tpl.visual);
    assert.equal(doc.slideTheme, want.theme);
    assert.equal(doc.meta.slideTheme, "auto", "the form value stays «auto»; the resolved id is pinned beside it");
    const deck = buildSlideDeck(doc);
    assert.equal(deck.visual, doc.slideVisual);
    assert.equal(deck.themeId, doc.slideTheme);
    // A rebuild/PATCH path only has the doc: even with the seed gone the pinned values are used.
    const edited = { ...doc, meta: { ...doc.meta, slideSeed: undefined } };
    const again = buildSlideDeck(edited);
    assert.equal(again.visual, doc.slideVisual);
    assert.equal(again.themeId, doc.slideTheme);
    // A fresh generation (no seed passed) draws its own seed.
    const fresh = await buildSlideAcademicDoc(meta({}), Date.now() + 60_000);
    assert.equal(typeof fresh.meta.slideSeed, "number");
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
});

test("buildSlideDeck: an old doc whose meta says «auto» but has no pinned palette renders atlas, never the string «auto»", () => {
  const deck = buildSlideDeck({ meta: { ...meta({}), slideTheme: "auto" }, titlePage: false, toc: false, sections: [], slides: [{ id: "s0", layout: "title", title: "X" }] });
  assert.equal(deck.themeId, "atlas");
});

test("scope (review M2): pro slayd with default form values resolves exactly as on main — own visual, atlas, no seed", async () => {
  const proValues = { topic: "Fotosintez", slideTemplate: "auto", slideTheme: "atlas" };
  const pm = extractMeta(TOOL_BY_ID["pro-slide"], proValues);
  assert.equal(pm.slideTheme, "atlas");
  // An «auto» sent to pro (API, old client) is main's default, not an auto palette.
  assert.equal(extractMeta(TOOL_BY_ID["pro-slide"], { topic: "X", slideTheme: "auto" }).slideTheme, "atlas");
  assert.equal(extractMeta(TOOL_BY_ID["pro-slide"], { topic: "X" }).slideTheme, "atlas");
  for (let seed = 0; seed < 30; seed += 1) {
    const d = resolveDeckDesign({ ...pm, slideSeed: seed });
    // MUTATION: drop the `toolId === "slide"` gate in `chooseDeckDesign` → pro gets pool visuals.
    assert.equal(d.tpl.visual, SLIDE_TEMPLATE_BY_ID.lecture.visual);
    assert.equal(d.theme, "atlas");
  }
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const doc = await buildSlideAcademicDoc(pm, Date.now() + 60_000);
    assert.equal(doc.meta.slideSeed, undefined, "no seed drawn for pro");
    assert.equal(doc.slideVisual, "academic");
    assert.equal(doc.slideTheme, "atlas");
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
});

test("seed (review m6): derived from the generation id — the same id gives the same design on a retry", async () => {
  const { withMediaContext } = await import("../lib/media/context.ts");
  const { seedFromId } = await import("../lib/generation/slide-design.ts");
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const run = () =>
      withMediaContext({ generationId: "11111111-2222-3333-4444-555555555555", core: { image: false, video: false, speech: false } }, () =>
        buildSlideAcademicDoc(meta({ topic: "Amir Temur saltanati" }), Date.now() + 60_000),
      );
    const [a, b] = [await run(), await run()];
    // MUTATION: draw `newSlideSeed()` even with a generation id → the two seeds differ.
    assert.equal(a.meta.slideSeed, seedFromId("11111111-2222-3333-4444-555555555555"));
    assert.equal(b.meta.slideSeed, a.meta.slideSeed);
    assert.equal(`${a.slideVisual}/${a.slideTheme}`, `${b.slideVisual}/${b.slideTheme}`);
    assert.notEqual(seedFromId("a"), seedFromId("b"));
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
});
