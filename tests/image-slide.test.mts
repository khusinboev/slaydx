import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, basePriceFor, preflightError, toolBlockedReason, listedTools } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { budgetFor } from "../lib/generation/budget.ts";
import { planSlide } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import {
  IMAGE_SLIDE_MAX,
  IMAGE_SLIDE_MIN,
  IMAGE_SLIDE_MODELS,
  IMAGE_SLIDE_TEXT_USD,
  imageSlideCount,
  imageSlideError,
  imageSlidePrice,
} from "../lib/generation/image-slide/models.ts";
import { PICTURE_LIMITS, clip, normalizePictureSlide, parsePictureDeck, pinTitleSlide, type PictureSlide } from "../lib/generation/image-slide/write.ts";
import { slidePrompt } from "../lib/generation/image-slide/prompt.ts";
import { drawBody, usageUsd } from "../lib/generation/image-slide/draw.ts";
import { expectedTexts, fixNote, parseIssues } from "../lib/generation/image-slide/check.ts";
import { buildImageSlideDoc, ImageSlideError, ASSEMBLY_RESERVE_MS, drawDeadlineOf } from "../lib/generation/image-slide/build.ts";
import { applyLiveEvent, type LiveDeck } from "../lib/generation/slide-progress.ts";

const tool = TOOL_BY_ID["image-slide"];
const pricing = { soumPerUsd: 12_700, markup: 2, step: 100 };
const media = { ...pricing, overrides: {}, costUsd: {} };

/* ───────────── price ───────────── */

test("price = (text + slides × model cost) × markup × rate, rounded up to 100", () => {
  const v: FormValues = { slideCount: 10, imageModel: "nb21" };
  const raw = (IMAGE_SLIDE_TEXT_USD + 10 * 0.1) * 2 * 12_700;
  assert.equal(imageSlidePrice(v, pricing), Math.ceil(raw / 100) * 100);
  assert.equal(imageSlidePrice(v, pricing) % 100, 0);
  // (0.03 + 4 × 0.1) × 2 × 12 700 = 10 922 → up, never to the nearest: 11 000.
  assert.equal(imageSlidePrice({ slideCount: 4, imageModel: "nb21" }, pricing), 11_000);
  // The server path (`basePriceFor` with the pricing block) is the same function.
  assert.equal(basePriceFor(tool, v, media), imageSlidePrice(v, pricing));
});

test("every extra slide adds its model's cost × markup; Pro costs more per slide", () => {
  const at = (n: number, m: string) => imageSlidePrice({ slideCount: n, imageModel: m }, { ...pricing, step: 1 });
  for (const m of IMAGE_SLIDE_MODELS) {
    const step = at(11, m.id) - at(10, m.id);
    assert.ok(Math.abs(step - m.usdPerSlide * 2 * 12_700) <= 1, `${m.id}: +1 slide = ${step}`);
  }
  assert.ok(at(10, "pro") > at(10, "nb21"));
  // The markup is the owner's rule: twice the cost.
  assert.equal(imageSlidePrice({ slideCount: 10 }, { ...pricing, markup: 4 }) >= 2 * imageSlidePrice({ slideCount: 10 }, pricing) - 100, true);
});

test("slide count is clamped the same way for price and engine", () => {
  assert.equal(imageSlideCount({ slideCount: 1 }), IMAGE_SLIDE_MIN);
  assert.equal(imageSlideCount({ slideCount: 99 }), IMAGE_SLIDE_MAX);
  assert.equal(imageSlideCount({ slideCount: "abc" }), 10);
  assert.equal(imageSlidePrice({ slideCount: 99 }, pricing), imageSlidePrice({ slideCount: IMAGE_SLIDE_MAX }, pricing));
});

test("unknown model, style or audience is refused before any charge", () => {
  assert.equal(imageSlideError({ imageModel: "nb21", slideStyle: "chalk", audience: "student" }), null);
  assert.match(String(imageSlideError({ imageModel: "dalle" })), /model/);
  assert.match(String(imageSlideError({ slideStyle: "neon" })), /uslub/);
  assert.match(String(imageSlideError({ audience: "kids" })), /auditoriya/);
  assert.match(String(preflightError(tool, { topic: "Fotosintez", imageModel: "x" })), /model/);
});

