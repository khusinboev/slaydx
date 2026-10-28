import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { DocMeta } from "../lib/generation/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import { buildKonspektDoc, konspektInputFromValues, konspektWordPlan, konspektWordsPerPage } from "../lib/generation/konspekt/index.ts";
import { planWork } from "../lib/generation/work/layout.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import { handGeometry } from "../lib/generation/work/handwriting.ts";
import { KONSPEKT_PARAMS } from "../lib/generation/konspekt/params.ts";

const META = { topic: "Davlatchilik tarixi", workLabel: "Konspekt", language: "uz", toolId: "konspekt" } as unknown as DocMeta;
const words = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i % 7}`).join(" ");

/** Stub LLM: an outline of `n` sections, then `perSection` words for each section call. */
function stub(o: { sections?: number; perSection?: number; outline?: string } = {}) {
  const calls: { user: string }[] = [];
  const fn = (async (_role: LlmRole, _system: string, user: string) => {
    calls.push({ user });
    const usage = { provider: "stub", model: "stub-1", inputTokens: 5, outputTokens: 5 };
    if (user.includes("Plan the notes")) {
      if (o.outline !== undefined) return { text: o.outline, usage };
      const n = o.sections ?? 6;
      return { text: JSON.stringify({ sections: Array.from({ length: n }, (_, i) => ({ title: `Bo‘lim ${i + 1}`, brief: "x", words: 200 })) }), usage };
    }
    /* Blocks of ≤ 120 words like a real answer: the clamp to the tier maximum works on whole blocks. */
    const total = o.perSection ?? 200;
    const blocks = Array.from({ length: Math.ceil(total / 120) }, (_, i) => ({ kind: i % 3 === 2 ? "li" : "p", text: words(Math.min(120, total - i * 120), "fakt") }));
    return { text: JSON.stringify({ blocks }), usage };
  }) as never;
  return { fn, calls };
}
const run = (values: FormValues, o?: Parameters<typeof stub>[0]) => {
  const s = stub(o);
  return buildKonspektDoc(META, { topic: "Davlatchilik tarixi", pages: "5-10", ...values }, { deadline: Date.now() + 120_000, complete: s.fn }).then((r) => ({ r, s }));
};

test("input: defaults are a grid notebook, two A5 per A4, alternating margin line, 1-cell rows; only exposed params are kept", () => {
  const input = konspektInputFromValues({ topic: "T" });
  assert.deepEqual(input.hand, { ink: "blue", paper: "grid", font: "school", lively: true, headings: "plain", format: "a5x2", margin: "alternate", cells: 1 });
  assert.equal(input.pages, "10-20", "default tier");
  // Headings/underline/cover are not exposed by this service: whatever arrives is reset.
  const v = konspektInputFromValues({ topic: "T", handHeadings: "caps", handCover: "calligraphy", handUnderline: "off", handPaper: "blank", handCells: "2" });
  assert.deepEqual(v.hand, { ink: "blue", paper: "blank", font: "school", lively: true, headings: "plain", format: "a5x2" }, "blank: no margin line; cells 2 is the legacy default so it is not stored");
  assert.equal(v.hand.headings, "plain", "fixed: plain-case sub-headings, whatever the form sends");
  assert.equal(v.hand.cover, undefined);
  assert.equal(v.hand.underline, undefined);
  assert.equal(v.hand.margin, undefined, "blank paper has no margin line");
  assert.equal(konspektInputFromValues({ topic: "T", language: "xx" }).language, "uz");
});

test("price tiers 5-10: 3 000 · 10-20: 4 000 · 20-30: 5 000; unknown tier falls back to the default tier", () => {
  const tool = TOOL_BY_ID.konspekt;
  assert.equal(priceFor(tool, { topic: "T", pages: "5-10" }), 3000);
  assert.equal(priceFor(tool, { topic: "T", pages: "10-20" }), 4000);
  assert.equal(priceFor(tool, { topic: "T", pages: "20-30" }), 5000);
  assert.equal(priceFor(tool, { topic: "T", pages: "99" }), 4000);
  assert.equal(priceFor(tool, { topic: "T" }), 4000);
});

test("volume plan comes from the notebook geometry: denser rows hold more words per page; the tier range scales the target", () => {
  const grid1 = konspektInputFromValues({ topic: "T", handPaper: "grid", handCells: "1", handFormat: "a5x2" }).hand;
  const grid2 = konspektInputFromValues({ topic: "T", handPaper: "grid", handCells: "2", handFormat: "a4" }).hand;
  const a5 = konspektWordsPerPage(grid1, "ru");
  const a4 = konspektWordsPerPage(grid2, "ru");
  assert.ok(a5 > 150 && a5 < 320, `A5 1-cell page: ${a5} words`);
  assert.ok(a4 > 110 && a4 < 220, `A4 2-cell page: ${a4} words (calibrated: ~157 measured)`);
  assert.ok(konspektWordsPerPage(grid1, "en") > konspektWordsPerPage(grid1, "ru"), "shorter words → more words per page");
  const p = konspektWordPlan({ pages: "10-20", hand: grid1, language: "ru" });
  assert.equal(p.target, Math.round(p.perPage * 15));
  assert.equal(p.max, p.perPage * 20);
  assert.ok(handGeometry("grid", "school", grid1).lines > 30);
});

test("engine: outline → sections → a konspekt doc (no cover/contents/references), hand model, planWork notes shape", async () => {
  const { r, s } = await run({ pages: "5-10" }, { sections: 6, perSection: 230 });
  assert.ok(r, "built");
  const { doc } = r;
  assert.equal(doc.titlePage, false);
  assert.equal(doc.toc, false);
  assert.equal(doc.work!.genre, "konspekt");
  assert.equal(doc.work!.references.length, 0);
  assert.equal(doc.sections.length, 6);
  assert.deepEqual(doc.sections.map((x) => x.id), ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6"]);
  assert.ok(doc.work!.hand && doc.work!.hand.format === "a5x2");
  assert.ok(s.calls.length >= 7, "1 outline + 6 sections");
  const plan = planWork(doc);
  const heads = plan.body.filter((b) => b.k === "h1" || b.k === "h2");
  assert.equal(heads[0]!.k, "h1", "the topic is the title");
  assert.equal(heads.filter((h) => h.k === "h2").length, 6);
  assert.ok(heads.filter((h) => h.k === "h2").every((h) => !(h as { number?: string }).number), "sub-headings are unnumbered");
  assert.equal(plan.refs.length, 0);
  assert.ok(plan.body.every((b) => !(b.k === "h1" && (b as { pageBreak: boolean }).pageBreak)), "no page breaks between sections");
});

test("engine: never exceeds the paid upper bound of the tier; too little text fails the job (null) instead of selling a thin konspekt", async () => {
  const plan = konspektWordPlan({ pages: "5-10", hand: konspektInputFromValues({ topic: "T" }).hand, language: "uz" });
  const big = await run({ pages: "5-10" }, { sections: 10, perSection: Math.ceil((plan.max * 3) / 10) });
  assert.ok(big.r && big.r.words <= plan.max, `${big.r?.words} ≤ ${plan.max}`);
  const thin = await run({ pages: "5-10" }, { sections: 6, perSection: 10 });
  assert.equal(thin.r, null, "under half of the promised volume");
  const noOutline = await run({}, { outline: "{}" });
  assert.equal(noOutline.r, null, "no outline → failed job");
  const noTopic = await buildKonspektDoc(META, { pages: "5-10" } as FormValues, { deadline: Date.now() + 60_000, complete: stub().fn });
  assert.ok(noTopic, "meta.topic is used when the form topic is empty");
});

test("engine: the prompt carries the truthfulness rules and the source text; a short section is asked once more", async () => {
  const calls: string[] = [];
  const fn = (async (_r: LlmRole, system: string, user: string) => {
    calls.push(system + "\n" + user);
    const usage = { provider: "stub", model: "stub-1", inputTokens: 1, outputTokens: 1 };
    if (user.includes("Plan the notes")) return { text: JSON.stringify({ sections: [{ title: "A bo‘lim", brief: "b", words: 4000 }, { title: "B bo‘lim", brief: "b", words: 4000 }, { title: "C bo‘lim", brief: "b", words: 4000 }, { title: "D bo‘lim", brief: "b", words: 4000 }] }), usage };
    if (user.includes("too short")) return { text: JSON.stringify({ blocks: [{ kind: "li", text: words(400, "qo‘shimcha") }] }), usage };
    return { text: JSON.stringify({ blocks: [{ kind: "p", text: words(60, "asos") }] }), usage };
  }) as never;
  const r = await buildKonspektDoc(META, { topic: "T", pages: "5-10", sourceText: "MANBA-MATNI-123" } as FormValues, { deadline: Date.now() + 120_000, complete: fn });
  assert.ok(r);
  assert.ok(calls.every((c) => c.includes("Never invent dates, names, numbers, quotations")), "truthfulness in every call");
  assert.ok(calls.every((c) => c.includes("MANBA-MATNI-123")), "source material in every call");
  assert.ok(calls.some((c) => c.includes("too short")), "expand pass");
  assert.ok(r.doc.sections.every((s) => s.blocks.length === 2), "expanded section = base + added block");
});

test("DOCX: the konspekt renders through the hand renderer — A4 landscape two-up, one sheet image, margin line pages, no cover/contents", async () => {
  const { r } = await run({ pages: "5-10" }, { sections: 6, perSection: 230 });
  const zip = await JSZip.loadAsync(Buffer.from(await renderDocx(r!.doc)));
  const doc = await zip.file("word/document.xml")!.async("string");
  assert.match(doc, /<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/);
  assert.match(doc, /<w:cols [^>]*w:num="2"/);
  assert.ok(Object.keys(zip.files).filter((f) => /^word\/media\/.*\.png$/.test(f)).length === 1, "one sheet image (two pages)");
  assert.ok(!/MUNDARIJA|Mundarija|Kirish|KIRISH|Xulosa/.test(doc), "no contents / introduction / conclusion");
  assert.ok(doc.includes("Davlatchilik") && doc.includes("Bo"), "title and sub-headings are present");
});

test("differential probe: EVERY registry parameter changes the result (the prompts the model sees, or the rendered DOCX) — no decorative field", async () => {
  const observe = async (values: FormValues) => {
    /* Plenty of text per section: the volume clamp (tier maximum) keeps every tier valid, a thin stub would fail the 20-30 tier. */
    const s = stub({ sections: 6, perSection: 1500 });
    const r = await buildKonspektDoc(META, { topic: "Davlatchilik tarixi", pages: "5-10", ...values }, { deadline: Date.now() + 120_000, complete: s.fn });
    assert.ok(r, `built for ${JSON.stringify(values)}`);
    const zip = await JSZip.loadAsync(Buffer.from(await renderDocx(r.doc)));
    const part = async (f: string) => (await zip.file(f)?.async("string")) ?? "";
    return JSON.stringify({
      prompts: s.calls.map((c) => c.user),
      topic: r.doc.meta.topic,
      model: r.doc.work,
      docx: { document: await part("word/document.xml"), settings: await part("word/settings.xml"), media: Object.keys(zip.files).filter((f) => f.startsWith("word/media/")).sort() },
    });
  };
  const failures: string[] = [];
  for (const p of KONSPEKT_PARAMS) {
    const base = p.probeWith ?? {};
    const a = await observe({ ...base, [p.id]: p.probeA });
    const b = await observe({ ...base, [p.id]: p.probeB });
    if (a === b) failures.push(p.id);
  }
  assert.deepEqual(failures, [], `parameters without any effect: ${failures.join(", ")}`);
});

test("fit helpers: trimKonspektDoc cuts from the end by whole blocks, renumbers sections and keeps the model in sync; the word plan matches the calibrated density", async () => {
  const { r } = await run({ pages: "10-20" }, { sections: 6, perSection: 700 });
  assert.ok(r);
  const { konspektWords, trimKonspektDoc } = await import("../lib/generation/konspekt/index.ts");
  const total = konspektWords(r.doc);
  trimKonspektDoc(r.doc, Math.floor(total / 2));
  assert.ok(konspektWords(r.doc) <= total / 2 && konspektWords(r.doc) > total / 2 - 800, `${konspektWords(r.doc)} of ${total}`);
  assert.deepEqual(r.doc.sections.map((s) => s.id), r.doc.sections.map((_, i) => `ch${i + 1}`), "renumbered");
  assert.deepEqual(r.doc.work!.chapters.map((c) => c.id), r.doc.sections.map((s) => s.id), "model chapters follow the sections");
  trimKonspektDoc(r.doc, 0);
  assert.equal(r.doc.sections.length, 0);
  // Calibration: Russian A5 1-cell page ≈ 145 measured words (rendered live konspekt, many lists).
  const hand = konspektInputFromValues({ topic: "T" }).hand;
  const perPage = konspektWordsPerPage(hand, "ru");
  assert.ok(perPage >= 120 && perPage <= 175, `A5 1-cell ru: ${perPage} words/page (measured ≈145)`);
});
