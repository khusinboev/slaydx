import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setSafeFetchLookup } from "../lib/generation/safe-fetch.ts";
import { resetBreakers } from "../lib/generation/llm/breaker.ts";
import { cleanStockQuery, parseStockPlans, composeSceneImagePrompt, writeSlideImagePrompts } from "../lib/generation/slide-image-prompts.ts";
import {
  attachHybridImages,
  interleave,
  judgeStockCandidates,
  parseJudgePicks,
  type HybridJob,
  type SlideImagePolicy,
} from "../lib/generation/slide-stock.ts";
import { attachSlideImages } from "../lib/generation/slide-images.ts";
import { withJobCost } from "../lib/generation/job-cost.ts";
import type { ImageProvider } from "../lib/generation/image-provider.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import type { SlideImageReport } from "../lib/generation/types.ts";

/**
 * Slide quality §B (docs/slide-quality/SPEC.md): LLM stock queries, both providers, the vision judge, the AI
 * fallback with its cap/settings, the promise accounting and the cost record. `fetch` is stubbed throughout.
 */
const JPEG = Buffer.concat([
  Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  ),
  Buffer.alloc(1200, 0),
]);
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, statusText: `s${status}`, json: async () => body }) as unknown as Response;
const img = () => ({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => JPEG }) as unknown as Response;

const saved = { ...process.env };
const realFetch = globalThis.fetch;
beforeEach(() => {
  setSafeFetchLookup(async () => ["93.184.216.34"]);
  resetBreakers();
  process.env.PEXELS_API_KEY = "k";
  process.env.PIXABAY_API_KEY = "k";
  delete process.env.GEMINI_API_KEY;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setSafeFetchLookup(null);
  for (const k of ["PEXELS_API_KEY", "PIXABAY_API_KEY", "GEMINI_API_KEY"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const slide = (i: number, layout: SlideModel["layout"] = "bullets"): SlideModel => ({ id: `s${i}`, layout, title: `Slayd ${i}`, bullets: ["Barg quyosh nurini ushlaydi"] });
const jobs = (n: number): HybridJob[] => Array.from({ length: n }, (_, i) => ({ s: slide(i), size: { width: 1024, height: 768 } }));
const report = (want: number): SlideImageReport => ({ want, got: 0, blocked: 0, skipped: 0, failed: 0 });
const persist = async (im: { url: string; alt?: string }) => ({ url: im.url.startsWith("data:") ? im.url : `data:image/jpeg;base64,x-${im.url}`, alt: im.alt });

/** Stock stub: each provider returns `per` hits named by query; counts requests. */
function stockStub(opts: { pexels?: number; pixabay?: number; per?: number } = {}) {
  const hits = { pexels: 0, pixabay: 0, thumbs: 0 };
  globalThis.fetch = (async (input: unknown) => {
    const u = String(input);
    if (u.startsWith("https://api.pexels.com/")) {
      hits.pexels += 1;
      if (opts.pexels && opts.pexels !== 200) return json(opts.pexels, {});
      const q = new URL(u).searchParams.get("query");
      return json(200, { photos: Array.from({ length: opts.per ?? 2 }, (_, k) => ({ src: { large2x: `https://images.pexels.com/${q}-${k}.jpg`, tiny: `https://images.pexels.com/t/${q}-${k}.jpg` }, alt: `${q} ${k}` })) });
    }
    if (u.startsWith("https://pixabay.com/api/")) {
      hits.pixabay += 1;
      if (opts.pixabay && opts.pixabay !== 200) return json(opts.pixabay, {});
      const q = new URL(u).searchParams.get("q");
      return json(200, { hits: Array.from({ length: opts.per ?? 2 }, (_, k) => ({ largeImageURL: `https://cdn.pixabay.com/${q}-${k}.jpg`, previewURL: `https://cdn.pixabay.com/t/${q}-${k}.jpg`, tags: `${q}` })) });
    }
    hits.thumbs += 1;
    return img();
  }) as unknown as typeof fetch;
  return hits;
}

/** AI provider stub — counts calls. */
function aiStub(ok = true): ImageProvider & { calls: number } {
  const p = {
    id: "gemini" as const,
    minMs: 0,
    calls: 0,
    hasKey: () => true,
    async fetchImage() {
      p.calls += 1;
      return ok ? { ok: true as const, image: { url: `data:image/jpeg;base64,${JPEG.toString("base64")}`, alt: "ai" } } : { ok: false as const, reason: "failed" as const, detail: "x" };
    },
  };
  return p;
}

const policy = (p: Partial<SlideImagePolicy> = {}): SlideImagePolicy => ({ aiFallback: true, aiMax: 8, ...p });

test("cleanStockQuery / parseStockPlans: English nouns only, abstract-only answers and unknown ids dropped", () => {
  assert.equal(cleanStockQuery("green leaf chloroplast"), "green leaf chloroplast");
  assert.equal(cleanStockQuery("Importance of the concept"), "of the");
  assert.equal(cleanStockQuery("concept importance"), "");
  assert.equal(cleanStockQuery("fotosintez «barg» 🌿 leaf"), "fotosintez barg leaf");
  assert.equal(cleanStockQuery("a b c d e f g h"), "", "single letters are not words");
  const plans = parseStockPlans(
    JSON.stringify({ plans: [
      { id: "s1", query: "Leaf Sunlight", altQuery: "", scene: "A green leaf in bright sunlight on a branch." },
      { id: "s2", query: "concept", altQuery: "x", scene: "short" },
      { id: "zz", query: "leaf", scene: "A leaf on a table in a lab." },
      { id: "s1", query: "duplicate", scene: "Duplicate id should be ignored here." },
    ] }),
    ["s1", "s2"],
  );
  // MUTATION: skip `cleanStockQuery` on `query` → s2 «concept» survives and this fails.
  assert.deepEqual(Object.keys(plans), ["s1"]);
  assert.deepEqual(plans.s1, { query: "leaf sunlight", altQuery: "leaf sunlight", scene: "A green leaf in bright sunlight on a branch." });
  assert.deepEqual(parseStockPlans("not json at all", ["s1"]), {});
  assert.deepEqual(parseStockPlans('{"plans": "x"}', ["s1"]), {});
});

test("composeSceneImagePrompt is the exact Pro slayd wording (writeSlideImagePrompts output unchanged)", async () => {
  process.env.GEMINI_API_KEY = "k";
  globalThis.fetch = (async () =>
    json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ prompts: [{ id: "s0", scene: "A green leaf in bright sunlight on a branch." }] }) }] }, finishReason: "STOP" }] })) as unknown as typeof fetch;
  const out = await writeSlideImagePrompts("Fotosintez", [slide(0)], "classic", { slideImageStyle: "photo", localExamples: false });
  assert.ok(out.s0);
  const size = { width: 1000, height: 1000 };
  void size;
  assert.ok(out.s0.includes("A green leaf in bright sunlight on a branch.") && out.s0.includes("Must depict the topic «Fotosintez»"));
  assert.equal(composeSceneImagePrompt("T", "A scene that is long enough.", { width: 1024, height: 576 }).includes("Wide 1024x576"), true);
});