test("the tool lives on the Pro slayd page: unlisted, blocked only when the server says so", () => {
  assert.ok(!listedTools().some((t) => t.id === "image-slide"));
  const base = { llm: true, images: true } as const;
  assert.equal(toolBlockedReason(tool, base), null);
  assert.match(String(toolBlockedReason(tool, { ...base, imageSlide: false })), /AI slayd/);
  assert.match(String(toolBlockedReason(tool, { llm: true, images: false })), /AI slayd/);
});

test("budget grows with the slide count and fits ten lanes", () => {
  const b4 = budgetFor(tool, { slideCount: 4 }, 10_000_000);
  const b30 = budgetFor(tool, { slideCount: 30 }, 10_000_000);
  assert.ok(b30 > b4);
  assert.ok(budgetFor(tool, { slideCount: 30 }, 660_000) <= 660_000);
});

/* ───────────── text ───────────── */

test("writer output is clipped, its formulas become Unicode, its kind is checked", () => {
  const s = normalizePictureSlide({
    kind: "weird",
    title: "x".repeat(200),
    points: ["C_n H_2n+1 COOH", ...Array(10).fill("band")],
    formulas: ["E = mc^2"],
    table: { headers: ["A", "B", "C", "D", "E"], rows: Array(9).fill(["1", "2", "3", "4", "5"]) },
  })!;
  assert.equal(s.kind, "content");
  assert.ok(s.title.length <= PICTURE_LIMITS.title);
  assert.equal(s.points.length, PICTURE_LIMITS.points);
  assert.equal(s.points[0], "CₙH₂ₙ₊₁COOH");
  assert.deepEqual(s.formulas, ["E = mc²"]);
  assert.equal(s.table!.headers.length, PICTURE_LIMITS.tableCols);
  assert.equal(s.table!.rows.length, PICTURE_LIMITS.tableRows);
  assert.equal(normalizePictureSlide({ points: ["a"] }), null);
});

test("clip cuts at a word end", () => {
  assert.equal(clip("Kislotalarning turlari va asosiy xossalari", 25), "Kislotalarning turlari va");
  assert.equal(clip("  qisqa  ", 25), "qisqa");
});

test("deck is capped at the order and slide 1 carries the user's topic", () => {
  const raw = JSON.stringify({ slides: Array.from({ length: 8 }, (_, i) => ({ kind: i ? "content" : "agenda", title: `S${i}`, points: ["p"] })) });
  const deck = parsePictureDeck(raw, 5);
  assert.equal(deck.length, 5);
  const meta = extractMeta(tool, { topic: "H2SO4 xossalari" });
  const pinned = pinTitleSlide(deck, meta);
  assert.equal(pinned[0].kind, "title");
  assert.equal(pinned[0].title, "H₂SO₄ xossalari");
  assert.deepEqual(parsePictureDeck("not json", 5), []);
});

/* ───────────── prompt ───────────── */

const slide: PictureSlide = {
  kind: "table",
  title: "Kislotalar",
  points: ["Oʻtkir hidli"],
  table: { headers: ["Nomi", "Formula"], rows: [["Sulfat", "H₂SO₄"]] },
  formulas: ["CₙH₂ₙ₊₁COOH"],
  visual: "a flask",
  notes: "",
};

test("prompt lists every text item verbatim, the page number, and no words the model would draw", () => {
  const meta = extractMeta(tool, { topic: "Kislotalar", author: "Aliyev Ali" });
  const p = slidePrompt(slide, { meta, style: { id: "clean", label: "", hint: "", prompt: "STYLE" } as never, index: 2, total: 12, withReference: true });
  for (const t of ["TITLE: Kislotalar", "• Oʻtkir hidli", "CₙH₂ₙ₊₁COOH", "header: Nomi | Formula", "row: Sulfat | H₂SO₄", "3 / 12", "STYLE", "attached image"]) {
    assert.ok(p.includes(t), t);
  }
  // Words the second live deck drew as badges on every slide.
  assert.ok(!/print-ready|16:9|slide 3 of/i.test(p), p.slice(0, 200));
  const first = slidePrompt({ ...slide, kind: "title" }, { meta, style: { prompt: "S" } as never, index: 0, total: 12, withReference: false });
  assert.ok(!first.includes("attached image"));
  assert.ok(!first.includes("PAGE NUMBER"));
  assert.ok(first.includes("AUTHOR LINE (small): Aliyev Ali"));
  // An author the subtitle already names is not drawn twice.
  const dup = slidePrompt({ ...slide, kind: "title", subtitle: "Tayyorladi: Aliyev Ali" }, { meta, style: { prompt: "S" } as never, index: 0, total: 12, withReference: false });
  assert.ok(!dup.includes("AUTHOR LINE"));
});

/* ───────────── draw / check ───────────── */

test("draw request: the bought model, 2K 16:9, reference first, thinking only for 2.1", () => {
  const [nb, pro] = IMAGE_SLIDE_MODELS;
  const b = drawBody(nb, "P", { base64: "AAA", mime: "image/jpeg" });
  assert.equal(b.model, "gemini-nano-banana-2.1");
  assert.deepEqual(b.input[0], { type: "image", data: "AAA", mime_type: "image/jpeg" });
  assert.deepEqual(b.input[1], { type: "text", text: "P" });
  assert.deepEqual(b.response_format, { type: "image", mime_type: "image/jpeg", aspect_ratio: "16:9", image_size: "2K" });
  assert.deepEqual((b as Record<string, unknown>).generation_config, { thinking_level: "minimal" });
  const bp = drawBody(pro, "P", null);
  assert.equal(bp.model, "gemini-3-pro-image");
  assert.equal(bp.input.length, 1);
  assert.equal((bp as Record<string, unknown>).generation_config, undefined);
});

test("cost of a call comes from its usage tokens (thought tokens bill as output)", () => {
  const [nb, pro] = IMAGE_SLIDE_MODELS;
  assert.ok(Math.abs(usageUsd(nb, { total_input_tokens: 296, total_output_tokens: 2222, total_thought_tokens: 0 }) - (296 * 1.5 + 2222 * 30) / 1e6) < 1e-9);
  assert.ok(Math.abs(usageUsd(pro, { total_input_tokens: 296, total_output_tokens: 1528, total_thought_tokens: 189 }) - (296 * 2 + 1717 * 120) / 1e6) < 1e-9);
  assert.equal(usageUsd(nb, null), nb.usdPerSlide);
});

test("proofreading keeps only listed items and extra text; the fix note spells them out", () => {
  const exp = expectedTexts(slide, 2, 12);
  assert.ok(exp.includes("Kislotalar") && exp.includes("H₂SO₄") && exp.includes("3 / 12"));
  const raw = JSON.stringify({ issues: [{ expected: "Sulfat", seen: "Sufat" }, { expected: "invented", seen: "x" }, { expected: "", seen: "Print-ready" }, { expected: "", seen: "Kislotalar" }] });
  const issues = parseIssues(raw, exp);
  assert.deepEqual(issues, [{ expected: "Sulfat", seen: "Sufat" }, { expected: "", seen: "Print-ready" }]);
  const note = fixNote(issues);
  assert.ok(note.includes("«Sulfat» (not «Sufat»)") && note.includes("Do NOT draw") && note.includes("«Print-ready»"));
  assert.deepEqual(parseIssues("garbage", exp), []);
});

test("a picture slide is drawn edge to edge; without its picture it falls back to text", () => {
  const theme = getSlideTheme("atlas");
  const pic = planSlide({ id: "s1", layout: "bullets", title: "T", bullets: ["a"], fullImage: true, image: { url: "data:image/jpeg;base64,AA" } }, theme, "classic" as never, 1, 5);
  assert.equal(pic.layers.length, 1);
  assert.deepEqual(pic.layers[0], { t: "image", box: { x: 0, y: 0, w: 13.333, h: 7.5 }, url: "data:image/jpeg;base64,AA", fit: "cover" });
  const text = planSlide({ id: "s1", layout: "bullets", title: "T", bullets: ["a"], fullImage: true }, theme, "classic" as never, 1, 5);
  assert.ok(text.layers.some((l) => l.t === "text"));
});

/* ───────────── orchestration (fetch stubbed) ───────────── */

const JPEG_1PX =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

type Call = { kind: "write" | "draw" | "check"; at: number; body: Record<string, unknown> };