test("parseJudgePicks: range, -1, duplicates and junk", () => {
  const counts = new Map([["s1", 3], ["s2", 2]]);
  const p = parseJudgePicks(JSON.stringify({ picks: [{ slot: "s1", pick: 2 }, { slot: "s2", pick: -1 }, { slot: "s1", pick: 0 }, { slot: "s9", pick: 0 }] }), counts);
  assert.deepEqual([...p], [["s1", 2], ["s2", -1]]);
  // MUTATION: drop the `pick < n` bound → s1:5 is accepted.
  assert.equal(parseJudgePicks(JSON.stringify({ picks: [{ slot: "s1", pick: 5 }, { slot: "s2", pick: 1.5 }] }), counts).size, 0);
  assert.equal(parseJudgePicks("{broken", counts).size, 0);
  assert.equal(parseJudgePicks(null, counts).size, 0);
});

test("interleave alternates providers", () => {
  assert.deepEqual(interleave([1, 3, 5], [2, 4]), [1, 2, 3, 4, 5]);
});

test("hybrid: BOTH providers are searched, candidates deduplicated across the deck, judge picks per slot", async () => {
  const hits = stockStub({ per: 2 });
  const seen: string[][] = [];
  const judge: typeof judgeStockCandidates = async (_t, slots) => {
    for (const s of slots) seen.push(s.candidates.map((c) => c.url));
    return new Map(slots.map((s) => [s.s.id, 1]));
  };
  const rep = report(2);
  const j = jobs(2);
  await attachHybridImages("Fotosintez", j, Date.now() + 60_000, rep, { policy: policy(), persist, judge, ai: aiStub() });
  assert.ok(hits.pexels >= 2 && hits.pixabay >= 2, `both providers: ${JSON.stringify(hits)}`);
  // Both slots ask the same fallback query (no LLM): the second slot must not get the first slot's photos.
  const flat = seen.flat();
  assert.equal(new Set(flat).size, flat.length, "no candidate twice in the deck");
  assert.ok(seen[0].some((u) => u.includes("pexels")) && seen[0].some((u) => u.includes("pixabay")), "providers interleaved");
  assert.equal(rep.got, 2);
  assert.equal(rep.stock, 2);
  assert.equal(rep.ai, 0);
  // Index 1 = the second candidate (the pixabay hit after interleave).
  assert.ok(j[0].s.image?.url.includes("pixabay"), j[0].s.image?.url);
});