function deckJson(n: number) {
  return JSON.stringify({
    slides: Array.from({ length: n }, (_, i) => ({ kind: i === 0 ? "title" : "content", title: `Slayd ${i + 1}`, points: [`band ${i + 1}`], visual: "v", notes: "n" })),
  });
}

/** Stub: the writer, the image endpoint and the proofreader, by URL and body. `draw(i, call#)` decides each draw. */
/** `issuesFor(n, items)`: the proofreader's answer to its n-th call; `items` is the text list of THAT slide (slides 2…N are drawn in parallel lanes, so the call order is not the slide order). */
function stub(n: number, draw: (slideTitle: string, nth: number) => number, issuesFor: (n: number, items: string) => unknown[] = () => []) {
  const saved = { key: process.env.GEMINI_API_KEY, fetch: globalThis.fetch };
  process.env.GEMINI_API_KEY = "test-gemini-key";
  const calls: Call[] = [];
  const perTitle = new Map<string, number>();
  let checks = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const u = String(url);
    const json = (status: number, b: unknown) => ({ ok: status < 300, status, json: async () => b }) as never;
    if (u.endsWith("/interactions")) {
      calls.push({ kind: "draw", at: Date.now(), body });
      const prompt = JSON.stringify(body.input);
      const title = /TITLE: (Slayd \d+)/.exec(prompt)?.[1] ?? "?";
      const nth = (perTitle.get(title) ?? 0) + 1;
      perTitle.set(title, nth);
      const status = draw(title, nth);
      await new Promise((r) => setTimeout(r, 5));
      if (status !== 200) return json(status, { error: { message: "nope" } });
      return json(200, { steps: [{ type: "message", content: [{ data: JPEG_1PX.repeat(2), mime_type: "image/jpeg" }] }], usage: { total_input_tokens: 300, total_output_tokens: 2000 } });
    }
    const sys = JSON.stringify(body.system_instruction ?? body.systemInstruction ?? "");
    if (sys.includes("proofread")) {
      checks += 1;
      calls.push({ kind: "check", at: Date.now(), body });
      return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ issues: issuesFor(checks, JSON.stringify(body.contents ?? "")) }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
    }
    calls.push({ kind: "write", at: Date.now(), body });
    return json(200, { candidates: [{ content: { parts: [{ text: deckJson(n) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } });
  }) as unknown as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = saved.fetch;
      if (saved.key === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = saved.key;
    },
  };
}

const values: FormValues = { topic: "Slayd 1", slideCount: 5, imageModel: "nb21" };

test("slide 1 is drawn alone first, the rest carry it as the style reference", async () => {
  const s = stub(5, () => 200);
  try {
    const meta = extractMeta(tool, values);
    const built = await buildImageSlideDoc(meta, values, Date.now() + 600_000);
    const draws = s.calls.filter((c) => c.kind === "draw");
    assert.equal(draws.length, 5);
    assert.equal((draws[0].body.input as unknown[]).length, 1, "slide 1 has no reference");
    for (const d of draws.slice(1)) assert.equal((d.body.input as { type: string }[])[0].type, "image", "slides 2…N start with the reference");
    const firstDone = s.calls.findIndex((c) => c.kind === "check");
    assert.ok(s.calls.findIndex((c, i) => c.kind === "draw" && i > 0 && i > s.calls.indexOf(draws[0])) > firstDone, "others start after slide 1 is checked");
    assert.equal(built.delivered, undefined);
    assert.equal(built.doc.slides!.length, 5);
    assert.ok(built.doc.slides!.every((x) => x.fullImage && x.image?.url.startsWith("data:image/jpeg;base64,")));
  } finally {
    s.restore();
  }
});

test("a slide that fails twice is delivered as text and refunded at its share", async () => {
  const s = stub(5, (title) => (title === "Slayd 3" ? 500 : 200));
  try {
    const built = await buildImageSlideDoc(extractMeta(tool, values), values, Date.now() + 600_000);
    const third = built.doc.slides![2];
    assert.equal(third.image, undefined);
    assert.equal(third.fullImage, true);
    assert.equal(s.calls.filter((c) => c.kind === "draw" && JSON.stringify(c.body.input).includes("TITLE: Slayd 3")).length, 2, "one retry");
    assert.equal(built.delivered?.got, 4);
    assert.equal(built.delivered?.want, 5);
    assert.ok(built.delivered!.refundShare! > 0.9 && built.delivered!.refundShare! < 1);
  } finally {
    s.restore();
  }
});