test("hybrid: judge «none» → AI draws; AI cap and the off switch decline the rest (removed from the promise)", async () => {
  stockStub();
  const none: typeof judgeStockCandidates = async (_t, slots) => new Map(slots.map((s) => [s.s.id, -1]));
  const ai = aiStub();
  const rep = report(3);
  await attachHybridImages("Fotosintez", jobs(3), Date.now() + 60_000, rep, { policy: policy({ aiMax: 1 }), persist, judge: none, ai });
  // MUTATION: ignore `aiMax` → 3 AI calls.
  assert.equal(ai.calls, 1);
  assert.equal(rep.ai, 1);
  assert.equal(rep.declined, 2);
  assert.equal(rep.want, 1, "declined slots are not promised");
  assert.equal(rep.got, 1);

  const ai2 = aiStub();
  const off = report(2);
  await attachHybridImages("Fotosintez", jobs(2), Date.now() + 60_000, off, { policy: policy({ aiFallback: false }), persist, judge: none, ai: ai2 });
  assert.equal(ai2.calls, 0, "switch off → no AI");
  assert.deepEqual([off.want, off.got, off.declined], [0, 0, 2]);
});

test("hybrid: judge unavailable → first candidate (today's behaviour), never a failed deck", async () => {
  stockStub();
  const rep = report(2);
  const j = jobs(2);
  await attachHybridImages("Fotosintez", j, Date.now() + 60_000, rep, { policy: policy(), persist, judge: async () => null, ai: aiStub() });
  assert.equal(rep.got, 2);
  assert.equal(rep.stock, 2);
  assert.ok(j[0].s.image?.url.includes("pexels"), "first candidate = first pexels hit");
});

test("hybrid: real judge with a broken answer degrades to the first candidate; its tokens are recorded", async () => {
  process.env.GEMINI_API_KEY = "k";
  const base = stockStub();
  void base;
  const inner = globalThis.fetch;
  let judged = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const u = String(input);
    if (u.includes("generativelanguage.googleapis.com") && u.includes(":generateContent")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.generationConfig?.responseSchema) {
        judged += 1;
        const parts = body.contents[0].parts as { inlineData?: unknown }[];
        assert.ok(parts.some((p) => p.inlineData), "previews are inlined");
        return json(200, { candidates: [{ content: { parts: [{ text: "{not json" }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 20 } });
      }
      return json(500, {}); // the stock-plan LLM call fails → per-slot fallback queries
    }
    return inner(input as never, init);
  }) as unknown as typeof fetch;
  const rep = report(1);
  const j = jobs(1);
  const { cost } = await withJobCost(() => attachHybridImages("Fotosintez", j, Date.now() + 60_000, rep, { policy: policy(), persist, ai: aiStub() }));
  assert.equal(judged, 1);
  assert.equal(rep.got, 1);
  assert.equal(rep.stock, 1);
  const llm = cost.toJson().parts?.find((p) => p.kind === "llm" && p.inputTokens >= 900);
  // MUTATION: remove `recordLlmUsage` from the judge → no 900-token part.
  assert.ok(llm, `judge usage recorded: ${JSON.stringify(cost.toJson())}`);
});