test("no picture at all throws (full refund); a blocked key stops the remaining draws", async () => {
  const s = stub(5, () => 403);
  try {
    await assert.rejects(buildImageSlideDoc(extractMeta(tool, values), values, Date.now() + 600_000), ImageSlideError);
    assert.equal(s.calls.filter((c) => c.kind === "draw").length, 1, "403 on slide 1: nothing else is sent");
  } finally {
    s.restore();
  }
});

test("a slide whose text came out wrong is redrawn once with the exact spelling", async () => {
  // Keyed by the slide's own text, not by the call number: under load the lanes finish in any order (CI flake 2026-11-12).
  let flaggedOnce = false;
  const s = stub(4, () => 200, (_n, items) => {
    if (flaggedOnce || !items.includes("band 2")) return [];
    flaggedOnce = true;
    return [{ expected: "band 2", seen: "bnad 2" }];
  });
  try {
    const v = { ...values, slideCount: 4 };
    await buildImageSlideDoc(extractMeta(tool, v), v, Date.now() + 600_000);
    const draws = s.calls.filter((c) => c.kind === "draw");
    assert.equal(draws.length, 5, "4 slides + 1 redraw");
    const redraw = draws.find((d) => JSON.stringify(d.body.input).includes("not «bnad 2»"));
    assert.ok(redraw, "the redraw prompt names the wrong spelling");
  } finally {
    s.restore();
  }
});

test("the worker's live reducer accepts every event of a build, in order (review M1)", async () => {
  const s = stub(5, () => 200);
  try {
    let state: LiveDeck | undefined;
    const built = await buildImageSlideDoc(extractMeta(tool, values), values, Date.now() + 600_000, {
      // Exactly what `LiveReporter.sink` does: a reducer that throws on an out-of-order event.
      onProgress: (ev) => {
        state = applyLiveEvent(state, ev);
      },
    });
    assert.ok(state, "live state built");
    assert.equal(state!.slides.length, 5);
    assert.equal(state!.images.got, 5);
    assert.ok(state!.slides.every((x) => x.fullImage && x.image?.url.startsWith("data:image/jpeg;base64,")));
    assert.equal(built.doc.slides!.length, 5);
  } finally {
    s.restore();
  }
});

test("no draw starts inside the assembly reserve: a deck without time fails before any paid draw", async () => {
  const s = stub(5, () => 200);
  try {
    // Only the reserve + a little is left: the job fails (full refund) and no paid draw starts.
    await assert.rejects(buildImageSlideDoc(extractMeta(tool, values), values, Date.now() + ASSEMBLY_RESERVE_MS + 30_000));
    assert.equal(s.calls.filter((c) => c.kind === "draw").length, 0);
  } finally {
    s.restore();
  }
});

test("draws end at least the assembly reserve before the job deadline (review m2)", () => {
  assert.ok(ASSEMBLY_RESERVE_MS >= 45_000);
  assert.equal(drawDeadlineOf(1_000_000), 1_000_000 - ASSEMBLY_RESERVE_MS);
});

test("admin «Narxlar»: the ladder prices count × model with the live pricing block (review m1)", async () => {
  const { ladderInputs, ladderFor } = await import("../lib/server/admin-pricing.ts");
  const inputs = ladderInputs("image-slide");
  assert.equal(inputs.length, IMAGE_SLIDE_MODELS.length * 3);
  assert.ok(inputs.every((i) => typeof i.values.imageModel === "string" && typeof i.values.slideCount === "number"));
  const ladder = ladderFor("image-slide", media);
  const price = (n: number, m: string) => ladder[inputs.findIndex((i) => i.values.slideCount === n && i.values.imageModel === m)].base;
  assert.equal(price(10, "nb21"), imageSlidePrice({ slideCount: 10, imageModel: "nb21" }, pricing));
  assert.ok(price(10, "pro") > price(10, "nb21"));
  assert.ok(price(30, "nb21") > price(10, "nb21"));
});