test("hybrid: stock outage with AI off counts as a failure (kept in the promise), AI on draws instead", async () => {
  stockStub({ pexels: 500, pixabay: 500 });
  const off = report(2);
  await attachHybridImages("Fotosintez", jobs(2), Date.now() + 60_000, off, { policy: policy({ aiFallback: false }), persist, judge: async () => null, ai: aiStub() });
  // MUTATION: count an outage as «declined» → want 0, a refund-relevant shortfall disappears.
  assert.deepEqual([off.want, off.got, off.failed, off.declined], [2, 0, 2, 0]);
  resetBreakers();
  stockStub({ pexels: 500, pixabay: 500 });
  const ai = aiStub();
  const on = report(2);
  await attachHybridImages("Fotosintez", jobs(2), Date.now() + 60_000, on, { policy: policy(), persist, judge: async () => null, ai });
  assert.deepEqual([on.want, on.got, on.ai, ai.calls], [2, 2, 2, 2]);
});

test("hybrid: AI goes to content slides first when the cap is short", async () => {
  stockStub();
  const none: typeof judgeStockCandidates = async (_t, slots) => new Map(slots.map((s) => [s.s.id, -1]));
  const j: HybridJob[] = [
    { s: slide(0, "title"), size: { width: 1024, height: 768 } },
    { s: slide(1, "closing"), size: { width: 1024, height: 768 } },
    { s: slide(2, "bullets"), size: { width: 1024, height: 768 } },
  ];
  await attachHybridImages("Fotosintez", j, Date.now() + 60_000, report(3), { policy: policy({ aiMax: 1 }), persist, judge: none, ai: aiStub() });
  assert.ok(j[2].s.image && !j[0].s.image && !j[1].s.image, "the bullets slide got the only AI picture");
});

test("attachSlideImages: `hybrid` only on the plain tool; without it the legacy chain (first pexels hit, no pixabay)", async () => {
  const hits = stockStub();
  const legacy = await attachSlideImages([slide(0)], "Fotosintez", "classic", 60_000, { meta: { toolId: "slide", slideImageStyle: "photo", localExamples: false } as never });
  assert.equal(legacy.got, 1);
  assert.equal(hits.pixabay, 0, "legacy chain unchanged");
  const hybrid = await attachSlideImages([slide(1)], "Fotosintez", "classic", 60_000, {
    meta: { toolId: "slide", slideImageStyle: "photo", localExamples: false } as never,
    hybrid: { aiFallback: false, aiMax: 0 },
  });
  assert.equal(hybrid.got, 1);
  assert.equal(hybrid.stock, 1);
  assert.ok(hits.pixabay > 0, "hybrid asks both providers");
});

test("attachSlideImages hybrid: no stock key and AI off → nothing promised (no refund on a key-less box)", async () => {
  delete process.env.PEXELS_API_KEY;
  delete process.env.PIXABAY_API_KEY;
  const rep = await attachSlideImages([slide(0)], "Fotosintez", "classic", 60_000, {
    meta: { toolId: "slide", slideImageStyle: "photo", localExamples: false } as never,
    hybrid: { aiFallback: true, aiMax: 8 },
  });
  // GEMINI_API_KEY is unset too → AI cannot deliver either.
  assert.equal(rep.want, 0);
});

test("promise accounting: declined slots never reach the refund; a plain partial shortfall refunds nothing", async () => {
  const { deliveredCount, refundRatio } = await import("../lib/generation/delivered.ts");
  const meta = { toolId: "slide", targetPages: 3, premiumVisuals: false } as never;
  const slides = [slide(0), slide(1), slide(2)];
  const doc = (slideImages: SlideImageReport) => ({ meta, slides, sections: [], titlePage: false, toc: false, slideImages }) as never;
  // 3 slots planned, 2 declined (no fitting stock, AI capped) → want 1, got 1: nothing short.
  assert.equal(deliveredCount(meta, doc({ want: 1, got: 1, blocked: 0, skipped: 0, failed: 0, declined: 2 })), undefined);
  const partial = deliveredCount(meta, doc({ want: 3, got: 2, blocked: 0, skipped: 0, failed: 1 }));
  assert.equal(partial?.unit, "rasm", "the shortfall is still noted");
  assert.equal(refundRatio(partial), null, "plain deck: a partial picture shortfall is not refunded");
});
